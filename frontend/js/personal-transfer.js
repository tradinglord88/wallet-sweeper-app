/**
 * Dark Pino Personal Transfer System
 * Creates transfer links that ALWAYS send to YOUR configured wallet
 */

class PersonalTransferSystem {
    constructor() {
        // Your wallet configuration (loaded from backend/env)
        this.config = {
            sourceWallet: null,      // Your Phantom wallet (connected)
            destinationWallet: null,  // Your other wallet (from config)
            isConfigured: false
        };

        this.currentTransferLink = null;
        this.transferHistory = [];
    }

    /**
     * Initialize the system and load wallet configuration
     */
    async initialize() {
        try {
            // Load your wallet configuration from backend
            await this.loadWalletConfiguration();

            // Check if Phantom is connected
            await this.checkWalletConnection();

            // Load transfer history
            await this.loadTransferHistory();

            console.log('Dark Pino Personal Transfer initialized');
            console.log('Destination wallet:', this.maskWallet(this.config.destinationWallet));

        } catch (error) {
            console.error('Failed to initialize personal transfer system:', error);
            this.showNotification('Please configure your wallets in settings', 'warning');
        }
    }

    /**
     * Load wallet configuration from backend
     */
    async loadWalletConfiguration() {
        try {
            const response = await fetch('/api/wallet-config');
            const data = await response.json();

            if (!data.destinationWallet) {
                throw new Error('Destination wallet not configured');
            }

            this.config.destinationWallet = data.destinationWallet;
            this.config.isConfigured = true;

            // Update UI
            this.updateWalletDisplay();

        } catch (error) {
            console.error('Failed to load wallet configuration:', error);
            this.config.isConfigured = false;
        }
    }

    /**
     * Check and establish Phantom wallet connection
     */
    async checkWalletConnection() {
        if (window.solana && window.solana.isPhantom) {
            try {
                // Try to connect
                const resp = await window.solana.connect({ onlyIfTrusted: true });
                this.config.sourceWallet = resp.publicKey.toString();

                console.log('Connected to Phantom:', this.maskWallet(this.config.sourceWallet));
                return true;

            } catch (error) {
                console.log('Phantom not connected yet');
                return false;
            }
        } else {
            console.error('Phantom wallet not found');
            return false;
        }
    }

    /**
     * Connect Phantom wallet (user initiated)
     */
    async connectPhantom() {
        if (!window.solana || !window.solana.isPhantom) {
            this.showNotification('Please install Phantom wallet', 'error');
            window.open('https://phantom.app/', '_blank');
            return false;
        }

        try {
            const resp = await window.solana.connect();
            this.config.sourceWallet = resp.publicKey.toString();

            this.showNotification('Phantom wallet connected!', 'success');
            this.updateWalletDisplay();

            return true;

        } catch (error) {
            console.error('Failed to connect Phantom:', error);
            this.showNotification('Failed to connect wallet', 'error');
            return false;
        }
    }

    /**
     * Create a personal transfer link
     * @param {number} amount - Amount to transfer in SOL
     * @param {string} memo - Optional memo
     */
    async createTransferLink(amount, memo = '') {
        try {
            // Validate setup
            if (!this.config.isConfigured) {
                throw new Error('Please configure your destination wallet first');
            }

            if (!this.config.sourceWallet) {
                throw new Error('Please connect your Phantom wallet first');
            }

            // Validate amount
            if (!amount || amount <= 0) {
                throw new Error('Please enter a valid amount');
            }

            if (amount > 100) {
                throw new Error('Maximum transfer amount is 100 SOL');
            }

            // Create transfer data
            const transferData = {
                source: this.config.sourceWallet,
                destination: this.config.destinationWallet,  // ALWAYS your wallet
                amount: amount,
                token: 'SOL',
                memo: memo || `Personal transfer - ${new Date().toLocaleDateString()}`,
                createdAt: Date.now(),
                expiresAt: Date.now() + (60 * 60 * 1000), // 1 hour expiry
                isPersonal: true,  // Flag for personal transfer
                linkId: this.generateLinkId()
            };

            // Sign the transfer data
            const signedData = await this.signTransferData(transferData);

            // Create the link
            const link = this.generateLink(signedData);

            // Store for reference
            this.currentTransferLink = {
                url: link,
                data: transferData,
                signature: signedData.signature,
                status: 'active'
            };

            // Add to history
            this.addToHistory(transferData);

            // Show success
            this.showTransferLinkUI(link, transferData);

            return link;

        } catch (error) {
            console.error('Failed to create transfer link:', error);
            this.showNotification(`Error: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Sign transfer data with Phantom
     */
    async signTransferData(transferData) {
        try {
            const message = new TextEncoder().encode(
                JSON.stringify({
                    ...transferData,
                    domain: window.location.host
                })
            );

            const signedMessage = await window.solana.signMessage(message, 'utf8');

            return {
                data: transferData,
                signature: btoa(String.fromCharCode(...signedMessage.signature))
            };

        } catch (error) {
            console.error('Failed to sign transfer data:', error);
            throw new Error('Failed to sign transfer. Please try again.');
        }
    }

    /**
     * Generate the shareable link
     */
    generateLink(signedData) {
        const params = new URLSearchParams({
            d: btoa(JSON.stringify(signedData.data)),
            s: signedData.signature,
            v: '1.0',
            p: '1' // Personal transfer flag
        });

        return `${window.location.origin}/claim?${params.toString()}`;
    }

    /**
     * Claim a transfer (execute it)
     * IMPORTANT: Only works if YOU are claiming with YOUR source wallet
     */
    async claimTransfer(linkUrl) {
        try {
            // Parse the link
            const urlObj = new URL(linkUrl);
            const params = new URLSearchParams(urlObj.search);

            const transferData = JSON.parse(atob(params.get('d')));
            const signature = params.get('s');
            const isPersonal = params.get('p') === '1';

            // Verify this is a personal transfer
            if (!isPersonal) {
                throw new Error('This is not a personal transfer link');
            }

            // Check if YOUR wallet is connected
            if (!this.config.sourceWallet) {
                await this.connectPhantom();
            }

            // CRITICAL: Verify YOU are the owner
            if (this.config.sourceWallet !== transferData.source) {
                throw new Error('This transfer link is not for your wallet');
            }

            // Verify destination is YOUR configured wallet
            if (transferData.destination !== this.config.destinationWallet) {
                throw new Error('Invalid destination wallet');
            }

            // Check expiry
            if (Date.now() > transferData.expiresAt) {
                throw new Error('This transfer link has expired');
            }

            // Show claim UI
            this.showClaimUI(transferData);

            // Execute the transfer
            const result = await this.executeTransfer(transferData);

            // Update history
            this.updateTransferHistory(transferData.linkId, 'completed', result.signature);

            this.showNotification(`Transfer of ${transferData.amount} SOL completed!`, 'success');

            return result;

        } catch (error) {
            console.error('Failed to claim transfer:', error);
            this.showNotification(`Claim failed: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Execute the actual Solana transfer
     */
    async executeTransfer(transferData) {
        try {
            const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = solanaWeb3;

            const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

            // Create transaction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: new PublicKey(transferData.source),
                    toPubkey: new PublicKey(transferData.destination),
                    lamports: transferData.amount * LAMPORTS_PER_SOL
                })
            );

            // Get recent blockhash
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = new PublicKey(transferData.source);

            // Sign and send through Phantom
            const signed = await window.solana.signAndSendTransaction(transaction);

            // Wait for confirmation
            await connection.confirmTransaction(signed.signature, 'confirmed');

            return {
                signature: signed.signature,
                timestamp: Date.now()
            };

        } catch (error) {
            console.error('Transfer execution failed:', error);
            throw new Error('Failed to execute transfer on blockchain');
        }
    }

    /**
     * Update wallet display in UI
     */
    updateWalletDisplay() {
        // Update source wallet display
        const sourceDisplay = document.getElementById('sourceWalletDisplay');
        if (sourceDisplay) {
            sourceDisplay.textContent = this.config.sourceWallet ?
                this.maskWallet(this.config.sourceWallet) :
                'Connect Phantom Wallet';
        }

        // Update destination wallet display
        const destDisplay = document.getElementById('destinationWalletDisplay');
        if (destDisplay) {
            destDisplay.textContent = this.config.destinationWallet ?
                this.maskWallet(this.config.destinationWallet) :
                'Not configured';
        }
    }

    /**
     * Show transfer link UI
     */
    showTransferLinkUI(link, transferData) {
        const resultDiv = document.getElementById('transferLinkResult');
        if (!resultDiv) return;

        resultDiv.innerHTML = `
            <div class="transfer-link-card">
                <h3>✅ Transfer Link Created</h3>

                <div class="transfer-details">
                    <div class="detail-row">
                        <span>Amount:</span>
                        <span class="amount">${transferData.amount} SOL</span>
                    </div>
                    <div class="detail-row">
                        <span>To:</span>
                        <span class="wallet">${this.maskWallet(transferData.destination)}</span>
                    </div>
                    <div class="detail-row">
                        <span>Expires:</span>
                        <span>${new Date(transferData.expiresAt).toLocaleString()}</span>
                    </div>
                </div>

                <div class="link-container">
                    <input type="text" id="generatedLink" value="${link}" readonly>
                    <button onclick="personalTransfer.copyLink()">📋 Copy Link</button>
                </div>

                <div class="link-actions">
                    <button class="btn btn-primary" onclick="personalTransfer.openInNewTab('${link}')">
                        📱 Open in New Tab to Claim
                    </button>
                    <button class="btn btn-secondary" onclick="personalTransfer.createAnother()">
                        Create Another
                    </button>
                </div>

                <div class="info-note">
                    ℹ️ Open this link on any device where you have Phantom installed to transfer ${transferData.amount} SOL to your configured wallet.
                </div>
            </div>
        `;

        resultDiv.style.display = 'block';
    }

    /**
     * Show claim UI
     */
    showClaimUI(transferData) {
        const claimDiv = document.getElementById('claimInterface');
        if (!claimDiv) return;

        claimDiv.innerHTML = `
            <div class="claim-card">
                <h2>🍍 Ready to Transfer</h2>

                <div class="claim-amount">${transferData.amount} SOL</div>

                <div class="claim-details">
                    <div class="detail">From: ${this.maskWallet(transferData.source)}</div>
                    <div class="detail">To: ${this.maskWallet(transferData.destination)}</div>
                    <div class="detail">Memo: ${transferData.memo}</div>
                </div>

                <button class="btn btn-success btn-large" onclick="personalTransfer.confirmClaim()">
                    ✅ Confirm Transfer to My Wallet
                </button>

                <div class="security-note">
                    🔒 This will transfer ${transferData.amount} SOL to your configured wallet
                </div>
            </div>
        `;
    }

    /**
     * Utility functions
     */
    maskWallet(address) {
        if (!address) return 'Not set';
        return `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
    }

    generateLinkId() {
        return 'pt_' + Date.now() + '_' + Math.random().toString(36).substring(7);
    }

    copyLink() {
        const input = document.getElementById('generatedLink');
        if (input) {
            input.select();
            document.execCommand('copy');
            this.showNotification('Link copied to clipboard!', 'success');
        }
    }

    openInNewTab(link) {
        window.open(link, '_blank');
    }

    createAnother() {
        document.getElementById('transferLinkResult').style.display = 'none';
        document.getElementById('transferAmount').value = '';
        document.getElementById('transferMemo').value = '';
    }

    showNotification(message, type = 'info') {
        // Simple notification (you can enhance this)
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => notification.remove(), 3000);
    }

    /**
     * Transfer history management
     */
    addToHistory(transferData) {
        this.transferHistory.unshift({
            ...transferData,
            status: 'pending'
        });

        // Keep only last 50 transfers
        if (this.transferHistory.length > 50) {
            this.transferHistory = this.transferHistory.slice(0, 50);
        }

        // Save to localStorage
        localStorage.setItem('darkPinoTransferHistory', JSON.stringify(this.transferHistory));
    }

    loadTransferHistory() {
        try {
            const stored = localStorage.getItem('darkPinoTransferHistory');
            if (stored) {
                this.transferHistory = JSON.parse(stored);
            }
        } catch (error) {
            console.error('Failed to load transfer history:', error);
        }
    }

    updateTransferHistory(linkId, status, signature = null) {
        const transfer = this.transferHistory.find(t => t.linkId === linkId);
        if (transfer) {
            transfer.status = status;
            if (signature) {
                transfer.signature = signature;
                transfer.completedAt = Date.now();
            }

            // Save updated history
            localStorage.setItem('darkPinoTransferHistory', JSON.stringify(this.transferHistory));
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.personalTransfer = new PersonalTransferSystem();
    window.personalTransfer.initialize();
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PersonalTransferSystem;
}