// server/plans.js
// Single source of truth for what each plan can do.
// Update limits here and they apply everywhere automatically.

const PLANS = {

  starter: {
    name:       'Starter',
    price:      0,
    // -1 means unlimited, any positive number is the monthly cap
    limits: {
      resume:      1,
      coverletter: 3,
      interview:   5,
      company:     3,
      career:      2,
      salary:      2,
      decoder:     3,
      skills:      2,
      outreach:    3,
      plan:        1,
    },
    features: {
      fileUpload:       true,
      linkedinOptimize: false,
      atsScoring:       false,
      teamSeats:        1,
    }
  },

  pro: {
    name:  'Pro',
    price: 19,
    limits: {
      resume:      -1,
      coverletter: -1,
      interview:   -1,
      company:     -1,
      career:      -1,
      salary:      -1,
      decoder:     -1,
      skills:      -1,
      outreach:    -1,
      plan:        -1,
    },
    features: {
      fileUpload:       true,
      linkedinOptimize: true,
      atsScoring:       true,
      teamSeats:        1,
    }
  },

  teams: {
    name:  'Teams',
    price: 49,
    limits: {
      resume:      -1,
      coverletter: -1,
      interview:   -1,
      company:     -1,
      career:      -1,
      salary:      -1,
      decoder:     -1,
      skills:      -1,
      outreach:    -1,
      plan:        -1,
    },
    features: {
      fileUpload:       true,
      linkedinOptimize: true,
      atsScoring:       true,
      teamSeats:        25,
      adminDashboard:   true,
      whiteLabel:       true,
    }
  }

};

/**
 * Check if a user can use a feature given their plan and current usage.
 * Returns { allowed: bool, reason: string, remaining: number|'unlimited' }
 */
function checkLimit(user, feature) {
  const plan  = PLANS[user.plan] || PLANS.starter;
  const limit = plan.limits[feature];

  // Unlimited
  if (limit === -1) return { allowed: true, remaining: 'unlimited' };

  const usage   = user.usage?.[feature] || { count: 0 };
  const used    = usage.count || 0;
  const remaining = Math.max(0, limit - used);

  if (used >= limit) {
    return {
      allowed: false,
      remaining: 0,
      reason: `You've used all ${limit} ${feature} session${limit !== 1 ? 's' : ''} on the ${plan.name} plan this month. Upgrade to Pro for unlimited access.`
    };
  }

  return { allowed: true, remaining };
}

module.exports = { PLANS, checkLimit };
