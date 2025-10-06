/**
 * Deep Link Generator for Secure Solana Transfers
 * Handles creation of signed deep links with comprehensive security measures
 */

import SecurityUtils from './security-utils.js';
import WalletConnector from './wallet-connector.js';

export class DeepLinkGenerator {
    constructor() {
        this.walletConnector = new WalletConnector();
        this.generatedLinks = new Map(); // Cache generated links
    }

    /**
     * Initialize the generator with wallet connection
     */
    async initialize() {
        await this.walletConnector.initialize();
    }

    /**
     * Generate a secure deep link for Solana transfer
     * @param {Object} transferData - Transfer parameters
     * @returns {Promise<Object>} Generated link data with QR code
     */
    async generateDeepLink(transferData) {
        try {
            // Validate inputs
            const validation = this.validateTransferData(transferData);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            // Ensure wallet is connected
            if (!this.walletConnector.isConnected()) {
                throw new Error('Wallet not connected. Please connect your wallet first.');
            }

            // Get wallet information
            const walletInfo = await this.walletConnector.getWalletInfo();

            // Add source wallet to transfer data
            const completeTransferData = {
                ...transferData,
                source: walletInfo.publicKey
            };

            // Sign the transfer data
            const signedData = await this.signTransferData(completeTransferData);

            // Create deep link URL
            const deepLinkUrl = SecurityUtils.createDeepLink(signedData);

            // Generate QR code
            const qrCodeDataUrl = await this.generateQRCode(deepLinkUrl);

            // Generate tracking ID
            const trackingId = SecurityUtils.generateTrackingId();

            // Create link metadata
            const linkData = {
                trackingId,
                url: deepLinkUrl,
                qrCode: qrCodeDataUrl,
                transferData: completeTransferData,
                signature: signedData.signature,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(signedData.signatureData.expiry).toISOString(),
                status: 'active'
            };

            // Cache the generated link
            this.generatedLinks.set(trackingId, linkData);

            // Log the generation (with hashed sensitive data)
            await this.logLinkGeneration(linkData);

            // Send to backend for storage and monitoring
            await this.storeLinkData(linkData);

            return linkData;

        } catch (error) {
            console.error('Failed to generate deep link:', error);
            throw error;
        }
    }

    /**
     * Validate transfer data before processing
     * @param {Object} transferData - Data to validate
     * @returns {Object} Validation result
     */
    validateTransferData(transferData) {
        const { destination, amount, token = 'SOL', memo = '' } = transferData;

        // Check required fields
        if (!destination || !amount) {
            return {
                valid: false,
                error: 'Destination address and amount are required'
            };
        }

        // Validate destination address
        if (!SecurityUtils.isValidSolanaAddress(destination)) {
            return {
                valid: false,
                error: 'Invalid destination wallet address'
            };
        }

        // Validate amount
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return {
                valid: false,
                error: 'Amount must be a positive number'
            };
        }

        // Check amount limits
        if (token === 'SOL' && numericAmount > SecurityUtils.MAX_AMOUNT_SOL) {
            return {
                valid: false,
                error: `Amount cannot exceed ${SecurityUtils.MAX_AMOUNT_SOL} SOL`
            };
        }

        // Validate memo if provided
        if (memo && memo.length > 200) {
            return {
                valid: false,
                error: 'Memo cannot exceed 200 characters'
            };
        }

        // Check supported tokens
        const supportedTokens = ['SOL', 'USDC', 'USDT'];
        if (!supportedTokens.includes(token)) {
            return {
                valid: false,
                error: `Unsupported token: ${token}`
            };
        }

        return { valid: true };
    }

    /**
     * Sign transfer data using connected wallet
     * @param {Object} transferData - Complete transfer data
     * @returns {Promise<Object>} Signed data
     */
    async signTransferData(transferData) {
        try {
            // For wallet adapters that don't expose private key, use signMessage
            const message = SecurityUtils.createMessageToSign(
                SecurityUtils.createSignatureData(transferData)
            );

            const signature = await this.walletConnector.signMessage(message);
            const signatureData = SecurityUtils.createSignatureData(transferData);

            return {
                signatureData,
                signature
            };

        } catch (error) {
            throw new Error(`Failed to sign transfer data: ${error.message}`);
        }
    }

    /**
     * Generate QR code for the deep link
     * @param {string} url - Deep link URL
     * @returns {Promise<string>} QR code data URL
     */
    async generateQRCode(url) {
        try {
            // Use a QR code library (this would be imported)
            const QRCode = (await import('qrcode')).default;

            const options = {
                errorCorrectionLevel: 'M',
                type: 'image/png',
                quality: 0.92,
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                },
                width: 300
            };

            return await QRCode.toDataURL(url, options);

        } catch (error) {
            console.warn('Failed to generate QR code:', error);
            return null;
        }
    }

    /**
     * Get list of generated links for current session
     * @returns {Array} Array of link data objects
     */
    getGeneratedLinks() {
        return Array.from(this.generatedLinks.values())
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    /**
     * Get specific link by tracking ID
     * @param {string} trackingId - Link tracking ID
     * @returns {Object|null} Link data or null if not found
     */
    getLink(trackingId) {
        return this.generatedLinks.get(trackingId) || null;
    }

    /**
     * Revoke a generated link
     * @param {string} trackingId - Link tracking ID
     * @returns {Promise<boolean>} Success status
     */
    async revokeLink(trackingId) {
        try {
            const linkData = this.generatedLinks.get(trackingId);
            if (!linkData) {
                throw new Error('Link not found');
            }

            // Update status
            linkData.status = 'revoked';
            linkData.revokedAt = new Date().toISOString();

            // Update backend
            await this.updateLinkStatus(trackingId, 'revoked');

            // Log revocation
            await this.logLinkRevocation(linkData);

            return true;

        } catch (error) {
            console.error('Failed to revoke link:', error);
            return false;
        }
    }

    /**
     * Check if a link is still valid
     * @param {string} trackingId - Link tracking ID
     * @returns {boolean} True if link is valid
     */
    isLinkValid(trackingId) {
        const linkData = this.generatedLinks.get(trackingId);
        if (!linkData) return false;

        if (linkData.status !== 'active') return false;

        const now = new Date();
        const expiry = new Date(linkData.expiresAt);

        return now < expiry;
    }

    /**
     * Store link data on backend
     * @param {Object} linkData - Link data to store
     */
    async storeLinkData(linkData) {
        try {
            const response = await fetch('/api/links', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    trackingId: linkData.trackingId,
                    source: linkData.transferData.source,
                    destination: linkData.transferData.destination,
                    amount: linkData.transferData.amount,
                    token: linkData.transferData.token,
                    memo: SecurityUtils.sanitizeMemo(linkData.transferData.memo),
                    signature: linkData.signature,
                    expiresAt: linkData.expiresAt
                })
            });

            if (!response.ok) {
                throw new Error(`Backend storage failed: ${response.statusText}`);
            }

        } catch (error) {
            console.warn('Failed to store link data on backend:', error);
            // Continue anyway as this is not critical for link generation
        }
    }

    /**
     * Update link status on backend
     * @param {string} trackingId - Link tracking ID
     * @param {string} status - New status
     */
    async updateLinkStatus(trackingId, status) {
        try {
            const response = await fetch(`/api/links/${trackingId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status })
            });

            if (!response.ok) {
                throw new Error(`Status update failed: ${response.statusText}`);
            }

        } catch (error) {
            console.warn('Failed to update link status:', error);
        }
    }

    /**
     * Log link generation for audit purposes
     * @param {Object} linkData - Link data to log
     */
    async logLinkGeneration(linkData) {
        try {
            const logData = {
                action: 'link_generated',
                trackingId: linkData.trackingId,
                sourceHash: await SecurityUtils.hashForLogging(linkData.transferData.source),
                destinationHash: await SecurityUtils.hashForLogging(linkData.transferData.destination),
                amount: linkData.transferData.amount,
                token: linkData.transferData.token,
                timestamp: linkData.createdAt,
                userAgent: navigator.userAgent,
                ip: await this.getClientIP()
            };

            console.log('Link Generated:', logData);

            // Send to audit endpoint
            fetch('/api/audit/link-generation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(logData)
            }).catch(error => {
                console.warn('Failed to send audit log:', error);
            });

        } catch (error) {
            console.warn('Failed to log link generation:', error);
        }
    }

    /**
     * Log link revocation for audit purposes
     * @param {Object} linkData - Link data to log
     */
    async logLinkRevocation(linkData) {
        try {
            const logData = {
                action: 'link_revoked',
                trackingId: linkData.trackingId,
                originalCreatedAt: linkData.createdAt,
                revokedAt: linkData.revokedAt,
                sourceHash: await SecurityUtils.hashForLogging(linkData.transferData.source),
                timestamp: new Date().toISOString()
            };

            console.log('Link Revoked:', logData);

            // Send to audit endpoint
            fetch('/api/audit/link-revocation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(logData)
            }).catch(error => {
                console.warn('Failed to send audit log:', error);
            });

        } catch (error) {
            console.warn('Failed to log link revocation:', error);
        }
    }

    /**
     * Get client IP for logging (approximation)
     * @returns {Promise<string>} Client IP address
     */
    async getClientIP() {
        try {
            const response = await fetch('/api/client-ip');
            const data = await response.json();
            return data.ip || 'unknown';
        } catch {
            return 'unknown';
        }
    }

    /**
     * Clean up expired links from cache
     */
    cleanupExpiredLinks() {
        const now = new Date();
        for (const [trackingId, linkData] of this.generatedLinks.entries()) {
            const expiry = new Date(linkData.expiresAt);
            if (now > expiry) {
                this.generatedLinks.delete(trackingId);
            }
        }
    }
}

export default DeepLinkGenerator;