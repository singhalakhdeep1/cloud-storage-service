const redis = require('redis');
const logger = require('./logger');

let redisClient;

// Create Redis client
const createRedisClient = async () => {
    try {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        
        redisClient = redis.createClient({
            url: redisUrl,
            socket: {
                reconnectStrategy: (retries) => {
                    if (retries > 10) {
                        logger.error('Redis reconnection failed after 10 attempts');
                        return new Error('Redis reconnection failed');
                    }
                    const delay = Math.min(retries * 100, 3000);
                    logger.info(`Redis reconnection attempt ${retries}, retrying in ${delay}ms`);
                    return delay;
                }
            }
        });

        redisClient.on('error', (err) => {
            logger.error('Redis Client Error:', err);
        });

        redisClient.on('connect', () => {
            logger.info('Redis Client Connected');
        });

        redisClient.on('ready', () => {
            logger.info('Redis Client Ready');
        });

        redisClient.on('disconnect', () => {
            logger.warn('Redis Client Disconnected');
        });

        await redisClient.connect();
        return redisClient;
    } catch (error) {
        logger.error('Failed to create Redis client:', error);
        // Return null if Redis is not available (graceful degradation)
        return null;
    }
};

// Initialize Redis client
const initRedis = async () => {
    if (!redisClient) {
        redisClient = await createRedisClient();
    }
    return redisClient;
};

// Get Redis client
const getRedisClient = () => {
    return redisClient;
};

// Cache operations
const cache = {
    // Set value with expiration
    set: async (key, value, ttl = 3600) => {
        if (!redisClient) return false;
        try {
            await redisClient.setEx(key, ttl, JSON.stringify(value));
            return true;
        } catch (error) {
            logger.error('Redis set error:', error);
            return false;
        }
    },

    // Get value
    get: async (key) => {
        if (!redisClient) return null;
        try {
            const value = await redisClient.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            logger.error('Redis get error:', error);
            return null;
        }
    },

    // Delete key
    del: async (key) => {
        if (!redisClient) return false;
        try {
            await redisClient.del(key);
            return true;
        } catch (error) {
            logger.error('Redis del error:', error);
            return false;
        }
    },

    // Delete multiple keys by pattern
    delPattern: async (pattern) => {
        if (!redisClient) return false;
        try {
            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
                await redisClient.del(keys);
            }
            return true;
        } catch (error) {
            logger.error('Redis delPattern error:', error);
            return false;
        }
    },

    // Check if key exists
    exists: async (key) => {
        if (!redisClient) return false;
        try {
            const result = await redisClient.exists(key);
            return result === 1;
        } catch (error) {
            logger.error('Redis exists error:', error);
            return false;
        }
    },

    // Set with increment
    incr: async (key) => {
        if (!redisClient) return 0;
        try {
            return await redisClient.incr(key);
        } catch (error) {
            logger.error('Redis incr error:', error);
            return 0;
        }
    },

    // Set with decrement
    decr: async (key) => {
        if (!redisClient) return 0;
        try {
            return await redisClient.decr(key);
        } catch (error) {
            logger.error('Redis decr error:', error);
            return 0;
        }
    },

    // Set hash field
    hset: async (key, field, value) => {
        if (!redisClient) return false;
        try {
            await redisClient.hSet(key, field, JSON.stringify(value));
            return true;
        } catch (error) {
            logger.error('Redis hset error:', error);
            return false;
        }
    },

    // Get hash field
    hget: async (key, field) => {
        if (!redisClient) return null;
        try {
            const value = await redisClient.hGet(key, field);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            logger.error('Redis hget error:', error);
            return null;
        }
    },

    // Get all hash fields
    hgetall: async (key) => {
        if (!redisClient) return {};
        try {
            const hash = await redisClient.hGetAll(key);
            const result = {};
            for (const [field, value] of Object.entries(hash)) {
                result[field] = JSON.parse(value);
            }
            return result;
        } catch (error) {
            logger.error('Redis hgetall error:', error);
            return {};
        }
    },

    // Add to sorted set
    zadd: async (key, score, member) => {
        if (!redisClient) return false;
        try {
            await redisClient.zAdd(key, [{ score, value: member }]);
            return true;
        } catch (error) {
            logger.error('Redis zadd error:', error);
            return false;
        }
    },

    // Get from sorted set by range
    zrange: async (key, start, stop) => {
        if (!redisClient) return [];
        try {
            return await redisClient.zRange(key, start, stop);
        } catch (error) {
            logger.error('Redis zrange error:', error);
            return [];
        }
    },

    // Get cache stats
    getStats: async () => {
        if (!redisClient) return null;
        try {
            const info = await redisClient.info('stats');
            const keyspace = await redisClient.info('keyspace');
            return {
                stats: info,
                keyspace: keyspace
            };
        } catch (error) {
            logger.error('Redis getStats error:', error);
            return null;
        }
    },

    // Flush all keys (use with caution)
    flushAll: async () => {
        if (!redisClient) return false;
        try {
            await redisClient.flushAll();
            return true;
        } catch (error) {
            logger.error('Redis flushAll error:', error);
            return false;
        }
    }
};

// Close Redis connection
const closeRedis = async () => {
    if (redisClient) {
        try {
            await redisClient.quit();
            logger.info('Redis connection closed');
        } catch (error) {
            logger.error('Error closing Redis connection:', error);
        }
    }
};

module.exports = {
    initRedis,
    getRedisClient,
    cache,
    closeRedis
};
