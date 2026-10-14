import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RequestHandler } from 'express';
import multer from 'multer';
import cfg from './env';

/** Uploads are written to a temporary directory (not held in memory), checked and stored, then removed. */
export const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'cloud-storage-uploads');
fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

const tempStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
    filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
});

const common = { fields: 20, fieldSize: 1024 * 1024, parts: 40 };

/** Whole-file uploads. The type is checked from the content afterwards, so there is no extension filter here. */
export const uploadFiles = multer({ storage: tempStorage, limits: { ...common, fileSize: cfg.MAX_FILE_SIZE, files: 10 } });

/** One chunk of a resumable upload (small by definition, so it stays in memory). */
export const uploadChunk = multer({ storage: multer.memoryStorage(), limits: { ...common, fileSize: cfg.MAX_CHUNK_SIZE, files: 1 } });

/** Removes the temporary files of a request once the response is finished (or the client went away). */
export const cleanupTempFiles: RequestHandler = (req, res, next) => {
    const cleanup = () => {
        const files: Express.Multer.File[] = [...(req.file ? [req.file] : []), ...(Array.isArray(req.files) ? req.files : Object.values(req.files ?? {}).flat())];
        for (const f of files) if (f.path) fs.promises.rm(f.path, { force: true }).catch(() => undefined);
    };
    res.once('finish', cleanup);
    res.once('close', cleanup);
    next();
};

/** Back-compat names used by older code. */
export const uploadMemory = uploadChunk;
export const uploadDisk = uploadFiles;
