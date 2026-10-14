/**
 * The object-store facade. Every upload, download, delete and presign in the application goes through these five
 * functions (named after the original S3 helpers), which route to the provider chosen for the file:
 * `provider` defaults to STORAGE_PROVIDER, and a stored file remembers its own provider in `storageType`.
 */
import type { Readable } from 'stream';
import { getStorage } from '../services/storage/registry';
import type { ByteRange, GetResult, ProviderName } from '../services/storage/types';

export interface UploadInput {
    buffer?: Buffer;
    stream?: Readable;
    mimetype?: string;
    size?: number;
}

export interface ProviderOption {
    provider?: ProviderName | string | null;
}

export interface UploadedObject {
    key: string;
    location: string;
    bucket?: string;
    etag?: string;
}

/** Stores a buffer or a stream under `key`. */
export async function uploadToS3(file: UploadInput, key: string, options: ProviderOption & { metadata?: Record<string, string> } = {}): Promise<UploadedObject> {
    const body = file.stream ?? file.buffer;
    if (!body) throw new Error('uploadToS3 needs a buffer or a stream');
    const out = await getStorage(options.provider).put(key, body, { contentType: file.mimetype, size: file.size ?? file.buffer?.length, metadata: options.metadata });
    return { key: out.key, location: out.location, bucket: out.bucket, etag: out.etag };
}

/** Reads an object. `Body` is a stream. */
export async function getFromS3(key: string, options: ProviderOption & { range?: ByteRange } = {}): Promise<{ Body: Readable } & Omit<GetResult, 'stream'>> {
    const { stream, ...rest } = await getStorage(options.provider).get(key, { range: options.range });
    return { Body: stream, ...rest };
}

export async function deleteFromS3(key: string, options: ProviderOption = {}): Promise<void> {
    await getStorage(options.provider).delete(key);
}

/** A time-limited download URL. */
export function getPresignedUrl(key: string, expiresIn = 3600, options: ProviderOption & { filename?: string; contentType?: string; inline?: boolean } = {}): Promise<string> {
    return getStorage(options.provider).presignDownload(key, { expiresIn, filename: options.filename, contentType: options.contentType, inline: options.inline });
}

/** A time-limited URL for uploading straight to the provider (the headers to send come from `provider.uploadHeaders`). */
export async function getPresignedUploadUrl(key: string, contentType: string, expiresIn = 3600, options: ProviderOption & { size?: number } = {}): Promise<string> {
    return (await getStorage(options.provider).presignUpload(key, { expiresIn, contentType, size: options.size })).url;
}
