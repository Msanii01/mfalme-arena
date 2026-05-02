'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../..', '.env') });

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const crypto     = require('crypto');

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

// ── Rate limiters ────────────────────────────────────────────
// Per-route limiters scope abuse to specific endpoints rather than the entire
// surface (so e.g. a hot game-loop /move endpoint can't be DoSed by burst
// auth attempts elsewhere). Limits are per-IP via the standard X-Forwarded-For
// chain plus the connection IP — appropriate for an authenticated API in
// front of a CDN/load balancer.
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const matchActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const tttMoveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// Apply BEFORE the route mounts so the limiter sees the request first.
app.use('/auth', authLimiter);
app.use('/webhooks', webhookLimiter);
// Path-pattern limiters: only the deposit/accept/move routes get throttled,
// not GET /matches.
app.use('/matches/:id/deposit', matchActionLimiter);
app.use('/matches/:id/accept', matchActionLimiter);
// Apply TTT move limiter to any POST that ends in /move (e.g.
// /tictactoe/:gameId/move).
app.use(/^\/tictactoe\/.*move.*$/, tttMoveLimiter);

// ── Routes ───────────────────────────────────────────────────
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

// Cleanup service (1-min timeout for challenges)
const { startCleanupService } = require('./services/cleanup');
startCleanupService();

// ── 404 handler ──────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
});

// ── Global error handler ─────────────────────────────────────
// In production we redact `err.message` (which can include stack frames,
// SQL fragments, RPC internals). The full error is logged server-side and
// correlated with the response via a short requestId so support can trace
// it. In dev we keep the raw message visible to make debugging fast.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  console.error(`[req:${requestId}] Unhandled error:`, err);

  const status = err.status || 500;
  if (process.env.NODE_ENV === 'production') {
    return res.status(status).json({
      error: 'Internal server error',
      requestId,
    });
  }
  res.status(status).json({
    error: err.message || 'Internal server error',
    code:  err.code    || 'INTERNAL_ERROR',
    requestId,
    stack: err.stack,
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
