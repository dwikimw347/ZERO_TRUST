const db = require('../shared/database');
const { verifyToken } = require('../shared/security');

const startHour = Number(process.env.ACCESS_START_HOUR ?? 7);
const endHour = Number(process.env.ACCESS_END_HOUR ?? 21);

if (
  !Number.isInteger(startHour) ||
  !Number.isInteger(endHour) ||
  startHour < 0 ||
  endHour > 24 ||
  startHour >= endHour
) {
  throw new Error('Rentang jam akses tidak valid.');
}

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: process.env.TZ || 'Asia/Jakarta',
  hour: '2-digit',
  hourCycle: 'h23'
});

function withinAccessHours() {
  const hour = Number(
    clock.formatToParts(new Date()).find(p => p.type === 'hour').value
  );

  return hour >= startHour && hour < endHour;
}

function deny(status, reason) {
  return { allow: false, status, reason };
}

function allow(target, reason) {
  return { allow: true, target, reason };
}

function evaluate(req) {
  const method = req.method;
  const path = req.path;

  const readGrades = method === 'GET' && path === '/nilai';
  const updateGrade = method === 'PUT'
    && path.match(/^\/nilai\/([1-9]\d*)$/);
  const finalizeClass = method === 'POST'
    && path.match(/^\/kelas\/([1-9]\d*)\/finalisasi$/);
  const readTranscript = method === 'GET'
    && path.match(/^\/transkrip\/(\d+)$/);
  const syncTranscript = method === 'POST'
    && path === '/transkrip/sinkron';

  if (!(
    readGrades || updateGrade || finalizeClass ||
    readTranscript || syncTranscript
  )) {
    return deny(404, 'Endpoint atau metode tidak tersedia.');
  }

  const match = (req.get('Authorization') || '')
    .match(/^Bearer ([^\s]+)$/i);

  if (!match) {
    return deny(401, 'Bearer token wajib disertakan.');
  }

  let auth;

  try {
    auth = verifyToken(match[1]);
  } catch {
    return deny(401, 'Token tidak valid atau sudah kedaluwarsa.');
  }

  req.auth = auth;
  req.auditSubject = `${auth.role === 'service' ? 'service' : 'user'}:${auth.sub}`;

  // Identitas service hanya boleh mengakses sinkronisasi.
  if (auth.role === 'service') {
    if (!syncTranscript) {
      return deny(403, 'Token service hanya boleh melakukan sinkronisasi.');
    }

    return allow('transkrip', 'Identitas Service Nilai valid.');
  }

  const user = db.prepare(
    'SELECT id, role, nim FROM users WHERE id = ?'
  ).get(auth.sub);

  if (!user || user.role !== auth.role) {
    return deny(403, 'Identitas atau role tidak sesuai database.');
  }

  const device = req.get('X-Device-ID');

  if (!device || device !== auth.device_id) {
    return deny(403, 'Device tidak sesuai dengan access token.');
  }

  const registered = db.prepare(`
    SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?
  `).get(user.id, device);

  if (!registered) {
    return deny(403, 'Device tidak terdaftar untuk user ini.');
  }

  if (syncTranscript) {
    return deny(403, 'Sinkronisasi hanya menerima token service.');
  }

  if (readGrades) {
    if (!['mahasiswa', 'dosen'].includes(user.role)) {
      return deny(403, 'Role tidak diizinkan membaca nilai.');
    }

    return allow(
      'nilai',
      'Akses nilai diizinkan; hasil wajib dibatasi sesuai kepemilikan.'
    );
  }

  if (readTranscript) {
    const requestedNim = readTranscript[1];

    if (
      user.role === 'admin' ||
      (user.role === 'mahasiswa' && user.nim === requestedNim)
    ) {
      return allow('transkrip', 'Hak akses transkrip sesuai.');
    }

    return deny(403, 'Tidak berhak melihat transkrip ini.');
  }

  if (user.role !== 'dosen') {
    return deny(403, 'Hanya dosen yang boleh mengubah atau memfinalisasi nilai.');
  }

  let kelas;

  if (updateGrade) {
    kelas = db.prepare(`
      SELECT c.*
      FROM grades g
      JOIN classes c ON c.id = g.class_id
      WHERE g.id = ?
    `).get(updateGrade[1]);
  } else {
    kelas = db.prepare(
      'SELECT * FROM classes WHERE id = ?'
    ).get(finalizeClass[1]);
  }

  if (!kelas) {
    return deny(404, 'Data tidak ditemukan.');
  }

  if (kelas.lecturer_id !== user.id) {
    return deny(403, 'Dosen bukan pengampu kelas ini.');
  }

  if (updateGrade && kelas.is_final === 1) {
    return deny(403, 'Nilai sudah final dan tidak boleh diubah.');
  }

  if (!withinAccessHours()) {
    return deny(403, 'Di luar jam perubahan dan finalisasi nilai.');
  }

  return allow(
    'nilai',
    updateGrade
      ? 'Dosen pengampu, nilai belum final, dan jam akses sesuai.'
      : 'Dosen pengampu dan jam akses sesuai.'
  );
}

module.exports = { evaluate, withinAccessHours };
