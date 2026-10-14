/**
 * The life of a file: ingest (validate, scan, store, record), new versions, trash / restore / purge, listing and
 * the shape the API returns. Controllers stay thin and every path that stores content goes through `ingest`.
 */
import crypto from 'crypto';
import type { Request } from 'express';
import { Types } from 'mongoose';
import sharp from 'sharp';
import { cdn } from '../config/cloudflare';
import cfg from '../config/env';
import logger from '../config/logger';
import File from '../models/File';
import ShareLink from '../models/ShareLink';
import type { FileCategory, FileDoc, IFileVariant, IFileVersion, ProviderName, UserDoc } from '../types/models';
import AppError from '../utils/appError';
import { categoryFromMimetype, escapeRegex, keySafe, sanitizeFilename } from '../utils/files';
import { readHead, resolveMime } from '../utils/mime';
import virusScanner from '../utils/virusScanner';
import * as access from './access.service';
import * as activity from './activity.service';
import { shouldEncrypt } from './encryption.service';
import * as objectStore from './objectStore.service';
import * as quota from './quota.service';
import { configuredProviders, defaultProviderName, normalizeProviderName, tryGetStorage } from './storage/registry';
import * as webhooks from './webhook.service';

/* ------------------------------------------------------------------ helpers */

/** The provider for a new file: the one asked for (must be configured), else the user's preference, else the default. */
export function chooseProvider(user: UserDoc, requested?: string | null): ProviderName {
    if (requested) {
        const name = normalizeProviderName(requested);
        if (!name || !tryGetStorage(name)) throw new AppError(`Storage provider "${requested}" is not available. Configured: ${configuredProviders().join(', ')}`, 400, 'storage_not_configured');
        return name;
    }
    const preferred = user.preferences?.defaultStorage;
    if (preferred && tryGetStorage(preferred)) return preferred;
    return defaultProviderName();
}

const rand = (n = 6): string => crypto.randomBytes(n).toString('hex');

/** Object keys are generated here and never contain user input except a sanitized extension. */
export const objectKey = (userId: unknown, fileId: unknown, label: string, name: string): string => `files/${String(userId)}/${String(fileId)}/${label}-${rand()}${keySafe(name)}`;

export const refOf = (f: Pick<FileDoc, 'key' | 'storageType' | 'size' | 'mimetype' | 'isEncrypted' | 'encryptionInfo'>): objectStore.ObjectRef => ({
    key: f.key,
    storageType: f.storageType,
    size: f.size,
    mimetype: f.mimetype,
    isEncrypted: f.isEncrypted,
    encryptionInfo: f.encryptionInfo ? { iv: f.encryptionInfo.iv, authTag: f.encryptionInfo.authTag } : undefined,
});

export const refOfVariant = (f: FileDoc, v: IFileVariant): objectStore.ObjectRef => ({
    key: v.key,
    storageType: f.storageType,
    size: v.size,
    mimetype: v.mimetype ?? 'application/octet-stream',
    isEncrypted: v.isEncrypted,
    encryptionInfo: v.encryptionInfo ? { iv: v.encryptionInfo.iv, authTag: v.encryptionInfo.authTag } : undefined,
});

export const refOfVersion = (f: FileDoc, v: IFileVersion): objectStore.ObjectRef => ({
    key: v.key,
    storageType: f.storageType,
    size: v.size,
    mimetype: v.mimetype ?? f.mimetype,
    isEncrypted: v.isEncrypted,
    encryptionInfo: v.encryptionInfo ? { iv: v.encryptionInfo.iv, authTag: v.encryptionInfo.authTag } : undefined,
});

/* ------------------------------------------------------------------- ingest */

export interface IngestInput {
    user: UserDoc;
    source: { path: string } | { buffer: Buffer };
    size: number;
    originalName: string;
    declaredMime?: string;
    provider?: string | null;
    fields?: { isPublic?: boolean; tags?: string[]; description?: string; expiresAt?: Date };
    /** Quota was already reserved by the caller (chunked uploads reserve when the session starts). */
    reserved?: boolean;
    /** Store as a new version of this file instead of creating a file. */
    versionOf?: FileDoc;
    reason?: string;
    req?: Pick<Request, 'ip' | 'headers'>;
    /** Skip the type check (images produced by this service itself). */
    trustedMime?: string;
}

async function scan(source: IngestInput['source'], name: string, owner: UserDoc): Promise<{ scanned: boolean }> {
    const result = 'path' in source ? await virusScanner.scanFile(source.path) : await virusScanner.scanBuffer(source.buffer);
    if (result.skipped) return { scanned: false };
    if (!result.clean) {
        logger.security('Infected upload rejected', { user: String(owner._id), name, viruses: result.viruses });
        webhooks.emit('file.infected', owner._id, { name, viruses: result.viruses });
        throw new AppError(`The file was rejected: it contains malware (${result.viruses.join(', ')})`, 422, 'infected');
    }
    return { scanned: true };
}

async function imageInfo(source: IngestInput['source']): Promise<{ width?: number; height?: number; format?: string }> {
    try {
        const m = await sharp('path' in source ? source.path : source.buffer, { limitInputPixels: 100_000_000, failOn: 'error' }).metadata();
        if (m.width && m.height && m.width * m.height > 100_000_000) throw new AppError('The image has too many pixels (at most 100 megapixels)', 415, 'unsupported_media_type');
        return { width: m.width, height: m.height, format: m.format };
    } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError('The file is not a valid image', 415, 'unsupported_media_type');
    }
}

export interface CommitInput {
    user: UserDoc;
    name: string;
    mimetype: string;
    /** An object that is already in storage (written by `ingest`, or uploaded straight to the provider). */
    stored: Omit<objectStore.StoredObject, 'checksum'> & { checksum?: string };
    scanned: boolean;
    meta?: { width?: number; height?: number; format?: string };
    fileId?: Types.ObjectId;
    versionOf?: FileDoc;
    fields?: IngestInput['fields'];
    reason?: string;
    req?: Pick<Request, 'ip' | 'headers'>;
}

/** Records an already-stored object as a new file or as a new version, with quota, history, webhooks and thumbnail. */
export async function commit(c: CommitInput): Promise<FileDoc> {
    const { user, stored, versionOf } = c;
    const category = categoryFromMimetype(c.mimetype);
    const common = {
        mimetype: c.mimetype,
        size: stored.size,
        key: stored.key,
        location: stored.location,
        bucket: stored.bucket,
        category,
        etag: stored.etag,
        checksum: stored.checksum,
        isEncrypted: stored.isEncrypted,
        encryptionInfo: stored.encryptionInfo,
        virusScanned: c.scanned,
        virusStatus: c.scanned ? 'clean' : undefined,
        metadata: c.meta?.width ? { width: c.meta.width, height: c.meta.height, format: c.meta.format } : undefined,
    };

    let file: FileDoc;
    if (versionOf) {
        const entry: Omit<IFileVersion, '_id'> = {
            versionNumber: versionOf.currentVersion,
            key: versionOf.key,
            size: versionOf.size,
            originalName: versionOf.originalName,
            mimetype: versionOf.mimetype,
            etag: versionOf.etag,
            checksum: versionOf.checksum,
            uploadedAt: versionOf.contentUpdatedAt ?? versionOf.createdAt,
            uploadedBy: versionOf.modifiedBy ?? versionOf.uploadedBy,
            reason: c.reason,
            isEncrypted: versionOf.isEncrypted,
            encryptionInfo: versionOf.encryptionInfo ? { iv: versionOf.encryptionInfo.iv, authTag: versionOf.encryptionInfo.authTag } : undefined,
        };
        const oldVariants = versionOf.variants.map((v) => ({ key: v.key, size: v.size, storageType: versionOf.storageType }));
        const updated = await File.findOneAndUpdate(
            { _id: versionOf._id, currentVersion: versionOf.currentVersion, deletedAt: null },
            { $set: { ...common, currentVersion: versionOf.currentVersion + 1, variants: [], modifiedBy: user._id, contentUpdatedAt: new Date() }, $push: { versions: entry } },
            { new: true }
        );
        if (!updated) throw new AppError('The file was changed by someone else while uploading, please try again', 409, 'conflict');
        file = updated as FileDoc;
        // thumbnails and other variants described the old content
        await Promise.all(oldVariants.map((v) => objectStore.deleteObject(v).catch((e) => logger.warn('old variant not deleted', { key: v.key, err: (e as Error).message }))));
        await quota.release(file.uploadedBy, oldVariants.reduce((n, v) => n + v.size, 0));
        await pruneVersions(file);
        activity.record(file._id, user._id, 'version', c.req, { version: file.currentVersion });
        webhooks.emit('file.version_created', file.uploadedBy, { fileId: String(file._id), name: file.originalName, version: file.currentVersion, size: file.size });
        purgeCdn(file, versionOf.key);
    } else {
        const isPublic = Boolean(c.fields?.isPublic);
        file = (await File.create({
            _id: c.fileId ?? new Types.ObjectId(),
            filename: c.name,
            originalName: c.name,
            ...common,
            storageType: stored.storageType,
            uploadedBy: user._id,
            isPublic,
            accessControl: isPublic ? 'public' : 'private',
            tags: normalizeTags(c.fields?.tags),
            description: c.fields?.description,
            expiresAt: c.fields?.expiresAt,
            currentVersion: 1,
            modifiedBy: user._id,
            contentUpdatedAt: new Date(),
        })) as FileDoc;
        await quota.addFile(user._id);
        activity.record(file._id, user._id, 'upload', c.req, { size: file.size, provider: stored.storageType });
        webhooks.emit('file.uploaded', file.uploadedBy, { fileId: String(file._id), name: file.originalName, size: file.size, mimetype: file.mimetype });
    }

    if (file.category === 'image' && cfg.ENABLE_IMAGE_PROCESSING && user.preferences?.autoProcessImages !== false) {
        await generateThumbnail(file, user).catch((e) => logger.warn('thumbnail not generated', { fileId: String(file._id), err: (e as Error).message }));
    }
    logger.upload('File stored', { fileId: String(file._id), size: file.size, provider: file.storageType });
    return (await File.findById(file._id)) as FileDoc;
}

export async function ingest(input: IngestInput): Promise<FileDoc> {
    const { user, source, versionOf } = input;
    const name = sanitizeFilename(input.originalName);
    if (input.size > cfg.MAX_FILE_SIZE) throw new AppError(`File too large. Maximum size: ${(cfg.MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB`, 413, 'too_large');

    const head = 'buffer' in source ? source.buffer.subarray(0, 4100) : await readHead(source.path);
    const type = input.trustedMime ? { mimetype: input.trustedMime, detected: true } : await resolveMime(head, input.declaredMime, name);

    // a new version of someone's file is stored in the owner's space, so the owner's quota pays for it
    const payer = versionOf ? versionOf.uploadedBy : user._id;
    let reservedHere = false;
    if (!input.reserved) {
        await quota.reserve(payer, input.size);
        reservedHere = true;
    }
    let stored: objectStore.StoredObject | undefined;
    try {
        const scanned = await scan(source, name, user);
        const meta = categoryFromMimetype(type.mimetype) === 'image' && type.mimetype !== 'image/svg+xml' ? await imageInfo(source) : {};
        const provider = versionOf ? versionOf.storageType : chooseProvider(user, input.provider);
        const fileId = versionOf?._id ?? new Types.ObjectId();
        const key = objectKey(user._id, fileId, versionOf ? `v${versionOf.currentVersion + 1}` : 'v1', name);
        stored = await objectStore.putObject({ provider, key, source, mimetype: type.mimetype, encrypt: shouldEncrypt(user), maxBytes: input.size });
        return await commit({ user, name, mimetype: type.mimetype, stored, scanned: scanned.scanned, meta, fileId, versionOf, fields: input.fields, reason: input.reason, req: input.req });
    } catch (e) {
        if (stored) await objectStore.deleteObject(stored).catch(() => undefined);
        if (reservedHere) await quota.release(payer, input.size).catch(() => undefined);
        throw e;
    }
}

export const normalizeTags = (tags?: string[]): string[] => [...new Set((tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20).map((t) => t.slice(0, 40));

/** Keeps at most MAX_FILE_VERSIONS old versions; the oldest are deleted and their space given back. */
export async function pruneVersions(file: FileDoc): Promise<void> {
    const excess = file.versions.length - cfg.MAX_FILE_VERSIONS;
    if (excess <= 0) return;
    const doomed = [...file.versions].sort((a, b) => a.versionNumber - b.versionNumber).slice(0, excess);
    for (const v of doomed) await objectStore.deleteObject({ key: v.key, storageType: file.storageType });
    await File.updateOne({ _id: file._id }, { $pull: { versions: { _id: { $in: doomed.map((v) => v._id) } } } });
    await quota.release(file.uploadedBy, doomed.reduce((n, v) => n + v.size, 0));
}

/* ----------------------------------------------------------------- variants */

/** Stores a derived image (thumbnail, resized, ...) and records it on the file. The owner's quota pays for it. */
export async function addVariant(file: FileDoc, owner: UserDoc | null, variant: { type: IFileVariant['type']; buffer: Buffer; mimetype: string; format?: string; width?: number; height?: number; label: string; ext: string }): Promise<IFileVariant> {
    const encrypt = file.isEncrypted;
    await quota.reserve(file.uploadedBy, variant.buffer.length);
    let stored: objectStore.StoredObject | undefined;
    try {
        const key = `files/${String(file.uploadedBy)}/${String(file._id)}/var-${variant.label}-${rand(4)}.${variant.ext}`;
        stored = await objectStore.putObject({ provider: file.storageType, key, source: { buffer: variant.buffer }, mimetype: variant.mimetype, encrypt });
        const entry = {
            type: variant.type,
            key: stored.key,
            size: stored.size,
            dimensions: { width: variant.width, height: variant.height },
            format: variant.format,
            location: stored.location,
            mimetype: variant.mimetype,
            isEncrypted: stored.isEncrypted,
            encryptionInfo: stored.encryptionInfo,
        };
        const updated = await File.findOneAndUpdate({ _id: file._id, deletedAt: null }, { $push: { variants: entry } }, { new: true });
        if (!updated) throw new AppError('File not found', 404);
        file.variants = updated.variants;
        void owner;
        return updated.variants[updated.variants.length - 1] as IFileVariant;
    } catch (e) {
        if (stored) await objectStore.deleteObject(stored).catch(() => undefined);
        await quota.release(file.uploadedBy, variant.buffer.length).catch(() => undefined);
        throw e;
    }
}

export async function removeVariant(file: FileDoc, variantId: string): Promise<boolean> {
    const v = file.variants.find((x) => String(x._id) === variantId);
    if (!v) return false;
    await objectStore.deleteObject({ key: v.key, storageType: file.storageType });
    await File.updateOne({ _id: file._id }, { $pull: { variants: { _id: v._id } } });
    await quota.release(file.uploadedBy, v.size);
    return true;
}

export async function generateThumbnail(file: FileDoc, owner: UserDoc | null): Promise<IFileVariant | undefined> {
    if (file.getVariant('thumbnail')) return file.getVariant('thumbnail');
    const { default: imageProcessor } = await import('../utils/imageProcessor');
    const buffer = await objectStore.readObjectBuffer(refOf(file), 30 * 1024 * 1024);
    const out = await imageProcessor.thumbnail(buffer, { width: 320, height: 320, quality: 80, format: 'jpeg' });
    return addVariant(file, owner, { type: 'thumbnail', buffer: out.buffer, mimetype: 'image/jpeg', format: 'jpeg', width: out.metadata.width, height: out.metadata.height, label: 'thumbnail', ext: 'jpg' });
}

/* ----------------------------------------------------------------- lifecycle */

export async function trash(file: FileDoc, actor: UserDoc, req?: Request): Promise<void> {
    await File.updateOne({ _id: file._id, deletedAt: null }, { $set: { deletedAt: new Date(), deletedBy: actor._id } });
    activity.record(file._id, actor._id, 'trash', req);
    webhooks.emit('file.trashed', file.uploadedBy, { fileId: String(file._id), name: file.originalName });
}

export async function restore(file: FileDoc, actor: UserDoc, req?: Request): Promise<void> {
    await File.updateOne({ _id: file._id }, { $set: { deletedAt: null }, $unset: { deletedBy: 1 } });
    activity.record(file._id, actor._id, 'restore', req);
    webhooks.emit('file.restored', file.uploadedBy, { fileId: String(file._id), name: file.originalName });
}

function purgeCdn(file: FileDoc, key = file.key): void {
    if (!cdn.isEnabled()) return;
    const url = cdn.getCdnUrl(key);
    if (url) void cdn.purgeUrls([url]).catch(() => undefined);
}

/** Deletes the file for good: every object (content, versions, variants), the record, share links, and the quota. */
export async function purge(file: FileDoc): Promise<void> {
    const targets = [{ key: file.key }, ...file.versions.map((v) => ({ key: v.key })), ...file.variants.map((v) => ({ key: v.key }))];
    for (const t of targets) await objectStore.deleteObject({ key: t.key, storageType: file.storageType });
    const removed = await File.deleteOne({ _id: file._id });
    if (removed.deletedCount) {
        await Promise.all([quota.release(file.uploadedBy, file.storedBytes()), quota.removeFile(file.uploadedBy), ShareLink.deleteMany({ file: file._id })]);
        webhooks.emit('file.deleted', file.uploadedBy, { fileId: String(file._id), name: file.originalName });
    }
    purgeCdn(file);
}

/** Swaps an older version in as the current content; the current content moves into the history (no bytes are copied). */
export async function restoreVersion(file: FileDoc, versionNumber: number, actor: UserDoc, req?: Request): Promise<FileDoc> {
    const target = file.versions.find((v) => v.versionNumber === versionNumber);
    if (!target) throw new AppError('Version not found', 404, 'not_found');
    // pipeline updates are not cast by Mongoose, so the sub-document needs its own _id
    const current: IFileVersion = {
        _id: new Types.ObjectId(),
        versionNumber: file.currentVersion,
        key: file.key,
        size: file.size,
        originalName: file.originalName,
        mimetype: file.mimetype,
        etag: file.etag,
        checksum: file.checksum,
        uploadedAt: file.contentUpdatedAt ?? file.createdAt,
        uploadedBy: file.modifiedBy ?? file.uploadedBy,
        reason: `replaced by version ${versionNumber}`,
        isEncrypted: file.isEncrypted,
        encryptionInfo: file.encryptionInfo ? { iv: file.encryptionInfo.iv, authTag: file.encryptionInfo.authTag } : undefined,
    };
    const oldVariants = file.variants.map((v) => ({ key: v.key, size: v.size, storageType: file.storageType }));
    // one atomic pipeline update: the chosen version leaves the history and the current content enters it
    const swapped = await File.findOneAndUpdate(
        { _id: file._id, currentVersion: file.currentVersion, 'versions._id': target._id, deletedAt: null },
        [
            {
                $set: {
                    versions: { $concatArrays: [{ $filter: { input: '$versions', cond: { $ne: ['$$this._id', target._id] } } }, [current]] },
                    key: target.key,
                    size: target.size,
                    mimetype: target.mimetype ?? file.mimetype,
                    category: categoryFromMimetype(target.mimetype ?? file.mimetype),
                    etag: target.etag ?? null,
                    checksum: target.checksum ?? null,
                    isEncrypted: Boolean(target.isEncrypted),
                    encryptionInfo: target.encryptionInfo ? { iv: target.encryptionInfo.iv, authTag: target.encryptionInfo.authTag } : null,
                    currentVersion: file.currentVersion + 1,
                    variants: [],
                    modifiedBy: actor._id,
                    contentUpdatedAt: new Date(),
                },
            },
        ],
        { new: true }
    );
    if (!swapped) throw new AppError('The file was changed by someone else, please try again', 409, 'conflict');
    const updated = swapped;
    await Promise.all(oldVariants.map((v) => objectStore.deleteObject(v).catch(() => undefined)));
    await quota.release(file.uploadedBy, oldVariants.reduce((n, v) => n + v.size, 0));
    const restored = updated as FileDoc;
    if (restored.category === 'image' && cfg.ENABLE_IMAGE_PROCESSING) await generateThumbnail(restored, actor).catch(() => undefined);
    activity.record(file._id, actor._id, 'version_restore', req, { from: versionNumber });
    purgeCdn(file);
    return (await File.findById(file._id)) as FileDoc;
}

export async function deleteVersion(file: FileDoc, versionNumber: number): Promise<void> {
    const target = file.versions.find((v) => v.versionNumber === versionNumber);
    if (!target) throw new AppError('Version not found', 404, 'not_found');
    await objectStore.deleteObject({ key: target.key, storageType: file.storageType });
    await File.updateOne({ _id: file._id }, { $pull: { versions: { _id: target._id } } });
    await quota.release(file.uploadedBy, target.size);
}

/* ------------------------------------------------------------------ listing */

export interface ListQuery {
    scope?: 'mine' | 'shared' | 'all' | 'trash';
    page?: number;
    limit?: number;
    category?: FileCategory;
    tag?: string;
    search?: string;
    sort?: 'createdAt' | 'updatedAt' | 'name' | 'size';
    order?: 'asc' | 'desc';
}

export async function list(user: UserDoc, q: ListQuery): Promise<{ files: FileDoc[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, Math.floor(Number(q.page) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(q.limit) || 20)));
    const uid = user._id;
    const filter: Record<string, unknown> = {};
    const scope = q.scope ?? 'mine';
    if (scope === 'trash') {
        filter.uploadedBy = uid;
        filter.deletedAt = { $ne: null };
    } else {
        filter.deletedAt = null;
        if (scope === 'shared') filter['sharedWith.user'] = uid;
        else if (scope === 'all') {
            if (user.role !== 'admin') filter.$or = [{ uploadedBy: uid }, { 'sharedWith.user': uid }];
        } else filter.uploadedBy = uid;
    }
    if (q.category) filter.category = q.category;
    if (q.tag) filter.tags = String(q.tag).toLowerCase();
    if (q.search) filter.originalName = { $regex: escapeRegex(String(q.search).slice(0, 100)), $options: 'i' };
    const sortField = { createdAt: 'createdAt', updatedAt: 'updatedAt', name: 'originalName', size: 'size' }[q.sort ?? 'createdAt'] ?? 'createdAt';
    const [files, total] = await Promise.all([
        File.find(filter)
            .sort({ [sortField]: q.order === 'asc' ? 1 : -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        File.countDocuments(filter),
    ]);
    return { files: files as FileDoc[], total, page, limit };
}

/* ---------------------------------------------------------------- serializing */

/** The JSON the API returns for a file: no storage keys, no key material. */
export async function serialize(file: FileDoc, viewer?: UserDoc | null, options: { thumbnailUrl?: boolean } = {}): Promise<Record<string, unknown>> {
    const o = file.toObject({ virtuals: false });
    const level = access.accessLevel(file, viewer);
    const thumb = file.getVariant('thumbnail');
    let thumbnailUrl: string | undefined;
    if (options.thumbnailUrl && thumb) thumbnailUrl = await objectStore.contentUrl(refOfVariant(file, thumb), { expiresIn: 600, fileId: String(file._id), variantId: String(thumb._id), inline: true });
    const { key, location, bucket, encryptionInfo, versions, variants, sharedWith, __v, ...rest } = o as Record<string, unknown>;
    void key, void location, void bucket, void encryptionInfo, void __v;
    const isOwnerOrAdmin = level >= access.LEVEL.admin;
    return {
        ...rest,
        permission: access.permissionName(level),
        provider: file.storageType,
        variants: (variants as Array<Record<string, unknown>>).map((v) => ({ id: String(v._id), type: v.type, size: v.size, dimensions: v.dimensions, format: v.format, mimetype: v.mimetype })),
        versions: (versions as Array<Record<string, unknown>>).map((v) => ({ id: String(v._id), versionNumber: v.versionNumber, size: v.size, mimetype: v.mimetype, uploadedAt: v.uploadedAt, uploadedBy: v.uploadedBy, reason: v.reason })),
        sharedWith: isOwnerOrAdmin ? (sharedWith as unknown[]) : undefined,
        sharedWithCount: Array.isArray(sharedWith) ? sharedWith.length : 0,
        ...(thumbnailUrl && { thumbnailUrl }),
        ...(cfg.CDN_URL && file.isPublic && !file.isEncrypted && cdn.getCdnUrl(file.key) ? { cdnUrl: cdn.getCdnUrl(file.key) } : {}),
    };
}
