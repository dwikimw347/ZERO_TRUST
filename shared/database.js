const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });

const Database = require('better-sqlite3');
const dbPath = path.resolve(
  root,
  process.env.DB_PATH || './data/zero-trust.db'
);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL
      CHECK (role IN ('admin', 'dosen', 'mahasiswa')),
    nim TEXT UNIQUE,
    CHECK (
      (role = 'mahasiswa' AND nim IS NOT NULL)
      OR (role IN ('admin', 'dosen') AND nim IS NULL)
    )
  );

  CREATE TABLE IF NOT EXISTS devices (
    user_id INTEGER NOT NULL REFERENCES users(id),
    device_id TEXT NOT NULL,
    PRIMARY KEY (user_id, device_id)
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    lecturer_id INTEGER NOT NULL REFERENCES users(id),
    is_final INTEGER NOT NULL DEFAULT 0
      CHECK (is_final IN (0, 1)),
    finalized_at TEXT
  );

  CREATE TABLE IF NOT EXISTS grades (
    id INTEGER PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id),
    student_id INTEGER NOT NULL REFERENCES users(id),
    score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (class_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    id INTEGER PRIMARY KEY,
    grade_id INTEGER NOT NULL UNIQUE REFERENCES grades(id),
    student_id INTEGER NOT NULL REFERENCES users(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
    synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (class_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id, device_id)
      REFERENCES devices(user_id, device_id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    subject TEXT NOT NULL,
    method TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    device_id TEXT,
    decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
    reason TEXT NOT NULL
  );
`);

module.exports = db;
