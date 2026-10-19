/**
 * Direct uploads: the client sends the bytes straight to the storage provider with a presigned URL (the API server
 * never carries them), then confirms. Confirmation is where the file is actually checked: size, real content type,
 * malware; a file that fails is deleted from the provider and the reserved quota is returned.
 *
 * Direct uploads are not available when files must be encrypted at rest (the provider would receive plain bytes).
 */
import crypto from 'crypto';
import type { Request } from 'express';
import sharp from 'sharp';
import { getPresignedUploadUrl } from '../config/s3';
import cfg from '../config/env';
import logger from '../config/logger';
import File from '../models/File';
import PendingUpload from '../models/PendingUpload';
import type { FileDoc, PendingUploadDoc, UserDoc } from '../types/models';
import AppError from '../utils/appError';
import { categoryFromMimetype, keySafe, sanitizeFilename } from '../utils/files';
import { isAllowed, resolveMime } from '../utils/mime';
import virusScanner from '../utils/virusScanner';
import { shouldEncrypt } from './encryption.service';
import * as fileService from './file.service';
import { metrics } from './metrics.service';
import * as objectStore from './objectStore.service';
import * as quota from './quota.service';
import { getStorage } from './storage/registry';
import * as webhooks from './webhook.service';

const TTL_SECONDS = 15 * 60;

export interface IntentInput {
    filename: string;
    contentType: string;
    size: number;
    provider?: string;
    versionOf?: FileDoc;
}

export async function createIntent(user: UserDoc, input: IntentInput): Promise<{ pending: PendingUploadDoc; url: string; headers: Record<string, string> }> {
    if (shouldEncrypt(user)) throw new AppError('Direct uploads are not available while encryption at rest is on; use POST /api/files/upload or the chunked upload', 409, 'encryption_required');
    if (!Number.isFinite(input.size) || input.size <= 0) throw new AppError('size must be a positive number of bytes', 400);
    if (input.size > cfg.MAX_FILE_SIZE) throw new AppError(`File too large. Maximum size: ${(cfg.MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB`, 413, 'too_large');
    if (!isAllowed(input.contentType)) throw new AppError(`File type ${input.contentType} is not allowed`, 415, 'unsupported_media_type');

    const name = sanitizeFilename(input.filename);
    const provider = input.versionOf ? input.versionOf.storageType : fileService.chooseProvider(user, input.provider);
    const key = `uploads/${String(user._id)}/${crypto.randomBytes(8).toString('hex')}${keySafe(name)}`;

    const quotaUser = input.versionOf ? input.versionOf.uploadedBy : user._id;
    await quota.reserve(quotaUser, input.size);
    try {
        const url = await getPresignedUploadUrl(key, input.contentType, TTL_SECONDS, { provider, size: input.size });
        const pending = await PendingUpload.create({ user: user._id, key, storageType: provider, filename: name, mimetype: input.contentType, size: input.size, versionOf: input.versionOf?._id, quotaUser, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000) });
        return { pending, url, headers: getStorage(provider).uploadHeaders(input.contentType) };
    } catch (e) {
        await quota.release(quotaUser, input.size);
        throw e;
    }
}

export const expiresIn = TTL_SECONDS;

async function reject(pending: PendingUploadDoc, reason: string, status: 'rejected' | 'expired' = 'rejected'): Promise<void> {
    const provider = getStorage(pending.storageType);
    await provider.delete(pending.key).catch(() => undefined);
    await quota.release(pending.quotaUser ?? pending.user, pending.size);
    await PendingUpload.updateOne({ _id: pending._id }, { $set: { status } });
    logger.warn('Direct upload rejected', { key: pending.key, reason });
}

/** Janitor: an upload that was never confirmed. */
export async function expire(pending: PendingUploadDoc): Promise<void> {
    await reject(pending, 'not confirmed in time', 'expired');
}

export async function confirm(user: UserDoc, pendingId: string, req?: Request): Promise<FileDoc> {
    const pending = (await PendingUpload.findOne({ _id: pendingId, user: user._id, status: 'pending' })) as PendingUploadDoc | null;
    if (!pending) throw new AppError('Upload not found or already confirmed', 404, 'not_found');
    const provider = getStorage(pending.storageType);

    const head = await provider.head(pending.key);
    if (!head) throw new AppError('The upload has not arrived at the storage provider yet', 409, 'not_uploaded');
    if (head.size > pending.size) {
        await reject(pending, `${head.size} bytes uploaded, ${pending.size} announced`);
        throw new AppError('The uploaded file is larger than announced and was removed', 422, 'size_mismatch');
    }
    if (head.size === 0) {
        await reject(pending, 'empty upload');
        throw new AppError('The uploaded file is empty', 422, 'empty');
    }

    // claim: a second confirm of the same upload finds nothing
    const claimed = await PendingUpload.findOneAndUpdate({ _id: pending._id, status: 'pending' }, { $set: { status: 'confirmed' } });
    if (!claimed) throw new AppError('Upload not found or already confirmed', 404, 'not_found');

    try {
        const first = await provider.get(pending.key, { range: { start: 0, end: 4099 } });
        const chunks: Buffer[] = [];
        for await (const c of first.stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
        const type = await resolveMime(Buffer.concat(chunks), pending.mimetype, pending.filename);

        let scanned = false;
        if (virusScanner.enabled) {
            const { stream } = await provider.get(pending.key);
            const result = await virusScanner.scanStream(stream);
            if (!result.skipped) {
                if (!result.clean) {
                    metrics.virusDetected();
                    webhooks.emit('file.infected', user._id, { name: pending.filename, viruses: result.viruses });
                    throw new AppError(`The file was rejected: it contains malware (${result.viruses.join(', ')})`, 422, 'infected');
                }
                scanned = true;
            }
        }

        let meta: { width?: number; height?: number; format?: string } = {};
        if (categoryFromMimetype(type.mimetype) === 'image' && head.size <= 30 * 1024 * 1024) {
            try {
                const buffer = await objectStore.readObjectBuffer({ key: pending.key, storageType: pending.storageType, size: head.size, mimetype: type.mimetype }, 30 * 1024 * 1024);
                const m = await sharp(buffer, { limitInputPixels: 100_000_000, failOn: 'error' }).metadata();
                meta = { width: m.width, height: m.height, format: m.format };
            } catch {
                throw new AppError('The file is not a valid image', 415, 'unsupported_media_type');
            }
        }

        const versionOf = pending.versionOf ? await File.findById(pending.versionOf) : null;
        const file = await fileService.commit({
            user,
            name: pending.filename,
            mimetype: type.mimetype,
            stored: { key: pending.key, storageType: pending.storageType, size: head.size, etag: head.etag, location: provider.location(pending.key), bucket: provider.bucket, isEncrypted: false },
            scanned,
            meta,
            versionOf: (versionOf as FileDoc | null) ?? undefined,
            req,
        });
        // the announced size was reserved; keep only what was actually uploaded
        if (head.size < pending.size) await quota.release(pending.quotaUser ?? user._id, pending.size - head.size);
        return file;
    } catch (e) {
        await provider.delete(pending.key).catch(() => undefined);
        await quota.release(pending.quotaUser ?? user._id, pending.size).catch(() => undefined);
        await PendingUpload.updateOne({ _id: pending._id }, { $set: { status: 'rejected' } });
        metrics.uploadRejected(e instanceof AppError ? e.code ?? String(e.statusCode) : 'error');
        throw e;
    }
}
