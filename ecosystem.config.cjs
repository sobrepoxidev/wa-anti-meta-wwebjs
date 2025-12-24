// PM2 Ecosystem Configuration
// Uso: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'wa-worker-1',
      script: 'worker.js',
      env: {
        PORT: 3001,
        WORKER_ID: 'worker-1'
      },
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      watch: false,
      autorestart: true
    },
    {
      name: 'wa-worker-2',
      script: 'worker.js',
      env: {
        PORT: 3002,
        WORKER_ID: 'worker-2'
      },
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      watch: false,
      autorestart: true
    },
    {
      name: 'wa-worker-3',
      script: 'worker.js',
      env: {
        PORT: 3003,
        WORKER_ID: 'worker-3'
      },
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      watch: false,
      autorestart: true
    },
    {
      name: 'wa-worker-4',
      script: 'worker.js',
      env: {
        PORT: 3004,
        WORKER_ID: 'worker-4'
      },
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      watch: false,
      autorestart: true
    }
  ]
};
