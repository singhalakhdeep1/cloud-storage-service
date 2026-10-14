/**
 * Sharing: with other users (a permission on the file) and with anyone through a link (a random token, optionally
 * with a password, an expiry and a download limit). Only a hash of the link token is stored.
 */
import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { Types } from 'mongoose';
import cfg from '../config/env';
import File from '../models/File';
import ShareLink from '../models/ShareLink';
import User from '../models/User';
import type { FileDoc, Permission, ShareLinkDoc, UserDoc } from '../types/models';
import AppError from '../utils/appError';
import { randomToken, sha256 } from '../utils/crypto';
import { CacheService } from './cache/cache.service';
import * as activity from './activity.service';
import * as fileService from './file.service';
import * as objectStore from './objectStore.service';
import * as webhooks from './webhook.service';

const attempts = new CacheService('share-attempts');

/* ---------------------------------------------------------- user to user */

export async function shareWithUser(file: FileDoc, actor: UserDoc, input: { email: string; permission: Permission }, req?: Request): Promise<FileDoc> {
    const target = await User.findOne({ email: input.email.trim().toLowerCase(), isActive: true });
    if (!target) throw new AppError('No user with that email address', 404, 'user_not_found');
    if (String(target._id) === String(file.uploadedBy)) throw new AppError('The owner already has full access', 400);
    const existing = file.sharedWith.find((s) => String(s.user) === String(target._id));
    if (existing) {
        await File.updateOne({ _id: file._id, 'sharedWith.user': target._id }, { $set: { 'sharedWith.$.permission': input.permission } });
    } else {
        await File.updateOne({ _id: file._id }, { $push: { sharedWith: { user: target._id, permission: input.permission, sharedAt: new Date() } }, ...(file.accessControl === 'private' && { $set: { accessControl: 'shared' } }) });
    }
    activity.record(file._id, actor._id, 'share', req, { with: String(target._id), permission: input.permission });
    webhooks.emit('file.shared', file.uploadedBy, { fileId: String(file._id), name: file.originalName, with: target.email, permission: input.permission });
    return (await File.findById(file._id)) as FileDoc;
}

export async function unshare(file: FileDoc, actor: UserDoc, userId: string, req?: Request): Promise<FileDoc> {
    if (!file.sharedWith.some((s) => String(s.user) === userId)) throw new AppError('The file is not shared with that user', 404, 'not_found');
    await File.updateOne({ _id: file._id }, { $pull: { sharedWith: { user: new Types.ObjectId(userId) } } });
    const after = (await File.findById(file._id)) as FileDoc;
    if (after.sharedWith.length === 0 && after.accessControl === 'shared') await File.updateOne({ _id: file._id }, { $set: { accessControl: after.isPublic ? 'public' : 'private' } });
    activity.record(file._id, actor._id, 'unshare', req, { with: userId });
    webhooks.emit('file.unshared', file.uploadedBy, { fileId: String(file._id), name: file.originalName, with: userId });
    return (await File.findById(file._id)) as FileDoc;
}

/** Who a file is shared with, with names (for the sharing dialog). */
export async function listShares(file: FileDoc): Promise<{ userId: string; name: string; email: string; permission: Permission; sharedAt: Date }[]> {
    const users = await User.find({ _id: { $in: file.sharedWith.map((s) => s.user) } }).select('name email');
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return file.sharedWith.map((s) => ({ userId: String(s.user), name: byId.get(String(s.user))?.name ?? 'Unknown', email: byId.get(String(s.user))?.email ?? '', permission: s.permission, sharedAt: s.sharedAt }));
}

/* ------------------------------------------------------------------ links */

export interface LinkInput {
    expiresInHours?: number;
    password?: string;
    maxDownloads?: number;
    permission?: 'view' | 'download';
    label?: string;
}

export const linkView = (l: ShareLinkDoc): Record<string, unknown> => ({
    id: String(l._id),
    label: l.label,
    permission: l.permission,
    expiresAt: l.expiresAt,
    maxDownloads: l.maxDownloads,
    downloadCount: l.downloadCount,
    accessCount: l.accessCount,
    lastAccessedAt: l.lastAccessedAt,
    revokedAt: l.revokedAt,
    createdAt: l.createdAt,
    hasPassword: Boolean((l as unknown as { passwordHash?: string }).passwordHash) || undefined,
    status: statusOf(l),
});

function statusOf(l: ShareLinkDoc): 'active' | 'revoked' | 'expired' | 'exhausted' {
    if (l.revokedAt) return 'revoked';
    if (l.expiresAt && l.expiresAt.getTime() < Date.now()) return 'expired';
    if (l.maxDownloads && l.downloadCount >= l.maxDownloads) return 'exhausted';
    return 'active';
}

/** Returns the link and the one-time token (the only moment it can be seen). */
export async function createLink(file: FileDoc, actor: UserDoc, input: LinkInput, req?: Request): Promise<{ link: ShareLinkDoc; token: string; url: string }> {
    const token = randomToken(32);
    const link = await ShareLink.create({
        file: file._id,
        createdBy: actor._id,
        tokenHash: sha256(token),
        label: input.label,
        permission: input.permission ?? 'download',
        passwordHash: input.password ? await bcrypt.hash(input.password, 10) : undefined,
        expiresAt: input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3600_000) : undefined,
        maxDownloads: input.maxDownloads,
    });
    activity.record(file._id, actor._id, 'link_create', req, { linkId: String(link._id) });
    webhooks.emit('link.created', file.uploadedBy, { fileId: String(file._id), name: file.originalName, linkId: String(link._id) });
    return { link, token, url: `${cfg.CLIENT_URL[0] ?? cfg.PUBLIC_URL}/shared/${token}` };
}

export async function revokeLink(file: FileDoc, actor: UserDoc, linkId: string, req?: Request): Promise<void> {
    const res = await ShareLink.updateOne({ _id: linkId, file: file._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
    if (!res.matchedCount) throw new AppError('Link not found', 404, 'not_found');
    activity.record(file._id, actor._id, 'link_revoke', req, { linkId });
    webhooks.emit('link.revoked', file.uploadedBy, { fileId: String(file._id), linkId });
}

/** Finds an active link by its token and the file behind it; 404 for anything unusable (no hints about why). */
export async function resolve(token: string): Promise<{ link: ShareLinkDoc; file: FileDoc }> {
    const link = (await ShareLink.findOne({ tokenHash: sha256(token) }).select('+passwordHash')) as ShareLinkDoc | null;
    const gone = new AppError('This link is not valid any more', 404, 'link_invalid');
    if (!link || statusOf(link) === 'revoked' || statusOf(link) === 'expired') throw gone;
    const file = (await File.findById(link.file)) as FileDoc | null;
    if (!file || file.deletedAt || (file.expiresAt && file.expiresAt.getTime() < Date.now())) throw gone;
    return { link, file };
}

/** What a visitor may see before they download. */
export async function describe(token: string, req?: Request): Promise<Record<string, unknown>> {
    const { link, file } = await resolve(token);
    await ShareLink.updateOne({ _id: link._id }, { $inc: { accessCount: 1 }, $set: { lastAccessedAt: new Date() } });
    void req;
    const owner = await User.findById(file.uploadedBy).select('name');
    const thumb = file.getVariant('thumbnail');
    return {
        name: file.originalName,
        size: file.size,
        mimetype: file.mimetype,
        category: file.category,
        sharedBy: owner?.name,
        requiresPassword: Boolean((link as unknown as { passwordHash?: string }).passwordHash),
        permission: link.permission,
        expiresAt: link.expiresAt,
        remainingDownloads: link.maxDownloads ? Math.max(0, link.maxDownloads - link.downloadCount) : undefined,
        hasPreview: Boolean(thumb),
    };
}

/** Checks the password (limited attempts), counts the download atomically and returns a short-lived URL. */
export async function download(token: string, password: string | undefined, options: { inline?: boolean; req?: Request } = {}): Promise<{ url: string; name: string; expiresIn: number }> {
    const { link, file } = await resolve(token);
    if (link.permission !== 'download' && !options.inline) throw new AppError('This link only allows viewing', 403, 'view_only');
    const hash = (link as unknown as { passwordHash?: string }).passwordHash;
    if (hash) {
        const key = `${String(link._id)}:${options.req?.ip ?? 'unknown'}`;
        if ((await attempts.incr(key, 15 * 60)) > 10) throw new AppError('Too many wrong passwords, try again later', 429, 'too_many_attempts');
        if (!password || !(await bcrypt.compare(password, hash))) throw new AppError('Wrong password', 401, 'wrong_password');
    }
    // the download limit is enforced by the update itself, so parallel requests cannot exceed it
    const counted = await ShareLink.findOneAndUpdate(
        { _id: link._id, revokedAt: { $exists: false }, ...(link.maxDownloads && { $expr: { $lt: ['$downloadCount', link.maxDownloads] } }) },
        { $inc: { downloadCount: options.inline ? 0 : 1 }, $set: { lastAccessedAt: new Date() } }
    );
    if (!counted) throw new AppError('This link has reached its download limit', 410, 'link_exhausted');
    await File.updateOne({ _id: file._id }, { $inc: { downloadCount: 1 }, $set: { lastAccessedAt: new Date() } });
    activity.record(file._id, undefined, 'link_download', options.req, { linkId: String(link._id) });
    const expiresIn = 300;
    const url = await objectStore.contentUrl(fileService.refOf(file), { expiresIn, filename: file.originalName, inline: options.inline, fileId: String(file._id) });
    return { url, name: file.originalName, expiresIn };
}
