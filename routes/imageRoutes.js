const express = require('express');
const router = express.Router();
const imageController = require('../controllers/imageController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// Image processing routes
router.post('/resize', protect, imageController.resizeImage);
router.post('/thumbnail', protect, imageController.generateThumbnail);
router.post('/convert', protect, imageController.convertImage);
router.post('/compress', protect, imageController.compressImage);
router.post('/auto-orient', protect, imageController.autoOrientImage);

// Image metadata and variants
router.get('/:id/variants', protect, imageController.getImageVariants);
router.get('/:id/metadata', protect, imageController.getImageMetadata);

module.exports = router;
