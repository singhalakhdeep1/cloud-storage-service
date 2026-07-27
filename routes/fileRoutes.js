const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const { protect } = require('../middleware/auth');
const { uploadMemory } = require('../config/multer');
const { checkFileOwnership } = require('../middleware/auth');
const { validateFileType, validateFileSize, validateStorageLimit } = require('../middleware/validation');

// Upload routes (protected)
router.post('/upload', protect, validateStorageLimit, uploadMemory.single('file'), fileController.uploadFile);
router.post('/upload-image', protect, validateStorageLimit, uploadMemory.single('image'), fileController.uploadImage);
router.post('/upload-multiple', protect, validateStorageLimit, uploadMemory.array('files', 10), fileController.uploadMultiple);

// Presigned URL (protected)
router.post('/presigned-url', protect, fileController.getPresignedUploadURL);

// File operations (protected)
router.get('/', protect, fileController.getAllFiles);
router.get('/stats', protect, fileController.getStats);
router.get('/:id', protect, checkFileOwnership, fileController.getFile);
router.get('/:id/download', protect, checkFileOwnership, fileController.downloadFile);
router.get('/:id/stream', protect, checkFileOwnership, fileController.streamFile);
router.delete('/:id', protect, checkFileOwnership, fileController.deleteFile);

module.exports = router;
