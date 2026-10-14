import type { Request } from 'express';
import File from '../models/File';
import * as access from '../services/access.service';
import * as activity from '../services/activity.service';
import * as fileService from '../services/file.service';
import * as objectStore from '../services/objectStore.service';
import type { FileDoc, UserDoc } from '../types/models';
import AppError from '../utils/appError';
import asyncHandler from '../utils/asyncHandler';
import imageProcessor, { extensionForFormat, type Processed } from '../utils/imageProcessor';

const me = (req: Request): UserDoc => req.user as UserDoc;

/** Loads the image the request is about and checks that the caller may change it (`write`) or only look (`read`). */
async function imageFor(req: Request, id: string, need: 'read' | 'write'): Promise<FileDoc> {
    const f = (await File.findById(id)) as FileDoc | null;
    if (!f || f.deletedAt) throw new AppError('File not found', 404, 'not_found');
    if (!access.can(f, me(req), need)) throw new AppError(need === 'write' ? 'You need write permission for this file' : 'Not authorized to access this file', 403, 'forbidden');
    if (f.category !== 'image') throw new AppError('File is not an image', 400, 'not_an_image');
    return f;
}

const original = (f: FileDoc): Promise<Buffer> => objectStore.readObjectBuffer(fileService.refOf(f), 30 * 1024 * 1024);

/** Stores the result as a variant of the image (the original is never touched) and describes it. */
async function saveVariant(req: Request, f: FileDoc, type: 'thumbnail' | 'resized' | 'converted', out: Processed, label: string, extra: Record<string, unknown> = {}) {
    const format = out.metadata.format ?? 'jpeg';
    const v = await fileService.addVariant(f, me(req), { type, buffer: out.buffer, mimetype: out.mimetype, format, width: out.metadata.width, height: out.metadata.height, label, ext: extensionForFormat(format) });
    activity.record(f._id, me(req)._id, 'image_process', req, { type, label });
    return { id: String(v._id), type, size: out.buffer.length, dimensions: { width: out.metadata.width, height: out.metadata.height }, format, downloadUrl: `/api/files/${String(f._id)}/stream?variant=${String(v._id)}`, ...extra };
}

// @desc    Resize
// @route   POST /api/images/resize
export const resizeImage = asyncHandler(async (req, res) => {
    const { fileId, width, height, fit, quality } = req.body as { fileId: string; width: number; height: number; fit: 'cover'; quality: number };
    const f = await imageFor(req, fileId, 'write');
    const out = await imageProcessor.resize(await original(f), { width, height, fit, quality });
    res.status(200).json({ success: true, data: await saveVariant(req, f, 'resized', out, `${width}x${height}`) });
});

// @desc    Thumbnail (the existing one is returned when there is one and no size is asked for)
// @route   POST /api/images/thumbnail
export const generateThumbnail = asyncHandler(async (req, res) => {
    const { fileId, width = 200, height = 200, quality = 80 } = req.body as { fileId: string; width?: number; height?: number; quality?: number };
    const f = await imageFor(req, fileId, 'write');
    const asked = req.body as Record<string, unknown>;
    const existing = f.getVariant('thumbnail');
    if (existing && asked.width === undefined && asked.height === undefined) {
        res.status(200).json({ success: true, data: { id: String(existing._id), type: 'thumbnail', size: existing.size, dimensions: existing.dimensions, format: existing.format, downloadUrl: `/api/files/${fileId}/thumbnail` } });
        return;
    }
    const out = await imageProcessor.thumbnail(await original(f), { width, height, quality });
    res.status(200).json({ success: true, data: await saveVariant(req, f, 'thumbnail', out, `thumb-${width}x${height}`) });
});

// @desc    Convert to another format
// @route   POST /api/images/convert
export const convertImage = asyncHandler(async (req, res) => {
    const { fileId, format, quality } = req.body as { fileId: string; format: string; quality: number };
    const f = await imageFor(req, fileId, 'write');
    const out = await imageProcessor.convert(await original(f), format, { quality });
    res.status(200).json({ success: true, data: await saveVariant(req, f, 'converted', out, `to-${format}`) });
});

// @desc    Compress
// @route   POST /api/images/compress
export const compressImage = asyncHandler(async (req, res) => {
    const { fileId, quality, format } = req.body as { fileId: string; quality: number; format: string };
    const f = await imageFor(req, fileId, 'write');
    const buffer = await original(f);
    const out = await imageProcessor.compress(buffer, { quality, format });
    const ratio = `${((1 - out.buffer.length / buffer.length) * 100).toFixed(2)}%`;
    res.status(200).json({ success: true, data: await saveVariant(req, f, 'converted', out, `compressed-q${quality}`, { originalSize: buffer.length, compressedSize: out.buffer.length, compressionRatio: ratio }) });
});

// @desc    Fix the rotation stored in the photo's EXIF data. The corrected image becomes a new version of the file.
// @route   POST /api/images/auto-orient
export const autoOrientImage = asyncHandler(async (req, res) => {
    const { fileId } = req.body as { fileId: string };
    const f = await imageFor(req, fileId, 'write');
    const out = await imageProcessor.autoOrient(await original(f));
    const updated = await fileService.ingest({ user: me(req), source: { buffer: out.buffer }, size: out.buffer.length, originalName: f.originalName, declaredMime: out.mimetype, versionOf: f, reason: 'auto-orient', req });
    res.status(200).json({ success: true, data: await fileService.serialize(updated, me(req), { thumbnailUrl: true }) });
});

// @desc    The original and everything made from it
// @route   GET /api/images/:id/variants
export const getImageVariants = asyncHandler(async (req, res) => {
    const f = await imageFor(req, String(req.params.id), 'read');
    res.status(200).json({
        success: true,
        data: {
            original: { size: f.size, dimensions: f.metadata, format: f.metadata?.format, downloadUrl: `/api/files/${String(f._id)}/stream` },
            variants: f.variants.map((v) => ({ id: String(v._id), type: v.type, size: v.size, dimensions: v.dimensions, format: v.format, downloadUrl: `/api/files/${String(f._id)}/stream?variant=${String(v._id)}` })),
        },
    });
});

// @desc    Width, height, format, orientation ...
// @route   GET /api/images/:id/metadata
export const getImageMetadata = asyncHandler(async (req, res) => {
    const f = await imageFor(req, String(req.params.id), 'read');
    res.status(200).json({ success: true, data: await imageProcessor.getMetadata(await original(f)) });
});

// @desc    Delete a variant (its space is given back)
// @route   DELETE /api/images/:id/variants/:variantId
export const deleteVariant = asyncHandler(async (req, res) => {
    const f = await imageFor(req, String(req.params.id), 'write');
    if (!(await fileService.removeVariant(f, String(req.params.variantId)))) throw new AppError('Variant not found', 404, 'not_found');
    res.status(200).json({ success: true, message: 'Variant deleted' });
});
