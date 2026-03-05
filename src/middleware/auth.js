function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function attachTenant(req, res, next) {
  req.tenantId = req.session?.tenantId ?? null;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.role !== 'admin' && !req.session.isSuperAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.session.isSuperAdmin) return res.status(403).json({ error: 'Forbidden' });
  next();
}

async function attachPlan(req, res, next) {
  try {
    const { PLANS } = require('../config/plans');
    const { getTenantPlan } = require('../db/queries');
    const { plan, states } = await getTenantPlan(req.tenantId);
    const limits = PLANS[plan] || PLANS.free;
    req.tenantPlan = { plan, states, ...limits };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, attachTenant, requireAdmin, requireSuperAdmin, attachPlan };
