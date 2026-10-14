/**
 * Third-party integrations, configured by each user with their own credentials (kept AES-256-GCM encrypted):
 *   - Slack: post a message about a file to an incoming-webhook URL
 *   - Dropbox: copy a file into the user's Dropbox
 *   - Google Drive: copy a file into the user's Drive
 * A file is streamed to the destination (never loaded into memory) and the user must be allowed to read it.
 */
import { PassThrough } from 'stream';
import axios, { AxiosError } from 'axios';
import cfg from '../config/env';
import logger from '../config/logger';
import Integration from '../models/Integration';
import type { FileDoc, IntegrationDoc, IntegrationType, UserDoc } from '../types/models';
import AppError from '../utils/appError';
import { decryptJSON, encryptJSON } from '../utils/crypto';
import { formatBytes } from '../utils/files';
import * as fileService from './file.service';
import * as objectStore from './objectStore.service';
import { assertSafeUrl, postJson } from './webhook.service';

export const INTEGRATION_TYPES: IntegrationType[] = ['slack', 'dropbox', 'googleDrive'];

interface SlackConfig {
    webhookUrl: string;
}
interface TokenConfig {
    accessToken: string;
    folderId?: string;
}

export interface ConfigInput {
    webhookUrl?: string;
    accessToken?: string;
    folderId?: string;
}

export async function configure(user: UserDoc, type: IntegrationType, input: ConfigInput): Promise<IntegrationDoc> {
    let config: SlackConfig | TokenConfig;
    if (type === 'slack') {
        if (!input.webhookUrl) throw new AppError('webhookUrl is required', 400);
        const url = await assertSafeUrl(input.webhookUrl);
        if (cfg.isProd && !/(^|\.)slack\.com$/i.test(url.hostname)) throw new AppError('That does not look like a Slack incoming-webhook URL', 400);
        config = { webhookUrl: url.toString() };
    } else {
        if (!input.accessToken || input.accessToken.length < 8) throw new AppError('accessToken is required', 400);
        config = { accessToken: input.accessToken, folderId: input.folderId };
    }
    return (await Integration.findOneAndUpdate({ user: user._id, type }, { $set: { config: encryptJSON(config), enabled: true, lastError: undefined } }, { upsert: true, new: true, setDefaultsOnInsert: true })) as IntegrationDoc;
}

export async function remove(user: UserDoc, type: IntegrationType): Promise<void> {
    const res = await Integration.deleteOne({ user: user._id, type });
    if (!res.deletedCount) throw new AppError('That integration is not configured', 404, 'not_found');
}

/** What the API may show about the user's integrations: never a token or a URL. */
export async function status(user: UserDoc): Promise<Record<IntegrationType, { configured: boolean; enabled: boolean; status: string; lastUsedAt?: Date; lastError?: string }>> {
    const rows = await Integration.find({ user: user._id });
    const out = {} as Record<IntegrationType, { configured: boolean; enabled: boolean; status: string; lastUsedAt?: Date; lastError?: string }>;
    for (const type of INTEGRATION_TYPES) {
        const row = rows.find((r) => r.type === type);
        out[type] = row ? { configured: true, enabled: row.enabled, status: row.lastError ? 'error' : row.enabled ? 'active' : 'disabled', lastUsedAt: row.lastUsedAt, lastError: row.lastError } : { configured: false, enabled: false, status: 'not configured' };
    }
    return out;
}

async function load<T>(user: UserDoc, type: IntegrationType): Promise<{ row: IntegrationDoc; config: T }> {
    const row = (await Integration.findOne({ user: user._id, type }).select('+config')) as IntegrationDoc | null;
    if (!row || !row.enabled) throw new AppError(`${type} is not configured. Add it under Integrations first`, 400, 'integration_not_configured');
    return { row, config: decryptJSON<T>(row.config) };
}

async function record(row: IntegrationDoc, error?: string): Promise<void> {
    await Integration.updateOne({ _id: row._id }, error ? { $set: { lastError: error.slice(0, 300), lastUsedAt: new Date() } } : { $set: { lastUsedAt: new Date() }, $unset: { lastError: 1 } });
}

const describeError = (e: unknown): string => {
    if (e instanceof AxiosError) return e.response ? `${e.response.status} ${typeof e.response.data === 'string' ? e.response.data.slice(0, 120) : JSON.stringify(e.response.data ?? '').slice(0, 120)}` : e.message;
    return (e as Error).message;
};

/* ----------------------------------------------------------------- Slack */

export async function sendToSlack(user: UserDoc, file: FileDoc | null, message?: string): Promise<void> {
    const { row, config } = await load<SlackConfig>(user, 'slack');
    const text = message || (file ? `File shared: ${file.originalName}` : 'Hello from Cloud Storage');
    const body = JSON.stringify({
        text,
        ...(file && { attachments: [{ title: file.originalName, text: `Size: ${formatBytes(file.size)}\nType: ${file.mimetype}`, color: '#36a64f' }] }),
    });
    try {
        const url = await assertSafeUrl(config.webhookUrl);
        const res = await postJson(url, body, {}, 10_000);
        if (res.status < 200 || res.status >= 300) throw new Error(`Slack answered ${res.status}`);
        await record(row);
    } catch (e) {
        await record(row, (e as Error).message);
        throw new AppError(`Could not post to Slack: ${(e as Error).message}`, 502, 'integration_failed');
    }
}

/* --------------------------------------------------------------- Dropbox */

const asciiJson = (value: unknown): string => JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

export async function sendToDropbox(user: UserDoc, file: FileDoc, destination?: string): Promise<Record<string, unknown>> {
    const { row, config } = await load<TokenConfig>(user, 'dropbox');
    if (file.size > 150 * 1024 * 1024) throw new AppError('Dropbox accepts files up to 150 MB in one request', 413, 'too_large');
    const path = destination?.startsWith('/') ? destination : `/${destination || file.originalName}`;
    const { stream } = await objectStore.readObject(fileService.refOf(file));
    try {
        const res = await axios.post(cfg.DROPBOX_UPLOAD_URL, stream, {
            headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size), 'Dropbox-API-Arg': asciiJson({ path, mode: 'add', autorename: true, mute: false }) },
            maxBodyLength: Infinity,
            maxContentLength: 10 * 1024 * 1024,
            timeout: 10 * 60_000,
        });
        await record(row);
        return { path: res.data?.path_display ?? path, id: res.data?.id, size: res.data?.size };
    } catch (e) {
        stream.destroy();
        await record(row, describeError(e));
        throw new AppError(`Dropbox rejected the upload: ${describeError(e)}`, 502, 'integration_failed');
    }
}

/* ---------------------------------------------------------- Google Drive */

export async function sendToGoogleDrive(user: UserDoc, file: FileDoc, folderId?: string): Promise<Record<string, unknown>> {
    const { row, config } = await load<TokenConfig>(user, 'googleDrive');
    const parent = folderId ?? config.folderId;
    const boundary = `cloudstorage${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: file.originalName, ...(parent && { parents: [parent] }) })}\r\n--${boundary}\r\nContent-Type: ${file.mimetype}\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--`);
    const { stream: content } = await objectStore.readObject(fileService.refOf(file));
    const body = new PassThrough();
    void (async () => {
        try {
            body.write(head);
            for await (const chunk of content as AsyncIterable<Buffer>) if (!body.write(chunk)) await new Promise((r) => body.once('drain', r));
            body.end(tail);
        } catch (e) {
            body.destroy(e as Error);
        }
    })();
    try {
        const res = await axios.post(`${cfg.GOOGLE_DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,size,webViewLink`, body, {
            headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}`, 'Content-Length': String(head.length + file.size + tail.length) },
            maxBodyLength: Infinity,
            timeout: 10 * 60_000,
        });
        await record(row);
        return { id: res.data?.id, name: res.data?.name, link: res.data?.webViewLink };
    } catch (e) {
        content.destroy();
        body.destroy();
        await record(row, describeError(e));
        logger.warn('Google Drive export failed', { err: describeError(e) });
        throw new AppError(`Google Drive rejected the upload: ${describeError(e)}`, 502, 'integration_failed');
    }
}
