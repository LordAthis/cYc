#!/usr/bin/env node
// Verzio: v2.0.0 - 2026-10-19
// Online adatbázis-mentés (futó szerver mellett is biztonságos). A mentések a data/backups mappába kerülnek,
// a 14 napnál régebbieket törli. Cron példa (naponta 3:15-kor):
//   15 3 * * * cd /opt/cyc/server && /usr/bin/node scripts/backup.js >> data/backup.log 2>&1
'use strict';

const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');
const config = require('../src/config');

const dir = path.join(path.dirname(config.dbFile), 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const target = path.join(dir, `cyc-${stamp}.sqlite`);

db.backup(target).then(() => {
  console.log(`[cYc] Mentes kesz: ${target}`);
  const limit = Date.now() - 14 * 864e5;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f.endsWith('.sqlite') && fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p);
  }
  process.exit(0);
}).catch((e) => { console.error('[cYc] Mentes HIBA:', e.message); process.exit(1); });
