/**
 * Local disk storage. Works out of the box for development and single-server installs.
 * "Presigned" URLs point back at this API (`/api/storage/local/object|upload?token=...`) and are signed with
 * URL_SIGNING_SECRET, so they expire and cannot be forged or redirected to another key.
 */
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import cfg from '../../config/env';
import { signToken } from '../../utils/crypto';
import { ObjectNotFoundError, type ByteRange, type GetResult, type HeadResult, type ListResult, type PresignDownloadOptions, type PresignUploadOptions, type PresignedUpload, type PutOptions, type PutResult, type StorageProvider } from './types';

export class LocalProvider implements StorageProvider {
    readonly name = 'local' as const;
    readonly bucket = undefined;

    constructor(private readonly root = cfg.LOCAL_STORAGE_PATH) {}

    /** Maps a key to a path inside the storage root; anything that could escape the root is refused. */
    resolve(key: string): string {
        if (!key || key.includes('\0') || key.includes('\\') || path.isAbsolute(key) || key.split('/').some((p) => p === '..' || p === '.' || p === '')) throw new Error(`Invalid storage key: ${key}`);
        const full = path.resolve(this.root, key);
        if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`Invalid storage key: ${key}`);
        return full;
    }

    location(key: string): string {
        return `local://${key}`;
    }

    async put(key: string, body: Readable | Buffer, _options: PutOptions = {}): Promise<PutResult> {
        const target = this.resolve(key);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.part`;
        const hash = crypto.createHash('md5');
        let size = 0;
        const meter = new Transform({
            transform(chunk: Buffer, _enc, cb) {
                size += chunk.length;
                hash.update(chunk);
                cb(null, chunk);
            },
        });
        try {
            await pipeline(Buffer.isBuffer(body) ? Readable.from([body]) : body, meter, fs.createWriteStream(tmp));
            await fsp.rename(tmp, target); // atomic: readers never see a half-written file
        } catch (e) {
            await fsp.rm(tmp, { force: true });
            throw e;
        }
        return { key, size, etag: hash.digest('hex'), location: this.location(key) };
    }

    async head(key: string): Promise<HeadResult | null> {
        try {
            const st = await fsp.stat(this.resolve(key));
            return st.isFile() ? { size: st.size, lastModified: st.mtime } : null;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw e;
        }
    }

    async get(key: string, options: { range?: ByteRange } = {}): Promise<GetResult> {
        const head = await this.head(key);
        if (!head) throw new ObjectNotFoundError(key);
        const { range } = options;
        if (!range) return { stream: fs.createReadStream(this.resolve(key)), size: head.size, contentLength: head.size };
        const end = Math.min(range.end ?? head.size - 1, head.size - 1);
        if (range.start > end) throw new RangeError('Requested range not satisfiable');
        return { stream: fs.createReadStream(this.resolve(key), { start: range.start, end }), size: head.size, contentLength: end - range.start + 1, range: { start: range.start, end } };
    }

    async delete(key: string): Promise<void> {
        await fsp.rm(this.resolve(key), { force: true });
        // remove now-empty parent directories (up to the root) so deleted files leave nothing behind
        let dir = path.dirname(this.resolve(key));
        const root = path.resolve(this.root);
        while (dir.startsWith(root + path.sep)) {
            try {
                await fsp.rmdir(dir);
            } catch {
                break;
            }
            dir = path.dirname(dir);
        }
    }

    async list(prefix: string, options: { limit?: number; cursor?: string } = {}): Promise<ListResult> {
        const root = path.resolve(this.root);
        const out: { key: string; size: number; lastModified?: Date }[] = [];
        const walk = async (dir: string): Promise<void> => {
            let entries: fs.Dirent[];
            try {
                entries = await fsp.readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const e of entries) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) await walk(full);
                else if (e.isFile() && !e.name.endsWith('.part')) {
                    const key = path.relative(root, full).split(path.sep).join('/');
                    if (key.startsWith(prefix)) {
                        const st = await fsp.stat(full);
                        out.push({ key, size: st.size, lastModified: st.mtime });
                    }
                }
            }
        };
        await walk(root);
        out.sort((a, b) => (a.key < b.key ? -1 : 1));
        const start = options.cursor ? out.findIndex((i) => i.key > (options.cursor as string)) : 0;
        if (start === -1) return { items: [] };
        const limit = options.limit ?? 1000;
        const items = out.slice(start, start + limit);
        return { items, nextCursor: start + limit < out.length ? items[items.length - 1]?.key : undefined };
    }

    async presignDownload(key: string, options: PresignDownloadOptions): Promise<string> {
        this.resolve(key);
        const token = signToken({ t: 'obj', k: key, fn: options.filename, ct: options.contentType, inl: options.inline ? 1 : 0 }, options.expiresIn);
        return `${cfg.PUBLIC_URL}/api/storage/local/object?token=${encodeURIComponent(token)}`;
    }

    uploadHeaders(contentType: string): Record<string, string> {
        return { 'Content-Type': contentType };
    }

    async presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload> {
        this.resolve(key);
        const token = signToken({ t: 'put', k: key, ct: options.contentType, max: options.size }, options.expiresIn);
        return { url: `${cfg.PUBLIC_URL}/api/storage/local/upload?token=${encodeURIComponent(token)}`, method: 'PUT', headers: this.uploadHeaders(options.contentType) };
    }

    async init(): Promise<void> {
        await fsp.mkdir(this.root, { recursive: true });
    }

    async ping(): Promise<void> {
        await fsp.mkdir(this.root, { recursive: true });
        await fsp.access(this.root, fs.constants.R_OK | fs.constants.W_OK);
    }
}
