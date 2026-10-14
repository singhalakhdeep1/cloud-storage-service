import { Router } from 'express';
import { uploadChunk } from '../config/multer';
import * as uploads from '../controllers/uploadController';
import { protect } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimits';
import { schemas, validate } from '../middleware/validation';

const router = Router();
router.use(protect);

// resumable (chunked) uploads
router.post('/chunked', uploadLimiter, validate(schemas.chunkedUploadInit), uploads.initChunkedUpload);
router.get('/chunked', uploads.listChunkedUploads);
router.put('/chunked/:id', uploadLimiter, uploadChunk.single('chunk'), uploads.uploadChunk);
router.post('/chunked/:id/complete', uploads.completeChunkedUpload);
router.post('/chunked/:id/pause', uploads.pauseChunkedUpload);
router.post('/chunked/:id/resume', uploads.resumeChunkedUpload);
router.get('/chunked/:id/status', uploads.getChunkedUploadStatus);
router.delete('/chunked/:id', uploads.cancelChunkedUpload);

export default router;
