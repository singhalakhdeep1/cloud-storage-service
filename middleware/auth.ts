import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import cfg from '../config/env';
import User from '../models/User';
import { CacheService } from '../services/cache/cache.service';
import { setLogUser } from '../services/structured-logging/structured-logging.service';
import AppError from '../utils/appError';
import asyncHandler from '../utils/asyncHandler';
import type { UserDoc } from '../types/models';

const revoked = new CacheService('revoked');

interface AccessPayload {
    id: string;
    tv?: number;
    jti?: string;
    exp?: number;
}

/** Signs an access token. `tokenVersion` ties it to the user's current sign-in generation. */
export function generateToken(id: unknown, tokenVersion = 0): string {
    return jwt.sign({ id: String(id), tv: tokenVersion }, cfg.JWT_SECRET, { expiresIn: cfg.JWT_EXPIRE as jwt.SignOptions['expiresIn'], algorithm: 'HS256', jwtid: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` });
}

/** Signs this one token out (until it would have expired anyway). */
export async function revokeToken(token: string): Promise<void> {
    const decoded = jwt.decode(token) as AccessPayload | null;
    if (!decoded?.jti || !decoded.exp) return;
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) await revoked.set(decoded.jti, '1', ttl);
}

function bearer(req: Request): string | undefined {
    const header = req.headers.authorization;
    return header && /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : undefined;
}

/** Resolves the token to an active user, or throws 401. */
async function authenticate(token: string): Promise<{ user: UserDoc; payload: AccessPayload }> {
    let payload: AccessPayload;
    try {
        payload = jwt.verify(token, cfg.JWT_SECRET, { algorithms: ['HS256'] }) as AccessPayload;
    } catch {
        throw new AppError('Not authorized to access this route', 401, 'invalid_token');
    }
    if (payload.jti && (await revoked.get(payload.jti))) throw new AppError('Not authorized to access this route', 401, 'token_revoked');
    const user = (await User.findById(payload.id).select('-password')) as UserDoc | null;
    if (!user) throw new AppError('User no longer exists', 401, 'invalid_token');
    if (!user.isActive) throw new AppError('User account has been deactivated', 401, 'account_disabled');
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) throw new AppError('Your session has ended, please sign in again', 401, 'token_revoked');
    return { user, payload };
}

/** Requires a valid access token. */
export const protect: RequestHandler = asyncHandler(async (req, _res, next) => {
    const token = bearer(req);
    if (!token) throw new AppError('Not authorized to access this route', 401, 'unauthenticated');
    const { user, payload } = await authenticate(token);
    req.user = user;
    req.tokenId = payload.jti;
    setLogUser(user._id);
    next();
});

/** Identifies the user when a valid token is sent; carries on anonymously otherwise. */
export const optionalAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
    const token = bearer(req);
    if (token) {
        try {
            const { user, payload } = await authenticate(token);
            req.user = user;
            req.tokenId = payload.jti;
            setLogUser(user._id);
        } catch {
            /* an invalid token on an optional route simply means "not signed in" */
        }
    }
    next();
});

/** Grants access to specific roles (after `protect`). */
export const authorize =
    (...roles: string[]): RequestHandler =>
    (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user || !roles.includes(req.user.role)) return next(new AppError(`User role '${req.user?.role ?? 'anonymous'}' is not authorized to access this route`, 403, 'forbidden'));
        next();
    };

export { checkFileAccess as checkFileOwnership } from './fileAccess';
