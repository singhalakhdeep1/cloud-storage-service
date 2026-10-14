import { Router } from 'express';
import * as storage from '../controllers/storageController';
import { publicLimiter } from '../middleware/rateLimits';

/** Signed content links (encrypted files are decrypted while they stream). */
const router = Router();
router.get('/:token', publicLimiter, storage.serveContent);
router.head('/:token', publicLimiter, storage.serveContent);

export default router;
