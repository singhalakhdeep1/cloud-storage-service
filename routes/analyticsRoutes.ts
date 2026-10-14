import { Router } from 'express';
import * as analytics from '../controllers/analyticsController';
import { protect } from '../middleware/auth';
import { cacheMiddleware } from '../middleware/cache';

const router = Router();
router.use(protect);

router.get('/dashboard', cacheMiddleware(60), analytics.dashboard);
router.get('/storage', cacheMiddleware(60), analytics.storage);

export default router;
