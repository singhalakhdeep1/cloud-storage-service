const File = require('../models/File');
const { uploadToS3, deleteFromS3, getPresignedUrl, getPresignedUploadUrl } = require('../config/s3');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const mime = require('mime-types');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');

// @desc    Upload single file to S3
// @route   POST /api/files/upload
exports.uploadFile = asyncHandler(async (req, res, next) => {
    if (!req.file) {
        return next(new AppError('Please upload a file', 400));
    }

    const key = `uploads/${Date.now()}-${uuidv4()}${path.extname(req.file.originalname)}`;

    // Upload to S3
    const s3Result = await uploadToS3(req.file, key);

    // Save to database
    const file = await File.create({
        filename: req.file.originalname,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        key: s3Result.key,
        location: s3Result.location,
        bucket: s3Result.bucket,
        storageType: 's3',
        category: getCategoryFromMimetype(req.file.mimetype),
        uploadedBy: req.user?._id,
        isPublic: req.body.isPublic || false
    });

    res.status(201).json({
        success: true,
        data: file
    });
});

// @desc    Upload and process image
// @route   POST /api/files/upload-image
exports.uploadImage = asyncHandler(async (req, res, next) => {
    if (!req.file) {
        return next(new AppError('Please upload an image', 400));
    }

    // Process image with Sharp
    const processedImage = await sharp(req.file.buffer)
        .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();

    // Get metadata
    const metadata = await sharp(processedImage).metadata();

    const key = `images/${Date.now()}-${uuidv4()}.jpg`;

    // Upload to S3
    const s3Result = await uploadToS3({
        buffer: processedImage,
        mimetype: 'image/jpeg'
    }, key);

    // Save to database
    const file = await File.create({
        filename: req.file.originalname,
        originalName: req.file.originalname,
        mimetype: 'image/jpeg',
        size: processedImage.length,
        key: s3Result.key,
        location: s3Result.location,
        bucket: s3Result.bucket,
        storageType: 's3',
        category: 'image',
        uploadedBy: req.user?._id,
        metadata: {
            width: metadata.width,
            height: metadata.height,
            compressed: true
        }
    });

    res.status(201).json({
        success: true,
        data: file
    });
});

// @desc    Upload multiple files
// @route   POST /api/files/upload-multiple
exports.uploadMultiple = asyncHandler(async (req, res, next) => {
    if (!req.files || req.files.length === 0) {
        return next(new AppError('Please upload files', 400));
    }

    const uploadPromises = req.files.map(async (file) => {
        const key = `uploads/${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
        const s3Result = await uploadToS3(file, key);

        return File.create({
            filename: file.originalname,
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            key: s3Result.key,
            location: s3Result.location,
            bucket: s3Result.bucket,
            storageType: 's3',
            category: getCategoryFromMimetype(file.mimetype),
            uploadedBy: req.user?._id
        });
    });

    const files = await Promise.all(uploadPromises);

    res.status(201).json({
        success: true,
        count: files.length,
        data: files
    });
});

// @desc    Get file by ID
// @route   GET /api/files/:id
exports.getFile = asyncHandler(async (req, res, next) => {
    const file = await File.findById(req.params.id);

    if (!file) {
        return next(new AppError('File not found', 404));
    }

    res.status(200).json({
        success: true,
        data: file
    });
});

// @desc    Get all files with pagination
// @route   GET /api/files
exports.getAllFiles = asyncHandler(async (req, res, next) => {
    const { page = 1, limit = 10, category, search } = req.query;

    const query = {};
    if (category) query.category = category;
    if (search) query.originalName = { $regex: search, $options: 'i' };

    const files = await File.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

    const total = await File.countDocuments(query);

    res.status(200).json({
        success: true,
        data: {
            files,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        }
    });
});

// @desc    Download file (with presigned URL)
// @route   GET /api/files/:id/download
exports.downloadFile = asyncHandler(async (req, res, next) => {
    const file = await File.findById(req.params.id);

    if (!file) {
        return next(new AppError('File not found', 404));
    }

    // Generate presigned URL
    const url = await getPresignedUrl(file.key, 300); // 5 minutes

    // Increment download count
    await file.incrementDownloads();

    res.status(200).json({
        success: true,
        url,
        expiresIn: 300
    });
});

// @desc    Stream file
// @route   GET /api/files/:id/stream
exports.streamFile = asyncHandler(async (req, res, next) => {
    const file = await File.findById(req.params.id);

    if (!file) {
        return next(new AppError('File not found', 404));
    }

    const { Body } = await require('../config/s3').getFromS3(file.key);

    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
    // Cache for 1 year (CDN and Browser caching) - #1101-1170: Caching
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    Body.pipe(res);
});

// @desc    Delete file
// @route   DELETE /api/files/:id
exports.deleteFile = asyncHandler(async (req, res, next) => {
    const file = await File.findById(req.params.id);

    if (!file) {
        return next(new AppError('File not found', 404));
    }

    // Delete from S3
    await deleteFromS3(file.key);

    // Delete from database
    await file.deleteOne();

    res.status(200).json({
        success: true,
        message: 'File deleted successfully'
    });
});

// @desc    Get presigned upload URL
// @route   POST /api/files/presigned-url
exports.getPresignedUploadURL = asyncHandler(async (req, res, next) => {
    const { filename, contentType } = req.body;

    if (!filename || !contentType) {
        return next(new AppError('Filename and content type are required', 400));
    }

    const key = `uploads/${Date.now()}-${uuidv4()}${path.extname(filename)}`;
    const url = await getPresignedUploadUrl(key, contentType, 300);

    res.status(200).json({
        success: true,
        url,
        key,
        expiresIn: 300
    });
});

// @desc    Get storage statistics
// @route   GET /api/files/stats
exports.getStats = asyncHandler(async (req, res, next) => {
    const stats = await File.getStorageStats();
    const totalFiles = await File.countDocuments();

    res.status(200).json({
        success: true,
        data: {
            totalFiles,
            byCategory: stats
        }
    });
});

// Helper function
function getCategoryFromMimetype(mimetype) {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype.includes('pdf') || mimetype.includes('document')) return 'document';
    return 'other';
}
