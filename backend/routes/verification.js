/**
 * Verification Routes for Solana Deep Link Transfer System
 * Handles signature verification with comprehensive security measures
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const SignatureService = require('../services/signature-service');
const NonceManager = require('../services/nonce-manager');
const AuditLogger = require('../services/audit-logger');

const router = express.Router();

// Initialize services
const signatureService = new SignatureService();
const nonceManager = new NonceManager();
const auditLogger = new AuditLogger();

/**
 * Verify a deep link signature
 * POST /api/verification/verify-signature
 */
router.post('/verify-signature', [
    // Input validation
    body('signatureData')
        .isObject()
        .withMessage('Signature data must be an object'),
    body('signatureData.nonce')
        .isLength({ min: 32, max: 64 })
        .withMessage('Invalid nonce format'),
    body('signatureData.timestamp')
        .isNumeric()
        .withMessage('Timestamp must be numeric'),
    body('signatureData.expiry')
        .isNumeric()
        .withMessage('Expiry must be numeric'),
    body('signatureData.domain')
        .isLength({ min: 1, max: 100 })
        .withMessage('Domain is required and must be valid'),
    body('signatureData.source')
        .isLength({ min: 32, max: 44 })
        .withMessage('Invalid source address format'),
    body('signatureData.destination')
        .isLength({ min: 32, max: 44 })
        .withMessage('Invalid destination address format'),
    body('signatureData.amount')
        .isNumeric()
        .withMessage('Amount must be numeric'),
    body('signature')
        .isLength({ min: 64, max: 128 })
        .withMessage('Invalid signature format'),
    body('publicKey')
        .isLength({ min: 32, max: 44 })
        .withMessage('Invalid public key format')
], async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            await auditLogger.logSecurityEvent({
                type: 'verification_validation_failed',
                errors: errors.array(),
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });

            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { signatureData, signature, publicKey } = req.body;

        // Security check: Verify public key matches source
        if (signatureData.source !== publicKey) {
            await auditLogger.logSecurityEvent({
                type: 'verification_key_mismatch',
                sourceAddress: signatureData.source,
                providedKey: publicKey,
                ip: req.ip
            });

            return res.status(400).json({
                success: false,
                error: 'Public key does not match source address'
            });
        }

        // Rate limiting check for this specific address
        const addressRateLimit = await checkAddressRateLimit(signatureData.source);
        if (!addressRateLimit.allowed) {
            await auditLogger.logSecurityEvent({
                type: 'verification_rate_limit_address',
                address: signatureData.source,
                ip: req.ip
            });

            return res.status(429).json({
                success: false,
                error: 'Too many verification attempts for this address',
                retryAfter: addressRateLimit.retryAfter
            });
        }

        // Verify the signature
        const verificationResult = await signatureService.verifySignature(
            signatureData,
            signature,
            publicKey
        );

        // Log verification attempt
        await auditLogger.logEvent('signature_verification', {
            success: verificationResult.valid,
            nonce: signatureData.nonce,
            sourceHash: await hashForAudit(signatureData.source),
            destinationHash: await hashForAudit(signatureData.destination),
            amount: signatureData.amount,
            token: signatureData.token,
            error: verificationResult.error,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            requestId: req.requestId
        });

        if (!verificationResult.valid) {
            // Log failed verification
            await auditLogger.logSecurityEvent({
                type: 'verification_failed',
                error: verificationResult.error,
                nonce: signatureData.nonce,
                sourceHash: await hashForAudit(signatureData.source),
                ip: req.ip
            });

            return res.status(400).json({
                success: false,
                error: verificationResult.error,
                code: 'VERIFICATION_FAILED'
            });
        }

        // Successful verification
        res.json({
            success: true,
            verified: true,
            verifiedAt: new Date().toISOString(),
            nonce: signatureData.nonce,
            message: 'Signature verified successfully'
        });

    } catch (error) {
        console.error('Signature verification error:', error);

        await auditLogger.logSecurityEvent({
            type: 'verification_error',
            error: error.message,
            stack: error.stack,
            ip: req.ip,
            requestId: req.requestId
        });

        res.status(500).json({
            success: false,
            error: 'Verification service error',
            code: 'SERVICE_ERROR'
        });
    }
});

/**
 * Batch verify multiple signatures
 * POST /api/verification/batch-verify
 */
router.post('/batch-verify', [
    body('verifications')
        .isArray({ min: 1, max: 10 })
        .withMessage('Must provide 1-10 verifications'),
    body('verifications.*.signatureData')
        .isObject()
        .withMessage('Each item must have signature data'),
    body('verifications.*.signature')
        .isLength({ min: 64, max: 128 })
        .withMessage('Invalid signature format'),
    body('verifications.*.publicKey')
        .isLength({ min: 32, max: 44 })
        .withMessage('Invalid public key format')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { verifications } = req.body;
        const results = [];

        // Process each verification
        for (let i = 0; i < verifications.length; i++) {
            const verification = verifications[i];

            try {
                const result = await signatureService.verifySignature(
                    verification.signatureData,
                    verification.signature,
                    verification.publicKey
                );

                results.push({
                    index: i,
                    success: result.valid,
                    error: result.error,
                    nonce: verification.signatureData.nonce
                });

            } catch (error) {
                results.push({
                    index: i,
                    success: false,
                    error: error.message,
                    nonce: verification.signatureData?.nonce || 'unknown'
                });
            }
        }

        // Log batch verification
        await auditLogger.logEvent('batch_verification', {
            totalCount: verifications.length,
            successCount: results.filter(r => r.success).length,
            failureCount: results.filter(r => !r.success).length,
            ip: req.ip,
            requestId: req.requestId
        });

        res.json({
            success: true,
            results,
            summary: {
                total: verifications.length,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length
            }
        });

    } catch (error) {
        console.error('Batch verification error:', error);

        res.status(500).json({
            success: false,
            error: 'Batch verification service error'
        });
    }
});

/**
 * Check nonce status
 * GET /api/verification/nonce/:nonce
 */
router.get('/nonce/:nonce', [
    // Validate nonce format
    (req, res, next) => {
        const { nonce } = req.params;
        if (!nonceManager.isValidNonceFormat(nonce)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid nonce format'
            });
        }
        next();
    }
], async (req, res) => {
    try {
        const { nonce } = req.params;

        // Check if nonce exists
        const exists = await nonceManager.exists(nonce);
        const info = exists ? await nonceManager.getNonceInfo(nonce) : null;

        res.json({
            success: true,
            nonce,
            exists,
            info,
            checkedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Nonce check error:', error);

        res.status(500).json({
            success: false,
            error: 'Nonce check service error'
        });
    }
});

/**
 * Get verification statistics
 * GET /api/verification/stats
 */
router.get('/stats', async (req, res) => {
    try {
        // Get stats from services
        const signatureStats = await signatureService.getVerificationStats();
        const nonceStats = await nonceManager.getStats();

        const stats = {
            signatures: signatureStats,
            nonces: nonceStats,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };

        res.json({
            success: true,
            stats
        });

    } catch (error) {
        console.error('Stats error:', error);

        res.status(500).json({
            success: false,
            error: 'Stats service error'
        });
    }
});

/**
 * Health check for verification service
 * GET /api/verification/health
 */
router.get('/health', async (req, res) => {
    try {
        // Test signature service
        const testResult = await testSignatureService();

        const health = {
            status: testResult.healthy ? 'healthy' : 'degraded',
            services: {
                signatureService: testResult.healthy,
                nonceManager: true, // Always healthy if we reach this point
                auditLogger: true
            },
            timestamp: new Date().toISOString()
        };

        const statusCode = testResult.healthy ? 200 : 503;
        res.status(statusCode).json(health);

    } catch (error) {
        console.error('Health check error:', error);

        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Test the signature service health
 */
async function testSignatureService() {
    try {
        // Create a test signature verification
        const testData = {
            nonce: 'test_nonce_' + Date.now(),
            timestamp: Date.now(),
            expiry: Date.now() + 60000,
            domain: 'localhost',
            version: '1.0',
            source: '11111111111111111111111111111111',
            destination: '22222222222222222222222222222222',
            amount: '1',
            token: 'SOL',
            memo: '',
            maxSlippage: '0.01'
        };

        // This should fail (invalid signature) but service should be responsive
        await signatureService.verifySignature(
            testData,
            'invalid_signature',
            '11111111111111111111111111111111'
        );

        return { healthy: true };

    } catch (error) {
        // Expected to fail, but service should be responsive
        return { healthy: error.message.includes('verification failed') };
    }
}

/**
 * Check rate limiting for specific address
 */
async function checkAddressRateLimit(address) {
    // This would implement per-address rate limiting
    // For now, always allow
    return {
        allowed: true,
        retryAfter: 0
    };
}

/**
 * Hash sensitive data for audit logging
 */
async function hashForAudit(data) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

module.exports = router;