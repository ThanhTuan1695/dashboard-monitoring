const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const buildDevicesRouter = require('./routes/devices');
const buildAuthRouter = require('./routes/auth');
const buildUsersRouter = require('./routes/users');
const buildAuditRouter = require('./routes/audit');
const buildGroupsRouter = require('./routes/groups');
const MonitorScheduler = require('./services/scheduler');
const { requireAuth } = require('./middleware/auth');
const { verifyToken } = require('./services/auth');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: process.env.CLIENT_ORIGIN || '*' },
  });

  // Socket connections must present the same JWT used for the REST API.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      socket.user = verifyToken(token);
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join('status');
  });

  const scheduler = new MonitorScheduler(io);

  app.use('/api/auth', buildAuthRouter());
  app.use('/api/users', buildUsersRouter()); // admin-only checks happen inside the router
  app.use('/api/audit', buildAuditRouter()); // admin-only checks happen inside the router
  app.use('/api/groups', buildGroupsRouter()); // admin-only checks happen inside the router
  app.use('/api/devices', requireAuth, buildDevicesRouter(scheduler, io));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  return { app, server, io, scheduler };
}

module.exports = createApp;
