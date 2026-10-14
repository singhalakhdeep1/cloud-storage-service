import type { Request, Response } from 'express';
import { pipeline } from 'stream';
import cfg from '../config/env';
import logger from '../config/logger';
import * as objectStore from '../services/objectStore.service';
import { contentDisposition } from '../services/storage/types';
import { isInlineSafe, parseRange } from './files';

export interface SendOptions {
    filename: string;
    mimetype: string;
    /** Show in the browser (only honoured for types that are safe to render). */
    inline?: boolean;
    etag?: string;
    /** `Cache-Control: private, max-age=` */
    maxAge?: number;
}

/**
 * Streams a stored object to the client: range requests (seeking in video and audio), conditional requests,
 * and headers that stop a browser from treating an upload as a page.
 */
export async function sendObject(req: Request, res: Response, ref: objectStore.ObjectRef, options: SendOptions): Promise<void> {
    const rangeable = !ref.isEncrypted; // GCM authenticates the whole object, so encrypted files are always read from the start
    const range = rangeable ? parseRange(req.headers.range, ref.size) : null;
    if (range === 'invalid') {
        res.status(416).setHeader('Content-Range', `bytes */${ref.size}`).end();
        return;
    }

    const etag = options.etag ? `"${options.etag}"` : undefined;
    if (etag && !range && req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
    }

    const inline = Boolean(options.inline) && isInlineSafe(options.mimetype);
    res.setHeader('Content-Type', inline ? options.mimetype : isInlineSafe(options.mimetype) ? options.mimetype : 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(options.filename, inline));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (options.mimetype === 'application/pdf') {
        // the web app shows PDFs in a frame: only its origin(s) may frame the bytes (the API's default is "nobody")
        res.setHeader('Content-Security-Policy', `frame-ancestors ${cfg.CLIENT_URL.join(' ') || "'none'"}`);
        res.removeHeader('X-Frame-Options');
    } else res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', `private, max-age=${options.maxAge ?? 0}`);
    if (rangeable) res.setHeader('Accept-Ranges', 'bytes');
    if (etag) res.setHeader('ETag', etag);

    if (req.method === 'HEAD') {
        res.status(200).setHeader('Content-Length', String(ref.size));
        res.end();
        return;
    }

    const obj = await objectStore.readObject(ref, { range: range ?? undefined });
    if (range) {
        res.status(206).setHeader('Content-Range', `bytes ${range.start}-${range.end}/${ref.size}`);
        res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
        res.status(200).setHeader('Content-Length', String(obj.size || ref.size));
    }
    pipeline(obj.stream, res, (err) => {
        if (err && (err as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') logger.warn('download stream failed', { err: err.message, requestId: req.id });
    });
}
