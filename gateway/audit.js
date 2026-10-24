const db = require('../shared/database');

function audit(req, decision, reason) {
  db.prepare(`
    INSERT INTO audit_logs
      (subject, method, endpoint, device_id, decision, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.auditSubject || 'anonymous',
    req.method,
    req.originalUrl.split('?')[0],
    req.get('X-Device-ID') || null,
    decision,
    reason
  );
}

function respond(req, res, status, reason, data = {}) {
  audit(req, status < 400 ? 'allow' : 'deny', reason);

  return res.status(status).json({
    message: reason,
    ...data
  });
}

module.exports = { audit, respond };
