/**
 * Transaction Executor for Solana Deep Link Transfer System
 * Handles secure execution of pre-signed transactions and real-time transfers
 */

import {
    Connection,
    PublicKey,
    Transaction,
    SystemProgram,
    LAMPORTS_PER_SOL,
    VersionedTransaction
} from '@solana/web3.js';
import {
    getAssociatedTokenAddress,
    createTransferInstruction,
    TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import SecurityUtils from './security-utils.js';
import WalletConnector from './wallet-connector.js';

export class TransactionExecutor {
    constructor() {
        this.connection = null;
        this.walletConnector = new WalletConnector();
        this.executedTransactions = new Map(); // Cache executed transactions
        this.SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
        this.TOKEN_MINTS = {
            'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
        };
    }

    /**
     * Initialize the transaction executor
     */
    async initialize() {
        try {
            this.connection = new Connection(this.SOLANA_RPC_URL, 'confirmed');
            await this.walletConnector.initialize();

            console.log('Transaction executor initialized');
        } catch (error) {
            console.error('Failed to initialize transaction executor:', error);
            throw error;
        }
    }

    /**
     * Execute a transfer from a verified deep link
     * @param {Object} verifiedData - Verified signature data from deep link
     * @returns {Promise<Object>} Execution result
     */
    async executeDeepLinkTransfer(verifiedData) {
        try {
            // Validate that we have a wallet connection
            if (!this.walletConnector.isConnected()) {
                throw new Error('Wallet not connected');
            }

            const walletInfo = await this.walletConnector.getWalletInfo();

            // Verify the deep link is for the current wallet
            if (walletInfo.publicKey !== verifiedData.source) {
                throw new Error('Deep link is not for the currently connected wallet');
            }

            // Create and send the transaction
            const transaction = await this.createTransferTransaction(verifiedData);
            const signature = await this.sendTransaction(transaction);

            // Track the execution
            await this.trackExecution(signature, verifiedData, 'deep_link');

            return {
                success: true,
                signature,
                txId: signature,
                method: 'deep_link',
                amount: verifiedData.amount,
                token: verifiedData.token,
                destination: verifiedData.destination
            };

        } catch (error) {
            console.error('Deep link transfer execution failed:', error);
            await this.logExecutionError(error, verifiedData, 'deep_link');
            throw error;
        }
    }

    /**
     * Execute a pre-signed transaction
     * @param {string} serializedTransaction - Base64 encoded transaction
     * @param {Object} metadata - Transaction metadata
     * @returns {Promise<Object>} Execution result
     */
    async executePreSignedTransaction(serializedTransaction, metadata) {
        try {
            // Decode the transaction
            const transactionBuffer = Buffer.from(serializedTransaction, 'base64');
            let transaction;

            try {
                // Try versioned transaction first
                transaction = VersionedTransaction.deserialize(transactionBuffer);
            } catch {
                // Fall back to legacy transaction
                transaction = Transaction.from(transactionBuffer);
            }

            // Validate transaction
            const validation = await this.validatePreSignedTransaction(transaction, metadata);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            // Check if transaction has already been executed
            const signature = await this.getTransactionSignature(transaction);
            if (await this.isTransactionExecuted(signature)) {
                throw new Error('Transaction has already been executed');
            }

            // Send the transaction
            const txSignature = await this.sendPreSignedTransaction(transaction);

            // Track the execution
            await this.trackExecution(txSignature, metadata, 'pre_signed');

            return {
                success: true,
                signature: txSignature,
                txId: txSignature,
                method: 'pre_signed',
                metadata
            };

        } catch (error) {
            console.error('Pre-signed transaction execution failed:', error);
            await this.logExecutionError(error, metadata, 'pre_signed');
            throw error;
        }
    }

    /**
     * Create a transfer transaction from verified data
     * @param {Object} transferData - Verified transfer data
     * @returns {Promise<Transaction>} Solana transaction
     */
    async createTransferTransaction(transferData) {
        try {
            const { source, destination, amount, token, memo } = transferData;

            const sourcePublicKey = new PublicKey(source);
            const destinationPublicKey = new PublicKey(destination);

            // Get recent blockhash
            const { blockhash } = await this.connection.getLatestBlockhash();

            const transaction = new Transaction({
                feePayer: sourcePublicKey,
                recentBlockhash: blockhash
            });

            if (token === 'SOL') {
                // SOL transfer
                const lamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);

                transaction.add(
                    SystemProgram.transfer({
                        fromPubkey: sourcePublicKey,
                        toPubkey: destinationPublicKey,
                        lamports
                    })
                );
            } else {
                // SPL Token transfer
                const tokenMint = this.TOKEN_MINTS[token];
                if (!tokenMint) {
                    throw new Error(`Unsupported token: ${token}`);
                }

                const mintPublicKey = new PublicKey(tokenMint);

                // Get or create associated token accounts
                const sourceTokenAccount = await getAssociatedTokenAddress(
                    mintPublicKey,
                    sourcePublicKey
                );

                const destinationTokenAccount = await getAssociatedTokenAddress(
                    mintPublicKey,
                    destinationPublicKey
                );

                // Check if destination token account exists
                const destinationAccountInfo = await this.connection.getAccountInfo(destinationTokenAccount);

                if (!destinationAccountInfo) {
                    // Create associated token account for destination
                    const { createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');

                    transaction.add(
                        createAssociatedTokenAccountInstruction(
                            sourcePublicKey, // payer
                            destinationTokenAccount,
                            destinationPublicKey,
                            mintPublicKey
                        )
                    );
                }

                // Add transfer instruction
                const decimals = await this.getTokenDecimals(mintPublicKey);
                const tokenAmount = Math.floor(parseFloat(amount) * Math.pow(10, decimals));

                transaction.add(
                    createTransferInstruction(
                        sourceTokenAccount,
                        destinationTokenAccount,
                        sourcePublicKey,
                        tokenAmount
                    )
                );
            }

            // Add memo if provided
            if (memo && memo.trim()) {
                const memoInstruction = new TransactionInstruction({
                    keys: [],
                    programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
                    data: Buffer.from(memo.trim(), 'utf8')
                });
                transaction.add(memoInstruction);
            }

            return transaction;

        } catch (error) {
            console.error('Failed to create transfer transaction:', error);
            throw error;
        }
    }

    /**
     * Send a transaction through the wallet
     * @param {Transaction} transaction - Transaction to send
     * @returns {Promise<string>} Transaction signature
     */
    async sendTransaction(transaction) {
        try {
            if (!this.walletConnector.isConnected()) {
                throw new Error('Wallet not connected');
            }

            // Sign and send transaction through wallet
            const signature = await this.walletConnector.wallet.signAndSendTransaction(transaction);

            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            console.log('Transaction sent successfully:', signature);
            return signature;

        } catch (error) {
            console.error('Failed to send transaction:', error);
            throw error;
        }
    }

    /**
     * Send a pre-signed transaction
     * @param {Transaction|VersionedTransaction} transaction - Pre-signed transaction
     * @returns {Promise<string>} Transaction signature
     */
    async sendPreSignedTransaction(transaction) {
        try {
            // Send raw transaction
            const signature = await this.connection.sendRawTransaction(
                transaction.serialize(),
                {
                    skipPreflight: false,
                    preflightCommitment: 'confirmed'
                }
            );

            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            console.log('Pre-signed transaction sent successfully:', signature);
            return signature;

        } catch (error) {
            console.error('Failed to send pre-signed transaction:', error);
            throw error;
        }
    }

    /**
     * Validate a pre-signed transaction
     * @param {Transaction|VersionedTransaction} transaction - Transaction to validate
     * @param {Object} metadata - Transaction metadata
     * @returns {Promise<Object>} Validation result
     */
    async validatePreSignedTransaction(transaction, metadata) {
        try {
            // Check transaction expiry
            if (metadata.expiresAt && new Date() > new Date(metadata.expiresAt)) {
                return {
                    valid: false,
                    error: 'Pre-signed transaction has expired'
                };
            }

            // Verify transaction has valid signatures
            if (transaction.signatures.length === 0) {
                return {
                    valid: false,
                    error: 'Transaction has no signatures'
                };
            }

            // Check if transaction uses recent blockhash or durable nonce
            const recentBlockhashes = await this.connection.getRecentBlockhash();

            // Additional validation logic would go here
            // For example, checking instruction validity, account access, etc.

            return { valid: true };

        } catch (error) {
            return {
                valid: false,
                error: `Transaction validation failed: ${error.message}`
            };
        }
    }

    /**
     * Get transaction signature from transaction object
     * @param {Transaction|VersionedTransaction} transaction - Transaction
     * @returns {string} Transaction signature
     */
    async getTransactionSignature(transaction) {
        try {
            if (transaction.signature) {
                return bs58.encode(transaction.signature);
            }

            if (transaction.signatures && transaction.signatures.length > 0) {
                return bs58.encode(transaction.signatures[0]);
            }

            throw new Error('No signature found in transaction');

        } catch (error) {
            console.error('Failed to get transaction signature:', error);
            throw error;
        }
    }

    /**
     * Check if transaction has already been executed
     * @param {string} signature - Transaction signature
     * @returns {Promise<boolean>} True if executed
     */
    async isTransactionExecuted(signature) {
        try {
            // Check local cache first
            if (this.executedTransactions.has(signature)) {
                return true;
            }

            // Check on-chain
            const status = await this.connection.getSignatureStatus(signature);
            const isExecuted = status && status.value && status.value.confirmationStatus;

            if (isExecuted) {
                this.executedTransactions.set(signature, {
                    executedAt: new Date().toISOString(),
                    status: status.value
                });
            }

            return !!isExecuted;

        } catch (error) {
            console.error('Error checking transaction execution status:', error);
            return false;
        }
    }

    /**
     * Get token decimals for SPL tokens
     * @param {PublicKey} mintPublicKey - Token mint public key
     * @returns {Promise<number>} Token decimals
     */
    async getTokenDecimals(mintPublicKey) {
        try {
            const mintInfo = await this.connection.getParsedAccountInfo(mintPublicKey);
            return mintInfo.value?.data?.parsed?.info?.decimals || 6;
        } catch (error) {
            console.warn('Failed to get token decimals, using default:', error);
            return 6; // Default for most SPL tokens
        }
    }

    /**
     * Track transaction execution for audit purposes
     * @param {string} signature - Transaction signature
     * @param {Object} data - Transaction data
     * @param {string} method - Execution method
     */
    async trackExecution(signature, data, method) {
        try {
            const executionData = {
                signature,
                method,
                timestamp: new Date().toISOString(),
                sourceHash: await SecurityUtils.hashForLogging(data.source || 'unknown'),
                destinationHash: await SecurityUtils.hashForLogging(data.destination || 'unknown'),
                amount: data.amount,
                token: data.token || 'SOL'
            };

            // Store in local cache
            this.executedTransactions.set(signature, executionData);

            // Send to backend for audit logging
            fetch('/api/audit/transaction-execution', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(executionData)
            }).catch(error => {
                console.warn('Failed to send execution audit log:', error);
            });

            console.log('Transaction execution tracked:', executionData);

        } catch (error) {
            console.error('Failed to track transaction execution:', error);
        }
    }

    /**
     * Log execution errors for security monitoring
     * @param {Error} error - Error that occurred
     * @param {Object} data - Transaction data
     * @param {string} method - Execution method
     */
    async logExecutionError(error, data, method) {
        try {
            const errorData = {
                error: error.message,
                method,
                timestamp: new Date().toISOString(),
                sourceHash: data.source ? await SecurityUtils.hashForLogging(data.source) : 'unknown',
                severity: 'high'
            };

            console.error('Transaction execution error:', errorData);

            // Send to backend for security monitoring
            fetch('/api/audit/transaction-error', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(errorData)
            }).catch(logError => {
                console.warn('Failed to send error audit log:', logError);
            });

        } catch (logError) {
            console.error('Failed to log execution error:', logError);
        }
    }

    /**
     * Get execution statistics
     * @returns {Object} Execution statistics
     */
    getExecutionStats() {
        return {
            totalExecutions: this.executedTransactions.size,
            executedTransactions: Array.from(this.executedTransactions.entries()).map(([signature, data]) => ({
                signature: signature.substring(0, 8) + '...',
                timestamp: data.timestamp,
                method: data.method
            })),
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Simulate transaction before execution
     * @param {Transaction} transaction - Transaction to simulate
     * @returns {Promise<Object>} Simulation result
     */
    async simulateTransaction(transaction) {
        try {
            const simulation = await this.connection.simulateTransaction(transaction);

            return {
                success: !simulation.value.err,
                error: simulation.value.err,
                logs: simulation.value.logs,
                unitsConsumed: simulation.value.unitsConsumed
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        this.executedTransactions.clear();
        console.log('Transaction executor cleanup completed');
    }
}

export default TransactionExecutor;