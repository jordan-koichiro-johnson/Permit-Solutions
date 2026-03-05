const express = require('express');
const router = express.Router();
const { PLANS, STATE_ADDON_PRICE } = require('../config/plans');
const {
  getTenantPlan,
  addTenantState,
  removeTenantState,
  countTenantUsers,
  setTenantPlan,
  setTenantStateStripeItem,
  getTenantStateStripeItem,
} = require('../db/queries');
const { pool } = require('../db/index');
const { attachPlan, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { stripe } = require('./stripe');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// ── Shared helpers (also used by tenants.js) ──────────────────────────────────

/**
 * Add a state to a tenant and sync a Stripe subscription item if applicable.
 * Safe to call even if the state is already present (ON CONFLICT DO NOTHING).
 */
async function syncAddState(tenantId, stateCode) {
  await addTenantState(tenantId, stateCode);

  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_STATE) {
    const { rows } = await pool.query(
      `SELECT stripe_subscription_id FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const subId = rows[0]?.stripe_subscription_id;
    if (subId) {
      try {
        const item = await stripe.subscriptionItems.create({
          subscription: subId,
          price: process.env.STRIPE_PRICE_STATE,
          quantity: 1,
        });
        await setTenantStateStripeItem(tenantId, stateCode, item.id);
      } catch (err) {
        console.error('[billing] Stripe state item create failed:', err.message);
      }
    }
  }
}

/**
 * Remove a state from a tenant and delete the Stripe subscription item if present.
 */
async function syncRemoveState(tenantId, stateCode) {
  if (process.env.STRIPE_SECRET_KEY) {
    const stripeItemId = await getTenantStateStripeItem(tenantId, stateCode);
    if (stripeItemId) {
      try {
        await stripe.subscriptionItems.del(stripeItemId, { proration_behavior: 'create_prorations' });
      } catch (err) {
        console.error('[billing] Stripe state item delete failed:', err.message);
      }
    }
  }
  await removeTenantState(tenantId, stateCode);
}

// All routes get plan attached
router.use(attachPlan);

// GET /api/billing — current plan info, user count, states, limits
router.get('/', async (req, res) => {
  try {
    const userCount = await countTenantUsers(req.tenantId);
    const { plan, states } = req.tenantPlan;
    const limits = PLANS[plan] || PLANS.free;

    // Fetch stripe fields for this tenant
    const { rows } = await pool.query(
      `SELECT stripe_customer_id, stripe_subscription_id FROM tenants WHERE id = $1`,
      [req.tenantId]
    );
    const tenant = rows[0] || {};

    res.json({
      plan,
      label:      limits.label,
      price:      limits.price,
      userLimit:  limits.userLimit,
      canCheck:   limits.canCheck,
      canImport:  limits.canImport,
      userCount,
      states,
      stateAddonPrice: STATE_ADDON_PRICE,
      availablePlans: Object.entries(PLANS).map(([key, p]) => ({ key, ...p })),
      hasStripeCustomer:    Boolean(tenant.stripe_customer_id),
      hasActiveSubscription: Boolean(tenant.stripe_subscription_id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/billing/plan — super-admin only; manually set a tenant's plan
router.put('/plan', requireSuperAdmin, async (req, res) => {
  const { plan } = req.body || {};
  if (!PLANS[plan]) {
    return res.status(400).json({ error: `Invalid plan. Must be one of: ${Object.keys(PLANS).join(', ')}` });
  }
  try {
    await setTenantPlan(req.tenantId, plan);
    res.json({ ok: true, plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/checkout — start Stripe Checkout for plan upgrade
router.post('/checkout', requireAdmin, async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Stripe is not configured on this server.' });
  }

  const { plan } = req.body || {};
  const priceMap = {
    starter:  process.env.STRIPE_PRICE_STARTER,
    business: process.env.STRIPE_PRICE_BUSINESS,
  };
  const priceId = priceMap[plan];
  if (!priceId) {
    return res.status(400).json({ error: 'Invalid plan or price not configured.' });
  }

  try {
    // Get or create Stripe customer
    const { rows } = await pool.query(
      `SELECT stripe_customer_id, name FROM tenants WHERE id = $1`,
      [req.tenantId]
    );
    const tenant = rows[0];
    let customerId = tenant?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: tenant?.name || `Tenant ${req.tenantId}`,
        metadata: { tenantId: String(req.tenantId) },
      });
      customerId = customer.id;
      await pool.query(
        `UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2`,
        [customerId, req.tenantId]
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/?checkout=success`,
      cancel_url:  `${APP_URL}/?checkout=cancel`,
      metadata: { tenantId: String(req.tenantId) },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing/checkout]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/portal — open Stripe Customer Portal
router.post('/portal', requireAdmin, async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Stripe is not configured on this server.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT stripe_customer_id FROM tenants WHERE id = $1`,
      [req.tenantId]
    );
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return res.status(400).json({ error: 'No Stripe customer found. Please subscribe first.' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/`,
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    console.error('[billing/portal]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/states — add a state to this tenant
router.post('/states', requireAdmin, async (req, res) => {
  const { state } = req.body || {};
  if (!state || typeof state !== 'string' || !/^[A-Za-z]{2}$/.test(state)) {
    return res.status(400).json({ error: 'state must be a 2-letter code (e.g. WA)' });
  }
  const code = state.toUpperCase();

  try {
    await syncAddState(req.tenantId, code);
    const { states } = await getTenantPlan(req.tenantId);
    res.json({ ok: true, states });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/billing/states/:code — remove a state from this tenant
router.delete('/states/:code', requireAdmin, async (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    return res.status(400).json({ error: 'state must be a 2-letter code' });
  }

  try {
    await syncRemoveState(req.tenantId, code);
    const { states } = await getTenantPlan(req.tenantId);
    res.json({ ok: true, states });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.syncAddState = syncAddState;
module.exports.syncRemoveState = syncRemoveState;
