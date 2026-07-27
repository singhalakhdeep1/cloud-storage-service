const File = require('../models/File');
const { uploadToS3, deleteFromS3, getFromS3 } = require('../config/s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const logger = require('../config/logger');
const imageProcessor = require('../utils/imageProcessor');
const { cache } = require('../config/redis');

// @desc    Resize image
// @route   POST /api/images/resize
exports.resizeImage = asyncHandler(async (req, res, next) => {
    const { fileId, width, height, fit, quality } = req.body;

    if (!fileId || !width || !height) {
        return next(new AppError('fileId, width, and height are required', 400));
    }

    const file = await File.findById(fileId);
    if (!file) {
        return next(new AppError('File not found', 404));
    }

    if (file.category !== 'image') {
        return next(new AppError('File is not an image', 400));
    }

    // Download original image
    const { Body } = await getFromS3(file.key);
    const originalBuffer = Buffer.from(await Body.toArray());

    // Process image
    const { buffer, metadata } = await imageProcessor.resize(originalBuffer, {
        width: parseInt(width),
        height: parseInt(height),
        fit,
        quality: quality || 90
    });

    // Upload resized image
    const resizedKey = `images/resized/${fileId}-${width}x${height}${path.extname(file.filename)}`;
    const s3Result = await uploadToS3({ buffer, mimetype: file.mimetype }, resizedKey);

    // Add variant to file
    await file.addVariant({
        type: 'resized',
        key: resizedKey,
        size: buffer.length,
        dimensions: { width: metadata.width, height: metadata.height },
        format: metadata.format,
        location: s3Result.location
    });

    // Clear cache
    await cache.delPattern(`/api/images/${fileId}*`);

    logger.info('Image resized successfully', { fileId, dimensions: `${width}x${height}` });

    res.status(200).json({
        success: true,
        data: {
            key: resizedKey,
            location: s3Result.location,
            size: buffer.length,
            dimensions: { width: metadata.width, height: metadata.height }
        }
    });
});

// @desc    Generate thumbnail
// @route   POST /api/images/thumbnail
exports.generateThumbnail = asyncHandler(async (req, res, next) => {
    const { fileId, width, height, quality } = req.body;

    if (!fileId) {
        return next(new AppError('fileId is required', 400));
    }

    const file = await File.findById(fileId);
    if (!file) {
        return next(new AppError('File not found', 404));
    }

    if (file.category !== 'image') {
        return next(new AppError('File is not an image', 400));
    }

    // Check if thumbnail already exists
    const existingThumbnail = file.getVariant('thumbnail');
    if (existingThumbnail) {
        return res.status(200).json({
            success: true,
            data: existingThumbnail
        });
    }

    // Download original image
    const { Body } = await getFromS3(file.key);
    const originalBuffer = Buffer.from(await Body.toArray());

    // Generate thumbnail
    const { buffer, metadata } = await imageProcessor.thumbnail(originalBuffer, {
        width: width || 200,
        height: height || 200,
        quality: quality || 80
    });

    // Upload thumbnail
    const thumbKey = `images/thumbnails/${fileId}${path.extname(file.filename)}`;
    const s3Result = await uploadToS3({ buffer, mimetype: 'image/jpeg' }, thumbKey);

    // Add variant to file
    await file.addVariant({
        type: 'thumbnail',
        key: thumbKey,
        size: buffer.length,
        dimensions: { width: metadata.width, height: metadata.height },
        format: metadata.format,
        location: s3Result.location
    });

    // Clear cache
    await cache.delPattern(`/api/images/${fileId}*`);

    logger.info('Thumbnail generated successfully', { fileId });

    res.status(200).json({
        success: true,
        data: {
            key: thumbKey,
            location: s3Result.location,
            size: buffer.length,
            dimensions: { width: metadata.width, height: metadata.height }
        }
    });
});

// @desc    Convert image format
// @route   POST /api/images/convert
exports.convertImage = asyncHandler(async (req, res, next) => {
    const { fileId, format, quality } = req.body;

    if (!fileId || !format) {
        return next(new AppError('fileId and format are required', 400));
    }

    const file = await File.findById(fileId);
    if (!file) {
        return next(new AppError('File not found', 404));
    }

    if (file.category !== 'image') {
        return next(new AppError('File is not an image', 400));
    }

    // Download original image
    const { Body } = await getFromS3(file.key);
    const originalBuffer = Buffer.from(await Body.toArray());

    // Convert image
    const { buffer, metadata } = await imageProcessor.convert(originalBuffer, format, {
        quality: quality || 90
    });

    // Upload converted image
    const convertedKey = `images/converted/${fileId}.${format}`;
    const s3Result = await uploadToS3({ buffer, mimetype: `image/${format}` }, convertedKey);

    // Add variant to file
    await file.addVariant({
        type: 'converted',
        key: convertedKey,
        size: buffer.length,
        dimensions: { width: metadata.width, height: metadata.height },
        format: metadata.format,
        location: s3Result.location
    });

    // Clear cache
    await cache.delPattern(`/api/images/${fileId}*`);

    logger.info('Image converted successfully', { fileId, format });

    res.status(200).json({
        success: true,
        data: {
            key: convertedKey,
            location: s3Result.location,
            size: buffer.length,
            format: metadata.format
        }
    });
});

// @desc    Get image variants
// @route   GET /api/images/:id/variants
exports.getImageVariants = asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    const file = await File.findById(id);
    if (!file) {
        return next(new AppError('File not found', 404));
    }

    if (file.category !== 'image') {
        return next(new AppError('File is not an image', 400));
    }

    res.status(200).json({
        success: true,
        data: {
            original: {
                key: file.key,
                location: file.location,
                size: file.size,
                dimensions: file.metadata
            },
            variants: file.variants
        }
    });
});

// @desc    Compress image
// @route   POST /api/images/compress
exports.compressImage = asyncHandler(async (req, res, next) => {
    const { fileId, quality, format } = req.body;

    if (!fileId) {
        return next(new AppError('fileId is required', 400));
    }

    const file = await File.findById(fileId);
    if (!file) {
        return next(new AppError('File not found', 404));
    }

    if (file.category !== 'image') {
        return next(new AppError('File is not an image', 400));
    }

    // Download original image
    const { Body } = await getFromS3(file.key);
    const originalBuffer = Buffer.from(await Body.toArray());

    // Compress image
    const { buffer, metadata } = await imageProcessor.compress(originalBuffer, {
        quality: quality || 80,
        format: format || 'jpeg'
    });

    // Upload compressed image
    const compressedKey = `images/compressed/${fileId}${path.extname(file.filename)}`;
    const s3Result = await uploadToS3({ buffer, mimetype: `image/${format || 'jpeg'}` }, compressedKey);

    // Add variant to file
    await file.addVariant({
        type: 'resized',
        key: compressedKey,
        size: buffer.length,
        dimensions: { width: metadata.width, height: metadata.height },
        format: metadata.format,
        location: s3Result.location
    });

    // Clear cache
    await cache.delPattern(`/api/images/${fileId}*`);

    logger.info('Image compressed successfully', { fileId, compressionRatio: ((1 - buffer.length / originalBuffer.length) * 100).toFixed(2) + '%' });

    res.status(200).json({
        success: true,
        data: {
            key: compressedKey,
            location: s3Result.location,
            originalSize: originalBuffer.length,
            compressedSize: buffer.length,
            compressionRatio: ((1 - buffer.length / originalBuffer.length) * 100).toFixed(2) + '%'
        }
    });
});

// @desc    Get image metadata
// @route   GET /api/images/:id/metadata
exports.getImageMetadata = asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    const file = await File.findById(id);
    if (!file) {
        return next(new AppError('File not found', 404));
    }

    if (file.category !== 'image') {
        return next(new AppError('File is not an image', 400));
    }

    // Download image to extract metadata
    const { Body } = await getFromS3(file.key);
    const buffer = Buffer.from(await Body.toArray());

    const metadata = await imageProcessor.getMetadata(buffer);

    res.status(200).json({
        success: true,
        data: metadata
    });
});

// @desc    Auto-orient image
// @route   POST /api/images/auto-orient
exports.autoOrientImage = asyncHandler(async (req, res, next) => {
    const { fileId } = req.body;

    if (!fileId) {
        return next(new AppError('fileId is required', 400));
    }

    const file = await File.findById(fileId);
    if (!file) {
        return next(new AppError('File not found', 404));
    }

    if (file.category !== 'image') {
        return next(new AppError('File is not an image', 400));
    }

    // Download original image
    const { Body } = await getFromS3(file.key);
    const originalBuffer = Buffer.from(await Body.toArray());

    // Auto-orient image
    const orientedBuffer = await imageProcessor.autoOrient(originalBuffer);

    // Upload oriented image
    const orientedKey = `images/oriented/${file.filename}`;
    const s3Result = await uploadToS3({ buffer: orientedBuffer, mimetype: file.mimetype }, orientedKey);

    // Update file
    file.key = orientedKey;
    file.location = s3Result.location;
    await file.save();

    // Clear cache
    await cache.delPattern(`/api/images/${fileId}*`);

    logger.info('Image auto-oriented successfully', { fileId });

    res.status(200).json({
        success: true,
        data: {
            key: orientedKey,
            location: s3Result.location
        }
    });
});
