/**
 * Cache Service for Cloud Storage Service
 * Implements distributed caching with Redis for cloud storage platform data
 */
const Redis = require('ioredis');

class CacheService {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
    this.defaultTTL = 3600; // 1 hour
  }

  async get(key) {
    const value = await this.redis.get(key);
    return value;
  }

  async set(key, value, ttl) {
    const expiration = ttl || this.defaultTTL;
    await this.redis.setex(key, expiration, value);
  }

  async delete(key) {
    await this.redis.del(key);
  }

  async getOrSet(key, factory, ttl) {
    const cachedValue = await this.get(key);
    if (cachedValue !== null) {
      return cachedValue;
    }

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  async invalidatePattern(pattern) {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async clearAll() {
    const keys = await this.redis.keys('*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}

module.exports = CacheService;
