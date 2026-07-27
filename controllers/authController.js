const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { generateToken } = require('../middleware/auth');
const logger = require('../config/logger');
const { cache } = require('../config/redis');

// @desc    Register new user
// @route   POST /api/auth/register
exports.register = asyncHandler(async (req, res, next) => {
    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
        return next(new AppError('User already exists with this email', 400));
    }

    // Create user
    const user = await User.create({
        name,
        email,
        password
    });

    // Generate token
    const token = generateToken(user._id);

    logger.info('User registered successfully', { userId: user._id, email });

    res.status(201).json({
        success: true,
        token,
        data: {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                storageUsed: user.storageUsed,
                storageLimit: user.storageLimit
            }
        }
    });
});

// @desc    Login user
// @route   POST /api/auth/login
exports.login = asyncHandler(async (req, res, next) => {
    const { email, password } = req.body;

    // Check if email and password are provided
    if (!email || !password) {
        return next(new AppError('Please provide email and password', 400));
    }

    // Find user and include password
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
        return next(new AppError('Invalid credentials', 401));
    }

    // Check if user is active
    if (!user.isActive) {
        return next(new AppError('Your account has been deactivated', 401));
    }

    // Check password
    const isPasswordMatch = await user.comparePassword(password);
    if (!isPasswordMatch) {
        return next(new AppError('Invalid credentials', 401));
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    logger.info('User logged in successfully', { userId: user._id, email });

    res.status(200).json({
        success: true,
        token,
        data: {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                storageUsed: user.storageUsed,
                storageLimit: user.storageLimit,
                preferences: user.preferences
            }
        }
    });
});

// @desc    Get current user
// @route   GET /api/auth/me
exports.getMe = asyncHandler(async (req, res, next) => {
    const user = await User.findById(req.user._id);

    res.status(200).json({
        success: true,
        data: {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                storageUsed: user.storageUsed,
                storageLimit: user.storageLimit,
                fileCount: user.fileCount,
                preferences: user.preferences,
                lastLogin: user.lastLogin,
                createdAt: user.createdAt
            }
        }
    });
});

// @desc    Update user profile
// @route   PUT /api/auth/profile
exports.updateProfile = asyncHandler(async (req, res, next) => {
    const { name, preferences } = req.body;

    const user = await User.findById(req.user._id);

    if (name) user.name = name;
    if (preferences) user.preferences = { ...user.preferences, ...preferences };

    await user.save();

    // Clear cache
    await cache.delPattern(`/api/auth/*`);

    logger.info('User profile updated', { userId: user._id });

    res.status(200).json({
        success: true,
        data: {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                preferences: user.preferences
            }
        }
    });
});

// @desc    Update password
// @route   PUT /api/auth/password
exports.updatePassword = asyncHandler(async (req, res, next) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return next(new AppError('Please provide current and new password', 400));
    }

    const user = await User.findById(req.user._id).select('+password');

    // Check current password
    const isPasswordMatch = await user.comparePassword(currentPassword);
    if (!isPasswordMatch) {
        return next(new AppError('Current password is incorrect', 401));
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Generate new token
    const token = generateToken(user._id);

    logger.info('User password updated', { userId: user._id });

    res.status(200).json({
        success: true,
        token,
        message: 'Password updated successfully'
    });
});

// @desc    Logout user
// @route   POST /api/auth/logout
exports.logout = asyncHandler(async (req, res, next) => {
    // In a stateless JWT system, logout is handled client-side
    // by removing the token. Here we just log the event.
    logger.info('User logged out', { userId: req.user._id });

    res.status(200).json({
        success: true,
        message: 'Logged out successfully'
    });
});

// @desc    Delete user account
// @route   DELETE /api/auth/account
exports.deleteAccount = asyncHandler(async (req, res, next) => {
    const { password } = req.body;

    if (!password) {
        return next(new AppError('Please provide your password to confirm deletion', 400));
    }

    const user = await User.findById(req.user._id).select('+password');

    // Verify password
    const isPasswordMatch = await user.comparePassword(password);
    if (!isPasswordMatch) {
        return next(new AppError('Password is incorrect', 401));
    }

    // Deactivate user instead of deleting (soft delete)
    user.isActive = false;
    await user.save();

    logger.info('User account deactivated', { userId: user._id });

    res.status(200).json({
        success: true,
        message: 'Account deactivated successfully'
    });
});
