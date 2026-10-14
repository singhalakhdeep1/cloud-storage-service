/**
 * Resumable (chunked) uploads. A client opens a session, sends numbered chunks in any order (and re-sends the ones
 * that failed), then asks for completion. Chunks live in the provider under `chunks/<uploadId>/<n>`, the quota for the
 * whole file is reserved when the session opens, and completion assembles the chunks on disk, so the finished file goes
 * through the same checks (type, malware, size, encryption) as any other upload.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import type { Request } from 'express';
import { deleteFromS3, getFromS3, uploadToS3 } from '../config/s3';
import cfg from '../config/env';
import logger from '../config/logger';
import File from '../models/File';
import UploadSession from '../models/UploadSession';
import type { FileDoc, ProviderName, UploadSessionDoc, UserDoc } from '../types/models';
import AppError from '../utils/appError';
import { sanitizeFilename } from '../utils/files';
import { isAllowed } from '../utils/mime';
import * as fileService from './file.service';
import * as quota from './quota.service';

const MAX_CHUNKS = 10_000;
const ACCEPTING = ['pending', 'uploading', 'paused'];

export interface InitInput {
    filename: string;
    originalName: string;
    mimeType: string;
    totalSize: number;
    chunkSize?: number;
    provider?: string;
    /** Upload a new version of this file instead of a new file. */
    versionOf?: FileDoc;
    tags?: string[];
}

export async function init(user: UserDoc, input: InitInput): Promise<UploadSessionDoc> {
    if (!cfg.ENABLE_CHUNKED_UPLOAD) throw new AppError('Chunked uploads are disabled', 404, 'disabled');
    const { totalSize } = input;
    if (!Number.isFinite(totalSize) || totalSize <= 0) throw new AppError('totalSize must be a positive number of bytes', 400);
    if (totalSize > cfg.MAX_FILE_SIZE) throw new AppError(`File too large. Maximum size: ${(cfg.MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB`, 413, 'too_large');
    const chunkSize = input.chunkSize ?? 5 * 1024 * 1024;
    if (chunkSize < 1024 || chunkSize > cfg.MAX_CHUNK_SIZE) throw new AppError(`chunkSize must be between 1024 and ${cfg.MAX_CHUNK_SIZE} bytes`, 400);
    const totalChunks = Math.ceil(totalSize / chunkSize);
    if (totalChunks > MAX_CHUNKS) throw new AppError(`Too many chunks (${totalChunks}); use a larger chunkSize`, 400);
    // fail early on a type that would be refused at the end anyway (the content is checked again on completion)
    if (!isAllowed(input.mimeType)) throw new AppError(`File type ${input.mimeType} is not allowed`, 415, 'unsupported_media_type');

    const storageType = input.versionOf ? input.versionOf.storageType : fileService.chooseProvider(user, input.provider);
    const quotaUser = input.versionOf ? input.versionOf.uploadedBy : user._id;
    await quota.reserve(quotaUser, totalSize);
    try {
        return await UploadSession.create({
            user: user._id,
            filename: sanitizeFilename(input.filename),
            originalName: sanitizeFilename(input.originalName),
            mimeType: input.mimeType,
            totalSize,
            chunkSize,
            totalChunks,
            uploadId: crypto.randomUUID(),
            storageType,
            reservedBytes: totalSize,
            quotaUser,
            versionOf: input.versionOf?._id,
            status: 'pending',
        });
    } catch (e) {
        await quota.release(quotaUser, totalSize);
        throw e;
    }
}

/** The caller's session, or 404 (other people's sessions are not revealed). */
export async function findOwned(uploadId: string, user: UserDoc): Promise<UploadSessionDoc> {
    const session = await UploadSession.findOne({ uploadId, user: user._id });
    if (!session) throw new AppError('Upload session not found', 404, 'not_found');
    return session as UploadSessionDoc;
}

const chunkKey = (session: UploadSessionDoc, n: number): string => `chunks/${session.uploadId}/${String(n).padStart(6, '0')}`;
const providerOf = (session: UploadSessionDoc): ProviderName | undefined => session.storageType;

export async function uploadChunk(session: UploadSessionDoc, chunkNumber: number, data: Buffer, checksum?: string): Promise<UploadSessionDoc> {
    if (!Number.isInteger(chunkNumber) || chunkNumber < 0 || chunkNumber >= session.totalChunks) throw new AppError(`chunkNumber must be between 0 and ${session.totalChunks - 1}`, 400);
    if (!ACCEPTING.includes(session.status)) throw new AppError(session.status === 'completed' ? 'Upload already completed' : `Upload is ${session.status}`, session.status === 'completed' ? 400 : 409, 'not_accepting');
    if (session.expiresAt.getTime() < Date.now()) throw new AppError('Upload session has expired', 410, 'expired');

    const expected = chunkNumber < session.totalChunks - 1 ? session.chunkSize : session.totalSize - session.chunkSize * (session.totalChunks - 1);
    if (data.length === 0 || data.length > expected) throw new AppError(`Chunk ${chunkNumber} must be at most ${expected} bytes (got ${data.length})`, 400, 'bad_chunk_size');
    if (checksum && crypto.createHash('sha256').update(data).digest('hex') !== checksum.toLowerCase()) throw new AppError(`Chunk ${chunkNumber} is corrupted (checksum mismatch), send it again`, 422, 'checksum_mismatch');

    const key = chunkKey(session, chunkNumber);
    await uploadToS3({ buffer: data, mimetype: 'application/octet-stream', size: data.length }, key, { provider: providerOf(session) });
    const updated = await session.addChunk(chunkNumber, key, data.length);
    if (!updated) {
        await deleteFromS3(key, { provider: providerOf(session) }).catch(() => undefined);
        throw new AppError('Upload is no longer accepting chunks', 409, 'not_accepting');
    }
    return updated as UploadSessionDoc;
}

async function deleteChunks(session: UploadSessionDoc): Promise<void> {
    for (const c of session.chunkKeys) await deleteFromS3(c.key, { provider: providerOf(session) }).catch((e: Error) => logger.warn('chunk not deleted', { key: c.key, err: e.message }));
}

/** Writes the chunks, in order, into one temporary file. */
async function assemble(session: UploadSessionDoc): Promise<string> {
    const target = path.join(os.tmpdir(), `cloud-storage-${session.uploadId}-${crypto.randomBytes(4).toString('hex')}`);
    const out = fs.createWriteStream(target);
    let failure: Error | undefined;
    out.on('error', (e) => (failure = e));
    try {
        for (const c of [...session.chunkKeys].sort((a, b) => a.chunkNumber - b.chunkNumber)) {
            const { Body } = await getFromS3(c.key, { provider: providerOf(session) });
            const source: Readable = Buffer.isBuffer(Body) ? Readable.from([Body]) : Body;
            await new Promise<void>((resolve, reject) => {
                source.once('error', reject);
                source.once('end', resolve);
                out.once('error', reject);
                source.pipe(out, { end: false });
            });
            if (failure) throw failure;
        }
        await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
        return target;
    } catch (e) {
        out.destroy();
        await fs.promises.rm(target, { force: true });
        throw e;
    }
}

async function finish(session: UploadSessionDoc, status: 'completed' | 'failed' | 'cancelled' | 'expired', extra: Record<string, unknown> = {}): Promise<void> {
    await UploadSession.updateOne({ _id: session._id }, { $set: { status, finishedAt: new Date(), ...extra } });
}

export async function complete(session: UploadSessionDoc, user: UserDoc, req?: Request): Promise<FileDoc> {
    if (session.status === 'completed' && session.fileId) {
        const done = await File.findById(session.fileId);
        if (done) return done as FileDoc;
    }
    // claim the session so two completion requests cannot assemble it twice
    const claimed = await UploadSession.findOneAndUpdate({ _id: session._id, status: { $in: ACCEPTING } }, { $set: { status: 'processing' } }, { new: true });
    if (!claimed) throw new AppError(session.status === 'processing' ? 'Upload is already being completed' : `Upload is ${session.status}`, 409, 'not_accepting');
    const s = claimed as UploadSessionDoc;

    if (!s.isComplete()) {
        await UploadSession.updateOne({ _id: s._id }, { $set: { status: 'uploading' } });
        throw new AppError(`Not all chunks uploaded. Missing: ${s.getMissingChunks().slice(0, 20).join(', ')}`, 400, 'incomplete');
    }
    const recorded = s.chunkKeys.reduce((n, c) => n + c.size, 0);
    if (recorded !== s.totalSize) {
        await UploadSession.updateOne({ _id: s._id }, { $set: { status: 'uploading' } });
        throw new AppError(`The chunks add up to ${recorded} bytes but ${s.totalSize} were announced; re-send the chunks that were cut short`, 422, 'size_mismatch');
    }

    let merged: string | undefined;
    try {
        merged = await assemble(s);
        const actual = (await fs.promises.stat(merged)).size;
        if (actual !== s.totalSize) throw new AppError(`The assembled file is ${actual} bytes, expected ${s.totalSize}`, 422, 'size_mismatch');
        const versionOf = s.versionOf ? await File.findById(s.versionOf) : null;
        const file = await fileService.ingest({
            user,
            source: { path: merged },
            size: s.totalSize,
            originalName: s.originalName,
            declaredMime: s.mimeType,
            provider: s.storageType,
            reserved: true, // the quota was reserved when the session opened
            versionOf: (versionOf as FileDoc | null) ?? undefined,
            req,
        });
        await deleteChunks(s);
        await finish(s, 'completed', { fileId: file._id, reservedBytes: 0 });
        logger.upload('Chunked upload completed', { uploadId: s.uploadId, fileId: String(file._id) });
        return file;
    } catch (e) {
        // the file was refused (malware, wrong type, ...): nothing is kept and the reserved space is returned
        await deleteChunks(s);
        await quota.release(s.quotaUser ?? s.user, s.reservedBytes).catch(() => undefined);
        await finish(s, 'failed', { error: (e as Error).message, reservedBytes: 0 });
        throw e;
    } finally {
        if (merged) await fs.promises.rm(merged, { force: true });
    }
}

export async function cancel(session: UploadSessionDoc): Promise<void> {
    if (session.status === 'completed') throw new AppError('Upload already completed', 400);
    if (session.status === 'processing') throw new AppError('Upload is being completed', 409);
    await deleteChunks(session);
    await quota.release(session.quotaUser ?? session.user, session.reservedBytes);
    await finish(session, 'cancelled', { reservedBytes: 0 });
}

export async function pause(session: UploadSessionDoc): Promise<UploadSessionDoc> {
    if (!ACCEPTING.includes(session.status)) throw new AppError(`Upload is ${session.status}`, 400);
    session.status = 'paused';
    await session.save();
    return session;
}

export async function resume(session: UploadSessionDoc): Promise<UploadSessionDoc> {
    if (session.status === 'completed') throw new AppError('Upload already completed', 400);
    if (!ACCEPTING.includes(session.status)) throw new AppError(`Upload is ${session.status} and cannot be resumed`, 400);
    if (session.expiresAt.getTime() < Date.now()) throw new AppError('Upload session has expired', 410, 'expired');
    session.status = 'uploading';
    await session.save();
    return session;
}

/** Janitor: removes the chunks of a session that ran out of time and returns its reserved space. */
export async function expire(session: UploadSessionDoc): Promise<void> {
    await deleteChunks(session);
    await quota.release(session.quotaUser ?? session.user, session.reservedBytes);
    await finish(session, 'expired', { reservedBytes: 0 });
}
