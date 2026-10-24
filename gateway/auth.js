const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../shared/database');
const {
  JWT_ISSUER,
  JWT_AUDIENCE,
  secretMatches
} = require('../shared/security');
const { respond } = require('./audit');

const router = express.Router();

function readTTL(name, fallback) {
  const value = Number(process.env[name] || fallback);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Konfigurasi ${name} tidak valid.`);
  }

  return value;
}

const accessTTL = readTTL('ACCESS_TOKEN_TTL', 600);
const refreshTTL = readTTL('REFRESH_TOKEN_TTL', 86400);
const serviceTTL = readTTL('SERVICE_TOKEN_TTL', 300);

if (
  !process.env.SERVICE_CLIENT_ID ||
  !process.env.SERVICE_CLIENT_SECRET
) {
  throw new Error('Kredensial service wajib diisi di .env.');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createToken(subject, role, tokenType, ttl, extra = {}) {
  return jwt.sign(
    {
      role,
      token_type: tokenType,
      ...extra
    },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      subject: String(subject),
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: ttl,
      jwtid: crypto.randomUUID()
    }
  );
}

function createAccessToken(user, device) {
  return createToken(
    user.id,
    user.role,
    'access',
    accessTTL,
    { device_id: device }
  );
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const device = req.get('X-Device-ID');

  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    !username ||
    !password ||
    !device
  ) {
    return respond(
      req, res, 400,
      'Username, password, dan X-Device-ID wajib diisi.'
    );
  }

  const user = db.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return respond(req, res, 401, 'Kredensial tidak valid.');
  }

  req.auditSubject = `user:${user.id}`;

  const registered = db.prepare(`
    SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?
  `).get(user.id, device);

  if (!registered) {
    return respond(
      req, res, 403,
      'Device tidak terdaftar untuk user ini.'
    );
  }

  const accessToken = createAccessToken(user, device);
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + refreshTTL;

  db.prepare(`
    INSERT INTO refresh_tokens
      (token_hash, user_id, device_id, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(refreshToken), user.id, device, expiresAt);

  return respond(req, res, 200, 'Login berhasil.', {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: accessTTL,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      nim: user.nim
    }
  });
});

// Digunakan bersama oleh refresh dan logout.
function requireRefreshToken(req, res, next) {
  const token = req.body?.refresh_token;
  const device = req.get('X-Device-ID');

  if (typeof token !== 'string' || !token || !device) {
    return respond(
      req, res, 400,
      'Refresh token dan X-Device-ID wajib diisi.'
    );
  }

  const session = db.prepare(`
    SELECT
      rt.id AS session_id,
      rt.device_id,
      rt.expires_at,
      rt.revoked_at,
      u.id,
      u.username,
      u.role,
      u.nim
    FROM refresh_tokens rt
    JOIN users u ON u.id = rt.user_id
    WHERE rt.token_hash = ?
  `).get(hashToken(token));

  const now = Math.floor(Date.now() / 1000);

  if (
    !session ||
    session.revoked_at !== null ||
    session.expires_at <= now
  ) {
    return respond(
      req, res, 401,
      'Refresh token tidak valid, kedaluwarsa, atau sudah dicabut.'
    );
  }

  req.auditSubject = `user:${session.id}`;

  const registered = db.prepare(`
    SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?
  `).get(session.id, device);

  if (session.device_id !== device || !registered) {
    return respond(
      req, res, 403,
      'Device tidak sesuai dengan sesi refresh token.'
    );
  }

  req.refreshSession = session;
  next();
}

router.post('/refresh', requireRefreshToken, (req, res) => {
  const user = req.refreshSession;
  const accessToken = createAccessToken(user, user.device_id);

  return respond(req, res, 200, 'Access token diperbarui.', {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: accessTTL
  });
});

router.post('/logout', requireRefreshToken, (req, res) => {
  db.prepare(`
    UPDATE refresh_tokens
    SET revoked_at = ?
    WHERE id = ? AND revoked_at IS NULL
  `).run(
    Math.floor(Date.now() / 1000),
    req.refreshSession.session_id
  );

  return respond(
    req, res, 200,
    'Logout berhasil. Refresh token sudah dicabut.'
  );
});

router.post('/service', (req, res) => {
  const { client_id, client_secret } = req.body || {};

  if (
    !secretMatches(client_id, process.env.SERVICE_CLIENT_ID) ||
    !secretMatches(client_secret, process.env.SERVICE_CLIENT_SECRET)
  ) {
    return respond(req, res, 401, 'Kredensial service tidak valid.');
  }

  req.auditSubject = `service:${client_id}`;

  const token = createToken(
    client_id, 'service', 'service', serviceTTL
  );

  return respond(req, res, 200, 'Token service diterbitkan.', {
    access_token: token,
    token_type: 'Bearer',
    expires_in: serviceTTL
  });
});

module.exports = router;
