/**
 * Rate Limiting Service for Cloud Storage Service
 * Implements token bucket algorithm for API rate limiting
 */
const Redis = require('ioredis');

class RateLimitingService {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
    this.bucketCapacity = 100;
    this.refillRate = 1; // tokens per second
  }

  async isAllowed(key, tokensRequested = 1) {
    const bucket = await this.getOrCreateBucket(key);

    const now = Date.now();
    const timeSinceLastRefill = (now - bucket.lastRefill) / 1000;

    const tokensToAdd = Math.floor(timeSinceLastRefill * this.refillRate);
    bucket.tokens = Math.min(bucket.tokens + tokensToAdd, this.bucketCapacity);
    bucket.lastRefill = now;

    if (bucket.tokens >= tokensRequested) {
      bucket.tokens -= tokensRequested;
      await this.saveBucket(key, bucket);
      return true;
    }

    return false;
  }

  async getRemainingTokens(key) {
    const bucket = await this.getOrCreateBucket(key);

    const now = Date.now();
    const timeSinceLastRefill = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = Math.floor(timeSinceLastRefill * this.refillRate);
    bucket.tokens = Math.min(bucket.tokens + tokensToAdd, this.bucketCapacity);
    bucket.lastRefill = now;

    await this.saveBucket(key, bucket);
    return bucket.tokens;
  }

  async resetBucket(key) {
    await this.redis.del(`rate_limit:${key}`);
  }

  async getOrCreateBucket(key) {
    const data = await this.redis.get(`rate_limit:${key}`);

    if (data) {
      return JSON.parse(data);
    }

    const bucket = {
      tokens: this.bucketCapacity,
      lastRefill: Date.now(),
    };

    await this.saveBucket(key, bucket);
    return bucket;
  }

  async saveBucket(key, bucket) {
    await this.redis.setex(`rate_limit:${key}`, 3600, JSON.stringify(bucket));
  }
}

module.exports = RateLimitingService;
