import { Router } from 'express';
import * as storage from '../controllers/storageController';
import { authorize, protect } from '../middleware/auth';

/** Provider administration (administrators only): buckets, objects, presigned URLs. */
const router = Router();
router.use(protect, authorize('admin'));

router.get('/providers', storage.listProviders);
router.get('/providers/:provider/buckets', storage.listBuckets);
router.post('/providers/:provider/buckets', storage.createBucket);
router.delete('/providers/:provider/buckets/:bucket', storage.deleteBucket);
router.get('/providers/:provider/buckets/:bucket/objects', storage.listObjects);
router.get('/providers/:provider/buckets/:bucket/presign', storage.presign);

export default router;
