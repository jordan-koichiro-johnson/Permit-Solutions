const Stripe = require('stripe');
const { PLANS } = require('../config/plans');
const {
  getTenantByStripeCustomer,
  getTenantByStripeSubscription,
  setTenantStripe,
  setTenantPlan,
} = require('../db/queries');

// Only initialize Stripe when the key is available; billing routes guard against missing key
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Maps Stripe price IDs → plan keys
function priceIdToPlan(priceId) {
  if (priceId === process.env.STRIPE_PRICE_STARTER)  return 'starter';
  if (priceId === process.env.STRIPE_PRICE_BUSINESS) return 'business';
  return null;
}

// Derive plan from a Stripe subscription object's line items
function derivePlanFromSubscription(subscription) {
  for (const item of (subscription.items?.data || [])) {
    const plan = priceIdToPlan(item.price?.id);
    if (plan) return plan;
  }
  return 'free';
}

async function webhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[Stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const tenantId = parseInt(session.metadata?.tenantId, 10);
        if (!tenantId) break;

        const subscriptionId = session.subscription;
        const customerId = session.customer;

        // Store stripe IDs
        await setTenantStripe(tenantId, customerId, subscriptionId);

        // Fetch subscription to get price and derive plan
        const sub = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['items.data.price'],
        });
        const plan = derivePlanFromSubscription(sub);
        if (plan && plan !== 'free') {
          await setTenantPlan(tenantId, plan);
        }
        console.log(`[Stripe] Tenant ${tenantId} subscribed → plan=${plan}`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const tenant = await getTenantByStripeSubscription(sub.id);
        if (!tenant) break;

        const plan = derivePlanFromSubscription(sub);
        await setTenantPlan(tenant.id, plan || 'free');
        console.log(`[Stripe] Tenant ${tenant.id} subscription updated → plan=${plan}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const tenant = await getTenantByStripeSubscription(sub.id);
        if (!tenant) break;

        await setTenantPlan(tenant.id, 'free');
        // Clear subscription ID but keep customer ID for future checkouts
        await setTenantStripe(tenant.id, tenant.stripe_customer_id, null);
        console.log(`[Stripe] Tenant ${tenant.id} subscription cancelled → plan=free`);
        break;
      }

      default:
        // Ignore other events
        break;
    }
  } catch (err) {
    console.error('[Stripe webhook] handler error:', err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }

  res.json({ received: true });
}

module.exports = { webhookHandler, stripe, priceIdToPlan };
