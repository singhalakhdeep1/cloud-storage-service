import type { NextFunction, Request, RequestHandler, Response } from 'express';
import Joi from 'joi';
import cfg from '../config/env';
import { IMAGE_FORMATS } from '../utils/imageProcessor';
import User from '../models/User';
import AppError, { type FieldError } from '../utils/appError';
import asyncHandler from '../utils/asyncHandler';
import { isAllowed } from '../utils/mime';
import { PROVIDER_NAMES } from '../types/models';

const objectId = Joi.string().hex().length(24);
const password = Joi.string()
    .min(8)
    .max(72)
    .pattern(/[A-Za-z]/, 'a letter')
    .pattern(/\d/, 'a digit')
    .messages({ 'string.pattern.name': 'Password must contain at least one letter and one digit', 'string.min': 'Password must be at least 8 characters', 'string.max': 'Password must be at most 72 characters' });
const provider = Joi.string().valid(...PROVIDER_NAMES, 'aws', 'backblaze', 'cloudflare', 'google');

/** Validation schemas, by name (the original module exposed these as `schemas`). */
export const schemas = {
    register: Joi.object({ name: Joi.string().trim().min(2).max(50).required(), email: Joi.string().email().max(254).required(), password: password.required() }),
    login: Joi.object({ email: Joi.string().email().required(), password: Joi.string().max(200).required() }),
    updateProfile: Joi.object({
        name: Joi.string().trim().min(2).max(50),
        preferences: Joi.object({ defaultStorage: provider.allow(null), autoProcessImages: Joi.boolean(), enableVirusScan: Joi.boolean(), encryptFiles: Joi.boolean() }),
    }).min(1),
    updatePassword: Joi.object({ currentPassword: Joi.string().required(), newPassword: password.required() }),
    deleteAccount: Joi.object({ password: Joi.string().required() }),

    fileUpload: Joi.object({
        filename: Joi.string().required(),
        contentType: Joi.string(),
        mimetype: Joi.string(),
        size: Joi.number().integer().min(1),
        provider,
    }),
    uploadFields: Joi.object({ isPublic: Joi.boolean(), tags: Joi.alternatives(Joi.array().items(Joi.string().max(40)).max(20), Joi.string().max(900)), description: Joi.string().max(1000).allow(''), expiresAt: Joi.date().iso().greater('now'), provider }).unknown(true),
    presignedUpload: Joi.object({
        filename: Joi.string().max(255).required(),
        contentType: Joi.string().max(150),
        mimetype: Joi.string().max(150),
        size: Joi.number().integer().min(1).required(),
        provider,
        versionOf: objectId,
    }).or('contentType', 'mimetype'),
    confirmUpload: Joi.object({ uploadId: objectId.required() }),

    chunkedUploadInit: Joi.object({
        filename: Joi.string().max(255),
        originalName: Joi.string().max(255).required(),
        mimeType: Joi.string().max(150).required(),
        totalSize: Joi.number().integer().min(1).max(cfg.MAX_FILE_SIZE).required(),
        chunkSize: Joi.number().integer().min(1024).max(cfg.MAX_CHUNK_SIZE),
        provider,
        versionOf: objectId,
        tags: Joi.array().items(Joi.string().max(40)).max(20),
    }),

    imageResize: Joi.object({
        fileId: objectId.required(),
        width: Joi.number().integer().min(1).max(10000).required(),
        height: Joi.number().integer().min(1).max(10000).required(),
        fit: Joi.string().valid('cover', 'contain', 'fill', 'inside', 'outside').default('cover'),
        quality: Joi.number().integer().min(1).max(100).default(90),
    }),
    imageThumbnail: Joi.object({
        fileId: objectId.required(),
        width: Joi.number().integer().min(16).max(1000),
        height: Joi.number().integer().min(16).max(1000),
        quality: Joi.number().integer().min(1).max(100),
    }),
    imageConvert: Joi.object({ fileId: objectId.required(), format: Joi.string().valid(...IMAGE_FORMATS).required(), quality: Joi.number().integer().min(1).max(100).default(90) }),
    imageCompress: Joi.object({ fileId: objectId.required(), quality: Joi.number().integer().min(1).max(100).default(80), format: Joi.string().valid(...IMAGE_FORMATS).default('jpeg') }),
    imageAutoOrient: Joi.object({ fileId: objectId.required() }),

    fileShare: Joi.object({ email: Joi.string().email().required(), permission: Joi.string().valid('read', 'write', 'admin').default('read') }),
    updateFile: Joi.object({
        name: Joi.string().trim().min(1).max(200),
        tags: Joi.array().items(Joi.string().max(40)).max(20),
        description: Joi.string().max(1000).allow(''),
        isPublic: Joi.boolean(),
        accessControl: Joi.string().valid('private', 'public', 'shared'),
        expiresAt: Joi.date().iso().greater('now').allow(null),
    }).min(1),
    linkCreate: Joi.object({
        expiresInHours: Joi.number().integer().min(1).max(24 * 365),
        password: Joi.string().min(4).max(100),
        maxDownloads: Joi.number().integer().min(1).max(1_000_000),
        permission: Joi.string().valid('view', 'download').default('download'),
        label: Joi.string().max(100),
    }),
    linkDownload: Joi.object({ password: Joi.string().max(100).allow(''), inline: Joi.boolean() }),

    listFiles: Joi.object({
        scope: Joi.string().valid('mine', 'shared', 'all'),
        page: Joi.number().integer().min(1),
        limit: Joi.number().integer().min(1).max(100),
        category: Joi.string().valid('image', 'video', 'document', 'audio', 'other'),
        tag: Joi.string().max(40),
        search: Joi.string().max(100).allow(''),
        sort: Joi.string().valid('createdAt', 'updatedAt', 'name', 'size'),
        order: Joi.string().valid('asc', 'desc'),
    }),

    integrationConfig: Joi.object({ webhookUrl: Joi.string().uri().max(500), accessToken: Joi.string().min(8).max(4000), folderId: Joi.string().max(200) }).min(1),
    integrationSlack: Joi.object({ fileId: objectId, message: Joi.string().max(1000) }),
    integrationDropbox: Joi.object({ fileId: objectId.required(), path: Joi.string().max(500) }),
    integrationDrive: Joi.object({ fileId: objectId.required(), folderId: Joi.string().max(200) }),
    webhookCreate: Joi.object({ url: Joi.string().uri().max(500).required(), events: Joi.array().items(Joi.string()).min(1).default(['*']), description: Joi.string().max(200) }),
    webhookUpdate: Joi.object({ url: Joi.string().uri().max(500), events: Joi.array().items(Joi.string()).min(1), description: Joi.string().max(200).allow(''), isActive: Joi.boolean() }).min(1),

    adminUpdateUser: Joi.object({ isActive: Joi.boolean(), role: Joi.string().valid('user', 'admin'), storageLimit: Joi.number().integer().min(0) }).min(1),
};

type Source = 'body' | 'query' | 'params';

/** Validates the request part, replaces it with the cleaned value, and reports every problem at once. */
export function validate(schema: Joi.ObjectSchema, source: Source = 'body'): RequestHandler {
    return (req: Request, _res: Response, next: NextFunction) => {
        const { error, value } = schema.validate(req[source] ?? {}, { abortEarly: false, stripUnknown: true, convert: true });
        if (error) {
            const errors: FieldError[] = error.details.map((d) => ({ field: d.path.join('.'), message: d.message.replace(/"/g, "'") }));
            return next(new AppError(errors.map((e) => e.message).join(', '), 400, 'validation', errors));
        }
        if (source === 'query') Object.defineProperty(req, 'query', { value, writable: true, configurable: true });
        else (req as unknown as Record<string, unknown>)[source] = value;
        next();
    };
}

/** Refuses an upload up front when the announced body cannot fit in the user's remaining space (before it is received). */
export const validateStorageLimit: RequestHandler = asyncHandler(async (req, _res, next) => {
    if (!req.user) return next();
    const announced = Number(req.headers['content-length'] ?? 0);
    // a new version is stored in the owner's space
    const user = await User.findById(req.fileDoc ? req.fileDoc.uploadedBy : req.user._id).select('storageUsed storageLimit');
    if (!user) throw new AppError('User not found', 404);
    if (announced > 0 && user.storageUsed + announced > user.storageLimit) throw new AppError('Storage limit exceeded', 413, 'quota_exceeded');
    if (user.storageUsed >= user.storageLimit) throw new AppError('Storage limit exceeded', 413, 'quota_exceeded');
    next();
});

/** Declared-type check on an uploaded file (the real content type is verified again after the upload). */
export const validateFileType = (allowed?: string[]): RequestHandler => (req, _res, next) => {
    const file = req.file;
    if (!file) return next(new AppError('No file uploaded', 400));
    const ok = allowed ? allowed.includes(file.mimetype) : isAllowed(file.mimetype);
    next(ok ? undefined : new AppError(`File type ${file.mimetype} is not allowed`, 415, 'unsupported_media_type'));
};

export const validateFileSize = (max = cfg.MAX_FILE_SIZE): RequestHandler => (req, _res, next) => {
    const file = req.file;
    if (!file) return next(new AppError('No file uploaded', 400));
    next(file.size > max ? new AppError(`File too large. Maximum size: ${(max / 1024 / 1024).toFixed(2)} MB`, 413, 'too_large') : undefined);
};

export default validate;
