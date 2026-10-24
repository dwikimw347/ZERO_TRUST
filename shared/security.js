const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env')
});

const JWT_ISSUER = 'zero-trust';
const JWT_AUDIENCE = 'zero-trust-api';

if (!process.env.JWT_SECRET || !process.env.GATEWAY_SECRET) {
  throw new Error('JWT_SECRET dan GATEWAY_SECRET wajib diisi.');
}

function secretMatches(received, expected) {
  if (typeof received !== 'string') return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  });

  if (
    typeof payload !== 'object' ||
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    !Number.isInteger(payload.exp)
  ) {
    throw new Error('Isi token tidak valid.');
  }

  const userRoles = ['admin', 'dosen', 'mahasiswa'];

  if (payload.token_type === 'access') {
    if (!userRoles.includes(payload.role)) {
      throw new Error('Role user tidak valid.');
    }
  } else if (payload.token_type === 'service') {
    if (
      payload.role !== 'service' ||
      payload.sub !== process.env.SERVICE_CLIENT_ID
    ) {
      throw new Error('Identitas service tidak valid.');
    }
  } else {
    throw new Error('Jenis token tidak diizinkan.');
  }

  return payload;
}

function requireGatewayAndToken(req, res, next) {
  const gatewaySecret = req.get('X-Gateway-Secret');

  if (!secretMatches(gatewaySecret, process.env.GATEWAY_SECRET)) {
    return res.status(403).json({
      error: 'Akses wajib melalui gateway.'
    });
  }

  const authorization = req.get('Authorization') || '';
  const match = authorization.match(/^Bearer ([^\s]+)$/i);

  if (!match) {
    return res.status(401).json({
      error: 'Bearer token wajib disertakan.'
    });
  }

  try {
    req.auth = verifyToken(match[1]);
    return next();
  } catch {
    return res.status(401).json({
      error: 'Token tidak valid atau sudah kedaluwarsa.'
    });
  }
}

module.exports = {
  JWT_ISSUER,
  JWT_AUDIENCE,
  secretMatches,
  verifyToken,
  requireGatewayAndToken
};
