// PM2 process manager config — auto-restart on crash/reboot.
// Usage:
//   npx pm2 start ecosystem.config.cjs
//   npx pm2 save && npx pm2 startup   (to survive reboots)
//   npx pm2 logs devimurlika
module.exports = {
  apps: [{
    name: 'devimurlika',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    env: { NODE_ENV: 'production' },
    max_memory_restart: '300M'
  }]
};
