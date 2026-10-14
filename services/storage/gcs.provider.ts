/** Google Cloud Storage (service-account key file, or application default credentials). */
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { Storage } from '@google-cloud/storage';
import {
    ObjectNotFoundError,
    type BucketAdmin,
    type ByteRange,
    type GetResult,
    type HeadResult,
    type ListResult,
    type PresignDownloadOptions,
    type PresignUploadOptions,
    type PresignedUpload,
    type PutOptions,
    type PutResult,
    type StorageProvider,
    contentDisposition,
} from './types';

export interface GcsOptions {
    bucket: string;
    projectId?: string;
    keyFilename?: string;
    /** Emulators and tests only. */
    apiEndpoint?: string;
}

const codeOf = (e: unknown): number | undefined => (e as { code?: number })?.code;

export class GcsProvider implements StorageProvider, BucketAdmin {
    readonly name = 'gcs' as const;
    private readonly storage: Storage;

    constructor(private readonly options: GcsOptions, shared?: Storage) {
        this.storage = shared ?? new Storage({ projectId: options.projectId, keyFilename: options.keyFilename, apiEndpoint: options.apiEndpoint, ...(options.apiEndpoint && { useAuthWithCustomEndpoint: false }) });
    }

    get bucket(): string {
        return this.options.bucket;
    }

    withBucket(bucket: string): GcsProvider {
        return new GcsProvider({ ...this.options, bucket }, this.storage);
    }

    location(key: string): string {
        return `https://storage.googleapis.com/${this.options.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
    }

    private file(key: string) {
        return this.storage.bucket(this.options.bucket).file(key);
    }

    async put(key: string, body: Readable | Buffer, options: PutOptions = {}): Promise<PutResult> {
        const file = this.file(key);
        const metadata = { contentType: options.contentType, metadata: options.metadata };
        if (Buffer.isBuffer(body)) await file.save(body, { resumable: false, contentType: options.contentType, metadata });
        else await pipeline(body, file.createWriteStream({ resumable: false, contentType: options.contentType, metadata }));
        const [meta] = await file.getMetadata();
        return { key, size: Number(meta.size), etag: meta.etag, location: this.location(key), bucket: this.options.bucket };
    }

    async get(key: string, options: { range?: ByteRange } = {}): Promise<GetResult> {
        const file = this.file(key);
        let meta;
        try {
            [meta] = await file.getMetadata();
        } catch (e) {
            if (codeOf(e) === 404) throw new ObjectNotFoundError(key);
            throw e;
        }
        const size = Number(meta.size);
        const { range } = options;
        if (!range) return { stream: file.createReadStream({ validation: false }), size, contentLength: size, contentType: meta.contentType, etag: meta.etag };
        const end = Math.min(range.end ?? size - 1, size - 1);
        if (range.start > end) throw new RangeError('Requested range not satisfiable');
        return { stream: file.createReadStream({ start: range.start, end, validation: false }), size, contentLength: end - range.start + 1, contentType: meta.contentType, etag: meta.etag, range: { start: range.start, end } };
    }

    async head(key: string): Promise<HeadResult | null> {
        try {
            const [meta] = await this.file(key).getMetadata();
            return { size: Number(meta.size), contentType: meta.contentType, etag: meta.etag, lastModified: meta.updated ? new Date(meta.updated) : undefined };
        } catch (e) {
            if (codeOf(e) === 404) return null;
            throw e;
        }
    }

    async delete(key: string): Promise<void> {
        await this.file(key).delete({ ignoreNotFound: true });
    }

    async list(prefix: string, options: { limit?: number; cursor?: string } = {}): Promise<ListResult> {
        const [files, nextQuery] = await this.storage.bucket(this.options.bucket).getFiles({ prefix, maxResults: options.limit ?? 1000, pageToken: options.cursor, autoPaginate: false });
        return {
            items: files.map((f) => ({ key: f.name, size: Number(f.metadata.size ?? 0), lastModified: f.metadata.updated ? new Date(f.metadata.updated) : undefined })),
            nextCursor: (nextQuery as { pageToken?: string } | null)?.pageToken,
        };
    }

    async presignDownload(key: string, options: PresignDownloadOptions): Promise<string> {
        const [url] = await this.file(key).getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + options.expiresIn * 1000,
            responseDisposition: options.filename ? contentDisposition(options.filename, Boolean(options.inline)) : undefined,
            responseType: options.contentType,
        });
        return url;
    }

    uploadHeaders(contentType: string): Record<string, string> {
        return { 'Content-Type': contentType };
    }

    async presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload> {
        const [url] = await this.file(key).getSignedUrl({ version: 'v4', action: 'write', expires: Date.now() + options.expiresIn * 1000, contentType: options.contentType });
        return { url, method: 'PUT', headers: this.uploadHeaders(options.contentType) };
    }

    async ping(): Promise<void> {
        const [exists] = await this.storage.bucket(this.options.bucket).exists();
        if (!exists) throw new Error(`GCS bucket "${this.options.bucket}" does not exist`);
    }

    /* ---- bucket administration ---- */

    async listBuckets(): Promise<string[]> {
        const [buckets] = await this.storage.getBuckets();
        return buckets.map((b) => b.name);
    }

    async createBucket(name: string): Promise<void> {
        await this.storage.createBucket(name);
    }

    async deleteBucket(name: string): Promise<void> {
        await this.storage.bucket(name).delete();
    }

    async bucketExists(name: string): Promise<boolean> {
        const [exists] = await this.storage.bucket(name).exists();
        return exists;
    }
}
