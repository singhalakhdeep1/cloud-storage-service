import cors from 'cors';
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import cfg from '../config/env';
import AppError from '../utils/appError';

/** An API serves JSON and file bytes, never pages: lock everything down. */
export const securityHeaders: RequestHandler = helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // the web app on another origin loads files and thumbnails
    referrerPolicy: { policy: 'no-referrer' },
});

/** Only the web app's origin(s) may call the API from a browser. Tokens are sent in a header, never in a cookie. */
export const corsMiddleware: RequestHandler = cors({
    origin: (origin, cb) => {
        if (!origin || cfg.CLIENT_URL.includes('*') || cfg.CLIENT_URL.includes(origin)) return cb(null, true);
        cb(new AppError('Origin not allowed', 403, 'cors'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Share-Password', 'Range'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After', 'Content-Range', 'Accept-Ranges', 'Content-Disposition'],
    maxAge: 600,
});

/** Responses that carry personal data must not be stored by shared caches. */
export const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
};
