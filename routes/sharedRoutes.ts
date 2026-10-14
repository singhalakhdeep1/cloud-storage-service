import { Router } from 'express';
import * as shares from '../controllers/shareController';
import { publicLimiter } from '../middleware/rateLimits';
import { schemas, validate } from '../middleware/validation';

/** What a visitor with a share link can do (no account needed). */
const router = Router();
router.use(publicLimiter);

router.get('/:token', shares.describeLink);
router.post('/:token/download', validate(schemas.linkDownload), shares.downloadLink);
router.post('/:token/preview', validate(schemas.linkDownload), shares.previewLink);

export default router;
