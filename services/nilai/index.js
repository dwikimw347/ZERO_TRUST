const express = require('express');
const db = require('../../shared/database');
const {
  requireGatewayAndToken
} = require('../../shared/security');

const app = express();
app.disable('x-powered-by');

app.use(requireGatewayAndToken);
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Service Nilai hanya melayani mahasiswa dan dosen.
app.use((req, res, next) => {
  if (req.auth.token_type !== 'access') {
    return res.status(403).json({
      error: 'Service ini membutuhkan token user.'
    });
  }

  const user = db.prepare(
    'SELECT id, username, role, nim FROM users WHERE id = ?'
  ).get(req.auth.sub);

  if (
    !user ||
    user.role !== req.auth.role ||
    !['mahasiswa', 'dosen'].includes(user.role)
  ) {
    return res.status(403).json({
      error: 'User tidak berhak mengakses Service Nilai.'
    });
  }

  req.user = user;
  next();
});

app.get('/nilai', (req, res) => {
  // Identitas selalu berasal dari token, bukan query client.
  const condition = req.user.role === 'mahasiswa'
    ? 'g.student_id = ?'
    : 'c.lecturer_id = ?';

  const rows = db.prepare(`
    SELECT
      g.id,
      c.id AS class_id,
      c.code AS class_code,
      c.name AS class_name,
      u.nim,
      u.name AS student_name,
      g.score,
      c.is_final
    FROM grades g
    JOIN classes c ON c.id = g.class_id
    JOIN users u ON u.id = g.student_id
    WHERE ${condition}
    ORDER BY c.id, u.nim
  `).all(req.user.id);

  return res.json({ data: rows });
});

app.put('/nilai/:id', (req, res) => {
  if (req.user.role !== 'dosen') {
    return res.status(403).json({ error: 'Hanya untuk dosen.' });
  }

  const score = req.body?.score;

  if (
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 100
  ) {
    return res.status(400).json({
      error: 'Score harus berupa angka antara 0 dan 100.'
    });
  }

  // Syarat kepemilikan dan status diperiksa saat UPDATE.
  const result = db.prepare(`
    UPDATE grades
    SET score = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND class_id IN (
        SELECT id FROM classes
        WHERE lecturer_id = ? AND is_final = 0
      )
  `).run(score, req.params.id, req.user.id);

  if (result.changes === 0) {
    return res.status(403).json({
      error: 'Nilai tidak tersedia, bukan kelas Anda, atau sudah final.'
    });
  }

  return res.json({ message: 'Nilai berhasil diperbarui.' });
});

async function gatewayPost(endpoint, body, token) {
  const gateway = process.env.GATEWAY_URL || 'http://127.0.0.1:3000';

  const headers = { 'Content-Type': 'application/json' };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${gateway}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error || result.message || 'Panggilan gateway gagal.'
    );
  }

  return result;
}

// Transaksi ini hanya mengunci database saat finalisasi lokal.
// Panggilan jaringan dilakukan setelah transaksi selesai.
const finalize = db.transaction((classId, lecturerId) => {
  const kelas = db.prepare(
    'SELECT * FROM classes WHERE id = ? AND lecturer_id = ?'
  ).get(classId, lecturerId);

  if (!kelas) return null;

  if (!kelas.is_final) {
    db.prepare(`
      UPDATE classes
      SET is_final = 1, finalized_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(kelas.id);
  }

  return kelas;
});

app.post('/kelas/:id/finalisasi', async (req, res, next) => {
  if (req.user.role !== 'dosen') {
    return res.status(403).json({ error: 'Hanya untuk dosen.' });
  }

  let kelas;

  try {
    kelas = finalize.immediate(req.params.id, req.user.id);
  } catch (error) {
    return next(error);
  }

  if (!kelas) {
    return res.status(403).json({
      error: 'Kelas tidak ditemukan atau bukan kelas Anda.'
    });
  }

  try {
    // Meminta token service kepada gateway.
    const credentials = await gatewayPost('/auth/service', {
      client_id: process.env.SERVICE_CLIENT_ID,
      client_secret: process.env.SERVICE_CLIENT_SECRET
    });

    // Sinkronisasi juga melalui gateway, bukan langsung port 3002.
    const sync = await gatewayPost(
      '/transkrip/sinkron',
      { class_id: kelas.id },
      credentials.access_token
    );

    return res.json({
      message: 'Finalisasi dan sinkronisasi transkrip berhasil.',
      class_id: kelas.id,
      synced: sync.synced
    });
  } catch (error) {
    console.error('Sinkronisasi gagal:', error.message);

    return res.status(502).json({
      error: 'Nilai sudah final, tetapi sinkronisasi belum berhasil.',
      class_id: kelas.id,
      is_final: true,
      retry: 'Ulangi endpoint finalisasi untuk mencoba sinkronisasi kembali.'
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tidak tersedia.' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  console.error('Service Nilai:', err.message);

  const status = err.type === 'entity.parse.failed' ? 400
    : err.type === 'entity.too.large' ? 413 : 500;

  res.status(status).json({
    error: status === 400 ? 'JSON tidak valid.'
      : status === 413 ? 'Body terlalu besar.'
      : 'Kesalahan internal Service Nilai.'
  });
});

const port = Number(process.env.NILAI_PORT || 3001);

app.listen(port, '127.0.0.1', () => {
  console.log(`Service Nilai aktif: http://127.0.0.1:${port}`);
});
