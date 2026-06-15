// server/middleware/auth.js

const jwt  = require('jsonwebtoken');
const db   = require('../db');

/**
 * requireAuth — protects routes that need a logged-in user.
 * Reads the JWT from Authorization header or httpOnly cookie.
 * Attaches req.user = full user record from DB.
 */
function requireAuth(req, res, next) {
  try {
    // Support both Authorization: Bearer <token> and cookie
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.cookies?.landit_token) {
      token = req.cookies.landit_token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user    = db.getUserById(payload.userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

/**
 * optionalAuth — attaches user if token present, but doesn't block if not.
 * Useful for endpoints that behave differently for logged-in users.
 */
function optionalAuth(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.cookies?.landit_token) {
      token = req.cookies.landit_token;
    }

    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = db.getUserById(payload.userId) || null;
    }
  } catch {
    req.user = null;
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
