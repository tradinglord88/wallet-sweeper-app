/**
 * PM2 Ecosystem Configuration for Enterprise-Level Dark Pino Wallet Sweeper
 *
 * This configuration enables:
 * - Cluster mode with auto-scaling
 * - Load balancing across CPU cores
 * - Auto-restart on failure
 * - Memory limits and monitoring
 * - Log management
 */

module.exports = {
  apps: [{
    name: 'dark-pino-enterprise',
    script: './backend/cluster-server.js',

    // Cluster configuration
    instances: 'max', // Use all available CPU cores
    exec_mode: 'cluster',

    // Auto-scaling configuration
    max_memory_restart: '2G',
    min_uptime: '10s',
    max_restarts: 10,

    // Environment variables
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 3000,
      watch: true,
      ignore_watch: ['node_modules', 'logs', '.git']
    },

    // Logging configuration
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    merge_logs: true,

    // Advanced features
    kill_timeout: 5000,
    listen_timeout: 3000,
    shutdown_with_message: true,

    // Health monitoring
    health_check: {
      interval: 30,
      url: 'http://localhost:3000/health'
    }
  }, {
    name: 'dark-pino-worker',
    script: './backend/workers/queue-worker.js',
    instances: 2,
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      WORKER_TYPE: 'queue'
    }
  }],

  // Deploy configuration for different environments
  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:tradinglord88/wallet-sweeper-app.git',
      path: '/var/www/dark-pino',
      'pre-deploy': 'npm install',
      'post-deploy': 'pm2 startOrRestart ecosystem.config.js --env production',
      'pre-setup': 'apt-get update && apt-get install -y nodejs npm redis-server postgresql'
    }
  }
};