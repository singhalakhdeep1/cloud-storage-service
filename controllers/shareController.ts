import type { Request } from 'express';
import ShareLink from '../models/ShareLink';
import * as share from '../services/share.service';
import type { FileDoc, ShareLinkDoc, UserDoc } from '../types/models';
import asyncHandler from '../utils/asyncHandler';

const me = (req: Request): UserDoc => req.user as UserDoc;
const file = (req: Request): FileDoc => req.fileDoc as FileDoc;

/* ---- signed-in: sharing a file the caller administers ---- */

// @route GET /api/files/:id/shares
export const listShares = asyncHandler(async (req, res) => {
    res.status(200).json({ success: true, data: await share.listShares(file(req)) });
});

// @route POST /api/files/:id/shares
export const shareFile = asyncHandler(async (req, res) => {
    const updated = await share.shareWithUser(file(req), me(req), req.body as { email: string; permission: 'read' | 'write' | 'admin' }, req);
    res.status(200).json({ success: true, data: await share.listShares(updated) });
});

// @route DELETE /api/files/:id/shares/:userId
export const unshareFile = asyncHandler(async (req, res) => {
    const updated = await share.unshare(file(req), me(req), String(req.params.userId), req);
    res.status(200).json({ success: true, data: await share.listShares(updated) });
});

// @route GET /api/files/:id/links
export const listLinks = asyncHandler(async (req, res) => {
    const links = (await ShareLink.find({ file: file(req)._id }).select('+passwordHash').sort({ createdAt: -1 })) as ShareLinkDoc[];
    res.status(200).json({ success: true, data: links.map(share.linkView) });
});

// @route POST /api/files/:id/links
export const createLink = asyncHandler(async (req, res) => {
    const { link, token, url } = await share.createLink(file(req), me(req), req.body as share.LinkInput, req);
    // the token is shown once: only its hash is stored
    res.status(201).json({ success: true, data: { ...share.linkView(link), token, url } });
});

// @route DELETE /api/files/:id/links/:linkId
export const revokeLink = asyncHandler(async (req, res) => {
    await share.revokeLink(file(req), me(req), String(req.params.linkId), req);
    res.status(200).json({ success: true, message: 'Link revoked' });
});

/* ---- anonymous: opening a link ---- */

// @route GET /api/shared/:token
export const describeLink = asyncHandler(async (req, res) => {
    res.status(200).json({ success: true, data: await share.describe(String(req.params.token), req) });
});

// @route POST /api/shared/:token/download   { password?, inline? }
export const downloadLink = asyncHandler(async (req, res) => {
    const body = req.body as { password?: string; inline?: boolean };
    const password = body.password || (req.headers['x-share-password'] as string | undefined);
    const out = await share.download(String(req.params.token), password, { inline: body.inline, req });
    res.status(200).json({ success: true, ...out });
});

/** A thumbnail for the public page (only when the link allows the visitor to see the file). */
// @route POST /api/shared/:token/preview   { password? }
export const previewLink = asyncHandler(async (req, res) => {
    const body = req.body as { password?: string };
    const out = await share.download(String(req.params.token), body.password || (req.headers['x-share-password'] as string | undefined), { inline: true, req });
    res.status(200).json({ success: true, ...out });
});
