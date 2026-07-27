const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { uploadMemory } = require('../config/multer');
const { validateFileType, validateFileSize, validateStorageLimit } = require('../middleware/validation');

// Chunked upload routes
router.post('/chunked', protect, validate(validate.schemas.chunkedUploadInit), uploadController.initChunkedUpload);
router.put('/chunked/:id', protect, uploadMemory.single('chunk'), uploadController.uploadChunk);
router.post('/chunked/:id/complete', protect, uploadController.completeChunkedUpload);
router.delete('/chunked/:id', protect, uploadController.cancelChunkedUpload);
router.get('/chunked/:id/status', protect, uploadController.getChunkedUploadStatus);
router.post('/chunked/:id/resume', protect, uploadController.resumeChunkedUpload);

module.exports = router;
