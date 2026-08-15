require('dotenv').config();
const mongoose = require('mongoose');
const createApp = require('./app');
const User = require('./models/User');

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/monitoring-dashboard';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[server] connected to MongoDB at ${MONGODB_URI}`);

  const userCount = await User.countDocuments();
  if (userCount === 0) {
    console.warn(
      '[server] No users exist yet — the dashboard requires login. Create one with:\n' +
        '  npm run seed:admin -- <username> <password>'
    );
  }

  const { server, scheduler } = createApp();
  await scheduler.start();

  server.listen(PORT, () => {
    console.log(`[server] listening on port ${PORT}`);
  });

  const shutdown = async () => {
    console.log('[server] shutting down...');
    await scheduler.stop();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});
