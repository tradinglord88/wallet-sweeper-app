/**
 * Enterprise Redis Caching Service
 * Provides high-performance caching with automatic invalidation
 */

const Redis = require('ioredis');
const crypto = require('crypto');

class CacheService {
    constructor() {
        // Create Redis client with cluster support
        this.client = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD,
            db: process.env.REDIS_DB || 0,
            retryStrategy: (times) => Math.min(times * 50, 2000),
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            lazyConnect: false,
            keepAlive: 30000,
            connectionName: 'dark-pino-cache'
        });

        // Create a separate client for pub/sub
        this.pubClient = this.client.duplicate();
        this.subClient = this.client.duplicate();

        this.setupErrorHandlers();
        this.setupCachePatterns();
    }

    setupErrorHandlers() {
        this.client.on('error', (err) => {
            console.error('Redis cache error:', err);
        });

        this.client.on('connect', () => {
            console.log('Redis cache connected successfully');
        });

        this.client.on('ready', () => {
            console.log('Redis cache ready for operations');
        });
    }

    setupCachePatterns() {
        // Cache configuration for different data types
        this.cacheConfig = {
            walletBalance: {
                ttl: 60, // 1 minute
                prefix: 'balance:',
                invalidateOn: ['wallet_connected', 'sweep_completed']
            },
            walletConfig: {
                ttl: 300, // 5 minutes
                prefix: 'config:',
                invalidateOn: ['config_updated']
            },
            rpcResponse: {
                ttl: 30, // 30 seconds for RPC responses
                prefix: 'rpc:',
                invalidateOn: []
            },
            tokenMetadata: {
                ttl: 3600, // 1 hour for token metadata
                prefix: 'token:',
                invalidateOn: []
            },
            sessionData: {
                ttl: 1800, // 30 minutes for session data
                prefix: 'session:',
                invalidateOn: ['logout', 'session_expired']
            }
        };
    }

    /**
     * Generate cache key with namespace
     */
    generateKey(type, identifier) {
        const config = this.cacheConfig[type];
        if (!config) {
            throw new Error(`Unknown cache type: ${type}`);
        }
        return `${config.prefix}${identifier}`;
    }

    /**
     * Get data from cache
     */
    async get(type, identifier) {
        try {
            const key = this.generateKey(type, identifier);
            const data = await this.client.get(key);

            if (data) {
                // Update cache hit metrics
                await this.incrementMetric('cache_hits');
                return JSON.parse(data);
            }

            // Update cache miss metrics
            await this.incrementMetric('cache_misses');
            return null;
        } catch (error) {
            console.error('Cache get error:', error);
            return null;
        }
    }

    /**
     * Set data in cache with automatic expiration
     */
    async set(type, identifier, data, customTTL = null) {
        try {
            const config = this.cacheConfig[type];
            const key = this.generateKey(type, identifier);
            const ttl = customTTL || config.ttl;

            const serialized = JSON.stringify(data);
            await this.client.setex(key, ttl, serialized);

            // Update cache set metrics
            await this.incrementMetric('cache_sets');
            return true;
        } catch (error) {
            console.error('Cache set error:', error);
            return false;
        }
    }

    /**
     * Delete specific cache entry
     */
    async delete(type, identifier) {
        try {
            const key = this.generateKey(type, identifier);
            await this.client.del(key);
            return true;
        } catch (error) {
            console.error('Cache delete error:', error);
            return false;
        }
    }

    /**
     * Clear all cache entries of a specific type
     */
    async clearType(type) {
        try {
            const config = this.cacheConfig[type];
            const pattern = `${config.prefix}*`;
            const keys = await this.client.keys(pattern);

            if (keys.length > 0) {
                await this.client.del(...keys);
            }

            return true;
        } catch (error) {
            console.error('Cache clear error:', error);
            return false;
        }
    }

    /**
     * Implement cache-aside pattern
     */
    async getOrSet(type, identifier, fetchFunction, customTTL = null) {
        // Try to get from cache first
        const cached = await this.get(type, identifier);
        if (cached !== null) {
            return cached;
        }

        // If not in cache, fetch fresh data
        const freshData = await fetchFunction();

        // Store in cache for next time
        await this.set(type, identifier, freshData, customTTL);

        return freshData;
    }

    /**
     * Batch get multiple cache entries
     */
    async mget(type, identifiers) {
        try {
            const keys = identifiers.map(id => this.generateKey(type, id));
            const values = await this.client.mget(keys);

            return values.map(v => v ? JSON.parse(v) : null);
        } catch (error) {
            console.error('Cache mget error:', error);
            return identifiers.map(() => null);
        }
    }

    /**
     * Batch set multiple cache entries
     */
    async mset(type, entries, customTTL = null) {
        try {
            const config = this.cacheConfig[type];
            const ttl = customTTL || config.ttl;

            const pipeline = this.client.pipeline();

            for (const [identifier, data] of Object.entries(entries)) {
                const key = this.generateKey(type, identifier);
                pipeline.setex(key, ttl, JSON.stringify(data));
            }

            await pipeline.exec();
            return true;
        } catch (error) {
            console.error('Cache mset error:', error);
            return false;
        }
    }

    /**
     * Implement distributed locking for critical sections
     */
    async acquireLock(resource, ttl = 5000) {
        const lockKey = `lock:${resource}`;
        const lockValue = crypto.randomBytes(16).toString('hex');

        const result = await this.client.set(
            lockKey,
            lockValue,
            'PX',
            ttl,
            'NX'
        );

        if (result === 'OK') {
            return lockValue;
        }

        return null;
    }

    /**
     * Release distributed lock
     */
    async releaseLock(resource, lockValue) {
        const lockKey = `lock:${resource}`;

        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;

        const result = await this.client.eval(script, 1, lockKey, lockValue);
        return result === 1;
    }

    /**
     * Increment counter for metrics
     */
    async incrementMetric(metric, amount = 1) {
        try {
            const key = `metric:${metric}`;
            await this.client.incrby(key, amount);
        } catch (error) {
            console.error('Metric increment error:', error);
        }
    }

    /**
     * Get all metrics
     */
    async getMetrics() {
        try {
            const keys = await this.client.keys('metric:*');
            const values = await this.client.mget(keys);

            const metrics = {};
            keys.forEach((key, index) => {
                const metricName = key.replace('metric:', '');
                metrics[metricName] = parseInt(values[index] || '0');
            });

            return metrics;
        } catch (error) {
            console.error('Get metrics error:', error);
            return {};
        }
    }

    /**
     * Implement cache warming for frequently accessed data
     */
    async warmCache(type, dataFetcher) {
        try {
            const data = await dataFetcher();
            const config = this.cacheConfig[type];

            for (const [identifier, value] of Object.entries(data)) {
                await this.set(type, identifier, value);
            }

            console.log(`Cache warmed for type: ${type}`);
            return true;
        } catch (error) {
            console.error('Cache warming error:', error);
            return false;
        }
    }

    /**
     * Clean up and close connections
     */
    async close() {
        await this.client.quit();
        await this.pubClient.quit();
        await this.subClient.quit();
    }
}

// Export singleton instance
module.exports = new CacheService();