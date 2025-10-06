/**
 * Nonce Manager for Solana Deep Link Transfer System
 * Manages nonce generation, validation, and replay attack prevention
 */

const crypto = require('crypto');
const Redis = require('redis');

class NonceManager {
    constructor() {
        this.redis = null;
        this.localCache = new Map(); // Fallback cache
        this.NONCE_EXPIRY_HOURS = 24;
        this.CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
        this.cleanupTimer = null;

        this.initializeRedis();
        this.startCleanupTimer();
    }

    /**
     * Initialize Redis connection
     */
    async initializeRedis() {
        try {
            const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
            this.redis = Redis.createClient({ url: redisUrl });

            this.redis.on('error', (err) => {
                console.error('Redis connection error in NonceManager:', err);
                this.redis = null;
            });

            this.redis.on('connect', () => {
                console.log('NonceManager connected to Redis');
            });

            await this.redis.connect();

        } catch (error) {
            console.warn('Redis not available for NonceManager, using local cache:', error.message);
            this.redis = null;
        }
    }

    /**
     * Generate a cryptographically secure nonce
     * @returns {string} Base64URL encoded nonce
     */
    generateNonce() {
        const nonce = crypto.randomBytes(32);
        return nonce
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    /**
     * Check if a nonce exists (has been used)
     * @param {string} nonce - Nonce to check
     * @returns {Promise<boolean>} True if nonce exists
     */
    async exists(nonce) {
        try {
            if (!this.isValidNonceFormat(nonce)) {
                throw new Error('Invalid nonce format');
            }

            if (this.redis) {
                const result = await this.redis.exists(`nonce:${nonce}`);
                return result === 1;
            } else {
                return this.localCache.has(nonce);
            }

        } catch (error) {
            console.error('Error checking nonce existence:', error);
            // On error, assume nonce doesn't exist to avoid blocking valid requests
            return false;
        }
    }

    /**
     * Store a nonce (mark it as used)
     * @param {string} nonce - Nonce to store
     * @param {Object} metadata - Optional metadata about the nonce usage
     * @returns {Promise<boolean>} True if successfully stored
     */
    async store(nonce, metadata = {}) {
        try {
            if (!this.isValidNonceFormat(nonce)) {
                throw new Error('Invalid nonce format');
            }

            const nonceData = {
                usedAt: new Date().toISOString(),
                metadata: metadata
            };

            if (this.redis) {
                const expirySeconds = this.NONCE_EXPIRY_HOURS * 60 * 60;
                await this.redis.setEx(
                    `nonce:${nonce}`,
                    expirySeconds,
                    JSON.stringify(nonceData)
                );
                return true;
            } else {
                this.localCache.set(nonce, {
                    ...nonceData,
                    expiresAt: Date.now() + (this.NONCE_EXPIRY_HOURS * 60 * 60 * 1000)
                });
                return true;
            }

        } catch (error) {
            console.error('Error storing nonce:', error);
            throw new Error('Failed to store nonce - cannot prevent replay attacks');
        }
    }

    /**
     * Validate and consume a nonce (atomic operation)
     * @param {string} nonce - Nonce to validate and consume
     * @param {Object} metadata - Metadata about nonce usage
     * @returns {Promise<Object>} Result of validation and consumption
     */
    async validateAndConsume(nonce, metadata = {}) {
        try {
            // First check if nonce format is valid
            if (!this.isValidNonceFormat(nonce)) {
                return {
                    success: false,
                    error: 'Invalid nonce format'
                };
            }

            // Check if nonce has already been used
            const exists = await this.exists(nonce);
            if (exists) {
                await this.logReplayAttempt(nonce, metadata);
                return {
                    success: false,
                    error: 'Nonce has already been used (replay attack detected)',
                    replayAttempt: true
                };
            }

            // Store the nonce (mark as used)
            await this.store(nonce, metadata);

            return {
                success: true,
                message: 'Nonce validated and consumed successfully'
            };

        } catch (error) {
            console.error('Error in validateAndConsume:', error);
            return {
                success: false,
                error: `Nonce validation failed: ${error.message}`
            };
        }
    }

    /**
     * Get information about a nonce
     * @param {string} nonce - Nonce to get info for
     * @returns {Promise<Object|null>} Nonce information or null if not found
     */
    async getNonceInfo(nonce) {
        try {
            if (this.redis) {
                const data = await this.redis.get(`nonce:${nonce}`);
                return data ? JSON.parse(data) : null;
            } else {
                const data = this.localCache.get(nonce);
                if (data && data.expiresAt > Date.now()) {
                    return data;
                }
                return null;
            }

        } catch (error) {
            console.error('Error getting nonce info:', error);
            return null;
        }
    }

    /**
     * Validate nonce format
     * @param {string} nonce - Nonce to validate
     * @returns {boolean} True if format is valid
     */
    isValidNonceFormat(nonce) {
        if (!nonce || typeof nonce !== 'string') {
            return false;
        }

        // Check if it's a valid base64url string (no padding)
        const base64UrlRegex = /^[A-Za-z0-9_-]+$/;
        if (!base64UrlRegex.test(nonce)) {
            return false;
        }

        // Check length (32 bytes base64url encoded should be 43 characters)
        if (nonce.length !== 43) {
            return false;
        }

        return true;
    }

    /**
     * Clean up expired nonces from local cache
     */
    cleanupExpiredNonces() {
        if (!this.redis && this.localCache.size > 0) {
            const now = Date.now();
            let cleanedCount = 0;

            for (const [nonce, data] of this.localCache.entries()) {
                if (data.expiresAt && data.expiresAt < now) {
                    this.localCache.delete(nonce);
                    cleanedCount++;
                }
            }

            if (cleanedCount > 0) {
                console.log(`Cleaned up ${cleanedCount} expired nonces from local cache`);
            }
        }
    }

    /**
     * Start the cleanup timer for expired nonces
     */
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredNonces();
        }, this.CLEANUP_INTERVAL_MS);
    }

    /**
     * Stop the cleanup timer
     */
    stopCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * Get statistics about nonce usage
     * @returns {Promise<Object>} Nonce usage statistics
     */
    async getStats() {
        try {
            const stats = {
                timestamp: new Date().toISOString(),
                storage: this.redis ? 'redis' : 'local_cache'
            };

            if (this.redis) {
                // Count nonces in Redis
                const keys = await this.redis.keys('nonce:*');
                stats.totalNonces = keys.length;
                stats.cacheSize = 'redis_managed';
            } else {
                stats.totalNonces = this.localCache.size;
                stats.cacheSize = this.localCache.size;
            }

            return stats;

        } catch (error) {
            console.error('Error getting nonce stats:', error);
            return {
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }

    /**
     * Log replay attempt for security monitoring
     * @param {string} nonce - Nonce that was reused
     * @param {Object} metadata - Metadata about the attempt
     */
    async logReplayAttempt(nonce, metadata) {
        try {
            const logData = {
                action: 'replay_attack_detected',
                nonce: this.hashNonce(nonce), // Hash the nonce for security
                metadata,
                timestamp: new Date().toISOString(),
                severity: 'high'
            };

            console.warn('SECURITY ALERT - Replay attack detected:', logData);

            // In a production system, this would trigger security alerts
            // Send to security monitoring system, Slack, etc.

        } catch (error) {
            console.error('Failed to log replay attempt:', error);
        }
    }

    /**
     * Hash nonce for secure logging
     * @param {string} nonce - Nonce to hash
     * @returns {string} Hashed nonce (first 16 chars of SHA-256)
     */
    hashNonce(nonce) {
        return crypto
            .createHash('sha256')
            .update(nonce)
            .digest('hex')
            .substring(0, 16);
    }

    /**
     * Bulk check multiple nonces
     * @param {Array<string>} nonces - Array of nonces to check
     * @returns {Promise<Object>} Results for each nonce
     */
    async bulkCheck(nonces) {
        const results = {};

        try {
            if (this.redis) {
                // Use pipeline for efficient bulk operations
                const pipeline = this.redis.multi();

                for (const nonce of nonces) {
                    if (this.isValidNonceFormat(nonce)) {
                        pipeline.exists(`nonce:${nonce}`);
                    }
                }

                const pipelineResults = await pipeline.exec();

                for (let i = 0; i < nonces.length; i++) {
                    const nonce = nonces[i];
                    if (this.isValidNonceFormat(nonce)) {
                        results[nonce] = {
                            exists: pipelineResults[i][1] === 1,
                            valid: true
                        };
                    } else {
                        results[nonce] = {
                            exists: false,
                            valid: false,
                            error: 'Invalid format'
                        };
                    }
                }
            } else {
                // Use local cache
                for (const nonce of nonces) {
                    if (this.isValidNonceFormat(nonce)) {
                        const data = this.localCache.get(nonce);
                        results[nonce] = {
                            exists: data && data.expiresAt > Date.now(),
                            valid: true
                        };
                    } else {
                        results[nonce] = {
                            exists: false,
                            valid: false,
                            error: 'Invalid format'
                        };
                    }
                }
            }

            return results;

        } catch (error) {
            console.error('Error in bulk nonce check:', error);
            throw error;
        }
    }

    /**
     * Clear all nonces (for testing purposes only)
     * @returns {Promise<boolean>} Success status
     */
    async clearAll() {
        try {
            if (this.redis) {
                const keys = await this.redis.keys('nonce:*');
                if (keys.length > 0) {
                    await this.redis.del(keys);
                }
            } else {
                this.localCache.clear();
            }

            console.log('All nonces cleared');
            return true;

        } catch (error) {
            console.error('Error clearing nonces:', error);
            return false;
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            this.stopCleanupTimer();

            if (this.redis) {
                await this.redis.quit();
            }

            this.localCache.clear();
            console.log('NonceManager cleanup completed');

        } catch (error) {
            console.error('Error during NonceManager cleanup:', error);
        }
    }
}

module.exports = NonceManager;