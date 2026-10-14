/**
 * Encryption at rest. Each object gets its own random IV and its own key (HKDF of the master key and the IV), and is
 * encrypted with AES-256-GCM as a stream, so large files are never held in memory. The IV and the authentication
 * tag are stored in the database next to the file; the master key (ENCRYPTION_KEY) never leaves the environment.
 *
 * GCM authenticates the whole object, so tampering is detected when the last byte is decrypted. Because of that,
 * encrypted objects are always read from the start (no HTTP Range requests).
 */
import crypto from 'crypto';
import type { Transform } from 'stream';
import cfg from '../config/env';
import type { EncryptionInfo, UserDoc } from '../types/models';
import { masterKey } from '../utils/crypto';

const fileKey = (iv: Buffer): Buffer => Buffer.from(crypto.hkdfSync('sha256', masterKey(), iv, 'cloud-storage/object/v1', 32));

/** Encrypt when the operator forces it (ENCRYPT_AT_REST) or the user turned it on, and a key exists. */
export function shouldEncrypt(user?: Pick<UserDoc, 'preferences'> | null): boolean {
    if (!cfg.ENCRYPTION_KEY) return false;
    return cfg.ENCRYPT_AT_REST || Boolean(user?.preferences?.encryptFiles);
}

export interface EncryptStream {
    stream: Transform;
    /** Valid once the stream has ended. */
    info(): EncryptionInfo;
}

export function createEncryptStream(): EncryptStream {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', fileKey(iv), iv);
    return {
        stream: cipher,
        info: () => ({ iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') }),
    };
}

export function createDecryptStream(info: EncryptionInfo): Transform {
    const iv = Buffer.from(info.iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', fileKey(iv), iv);
    decipher.setAuthTag(Buffer.from(info.authTag, 'hex'));
    return decipher;
}
