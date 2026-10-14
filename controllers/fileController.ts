import fs from 'fs';
import type { Request } from 'express';
import cfg from '../config/env';
import File from '../models/File';
import FileActivity from '../models/FileActivity';
import User from '../models/User';
import { clearUserCache } from '../middleware/cache';
import * as access from '../services/access.service';
import * as activity from '../services/activity.service';
import * as direct from '../services/direct.service';
import * as fileService from '../services/file.service';
import * as objectStore from '../services/objectStore.service';
import { configuredProviders, defaultProviderName } from '../services/storage/registry';
import * as webhooks from '../services/webhook.service';
import type { FileDoc, UserDoc } from '../types/models';
import AppError from '../utils/appError';
import asyncHandler from '../utils/asyncHandler';
import { sanitizeFilename } from '../utils/files';
import imageProcessor from '../utils/imageProcessor';
import { sendObject } from '../utils/sendObject';

const me = (req: Request): UserDoc => req.user as UserDoc;
const file = (req: Request): FileDoc => req.fileDoc as FileDoc;

/** Multipart fields arrive as strings: "true", "a,b" or a JSON array. */
function uploadFields(body: Record<string, unknown>): { isPublic?: boolean; tags?: string[]; description?: string; expiresAt?: Date } {
    let tags: string[] | undefined;
    if (Array.isArray(body.tags)) tags = body.tags.map(String);
    else if (typeof body.tags === 'string' && body.tags.trim()) {
        try {
            const parsed = JSON.parse(body.tags);
            tags = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
        } catch {
            tags = body.tags.split(',');
        }
    }
    return { isPublic: body.isPublic === true || body.isPublic === 'true', tags, description: typeof body.description === 'string' && body.description ? body.description : undefined, expiresAt: body.expiresAt ? new Date(String(body.expiresAt)) : undefined };
}

const send = async (req: Request, f: FileDoc, status = 200) => ({ status, body: { success: true, data: await fileService.serialize(f, me(req), { thumbnailUrl: true }) } });

// @desc    Upload a file
// @route   POST /api/files/upload
export const uploadFile = asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Please upload a file (multipart field "file")', 400);
    const created = await fileService.ingest({
        user: me(req),
        source: { path: req.file.path },
        size: req.file.size,
        originalName: req.file.originalname,
        declaredMime: req.file.mimetype,
        provider: (req.body as { provider?: string }).provider,
        fields: uploadFields(req.body),
        req,
    });
    await clearUserCache(me(req)._id);
    const r = await send(req, created, 201);
    res.status(r.status).json(r.body);
});

// @desc    Upload an image, scaled down to at most 1920x1080 (same format, no enlargement)
// @route   POST /api/files/upload-image
export const uploadImage = asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Please upload an image (multipart field "image")', 400);
    const original = await fs.promises.readFile(req.file.path);
    const info = await imageProcessor.validate(original);
    if (!info.valid) throw new AppError(info.error ?? 'Invalid image', 415, 'unsupported_media_type');
    const animated = info.metadata?.format === 'gif';
    let source: { buffer: Buffer } | { path: string } = { path: req.file.path };
    let size = req.file.size;
    let declared = req.file.mimetype;
    if (!animated) {
        const out = await imageProcessor.resize(original, { width: 1920, height: 1080, fit: 'inside', quality: 85 });
        source = { buffer: out.buffer };
        size = out.buffer.length;
        declared = out.mimetype;
    }
    const created = await fileService.ingest({ user: me(req), source, size, originalName: req.file.originalname, declaredMime: declared, provider: (req.body as { provider?: string }).provider, fields: uploadFields(req.body), req });
    await File.updateOne({ _id: created._id }, { $set: { 'metadata.compressed': !animated } });
    await clearUserCache(me(req)._id);
    const r = await send(req, (await File.findById(created._id)) as FileDoc, 201);
    res.status(r.status).json(r.body);
});

// @desc    Upload up to 10 files at once
// @route   POST /api/files/upload-multiple
export const uploadMultiple = asyncHandler(async (req, res) => {
    const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
    if (!files.length) throw new AppError('Please upload files (multipart field "files")', 400);
    const done: Record<string, unknown>[] = [];
    const failed: { name: string; error: string; code?: string }[] = [];
    // one after the other: each file reserves its own space, so the quota check stays exact
    for (const f of files) {
        try {
            const created = await fileService.ingest({ user: me(req), source: { path: f.path }, size: f.size, originalName: f.originalname, declaredMime: f.mimetype, provider: (req.body as { provider?: string }).provider, fields: uploadFields(req.body), req });
            done.push(await fileService.serialize(created, me(req), { thumbnailUrl: true }));
        } catch (e) {
            failed.push({ name: f.originalname, error: (e as Error).message, code: e instanceof AppError ? e.code : undefined });
        }
    }
    await clearUserCache(me(req)._id);
    if (!done.length) throw new AppError(failed[0]?.error ?? 'Upload failed', 400, failed[0]?.code);
    res.status(201).json({ success: true, count: done.length, data: done, ...(failed.length && { failed }) });
});

// @desc    Presigned upload URL: the client sends the bytes straight to the storage provider, then confirms
// @route   POST /api/files/presigned-url
export const getPresignedUploadURL = asyncHandler(async (req, res) => {
    const body = req.body as { filename: string; contentType?: string; mimetype?: string; size: number; provider?: string; versionOf?: string };
    let versionOf: FileDoc | undefined;
    if (body.versionOf) {
        versionOf = (await File.findById(body.versionOf)) as FileDoc | undefined;
        if (!versionOf || versionOf.deletedAt) throw new AppError('File not found', 404, 'not_found');
        if (!access.can(versionOf, me(req), 'write')) throw new AppError('You need write permission for this file', 403, 'forbidden');
    }
    const intent = await direct.createIntent(me(req), { filename: body.filename, contentType: (body.contentType ?? body.mimetype) as string, size: body.size, provider: body.provider, versionOf });
    res.status(200).json({ success: true, url: intent.url, key: intent.pending.key, uploadId: String(intent.pending._id), method: 'PUT', headers: intent.headers, expiresIn: direct.expiresIn });
});

// @desc    Finish a direct upload: the file is checked and recorded
// @route   POST /api/files/confirm-upload
export const confirmUpload = asyncHandler(async (req, res) => {
    const created = await direct.confirm(me(req), (req.body as { uploadId: string }).uploadId, req);
    await clearUserCache(me(req)._id);
    const r = await send(req, created, 201);
    res.status(r.status).json(r.body);
});

// @desc    Files: mine (default), shared with me, all (admin), trash
// @route   GET /api/files
export const getAllFiles = asyncHandler(async (req, res) => {
    const q = req.query as unknown as fileService.ListQuery;
    const { files, total, page, limit } = await fileService.list(me(req), q);
    const data = await Promise.all(files.map((f) => fileService.serialize(f, me(req), { thumbnailUrl: true })));
    res.status(200).json({ success: true, data: { files: data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

// @desc    What this server supports, for the web app and the SDK: configured providers, limits, encryption
// @route   GET /api/files/capabilities
export const getCapabilities = asyncHandler(async (_req, res) => {
    res.status(200).json({
        success: true,
        data: {
            providers: configuredProviders(),
            defaultProvider: defaultProviderName(),
            maxFileSize: cfg.MAX_FILE_SIZE,
            maxChunkSize: cfg.MAX_CHUNK_SIZE,
            chunkedUploads: cfg.ENABLE_CHUNKED_UPLOAD,
            maxFileVersions: cfg.MAX_FILE_VERSIONS,
            trashRetentionDays: cfg.TRASH_RETENTION_DAYS,
            encryption: { available: Boolean(cfg.ENCRYPTION_KEY), forced: cfg.ENCRYPT_AT_REST },
            virusScanning: cfg.ENABLE_VIRUS_SCAN,
            allowedTypes: cfg.ALLOWED_MIME_TYPES,
        },
    });
});

// @desc    Trash (my deleted files)
// @route   GET /api/files/trash
export const getTrash = asyncHandler(async (req, res) => {
    const { files, total, page, limit } = await fileService.list(me(req), { ...(req.query as object), scope: 'trash' } as fileService.ListQuery);
    const data = await Promise.all(files.map((f) => fileService.serialize(f, me(req))));
    res.status(200).json({ success: true, data: { files: data, retentionDays: cfg.TRASH_RETENTION_DAYS, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

// @desc    Empty the trash for good
// @route   DELETE /api/files/trash
export const emptyTrash = asyncHandler(async (req, res) => {
    const files = (await File.find({ uploadedBy: me(req)._id, deletedAt: { $ne: null } })) as FileDoc[];
    for (const f of files) await fileService.purge(f);
    await clearUserCache(me(req)._id);
    res.status(200).json({ success: true, count: files.length, message: 'Trash emptied' });
});

// @desc    Storage statistics for the signed-in user
// @route   GET /api/files/stats
export const getStats = asyncHandler(async (req, res) => {
    const user = me(req);
    const match = { uploadedBy: user._id, deletedAt: null };
    const [breakdown, trashed, fresh] = await Promise.all([
        File.aggregate<{ _id: string; count: number; size: number }>([{ $match: match }, { $group: { _id: '$category', count: { $sum: 1 }, size: { $sum: '$size' } } }, { $sort: { size: -1 } }]),
        File.countDocuments({ uploadedBy: user._id, deletedAt: { $ne: null } }),
        User.findById(user._id).select('storageUsed storageLimit'),
    ]);
    res.status(200).json({
        success: true,
        data: {
            totalFiles: breakdown.reduce((n, r) => n + r.count, 0),
            totalSize: breakdown.reduce((n, r) => n + r.size, 0),
            trashedFiles: trashed,
            storageUsed: fresh?.storageUsed ?? 0,
            storageLimit: fresh?.storageLimit ?? user.storageLimit,
            categoryBreakdown: breakdown.map((r) => ({ category: r._id, count: r.count, size: r.size })),
        },
    });
});

// @desc    One file
// @route   GET /api/files/:id
export const getFile = asyncHandler(async (req, res) => {
    const r = await send(req, file(req));
    res.status(r.status).json(r.body);
});

// @desc    Rename, tag, describe, change visibility or expiry
// @route   PATCH /api/files/:id
export const updateFile = asyncHandler(async (req, res) => {
    const f = file(req);
    const body = req.body as { name?: string; tags?: string[]; description?: string; isPublic?: boolean; accessControl?: 'private' | 'public' | 'shared'; expiresAt?: Date | null };
    const needsAdmin = body.isPublic !== undefined || body.accessControl !== undefined || body.expiresAt !== undefined;
    if (needsAdmin && (req.fileLevel ?? 0) < access.LEVEL.admin) throw new AppError('You need admin permission to change visibility or expiry', 403, 'forbidden');

    const set: Record<string, unknown> = {};
    if (body.name) {
        const name = sanitizeFilename(body.name);
        set.originalName = name;
        set.filename = name;
    }
    if (body.tags) set.tags = fileService.normalizeTags(body.tags);
    if (body.description !== undefined) set.description = body.description;
    if (body.isPublic !== undefined || body.accessControl !== undefined) {
        const makePublic = body.accessControl ? body.accessControl === 'public' : Boolean(body.isPublic);
        set.isPublic = makePublic;
        set.accessControl = makePublic ? 'public' : body.accessControl === 'shared' || f.sharedWith.length ? 'shared' : 'private';
    }
    if (body.expiresAt !== undefined) set.expiresAt = body.expiresAt;
    const updated = (await File.findByIdAndUpdate(f._id, { $set: set }, { new: true })) as FileDoc;
    activity.record(f._id, me(req)._id, 'update', req, { fields: Object.keys(set) });
    webhooks.emit('file.updated', f.uploadedBy, { fileId: String(f._id), name: updated.originalName, fields: Object.keys(set) });
    const r = await send(req, updated);
    res.status(r.status).json(r.body);
});

/** Which stored object a download request means: current content, an older version, or a variant. */
function pick(req: Request): { ref: objectStore.ObjectRef; filename: string; mimetype: string; variantId?: string; versionNumber?: number; etag?: string } {
    const f = file(req);
    const { version, variant } = req.query as { version?: string; variant?: string };
    if (variant) {
        const v = f.variants.find((x) => String(x._id) === variant);
        if (!v) throw new AppError('Variant not found', 404, 'not_found');
        const ext = (v.format === 'jpeg' ? 'jpg' : v.format) ?? 'bin';
        return { ref: fileService.refOfVariant(f, v), filename: `${f.originalName.replace(/\.[^.]+$/, '')}-${v.type}.${ext}`, mimetype: v.mimetype ?? 'application/octet-stream', variantId: String(v._id) };
    }
    if (version && Number(version) !== f.currentVersion) {
        const v = f.versions.find((x) => x.versionNumber === Number(version));
        if (!v) throw new AppError('Version not found', 404, 'not_found');
        return { ref: fileService.refOfVersion(f, v), filename: f.originalName, mimetype: v.mimetype ?? f.mimetype, versionNumber: v.versionNumber, etag: v.checksum };
    }
    return { ref: fileService.refOf(f), filename: f.originalName, mimetype: f.mimetype, etag: f.checksum };
}

// @desc    A short-lived download URL (served by the storage provider, or by this API for encrypted files)
// @route   GET /api/files/:id/download
export const downloadFile = asyncHandler(async (req, res) => {
    const f = file(req);
    const target = pick(req);
    const expiresIn = 300;
    // `?inline=1` is for previews in the browser: shown inline (when the type is safe to render) and not counted as a download
    const inline = req.query.inline === '1' || req.query.inline === 'true';
    const url = await objectStore.contentUrl(target.ref, { expiresIn, filename: target.filename, inline, fileId: String(f._id), variantId: target.variantId, versionNumber: target.versionNumber });
    if (!inline) {
        await f.incrementDownloads();
        activity.record(f._id, me(req)._id, 'download', req, target.versionNumber ? { version: target.versionNumber } : undefined);
    }
    res.status(200).json({ success: true, url, expiresIn, filename: target.filename, mimetype: target.mimetype });
});

// @desc    Stream the file through the API (supports Range requests for video and audio)
// @route   GET /api/files/:id/stream
export const streamFile = asyncHandler(async (req, res) => {
    const f = file(req);
    const target = pick(req);
    if (req.method === 'GET' && !req.headers.range) {
        await f.incrementDownloads();
        activity.record(f._id, me(req)._id, 'download', req);
    }
    await sendObject(req, res, target.ref, { filename: target.filename, mimetype: target.mimetype, inline: true, etag: target.etag });
});

// @desc    The thumbnail (made on first request when missing)
// @route   GET /api/files/:id/thumbnail
export const getThumbnail = asyncHandler(async (req, res) => {
    const f = file(req);
    if (f.category !== 'image') throw new AppError('Only images have thumbnails', 400);
    const variant = f.getVariant('thumbnail') ?? (await fileService.generateThumbnail(f, me(req)));
    if (!variant) throw new AppError('Thumbnail could not be created', 500);
    await sendObject(req, res, fileService.refOfVariant(f, variant), { filename: `${f.originalName}-thumbnail.jpg`, mimetype: variant.mimetype ?? 'image/jpeg', inline: true, maxAge: 3600 });
});

// @desc    Move to the trash
// @route   POST /api/files/:id/trash
export const trashFile = asyncHandler(async (req, res) => {
    await fileService.trash(file(req), me(req), req);
    await clearUserCache(file(req).uploadedBy);
    res.status(200).json({ success: true, message: 'File moved to trash', retentionDays: cfg.TRASH_RETENTION_DAYS });
});

// @desc    Bring a file back from the trash
// @route   POST /api/files/:id/restore
export const restoreFile = asyncHandler(async (req, res) => {
    await fileService.restore(file(req), me(req), req);
    await clearUserCache(file(req).uploadedBy);
    const fresh = (await File.findById(file(req)._id)) as FileDoc;
    res.status(200).json({ success: true, data: await fileService.serialize(fresh, me(req)) });
});

// @desc    Delete for good (content, versions, thumbnails, links, space)
// @route   DELETE /api/files/:id
export const deleteFile = asyncHandler(async (req, res) => {
    await fileService.purge(file(req));
    await clearUserCache(file(req).uploadedBy);
    res.status(200).json({ success: true, message: 'File deleted successfully' });
});

// @desc    Version history
// @route   GET /api/files/:id/versions
export const listVersions = asyncHandler(async (req, res) => {
    const f = file(req);
    const current = { id: 'current', versionNumber: f.currentVersion, size: f.size, mimetype: f.mimetype, uploadedAt: f.contentUpdatedAt ?? f.createdAt, uploadedBy: f.modifiedBy ?? f.uploadedBy, current: true };
    const old = [...f.versions].sort((a, b) => b.versionNumber - a.versionNumber).map((v) => ({ id: String(v._id), versionNumber: v.versionNumber, size: v.size, mimetype: v.mimetype, uploadedAt: v.uploadedAt, uploadedBy: v.uploadedBy, reason: v.reason, current: false }));
    res.status(200).json({ success: true, data: { maxVersions: cfg.MAX_FILE_VERSIONS, versions: [current, ...old] } });
});

// @desc    Upload new content as the next version
// @route   POST /api/files/:id/versions
export const uploadVersion = asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Please upload a file (multipart field "file")', 400);
    const f = file(req);
    const created = await fileService.ingest({
        user: me(req),
        source: { path: req.file.path },
        size: req.file.size,
        originalName: req.file.originalname,
        declaredMime: req.file.mimetype,
        versionOf: f,
        reason: typeof req.body.reason === 'string' ? req.body.reason.slice(0, 200) : undefined,
        req,
    });
    await clearUserCache(f.uploadedBy);
    const r = await send(req, created, 201);
    res.status(r.status).json(r.body);
});

// @desc    Make an older version the current content
// @route   POST /api/files/:id/versions/:version/restore
export const restoreVersion = asyncHandler(async (req, res) => {
    const restored = await fileService.restoreVersion(file(req), Number(req.params.version), me(req), req);
    await clearUserCache(file(req).uploadedBy);
    const r = await send(req, restored);
    res.status(r.status).json(r.body);
});

// @desc    Delete one old version
// @route   DELETE /api/files/:id/versions/:version
export const deleteVersion = asyncHandler(async (req, res) => {
    await fileService.deleteVersion(file(req), Number(req.params.version));
    await clearUserCache(file(req).uploadedBy);
    res.status(200).json({ success: true, message: 'Version deleted' });
});

// @desc    Who did what to this file
// @route   GET /api/files/:id/activity
export const getActivity = asyncHandler(async (req, res) => {
    const rows = await FileActivity.find({ file: file(req)._id }).sort({ createdAt: -1 }).limit(100).lean();
    const users = await User.find({ _id: { $in: rows.map((r) => r.actor).filter(Boolean) } }).select('name email');
    const names = new Map(users.map((u) => [String(u._id), u.name]));
    res.status(200).json({ success: true, data: rows.map((r) => ({ id: String(r._id), action: r.action, actor: r.actor ? { id: String(r.actor), name: names.get(String(r.actor)) } : null, ip: r.ip, details: r.details, createdAt: r.createdAt })) });
});
