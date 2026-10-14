import type { Request } from 'express';
import File from '../models/File';
import Integration from '../models/Integration';
import PendingUpload from '../models/PendingUpload';
import ShareLink from '../models/ShareLink';
import UploadSession from '../models/UploadSession';
import User from '../models/User';
import Webhook from '../models/Webhook';
import WebhookDelivery from '../models/WebhookDelivery';
import { redisHealthy } from '../config/redis';
import * as analytics from '../services/analytics.service';
import * as fileService from '../services/file.service';
import * as janitor from '../services/janitor.service';
import * as quota from '../services/quota.service';
import * as upload from '../services/upload.service';
import { configuredProviders, defaultProviderName, tryGetStorage } from '../services/storage/registry';
import { PROVIDER_NAMES, type FileDoc, type UploadSessionDoc, type UserDoc } from '../types/models';
import AppError from '../utils/appError';
import asyncHandler from '../utils/asyncHandler';
import { escapeRegex } from '../utils/files';
import virusScanner from '../utils/virusScanner';
import { userView } from './authController';

const target = async (req: Request): Promise<UserDoc> => {
    const u = (await User.findById(req.params.id)) as UserDoc | null;
    if (!u) throw new AppError('User not found', 404, 'not_found');
    return u;
};

// @route GET /api/admin/users?search=&page=&limit=
export const listUsers = asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const filter = search ? { $or: [{ email: new RegExp(escapeRegex(search), 'i') }, { name: new RegExp(escapeRegex(search), 'i') }] } : {};
    const [users, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), User.countDocuments(filter)]);
    res.status(200).json({ success: true, data: { users: users.map((u) => ({ ...userView(u as UserDoc), isActive: u.isActive })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

// @route PATCH /api/admin/users/:id   { isActive?, role?, storageLimit? }
export const updateUser = asyncHandler(async (req, res) => {
    const user = await target(req);
    const body = req.body as { isActive?: boolean; role?: 'user' | 'admin'; storageLimit?: number };
    if (String(user._id) === String(req.user?._id) && (body.isActive === false || (body.role && body.role !== 'admin'))) throw new AppError('You cannot lock yourself out of administration', 400, 'self_lockout');
    if (body.storageLimit !== undefined && body.storageLimit < user.storageUsed) throw new AppError(`The limit cannot be lower than the space already used (${user.storageUsed} bytes)`, 400);
    if (body.isActive !== undefined) {
        user.isActive = body.isActive;
        if (!body.isActive) user.tokenVersion += 1; // sign them out
    }
    if (body.role) user.role = body.role;
    if (body.storageLimit !== undefined) user.storageLimit = body.storageLimit;
    await user.save();
    res.status(200).json({ success: true, data: { ...userView(user), isActive: user.isActive } });
});

// @route DELETE /api/admin/users/:id  - removes the account and everything it owns
export const deleteUser = asyncHandler(async (req, res) => {
    const user = await target(req);
    if (String(user._id) === String(req.user?._id)) throw new AppError('You cannot delete your own account here', 400, 'self_delete');
    for (const s of (await UploadSession.find({ user: user._id, status: { $in: ['pending', 'uploading', 'paused'] } })) as UploadSessionDoc[]) await upload.expire(s);
    const files = (await File.find({ uploadedBy: user._id })) as FileDoc[];
    for (const f of files) await fileService.purge(f);
    // shares others hold on this user's files went with the files; remove this user from files shared with them
    await File.updateMany({ 'sharedWith.user': user._id }, { $pull: { sharedWith: { user: user._id } } });
    const hooks = await Webhook.find({ userId: user._id }).select('_id');
    await Promise.all([
        ShareLink.deleteMany({ createdBy: user._id }),
        Integration.deleteMany({ user: user._id }),
        PendingUpload.deleteMany({ user: user._id }),
        WebhookDelivery.deleteMany({ webhook: { $in: hooks.map((h) => h._id) } }),
        Webhook.deleteMany({ userId: user._id }),
    ]);
    await user.deleteOne();
    res.status(200).json({ success: true, message: 'User and all their files deleted', files: files.length });
});

// @route POST /api/admin/users/:id/recalculate-quota
export const recalculateQuota = asyncHandler(async (req, res) => {
    const user = await target(req);
    res.status(200).json({ success: true, data: await quota.recalculate(user._id) });
});

// @route GET /api/admin/stats
export const stats = asyncHandler(async (_req, res) => {
    res.status(200).json({ success: true, data: await analytics.overall() });
});

// @route POST /api/admin/janitor/run
export const runJanitor = asyncHandler(async (_req, res) => {
    res.status(200).json({ success: true, data: await janitor.runOnce({ force: true }) });
});

// @route GET /api/admin/system   - what is configured and whether it is reachable
export const system = asyncHandler(async (_req, res) => {
    const providers = await Promise.all(
        PROVIDER_NAMES.map(async (name) => {
            const p = tryGetStorage(name);
            if (!p) return { name, configured: false, isDefault: name === defaultProviderName() };
            try {
                await p.ping();
                return { name, configured: true, healthy: true, bucket: p.bucket, isDefault: name === defaultProviderName() };
            } catch (e) {
                return { name, configured: true, healthy: false, bucket: p.bucket, error: (e as Error).message, isDefault: name === defaultProviderName() };
            }
        })
    );
    res.status(200).json({ success: true, data: { providers, configured: configuredProviders(), redis: await redisHealthy(), virusScanner: await virusScanner.healthy() } });
});
