/**
 * Decides what a file really is. The browser-supplied Content-Type and the file extension are claims; the first
 * bytes of the file (magic numbers) are evidence. Uploads are checked against ALLOWED_MIME_TYPES using the evidence.
 */
import fs from 'fs';
import { fromBuffer } from 'file-type';
import mime from 'mime-types';
import cfg from '../config/env';
import AppError from './appError';

const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json', 'text/tab-separated-values']);
/** Types with no reliable signature: accepted when the content looks like text. */
const looksLikeText = (buf: Buffer): boolean => {
    if (buf.length === 0) return true;
    let controls = 0;
    for (const byte of buf) {
        if (byte === 0) return false;
        if (byte < 9 || (byte > 13 && byte < 32)) controls++;
    }
    return controls / buf.length < 0.02;
};

const LEGACY_OFFICE = new Set(['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint']);

export async function readHead(filePath: string, bytes = 4100): Promise<Buffer> {
    const fh = await fs.promises.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(bytes);
        const { bytesRead } = await fh.read(buf, 0, bytes, 0);
        return buf.subarray(0, bytesRead);
    } finally {
        await fh.close();
    }
}

export interface ResolvedType {
    mimetype: string;
    /** true when the content matched a known signature */
    detected: boolean;
}

/**
 * Returns the type to store for a file, or throws 415 when the content does not match what was declared
 * or is not allowed.
 */
export async function resolveMime(head: Buffer, declared: string | undefined, originalName: string): Promise<ResolvedType> {
    const claimed = (declared || mime.lookup(originalName) || 'application/octet-stream').toLowerCase().split(';')[0]!.trim();
    const sniffed = await fromBuffer(head);
    let result: ResolvedType;

    if (sniffed) {
        const real = sniffed.mime.toLowerCase();
        if (real === 'application/x-cfb' && LEGACY_OFFICE.has(claimed)) result = { mimetype: claimed, detected: true }; // .doc/.xls/.ppt share one container format
        else if (real === 'application/zip' && claimed.startsWith('application/vnd.openxmlformats-officedocument')) result = { mimetype: claimed, detected: true }; // a docx the sniffer could not narrow down
        else result = { mimetype: real, detected: true };
    } else if (TEXT_TYPES.has(claimed) || claimed.startsWith('text/')) {
        if (!looksLikeText(head)) throw new AppError('The file content does not look like text', 415, 'unsupported_media_type');
        result = { mimetype: claimed, detected: false };
    } else if (cfg.ALLOWED_MIME_TYPES.includes('*')) {
        result = { mimetype: claimed, detected: false };
    } else {
        throw new AppError(`The file content does not match its declared type (${claimed})`, 415, 'unsupported_media_type');
    }

    if (!isAllowed(result.mimetype)) throw new AppError(`File type ${result.mimetype} is not allowed`, 415, 'unsupported_media_type');
    return result;
}

export function isAllowed(mimetype: string): boolean {
    const allowed = cfg.ALLOWED_MIME_TYPES;
    if (allowed.includes('*')) return true;
    const m = mimetype.toLowerCase();
    return allowed.some((a) => a.toLowerCase() === m || (a.endsWith('/*') && m.startsWith(a.slice(0, -1))));
}
