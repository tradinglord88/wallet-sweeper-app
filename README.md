# 🔐 Secure Solana Deep Link Transfer System

A production-ready, bank-grade security system for creating and executing Solana transfers via deep links with comprehensive security measures including ED25519 signature verification, replay attack prevention, and time-delayed smart contract execution.

## 🌟 Features

### 🔗 Deep Link Generation
- **Cryptographically Signed Links**: ED25519 signatures ensure authenticity
- **QR Code Support**: Mobile-friendly QR codes for easy sharing
- **Expiration Control**: Automatic link expiration (15 minutes default)
- **Multi-Token Support**: SOL, USDC, USDT transfers

### 🛡️ Security Features
- **Signature Verification**: ED25519 cryptographic signature validation
- **Replay Attack Prevention**: Nonce-based protection with Redis backing
- **Rate Limiting**: Multi-tier rate limiting (general + sensitive operations)
- **Domain Validation**: Cross-site request protection
- **Input Sanitization**: Comprehensive input validation and sanitization
- **Audit Logging**: Complete audit trail with security monitoring
- **Auto-Expiration**: Time-based link invalidation

### ⏰ Smart Contract Scheduling
- **Time-Delayed Transfers**: On-chain scheduled transfers
- **Cancellation Support**: Sender can cancel before execution
- **Escrow Protection**: Funds held securely in smart contract
- **Event Emission**: Transparent on-chain event logging

### 🔍 Monitoring & Analytics
- **Real-time Dashboard**: System status and activity monitoring
- **Security Alerts**: Automated alerting for suspicious activity
- **Rate Limit Tracking**: Monitor and prevent abuse
- **Audit Logs**: Comprehensive security event logging

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React/Vanilla JS)             │
├─────────────────────────────────────────────────────────────┤
│  • Wallet Connector (Phantom, Solflare, Slope)             │
│  • Deep Link Generator (ED25519 Signatures)                │
│  • Transaction Executor (Real-time + Pre-signed)           │
│  • Security Utils (Validation, Sanitization)               │
└─────────────────────────────────────────────────────────────┘
                                │
                           HTTPS/WSS
                                │
┌─────────────────────────────────────────────────────────────┐
│                     Backend API (Node.js/Express)          │
├─────────────────────────────────────────────────────────────┤
│  • Signature Verification Service                          │
│  • Nonce Manager (Replay Protection)                       │
│  • Rate Limiter (Multi-tier)                              │
│  • Audit Logger (Security Events)                          │
│  • CORS & Security Headers                                 │
└─────────────────────────────────────────────────────────────┘
                                │
                         ┌──────┴──────┐
                         │             │
              ┌──────────▼──┐    ┌──────▼──────┐
              │    Redis    │    │ PostgreSQL  │
              │   (Nonces)  │    │(Audit Logs) │
              └─────────────┘    └─────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Solana Smart Contract (Rust)              │
├─────────────────────────────────────────────────────────────┤
│  • Scheduled Transfer Program                              │
│  • PDA-based Escrow Accounts                              │
│  • Time-based Execution Control                           │
│  • Cancellation Mechanism                                 │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Rust & Anchor Framework (for smart contracts)
- Redis (for nonce tracking)
- PostgreSQL (for audit logging)
- Solana CLI tools

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/solana-deep-link-transfer.git
   cd solana-deep-link-transfer
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start Redis and PostgreSQL**
   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:alpine
   docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=yourpassword postgres:alpine
   ```

5. **Build and deploy smart contract**
   ```bash
   npm run build-contract
   npm run deploy-contract
   ```

6. **Start the development server**
   ```bash
   npm run dev
   ```

7. **Access the application**
   - Frontend: http://localhost:3000
   - API Health: http://localhost:3000/health

## 📋 Environment Configuration

### Required Environment Variables

```bash
# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_CLUSTER=mainnet-beta
BUSINESS_WALLET_ADDRESS=your_business_wallet_public_key

# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/solana_transfers
REDIS_URL=redis://localhost:6379

# Security Configuration
JWT_SECRET=your_super_secure_jwt_secret_minimum_64_chars
SIGNATURE_VALIDITY_MINUTES=15
MAX_TRANSFER_AMOUNT_SOL=100
SUPPORTED_DOMAINS=localhost:3000,yourdomain.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Smart Contract
PROGRAM_ID=your_deployed_program_id
```

## 🔐 Security Implementation

### 1. Deep Link Security

**Signature Generation:**
```javascript
const signatureData = {
  nonce: crypto.randomBytes(32).toString('base64url'),
  timestamp: Date.now(),
  expiry: Date.now() + (15 * 60 * 1000),
  domain: window.location.host,
  source: walletPublicKey,
  destination: recipientAddress,
  amount: transferAmount,
  token: 'SOL'
};

const message = createMessageToSign(signatureData);
const signature = nacl.sign.detached(message, walletPrivateKey);
```

**Verification Process:**
1. ✅ Timestamp validation (not expired, not future)
2. ✅ Nonce uniqueness check (replay protection)
3. ✅ Domain validation (cross-site protection)
4. ✅ Cryptographic signature verification
5. ✅ Business rule validation (amounts, addresses)
6. ✅ Rate limiting enforcement

### 2. Replay Attack Prevention

**Nonce Management:**
- 32-byte cryptographically secure nonces
- Redis-backed storage with TTL
- Base64URL encoding for URL safety
- Automatic cleanup of expired nonces

**Protection Flow:**
```javascript
// 1. Generate unique nonce
const nonce = generateSecureNonce();

// 2. Check if nonce exists
const exists = await nonceManager.exists(nonce);
if (exists) throw new Error('Replay attack detected');

// 3. Consume nonce atomically
await nonceManager.store(nonce, metadata);
```

### 3. Rate Limiting

**Multi-Tier Protection:**
- **General API**: 100 requests per 15 minutes
- **Sensitive Operations**: 10 requests per 15 minutes
- **Per-Address Limits**: Custom limits per wallet
- **IP-based Tracking**: Monitor suspicious IPs

### 4. Smart Contract Security

**Time-Delayed Execution:**
```rust
pub fn execute_scheduled_transfer(ctx: Context<ExecuteScheduledTransfer>) -> Result<()> {
    let transfer_account = &mut ctx.accounts.transfer_account;
    let clock = Clock::get()?;

    // Security validations
    require!(!transfer_account.executed, TransferError::AlreadyExecuted);
    require!(!transfer_account.cancelled, TransferError::TransferCancelled);
    require!(
        clock.unix_timestamp >= transfer_account.execute_after,
        TransferError::ExecutionTimeNotReached
    );

    // Execute transfer...
    Ok(())
}
```

## 🧪 Testing

### Run the complete test suite

```bash
# Run all tests
npm test

# Run security tests only
npm run test:security

# Run with coverage
npm run test:coverage
```

### Security Test Coverage

- ✅ Signature verification attacks
- ✅ Replay attack prevention
- ✅ Rate limiting enforcement
- ✅ Input validation bypass attempts
- ✅ CORS protection
- ✅ Error information leakage
- ✅ Domain validation bypass
- ✅ Timestamp manipulation attacks

### Example Security Test

```javascript
test('should prevent replay attacks', async () => {
  const nonce = generateTestNonce();
  const signedData = createValidSignedData(nonce);

  // First request should succeed
  const firstResponse = await request(app)
    .post('/api/verification/verify-signature')
    .send(signedData);
  expect(firstResponse.status).toBe(200);

  // Second request with same nonce should fail
  const secondResponse = await request(app)
    .post('/api/verification/verify-signature')
    .send(signedData);
  expect(secondResponse.status).toBe(400);
  expect(secondResponse.body.error).toContain('replay attack detected');
});
```

## 📊 Monitoring & Logging

### Security Event Monitoring

The system provides comprehensive security monitoring:

```javascript
// Automatic security event logging
await auditLogger.logSecurityEvent({
  type: 'replay_attack_detected',
  nonce: hashedNonce,
  sourceAddress: hashedAddress,
  ip: clientIP,
  userAgent: userAgent,
  severity: 'high'
});
```

### Real-time Alerts

Configure webhooks for immediate security alerts:

```bash
# Webhook configuration
WEBHOOK_ALERT_URL=https://your-monitoring-service.com/webhook
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

### Audit Log Format

```json
{
  "timestamp": "2025-01-27T10:30:00.000Z",
  "level": "WARN",
  "eventType": "security_event",
  "data": {
    "type": "signature_verification_failed",
    "error": "Invalid signature",
    "sourceHash": "a1b2c3d4...",
    "ip": "192.168.1.100",
    "userAgent": "Mozilla/5.0..."
  },
  "security": {
    "severity": "high",
    "category": "authentication",
    "requiresAlert": true
  }
}
```

## 🔧 API Reference

### Authentication Endpoints

#### Verify Signature
```http
POST /api/verification/verify-signature
Content-Type: application/json

{
  "signatureData": {
    "nonce": "abc123...",
    "timestamp": 1642694400000,
    "expiry": 1642695300000,
    "domain": "yourapp.com",
    "source": "wallet_public_key",
    "destination": "recipient_address",
    "amount": "1.5",
    "token": "SOL"
  },
  "signature": "base58_encoded_signature",
  "publicKey": "wallet_public_key"
}
```

**Response:**
```json
{
  "success": true,
  "verified": true,
  "verifiedAt": "2025-01-27T10:30:00.000Z",
  "nonce": "abc123..."
}
```

#### Check Nonce Status
```http
GET /api/verification/nonce/{nonce}
```

**Response:**
```json
{
  "success": true,
  "nonce": "abc123...",
  "exists": false,
  "checkedAt": "2025-01-27T10:30:00.000Z"
}
```

### Deep Link Format

```
https://yourapp.com/execute?d=eyJub25jZSI6...&s=base58_signature&v=1.0
```

**Parameters:**
- `d`: Base64-encoded signature data
- `s`: Base58-encoded signature
- `v`: Link version

## 🚀 Production Deployment

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
EXPOSE 3000

CMD ["npm", "start"]
```

### Environment Setup

```bash
# Production environment
NODE_ENV=production
PORT=3000

# Use production RPC endpoints
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Security hardening
RATE_LIMIT_MAX_REQUESTS=50
SIGNATURE_VALIDITY_MINUTES=10
ENABLE_STRICT_MODE=true

# Monitoring
ENABLE_AUDIT_LOGGING=true
WEBHOOK_ALERT_URL=https://monitoring.yourcompany.com/webhooks
```

### Security Checklist

- [ ] **Environment Variables**: All secrets in environment variables
- [ ] **HTTPS**: Force HTTPS in production
- [ ] **Rate Limiting**: Configure appropriate limits
- [ ] **Monitoring**: Set up alerts and monitoring
- [ ] **Audit Logging**: Enable comprehensive logging
- [ ] **Backup**: Regular backup of audit logs
- [ ] **Updates**: Keep dependencies updated
- [ ] **Penetration Testing**: Regular security assessments

## 🤝 Contributing

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add comprehensive tests
5. Ensure all security tests pass
6. Submit a pull request

### Security Guidelines

- Never commit secrets or private keys
- All new endpoints must include rate limiting
- Security-sensitive changes require review
- Add tests for new security features
- Update documentation for security changes

### Code Standards

- ESLint configuration for code quality
- Comprehensive error handling
- Input validation on all endpoints
- Audit logging for security events
- Performance monitoring

## 📖 Documentation

- [API Documentation](./docs/api.md)
- [Security Architecture](./docs/security.md)
- [Smart Contract Guide](./docs/smart-contracts.md)
- [Deployment Guide](./docs/deployment.md)
- [Testing Guide](./docs/testing.md)

## 🛡️ Security Disclosure

If you discover a security vulnerability, please:

1. **DO NOT** create a public issue
2. Email security@yourcompany.com
3. Provide detailed reproduction steps
4. Include potential impact assessment
5. Wait for confirmation before disclosure

We appreciate responsible disclosure and will acknowledge security researchers.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🎯 Roadmap

### v1.1 (Q2 2025)
- [ ] Multi-signature support
- [ ] Hardware wallet integration
- [ ] Advanced scheduling options
- [ ] Mobile app support

### v1.2 (Q3 2025)
- [ ] Cross-chain transfers
- [ ] Advanced analytics dashboard
- [ ] API rate limiting dashboard
- [ ] Enhanced monitoring

### v2.0 (Q4 2025)
- [ ] Decentralized governance
- [ ] Plugin architecture
- [ ] Advanced DeFi integrations
- [ ] Enterprise features

## 📞 Support

- 📧 Email: support@yourcompany.com
- 💬 Discord: [Your Discord Server]
- 📚 Documentation: [docs.yourcompany.com]
- 🐛 Issues: [GitHub Issues]

---

**Built with security-first principles for the Solana ecosystem** 🔐✨