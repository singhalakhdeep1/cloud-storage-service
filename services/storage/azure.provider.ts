/** Azure Blob Storage (connection string, or account name + key). A "bucket" is a blob container. */
import type { Readable } from 'stream';
import { BlobSASPermissions, BlobServiceClient, StorageSharedKeyCredential, type ContainerClient } from '@azure/storage-blob';
import {
    ObjectNotFoundError,
    contentDisposition,
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
} from './types';

export interface AzureOptions {
    container: string;
    connectionString?: string;
    accountName?: string;
    accountKey?: string;
}

const statusOf = (e: unknown): number | undefined => (e as { statusCode?: number })?.statusCode;

export class AzureProvider implements StorageProvider, BucketAdmin {
    readonly name = 'azure' as const;
    private readonly service: BlobServiceClient;

    constructor(private readonly options: AzureOptions, shared?: BlobServiceClient) {
        if (shared) this.service = shared;
        else if (options.connectionString) this.service = BlobServiceClient.fromConnectionString(options.connectionString);
        else if (options.accountName && options.accountKey) this.service = new BlobServiceClient(`https://${options.accountName}.blob.core.windows.net`, new StorageSharedKeyCredential(options.accountName, options.accountKey));
        else throw new Error('Azure Blob Storage needs AZURE_STORAGE_CONNECTION_STRING, or AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_KEY');
    }

    get bucket(): string {
        return this.options.container;
    }

    withBucket(container: string): AzureProvider {
        return new AzureProvider({ ...this.options, container }, this.service);
    }

    location(key: string): string {
        return this.container().getBlobClient(key).url;
    }

    private container(): ContainerClient {
        return this.service.getContainerClient(this.options.container);
    }

    async put(key: string, body: Readable | Buffer, options: PutOptions = {}): Promise<PutResult> {
        const blob = this.container().getBlockBlobClient(key);
        const blobHTTPHeaders = { blobContentType: options.contentType };
        const out = Buffer.isBuffer(body)
            ? await blob.uploadData(body, { blobHTTPHeaders, metadata: options.metadata })
            : await blob.uploadStream(body, 8 * 1024 * 1024, 4, { blobHTTPHeaders, metadata: options.metadata });
        return { key, size: Buffer.isBuffer(body) ? body.length : undefined, etag: out.etag?.replace(/"/g, ''), location: blob.url, bucket: this.options.container };
    }

    async get(key: string, options: { range?: ByteRange } = {}): Promise<GetResult> {
        const blob = this.container().getBlobClient(key);
        try {
            const props = await blob.getProperties();
            const size = props.contentLength ?? 0;
            const { range } = options;
            if (!range) {
                const out = await blob.download();
                return { stream: out.readableStreamBody as Readable, size, contentLength: size, contentType: props.contentType, etag: props.etag?.replace(/"/g, '') };
            }
            const end = Math.min(range.end ?? size - 1, size - 1);
            if (range.start > end) throw new RangeError('Requested range not satisfiable');
            const out = await blob.download(range.start, end - range.start + 1);
            return { stream: out.readableStreamBody as Readable, size, contentLength: end - range.start + 1, contentType: props.contentType, etag: props.etag?.replace(/"/g, ''), range: { start: range.start, end } };
        } catch (e) {
            if (statusOf(e) === 404) throw new ObjectNotFoundError(key);
            throw e;
        }
    }

    async head(key: string): Promise<HeadResult | null> {
        try {
            const props = await this.container().getBlobClient(key).getProperties();
            return { size: props.contentLength ?? 0, contentType: props.contentType, etag: props.etag?.replace(/"/g, ''), lastModified: props.lastModified };
        } catch (e) {
            if (statusOf(e) === 404) return null;
            throw e;
        }
    }

    async delete(key: string): Promise<void> {
        await this.container().getBlobClient(key).deleteIfExists({ deleteSnapshots: 'include' });
    }

    async list(prefix: string, options: { limit?: number; cursor?: string } = {}): Promise<ListResult> {
        const page = await this.container().listBlobsFlat({ prefix }).byPage({ maxPageSize: options.limit ?? 1000, continuationToken: options.cursor }).next();
        const value = page.value as { segment: { blobItems: { name: string; properties: { contentLength?: number; lastModified?: Date } }[] }; continuationToken?: string } | undefined;
        return {
            items: (value?.segment.blobItems ?? []).map((b) => ({ key: b.name, size: b.properties.contentLength ?? 0, lastModified: b.properties.lastModified })),
            nextCursor: value?.continuationToken || undefined,
        };
    }

    presignDownload(key: string, options: PresignDownloadOptions): Promise<string> {
        return this.container().getBlobClient(key).generateSasUrl({
            permissions: BlobSASPermissions.parse('r'),
            expiresOn: new Date(Date.now() + options.expiresIn * 1000),
            contentDisposition: options.filename ? contentDisposition(options.filename, Boolean(options.inline)) : undefined,
            contentType: options.contentType,
        });
    }

    uploadHeaders(contentType: string): Record<string, string> {
        return { 'Content-Type': contentType, 'x-ms-blob-type': 'BlockBlob', 'x-ms-blob-content-type': contentType };
    }

    async presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload> {
        const url = await this.container().getBlockBlobClient(key).generateSasUrl({ permissions: BlobSASPermissions.parse('cw'), expiresOn: new Date(Date.now() + options.expiresIn * 1000) });
        return { url, method: 'PUT', headers: this.uploadHeaders(options.contentType) };
    }

    async init(): Promise<void> {
        await this.container().createIfNotExists();
    }

    async ping(): Promise<void> {
        await this.container().getProperties();
    }

    /* ---- container administration ---- */

    async listBuckets(): Promise<string[]> {
        const names: string[] = [];
        for await (const c of this.service.listContainers()) names.push(c.name);
        return names;
    }

    async createBucket(name: string): Promise<void> {
        await this.service.getContainerClient(name).create();
    }

    async deleteBucket(name: string): Promise<void> {
        await this.service.getContainerClient(name).delete();
    }

    async bucketExists(name: string): Promise<boolean> {
        return this.service.getContainerClient(name).exists();
    }
}
