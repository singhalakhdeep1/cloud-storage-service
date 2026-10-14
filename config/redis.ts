/**
 * Shared Redis connection (ioredis). Redis is optional: when it is not configured, the cache, the rate limiter and
 * the short-lived stores fall back to in-process behaviour, which is correct for a single instance. A Redis outage
 * never fails a request.
 */
import Redis from 'ioredis';
import cfg from './env';
import logger from './logger';

let client: Redis | null = null;

export const redisEnabled = (): boolean => Boolean(cfg.REDIS_URL);

/** The shared connection, or null when Redis is not configured. */
export function getRedisClient(): Redis | null {
    if (!redisEnabled()) return null;
    if (!client) {
        client = new Redis(cfg.REDIS_URL as string, { connectionName: 'cloud-storage', maxRetriesPerRequest: 2, retryStrategy: (n) => Math.min(n * 200, 3000), lazyConnect: false });
        client.on('error', () => undefined); // reported through the health check, never crashes the process
        client.on('ready', () => logger.info('Redis connected'));
    }
    return client;
}

export async function initRedis(): Promise<Redis | null> {
    const c = getRedisClient();
    if (!c) {
        logger.info('Redis not configured: using in-process cache and rate limiting');
        return null;
    }
    try {
        await c.ping();
    } catch (e) {
        logger.warn('Redis is configured but not reachable yet; continuing without it until it answers', { err: (e as Error).message });
    }
    return c;
}

/** true = healthy, false = configured but failing, null = not configured. */
export async function redisHealthy(): Promise<boolean | null> {
    const c = getRedisClient();
    if (!c) return null;
    try {
        return (await c.ping()) === 'PONG';
    } catch {
        return false;
    }
}

export async function closeRedis(): Promise<void> {
    if (client) {
        await client.quit().catch(() => undefined);
        client = null;
    }
}
