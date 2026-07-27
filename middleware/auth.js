const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');

// Protect routes - verify JWT token
exports.protect = asyncHandler(async (req, res, next) => {
    let token;

    // Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    // Check for token in cookies
    if (!token && req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }

    if (!token) {
        return next(new AppError('Not authorized to access this route', 401));
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Check if user still exists
        const user = await User.findById(decoded.id).select('-password');
        if (!user) {
            return next(new AppError('User no longer exists', 401));
        }

        // Check if user is active
        if (!user.isActive) {
            return next(new AppError('User account has been deactivated', 401));
        }

        // Grant access to protected route
        req.user = user;
        next();
    } catch (error) {
        return next(new AppError('Not authorized to access this route', 401));
    }
});

// Grant access to specific roles
exports.authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return next(
                new AppError(
                    `User role '${req.user.role}' is not authorized to access this route`,
                    403
                )
            );
        }
        next();
    };
};

// Generate JWT token
exports.generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '7d'
    });
};

// Optional auth - doesn't fail if no token
exports.optionalAuth = asyncHandler(async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token && req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select('-password');
            if (user && user.isActive) {
                req.user = user;
            }
        } catch (error) {
            // Token invalid, but we don't fail
            console.log('Optional auth token invalid:', error.message);
        }
    }

    next();
});

// Check file ownership
exports.checkFileOwnership = async (req, res, next) => {
    const File = require('../models/File');
    const file = await File.findById(req.params.id);

    if (!file) {
        return next(new AppError('File not found', 404));
    }

    // Check if user owns the file or is admin
    if (file.uploadedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        // Check if file is shared with user
        const isShared = file.sharedWith.some(
            share => share.user.toString() === req.user._id.toString()
        );

        if (!isShared && file.accessControl !== 'public') {
            return next(new AppError('Not authorized to access this file', 403));
        }
    }

    req.file = file;
    next();
};
