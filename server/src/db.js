// Verzio: v0.4.0 - 2026-10-19
// SQLite adatbázis (better-sqlite3) + egyszerű, verziózott séma-migráció.
'use strict';

const Database = require('better-sqlite3');
const config = require('./config');

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Minden elem egy migráció; a sorrend NEM változhat, új séma-módosítás mindig a végére kerül.
const migrations = [
  `
  CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT,                       -- NULL, ha csak Google-lel lép be
    display_name    TEXT,
    google_sub      TEXT UNIQUE,                -- Google fiók azonosító
    email_verified  INTEGER NOT NULL DEFAULT 0,
    role            TEXT NOT NULL DEFAULT 'user',   -- user | admin
    hidden_access   INTEGER NOT NULL DEFAULT 0,     -- rejtett felület egyedi engedélye
    disabled        INTEGER NOT NULL DEFAULT 0,
    totp_secret     TEXT,                       -- titkosítva (AES-256-GCM)
    totp_enabled    INTEGER NOT NULL DEFAULT 0,
    failed_logins   INTEGER NOT NULL DEFAULT 0,
    locked_until    INTEGER,
    created_at      INTEGER NOT NULL,
    last_login_at   INTEGER
  );

  CREATE TABLE sessions (
    id_hash     TEXT PRIMARY KEY,               -- a süti értékének SHA-256 hash-e
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stage       TEXT NOT NULL DEFAULT 'full',   -- full | mfa (2FA-ra vár)
    csrf        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    ip          TEXT,
    user_agent  TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL,                  -- verify | reset
    expires_at  INTEGER NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE recovery_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE favorites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_cur    TEXT NOT NULL,
    to_cur      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE(user_id, from_cur, to_cur)
  );

  CREATE TABLE holdings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency    TEXT NOT NULL,
    amount      REAL NOT NULL,
    note        TEXT,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_holdings_user ON holdings(user_id);

  CREATE TABLE history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_cur    TEXT NOT NULL,
    to_cur      TEXT NOT NULL,
    amount      REAL NOT NULL,
    result      REAL NOT NULL,
    rate        REAL NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_history_user ON history(user_id, created_at);

  CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,
    event       TEXT NOT NULL,
    ip          TEXT,
    detail      TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_audit_user ON audit_log(user_id, created_at);
  `,
];

function migrate() {
  const current = db.pragma('user_version', { simple: true });
  for (let i = current; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
    console.log(`[cYc] DB migracio kesz: ${i + 1}`);
  }
}
migrate();

// Lejárt munkamenetek és tokenek takarítása óránként
function cleanup() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM tokens WHERE expires_at < ? OR used = 1').run(now);
  db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(now - 180 * 864e5);
}
cleanup();
setInterval(cleanup, 3600e3).unref();

function audit(userId, event, ip, detail) {
  db.prepare('INSERT INTO audit_log (user_id, event, ip, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId || null, event, ip || null, detail ? String(detail).slice(0, 500) : null, Date.now());
}

module.exports = { db, audit };
