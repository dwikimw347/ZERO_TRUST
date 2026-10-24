const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { evaluate } = require('./policy');
const { audit, respond } = require('./audit');

const router = express.Router();

const targets = {
  nilai: process.env.NILAI_URL || 'http://127.0.0.1:3001',
  transkrip: process.env.TRANSKRIP_URL || 'http://127.0.0.1:3002'
};

router.use((req, res, next) => {
  const decision = evaluate(req);

  if (!decision.allow) {
    return respond(req, res, decision.status, decision.reason);
  }

  req.resourceTarget = targets[decision.target];

  // Pasang dan timpa secret sebelum proxy membuat request keluar.
  req.headers['x-gateway-secret'] = process.env.GATEWAY_SECRET;

  audit(req, 'allow', decision.reason);
  next();
});

router.use(createProxyMiddleware({
  target: targets.nilai,
  router: req => req.resourceTarget,
  changeOrigin: true,
  proxyTimeout: 15000,
  on: {
    error(err, req, res) {
      console.error('Proxy error:', err.message);

      if (!res.headersSent) {
        res.writeHead(502, {
          'Content-Type': 'application/json'
        });
      }

      if (!res.writableEnded) {
        res.end(JSON.stringify({
          error: 'Service tujuan tidak dapat dihubungi.'
        }));
      }
    }
  }
}));

module.exports = router;
