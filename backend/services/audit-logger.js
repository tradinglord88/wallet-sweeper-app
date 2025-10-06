/**
 * Audit Logger Service for Solana Deep Link Transfer System
 * Provides comprehensive audit logging with security monitoring capabilities
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class AuditLogger {
    constructor() {
        this.logDirectory = process.env.AUDIT_LOG_DIRECTORY || './logs';
        this.maxLogFileSize = 50 * 1024 * 1024; // 50MB
        this.maxLogFiles = 10;
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.enableFileLogging = process.env.ENABLE_FILE_LOGGING !== 'false';
        this.enableDatabaseLogging = process.env.ENABLE_DATABASE_LOGGING === 'true';

        // Log levels
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };

        // Initialize logging
        this.initializeLogging();

        // Security alert thresholds
        this.alertThresholds = {
            failedVerifications: 10, // per 15 minutes
            rateLimitExceeded: 5,    // per 15 minutes
            suspiciousIPs: 3         // per hour
        };

        // In-memory counters for alerts
        this.alertCounters = new Map();

        // Clean up counters periodically
        this.startCounterCleanup();
    }

    /**
     * Initialize logging infrastructure
     */
    async initializeLogging() {
        try {
            if (this.enableFileLogging) {
                await this.ensureLogDirectory();
                console.log(`Audit logging initialized: ${this.logDirectory}`);
            }
        } catch (error) {
            console.error('Failed to initialize audit logging:', error);
        }
    }

    /**
     * Ensure log directory exists
     */
    async ensureLogDirectory() {
        try {
            await fs.access(this.logDirectory);
        } catch {
            await fs.mkdir(this.logDirectory, { recursive: true });
        }
    }

    /**
     * Log a general event
     * @param {string} eventType - Type of event
     * @param {Object} data - Event data
     * @param {string} level - Log level (error, warn, info, debug)
     */
    async logEvent(eventType, data, level = 'info') {
        try {
            const logEntry = this.createLogEntry(eventType, data, level);

            // Console logging
            this.logToConsole(logEntry);

            // File logging
            if (this.enableFileLogging) {
                await this.logToFile(logEntry, 'events');
            }

            // Database logging (if enabled)
            if (this.enableDatabaseLogging) {
                await this.logToDatabase(logEntry);
            }

        } catch (error) {
            console.error('Failed to log event:', error);
        }
    }

    /**
     * Log a security event with enhanced monitoring
     * @param {Object} securityData - Security event data
     */
    async logSecurityEvent(securityData) {
        try {
            const logEntry = this.createLogEntry('security_event', securityData, 'warn');

            // Enhanced security logging
            logEntry.security = {
                severity: this.calculateSeverity(securityData.type),
                category: this.categorizeSecurityEvent(securityData.type),
                requiresAlert: this.shouldAlert(securityData)
            };

            // Console logging with highlighting
            this.logSecurityToConsole(logEntry);

            // File logging
            if (this.enableFileLogging) {
                await this.logToFile(logEntry, 'security');
            }

            // Database logging
            if (this.enableDatabaseLogging) {
                await this.logToDatabase(logEntry);
            }

            // Update alert counters
            this.updateAlertCounters(securityData);

            // Send alerts if necessary
            if (logEntry.security.requiresAlert) {
                await this.sendSecurityAlert(logEntry);
            }

        } catch (error) {
            console.error('Failed to log security event:', error);
        }
    }

    /**
     * Log HTTP request details
     * @param {Object} req - Express request object
     */
    async logRequest(req) {
        try {
            const requestData = {
                method: req.method,
                url: req.url,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                referer: req.get('Referer'),
                contentLength: req.get('Content-Length'),
                timestamp: new Date().toISOString(),
                requestId: req.requestId
            };

            // Only log sensitive endpoints or errors
            if (this.shouldLogRequest(req)) {
                await this.logEvent('http_request', requestData, 'debug');
            }

        } catch (error) {
            console.error('Failed to log request:', error);
        }
    }

    /**
     * Log HTTP response details
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    async logResponse(req, res) {
        try {
            const responseData = {
                method: req.method,
                url: req.url,
                statusCode: res.statusCode,
                responseTime: Date.now() - req.startTime,
                contentLength: res.get('Content-Length'),
                timestamp: new Date().toISOString(),
                requestId: req.requestId
            };

            // Log errors and sensitive operations
            if (res.statusCode >= 400 || this.shouldLogRequest(req)) {
                const level = res.statusCode >= 500 ? 'error' : 'info';
                await this.logEvent('http_response', responseData, level);
            }

        } catch (error) {
            console.error('Failed to log response:', error);
        }
    }

    /**
     * Create standardized log entry
     * @param {string} eventType - Type of event
     * @param {Object} data - Event data
     * @param {string} level - Log level
     * @returns {Object} Formatted log entry
     */
    createLogEntry(eventType, data, level) {
        return {
            timestamp: new Date().toISOString(),
            level: level.toUpperCase(),
            eventType,
            data: this.sanitizeLogData(data),
            pid: process.pid,
            hostname: require('os').hostname(),
            version: process.env.npm_package_version || '1.0.0',
            environment: process.env.NODE_ENV || 'development'
        };
    }

    /**
     * Sanitize sensitive data from logs
     * @param {Object} data - Raw data
     * @returns {Object} Sanitized data
     */
    sanitizeLogData(data) {
        const sensitiveFields = [
            'privateKey',
            'signature',
            'password',
            'token',
            'secret',
            'key'
        ];

        const sanitized = JSON.parse(JSON.stringify(data));

        const sanitizeObject = (obj) => {
            for (const key in obj) {
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    sanitizeObject(obj[key]);
                } else if (typeof obj[key] === 'string') {
                    // Check if field contains sensitive data
                    const lowerKey = key.toLowerCase();
                    const isSensitive = sensitiveFields.some(field =>
                        lowerKey.includes(field)
                    );

                    if (isSensitive) {
                        obj[key] = this.maskSensitiveData(obj[key]);
                    }

                    // Mask long strings that might be addresses or signatures
                    if (obj[key].length > 40 && !lowerKey.includes('hash')) {
                        obj[key] = this.maskSensitiveData(obj[key]);
                    }
                }
            }
        };

        sanitizeObject(sanitized);
        return sanitized;
    }

    /**
     * Mask sensitive data while keeping some characters for debugging
     * @param {string} data - Sensitive data
     * @returns {string} Masked data
     */
    maskSensitiveData(data) {
        if (!data || typeof data !== 'string') return data;

        if (data.length <= 8) {
            return '*'.repeat(data.length);
        }

        const visibleChars = 4;
        const start = data.substring(0, visibleChars);
        const end = data.substring(data.length - visibleChars);
        const middle = '*'.repeat(Math.max(data.length - (visibleChars * 2), 3));

        return `${start}${middle}${end}`;
    }

    /**
     * Log to console with formatting
     * @param {Object} logEntry - Log entry
     */
    logToConsole(logEntry) {
        if (this.levels[logEntry.level.toLowerCase()] > this.levels[this.logLevel]) {
            return;
        }

        const colors = {
            ERROR: '\x1b[31m',   // Red
            WARN: '\x1b[33m',    // Yellow
            INFO: '\x1b[36m',    // Cyan
            DEBUG: '\x1b[37m'    // White
        };

        const reset = '\x1b[0m';
        const color = colors[logEntry.level] || colors.INFO;

        console.log(
            `${color}[${logEntry.timestamp}] ${logEntry.level} ${logEntry.eventType}${reset}`,
            JSON.stringify(logEntry.data, null, 2)
        );
    }

    /**
     * Log security events to console with highlighting
     * @param {Object} logEntry - Security log entry
     */
    logSecurityToConsole(logEntry) {
        const red = '\x1b[31m';
        const yellow = '\x1b[33m';
        const reset = '\x1b[0m';

        const severity = logEntry.security.severity;
        const color = severity === 'high' ? red : yellow;

        console.log(
            `${color}🚨 SECURITY ALERT [${logEntry.timestamp}] ${logEntry.eventType}${reset}`
        );
        console.log(
            `${color}Severity: ${severity} | Category: ${logEntry.security.category}${reset}`
        );
        console.log(JSON.stringify(logEntry.data, null, 2));
    }

    /**
     * Log to file
     * @param {Object} logEntry - Log entry
     * @param {string} logType - Type of log (events, security, etc.)
     */
    async logToFile(logEntry, logType = 'events') {
        try {
            const filename = `${logType}-${new Date().toISOString().split('T')[0]}.log`;
            const filepath = path.join(this.logDirectory, filename);

            const logLine = JSON.stringify(logEntry) + '\\n';

            // Check file size and rotate if necessary
            await this.rotateLogIfNeeded(filepath);

            // Append to log file
            await fs.appendFile(filepath, logLine);

        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    /**
     * Rotate log file if it exceeds size limit
     * @param {string} filepath - Path to log file
     */
    async rotateLogIfNeeded(filepath) {
        try {
            const stats = await fs.stat(filepath);

            if (stats.size > this.maxLogFileSize) {
                const timestamp = Date.now();
                const rotatedPath = `${filepath}.${timestamp}`;
                await fs.rename(filepath, rotatedPath);

                // Clean up old rotated files
                await this.cleanupOldLogFiles(path.dirname(filepath));
            }

        } catch (error) {
            // File doesn't exist yet, which is fine
            if (error.code !== 'ENOENT') {
                console.error('Error checking log file size:', error);
            }
        }
    }

    /**
     * Clean up old rotated log files
     * @param {string} logDir - Log directory
     */
    async cleanupOldLogFiles(logDir) {
        try {
            const files = await fs.readdir(logDir);
            const logFiles = files
                .filter(file => file.includes('.log.'))
                .map(file => ({
                    name: file,
                    path: path.join(logDir, file),
                    timestamp: parseInt(file.split('.').pop())
                }))
                .sort((a, b) => b.timestamp - a.timestamp);

            // Remove old files beyond maxLogFiles
            if (logFiles.length > this.maxLogFiles) {
                const filesToDelete = logFiles.slice(this.maxLogFiles);

                for (const file of filesToDelete) {
                    await fs.unlink(file.path);
                }
            }

        } catch (error) {
            console.error('Error cleaning up old log files:', error);
        }
    }

    /**
     * Log to database (placeholder for database integration)
     * @param {Object} logEntry - Log entry
     */
    async logToDatabase(logEntry) {
        try {
            // This would integrate with your database
            // For example: PostgreSQL, MongoDB, etc.
            console.log('Database logging not implemented yet');

        } catch (error) {
            console.error('Failed to log to database:', error);
        }
    }

    /**
     * Calculate security event severity
     * @param {string} eventType - Type of security event
     * @returns {string} Severity level
     */
    calculateSeverity(eventType) {
        const highSeverityEvents = [
            'replay_attack_detected',
            'unauthorized_access',
            'signature_forgery_attempt',
            'rate_limit_exceeded',
            'verification_failed'
        ];

        const mediumSeverityEvents = [
            'verification_validation_failed',
            'suspicious_activity',
            'unusual_traffic_pattern'
        ];

        if (highSeverityEvents.includes(eventType)) {
            return 'high';
        } else if (mediumSeverityEvents.includes(eventType)) {
            return 'medium';
        } else {
            return 'low';
        }
    }

    /**
     * Categorize security events
     * @param {string} eventType - Type of security event
     * @returns {string} Category
     */
    categorizeSecurityEvent(eventType) {
        if (eventType.includes('verification') || eventType.includes('signature')) {
            return 'authentication';
        } else if (eventType.includes('rate_limit') || eventType.includes('traffic')) {
            return 'abuse';
        } else if (eventType.includes('access') || eventType.includes('unauthorized')) {
            return 'access_control';
        } else {
            return 'general';
        }
    }

    /**
     * Determine if security event should trigger alert
     * @param {Object} securityData - Security event data
     * @returns {boolean} Should alert
     */
    shouldAlert(securityData) {
        const alertableEvents = [
            'replay_attack_detected',
            'rate_limit_exceeded',
            'verification_failed'
        ];

        return alertableEvents.includes(securityData.type);
    }

    /**
     * Update alert counters for rate-based alerting
     * @param {Object} securityData - Security event data
     */
    updateAlertCounters(securityData) {
        const key = `${securityData.type}_${securityData.ip || 'unknown'}`;
        const now = Date.now();

        if (!this.alertCounters.has(key)) {
            this.alertCounters.set(key, []);
        }

        const counter = this.alertCounters.get(key);
        counter.push(now);

        // Keep only events from last hour
        const oneHourAgo = now - (60 * 60 * 1000);
        this.alertCounters.set(key, counter.filter(timestamp => timestamp > oneHourAgo));
    }

    /**
     * Send security alert
     * @param {Object} logEntry - Security log entry
     */
    async sendSecurityAlert(logEntry) {
        try {
            // This would integrate with alerting systems
            // For example: Slack, email, webhook, etc.

            const alertData = {
                alert: 'SECURITY_ALERT',
                severity: logEntry.security.severity,
                category: logEntry.security.category,
                eventType: logEntry.eventType,
                timestamp: logEntry.timestamp,
                data: logEntry.data
            };

            console.log('🚨 SECURITY ALERT:', JSON.stringify(alertData, null, 2));

            // Send to webhook if configured
            if (process.env.WEBHOOK_ALERT_URL) {
                await this.sendWebhookAlert(alertData);
            }

        } catch (error) {
            console.error('Failed to send security alert:', error);
        }
    }

    /**
     * Send alert to webhook
     * @param {Object} alertData - Alert data
     */
    async sendWebhookAlert(alertData) {
        try {
            const fetch = require('node-fetch');

            await fetch(process.env.WEBHOOK_ALERT_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(alertData)
            });

        } catch (error) {
            console.error('Failed to send webhook alert:', error);
        }
    }

    /**
     * Determine if request should be logged
     * @param {Object} req - Express request object
     * @returns {boolean} Should log
     */
    shouldLogRequest(req) {
        const sensitiveEndpoints = [
            '/api/verification',
            '/api/transactions',
            '/api/audit'
        ];

        return sensitiveEndpoints.some(endpoint => req.url.startsWith(endpoint));
    }

    /**
     * Start periodic cleanup of alert counters
     */
    startCounterCleanup() {
        setInterval(() => {
            const now = Date.now();
            const oneHourAgo = now - (60 * 60 * 1000);

            for (const [key, timestamps] of this.alertCounters.entries()) {
                const recentTimestamps = timestamps.filter(timestamp => timestamp > oneHourAgo);

                if (recentTimestamps.length === 0) {
                    this.alertCounters.delete(key);
                } else {
                    this.alertCounters.set(key, recentTimestamps);
                }
            }
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    /**
     * Get audit statistics
     * @returns {Object} Audit statistics
     */
    getAuditStats() {
        return {
            alertCounters: this.alertCounters.size,
            logLevel: this.logLevel,
            fileLoggingEnabled: this.enableFileLogging,
            databaseLoggingEnabled: this.enableDatabaseLogging,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            this.alertCounters.clear();
            console.log('Audit logger cleanup completed');
        } catch (error) {
            console.error('Error during audit logger cleanup:', error);
        }
    }
}

module.exports = AuditLogger;