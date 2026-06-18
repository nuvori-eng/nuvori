// server/routes/payments.js

const express = require('express');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');
const { PLANS } = require('../plans');

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail(to, subject, html) {
  try {
    await resend.emails.send({ from: 'Nuvori <noreply@nuvoriai.com>', to, subject, html });
  } catch (err) {
    console.error('Email send error:', err);
  }
}

// ── POST /api/payments/checkout ────────────────────────────────────────────
// Creates a Stripe Checkout session for upgrading to Pro or Teams
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;

    if (!['core', 'pro'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan.' });
    }

    const priceId = plan === 'pro'
      ? process.env.STRIPE_PRICE_PRO
      : process.env.STRIPE_PRICE_CORE;

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

            const planInfo = PLANS[plan];
            sendEmail(
              user.email,
              `You're on Nuvori ${planInfo ? planInfo.name : plan}`,
              `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px;color:#0f0f0d;">
                <h2 style="font-family:Georgia,serif;">Welcome to ${planInfo ? planInfo.name : plan}</h2>
                <p style="font-size:15px;line-height:1.6;color:#5a5a52;">Your payment was successful and your account is now upgraded to the ${planInfo ? planInfo.name : plan} plan${planInfo ? ` at $${planInfo.price}/month` : ''}. You now have access to everything included in this plan.</p>
                <a href="https://nuvoriai.com" style="display:inline-block;background:#0f1a14;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0;">Start Using Nuvori</a>
                <p style="font-size:13px;color:#9a9a8e;margin-top:24px;">You can manage or cancel your subscription anytime from My Account &rarr; Manage Billing.</p>
              </div>`
            );
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
        if (user) {
          console.log(`✓ Cancelled subscription for ${user.email}`);
          sendEmail(
            user.email,
            'Your Nuvori subscription has been cancelled',
            `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px;color:#0f0f0d;">
              <h2 style="font-family:Georgia,serif;">Subscription cancelled</h2>
              <p style="font-size:15px;line-height:1.6;color:#5a5a52;">Your Nuvori subscription has been cancelled and your account has been moved back to the free Starter plan. You can resubscribe anytime to regain full access.</p>
              <a href="https://nuvoriai.com/#pricing" style="display:inline-block;background:#0f1a14;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0;">View Plans</a>
              <p style="font-size:13px;color:#9a9a8e;margin-top:24px;">We'd love to have you back. If you have feedback on why you cancelled, just reply to this email.</p>
            </div>`
          );
        }
        break;
      }

      // ── Subscription updated (e.g. plan change, including self-service portal downgrades) ──
      case 'customer.subscription.updated': {
        const sub = event.data.object;

        // Derive plan from the actual price ID Stripe is charging, rather than
        // metadata — the Stripe-hosted Customer Portal can change a subscription's
        // price without necessarily carrying over our custom metadata, so price ID
        // is the only fully reliable source of truth here.
        const currentPriceId = sub.items?.data?.[0]?.price?.id;
        let newPlan = null;
        if (currentPriceId === process.env.STRIPE_PRICE_PRO)  newPlan = 'pro';
        if (currentPriceId === process.env.STRIPE_PRICE_CORE) newPlan = 'core';

        // Fall back to metadata if price ID didn't match either known plan
        // (e.g. during a transition, or if env vars were updated after the fact).
        if (!newPlan) newPlan = sub.metadata?.plan || null;

        if (newPlan) {
          const user = db.getUserByStripeCustomerId(sub.customer);
          const currentPlan = user ? user.plan : null;

          // Only update + email if the plan actually changed, to avoid noisy
          // duplicate emails on unrelated subscription.updated events
          // (e.g. payment method updates also fire this same webhook event).
          if (currentPlan !== newPlan) {
            const updatedUser = db.updateUserByStripeCustomerId(sub.customer, { plan: newPlan });
            if (updatedUser) {
              console.log(`✓ Updated plan for ${updatedUser.email} to ${newPlan} (was ${currentPlan})`);
              const planInfo = PLANS[newPlan];
              sendEmail(
                updatedUser.email,
                `Your Nuvori plan has changed`,
                `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px;color:#0f0f0d;">
                  <h2 style="font-family:Georgia,serif;">Plan updated</h2>
                  <p style="font-size:15px;line-height:1.6;color:#5a5a52;">Your Nuvori plan has been changed to ${planInfo ? planInfo.name : newPlan}${planInfo ? ` at $${planInfo.price}/month` : ''}.</p>
                  <a href="https://nuvoriai.com" style="display:inline-block;background:#0f1a14;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0;">Open Nuvori</a>
                </div>`
              );
            }
          }
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
