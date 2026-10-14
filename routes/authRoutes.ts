import { Router } from 'express';
import * as auth from '../controllers/authController';
import { protect } from '../middleware/auth';
import { loginLimiter, registerLimiter } from '../middleware/rateLimits';
import { schemas, validate } from '../middleware/validation';

const router = Router();

// public
router.post('/register', registerLimiter, validate(schemas.register), auth.register);
router.post('/login', validate(schemas.login), loginLimiter, auth.login);

// signed in
router.get('/me', protect, auth.getMe);
router.put('/profile', protect, validate(schemas.updateProfile), auth.updateProfile);
router.put('/password', protect, validate(schemas.updatePassword), auth.updatePassword);
router.post('/logout', protect, auth.logout);
router.post('/logout-all', protect, auth.logoutAll);
router.delete('/account', protect, validate(schemas.deleteAccount), auth.deleteAccount);

export default router;
