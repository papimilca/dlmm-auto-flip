module.exports = {
  apps: [
    {
      name: "ba_flip",
      script: "dist/index.js",
      cwd: "/opt/ba_flip",
      args: "config.json",
      instances: 1, // MUST stay 1: single state store & Telegram long-poll
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
