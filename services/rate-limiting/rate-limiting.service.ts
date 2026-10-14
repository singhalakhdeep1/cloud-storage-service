/**
 * Rate Limiting Service for Cloud Storage Service: token bucket.
 * On Redis the refill-and-take step is one Lua script, so it is atomic across concurrent requests and across
 * instances. Without Redis an in-process bucket is used. If Redis fails the limiter lets requests through:
 * an outage must not lock every user out.
 */
import type { Request, RequestHandler } from 'express';
import { getRedisClient } from '../../config/redis';
import logger from '../../config/logger';
import cfg from '../../config/env';

const LUA = `
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local req = tonumber(ARGV[4])
local d = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(d[1])
local ts = tonumber(d[2])
if tokens == nil then tokens = cap; ts = now end
tokens = math.min(cap, tokens + math.max(0, (now - ts) / 1000) * rate)
local allowed = 0
if tokens >= req then tokens = tokens - req; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('EXPIRE', KEYS[1], math.ceil(cap / rate) + 60)
return { allowed, tostring(tokens) }
`;

const memory = new Map<string, { tokens: number; ts: number }>();

export interface Consumed {
    allowed: boolean;
    remaining: number;
    /** Seconds until the request could succeed. */
    retryAfter: number;
}

export class RateLimitingService {
    constructor(
        readonly bucketCapacity = cfg.RATE_LIMIT_BUCKET_CAPACITY,
        readonly refillRate = cfg.RATE_LIMIT_REFILL_RATE, // tokens per second
        private readonly prefix = 'rate_limit'
    ) {}

    private k(key: string): string {
        return `${this.prefix}:${key}`;
    }

    async consume(key: string, cost = 1): Promise<Consumed> {
        const now = Date.now();
        const cap = this.bucketCapacity;
        const rate = this.refillRate;
        const redis = getRedisClient();
        if (redis) {
            try {
                const [allowed, tokens] = (await redis.eval(LUA, 1, this.k(key), cap, rate, now, cost)) as [number, string];
                const left = parseFloat(tokens);
                return { allowed: allowed === 1, remaining: Math.floor(left), retryAfter: allowed === 1 ? 0 : Math.ceil((cost - left) / rate) };
            } catch (e) {
                logger.warn('rate limiter unavailable, allowing request', { err: (e as Error).message });
                return { allowed: true, remaining: cap, retryAfter: 0 };
            }
        }
        const b = memory.get(this.k(key)) ?? { tokens: cap, ts: now };
        b.tokens = Math.min(cap, b.tokens + Math.max(0, (now - b.ts) / 1000) * rate);
        b.ts = now;
        let allowed = false;
        if (b.tokens >= cost) {
            b.tokens -= cost;
            allowed = true;
        }
        if (memory.size > 100_000) memory.clear();
        memory.set(this.k(key), b);
        return { allowed, remaining: Math.floor(b.tokens), retryAfter: allowed ? 0 : Math.ceil((cost - b.tokens) / rate) };
    }

    async isAllowed(key: string, tokensRequested = 1): Promise<boolean> {
        return (await this.consume(key, tokensRequested)).allowed;
    }

    async getRemainingTokens(key: string): Promise<number> {
        const redis = getRedisClient();
        const cap = this.bucketCapacity;
        if (redis) {
            try {
                const d = await redis.hmget(this.k(key), 'tokens', 'ts');
                if (d[0] === null || d[1] === null) return cap;
                return Math.floor(Math.min(cap, parseFloat(d[0] as string) + Math.max(0, (Date.now() - parseFloat(d[1] as string)) / 1000) * this.refillRate));
            } catch {
                return cap;
            }
        }
        const b = memory.get(this.k(key));
        return b ? Math.floor(Math.min(cap, b.tokens + Math.max(0, (Date.now() - b.ts) / 1000) * this.refillRate)) : cap;
    }

    async resetBucket(key: string): Promise<void> {
        memory.delete(this.k(key));
        await getRedisClient()?.del(this.k(key)).catch(() => undefined);
    }
}

export interface RateLimitOptions {
    /** Requests allowed per window. */
    max: number;
    windowSeconds: number;
    prefix?: string;
    keyFn?: (req: Request) => string;
    message?: string;
    /** Skip limiting for some requests (e.g. internal health checks). */
    skip?: (req: Request) => boolean;
}

/** Express middleware: "10 requests per 60 seconds" is a bucket of 10 refilling at 10/60 per second. */
export function rateLimit({ max, windowSeconds, prefix = 'api', keyFn, message = 'Too many requests, please slow down.', skip }: RateLimitOptions): RequestHandler {
    const service = new RateLimitingService(max, max / windowSeconds, `rl:${prefix}`);
    return async (req, res, next) => {
        if (skip?.(req)) return next();
        const r = await service.consume(keyFn ? keyFn(req) : req.ip ?? 'unknown');
        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, r.remaining)));
        if (!r.allowed) {
            res.setHeader('Retry-After', String(r.retryAfter));
            res.status(429).json({ success: false, message, error: message, retryAfter: r.retryAfter });
            return;
        }
        next();
    };
}

export default RateLimitingService;
