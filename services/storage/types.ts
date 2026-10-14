import type { Readable } from 'stream';
import type { ProviderName } from '../../types/models';

export type { ProviderName };

export interface PutOptions {
    contentType?: string;
    /** Known size in bytes (lets providers choose single-request or multipart upload). */
    size?: number;
    metadata?: Record<string, string>;
}

export interface PutResult {
    key: string;
    size?: number;
    etag?: string;
    location: string;
    bucket?: string;
}

export interface ByteRange {
    start: number;
    /** Inclusive; omitted = to the end. */
    end?: number;
}

export interface GetResult {
    stream: Readable;
    /** Size of the whole object. */
    size: number;
    /** Bytes in `stream` (differs from `size` for a range). */
    contentLength: number;
    contentType?: string;
    etag?: string;
    range?: { start: number; end: number };
}

export interface HeadResult {
    size: number;
    contentType?: string;
    etag?: string;
    lastModified?: Date;
}

export interface ListItem {
    key: string;
    size: number;
    lastModified?: Date;
}

export interface ListResult {
    items: ListItem[];
    nextCursor?: string;
}

export interface PresignDownloadOptions {
    expiresIn: number;
    filename?: string;
    contentType?: string;
    inline?: boolean;
}

export interface PresignUploadOptions {
    expiresIn: number;
    contentType: string;
    size?: number;
}

export interface PresignedUpload {
    url: string;
    method: 'PUT';
    /** Headers the client must send with the upload request. */
    headers: Record<string, string>;
}

/** What the rest of the application needs from an object store. Keys are opaque strings made by this service. */
export interface StorageProvider {
    readonly name: ProviderName;
    readonly bucket?: string;
    put(key: string, body: Readable | Buffer, options?: PutOptions): Promise<PutResult>;
    /** Throws ObjectNotFoundError when the key does not exist. */
    get(key: string, options?: { range?: ByteRange }): Promise<GetResult>;
    head(key: string): Promise<HeadResult | null>;
    /** Idempotent: deleting a missing key is not an error. */
    delete(key: string): Promise<void>;
    list(prefix: string, options?: { limit?: number; cursor?: string }): Promise<ListResult>;
    presignDownload(key: string, options: PresignDownloadOptions): Promise<string>;
    presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload>;
    /** Headers a client must send with a presigned upload (pure; no network). */
    uploadHeaders(contentType: string): Record<string, string>;
    /** Prepares the store at startup (creates the directory / container when missing). */
    init?(): Promise<void>;
    /** Throws when the store cannot be reached. */
    ping(): Promise<void>;
    location(key: string): string;
    /** The same provider pointed at another bucket / container (administration). */
    withBucket?(bucket: string): StorageProvider;
}

/** Bucket (or container) level administration, available on the cloud providers. */
export interface BucketAdmin {
    listBuckets(): Promise<string[]>;
    createBucket(name: string): Promise<void>;
    deleteBucket(name: string): Promise<void>;
    bucketExists(name: string): Promise<boolean>;
}

export class ObjectNotFoundError extends Error {
    constructor(key: string) {
        super(`Object not found: ${key}`);
        this.name = 'ObjectNotFoundError';
    }
}

export const isBucketAdmin = (p: unknown): p is StorageProvider & BucketAdmin => typeof (p as BucketAdmin)?.listBuckets === 'function';

/** `Content-Disposition` value that is safe for any file name (RFC 6266 / 5987). */
export function contentDisposition(filename: string | undefined, inline: boolean): string {
    const kind = inline ? 'inline' : 'attachment';
    if (!filename) return kind;
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_').slice(0, 200);
    return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
