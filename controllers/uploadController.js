const File = require('../models/File');
const UploadSession = require('../models/UploadSession');
const User = require('../models/User');
const { uploadToS3, deleteFromS3, getFromS3 } = require('../config/s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const logger = require('../config/logger');
const virusScanner = require('../utils/virusScanner');
const { cache } = require('../config/redis');
const streamHandler = require('../utils/streamHandler');

// @desc    Initialize chunked upload
// @route   POST /api/upload/chunked
exports.initChunkedUpload = asyncHandler(async (req, res, next) => {
    const { filename, originalName, mimeType, totalSize, chunkSize } = req.body;

    if (!filename || !originalName || !mimeType || !totalSize) {
        return next(new AppError('Missing required fields', 400));
    }

    // Check storage limit
    const user = await User.findById(req.user._id);
    if (!user.hasStorageSpace(totalSize)) {
        return next(new AppError('Storage limit exceeded', 400));
    }

    const totalChunks = Math.ceil(totalSize / (chunkSize || 5 * 1024 * 1024));
    const uploadId = uuidv4();

    const session = await UploadSession.create({
        user: req.user._id,
        filename,
        originalName,
        mimeType,
        totalSize,
        chunkSize: chunkSize || 5 * 1024 * 1024,
        totalChunks,
        uploadId,
        status: 'pending'
    });

    logger.upload('Chunked upload initialized', { uploadId, totalChunks });

    res.status(201).json({
        success: true,
        data: {
            uploadId: session.uploadId,
            totalChunks: session.totalChunks,
            chunkSize: session.chunkSize
        }
    });
});

// @desc    Upload chunk
// @route   PUT /api/upload/chunked/:id
exports.uploadChunk = asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const { chunkNumber } = req.body;

    if (!req.file) {
        return next(new AppError('No file chunk provided', 400));
    }

    if (chunkNumber === undefined) {
        return next(new AppError('Chunk number required', 400));
    }

    const session = await UploadSession.findOne({ uploadId: id });
    if (!session) {
        return next(new AppError('Upload session not found', 404));
    }

    if (session.status === 'completed') {
        return next(new AppError('Upload already completed', 400));
    }

    if (session.user.toString() !== req.user._id.toString()) {
        return next(new AppError('Not authorized', 403));
    }

    // Upload chunk to S3
    const chunkKey = `chunks/${session.uploadId}/chunk-${chunkNumber}`;
    await uploadToS3(req.file, chunkKey);

    // Update session
    await session.addChunk(chunkNumber, chunkKey, req.file.size);

    logger.upload('Chunk uploaded', { uploadId: id, chunkNumber, progress: session.getProgress() });

    res.status(200).json({
        success: true,
        data: {
            chunkNumber,
            uploadedChunks: session.uploadedChunks.length,
            totalChunks: session.totalChunks,
            progress: session.getProgress()
        }
    });
});

// @desc    Complete chunked upload
// @route   POST /api/upload/chunked/:id/complete
exports.completeChunkedUpload = asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    const session = await UploadSession.findOne({ uploadId: id });
    if (!session) {
        return next(new AppError('Upload session not found', 404));
    }

    if (session.user.toString() !== req.user._id.toString()) {
        return next(new AppError('Not authorized', 403));
    }

    const user = await User.findById(req.user._id);
    if (!user) {
        return next(new AppError('User not found', 404));
    }

    if (!session.isComplete()) {
        return next(new AppError('Not all chunks uploaded', 400));
    }

    // Download and merge chunks
    const chunks = [];
    for (const chunkInfo of session.chunkKeys.sort((a, b) => a.chunkNumber - b.chunkNumber)) {
        const { Body } = await getFromS3(chunkInfo.key);
        chunks.push(Body);
    }

    const mergedBuffer = await streamHandler.mergeChunks(chunks);

    // Virus scan
    let scanResult = { clean: true, skipped: true };
    if (process.env.ENABLE_VIRUS_SCAN === 'true') {
        scanResult = await virusScanner.scanBuffer(mergedBuffer, session.originalName);
        if (!scanResult.clean) {
            // Clean up chunks
            for (const chunkInfo of session.chunkKeys) {
                await deleteFromS3(chunkInfo.key);
            }
            await session.deleteOne();
            return next(new AppError('File contains virus', 400));
        }
    }

    // Upload merged file to S3
    const finalKey = `uploads/${Date.now()}-${uuidv4()}${path.extname(session.originalName)}`;
    const s3Result = await uploadToS3({ buffer: mergedBuffer, mimetype: session.mimeType }, finalKey);

    // Clean up chunks
    for (const chunkInfo of session.chunkKeys) {
        await deleteFromS3(chunkInfo.key);
    }

    // Create file record
    const file = await File.create({
        filename: session.filename,
        originalName: session.originalName,
        mimetype: session.mimeType,
        size: session.totalSize,
        key: s3Result.key,
        location: s3Result.location,
        bucket: s3Result.bucket,
        storageType: 's3',
        uploadedBy: req.user._id,
        virusScanned: !scanResult.skipped,
        virusStatus: scanResult.clean ? 'clean' : 'error'
    });

    // Update user storage
    await user.updateStorage(session.totalSize, 'add');

    // Update session
    session.status = 'completed';
    session.fileId = file._id;
    await session.save();

    // Clear cache
    await cache.delPattern('/api/files*');

    logger.upload('Chunked upload completed', { uploadId: id, fileId: file._id });

    res.status(200).json({
        success: true,
        data: file
    });
});

// @desc    Cancel chunked upload
// @route   DELETE /api/upload/chunked/:id
exports.cancelChunkedUpload = asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    const session = await UploadSession.findOne({ uploadId: id });
    if (!session) {
        return next(new AppError('Upload session not found', 404));
    }

    if (session.user.toString() !== req.user._id.toString()) {
        return next(new AppError('Not authorized', 403));
    }

    // Clean up chunks
    for (const chunkInfo of session.chunkKeys) {
        await deleteFromS3(chunkInfo.key);
    }

    session.status = 'cancelled';
    await session.save();

    logger.upload('Chunked upload cancelled', { uploadId: id });

    res.status(200).json({
        success: true,
        message: 'Upload cancelled'
    });
});

// @desc    Get upload session status
// @route   GET /api/upload/chunked/:id/status
exports.getChunkedUploadStatus = asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    const session = await UploadSession.findOne({ uploadId: id });
    if (!session) {
        return next(new AppError('Upload session not found', 404));
    }

    if (session.user.toString() !== req.user._id.toString()) {
        return next(new AppError('Not authorized', 403));
    }

    res.status(200).json({
        success: true,
        data: {
            uploadId: session.uploadId,
            status: session.status,
            uploadedChunks: session.uploadedChunks.length,
            totalChunks: session.totalChunks,
            progress: session.getProgress(),
            missingChunks: session.getMissingChunks()
        }
    });
});

// @desc    Resume chunked upload
// @route   POST /api/upload/chunked/:id/resume
exports.resumeChunkedUpload = asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    const session = await UploadSession.findOne({ uploadId: id });
    if (!session) {
        return next(new AppError('Upload session not found', 404));
    }

    if (session.user.toString() !== req.user._id.toString()) {
        return next(new AppError('Not authorized', 403));
    }

    if (session.status === 'completed') {
        return next(new AppError('Upload already completed', 400));
    }

    session.status = 'uploading';
    await session.save();

    logger.upload('Chunked upload resumed', { uploadId: id });

    res.status(200).json({
        success: true,
        data: {
            uploadId: session.uploadId,
            uploadedChunks: session.uploadedChunks,
            missingChunks: session.getMissingChunks(),
            totalChunks: session.totalChunks
        }
    });
});
