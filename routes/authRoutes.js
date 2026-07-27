const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// Public routes
router.post('/register', validate(validate.schemas.register), authController.register);
router.post('/login', validate(validate.schemas.login), authController.login);

// Protected routes
router.get('/me', protect, authController.getMe);
router.put('/profile', protect, authController.updateProfile);
router.put('/password', protect, authController.updatePassword);
router.post('/logout', protect, authController.logout);
router.delete('/account', protect, authController.deleteAccount);

module.exports = router;
