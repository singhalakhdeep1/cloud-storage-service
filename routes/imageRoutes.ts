import { Router } from 'express';
import * as images from '../controllers/imageController';
import { protect } from '../middleware/auth';
import { heavyLimiter } from '../middleware/rateLimits';
import { schemas, validate } from '../middleware/validation';

const router = Router();
router.use(protect);

// image processing: results are stored as variants, the original is never changed (auto-orient makes a new version)
router.post('/resize', heavyLimiter, validate(schemas.imageResize), images.resizeImage);
router.post('/thumbnail', heavyLimiter, validate(schemas.imageThumbnail), images.generateThumbnail);
router.post('/convert', heavyLimiter, validate(schemas.imageConvert), images.convertImage);
router.post('/compress', heavyLimiter, validate(schemas.imageCompress), images.compressImage);
router.post('/auto-orient', heavyLimiter, validate(schemas.imageAutoOrient), images.autoOrientImage);

router.get('/:id/variants', images.getImageVariants);
router.get('/:id/metadata', heavyLimiter, images.getImageMetadata);
router.delete('/:id/variants/:variantId', images.deleteVariant);

export default router;
