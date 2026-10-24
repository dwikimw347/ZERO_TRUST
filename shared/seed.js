const bcrypt = require('bcryptjs');
const db = require('./database');

const accounts = [
  {
    id: 1, username: 'admin', name: 'Admin',
    role: 'admin', nim: null, device: 'device-admin'
  },
  {
    id: 2, username: 'dosen1', name: 'Dosen Satu',
    role: 'dosen', nim: null, device: 'device-dosen1'
  },
  {
    id: 3, username: 'dosen2', name: 'Dosen Dua',
    role: 'dosen', nim: null, device: 'device-dosen2'
  },
  {
    id: 4, username: 'mhs1', name: 'Mahasiswa Satu',
    role: 'mahasiswa', nim: '230001', device: 'device-mhs1'
  },
  {
    id: 5, username: 'mhs2', name: 'Mahasiswa Dua',
    role: 'mahasiswa', nim: '230002', device: 'device-mhs2'
  },
  {
    id: 6, username: 'mhs3', name: 'Mahasiswa Tiga',
    role: 'mahasiswa', nim: '230003', device: 'device-mhs3'
  }
];

try {
  const count = db.prepare(
    'SELECT COUNT(*) AS total FROM users'
  ).get().total;

  if (count > 0) {
    console.log(
      'Database sudah berisi akun. Seed dilewati agar data tetap terjaga.'
    );
  } else {
    const passwordHash = bcrypt.hashSync('Demo123!', 12);

    const seed = db.transaction(() => {
      const insertUser = db.prepare(`
        INSERT INTO users
          (id, username, password_hash, name, role, nim)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const insertDevice = db.prepare(`
        INSERT INTO devices (user_id, device_id)
        VALUES (?, ?)
      `);

      for (const account of accounts) {
        insertUser.run(
          account.id,
          account.username,
          passwordHash,
          account.name,
          account.role,
          account.nim
        );

        insertDevice.run(account.id, account.device);
      }

      const insertClass = db.prepare(`
        INSERT INTO classes (id, code, name, lecturer_id)
        VALUES (?, ?, ?, ?)
      `);

      insertClass.run(
        1, 'KI-E', 'Keamanan Informasi - E', 2
      );

      insertClass.run(
        2, 'BD-E', 'Basis Data - E', 3
      );

      const insertGrade = db.prepare(`
        INSERT INTO grades (id, class_id, student_id, score)
        VALUES (?, ?, ?, ?)
      `);

      const grades = [
        [1, 1, 4, 80],
        [2, 1, 5, 75],
        [3, 1, 6, 85],
        [4, 2, 4, 78],
        [5, 2, 5, 82],
        [6, 2, 6, 90]
      ];

      for (const grade of grades) {
        insertGrade.run(...grade);
      }
    });

    seed();
    console.log('Seed berhasil. Password seluruh akun demo: Demo123!');
  }

  const users = db.prepare(`
    SELECT
      u.username,
      u.role,
      u.nim,
      d.device_id
    FROM users u
    JOIN devices d ON d.user_id = u.id
    ORDER BY u.id
  `).all();

  console.table(users);

  const classes = db.prepare(`
    SELECT
      c.id,
      c.code,
      c.name,
      u.username AS dosen,
      c.is_final
    FROM classes c
    JOIN users u ON u.id = c.lecturer_id
    ORDER BY c.id
  `).all();

  console.table(classes);

  const grades = db.prepare(`
    SELECT COUNT(*) AS total FROM grades
  `).get();

  console.log('Jumlah data nilai:', grades.total);
} catch (error) {
  console.error('Seed gagal:', error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
