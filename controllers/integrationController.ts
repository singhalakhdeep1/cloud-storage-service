import type { Request } from 'express';
import File from '../models/File';
import Webhook, { WEBHOOK_EVENTS, type WebhookDoc } from '../models/Webhook';
import WebhookDelivery from '../models/WebhookDelivery';
import * as access from '../services/access.service';
import * as activity from '../services/activity.service';
import * as integrations from '../services/integration.service';
import * as webhooks from '../services/webhook.service';
import type { FileDoc, IntegrationType, UserDoc } from '../types/models';
import AppError from '../utils/appError';
import asyncHandler from '../utils/asyncHandler';

const me = (req: Request): UserDoc => req.user as UserDoc;

async function readable(req: Request, id: string): Promise<FileDoc> {
    const f = (await File.findById(id)) as FileDoc | null;
    if (!f || f.deletedAt) throw new AppError('File not found', 404, 'not_found');
    if (!access.can(f, me(req), 'read')) throw new AppError('Not authorized to access this file', 403, 'forbidden');
    return f;
}

const typeOf = (raw: string): IntegrationType => {
    const t = ({ slack: 'slack', dropbox: 'dropbox', 'google-drive': 'googleDrive', googleDrive: 'googleDrive' } as Record<string, IntegrationType>)[raw];
    if (!t) throw new AppError('Unknown integration (slack, dropbox or google-drive)', 404, 'not_found');
    return t;
};

/* ---- connections ---- */

// @route GET /api/integrations (and /status)
export const getStatus = asyncHandler(async (req, res) => {
    const status = await integrations.status(me(req));
    res.status(200).json({ success: true, integrations: { slack: status.slack, dropbox: status.dropbox, googleDrive: status.googleDrive } });
});

// @route PUT /api/integrations/:type
export const configure = asyncHandler(async (req, res) => {
    await integrations.configure(me(req), typeOf(String(req.params.type)), req.body as integrations.ConfigInput);
    res.status(200).json({ success: true, integrations: await integrations.status(me(req)) });
});

// @route DELETE /api/integrations/:type
export const disconnect = asyncHandler(async (req, res) => {
    await integrations.remove(me(req), typeOf(String(req.params.type)));
    res.status(200).json({ success: true, message: 'Integration removed' });
});

/* ---- actions ---- */

// @route POST /api/integrations/slack
export const slack = asyncHandler(async (req, res) => {
    const { fileId, message } = req.body as { fileId?: string; message?: string };
    const f = fileId ? await readable(req, fileId) : null;
    await integrations.sendToSlack(me(req), f, message);
    res.status(200).json({ success: true, message: 'Notification sent to Slack' });
});

// @route POST /api/integrations/dropbox
export const dropbox = asyncHandler(async (req, res) => {
    const { fileId, path } = req.body as { fileId: string; path?: string };
    const f = await readable(req, fileId);
    const data = await integrations.sendToDropbox(me(req), f, path);
    activity.record(f._id, me(req)._id, 'integration_export', req, { to: 'dropbox' });
    res.status(200).json({ success: true, data });
});

// @route POST /api/integrations/google-drive
export const googleDrive = asyncHandler(async (req, res) => {
    const { fileId, folderId } = req.body as { fileId: string; folderId?: string };
    const f = await readable(req, fileId);
    const data = await integrations.sendToGoogleDrive(me(req), f, folderId);
    activity.record(f._id, me(req)._id, 'integration_export', req, { to: 'googleDrive' });
    res.status(200).json({ success: true, data });
});

/* ---- outbound webhooks ---- */

const hookView = (w: WebhookDoc) => webhooks.view(w);

const ownHook = async (req: Request): Promise<WebhookDoc> => {
    const w = (await Webhook.findOne({ _id: req.params.id, userId: me(req)._id }).select('+secret')) as WebhookDoc | null;
    if (!w) throw new AppError('Webhook not found', 404, 'not_found');
    return w;
};

// @route GET /api/integrations/webhooks
export const listWebhooks = asyncHandler(async (req, res) => {
    const list = (await Webhook.find({ userId: me(req)._id }).sort({ createdAt: -1 })) as WebhookDoc[];
    res.status(200).json({ success: true, data: list.map(hookView), events: WEBHOOK_EVENTS });
});

// @route POST /api/integrations/webhooks
export const createWebhook = asyncHandler(async (req, res) => {
    const body = req.body as { url: string; events: string[]; description?: string };
    if ((await Webhook.countDocuments({ userId: me(req)._id })) >= 10) throw new AppError('At most 10 webhooks per account', 400, 'limit');
    await webhooks.assertSafeUrl(body.url);
    const secret = webhooks.newSecret();
    const w = (await Webhook.create({ userId: me(req)._id, url: body.url, events: body.events, description: body.description, secret: webhooks.encryptSecret(secret) })) as WebhookDoc;
    // the signing secret is shown once
    res.status(201).json({ success: true, data: { ...hookView(w), secret } });
});

// @route PATCH /api/integrations/webhooks/:id
export const updateWebhook = asyncHandler(async (req, res) => {
    const w = await ownHook(req);
    const body = req.body as { url?: string; events?: string[]; description?: string; isActive?: boolean };
    if (body.url) {
        await webhooks.assertSafeUrl(body.url);
        w.url = body.url;
    }
    if (body.events) w.events = body.events;
    if (body.description !== undefined) w.description = body.description;
    if (body.isActive !== undefined) {
        w.isActive = body.isActive;
        if (body.isActive) {
            w.failureCount = 0;
            w.disabledReason = undefined;
        }
    }
    await w.save();
    res.status(200).json({ success: true, data: hookView(w) });
});

// @route POST /api/integrations/webhooks/:id/rotate-secret
export const rotateWebhookSecret = asyncHandler(async (req, res) => {
    const w = await ownHook(req);
    const secret = webhooks.newSecret();
    w.secret = webhooks.encryptSecret(secret);
    await w.save();
    res.status(200).json({ success: true, data: { ...hookView(w), secret } });
});

// @route DELETE /api/integrations/webhooks/:id
export const deleteWebhook = asyncHandler(async (req, res) => {
    const w = await ownHook(req);
    await WebhookDelivery.deleteMany({ webhook: w._id });
    await w.deleteOne();
    res.status(200).json({ success: true, message: 'Webhook deleted' });
});

// @route POST /api/integrations/webhooks/:id/test
export const testWebhook = asyncHandler(async (req, res) => {
    const w = await ownHook(req);
    const d = await webhooks.sendTest(w);
    res.status(200).json({ success: true, data: { status: d.status, statusCode: d.statusCode, error: d.error, responseTimeMs: d.responseTimeMs } });
});

// @route GET /api/integrations/webhooks/:id/deliveries
export const webhookDeliveries = asyncHandler(async (req, res) => {
    const w = await ownHook(req);
    const rows = await WebhookDelivery.find({ webhook: w._id }).sort({ createdAt: -1 }).limit(50).select('-payload');
    res.status(200).json({ success: true, data: rows });
});
