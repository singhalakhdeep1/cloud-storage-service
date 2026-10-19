/**
 * End-to-end (client-side) encryption. The browser or SDK encrypts the file before it leaves the device and the
 * server only ever stores ciphertext plus the parameters below, none of which is secret: without the passphrase they
 * reveal nothing about the content.
 *
 * Scheme `pbkdf2-aes256gcm-v1`:
 *   key   = PBKDF2-SHA256(passphrase, salt, iterations) -> 256-bit AES key
 *   the plain content is cut into `segmentSize` pieces; piece i is AES-256-GCM encrypted with the nonce
 *   noncePrefix (8 bytes) || i (4 bytes, big-endian) and the additional data "pbkdf2-aes256gcm-v1:<i>:<pieces>",
 *   so every piece carries its own 16-byte tag and is bound to its position and to the number of pieces
 *   ciphertext = all pieces in order
 * The SDK (sdk/fileCloudSDK.ts: encryptBlob / decryptBuffer) implements both directions.
 * Pieces keep large files streamable and let a reader detect a truncated or reordered file.
 */
import Joi from 'joi';
import type { ClientEncryption } from '../types/models';
import AppError from './appError';
import { isAllowed } from './mime';

export const CLIENT_ENCRYPTION_SCHEME = 'pbkdf2-aes256gcm-v1';
export const GCM_TAG_BYTES = 16;

const base64 = (bytes: number) => Joi.string().base64().custom((v: string, h) => (Buffer.from(v, 'base64').length === bytes ? v : h.error('any.invalid')), `${bytes} bytes`);

const schema = Joi.object<ClientEncryption>({
    scheme: Joi.string().valid(CLIENT_ENCRYPTION_SCHEME).required(),
    salt: base64(16).required(),
    noncePrefix: base64(8).required(),
    iterations: Joi.number().integer().min(100_000).max(5_000_000).required(),
    segmentSize: Joi.number().integer().min(1024).max(16 * 1024 * 1024).required(),
    mimetype: Joi.string().max(150).required(),
    size: Joi.number().integer().min(0).required(),
});

/** Bytes of ciphertext produced for `plainSize` bytes of content. */
export function cipherSize(plainSize: number, segmentSize: number): number {
    const pieces = Math.max(1, Math.ceil(plainSize / segmentSize));
    return plainSize + pieces * GCM_TAG_BYTES;
}

/** Accepts the parameters as an object or as a JSON string (multipart field); throws 400 when they are not usable. */
export function parseClientEncryption(raw: unknown): ClientEncryption | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    let value: unknown = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        } catch {
            throw new AppError('clientEncryption must be a JSON object', 400, 'validation');
        }
    }
    const { error, value: ce } = schema.validate(value, { stripUnknown: true });
    if (error) throw new AppError(`clientEncryption: ${error.message.replace(/"/g, "'")}`, 400, 'validation');
    // the real type of the content is what the allow-list is about, even though the server cannot verify it
    if (!isAllowed(ce.mimetype)) throw new AppError(`File type ${ce.mimetype} is not allowed`, 415, 'unsupported_media_type');
    return ce;
}

/** The stored ciphertext must be exactly what the declared plain size produces (catches truncated uploads). */
export function assertCipherSize(ce: ClientEncryption, storedBytes: number): void {
    const expected = cipherSize(ce.size, ce.segmentSize);
    if (storedBytes !== expected) throw new AppError(`Encrypted upload is ${storedBytes} bytes, expected ${expected} for ${ce.size} bytes of content`, 422, 'size_mismatch');
}

/** A plain copy for storing in sub-documents and pipeline updates. */
export const copyClientEncryption = (ce?: ClientEncryption | null): ClientEncryption | null =>
    ce?.scheme ? { scheme: ce.scheme, salt: ce.salt, noncePrefix: ce.noncePrefix, iterations: ce.iterations, segmentSize: ce.segmentSize, mimetype: ce.mimetype, size: ce.size } : null;
