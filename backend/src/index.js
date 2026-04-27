'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../..', '.env') });

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');

const http       = require('http');
const socket     = require('./socket');

const app  = express();
const server = http.createServer(app);
socket.init(server);

const PORT = process.env.PORT || 3001;

// ── Security middleware ──────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:3000',
      process.env.FRONTEND_URL,
    ].filter(Boolean);
    // Allow Vercel preview/prod deployments
    if (!origin || allowed.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// ── Request parsing ──────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ── Logging ──────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'mfalme-arena-backend',
    network: process.env.BASE_NETWORK || 'sepolia',
    timestamp: new Date().toISOString(),
    env: {
      DATABASE_URL:          process.env.DATABASE_URL         ? '✅ set' : '❌ missing',
      PRIVY_APP_ID:          process.env.PRIVY_APP_ID         ? '✅ set' : '❌ missing',
      PRIVY_APP_SECRET:      process.env.PRIVY_APP_SECRET     ? '✅ set' : '❌ missing',
      RIOT_API_KEY:          process.env.RIOT_API_KEY         ? '✅ set' : '❌ missing',
      JWT_SECRET:            process.env.JWT_SECRET           ? '✅ set' : '❌ missing',
      BASE_RPC_URL:          process.env.BASE_RPC_URL         ? '✅ set' : '❌ missing',
      BUNDLER_RPC_URL:       process.env.BUNDLER_RPC_URL      ? '✅ set' : '❌ missing',
      PAYMASTER_ADDRESS:     process.env.PAYMASTER_ADDRESS    ? '✅ set' : '❌ missing',
      ESCROW_CONTRACT_ADDRESS:     process.env.ESCROW_CONTRACT_ADDRESS     ? '✅ set' : '❌ missing',
      TOURNAMENT_CONTRACT_ADDRESS: process.env.TOURNAMENT_CONTRACT_ADDRESS ? '✅ set' : '❌ missing',
      USDC_CONTRACT_ADDRESS: process.env.USDC_CONTRACT_ADDRESS ? '✅ set' : '❌ missing',
    },
  });
});

// ── Routes (TODO: wire up in Phase 3-6) ─────────────────────
// Phase 3
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// TODO: wire up in Phase 4
// const walletRoutes      = require('./routes/wallet');
// app.use('/wallet', walletRoutes);

// Phase 5
const matchRoutes = require('./routes/matches');
app.use('/matches', matchRoutes);

// Phase 5
const webhookRoutes = require('./routes/webhooks');
app.use('/webhooks', webhookRoutes);

// Phase 6
const tournamentRoutes  = require('./routes/tournaments');
app.use('/tournaments', tournamentRoutes);

// Tic Tac Toe MVP
const tictactoeRoutes = require('./routes/tictactoe');
app.use('/tictactoe', tictactoeRoutes);

// Player stats
const statsRoutes = require('./routes/stats');
app.use('/stats', statsRoutes);

// ── 404 handler ──────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
});

// ── Global error handler ─────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    code:  err.code    || 'INTERNAL_ERROR',
  });
});

// ── Start ─────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n👑 Mfalme Arena Backend`);
  console.log(`   Network: Base ${process.env.BASE_NETWORK || 'sepolia'}`);
  console.log(`   Listening on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { app, server }; // for testing
