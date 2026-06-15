# LandIt — Deployment Guide

## Project Structure

```
landit/
├── server/
│   ├── index.js          # Express app entry point
│   ├── db.js             # File-based database (swap for Postgres in prod)
│   ├── plans.js          # Plan limits & feature gating
│   ├── middleware/
│   │   └── auth.js       # JWT authentication middleware
│   └── routes/
│       ├── auth.js       # Signup, login, logout, /me
│       ├── ai.js         # Claude API proxy + usage tracking
│       └── payments.js   # Stripe checkout, portal, webhooks
├── public/
│   └── index.html        # Frontend (served as static file)
├── data/                 # Auto-created — stores users.json
├── .env.example          # Copy to .env and fill in your keys
├── render.yaml           # One-click Render deployment
└── package.json
```

---

## Step 1 — Get your API keys

### Anthropic
1. Go to https://console.anthropic.com
2. Create an API key
3. Copy it — this is your `ANTHROPIC_API_KEY`

### Stripe
1. Go to https://dashboard.stripe.com
2. Get your **Secret key** from Developers → API keys (`STRIPE_SECRET_KEY`)
3. Create two **Products** in the Stripe dashboard:
   - "LandIt Pro" — $19/month recurring → copy the **Price ID** → `STRIPE_PRICE_PRO`
   - "LandIt Teams" — $49/month recurring → copy the **Price ID** → `STRIPE_PRICE_TEAMS`

---

## Step 2 — Deploy to Render (recommended, free tier available)

1. Push this folder to a GitHub repo
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` — click **Apply**
5. Add your environment variables in the Render dashboard:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_PRICE_PRO=price_...
   STRIPE_PRICE_TEAMS=price_...
   FRONTEND_URL=https://your-app.onrender.com
   ```
6. Deploy — Render gives you a URL like `https://landit.onrender.com`

---

## Step 3 — Set up Stripe Webhook

After deploying, tell Stripe where to send payment events:

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://your-app.onrender.com/api/payments/webhook`
3. Select these events:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
4. Copy the **Signing secret** → add as `STRIPE_WEBHOOK_SECRET` in Render

---

## Step 4 — Test everything

```bash
# Health check
curl https://your-app.onrender.com/api/health

# Sign up
curl -X POST https://your-app.onrender.com/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}'

# Test Stripe with card number: 4242 4242 4242 4242
```

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your keys
cp .env.example .env

# 3. Start the dev server
npm run dev

# Server runs at http://localhost:3000
```

---

## Plan Limits (edit in server/plans.js)

| Feature       | Starter | Pro | Teams |
|---------------|---------|-----|-------|
| Resume Review | 1/mo    | ∞   | ∞     |
| Cover Letters | 3/mo    | ∞   | ∞     |
| Interviews    | 5/mo    | ∞   | ∞     |
| Company Research | 3/mo | ∞  | ∞     |
| All others    | 2-3/mo  | ∞   | ∞     |

---

## Upgrading the Database

The default setup uses a JSON file (`data/users.json`) — perfect for getting started.

To switch to PostgreSQL for production scale:
1. Replace the functions in `server/db.js` with Postgres queries
2. Add `pg` to package.json: `npm install pg`
3. Set `DATABASE_URL` in your environment

The rest of the app doesn't need to change — it all goes through `db.js`.
