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

app.get('/transkrip/:nim', (req, res) => {
  if (req.auth.token_type !== 'access') {
    return res.status(403).json({ error: 'Membutuhkan token user.' });
  }

  const user = db.prepare(
    'SELECT id, role, nim FROM users WHERE id = ?'
  ).get(req.auth.sub);

  if (
    !user ||
    user.role !== req.auth.role ||
    !(
      user.role === 'admin' ||
      (user.role === 'mahasiswa' && user.nim === req.params.nim)
    )
  ) {
    return res.status(403).json({
      error: 'Tidak berhak melihat transkrip ini.'
    });
  }

  const student = db.prepare(`
    SELECT id, nim, name FROM users
    WHERE nim = ? AND role = 'mahasiswa'
  `).get(req.params.nim);

  if (!student) {
    return res.status(404).json({ error: 'Mahasiswa tidak ditemukan.' });
  }

  const rows = db.prepare(`
    SELECT
      t.id,
      c.code AS class_code,
      c.name AS class_name,
      t.score,
      t.synced_at
    FROM transcripts t
    JOIN classes c ON c.id = t.class_id
    WHERE t.student_id = ?
    ORDER BY c.id
  `).all(student.id);

  return res.json({ student, data: rows });
});

// Data transkrip diambil dari database, bukan nilai kiriman client.
const synchronize = db.transaction((classId) => {
  const kelas = db.prepare(
    'SELECT * FROM classes WHERE id = ?'
  ).get(classId);

  if (!kelas || kelas.is_final !== 1) {
    return null;
  }

  const grades = db.prepare(
    'SELECT * FROM grades WHERE class_id = ?'
  ).all(classId);

  const upsert = db.prepare(`
    INSERT INTO transcripts
      (grade_id, student_id, class_id, score)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(grade_id) DO UPDATE SET
      score = excluded.score,
      synced_at = CURRENT_TIMESTAMP
  `);

  for (const grade of grades) {
    upsert.run(
      grade.id,
      grade.student_id,
      grade.class_id,
      grade.score
    );
  }

  return grades.length;
});

app.post('/transkrip/sinkron', (req, res) => {
  if (
    req.auth.token_type !== 'service' ||
    req.auth.role !== 'service' ||
    req.auth.sub !== process.env.SERVICE_CLIENT_ID
  ) {
    return res.status(403).json({
      error: 'Sinkronisasi hanya untuk Service Nilai.'
    });
  }

  const classId = req.body?.class_id;

  if (!Number.isSafeInteger(classId) || classId <= 0) {
    return res.status(400).json({
      error: 'class_id harus berupa bilangan bulat positif.'
    });
  }

  const count = synchronize.immediate(classId);

  if (count === null) {
    return res.status(409).json({
      error: 'Kelas tidak tersedia atau belum difinalisasi.'
    });
  }

  return res.json({
    message: 'Transkrip berhasil disinkronkan.',
    class_id: classId,
    synced: count
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tidak tersedia.' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  console.error('Service Transkrip:', err.message);

  const status = err.type === 'entity.parse.failed' ? 400
    : err.type === 'entity.too.large' ? 413 : 500;

  res.status(status).json({
    error: status === 400 ? 'JSON tidak valid.'
      : status === 413 ? 'Body terlalu besar.'
      : 'Kesalahan internal Service Transkrip.'
  });
});

const port = Number(process.env.TRANSKRIP_PORT || 3002);

app.listen(port, '127.0.0.1', () => {
  console.log(`Service Transkrip aktif: http://127.0.0.1:${port}`);
});
