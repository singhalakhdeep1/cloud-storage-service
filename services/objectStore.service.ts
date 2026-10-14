/**
 * Application-level object access: hashing, encryption at rest and download URLs on top of the storage providers.
 * Everything that reads or writes file content goes through here, so encryption cannot be forgotten on one path.
 */
import crypto from 'crypto';
import fs from 'fs';
import { PassThrough, Readable, Transform, pipeline } from 'stream';
import { deleteFromS3, getFromS3, getPresignedUrl, uploadToS3 } from '../config/s3';
import cfg from '../config/env';
import type { EncryptionInfo, ProviderName } from '../types/models';
import AppError from '../utils/appError';
import { signToken } from '../utils/crypto';
import { createDecryptStream, createEncryptStream } from './encryption.service';
import { ObjectNotFoundError, type ByteRange } from './storage/types';

/** What is needed to find and read one stored object. */
export interface ObjectRef {
    key: string;
    storageType: ProviderName;
    /** Size of the plain content. */
    size: number;
    mimetype: string;
    isEncrypted?: boolean;
    encryptionInfo?: EncryptionInfo;
}

export interface StoredObject {
    key: string;
    storageType: ProviderName;
    /** Size of the plain content. */
    size: number;
    etag?: string;
    /** SHA-256 of the plain content. */
    checksum: string;
    location: string;
    bucket?: string;
    isEncrypted: boolean;
    encryptionInfo?: EncryptionInfo;
}

export type ObjectSource = { buffer: Buffer } | { path: string } | { stream: Readable };

/** Counts bytes and hashes the plain content as it passes through. */
function meter(): { stream: Transform; result(): { size: number; checksum: string } } {
    const hash = crypto.createHash('sha256');
    let size = 0;
    const stream = new Transform({
        transform(chunk: Buffer, _enc, cb) {
            size += chunk.length;
            hash.update(chunk);
            cb(null, chunk);
        },
    });
    return { stream, result: () => ({ size, checksum: hash.digest('hex') }) };
}

export async function putObject(opts: { provider: ProviderName; key: string; source: ObjectSource; mimetype: string; encrypt?: boolean; maxBytes?: number }): Promise<StoredObject> {
    const { provider, key, source, mimetype, encrypt = false, maxBytes } = opts;

    // A small plain buffer is one request: no stream machinery needed.
    if ('buffer' in source && !encrypt) {
        const out = await uploadToS3({ buffer: source.buffer, mimetype, size: source.buffer.length }, key, { provider });
        return { key: out.key, storageType: provider, size: source.buffer.length, etag: out.etag, checksum: crypto.createHash('sha256').update(source.buffer).digest('hex'), location: out.location, bucket: out.bucket, isEncrypted: false };
    }

    const input: Readable = 'buffer' in source ? Readable.from([source.buffer]) : 'path' in source ? fs.createReadStream(source.path) : source.stream;
    const m = meter();
    let limited = 0;
    const limit = new Transform({
        transform(chunk: Buffer, _enc, cb) {
            limited += chunk.length;
            if (maxBytes !== undefined && limited > maxBytes) cb(new AppError('File is larger than declared', 413, 'size_mismatch'));
            else cb(null, chunk);
        },
    });
    const enc = encrypt ? createEncryptStream() : null;
    const out = new PassThrough();
    const stages: (Readable | Transform)[] = enc ? [input, limit, m.stream, enc.stream, out] : [input, limit, m.stream, out];
    // pipeline() forwards a failure of any stage to the uploader (it sees the stream error and aborts the upload)
    pipeline(stages as [Readable, ...Transform[]], (err) => {
        if (err) out.destroy(err);
    });
    const stored = await uploadToS3({ stream: out, mimetype }, key, { provider });
    const { size, checksum } = m.result();
    return { key: stored.key, storageType: provider, size, etag: stored.etag, checksum, location: stored.location, bucket: stored.bucket, isEncrypted: Boolean(enc), encryptionInfo: enc?.info() };
}

export interface ReadResult {
    stream: Readable;
    size: number;
    contentLength: number;
    range?: { start: number; end: number };
}

/** Streams the plain content (decrypting when needed). Encrypted objects cannot be range-read. */
export async function readObject(ref: ObjectRef, options: { range?: ByteRange } = {}): Promise<ReadResult> {
    if (ref.isEncrypted) {
        if (!ref.encryptionInfo) throw new AppError('Encrypted file is missing its key material', 500);
        const { Body } = await getFromS3(ref.key, { provider: ref.storageType });
        const decipher = createDecryptStream(ref.encryptionInfo);
        const out = new PassThrough();
        pipeline(Body, decipher, out, () => undefined);
        return { stream: out, size: ref.size, contentLength: ref.size };
    }
    const r = await getFromS3(ref.key, { provider: ref.storageType, range: options.range });
    const body = Buffer.isBuffer(r.Body) ? Readable.from([r.Body]) : r.Body;
    // callers (and some mocks) may not report a size; fall back to what the database knows
    return { stream: body, size: r.size ?? ref.size, contentLength: r.contentLength ?? ref.size, range: r.range };
}

/** Reads the whole plain content into memory (image processing). Refuses objects above `maxBytes`. */
export async function readObjectBuffer(ref: ObjectRef, maxBytes = 50 * 1024 * 1024): Promise<Buffer> {
    if (ref.size > maxBytes) throw new AppError('File is too large to process', 413, 'too_large_to_process');
    const { stream } = await readObject(ref);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += b.length;
        if (total > maxBytes) throw new AppError('File is too large to process', 413, 'too_large_to_process');
        chunks.push(b);
    }
    return Buffer.concat(chunks);
}

/** Deletes an object; a missing object is fine. */
export async function deleteObject(ref: Pick<ObjectRef, 'key' | 'storageType'>): Promise<void> {
    try {
        await deleteFromS3(ref.key, { provider: ref.storageType });
    } catch (e) {
        if (!(e instanceof ObjectNotFoundError)) throw e;
    }
}

export interface UrlOptions {
    expiresIn?: number;
    filename?: string;
    inline?: boolean;
    /** The file this object belongs to (needed for encrypted objects, which are served through this API). */
    fileId?: string;
    variantId?: string;
    versionNumber?: number;
}

/**
 * A time-limited URL for the content. Plain objects get the provider's own presigned URL (the bytes never pass through
 * this server); encrypted objects get a signed link to this API, which decrypts while streaming.
 */
export async function contentUrl(ref: ObjectRef, options: UrlOptions = {}): Promise<string> {
    const expiresIn = options.expiresIn ?? 300;
    if (ref.isEncrypted) {
        if (!options.fileId) throw new Error('fileId is required for encrypted content links');
        const token = signToken({ t: 'content', f: options.fileId, var: options.variantId, ver: options.versionNumber, fn: options.filename, inl: options.inline ? 1 : 0 }, expiresIn);
        return `${cfg.PUBLIC_URL}/api/content/${encodeURIComponent(token)}`;
    }
    return getPresignedUrl(ref.key, expiresIn, { provider: ref.storageType, filename: options.filename, contentType: ref.mimetype, inline: options.inline });
}
