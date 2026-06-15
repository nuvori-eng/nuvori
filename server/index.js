// server/index.js
// LandIt Backend — Express server
// Handles: Auth, AI proxy, Stripe payments, plan gating, static files

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const path         = require('path');

const authRoutes     = require('./routes/auth');
const aiRoutes       = require('./routes/ai');
const paymentRoutes  = require('./routes/payments');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ───────────────────────────────────────────────────────────────────
app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// ── Stripe webhook needs raw body — MUST be before express.json() ──────────
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

// ── Body parsers ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' })); // 10mb to support file uploads
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Rate limiting ──────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      200,
  message:  { error: 'Too many requests. Please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  { error: 'Too many login attempts. Please try again later.' },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max:      30,
  message:  { error: 'Too many AI requests. Slow down a bit!' },
});

app.use(globalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/ai',   aiLimiter);

// ── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/ai',       aiRoutes);
app.use('/api/payments', paymentRoutes);

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    env: process.env.NODE_ENV,
  });
});

// ── Serve frontend static files ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// All non-API routes serve the frontend (SPA support)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

// ── Start server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════╗
  ║   LandIt Backend running           ║
  ║   http://localhost:${PORT}            ║
  ║   Environment: ${process.env.NODE_ENV || 'development'}         ║
  ╚════════════════════════════════════╝
  `);
});

module.exports = app;
