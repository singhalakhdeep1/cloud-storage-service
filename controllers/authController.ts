import bcrypt from 'bcryptjs';
import cfg from '../config/env';
import logger from '../config/logger';
import { generateToken, revokeToken } from '../middleware/auth';
import { clearUserCache } from '../middleware/cache';
import User from '../models/User';
import AppError from '../utils/appError';
import asyncHandler from '../utils/asyncHandler';
import type { UserDoc } from '../types/models';

/** The user as the API shows it: never the password hash or token version. */
export const userView = (u: UserDoc): Record<string, unknown> => ({
    id: u._id,
    name: u.name,
    email: u.email,
    role: u.role,
    storageUsed: u.storageUsed,
    storageLimit: u.storageLimit,
    fileCount: u.fileCount,
    preferences: u.preferences,
    lastLogin: u.lastLogin,
    createdAt: u.createdAt,
});

// a hash to compare against when the e-mail is unknown, so "no such user" and "wrong password" take the same time
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

// @desc    Register new user
// @route   POST /api/auth/register
export const register = asyncHandler(async (req, res) => {
    if (!cfg.ALLOW_REGISTRATION) throw new AppError('Registration is closed', 403, 'registration_closed');
    const { name, email, password } = req.body as { name: string; email: string; password: string };
    if (await User.exists({ email: email.toLowerCase() })) throw new AppError('User already exists with this email', 409, 'duplicate');

    const user = (await User.create({ name, email, password, role: cfg.ADMIN_EMAIL && email.toLowerCase() === cfg.ADMIN_EMAIL ? 'admin' : 'user', storageLimit: cfg.DEFAULT_STORAGE_LIMIT })) as UserDoc;
    logger.info('User registered', { userId: String(user._id) });
    res.status(201).json({ success: true, token: generateToken(user._id, user.tokenVersion), data: { user: userView(user) } });
});

// @desc    Login user
// @route   POST /api/auth/login
export const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const user = (await User.findOne({ email: email.toLowerCase() }).select('+password')) as UserDoc | null;
    const ok = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    if (!user || !ok) throw new AppError('Invalid credentials', 401, 'invalid_credentials');
    if (!user.isActive) throw new AppError('Your account has been deactivated', 401, 'account_disabled');

    user.lastLogin = new Date();
    await user.save();
    logger.info('User logged in', { userId: String(user._id) });
    res.status(200).json({ success: true, token: generateToken(user._id, user.tokenVersion), data: { user: userView(user) } });
});

// @desc    Current user (with fresh storage numbers)
// @route   GET /api/auth/me
export const getMe = asyncHandler(async (req, res) => {
    const user = (await User.findById(req.user?._id)) as UserDoc;
    res.status(200).json({ success: true, data: { user: userView(user) } });
});

// @desc    Update profile / preferences
// @route   PUT /api/auth/profile
export const updateProfile = asyncHandler(async (req, res) => {
    const { name, preferences } = req.body as { name?: string; preferences?: Partial<UserDoc['preferences']> & { defaultStorage?: string | null } };
    const user = (await User.findById(req.user?._id)) as UserDoc;
    if (name) user.name = name;
    if (preferences) {
        const { defaultStorage, ...rest } = preferences;
        Object.assign(user.preferences, rest);
        if (defaultStorage !== undefined) user.preferences.defaultStorage = (defaultStorage ?? undefined) as UserDoc['preferences']['defaultStorage'];
        if (preferences.encryptFiles && !cfg.ENCRYPTION_KEY) throw new AppError('Encryption at rest is not set up on this server (ENCRYPTION_KEY)', 400, 'encryption_unavailable');
    }
    await user.save();
    await clearUserCache(user._id);
    res.status(200).json({ success: true, data: { user: userView(user) } });
});

// @desc    Change password (signs out every other device)
// @route   PUT /api/auth/password
export const updatePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    const user = (await User.findById(req.user?._id).select('+password')) as UserDoc;
    if (!(await user.comparePassword(currentPassword))) throw new AppError('Current password is incorrect', 401, 'invalid_credentials');
    user.password = newPassword;
    user.tokenVersion += 1; // every token issued before this moment stops working
    await user.save();
    logger.info('Password changed', { userId: String(user._id) });
    res.status(200).json({ success: true, token: generateToken(user._id, user.tokenVersion), message: 'Password updated successfully' });
});

// @desc    Sign out this device
// @route   POST /api/auth/logout
export const logout = asyncHandler(async (req, res) => {
    const header = req.headers.authorization ?? '';
    await revokeToken(header.replace(/^Bearer\s+/i, ''));
    res.status(200).json({ success: true, message: 'Logged out successfully' });
});

// @desc    Sign out every device
// @route   POST /api/auth/logout-all
export const logoutAll = asyncHandler(async (req, res) => {
    await User.updateOne({ _id: req.user?._id }, { $inc: { tokenVersion: 1 } });
    res.status(200).json({ success: true, message: 'Signed out everywhere' });
});

// @desc    Deactivate the account (files are kept; an administrator can remove them)
// @route   DELETE /api/auth/account
export const deleteAccount = asyncHandler(async (req, res) => {
    const { password } = req.body as { password: string };
    const user = (await User.findById(req.user?._id).select('+password')) as UserDoc;
    if (!(await user.comparePassword(password))) throw new AppError('Password is incorrect', 401, 'invalid_credentials');
    user.isActive = false;
    user.tokenVersion += 1;
    await user.save();
    logger.info('Account deactivated', { userId: String(user._id) });
    res.status(200).json({ success: true, message: 'Account deactivated successfully' });
});
