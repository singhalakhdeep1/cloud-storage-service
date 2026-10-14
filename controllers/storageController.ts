import type { Request } from 'express';
import mime from 'mime-types';
import { pipeline, Transform } from 'stream';
import File from '../models/File';
import { providerControllers } from './storage';
import * as fileService from '../services/file.service';
import { LocalProvider } from '../services/storage/local.provider';
import { defaultProviderName, getStorage, normalizeProviderName, tryGetStorage } from '../services/storage/registry';
import { PROVIDER_NAMES, type FileDoc } from '../types/models';
import AppError from '../utils/appError';
import asyncHandler from '../utils/asyncHandler';
import { verifyToken } from '../utils/crypto';
import { sendObject } from '../utils/sendObject';

/* ---------------------------------------------------------- administration */

const controllerFor = (req: Request) => {
    const name = normalizeProviderName(String(req.params.provider));
    const c = name && providerControllers[name];
    if (!name || !c) throw new AppError(`No bucket administration for "${String(req.params.provider)}"`, 404, 'not_found');
    return c;
};

// @route GET /api/storage/providers
export const listProviders = asyncHandler(async (_req, res) => {
    res.status(200).json({ success: true, data: PROVIDER_NAMES.map((name) => ({ name, configured: tryGetStorage(name) !== null, isDefault: name === defaultProviderName(), buckets: Boolean(providerControllers[name]) })) });
});

// @route GET /api/storage/providers/:provider/buckets
export const listBuckets = asyncHandler(async (req, res) => {
    res.status(200).json({ success: true, data: (await controllerFor(req).listBuckets()).buckets });
});

// @route POST /api/storage/providers/:provider/buckets   { name }
export const createBucket = asyncHandler(async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)) throw new AppError('name must be 3-63 lowercase letters, digits, dots or dashes', 400);
    await controllerFor(req).createBucket(name);
    res.status(201).json({ success: true, message: 'Bucket created' });
});

// @route DELETE /api/storage/providers/:provider/buckets/:bucket
export const deleteBucket = asyncHandler(async (req, res) => {
    await controllerFor(req).deleteBucket(String(req.params.bucket));
    res.status(200).json({ success: true, message: 'Bucket deleted' });
});

// @route GET /api/storage/providers/:provider/buckets/:bucket/objects?prefix=&limit=&cursor=
export const listObjects = asyncHandler(async (req, res) => {
    const { prefix = '', limit, cursor } = req.query as { prefix?: string; limit?: string; cursor?: string };
    res.status(200).json({ success: true, data: await controllerFor(req).listFiles(String(req.params.bucket), prefix, { limit: limit ? Math.min(1000, Number(limit)) : 100, cursor }) });
});

// @route GET /api/storage/providers/:provider/buckets/:bucket/presign?key=&expiresIn=
export const presign = asyncHandler(async (req, res) => {
    const { key, expiresIn } = req.query as { key?: string; expiresIn?: string };
    if (!key) throw new AppError('key is required', 400);
    const seconds = Math.min(7 * 24 * 3600, Math.max(10, Number(expiresIn) || 3600));
    res.status(200).json({ success: true, url: await controllerFor(req).getPresignedUrl(String(req.params.bucket), key, seconds), expiresIn: seconds });
});

/* ---------------------------------------------------- local-disk signed URLs */

const local = (): LocalProvider => {
    const p = getStorage('local');
    if (!(p instanceof LocalProvider)) throw new AppError('Local storage is not available', 404);
    return p;
};

// @route GET|HEAD /api/storage/local/object?token=
export const serveLocalObject = asyncHandler(async (req, res) => {
    const t = verifyToken<{ t: string; k: string; fn?: string; ct?: string; inl?: number }>(String(req.query.token ?? ''));
    if (!t || t.t !== 'obj') throw new AppError('This link has expired or is not valid', 403, 'invalid_link');
    const head = await local().head(t.k);
    if (!head) throw new AppError('File not found', 404, 'not_found');
    const filename = t.fn ?? t.k.split('/').pop() ?? 'file';
    await sendObject(req, res, { key: t.k, storageType: 'local', size: head.size, mimetype: t.ct || mime.lookup(filename) || 'application/octet-stream' }, { filename, mimetype: t.ct || mime.lookup(filename) || 'application/octet-stream', inline: Boolean(t.inl) });
});

// @route PUT /api/storage/local/upload?token=   (raw body)
export const acceptLocalUpload = asyncHandler(async (req, res) => {
    const t = verifyToken<{ t: string; k: string; ct: string; max?: number }>(String(req.query.token ?? ''));
    if (!t || t.t !== 'put') throw new AppError('This link has expired or is not valid', 403, 'invalid_link');
    const sent = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (sent !== t.ct.toLowerCase()) throw new AppError(`Content-Type must be ${t.ct}`, 415, 'unsupported_media_type');
    const max = t.max ?? Number.MAX_SAFE_INTEGER;
    const declared = Number(req.headers['content-length']);
    if (declared > max) throw new AppError('The upload is larger than announced', 413, 'too_large');
    let received = 0;
    const guard = new Transform({
        transform(chunk: Buffer, _enc, cb) {
            received += chunk.length;
            cb(received > max ? new AppError('The upload is larger than announced', 413, 'too_large') : null, chunk);
        },
    });
    const body = pipeline(req, guard, () => undefined);
    const out = await local().put(t.k, body, { contentType: t.ct });
    res.status(200).setHeader('ETag', `"${out.etag}"`).json({ success: true });
});

/* ---------------------------------------------------- signed content links */

// @route GET|HEAD /api/content/:token   (encrypted files, thumbnails of encrypted files, ...)
export const serveContent = asyncHandler(async (req, res) => {
    const t = verifyToken<{ t: string; f: string; var?: string; ver?: number; fn?: string; inl?: number }>(String(req.params.token));
    if (!t || t.t !== 'content') throw new AppError('This link has expired or is not valid', 403, 'invalid_link');
    const f = (await File.findById(t.f)) as FileDoc | null;
    if (!f || f.deletedAt) throw new AppError('File not found', 404, 'not_found');
    let ref = fileService.refOf(f);
    let mimetype = f.mimetype;
    let etag = f.checksum;
    if (t.var) {
        const v = f.variants.find((x) => String(x._id) === t.var);
        if (!v) throw new AppError('File not found', 404, 'not_found');
        ref = fileService.refOfVariant(f, v);
        mimetype = v.mimetype ?? 'application/octet-stream';
        etag = undefined;
    } else if (t.ver && t.ver !== f.currentVersion) {
        const v = f.versions.find((x) => x.versionNumber === t.ver);
        if (!v) throw new AppError('File not found', 404, 'not_found');
        ref = fileService.refOfVersion(f, v);
        mimetype = v.mimetype ?? f.mimetype;
        etag = v.checksum;
    }
    await sendObject(req, res, ref, { filename: t.fn ?? f.originalName, mimetype, inline: Boolean(t.inl), etag });
});
