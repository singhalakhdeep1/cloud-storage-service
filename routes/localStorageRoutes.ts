import { Router } from 'express';
import * as storage from '../controllers/storageController';

/**
 * Signed URLs for the local-disk provider. The signature in `?token=` is the only credential, and the raw upload body
 * must not go through the JSON parser, so this router is mounted before the body parsers.
 */
const router = Router();
router.get('/object', storage.serveLocalObject);
router.head('/object', storage.serveLocalObject);
router.put('/upload', storage.acceptLocalUpload);

export default router;
