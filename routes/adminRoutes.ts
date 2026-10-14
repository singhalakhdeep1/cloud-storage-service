import { Router } from 'express';
import * as admin from '../controllers/adminController';
import { authorize, protect } from '../middleware/auth';
import { schemas, validate } from '../middleware/validation';

const router = Router();
router.use(protect, authorize('admin'));

router.get('/users', admin.listUsers);
router.patch('/users/:id', validate(schemas.adminUpdateUser), admin.updateUser);
router.delete('/users/:id', admin.deleteUser);
router.post('/users/:id/recalculate-quota', admin.recalculateQuota);
router.get('/stats', admin.stats);
router.get('/system', admin.system);
router.post('/janitor/run', admin.runJanitor);

export default router;
