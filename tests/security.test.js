/**
 * Comprehensive Security Test Suite for Solana Deep Link Transfer System
 * Tests all security measures including signature verification, replay protection, and rate limiting
 */

const request = require('supertest');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

const SecureSolanaServer = require('../backend/server');
const SecurityUtils = require('../frontend/js/security-utils');
const SignatureService = require('../backend/services/signature-service');
const NonceManager = require('../backend/services/nonce-manager');

describe('Security Test Suite', () => {
    let app;
    let server;
    let signatureService;
    let nonceManager;

    // Test keypairs
    let testKeypair;
    let maliciousKeypair;

    beforeAll(async () => {
        // Initialize test server
        const solanaServer = new SecureSolanaServer();
        app = solanaServer.getApp();

        // Initialize services
        signatureService = new SignatureService();
        nonceManager = new NonceManager();

        // Generate test keypairs
        testKeypair = nacl.sign.keyPair();
        maliciousKeypair = nacl.sign.keyPair();

        console.log('Security test suite initialized');
    });

    afterAll(async () => {
        // Cleanup
        await signatureService?.cleanup();
        await nonceManager?.cleanup();
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
    });

    describe('Signature Verification Security', () => {
        test('should reject invalid signature format', async () => {
            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData: createValidSignatureData(),
                    signature: 'invalid_signature',
                    publicKey: bs58.encode(testKeypair.publicKey)
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Validation failed');
        });

        test('should reject mismatched public key and source address', async () => {
            const signatureData = createValidSignatureData();
            signatureData.source = bs58.encode(testKeypair.publicKey);

            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData,
                    signature: 'a'.repeat(88), // Valid length but wrong signature
                    publicKey: bs58.encode(maliciousKeypair.publicKey) // Different key
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Public key does not match source address');
        });

        test('should reject expired signatures', async () => {
            const expiredSignatureData = createValidSignatureData();
            expiredSignatureData.timestamp = Date.now() - (20 * 60 * 1000); // 20 minutes ago
            expiredSignatureData.expiry = Date.now() - (5 * 60 * 1000);    // 5 minutes ago

            const message = createMessageToSign(expiredSignatureData);
            const signature = nacl.sign.detached(message, testKeypair.secretKey);

            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData: expiredSignatureData,
                    signature: bs58.encode(signature),
                    publicKey: bs58.encode(testKeypair.publicKey)
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('expired');
        });

        test('should reject signatures with future timestamps', async () => {
            const futureSignatureData = createValidSignatureData();
            futureSignatureData.timestamp = Date.now() + (10 * 60 * 1000); // 10 minutes in future
            futureSignatureData.expiry = Date.now() + (25 * 60 * 1000);

            const message = createMessageToSign(futureSignatureData);
            const signature = nacl.sign.detached(message, testKeypair.secretKey);

            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData: futureSignatureData,
                    signature: bs58.encode(signature),
                    publicKey: bs58.encode(testKeypair.publicKey)
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });

        test('should accept valid signature', async () => {
            const signatureData = createValidSignatureData();
            signatureData.source = bs58.encode(testKeypair.publicKey);

            const message = createMessageToSign(signatureData);
            const signature = nacl.sign.detached(message, testKeypair.secretKey);

            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData,
                    signature: bs58.encode(signature),
                    publicKey: bs58.encode(testKeypair.publicKey)
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.verified).toBe(true);
        });
    });

    describe('Replay Attack Protection', () => {
        test('should prevent nonce reuse', async () => {
            const nonce = generateTestNonce();
            const signatureData = createValidSignatureData();
            signatureData.nonce = nonce;
            signatureData.source = bs58.encode(testKeypair.publicKey);

            const message = createMessageToSign(signatureData);
            const signature = bs58.encode(nacl.sign.detached(message, testKeypair.secretKey));

            const requestData = {
                signatureData,
                signature,
                publicKey: bs58.encode(testKeypair.publicKey)
            };

            // First request should succeed
            const firstResponse = await request(app)
                .post('/api/verification/verify-signature')
                .send(requestData);

            expect(firstResponse.status).toBe(200);
            expect(firstResponse.body.success).toBe(true);

            // Second request with same nonce should fail
            const secondResponse = await request(app)
                .post('/api/verification/verify-signature')
                .send(requestData);

            expect(secondResponse.status).toBe(400);
            expect(secondResponse.body.success).toBe(false);
            expect(secondResponse.body.error).toContain('already been used');
        });

        test('should validate nonce format', async () => {
            const signatureData = createValidSignatureData();
            signatureData.nonce = 'invalid_nonce_format';

            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData,
                    signature: 'a'.repeat(88),
                    publicKey: bs58.encode(testKeypair.publicKey)
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Validation failed');
        });

        test('should track nonce usage', async () => {
            const nonce = generateTestNonce();

            // Check nonce doesn't exist initially
            let response = await request(app)
                .get(`/api/verification/nonce/${nonce}`);

            expect(response.status).toBe(200);
            expect(response.body.exists).toBe(false);

            // Use the nonce
            const signatureData = createValidSignatureData();
            signatureData.nonce = nonce;
            signatureData.source = bs58.encode(testKeypair.publicKey);

            const message = createMessageToSign(signatureData);
            const signature = bs58.encode(nacl.sign.detached(message, testKeypair.secretKey));

            await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData,
                    signature,
                    publicKey: bs58.encode(testKeypair.publicKey)
                });

            // Check nonce now exists
            response = await request(app)
                .get(`/api/verification/nonce/${nonce}`);

            expect(response.status).toBe(200);
            expect(response.body.exists).toBe(true);
            expect(response.body.info).toBeDefined();
        });
    });

    describe('Rate Limiting Security', () => {
        test('should enforce general rate limits', async () => {
            const requests = [];

            // Make many requests quickly
            for (let i = 0; i < 150; i++) {
                requests.push(
                    request(app)
                        .get('/api/verification/stats')
                        .expect((res) => {
                            // Some requests should succeed, others should be rate limited
                            expect([200, 429]).toContain(res.status);
                        })
                );
            }

            await Promise.all(requests);

            // At least some should be rate limited
            const responses = await Promise.all(requests);
            const rateLimited = responses.filter(r => r.status === 429);
            expect(rateLimited.length).toBeGreaterThan(0);
        }, 30000);

        test('should enforce strict rate limits on sensitive endpoints', async () => {
            const requests = [];

            // Make many verification requests quickly
            for (let i = 0; i < 20; i++) {
                const signatureData = createValidSignatureData();
                signatureData.nonce = generateTestNonce(); // Unique nonce each time

                requests.push(
                    request(app)
                        .post('/api/verification/verify-signature')
                        .send({
                            signatureData,
                            signature: 'invalid_signature',
                            publicKey: bs58.encode(testKeypair.publicKey)
                        })
                );
            }

            const responses = await Promise.all(requests);
            const rateLimited = responses.filter(r => r.status === 429);

            // Should have strict rate limiting
            expect(rateLimited.length).toBeGreaterThan(0);
        }, 15000);
    });

    describe('Input Validation Security', () => {
        test('should reject malformed JSON', async () => {
            const response = await request(app)
                .post('/api/verification/verify-signature')
                .set('Content-Type', 'application/json')
                .send('{ invalid json }');

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Invalid JSON');
        });

        test('should reject oversized requests', async () => {
            const largeData = {
                signatureData: createValidSignatureData(),
                signature: 'a'.repeat(88),
                publicKey: bs58.encode(testKeypair.publicKey),
                padding: 'x'.repeat(50 * 1024 * 1024) // 50MB of padding
            };

            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send(largeData);

            expect(response.status).toBe(413);
            expect(response.body.error).toContain('too large');
        });

        test('should validate required fields', async () => {
            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData: {
                        // Missing required fields
                        nonce: generateTestNonce()
                    },
                    signature: 'a'.repeat(88),
                    publicKey: bs58.encode(testKeypair.publicKey)
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Validation failed');
        });

        test('should validate wallet address format', async () => {
            const signatureData = createValidSignatureData();
            signatureData.source = 'invalid_address_format';

            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData,
                    signature: 'a'.repeat(88),
                    publicKey: 'invalid_key_format'
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Validation failed');
        });

        test('should validate amount limits', async () => {
            const signatureData = createValidSignatureData();
            signatureData.amount = '1000'; // Exceeds 100 SOL limit

            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData,
                    signature: 'a'.repeat(88),
                    publicKey: bs58.encode(testKeypair.publicKey)
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });
    });

    describe('Domain Validation Security', () => {
        test('should reject signatures from unauthorized domains', async () => {
            const signatureData = createValidSignatureData();
            signatureData.domain = 'malicious-site.com';
            signatureData.source = bs58.encode(testKeypair.publicKey);

            const message = createMessageToSign(signatureData);
            const signature = bs58.encode(nacl.sign.detached(message, testKeypair.secretKey));

            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData,
                    signature,
                    publicKey: bs58.encode(testKeypair.publicKey)
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('domain');
        });

        test('should accept signatures from authorized domains', async () => {
            const signatureData = createValidSignatureData();
            signatureData.domain = 'localhost:3000'; // Authorized domain
            signatureData.source = bs58.encode(testKeypair.publicKey);

            const message = createMessageToSign(signatureData);
            const signature = bs58.encode(nacl.sign.detached(message, testKeypair.secretKey));

            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData,
                    signature,
                    publicKey: bs58.encode(testKeypair.publicKey)
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });
    });

    describe('CORS Security', () => {
        test('should reject requests from unauthorized origins', async () => {
            const response = await request(app)
                .get('/api/verification/stats')
                .set('Origin', 'https://malicious-site.com');

            // Should be blocked by CORS
            expect(response.status).toBe(500); // CORS error
        });

        test('should accept requests from authorized origins', async () => {
            const response = await request(app)
                .get('/api/verification/stats')
                .set('Origin', 'http://localhost:3000');

            expect(response.status).toBe(200);
        });
    });

    describe('Security Headers', () => {
        test('should include security headers in responses', async () => {
            const response = await request(app)
                .get('/health');

            expect(response.headers['x-content-type-options']).toBe('nosniff');
            expect(response.headers['x-frame-options']).toBe('DENY');
            expect(response.headers['x-xss-protection']).toBeTruthy();
            expect(response.headers['strict-transport-security']).toBeTruthy();
        });

        test('should include CSP headers', async () => {
            const response = await request(app)
                .get('/health');

            expect(response.headers['content-security-policy']).toBeTruthy();
        });
    });

    describe('Error Handling Security', () => {
        test('should not leak sensitive information in error messages', async () => {
            const response = await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData: {
                        // Intentionally malformed to trigger error
                        nonce: null
                    }
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBeDefined();

            // Should not contain stack traces or internal details
            expect(JSON.stringify(response.body)).not.toContain('at ');
            expect(JSON.stringify(response.body)).not.toContain('node_modules');
        });

        test('should handle non-existent endpoints gracefully', async () => {
            const response = await request(app)
                .get('/api/nonexistent/endpoint');

            expect(response.status).toBe(404);
            expect(response.body.error).toContain('not found');
        });
    });

    describe('Audit Logging Security', () => {
        test('should log security events', async () => {
            // This would test audit logging functionality
            // Since console logging is used in tests, we can check console output
            const consoleSpy = jest.spyOn(console, 'log');

            // Trigger a security event
            await request(app)
                .post('/api/verification/verify-signature')
                .send({
                    signatureData: createValidSignatureData(),
                    signature: 'invalid',
                    publicKey: 'invalid'
                });

            // Should have logged the security event
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });
    });
});

// Helper functions

function createValidSignatureData() {
    const now = Date.now();
    return {
        nonce: generateTestNonce(),
        timestamp: now,
        expiry: now + (15 * 60 * 1000), // 15 minutes from now
        domain: 'localhost:3000',
        version: '1.0',
        source: '11111111111111111111111111111111',
        destination: '22222222222222222222222222222222',
        amount: '1.5',
        token: 'SOL',
        memo: 'Test transfer',
        maxSlippage: '0.01'
    };
}

function generateTestNonce() {
    return crypto.randomBytes(32)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function createMessageToSign(signatureData) {
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

    return Buffer.from(message, 'utf8');
}

module.exports = {
    createValidSignatureData,
    generateTestNonce,
    createMessageToSign
};