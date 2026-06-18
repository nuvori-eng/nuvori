// server/db.js
// Lightweight JSON file database.
// Easy to swap for PostgreSQL/MongoDB - just replace the functions below.

const fs   = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/users.json');

function load() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { users: {} };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ── User CRUD ──────────────────────────────────────────────────────────────

function getUser(email) {
  return load().users[email.toLowerCase()] || null;
}

function getUserById(id) {
  const db = load();
  return Object.values(db.users).find(u => u.id === id) || null;
}

function createUser({ id, email, passwordHash = null, plan = 'starter', stripeCustomerId = null, authProvider = 'email', googleId = null }) {
  const db = load();
  const user = {
    id,
    email: email.toLowerCase(),
    passwordHash,
    authProvider,
    googleId,
    plan,
    stripeCustomerId,
    stripeSubscriptionId: null,
    resetToken: null,
    resetTokenExpires: null,
    emailVerified: false,
    verifyToken: null,
    createdAt: new Date().toISOString(),
    conversations: {},
    usage: {
      resume:      { count: 0, resetAt: nextMonthISO() },
      coverletter: { count: 0, resetAt: nextMonthISO() },
      interview:   { count: 0, resetAt: nextMonthISO() },
      company:     { count: 0, resetAt: nextMonthISO() },
      career:      { count: 0, resetAt: nextMonthISO() },
      salary:      { count: 0, resetAt: nextMonthISO() },
      decoder:     { count: 0, resetAt: nextMonthISO() },
      skills:      { count: 0, resetAt: nextMonthISO() },
      outreach:    { count: 0, resetAt: nextMonthISO() },
      plan:        { count: 0, resetAt: nextMonthISO() },
    }
  };
  db.users[email.toLowerCase()] = user;
  save(db);
  return user;
}

function getUserByResetToken(token) {
  const db = load();
  return Object.values(db.users).find(u => u.resetToken === token) || null;
}

function getUserByVerifyToken(token) {
  const db = load();
  return Object.values(db.users).find(u => u.verifyToken === token) || null;
}

function updateUser(email, updates) {
  const db = load();
  const key = email.toLowerCase();
  if (!db.users[key]) return null;
  db.users[key] = { ...db.users[key], ...updates };
  save(db);
  return db.users[key];
}

function getUserByStripeCustomerId(stripeCustomerId) {
  const db = load();
  return Object.values(db.users).find(u => u.stripeCustomerId === stripeCustomerId) || null;
}

function updateUserByStripeCustomerId(stripeCustomerId, updates) {
  const db = load();
  const user = Object.values(db.users).find(u => u.stripeCustomerId === stripeCustomerId);
  if (!user) return null;
  db.users[user.email] = { ...user, ...updates };
  save(db);
  return db.users[user.email];
}

function incrementUsage(email, feature) {
  const db   = load();
  const key  = email.toLowerCase();
  const user = db.users[key];
  if (!user) return null;

  // Reset counter if month has rolled over
  const usage = user.usage[feature];
  if (usage && new Date() > new Date(usage.resetAt)) {
    usage.count   = 0;
    usage.resetAt = nextMonthISO();
  }
  if (usage) usage.count++;
  save(db);
  return db.users[key];
}

function nextMonthISO() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Conversation persistence ────────────────────────────────────────────
// Stores the last MAX_HISTORY messages per feature, per user, so chats
// survive page reloads and sync across devices. Caps growth on the flat file.
const MAX_HISTORY_MESSAGES = 30;

function saveConversation(email, feature, messages) {
  const db   = load();
  const key  = email.toLowerCase();
  const user = db.users[key];
  if (!user) return null;

  if (!user.conversations) user.conversations = {};
  user.conversations[feature] = messages.slice(-MAX_HISTORY_MESSAGES);

  save(db);
  return user;
}

function getConversations(email) {
  const user = getUser(email);
  return (user && user.conversations) || {};
}

module.exports = {
  getUser,
  getUserById,
  getUserByResetToken,
  getUserByVerifyToken,
  createUser,
  updateUser,
  updateUserByStripeCustomerId,
  getUserByStripeCustomerId,
  incrementUsage,
  saveConversation,
  getConversations,
};
