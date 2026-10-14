/**
 * Response cache for expensive read-only endpoints (analytics). The key always includes the signed-in user, so one
 * user can never be served another user's cached answer.
 */
import type { RequestHandler } from 'express';
import { CacheService } from '../services/cache/cache.service';

const cache = new CacheService('http');

export const cacheMiddleware = (ttlSeconds = 60): RequestHandler => async (req, res, next) => {
    if (req.method !== 'GET' || !req.user) return next();
    const key = `${String(req.user._id)}:${req.originalUrl}`;
    const hit = await cache.get(key);
    if (hit !== null) {
        res.setHeader('X-Cache', 'HIT');
        res.type('json').send(hit);
        return;
    }
    const send = res.json.bind(res);
    res.json = (body: unknown) => {
        if (res.statusCode === 200) void cache.set(key, JSON.stringify(body), ttlSeconds);
        res.setHeader('X-Cache', 'MISS');
        return send(body);
    };
    next();
};

/** Drops a user's cached responses (after anything that changes their numbers). */
export const clearUserCache = (userId: unknown): Promise<number> => cache.invalidatePattern(`${String(userId)}:*`);
