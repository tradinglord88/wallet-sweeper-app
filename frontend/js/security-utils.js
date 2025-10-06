/**
 * Security Utilities for Solana Deep Link Transfer System
 * Provides cryptographic functions and security helpers
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';

export class SecurityUtils {
    static readonly SIGNATURE_VALIDITY_MS = 15 * 60 * 1000; // 15 minutes
    static readonly MAX_AMOUNT_SOL = 100;
    static readonly SUPPORTED_DOMAINS = ['localhost:3000', 'your-production-domain.com'];

    /**
     * Generate a cryptographically secure nonce
     * @returns {string} Base64 encoded nonce
     */
    static generateNonce() {
        const nonce = nacl.randomBytes(32);
        return btoa(String.fromCharCode(...nonce))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    /**
     * Create signature data for deep link
     * @param {Object} transferData - Transfer parameters
     * @returns {Object} Data to be signed
     */
    static createSignatureData(transferData) {
        const now = Date.now();
        const expiry = now + this.SIGNATURE_VALIDITY_MS;

        return {
            nonce: this.generateNonce(),
            timestamp: now,
            expiry: expiry,
            domain: window.location.host,
            version: '1.0',
            source: transferData.source,
            destination: transferData.destination,
            amount: transferData.amount,
            token: transferData.token || 'SOL',
            memo: transferData.memo || '',
            maxSlippage: transferData.maxSlippage || 0.01
        };
    }

    /**
     * Create message to sign from transfer data
     * @param {Object} signatureData - Data created by createSignatureData
     * @returns {Uint8Array} Message bytes to sign
     */
    static createMessageToSign(signatureData) {
        const message = [
            `nonce:${signatureData.nonce}`,
            `timestamp:${signatureData.timestamp}`,
            `expiry:${signatureData.expiry}`,
            `domain:${signatureData.domain}`,
            `version:${signatureData.version}`,
            `source:${signatureData.source}`,
            `destination:${signatureData.destination}`,
            `amount:${signatureData.amount}`,
            `token:${signatureData.token}`,
            `memo:${signatureData.memo}`,
            `maxSlippage:${signatureData.maxSlippage}`
        ].join('\\n');

        return new TextEncoder().encode(message);
    }

    /**
     * Sign transfer data with wallet's private key
     * @param {Object} transferData - Transfer parameters
     * @param {Uint8Array} privateKey - Wallet private key
     * @returns {Object} Signature data and signature
     */
    static async signTransferData(transferData, privateKey) {
        const signatureData = this.createSignatureData(transferData);
        const messageBytes = this.createMessageToSign(signatureData);

        const signature = nacl.sign.detached(messageBytes, privateKey);

        return {
            signatureData,
            signature: bs58.encode(signature)
        };
    }

    /**
     * Verify signature against public key and data
     * @param {Object} signatureData - Original signature data
     * @param {string} signature - Base58 encoded signature
     * @param {string} publicKey - Base58 encoded public key
     * @returns {Object} Verification result
     */
    static verifySignature(signatureData, signature, publicKey) {
        try {
            // Check timestamp validity
            const now = Date.now();
            if (now < signatureData.timestamp || now > signatureData.expiry) {
                return {
                    valid: false,
                    error: 'Signature expired or timestamp invalid'
                };
            }

            // Check domain validity
            if (!this.SUPPORTED_DOMAINS.includes(signatureData.domain)) {
                return {
                    valid: false,
                    error: 'Invalid domain'
                };
            }

            // Verify cryptographic signature
            const messageBytes = this.createMessageToSign(signatureData);
            const signatureBytes = bs58.decode(signature);
            const publicKeyBytes = bs58.decode(publicKey);

            const isValid = nacl.sign.detached.verify(
                messageBytes,
                signatureBytes,
                publicKeyBytes
            );

            if (!isValid) {
                return {
                    valid: false,
                    error: 'Invalid cryptographic signature'
                };
            }

            // Additional security checks
            const securityCheck = this.performSecurityChecks(signatureData);
            if (!securityCheck.valid) {
                return securityCheck;
            }

            return {
                valid: true,
                data: signatureData
            };

        } catch (error) {
            return {
                valid: false,
                error: `Signature verification failed: ${error.message}`
            };
        }
    }

    /**
     * Perform additional security checks on transfer data
     * @param {Object} signatureData - Signature data to validate
     * @returns {Object} Validation result
     */
    static performSecurityChecks(signatureData) {
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

        return { valid: true };
    }

    /**
     * Validate Solana wallet address format
     * @param {string} address - Wallet address to validate
     * @returns {boolean} True if valid format
     */
    static isValidSolanaAddress(address) {
        try {
            const decoded = bs58.decode(address);
            return decoded.length === 32;
        } catch {
            return false;
        }
    }

    /**
     * Sanitize memo text for safe display
     * @param {string} memo - Memo text to sanitize
     * @returns {string} Sanitized memo
     */
    static sanitizeMemo(memo) {
        if (!memo || typeof memo !== 'string') return '';

        return memo
            .replace(/[<>\"'&]/g, '') // Remove HTML/script characters
            .substring(0, 200) // Limit length
            .trim();
    }

    /**
     * Create deep link URL with signature
     * @param {Object} signedData - Signed transfer data
     * @returns {string} Complete deep link URL
     */
    static createDeepLink(signedData) {
        const params = new URLSearchParams({
            d: btoa(JSON.stringify(signedData.signatureData)), // data
            s: signedData.signature, // signature
            v: '1.0' // version
        });

        return `${window.location.origin}/execute?${params.toString()}`;
    }

    /**
     * Parse deep link URL to extract transfer data
     * @param {string} url - Deep link URL
     * @returns {Object} Parsed transfer data
     */
    static parseDeepLink(url) {
        try {
            const urlObj = new URL(url);
            const params = new URLSearchParams(urlObj.search);

            const dataB64 = params.get('d');
            const signature = params.get('s');
            const version = params.get('v');

            if (!dataB64 || !signature || !version) {
                throw new Error('Missing required parameters');
            }

            if (version !== '1.0') {
                throw new Error('Unsupported link version');
            }

            const signatureData = JSON.parse(atob(dataB64));

            return {
                signatureData,
                signature,
                version
            };
        } catch (error) {
            throw new Error(`Invalid deep link format: ${error.message}`);
        }
    }

    /**
     * Generate secure random ID for tracking
     * @returns {string} Random tracking ID
     */
    static generateTrackingId() {
        const bytes = nacl.randomBytes(16);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Hash sensitive data for logging
     * @param {string} data - Data to hash
     * @returns {string} SHA-256 hash
     */
    static async hashForLogging(data) {
        const encoder = new TextEncoder();
        const dataBytes = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

// Export for use in other modules
export default SecurityUtils;