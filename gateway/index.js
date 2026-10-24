const express = require('express');
const db = require('../shared/database');
const { respond } = require('./audit');
const authRouter = require('./auth');

const app = express();
app.disable('x-powered-by');

// Parser JSON hanya untuk endpoint autentikasi.
app.use(
  '/auth',
  express.json({ limit: '16kb' }),
  authRouter
);

app.use(require('./resources'));
app.use((req, res) => {
  return respond(req, res, 404, 'Endpoint tidak tersedia.');
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.type === 'entity.parse.failed') {
    return respond(req, res, 400, 'Format JSON tidak valid.');
  }

  if (err.type === 'entity.too.large') {
    return respond(req, res, 413, 'Body request terlalu besar.');
  }

  console.error('Gateway error:', err.message);

  try {
    return respond(req, res, 500, 'Kesalahan internal gateway.');
  } catch (auditError) {
    console.error('Audit gagal:', auditError.message);
    return res.status(500).json({
      error: 'Kesalahan internal gateway.'
    });
  }
});

const port = Number(process.env.GATEWAY_PORT || 3000);

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Gateway aktif: http://127.0.0.1:${port}`);
});

server.on('error', (err) => {
  console.error('Gateway gagal dijalankan:', err.message);
  db.close();
  process.exitCode = 1;
});

