import type { RequestHandler } from 'express';
import File from '../models/File';
import { LEVEL, accessLevel, type Need } from '../services/access.service';
import AppError from '../utils/appError';
import asyncHandler from '../utils/asyncHandler';
import type { FileDoc } from '../types/models';

interface LoadOptions {
    /** exclude (default): a file in the trash is "not found"; only: trash operations; any: both. */
    trashed?: 'exclude' | 'only' | 'any';
}

/**
 * Loads `:id` into `req.fileDoc` and checks the caller's access. 404 when the file does not exist (or is in the
 * trash / expired when that is not wanted), 403 when it exists but the caller may not do `need`.
 */
export function loadFile(need: Need = 'read', options: LoadOptions = {}): RequestHandler {
    const trashed = options.trashed ?? 'exclude';
    return asyncHandler(async (req, _res, next) => {
        const file = (await File.findById(req.params.id)) as FileDoc | null;
        if (!file) throw new AppError('File not found', 404, 'not_found');
        const inTrash = Boolean(file.deletedAt);
        if ((trashed === 'exclude' && inTrash) || (trashed === 'only' && !inTrash)) throw new AppError('File not found', 404, 'not_found');
        if (file.expiresAt && file.expiresAt.getTime() < Date.now() && trashed === 'exclude') throw new AppError('File not found', 404, 'not_found');

        const level = accessLevel(file, req.user);
        if (level < LEVEL[need]) throw new AppError(level > 0 ? `You need ${need} permission for this file` : 'Not authorized to access this file', 403, 'forbidden');
        req.fileDoc = file;
        req.fileLevel = level;
        next();
    });
}

/** Read access to `:id` (the original name of this middleware). */
export const checkFileAccess = loadFile('read');
