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

module.exports = { requireAuth, attachTenant, requireAdmin, requireSuperAdmin };
