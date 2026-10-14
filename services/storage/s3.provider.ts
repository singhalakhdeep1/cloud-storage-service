/**
 * S3 and every S3-compatible store: AWS S3, MinIO, DigitalOcean Spaces, Wasabi, Cloudflare R2 and Backblaze B2
 * (through its S3 API). They differ only in endpoint, region and path-style addressing; see registry.ts.
 */
import type { Readable } from 'stream';
import {
    CreateBucketCommand,
    DeleteBucketCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    ListBucketsCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
    type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
    contentDisposition,
    ObjectNotFoundError,
    type BucketAdmin,
    type ByteRange,
    type GetResult,
    type HeadResult,
    type ListResult,
    type PresignDownloadOptions,
    type PresignUploadOptions,
    type PresignedUpload,
    type ProviderName,
    type PutOptions,
    type PutResult,
    type StorageProvider,
} from './types';

export interface S3ProviderOptions {
    bucket: string;
    region: string;
    endpoint?: string;
    /** Endpoint browsers use for presigned URLs when it differs from the one the server uses (Docker networks). */
    publicEndpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle?: boolean;
}

const statusOf = (e: unknown): number | undefined => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const nameOf = (e: unknown): string => (e as { name?: string; Code?: string })?.name ?? (e as { Code?: string })?.Code ?? '';
const isMissing = (e: unknown): boolean => statusOf(e) === 404 || ['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(nameOf(e));

export class S3Provider implements StorageProvider, BucketAdmin {
    readonly client: S3Client;
    private readonly presignClient: S3Client;

    constructor(
        readonly name: ProviderName,
        private readonly options: S3ProviderOptions,
        shared?: { client: S3Client; presignClient: S3Client }
    ) {
        if (shared) {
            this.client = shared.client;
            this.presignClient = shared.presignClient;
            return;
        }
        const make = (endpoint?: string): S3Client => {
            const config: S3ClientConfig = {
                region: options.region,
                endpoint,
                forcePathStyle: options.forcePathStyle ?? Boolean(endpoint),
                // R2/B2/MinIO reject the checksum headers newer SDK versions add by default
                requestChecksumCalculation: 'WHEN_REQUIRED',
                responseChecksumValidation: 'WHEN_REQUIRED',
            };
            if (options.accessKeyId && options.secretAccessKey) config.credentials = { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey };
            return new S3Client(config);
        };
        this.client = make(options.endpoint);
        this.presignClient = options.publicEndpoint && options.publicEndpoint !== options.endpoint ? make(options.publicEndpoint) : this.client;
    }

    get bucket(): string {
        return this.options.bucket;
    }

    withBucket(bucket: string): S3Provider {
        return new S3Provider(this.name, { ...this.options, bucket }, { client: this.client, presignClient: this.presignClient });
    }

    location(key: string): string {
        const base = this.options.endpoint?.replace(/\/+$/, '');
        const encoded = key.split('/').map(encodeURIComponent).join('/');
        if (base) return `${base}/${this.options.bucket}/${encoded}`;
        return `https://${this.options.bucket}.s3.${this.options.region}.amazonaws.com/${encoded}`;
    }

    async put(key: string, body: Readable | Buffer, options: PutOptions = {}): Promise<PutResult> {
        const params = { Bucket: this.options.bucket, Key: key, Body: body, ContentType: options.contentType, Metadata: options.metadata };
        if (Buffer.isBuffer(body)) {
            const out = await this.client.send(new PutObjectCommand({ ...params, ContentLength: body.length }));
            return { key, size: body.length, etag: out.ETag?.replace(/"/g, ''), location: this.location(key), bucket: this.options.bucket };
        }
        // streams of unknown length go through multipart upload, so nothing is buffered in memory
        const upload = new Upload({ client: this.client, params, queueSize: 4, partSize: 8 * 1024 * 1024, leavePartsOnError: false });
        const out = await upload.done();
        return { key, etag: (out as { ETag?: string }).ETag?.replace(/"/g, ''), location: this.location(key), bucket: this.options.bucket };
    }

    async get(key: string, options: { range?: ByteRange } = {}): Promise<GetResult> {
        const { range } = options;
        try {
            const out = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end ?? ''}` : undefined }));
            const contentLength = out.ContentLength ?? 0;
            let size = contentLength;
            let parsed: GetResult['range'];
            if (range && out.ContentRange) {
                const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(out.ContentRange);
                if (m) {
                    parsed = { start: Number(m[1]), end: Number(m[2]) };
                    size = Number(m[3]);
                }
            }
            return { stream: out.Body as Readable, size, contentLength, contentType: out.ContentType, etag: out.ETag?.replace(/"/g, ''), range: parsed };
        } catch (e) {
            if (isMissing(e)) throw new ObjectNotFoundError(key);
            if (statusOf(e) === 416) throw new RangeError('Requested range not satisfiable');
            throw e;
        }
    }

    async head(key: string): Promise<HeadResult | null> {
        try {
            const out = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
            return { size: out.ContentLength ?? 0, contentType: out.ContentType, etag: out.ETag?.replace(/"/g, ''), lastModified: out.LastModified };
        } catch (e) {
            if (isMissing(e)) return null;
            throw e;
        }
    }

    async delete(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
    }

    async list(prefix: string, options: { limit?: number; cursor?: string } = {}): Promise<ListResult> {
        const out = await this.client.send(new ListObjectsV2Command({ Bucket: this.options.bucket, Prefix: prefix, MaxKeys: options.limit ?? 1000, ContinuationToken: options.cursor }));
        return {
            items: (out.Contents ?? []).map((o) => ({ key: o.Key as string, size: o.Size ?? 0, lastModified: o.LastModified })),
            nextCursor: out.IsTruncated ? out.NextContinuationToken : undefined,
        };
    }

    presignDownload(key: string, options: PresignDownloadOptions): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.options.bucket,
            Key: key,
            ResponseContentDisposition: options.filename ? contentDisposition(options.filename, Boolean(options.inline)) : undefined,
            ResponseContentType: options.contentType,
        });
        return getSignedUrl(this.presignClient, command, { expiresIn: options.expiresIn });
    }

    uploadHeaders(contentType: string): Record<string, string> {
        return { 'Content-Type': contentType };
    }

    async presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload> {
        const command = new PutObjectCommand({ Bucket: this.options.bucket, Key: key, ContentType: options.contentType });
        const url = await getSignedUrl(this.presignClient, command, { expiresIn: options.expiresIn, signableHeaders: new Set(['content-type']) });
        return { url, method: 'PUT', headers: this.uploadHeaders(options.contentType) };
    }

    async ping(): Promise<void> {
        await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
    }

    /* ---- bucket administration ---- */

    async listBuckets(): Promise<string[]> {
        const out = await this.client.send(new ListBucketsCommand({}));
        return (out.Buckets ?? []).map((b) => b.Name as string);
    }

    async createBucket(name: string): Promise<void> {
        await this.client.send(new CreateBucketCommand({ Bucket: name }));
    }

    async deleteBucket(name: string): Promise<void> {
        await this.client.send(new DeleteBucketCommand({ Bucket: name }));
    }

    async bucketExists(name: string): Promise<boolean> {
        try {
            await this.client.send(new HeadBucketCommand({ Bucket: name }));
            return true;
        } catch (e) {
            if (isMissing(e)) return false;
            throw e;
        }
    }
}
