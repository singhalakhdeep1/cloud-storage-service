/**
 * Cache Service for Cloud Storage Service.
 * Distributed caching with Redis (shared by every instance); without Redis a bounded in-process cache with TTLs
 * is used. A cache failure never fails a request: callers get a miss and read the database.
 */
import { getRedisClient } from '../../config/redis';
import logger from '../../config/logger';
import { metrics } from '../metrics.service';

const MAX_MEMORY_ENTRIES = 10_000;
const memory = new Map<string, { value: string; expires: number }>();

export class CacheService {
    readonly defaultTTL = 3600; // 1 hour

    constructor(private readonly namespace = 'storage') {}

    private k(key: string): string {
        return `${this.namespace}:${key}`;
    }

    async get(key: string): Promise<string | null> {
        const redis = getRedisClient();
        if (redis) {
            try {
                const value = await redis.get(this.k(key));
                metrics.cache(this.namespace, value !== null);
                return value;
            } catch (e) {
                logger.warn('cache get failed', { key, err: (e as Error).message });
                return null;
            }
        }
        const hit = memory.get(this.k(key));
        if (!hit || hit.expires < Date.now()) {
            if (hit) memory.delete(this.k(key));
            metrics.cache(this.namespace, false);
            return null;
        }
        metrics.cache(this.namespace, true);
        return hit.value;
    }

    async set(key: string, value: string, ttl?: number): Promise<void> {
        const seconds = ttl || this.defaultTTL;
        const redis = getRedisClient();
        if (redis) {
            try {
                await redis.set(this.k(key), value, 'EX', seconds);
            } catch (e) {
                logger.warn('cache set failed', { key, err: (e as Error).message });
            }
            return;
        }
        if (memory.size >= MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value as string); // oldest first
        memory.set(this.k(key), { value, expires: Date.now() + seconds * 1000 });
    }

    /** Sets the key only if it does not exist. Returns true when this call created it (a one-time claim). */
    async setIfAbsent(key: string, value: string, ttl?: number): Promise<boolean> {
        const seconds = ttl || this.defaultTTL;
        const redis = getRedisClient();
        if (redis) {
            try {
                return (await redis.set(this.k(key), value, 'EX', seconds, 'NX')) === 'OK';
            } catch (e) {
                logger.warn('cache setIfAbsent failed', { key, err: (e as Error).message });
                return false;
            }
        }
        if ((await this.get(key)) !== null) return false;
        await this.set(key, value, seconds);
        return true;
    }

    /** Atomic counter with a TTL that starts at the first increment (attempt limits, one-time budgets). */
    async incr(key: string, ttl: number): Promise<number> {
        const redis = getRedisClient();
        if (redis) {
            try {
                const n = await redis.incr(this.k(key));
                if (n === 1) await redis.expire(this.k(key), ttl);
                return n;
            } catch (e) {
                logger.warn('cache incr failed', { key, err: (e as Error).message });
                return 0;
            }
        }
        const hit = memory.get(this.k(key));
        const live = hit && hit.expires >= Date.now();
        const n = (live ? Number(hit.value) : 0) + 1;
        memory.set(this.k(key), { value: String(n), expires: live ? hit.expires : Date.now() + ttl * 1000 });
        return n;
    }

    /** Reads and deletes in one step (single-use values such as WebAuthn challenges). */
    async take(key: string): Promise<string | null> {
        const redis = getRedisClient();
        if (redis) {
            try {
                return await redis.getdel(this.k(key));
            } catch (e) {
                logger.warn('cache take failed', { key, err: (e as Error).message });
                return null;
            }
        }
        const value = await this.get(key);
        memory.delete(this.k(key));
        return value;
    }

    async delete(key: string): Promise<void> {
        const redis = getRedisClient();
        if (redis) {
            await redis.del(this.k(key)).catch((e: Error) => logger.warn('cache delete failed', { key, err: e.message }));
            return;
        }
        memory.delete(this.k(key));
    }

    async getJSON<T = unknown>(key: string): Promise<T | null> {
        const raw = await this.get(key);
        if (raw === null) return null;
        try {
            return JSON.parse(raw) as T;
        } catch {
            return null;
        }
    }

    async setJSON(key: string, value: unknown, ttl?: number): Promise<void> {
        await this.set(key, JSON.stringify(value), ttl);
    }

    /** Cache-aside: return the cached value, or compute, store and return it. */
    async getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
        const hit = await this.getJSON<T>(key);
        if (hit !== null) return hit;
        const value = await factory();
        if (value !== undefined && value !== null) await this.setJSON(key, value, ttl);
        return value;
    }

    /** Remove every key matching a glob such as "user:42:*" (SCAN, never KEYS). */
    async invalidatePattern(pattern: string): Promise<number> {
        const redis = getRedisClient();
        let removed = 0;
        if (redis) {
            try {
                let cursor = '0';
                do {
                    const [next, keys] = await redis.scan(cursor, 'MATCH', this.k(pattern), 'COUNT', 200);
                    cursor = next;
                    if (keys.length) removed += await redis.del(...keys);
                } while (cursor !== '0');
            } catch (e) {
                logger.warn('cache invalidate failed', { pattern, err: (e as Error).message });
            }
            return removed;
        }
        const re = new RegExp('^' + this.k(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        for (const key of memory.keys()) {
            if (re.test(key)) {
                memory.delete(key);
                removed++;
            }
        }
        return removed;
    }

    /** Removes everything in this service's namespace. */
    async clearAll(): Promise<number> {
        return this.invalidatePattern('*');
    }
}

const cache = new CacheService();
export default CacheService;
export { cache };
