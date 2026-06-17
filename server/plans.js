// server/plans.js
// Single source of truth for what each plan can do.
// Update limits here and they apply everywhere automatically.

const PLANS = {

  starter: {
    name:       'Starter',
    price:      0,
    // -1 means unlimited, any positive number is the monthly cap, 0 means locked
    limits: {
      resume:      1,
      coverletter: 1,
      interview:   0,
      company:     0,
      career:      0,
      salary:      0,
      decoder:     1,
      skills:      0,
      outreach:    0,
      plan:        0,
    },
    features: {
      fileUpload:       true,
      linkedinOptimize: false,
      atsScoring:       false,
      teamSeats:        1,
    }
  },

  core: {
    name:  'Core',
    price: 19,
    limits: {
      resume:      5,
      coverletter: -1,
      interview:   0,
      company:     -1,
      career:      0,
      salary:      0,
      decoder:     -1,
      skills:      -1,
      outreach:    0,
      plan:        0,
    },
    features: {
      fileUpload:       true,
      linkedinOptimize: false,
      atsScoring:       true,
      teamSeats:        1,
    }
  },

  pro: {
    name:  'Pro',
    price: 39,
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
  }

};

/**
 * Find the cheapest plan that actually unlocks a given feature (unlimited or
 * has a usage allowance), so upgrade messages point to the right tier instead
 * of assuming Core is always the next step up from Starter.
 */
function cheapestPlanThatUnlocks(feature, currentPlanKey) {
  const order = ['starter', 'core', 'pro'];
  const currentIndex = order.indexOf(currentPlanKey);
  for (let i = currentIndex + 1; i < order.length; i++) {
    const candidate = PLANS[order[i]];
    if (candidate.limits[feature] !== 0) return candidate.name;
  }
  return 'Pro'; // fallback — Pro unlocks everything
}

/**
 * Check if a user can use a feature given their plan and current usage.
 * Returns { allowed: bool, reason: string, remaining: number|'unlimited' }
 */
function checkLimit(user, feature) {
  const plan  = PLANS[user.plan] || PLANS.starter;
  const limit = plan.limits[feature];

  // Unlimited
  if (limit === -1) return { allowed: true, remaining: 'unlimited' };

  // Feature fully locked on this plan
  if (limit === 0) {
    const nextPlan = cheapestPlanThatUnlocks(feature, user.plan);
    return {
      allowed: false,
      remaining: 0,
      reason: `This feature isn't included on the ${plan.name} plan. Upgrade to ${nextPlan} to unlock it.`
    };
  }

  const usage   = user.usage?.[feature] || { count: 0 };
  const used    = usage.count || 0;
  const remaining = Math.max(0, limit - used);

  if (used >= limit) {
    const nextPlan = cheapestPlanThatUnlocks(feature, user.plan);
    return {
      allowed: false,
      remaining: 0,
      reason: `You've used all ${limit} ${feature} session${limit !== 1 ? 's' : ''} on the ${plan.name} plan this month. Upgrade to ${nextPlan} for more access.`
    };
  }

  return { allowed: true, remaining };
}

module.exports = { PLANS, checkLimit };
