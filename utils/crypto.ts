/**
 * Cryptographic helpers.
 *  - Field encryption (integration tokens, webhook secrets): AES-256-GCM, stored as `v1:<iv>:<tag>:<ciphertext>` (base64url).
 *  - Signed tokens for URLs served by this API (HMAC-SHA256 over a JSON payload with an expiry).
 */
import crypto from 'crypto';
import cfg from '../config/env';

/** The 32-byte master key: ENCRYPTION_KEY, or (development only) one derived from the JWT secret. */
export function masterKey(): Buffer {
    return cfg.ENCRYPTION_KEY ? Buffer.from(cfg.ENCRYPTION_KEY, 'hex') : crypto.createHmac('sha256', cfg.JWT_SECRET).update('field-encryption/v1').digest();
}

export function encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
    const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join(':');
}

export function decrypt(payload: string): string {
    const [version, iv, tag, body] = payload.split(':');
    if (version !== 'v1' || !iv || !tag || !body) throw new Error('Decryption failed');
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
        throw new Error('Decryption failed');
    }
}

export const encryptJSON = (value: unknown): string => encrypt(JSON.stringify(value));
export const decryptJSON = <T = unknown>(payload: string): T => JSON.parse(decrypt(payload)) as T;

export const sha256 = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');
export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

/** HMAC-SHA256 hex signature. */
export const sign = (data: string, secret: string): string => crypto.createHmac('sha256', secret).update(data).digest('hex');

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ------------------------------------------------------- signed URL tokens */

/** `<base64url payload>.<signature>`; the payload always carries `exp` (unix seconds). */
export function signToken(payload: Record<string, unknown>, ttlSeconds: number): string {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
    return `${body}.${crypto.createHmac('sha256', cfg.URL_SIGNING_SECRET).update(body).digest('base64url')}`;
}

/** Returns the payload, or null when the token is malformed, tampered with or expired. */
export function verifyToken<T extends Record<string, unknown>>(token: string): (T & { exp: number }) | null {
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;
    const expected = crypto.createHmac('sha256', cfg.URL_SIGNING_SECRET).update(body).digest('base64url');
    if (!safeEqual(expected, signature)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
        return typeof payload.exp === 'number' && payload.exp >= Math.floor(Date.now() / 1000) ? payload : null;
    } catch {
        return null;
    }
}
