const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const { uploadMemory } = require('../config/multer');

// Upload routes
router.post('/upload', uploadMemory.single('file'), fileController.uploadFile);
router.post('/upload-image', uploadMemory.single('image'), fileController.uploadImage);
router.post('/upload-multiple', uploadMemory.array('files', 10), fileController.uploadMultiple);

// Presigned URL
router.post('/presigned-url', fileController.getPresignedUploadURL);

// File operations
router.get('/', fileController.getAllFiles);
router.get('/stats', fileController.getStats);
router.get('/:id', fileController.getFile);
router.get('/:id/download', fileController.downloadFile);
router.get('/:id/stream', fileController.streamFile);
router.delete('/:id', fileController.deleteFile);

module.exports = router;
