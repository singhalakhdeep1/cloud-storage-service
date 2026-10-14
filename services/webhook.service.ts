/**
 * Outbound webhooks. Users register URLs for events about their files (file.uploaded, file.deleted, file.shared ...).
 *
 *  - Each delivery is a signed POST: `X-Webhook-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`.
 *  - Failed deliveries are retried with backoff (10 s, 1 min, 5 min); the schedule is stored, so retries survive a restart.
 *  - A webhook that keeps failing is disabled.
 *  - Targets are checked against private networks (SSRF): the address that is actually connected to is validated.
 */
import crypto from 'crypto';
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import cfg from '../config/env';
import Webhook, { type WebhookDoc, type WebhookEvent } from '../models/Webhook';
import WebhookDelivery, { type WebhookDeliveryDoc } from '../models/WebhookDelivery';
import AppError from '../utils/appError';
import logger from '../config/logger';
import { decrypt, encrypt, sign } from '../utils/crypto';

const BACKOFF_MS = cfg.WEBHOOK_BACKOFF_MS.length ? cfg.WEBHOOK_BACKOFF_MS : [10_000, 60_000, 300_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const DISABLE_AFTER_FAILURES = 10;
const timers = new Set<NodeJS.Timeout>();

/* ------------------------------------------------------------------ SSRF */

export function isPrivateAddress(ip: string): boolean {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number) as [number, number];
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
    return v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
}

/** DNS lookup that refuses private addresses, so the connection cannot be pointed at the internal network. */
const safeLookup = ((hostname: string, options: dns.LookupOptions, callback: (err: Error | null, address: string | dns.LookupAddress[], family?: number) => void) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, '' as never);
        const list = (addresses as dns.LookupAddress[]).filter((a) => cfg.WEBHOOK_ALLOW_PRIVATE || !isPrivateAddress(a.address));
        if (!list.length) return callback(new Error('Target resolves to a private address'), '' as never);
        if (options.all) return callback(null, list);
        callback(null, list[0]!.address, list[0]!.family);
    });
}) as unknown as net.LookupFunction;

/** Validates a URL when a webhook is registered (the lookup check repeats at delivery time). */
export async function assertSafeUrl(raw: string): Promise<URL> {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new AppError('URL is not valid', 400);
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !cfg.isProd)) throw new AppError(cfg.isProd ? 'Webhook URLs must use https' : 'Webhook URLs must use http or https', 400);
    if (url.username || url.password) throw new AppError('Webhook URLs must not contain credentials', 400);
    if (!cfg.WEBHOOK_ALLOW_PRIVATE) {
        const host = url.hostname.replace(/^\[|\]$/g, '');
        if (net.isIP(host) ? isPrivateAddress(host) : host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new AppError('Webhook URLs must point to a public host', 400);
        if (!net.isIP(host)) {
            const addresses = await dns.promises.lookup(host, { all: true }).catch(() => []);
            if (!addresses.length) throw new AppError('Webhook host could not be resolved', 400);
            if (addresses.every((a) => isPrivateAddress(a.address))) throw new AppError('Webhook URLs must point to a public host', 400);
        }
    }
    return url;
}

export interface PostResult {
    status: number;
    ms: number;
}

export function postJson(url: URL, body: string, headers: Record<string, string>, timeoutMs: number): Promise<PostResult> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request(
            url,
            { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'cloud-storage-webhooks/2', ...headers }, lookup: safeLookup, timeout: timeoutMs },
            (res) => {
                res.resume(); // the response body is not needed
                res.on('end', () => resolve({ status: res.statusCode ?? 0, ms: Date.now() - started }));
            }
        );
        req.on('timeout', () => req.destroy(new Error('Request timed out')));
        req.on('error', reject);
        req.end(body);
    });
}

/* ------------------------------------------------------------- delivery */

export const signaturePayload = (timestamp: number, body: string): string => `${timestamp}.${body}`;

export function buildSignatureHeader(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
    return `t=${timestamp},v1=${sign(signaturePayload(timestamp, body), secret)}`;
}

/** For receivers: checks the header against the raw body (tolerance rejects replays). */
export function verifySignatureHeader(secret: string, body: string, header: string, toleranceSeconds = 300): boolean {
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!t || !parts.v1 || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
    const expected = sign(signaturePayload(t, body), secret);
    const a = Buffer.from(expected);
    const b = Buffer.from(parts.v1);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function attemptDelivery(deliveryId: string): Promise<void> {
    const delivery = await WebhookDelivery.findById(deliveryId);
    if (!delivery || delivery.status !== 'pending') return;
    const webhook = await Webhook.findById(delivery.webhook).select('+secret');
    if (!webhook || !webhook.isActive) {
        delivery.status = 'failed';
        delivery.error = 'Webhook is disabled or deleted';
        delivery.nextRetryAt = undefined;
        await delivery.save();
        return;
    }

    const body = JSON.stringify({ id: delivery.deliveryId, event: delivery.event, createdAt: delivery.createdAt.toISOString(), data: delivery.payload });
    let status = 0;
    let ms: number | undefined;
    let error: string | undefined;
    try {
        const url = await assertSafeUrl(webhook.url);
        const res = await postJson(
            url,
            body,
            { 'X-Webhook-Event': delivery.event, 'X-Webhook-ID': delivery.deliveryId, 'X-Webhook-Attempt': String(delivery.attempt), 'X-Webhook-Signature': buildSignatureHeader(decrypt(webhook.secret), body) },
            10_000
        );
        status = res.status;
        ms = res.ms;
        if (status < 200 || status >= 300) error = `Endpoint answered ${status}`;
    } catch (e) {
        error = (e as Error).message;
    }

    delivery.statusCode = status || undefined;
    delivery.responseTimeMs = ms;
    webhook.lastDeliveryAt = new Date();
    if (!error) {
        delivery.status = 'success';
        delivery.error = undefined;
        delivery.nextRetryAt = undefined;
        webhook.lastSuccessAt = new Date();
        webhook.failureCount = 0;
    } else {
        delivery.error = error;
        webhook.lastFailureAt = new Date();
        if (delivery.attempt < MAX_ATTEMPTS) {
            const wait = BACKOFF_MS[delivery.attempt - 1]!;
            delivery.nextRetryAt = new Date(Date.now() + wait);
            delivery.attempt += 1;
            scheduleAttempt(String(delivery._id), wait);
        } else {
            delivery.status = 'failed';
            delivery.nextRetryAt = undefined;
            webhook.failureCount += 1;
            if (webhook.failureCount >= DISABLE_AFTER_FAILURES) {
                webhook.isActive = false;
                webhook.disabledReason = `Disabled after ${DISABLE_AFTER_FAILURES} consecutive failed deliveries`;
                logger.security('webhook.disabled', { webhookId: String(webhook._id), url: webhook.url });
            }
        }
    }
    await Promise.all([delivery.save(), webhook.save()]);
}

function scheduleAttempt(deliveryId: string, delayMs: number): void {
    const t = setTimeout(() => {
        timers.delete(t);
        attemptDelivery(deliveryId).catch((e) => logger.error('webhook attempt failed', { err: (e as Error).message }));
    }, delayMs);
    t.unref();
    timers.add(t);
}

/** Queues a delivery to every active webhook of `ownerId` subscribed to the event. Never throws and never blocks the caller. */
export function emit(event: WebhookEvent, ownerId: unknown, data: Record<string, unknown>): void {
    void (async () => {
        try {
            const hooks = await Webhook.find({ isActive: true, userId: ownerId, events: { $in: [event, '*'] } }).select('_id');
            for (const hook of hooks) {
                const delivery = await WebhookDelivery.create({ webhook: hook._id, deliveryId: crypto.randomUUID(), event, payload: data });
                scheduleAttempt(String(delivery._id), 0);
            }
        } catch (e) {
            logger.error('webhook emit failed', { event, err: (e as Error).message });
        }
    })();
}

/** After a restart: pick up deliveries whose retry was pending. */
export async function resumePending(): Promise<number> {
    const pending = await WebhookDelivery.find({ status: 'pending' }).select('_id nextRetryAt');
    for (const d of pending) scheduleAttempt(String(d._id), Math.max(0, (d.nextRetryAt?.getTime() ?? Date.now()) - Date.now()));
    return pending.length;
}

export function stopTimers(): void {
    for (const t of timers) clearTimeout(t);
    timers.clear();
}

/* ------------------------------------------------------------ management */

export interface WebhookView {
    id: string;
    description?: string;
    events: string[];
    url: string;
    isActive: boolean;
    failureCount: number;
    disabledReason?: string;
    lastDeliveryAt?: Date;
    lastSuccessAt?: Date;
    lastFailureAt?: Date;
    createdAt: Date;
}

export const view = (w: WebhookDoc): WebhookView => ({
    id: String(w._id),
    description: w.description,
    events: w.events,
    url: w.url,
    isActive: w.isActive,
    failureCount: w.failureCount,
    disabledReason: w.disabledReason,
    lastDeliveryAt: w.lastDeliveryAt,
    lastSuccessAt: w.lastSuccessAt,
    lastFailureAt: w.lastFailureAt,
    createdAt: w.createdAt,
});

export const newSecret = (): string => `whsec_${crypto.randomBytes(24).toString('hex')}`;
export { encrypt as encryptSecret };

/** Sends a "ping" immediately so the owner can see whether the endpoint works. */
export async function sendTest(webhook: WebhookDoc): Promise<WebhookDeliveryDoc> {
    const delivery = await WebhookDelivery.create({ webhook: webhook._id, deliveryId: crypto.randomUUID(), event: 'ping', payload: { message: 'Test delivery from Cloud Storage Service' }, attempt: MAX_ATTEMPTS });
    await attemptDelivery(String(delivery._id));
    return (await WebhookDelivery.findById(delivery._id)) as WebhookDeliveryDoc;
}
