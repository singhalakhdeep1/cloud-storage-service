import type { Request } from 'express';
import File from '../models/File';
import { clearUserCache } from '../middleware/cache';
import * as access from '../services/access.service';
import * as fileService from '../services/file.service';
import * as upload from '../services/upload.service';
import type { FileDoc, UploadSessionDoc, UserDoc } from '../types/models';
import AppError from '../utils/appError';
import asyncHandler from '../utils/asyncHandler';

const me = (req: Request): UserDoc => req.user as UserDoc;
const session = (req: Request): Promise<UploadSessionDoc> => upload.findOwned(String(req.params.id), me(req));

const statusView = (s: UploadSessionDoc) => ({
    uploadId: s.uploadId,
    status: s.status,
    uploadedChunks: s.uploadedChunks.length,
    totalChunks: s.totalChunks,
    chunkSize: s.chunkSize,
    totalSize: s.totalSize,
    progress: s.getProgress(),
    missingChunks: s.getMissingChunks(),
    expiresAt: s.expiresAt,
    ...(s.fileId && { fileId: s.fileId }),
    ...(s.error && { error: s.error }),
});

// @desc    Start a resumable upload
// @route   POST /api/upload/chunked
export const initChunkedUpload = asyncHandler(async (req, res) => {
    const body = req.body as { filename?: string; originalName: string; mimeType: string; totalSize: number; chunkSize?: number; provider?: string; versionOf?: string; tags?: string[] };
    let versionOf: FileDoc | undefined;
    if (body.versionOf) {
        versionOf = (await File.findById(body.versionOf)) as FileDoc | undefined;
        if (!versionOf || versionOf.deletedAt) throw new AppError('File not found', 404, 'not_found');
        if (!access.can(versionOf, me(req), 'write')) throw new AppError('You need write permission for this file', 403, 'forbidden');
    }
    const s = await upload.init(me(req), { filename: body.filename ?? body.originalName, originalName: body.originalName, mimeType: body.mimeType, totalSize: body.totalSize, chunkSize: body.chunkSize, provider: body.provider, versionOf, tags: body.tags });
    res.status(201).json({ success: true, data: { uploadId: s.uploadId, totalChunks: s.totalChunks, chunkSize: s.chunkSize, expiresAt: s.expiresAt } });
});

// @desc    Send one chunk (multipart: `chunk` = the bytes, `chunkNumber`, optional `checksum` = sha256 hex)
// @route   PUT /api/upload/chunked/:id
export const uploadChunk = asyncHandler(async (req, res) => {
    const body = req.body as { chunkNumber?: string | number; checksum?: string };
    const s = await session(req);
    if (!req.file) throw new AppError('No file chunk provided (multipart field "chunk")', 400);
    if (body.chunkNumber === undefined || body.chunkNumber === '') throw new AppError('Chunk number required', 400);
    const chunkNumber = Number(body.chunkNumber);
    const updated = await upload.uploadChunk(s, chunkNumber, req.file.buffer, body.checksum);
    res.status(200).json({ success: true, data: { chunkNumber, uploadedChunks: updated.uploadedChunks.length, totalChunks: updated.totalChunks, progress: updated.getProgress() } });
});

// @desc    Assemble the chunks into the file
// @route   POST /api/upload/chunked/:id/complete
export const completeChunkedUpload = asyncHandler(async (req, res) => {
    const file = await upload.complete(await session(req), me(req), req);
    await clearUserCache(me(req)._id);
    res.status(200).json({ success: true, data: await fileService.serialize(file, me(req), { thumbnailUrl: true }) });
});

// @desc    Cancel and delete what was uploaded so far
// @route   DELETE /api/upload/chunked/:id
export const cancelChunkedUpload = asyncHandler(async (req, res) => {
    await upload.cancel(await session(req));
    await clearUserCache(me(req)._id);
    res.status(200).json({ success: true, message: 'Upload cancelled' });
});

// @desc    Progress and the chunks still missing
// @route   GET /api/upload/chunked/:id/status
export const getChunkedUploadStatus = asyncHandler(async (req, res) => {
    res.status(200).json({ success: true, data: statusView(await session(req)) });
});

// @desc    Pause (the session is kept until it expires)
// @route   POST /api/upload/chunked/:id/pause
export const pauseChunkedUpload = asyncHandler(async (req, res) => {
    const s = await upload.pause(await session(req));
    res.status(200).json({ success: true, data: statusView(s) });
});

// @desc    Resume: which chunks to send next
// @route   POST /api/upload/chunked/:id/resume
export const resumeChunkedUpload = asyncHandler(async (req, res) => {
    const s = await upload.resume(await session(req));
    res.status(200).json({ success: true, data: { ...statusView(s), uploadedChunks: s.uploadedChunks, missingChunks: s.getMissingChunks() } });
});

// @desc    My unfinished uploads
// @route   GET /api/upload/chunked
export const listChunkedUploads = asyncHandler(async (req, res) => {
    const { default: UploadSession } = await import('../models/UploadSession');
    const rows = (await UploadSession.find({ user: me(req)._id, status: { $in: ['pending', 'uploading', 'paused'] }, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(50)) as UploadSessionDoc[];
    res.status(200).json({ success: true, data: rows.map((s) => ({ ...statusView(s), originalName: s.originalName, mimeType: s.mimeType })) });
});
