/**
 * Provider administration: the operations an operator needs on a storage provider beyond serving files, such as
 * listing / creating / deleting buckets, browsing objects and making presigned URLs. One controller class exists per
 * provider (MinIO, DigitalOcean Spaces, Backblaze B2, Wasabi, Cloudflare R2, Google Cloud Storage, Azure Blob Storage);
 * they share this implementation because the storage layer already speaks every provider's protocol.
 *
 * Methods throw on failure (AppError for configuration problems), so callers and the HTTP layer report real errors.
 */
import fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { getStorage } from '../../services/storage/registry';
import { isBucketAdmin, type BucketAdmin, type StorageProvider } from '../../services/storage/types';
import type { ProviderName } from '../../types/models';
import AppError from '../../utils/appError';

export interface ObjectInfo {
    key: string;
    size: number;
    lastModified?: Date;
}

export class ProviderController {
    constructor(readonly providerName: ProviderName) {}

    /** The configured provider, or a 503 saying what is missing. */
    get provider(): StorageProvider {
        return getStorage(this.providerName);
    }

    private admin(): StorageProvider & BucketAdmin {
        const p = this.provider;
        if (!isBucketAdmin(p)) throw new AppError(`${this.providerName} does not support bucket administration`, 400);
        return p;
    }

    private on(bucket: string): StorageProvider {
        const p = this.provider;
        if (!bucket) throw new AppError('A bucket / container name is required', 400);
        return p.withBucket ? p.withBucket(bucket) : p;
    }

    isConfigured(): boolean {
        try {
            this.provider;
            return true;
        } catch {
            return false;
        }
    }

    /** `body` may be a Buffer, a stream or the path of a local file. */
    async uploadFile(bucketName: string, key: string, body: Buffer | Readable | string, contentType?: string): Promise<{ success: true; key: string; location: string }> {
        const source = typeof body === 'string' ? fs.createReadStream(body) : body;
        const out = await this.on(bucketName).put(key, source, { contentType });
        return { success: true, key: out.key, location: out.location };
    }

    uploadBuffer(bucketName: string, key: string, buffer: Buffer, contentType?: string) {
        return this.uploadFile(bucketName, key, buffer, contentType);
    }

    /** Streams an object to a local path. */
    async downloadFile(bucketName: string, key: string, destinationPath: string): Promise<{ success: true; bytes: number }> {
        const got = await this.on(bucketName).get(key);
        await pipeline(got.stream, fs.createWriteStream(destinationPath));
        return { success: true, bytes: got.size };
    }

    async getFile(bucketName: string, key: string): Promise<{ success: true; stream: Readable; size: number; contentType?: string }> {
        const got = await this.on(bucketName).get(key);
        return { success: true, stream: got.stream, size: got.size, contentType: got.contentType };
    }

    async deleteFile(bucketName: string, key: string): Promise<{ success: true }> {
        await this.on(bucketName).delete(key);
        return { success: true };
    }

    async listFiles(bucketName: string, prefix = '', options: { limit?: number; cursor?: string } = {}): Promise<{ success: true; files: ObjectInfo[]; nextCursor?: string }> {
        const out = await this.on(bucketName).list(prefix, options);
        return { success: true, files: out.items, nextCursor: out.nextCursor };
    }

    async listBuckets(): Promise<{ success: true; buckets: string[] }> {
        return { success: true, buckets: await this.admin().listBuckets() };
    }

    async createBucket(name: string): Promise<{ success: true }> {
        await this.admin().createBucket(name);
        return { success: true };
    }

    async deleteBucket(name: string): Promise<{ success: true }> {
        await this.admin().deleteBucket(name);
        return { success: true };
    }

    async bucketExists(name: string): Promise<boolean> {
        return this.admin().bucketExists(name);
    }

    getPresignedUrl(bucketName: string, key: string, expiresIn = 3600, filename?: string): Promise<string> {
        return this.on(bucketName).presignDownload(key, { expiresIn, filename });
    }

    async getPresignedUploadUrl(bucketName: string, key: string, contentType = 'application/octet-stream', expiresIn = 3600) {
        return this.on(bucketName).presignUpload(key, { expiresIn, contentType });
    }
}
