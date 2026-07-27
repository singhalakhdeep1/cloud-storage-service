const Joi = require('joi');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');

// Validation schemas
const schemas = {
    register: Joi.object({
        name: Joi.string().required().min(2).max(50),
        email: Joi.string().email().required(),
        password: Joi.string().required().min(6)
    }),

    login: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().required()
    }),

    fileUpload: Joi.object({
        filename: Joi.string().required(),
        contentType: Joi.string().required()
    }),

    chunkedUploadInit: Joi.object({
        filename: Joi.string().required(),
        originalName: Joi.string().required(),
        mimeType: Joi.string().required(),
        totalSize: Joi.number().required().max(process.env.MAX_FILE_SIZE || 104857600),
        chunkSize: Joi.number().required().min(1024).max(10 * 1024 * 1024)
    }),

    imageResize: Joi.object({
        width: Joi.number().min(1).max(10000).required(),
        height: Joi.number().min(1).max(10000).required(),
        fit: Joi.string().valid('cover', 'contain', 'fill', 'inside', 'outside').default('cover'),
        quality: Joi.number().min(1).max(100).default(90)
    }),

    imageThumbnail: Joi.object({
        width: Joi.number().min(50).max(500).default(200),
        height: Joi.number().min(50).max(500).default(200),
        quality: Joi.number().min(1).max(100).default(80)
    }),

    imageConvert: Joi.object({
        format: Joi.string().valid('jpeg', 'png', 'webp', 'gif', 'avif').required(),
        quality: Joi.number().min(1).max(100).default(90)
    }),

    fileShare: Joi.object({
        userId: Joi.string().required(),
        permission: Joi.string().valid('read', 'write', 'admin').default('read')
    }),

    updateFile: Joi.object({
        tags: Joi.array().items(Joi.string()),
        isPublic: Joi.boolean(),
        accessControl: Joi.string().valid('private', 'public', 'shared')
    })
};

// Generic validation middleware
exports.validate = (schema) => {
    return asyncHandler(async (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errorMessage = error.details.map(detail => detail.message).join(', ');
            return next(new AppError(errorMessage, 400));
        }

        // Replace request body with validated value
        req.body = value;
        next();
    });
};

// File type validation
exports.validateFileType = (allowedTypes) => {
    const defaultTypes = process.env.ALLOWED_MIME_TYPES 
        ? process.env.ALLOWED_MIME_TYPES.split(',')
        : ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    
    const types = allowedTypes || defaultTypes;

    return asyncHandler(async (req, res, next) => {
        if (!req.file) {
            return next(new AppError('No file uploaded', 400));
        }

        if (!types.includes(req.file.mimetype)) {
            return next(new AppError(
                `Invalid file type. Allowed types: ${types.join(', ')}`,
                400
            ));
        }

        next();
    });
};

// File size validation
exports.validateFileSize = (maxSize) => {
    const defaultMax = parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024; // 100MB
    const max = maxSize || defaultMax;

    return asyncHandler(async (req, res, next) => {
        if (!req.file) {
            return next(new AppError('No file uploaded', 400));
        }

        if (req.file.size > max) {
            return next(new AppError(
                `File too large. Maximum size: ${(max / 1024 / 1024).toFixed(2)} MB`,
                400
            ));
        }

        next();
    });
};

// Image dimension validation
exports.validateImageDimensions = (maxWidth, maxHeight) => {
    const maxW = maxWidth || 10000;
    const maxH = maxHeight || 10000;

    return asyncHandler(async (req, res, next) => {
        if (!req.file || !req.file.mimetype.startsWith('image/')) {
            return next();
        }

        const sharp = require('sharp');
        try {
            const metadata = await sharp(req.file.buffer).metadata();
            
            if (metadata.width > maxW || metadata.height > maxH) {
                return next(new AppError(
                    `Image dimensions too large. Maximum: ${maxW}x${maxH}`,
                    400
                ));
            }

            req.imageMetadata = metadata;
            next();
        } catch (error) {
            return next(new AppError('Failed to validate image dimensions', 400));
        }
    });
};

// Storage limit validation
exports.validateStorageLimit = asyncHandler(async (req, res, next) => {
    if (!req.user) {
        return next();
    }

    const User = require('../models/User');
    const user = await User.findById(req.user._id);

    if (!user) {
        return next(new AppError('User not found', 404));
    }

    const fileSize = req.file?.size || req.body.totalSize || 0;

    if (!user.hasStorageSpace(fileSize)) {
        return next(new AppError(
            `Storage limit exceeded. Used: ${(user.storageUsed / 1024 / 1024).toFixed(2)} MB, Limit: ${(user.storageLimit / 1024 / 1024).toFixed(2)} MB`,
            400
        ));
    }

    next();
});

// Export schemas for use in controllers
exports.schemas = schemas;
