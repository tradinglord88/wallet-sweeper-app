/**
 * Wallet Connector for Solana Deep Link Transfer System
 * Handles connection to various Solana wallets with security measures
 */

import { PublicKey } from '@solana/web3.js';
import SecurityUtils from './security-utils.js';

export class WalletConnector {
    constructor() {
        this.wallet = null;
        this.publicKey = null;
        this.isConnected = false;
        this.supportedWallets = [
            'phantom',
            'solflare',
            'slope',
            'sollet',
            'math',
            'ledger'
        ];
        this.connectionTimeouts = new Map();
    }

    /**
     * Initialize wallet connector and detect available wallets
     */
    async initialize() {
        try {
            await this.detectAvailableWallets();
            await this.restoreConnection();
        } catch (error) {
            console.warn('Wallet initialization failed:', error);
        }
    }

    /**
     * Detect which wallets are available in the browser
     * @returns {Array} List of available wallet names
     */
    async detectAvailableWallets() {
        const available = [];

        // Check for Phantom
        if (window.solana && window.solana.isPhantom) {
            available.push('phantom');
        }

        // Check for Solflare
        if (window.solflare && window.solflare.isSolflare) {
            available.push('solflare');
        }

        // Check for Slope
        if (window.Slope) {
            available.push('slope');
        }

        // Check for Sollet
        if (window.sollet) {
            available.push('sollet');
        }

        // Check for Math Wallet
        if (window.solana && window.solana.isMathWallet) {
            available.push('math');
        }

        this.availableWallets = available;
        console.log('Available wallets:', available);

        return available;
    }

    /**
     * Connect to a specific wallet
     * @param {string} walletName - Name of wallet to connect to
     * @returns {Promise<Object>} Connection result
     */
    async connect(walletName = 'phantom') {
        try {
            // Clear any existing timeouts
            this.clearConnectionTimeout();

            // Set connection timeout
            const timeoutId = setTimeout(() => {
                throw new Error('Wallet connection timeout');
            }, 30000); // 30 second timeout

            this.connectionTimeouts.set('connect', timeoutId);

            let walletProvider;

            switch (walletName.toLowerCase()) {
                case 'phantom':
                    walletProvider = await this.connectPhantom();
                    break;
                case 'solflare':
                    walletProvider = await this.connectSolflare();
                    break;
                case 'slope':
                    walletProvider = await this.connectSlope();
                    break;
                default:
                    throw new Error(`Unsupported wallet: ${walletName}`);
            }

            // Clear timeout on successful connection
            this.clearConnectionTimeout();

            // Store connection details
            this.wallet = walletProvider;
            this.publicKey = walletProvider.publicKey.toString();
            this.isConnected = true;

            // Store connection preference
            localStorage.setItem('preferredWallet', walletName);
            localStorage.setItem('lastConnectedWallet', this.publicKey);

            // Set up event listeners
            this.setupEventListeners(walletProvider);

            // Log successful connection
            await this.logWalletConnection(walletName);

            return {
                success: true,
                walletName,
                publicKey: this.publicKey,
                provider: walletProvider
            };

        } catch (error) {
            this.clearConnectionTimeout();
            this.isConnected = false;
            this.wallet = null;
            this.publicKey = null;

            console.error('Wallet connection failed:', error);
            throw error;
        }
    }

    /**
     * Connect to Phantom wallet
     * @returns {Promise<Object>} Phantom wallet provider
     */
    async connectPhantom() {
        if (!window.solana || !window.solana.isPhantom) {
            throw new Error('Phantom wallet not found. Please install Phantom wallet.');
        }

        const resp = await window.solana.connect();
        return window.solana;
    }

    /**
     * Connect to Solflare wallet
     * @returns {Promise<Object>} Solflare wallet provider
     */
    async connectSolflare() {
        if (!window.solflare || !window.solflare.isSolflare) {
            throw new Error('Solflare wallet not found. Please install Solflare wallet.');
        }

        await window.solflare.connect();
        return window.solflare;
    }

    /**
     * Connect to Slope wallet
     * @returns {Promise<Object>} Slope wallet provider
     */
    async connectSlope() {
        if (!window.Slope) {
            throw new Error('Slope wallet not found. Please install Slope wallet.');
        }

        const resp = await new window.Slope().connect();
        return {
            publicKey: new PublicKey(resp.data.publicKey),
            signMessage: (message) => window.Slope.signMessage(message),
            signTransaction: (transaction) => window.Slope.signTransaction(transaction)
        };
    }

    /**
     * Disconnect from current wallet
     */
    async disconnect() {
        try {
            if (this.wallet && this.wallet.disconnect) {
                await this.wallet.disconnect();
            }

            this.wallet = null;
            this.publicKey = null;
            this.isConnected = false;

            // Clear stored connection
            localStorage.removeItem('lastConnectedWallet');

            // Log disconnection
            await this.logWalletDisconnection();

            console.log('Wallet disconnected');

        } catch (error) {
            console.error('Failed to disconnect wallet:', error);
        }
    }

    /**
     * Attempt to restore previous wallet connection
     */
    async restoreConnection() {
        try {
            const preferredWallet = localStorage.getItem('preferredWallet');
            const lastConnectedWallet = localStorage.getItem('lastConnectedWallet');

            if (preferredWallet && lastConnectedWallet) {
                console.log('Attempting to restore wallet connection...');
                await this.connect(preferredWallet);
            }

        } catch (error) {
            console.log('Could not restore wallet connection:', error.message);
            // Clear invalid stored connection
            localStorage.removeItem('lastConnectedWallet');
            localStorage.removeItem('preferredWallet');
        }
    }

    /**
     * Sign a message with the connected wallet
     * @param {Uint8Array} message - Message to sign
     * @returns {Promise<string>} Base58 encoded signature
     */
    async signMessage(message) {
        if (!this.isConnected || !this.wallet) {
            throw new Error('Wallet not connected');
        }

        try {
            let signature;

            if (this.wallet.signMessage) {
                // Standard wallet adapter method
                const signedMessage = await this.wallet.signMessage(message);
                signature = signedMessage.signature;
            } else if (this.wallet.sign) {
                // Alternative signing method
                signature = await this.wallet.sign(message);
            } else {
                throw new Error('Wallet does not support message signing');
            }

            // Convert to base58 if needed
            if (signature instanceof Uint8Array) {
                const bs58 = (await import('bs58')).default;
                return bs58.encode(signature);
            }

            return signature;

        } catch (error) {
            console.error('Message signing failed:', error);
            throw new Error(`Failed to sign message: ${error.message}`);
        }
    }

    /**
     * Get wallet information
     * @returns {Object} Wallet info
     */
    async getWalletInfo() {
        if (!this.isConnected) {
            throw new Error('Wallet not connected');
        }

        try {
            return {
                publicKey: this.publicKey,
                isConnected: this.isConnected,
                walletName: localStorage.getItem('preferredWallet'),
                balance: await this.getBalance()
            };

        } catch (error) {
            console.error('Failed to get wallet info:', error);
            throw error;
        }
    }

    /**
     * Get wallet balance (requires RPC connection)
     * @returns {Promise<number>} Balance in SOL
     */
    async getBalance() {
        try {
            // This would typically use a Solana connection
            // For now, return a placeholder
            return 0;

        } catch (error) {
            console.error('Failed to get balance:', error);
            return 0;
        }
    }

    /**
     * Set up event listeners for wallet events
     * @param {Object} walletProvider - Wallet provider
     */
    setupEventListeners(walletProvider) {
        try {
            // Listen for account changes
            if (walletProvider.on) {
                walletProvider.on('accountChanged', (publicKey) => {
                    if (publicKey) {
                        this.publicKey = publicKey.toString();
                        console.log('Account changed:', this.publicKey);
                    } else {
                        this.disconnect();
                    }
                });

                walletProvider.on('disconnect', () => {
                    console.log('Wallet disconnected by user');
                    this.disconnect();
                });
            }

        } catch (error) {
            console.warn('Failed to set up wallet event listeners:', error);
        }
    }

    /**
     * Check if wallet is currently connected
     * @returns {boolean} Connection status
     */
    isConnected() {
        return this.isConnected && this.wallet && this.publicKey;
    }

    /**
     * Get list of available wallets
     * @returns {Array} Available wallet names
     */
    getAvailableWallets() {
        return this.availableWallets || [];
    }

    /**
     * Clear connection timeout
     */
    clearConnectionTimeout() {
        const timeoutId = this.connectionTimeouts.get('connect');
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.connectionTimeouts.delete('connect');
        }
    }

    /**
     * Log wallet connection for audit purposes
     * @param {string} walletName - Name of connected wallet
     */
    async logWalletConnection(walletName) {
        try {
            const logData = {
                action: 'wallet_connected',
                walletName,
                publicKeyHash: await SecurityUtils.hashForLogging(this.publicKey),
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent
            };

            console.log('Wallet Connected:', logData);

            // Send to audit endpoint
            fetch('/api/audit/wallet-connection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(logData)
            }).catch(error => {
                console.warn('Failed to send wallet connection audit log:', error);
            });

        } catch (error) {
            console.warn('Failed to log wallet connection:', error);
        }
    }

    /**
     * Log wallet disconnection for audit purposes
     */
    async logWalletDisconnection() {
        try {
            const logData = {
                action: 'wallet_disconnected',
                timestamp: new Date().toISOString(),
                publicKeyHash: this.publicKey ? await SecurityUtils.hashForLogging(this.publicKey) : null
            };

            console.log('Wallet Disconnected:', logData);

            // Send to audit endpoint
            fetch('/api/audit/wallet-disconnection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(logData)
            }).catch(error => {
                console.warn('Failed to send wallet disconnection audit log:', error);
            });

        } catch (error) {
            console.warn('Failed to log wallet disconnection:', error);
        }
    }

    /**
     * Validate wallet state and reconnect if needed
     */
    async validateAndReconnect() {
        try {
            if (!this.isConnected || !this.wallet) {
                return false;
            }

            // Check if wallet is still responsive
            if (this.wallet.publicKey) {
                return true;
            }

            // Attempt reconnection
            const preferredWallet = localStorage.getItem('preferredWallet');
            if (preferredWallet) {
                await this.connect(preferredWallet);
                return this.isConnected;
            }

            return false;

        } catch (error) {
            console.error('Wallet validation failed:', error);
            await this.disconnect();
            return false;
        }
    }
}

export default WalletConnector;