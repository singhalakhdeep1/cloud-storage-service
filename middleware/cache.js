const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

/**
 * Cache middleware
 * Caches GET requests for improved performance
 */
const cacheMiddleware = (duration = 600) => {
  return (req, res, next) => {
    const key = req.originalUrl || req.url;
    const cachedResponse = cache.get(key);

    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    res.sendResponse = res.json;
    res.json = (body) => {
      cache.set(key, body, duration);
      res.sendResponse(body);
    };

    next();
  };
};

/**
 * Clear cache middleware
 * Clears cache after POST/PUT/DELETE requests
 */
const clearCache = (pattern) => {
  return (req, res, next) => {
    const originalSend = res.send;
    res.send = function (data) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const keys = cache.keys();
        keys.forEach(key => {
          if (key.includes(pattern)) {
            cache.del(key);
          }
        });
      }
      originalSend.call(this, data);
    };
    next();
  };
};

/**
 * Get cache stats
 */
const getCacheStats = () => {
  return {
    keys: cache.keys().length,
    stats: cache.getStats()
  };
};

/**
 * Clear all cache
 */
const clearAllCache = () => {
  cache.flushAll();
};

module.exports = {
  cacheMiddleware,
  clearCache,
  getCacheStats,
  clearAllCache
};
