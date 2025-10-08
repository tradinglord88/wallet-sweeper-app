/**
 * Enterprise Rate Limiting Middleware
 * Prevents abuse and ensures fair resource allocation
 */

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');

// Create Redis client for distributed rate limiting
const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true
});

// Handle Redis errors gracefully
redisClient.on('error', (err) => {
    console.error('Redis rate limiter error:', err);
});

/**
 * Create different rate limiters for different endpoints
 */

// General API rate limiter
const apiLimiter = rateLimit({
    store: new RedisStore({
        client: redisClient,
        prefix: 'rl:api:',
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/health';
    }
});

// Wallet connection rate limiter (stricter)
const walletConnectionLimiter = rateLimit({
    store: new RedisStore({
        client: redisClient,
        prefix: 'rl:wallet:',
    }),
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 wallet connections per 5 minutes per IP
    message: 'Too many wallet connection attempts. Please wait before trying again.',
    skipSuccessfulRequests: false,
    standardHeaders: true,
    legacyHeaders: false
});

// Sweep/claim action rate limiter (very strict)
const sweepActionLimiter = rateLimit({
    store: new RedisStore({
        client: redisClient,
        prefix: 'rl:sweep:',
    }),
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 sweep attempts per hour per IP
    message: 'Sweep action rate limit exceeded. Please wait before attempting another sweep.',
    skipFailedRequests: false
});

// Public data endpoints (more lenient)
const publicDataLimiter = rateLimit({
    store: new RedisStore({
        client: redisClient,
        prefix: 'rl:public:',
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 300, // 300 requests per minute
    message: 'Rate limit exceeded for public data access.'
});

// DDoS protection layer (very strict for suspected attacks)
const ddosProtection = rateLimit({
    store: new RedisStore({
        client: redisClient,
        prefix: 'rl:ddos:',
    }),
    windowMs: 10 * 1000, // 10 seconds
    max: 50, // 50 requests per 10 seconds
    message: 'Suspicious activity detected. Access temporarily blocked.',
    skipSuccessfulRequests: false,
    requestWasSuccessful: (req, res) => res.statusCode < 400,
    skip: (req) => {
        // Whitelist certain IPs if needed
        const whitelistedIPs = process.env.WHITELISTED_IPS?.split(',') || [];
        return whitelistedIPs.includes(req.ip);
    }
});

// Premium tier rate limiter (for future API key holders)
const premiumLimiter = rateLimit({
    store: new RedisStore({
        client: redisClient,
        prefix: 'rl:premium:',
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 1000, // 1000 requests per minute for premium users
    message: 'Premium rate limit exceeded.',
    keyGenerator: (req) => {
        // Use API key instead of IP for premium users
        return req.headers['x-api-key'] || req.ip;
    }
});

// Dynamic rate limiter based on server load
class DynamicRateLimiter {
    constructor() {
        this.currentLoad = 0;
        this.loadCheckInterval = setInterval(() => this.checkLoad(), 5000);
    }

    checkLoad() {
        // Check system load and adjust rate limits dynamically
        const os = require('os');
        const loadAvg = os.loadavg()[0];
        const cpuCount = os.cpus().length;
        this.currentLoad = loadAvg / cpuCount;
    }

    getDynamicLimit(baseLimit) {
        if (this.currentLoad > 0.8) {
            return Math.floor(baseLimit * 0.5); // Reduce by 50% under high load
        } else if (this.currentLoad > 0.6) {
            return Math.floor(baseLimit * 0.75); // Reduce by 25% under moderate load
        }
        return baseLimit;
    }
}

const dynamicLimiter = new DynamicRateLimiter();

module.exports = {
    apiLimiter,
    walletConnectionLimiter,
    sweepActionLimiter,
    publicDataLimiter,
    ddosProtection,
    premiumLimiter,
    dynamicLimiter,
    redisClient
};