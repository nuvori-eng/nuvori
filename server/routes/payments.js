// server/routes/payments.js

const express = require('express');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');
const { PLANS } = require('../plans');

const router = express.Router();

// ── POST /api/payments/checkout ────────────────────────────────────────────
// Creates a Stripe Checkout session for upgrading to Pro or Teams
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;

    if (!['pro', 'teams'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan.' });
    }

    const priceId = plan === 'pro'
      ? process.env.STRIPE_PRICE_PRO
      : process.env.STRIPE_PRICE_TEAMS;

    if (!priceId) {
      return res.status(500).json({ error: 'Stripe price ID not configured.' });
    }

    // Create or retrieve Stripe customer
    let customerId = req.user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { userId: req.user.id },
      });
      customerId = customer.id;
      db.updateUser(req.user.email, { stripeCustomerId: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      payment_method_types: ['card'],
      mode:                 'subscription',
      line_items: [{
        price:    priceId,
        quantity: 1,
      }],
      success_url: `${process.env.FRONTEND_URL}/dashboard?upgraded=true`,
      cancel_url:  `${process.env.FRONTEND_URL}/#pricing`,
      metadata: {
        userId: req.user.id,
        plan,
      },
      subscription_data: {
        metadata: { userId: req.user.id, plan },
      },
      allow_promotion_codes: true,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: 'Could not create checkout session.' });
  }
});

// ── POST /api/payments/portal ──────────────────────────────────────────────
// Opens Stripe Customer Portal for managing billing / cancelling
router.post('/portal', requireAuth, async (req, res) => {
  try {
    if (!req.user.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account found.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   req.user.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/dashboard`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    return res.status(500).json({ error: 'Could not open billing portal.' });
  }
});

// ── POST /api/payments/webhook ─────────────────────────────────────────────
// Stripe sends events here — this is how we know when someone pays / cancels
// IMPORTANT: This route must use express.raw() body parser (set in index.js)
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      // ── Payment succeeded → upgrade plan ──
      case 'checkout.session.completed': {
        const session = event.data.object;
        const plan    = session.metadata?.plan;
        const userId  = session.metadata?.userId;
        if (plan && userId) {
          const user = db.getUserById(userId);
          if (user) {
            db.updateUser(user.email, {
              plan,
              stripeSubscriptionId: session.subscription,
            });
            console.log(`✓ Upgraded ${user.email} to ${plan}`);
          }
        }
        break;
      }

      // ── Subscription renewed ──
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.billing_reason === 'subscription_cycle') {
          const user = db.updateUserByStripeCustomerId(invoice.customer, {});
          if (user) console.log(`✓ Renewed subscription for ${user.email}`);
        }
        break;
      }

      // ── Payment failed → downgrade to starter ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const user    = db.updateUserByStripeCustomerId(invoice.customer, { plan: 'starter' });
        if (user) console.log(`⚠ Payment failed for ${user.email}, downgraded to starter`);
        break;
      }

      // ── Subscription cancelled → downgrade to starter ──
      case 'customer.subscription.deleted': {
        const sub  = event.data.object;
        const user = db.updateUserByStripeCustomerId(sub.customer, {
          plan: 'starter',
          stripeSubscriptionId: null,
        });
        if (user) console.log(`✓ Cancelled subscription for ${user.email}`);
        break;
      }

      // ── Subscription updated (e.g. plan change) ──
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const newPlan = sub.metadata?.plan;
        if (newPlan) {
          const user = db.updateUserByStripeCustomerId(sub.customer, { plan: newPlan });
          if (user) console.log(`✓ Updated plan for ${user.email} to ${newPlan}`);
        }
        break;
      }

      default:
        // Ignore other events
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }

  return res.json({ received: true });
});

// ── GET /api/payments/plans ────────────────────────────────────────────────
// Returns plan info for the frontend
router.get('/plans', (req, res) => {
  return res.json({ plans: PLANS });
});

module.exports = router;
