/**
 * Signature Service for Solana Deep Link Transfer System
 * Handles ED25519 signature verification with comprehensive security measures
 */

const nacl = require('tweetnacl');
const bs58 = require('bs58');
const crypto = require('crypto');
const Redis = require('redis');

class SignatureService {
    constructor() {
        this.SIGNATURE_VALIDITY_MS = 15 * 60 * 1000; // 15 minutes
        this.MAX_AMOUNT_SOL = 100;
        this.SUPPORTED_DOMAINS = process.env.SUPPORTED_DOMAINS?.split(',') || ['localhost:3000'];
        this.redis = null;
        this.nonceCache = new Map(); // Fallback cache if Redis unavailable

        this.initializeRedis();
    }

    /**
     * Initialize Redis connection for nonce tracking
     */
    async initializeRedis() {
        try {
            const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
            this.redis = Redis.createClient({ url: redisUrl });

            this.redis.on('error', (err) => {
                console.error('Redis connection error:', err);
                this.redis = null; // Fall back to in-memory cache
            });

            await this.redis.connect();
            console.log('Redis connected for signature service');

        } catch (error) {
            console.warn('Redis not available, using in-memory nonce cache:', error.message);
            this.redis = null;
        }
    }

    /**
     * Verify a deep link signature with comprehensive security checks
     * @param {Object} signatureData - Original signature data
     * @param {string} signature - Base58 encoded signature
     * @param {string} publicKey - Base58 encoded public key
     * @returns {Promise<Object>} Verification result
     */
    async verifySignature(signatureData, signature, publicKey) {
        try {
            // Step 1: Validate input parameters
            const inputValidation = this.validateInputs(signatureData, signature, publicKey);
            if (!inputValidation.valid) {
                return inputValidation;
            }

            // Step 2: Check timestamp validity
            const timeValidation = this.validateTimestamp(signatureData);
            if (!timeValidation.valid) {
                return timeValidation;
            }

            // Step 3: Check nonce (prevent replay attacks)
            const nonceValidation = await this.validateNonce(signatureData.nonce);
            if (!nonceValidation.valid) {
                return nonceValidation;
            }

            // Step 4: Validate domain
            const domainValidation = this.validateDomain(signatureData.domain);
            if (!domainValidation.valid) {
                return domainValidation;
            }

            // Step 5: Verify cryptographic signature
            const cryptoValidation = this.verifyCryptographicSignature(signatureData, signature, publicKey);
            if (!cryptoValidation.valid) {
                return cryptoValidation;
            }

            // Step 6: Perform business logic security checks
            const securityValidation = this.performSecurityChecks(signatureData);
            if (!securityValidation.valid) {
                return securityValidation;
            }

            // Step 7: Mark nonce as used (consume it)
            await this.consumeNonce(signatureData.nonce);

            // Step 8: Log successful verification
            await this.logVerificationSuccess(signatureData, publicKey);

            return {
                valid: true,
                data: signatureData,
                verifiedAt: new Date().toISOString()
            };

        } catch (error) {
            await this.logVerificationError(error, signatureData, publicKey);
            return {
                valid: false,
                error: `Signature verification failed: ${error.message}`
            };
        }
    }

    /**
     * Validate input parameters
     * @param {Object} signatureData - Signature data
     * @param {string} signature - Signature string
     * @param {string} publicKey - Public key string
     * @returns {Object} Validation result
     */
    validateInputs(signatureData, signature, publicKey) {
        if (!signatureData || typeof signatureData !== 'object') {
            return {
                valid: false,
                error: 'Invalid signature data format'
            };
        }

        if (!signature || typeof signature !== 'string') {
            return {
                valid: false,
                error: 'Invalid signature format'
            };
        }

        if (!publicKey || typeof publicKey !== 'string') {
            return {
                valid: false,
                error: 'Invalid public key format'
            };
        }

        // Check required fields in signature data
        const requiredFields = ['nonce', 'timestamp', 'expiry', 'domain', 'source', 'destination', 'amount'];
        for (const field of requiredFields) {
            if (!(field in signatureData)) {
                return {
                    valid: false,
                    error: `Missing required field: ${field}`
                };
            }
        }

        return { valid: true };
    }

    /**
     * Validate timestamp and expiry
     * @param {Object} signatureData - Signature data containing timestamp and expiry
     * @returns {Object} Validation result
     */
    validateTimestamp(signatureData) {
        const now = Date.now();
        const timestamp = parseInt(signatureData.timestamp);
        const expiry = parseInt(signatureData.expiry);

        // Check if timestamp is reasonable (not too far in past or future)
        const maxClockSkew = 5 * 60 * 1000; // 5 minutes
        if (timestamp > now + maxClockSkew) {
            return {
                valid: false,
                error: 'Signature timestamp is too far in the future'
            };
        }

        // Check if signature has expired
        if (now > expiry) {
            return {
                valid: false,
                error: 'Signature has expired'
            };
        }

        // Check if expiry is reasonable (within expected validity window)
        const maxValidityWindow = 24 * 60 * 60 * 1000; // 24 hours
        if (expiry - timestamp > maxValidityWindow) {
            return {
                valid: false,
                error: 'Signature validity window is too long'
            };
        }

        return { valid: true };
    }

    /**
     * Validate nonce to prevent replay attacks
     * @param {string} nonce - Nonce to validate
     * @returns {Promise<Object>} Validation result
     */
    async validateNonce(nonce) {
        try {
            if (!nonce || typeof nonce !== 'string') {
                return {
                    valid: false,
                    error: 'Invalid nonce format'
                };
            }

            // Check nonce format (should be base64url without padding)
            if (!/^[A-Za-z0-9_-]+$/.test(nonce)) {
                return {
                    valid: false,
                    error: 'Invalid nonce format'
                };
            }

            // Check if nonce has already been used
            const isUsed = await this.isNonceUsed(nonce);
            if (isUsed) {
                return {
                    valid: false,
                    error: 'Nonce has already been used (replay attack detected)'
                };
            }

            return { valid: true };

        } catch (error) {
            return {
                valid: false,
                error: `Nonce validation failed: ${error.message}`
            };
        }
    }

    /**
     * Check if nonce has been used
     * @param {string} nonce - Nonce to check
     * @returns {Promise<boolean>} True if nonce has been used
     */
    async isNonceUsed(nonce) {
        try {
            if (this.redis) {
                const result = await this.redis.get(`nonce:${nonce}`);
                return result !== null;
            } else {
                // Fallback to in-memory cache
                return this.nonceCache.has(nonce);
            }
        } catch (error) {
            console.error('Error checking nonce:', error);
            // On error, assume nonce is unused but log the issue
            return false;
        }
    }

    /**
     * Mark nonce as used
     * @param {string} nonce - Nonce to consume
     */
    async consumeNonce(nonce) {
        try {
            if (this.redis) {
                // Store nonce with expiration (24 hours to handle clock skew)
                await this.redis.setEx(`nonce:${nonce}`, 24 * 60 * 60, 'used');
            } else {
                // Fallback to in-memory cache
                this.nonceCache.set(nonce, Date.now());

                // Clean up old nonces periodically
                this.cleanupNonceCache();
            }
        } catch (error) {
            console.error('Error consuming nonce:', error);
            // This is critical - we should fail if we can't track nonces
            throw new Error('Failed to consume nonce - cannot prevent replay attacks');
        }
    }

    /**
     * Clean up old nonces from in-memory cache
     */
    cleanupNonceCache() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [nonce, timestamp] of this.nonceCache.entries()) {
            if (now - timestamp > maxAge) {
                this.nonceCache.delete(nonce);
            }
        }
    }

    /**
     * Validate domain to prevent cross-site attacks
     * @param {string} domain - Domain from signature data
     * @returns {Object} Validation result
     */
    validateDomain(domain) {
        if (!domain || typeof domain !== 'string') {
            return {
                valid: false,
                error: 'Invalid domain format'
            };
        }

        if (!this.SUPPORTED_DOMAINS.includes(domain)) {
            return {
                valid: false,
                error: `Unsupported domain: ${domain}`
            };
        }

        return { valid: true };
    }

    /**
     * Verify the cryptographic signature
     * @param {Object} signatureData - Original signature data
     * @param {string} signature - Base58 encoded signature
     * @param {string} publicKey - Base58 encoded public key
     * @returns {Object} Verification result
     */
    verifyCryptographicSignature(signatureData, signature, publicKey) {
        try {
            // Recreate the message that was signed
            const messageBytes = this.createMessageToSign(signatureData);

            // Decode signature and public key
            const signatureBytes = bs58.decode(signature);
            const publicKeyBytes = bs58.decode(publicKey);

            // Verify signature length
            if (signatureBytes.length !== 64) {
                return {
                    valid: false,
                    error: 'Invalid signature length'
                };
            }

            // Verify public key length
            if (publicKeyBytes.length !== 32) {
                return {
                    valid: false,
                    error: 'Invalid public key length'
                };
            }

            // Verify the signature
            const isValid = nacl.sign.detached.verify(
                messageBytes,
                signatureBytes,
                publicKeyBytes
            );

            if (!isValid) {
                return {
                    valid: false,
                    error: 'Cryptographic signature verification failed'
                };
            }

            return { valid: true };

        } catch (error) {
            return {
                valid: false,
                error: `Signature verification error: ${error.message}`
            };
        }
    }

    /**
     * Create the message that was signed (must match frontend)
     * @param {Object} signatureData - Signature data
     * @returns {Uint8Array} Message bytes
     */
    createMessageToSign(signatureData) {
        const message = [
            `nonce:${signatureData.nonce}`,
            `timestamp:${signatureData.timestamp}`,
            `expiry:${signatureData.expiry}`,
            `domain:${signatureData.domain}`,
            `version:${signatureData.version || '1.0'}`,
            `source:${signatureData.source}`,
            `destination:${signatureData.destination}`,
            `amount:${signatureData.amount}`,
            `token:${signatureData.token || 'SOL'}`,
            `memo:${signatureData.memo || ''}`,
            `maxSlippage:${signatureData.maxSlippage || 0.01}`
        ].join('\\n');

        return Buffer.from(message, 'utf8');
    }

    /**
     * Perform additional security checks on transfer data
     * @param {Object} signatureData - Signature data to validate
     * @returns {Object} Validation result
     */
    performSecurityChecks(signatureData) {
        // Check amount limits
        if (signatureData.token === 'SOL' && parseFloat(signatureData.amount) > this.MAX_AMOUNT_SOL) {
            return {
                valid: false,
                error: `Amount exceeds maximum limit of ${this.MAX_AMOUNT_SOL} SOL`
            };
        }

        // Validate wallet addresses
        if (!this.isValidSolanaAddress(signatureData.source) ||
            !this.isValidSolanaAddress(signatureData.destination)) {
            return {
                valid: false,
                error: 'Invalid wallet address format'
            };
        }

        // Check for self-transfer
        if (signatureData.source === signatureData.destination) {
            return {
                valid: false,
                error: 'Cannot transfer to same wallet'
            };
        }

        // Validate amount
        const amount = parseFloat(signatureData.amount);
        if (isNaN(amount) || amount <= 0) {
            return {
                valid: false,
                error: 'Invalid transfer amount'
            };
        }

        // Validate slippage
        const slippage = parseFloat(signatureData.maxSlippage);
        if (isNaN(slippage) || slippage < 0 || slippage > 0.1) {
            return {
                valid: false,
                error: 'Invalid slippage value (must be between 0 and 10%)'
            };
        }

        // Validate version
        if (signatureData.version && signatureData.version !== '1.0') {
            return {
                valid: false,
                error: 'Unsupported signature version'
            };
        }

        return { valid: true };
    }

    /**
     * Validate Solana wallet address format
     * @param {string} address - Wallet address to validate
     * @returns {boolean} True if valid format
     */
    isValidSolanaAddress(address) {
        try {
            const decoded = bs58.decode(address);
            return decoded.length === 32;
        } catch {
            return false;
        }
    }

    /**
     * Log successful signature verification
     * @param {Object} signatureData - Verified signature data
     * @param {string} publicKey - Public key used for verification
     */
    async logVerificationSuccess(signatureData, publicKey) {
        try {
            const logData = {
                action: 'signature_verified',
                success: true,
                nonce: signatureData.nonce,
                sourceHash: this.hashForLogging(signatureData.source),
                destinationHash: this.hashForLogging(signatureData.destination),
                publicKeyHash: this.hashForLogging(publicKey),
                amount: signatureData.amount,
                token: signatureData.token,
                domain: signatureData.domain,
                timestamp: new Date().toISOString()
            };

            console.log('Signature Verified:', logData);

            // Store in audit log if available
            // This would typically go to a database or logging service

        } catch (error) {
            console.error('Failed to log verification success:', error);
        }
    }

    /**
     * Log signature verification error
     * @param {Error} error - Error that occurred
     * @param {Object} signatureData - Signature data (may be invalid)
     * @param {string} publicKey - Public key used for verification attempt
     */
    async logVerificationError(error, signatureData, publicKey) {
        try {
            const logData = {
                action: 'signature_verification_failed',
                success: false,
                error: error.message,
                nonce: signatureData?.nonce || 'unknown',
                publicKeyHash: publicKey ? this.hashForLogging(publicKey) : 'unknown',
                timestamp: new Date().toISOString()
            };

            console.warn('Signature Verification Failed:', logData);

            // Store in audit log for security monitoring
            // This could trigger alerts for repeated failures

        } catch (logError) {
            console.error('Failed to log verification error:', logError);
        }
    }

    /**
     * Hash sensitive data for logging
     * @param {string} data - Data to hash
     * @returns {string} SHA-256 hash
     */
    hashForLogging(data) {
        return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
    }

    /**
     * Get signature verification statistics
     * @returns {Promise<Object>} Verification statistics
     */
    async getVerificationStats() {
        try {
            // This would typically query a database for statistics
            // For now, return mock data
            return {
                totalVerifications: 0,
                successfulVerifications: 0,
                failedVerifications: 0,
                replayAttempts: 0,
                lastUpdated: new Date().toISOString()
            };
        } catch (error) {
            console.error('Failed to get verification stats:', error);
            return null;
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            if (this.redis) {
                await this.redis.quit();
            }
            this.nonceCache.clear();
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }
}

module.exports = SignatureService;