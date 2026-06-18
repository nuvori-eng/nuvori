// server/routes/auth.js

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { OAuth2Client } = require('google-auth-library');
const { Resend } = require('resend');
const db       = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
};

function issueToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

async function sendEmail(to, subject, html) {
  try {
    await resend.emails.send({
      from: 'Nuvori <noreply@nuvoriai.com>',
      to,
      subject,
      html,
    });
  } catch (err) {
    // Don't block the main request if email fails — just log it
    console.error('Email send error:', err);
  }
}

function emailWrapper(innerHtml) {
  return `
    <div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px;color:#0f0f0d;">
      ${innerHtml}
      <p style="font-size:12px;color:#b0b0a8;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">Nuvori AI &middot; nuvoriai.com</p>
    </div>
  `;
}

// ── POST /api/auth/signup ──────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (db.getUser(email)) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const user = db.createUser({
      id: uuidv4(),
      email,
      passwordHash,
      plan: 'starter',
    });
    db.updateUser(email, { emailVerified: false, verifyToken });

    const token = issueToken(user.id);
    res.cookie('landit_token', token, COOKIE_OPTS);

    const verifyUrl = `${process.env.FRONTEND_URL}/?verify_token=${verifyToken}`;
    sendEmail(
      user.email,
      'Welcome to Nuvori — verify your email',
      emailWrapper(`
        <h2 style="font-family:Georgia,serif;">Welcome to Nuvori</h2>
        <p style="font-size:15px;line-height:1.6;color:#5a5a52;">Your account is ready. Before you get started, please verify your email address by clicking the button below.</p>
        <a href="${verifyUrl}" style="display:inline-block;background:#0f1a14;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0;">Verify Email</a>
        <p style="font-size:15px;line-height:1.6;color:#5a5a52;margin-top:20px;">Once verified, you're ready to rewrite your resume, prep for interviews, and land your next role with Nuvori AI.</p>
      `)
    );

    return res.status(201).json({
      message: 'Account created.',
      token,
      user: safeUser(db.getUser(email)),
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = db.getUser(email);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = issueToken(user.id);
    res.cookie('landit_token', token, COOKIE_OPTS);

    return res.json({
      message: 'Logged in.',
      token,
      user: safeUser(user),
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/auth/google ──────────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Missing Google credential.' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email   = payload.email;
    const googleId = payload.sub;

    if (!payload.email_verified) {
      return res.status(401).json({ error: 'Google email is not verified.' });
    }

    let user = db.getUser(email);
    let isNewUser = false;

    if (!user) {
      user = db.createUser({
        id: uuidv4(),
        email,
        plan: 'starter',
        authProvider: 'google',
        googleId,
      });
      isNewUser = true;
    } else if (!user.googleId) {
      // Existing email/password account signing in with Google for the first time
      user = db.updateUser(email, { googleId, authProvider: user.authProvider === 'email' ? 'email' : 'google' });
    }

    const token = issueToken(user.id);
    res.cookie('landit_token', token, COOKIE_OPTS);

    return res.json({
      message: 'Logged in with Google.',
      token,
      user: safeUser(user),
      isNewUser,
    });
  } catch (err) {
    console.error('Google auth error:', err);
    return res.status(401).json({ error: 'Could not verify Google sign-in. Please try again.' });
  }
});

// ── POST /api/auth/forgot-password ─────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const user = db.getUser(email);

    // Always return success even if user doesn't exist — prevents email enumeration
    if (!user) {
      return res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
    }

    if (user.authProvider === 'google' && !user.passwordHash) {
      // Google-only accounts have no password to reset
      return res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    db.updateUser(email, { resetToken, resetTokenExpires });

    const resetUrl = `${process.env.FRONTEND_URL}/?reset_token=${resetToken}`;

    await resend.emails.send({
      from: 'Nuvori <noreply@nuvoriai.com>',
      to: user.email,
      subject: 'Reset your Nuvori password',
      html: `
        <div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px;color:#0f0f0d;">
          <h2 style="font-family:Georgia,serif;">Reset your password</h2>
          <p style="font-size:15px;line-height:1.6;color:#5a5a52;">We received a request to reset your Nuvori password. Click the button below to choose a new one. This link expires in 1 hour.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#0f1a14;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0;">Reset Password</a>
          <p style="font-size:13px;color:#9a9a8e;margin-top:24px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });

    return res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/auth/reset-password ──────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const user = db.getUserByResetToken(token);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset link.' });
    }
    if (new Date() > new Date(user.resetTokenExpires)) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    db.updateUser(user.email, { passwordHash, resetToken: null, resetTokenExpires: null });

    return res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/auth/verify-email ────────────────────────────────────────────
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required.' });
    }

    const user = db.getUserByVerifyToken(token);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification link.' });
    }

    db.updateUser(user.email, { emailVerified: true, verifyToken: null });

    return res.json({ message: 'Email verified successfully.' });
  } catch (err) {
    console.error('Verify email error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/auth/logout ──────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('landit_token');
  return res.json({ message: 'Logged out.' });
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  return res.json({ user: safeUser(req.user) });
});

// Strip sensitive fields before sending to client
function safeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

module.exports = router;
