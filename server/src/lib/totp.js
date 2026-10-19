// Verzio: v0.4.0 - 2026-10-19
// Kétlépcsős azonosítás (TOTP, RFC 6238) + egyszer használatos visszaállító kódok.
'use strict';

const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { db } = require('../db');
const { encrypt, decrypt, sha256 } = require('./security');

authenticator.options = { window: 1, step: 30, digits: 6 };

// Ugyanaz a kód ne legyen kétszer felhasználható (visszajátszás ellen)
const lastUsed = new Map();

function newSecret() {
  return authenticator.generateSecret(20);
}

async function setupData(email, secret) {
  const otpauthUrl = authenticator.keyuri(email, 'cYc', secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  return { otpauthUrl, qrDataUrl, secret };
}

function checkTotp(user, code) {
  if (!user.totp_secret || !/^\d{6}$/.test(code)) return false;
  let secret;
  try { secret = decrypt(user.totp_secret); } catch { return false; }
  if (!authenticator.check(code, secret)) return false;
  const key = `${user.id}:${code}`;
  const now = Date.now();
  if (lastUsed.has(key) && now - lastUsed.get(key) < 90e3) return false;
  lastUsed.set(key, now);
  for (const [k, t] of lastUsed) if (now - t > 90e3) lastUsed.delete(k);
  return true;
}

function generateRecoveryCodes(userId) {
  const codes = [];
  const del = db.prepare('DELETE FROM recovery_codes WHERE user_id = ?');
  const ins = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
  db.transaction(() => {
    del.run(userId);
    for (let i = 0; i < 10; i++) {
      const hex = crypto.randomBytes(4).toString('hex');
      const code = `${hex.slice(0, 4)}-${hex.slice(4)}`;
      codes.push(code);
      ins.run(userId, sha256(code.replace('-', '')));
    }
  })();
  return codes;
}

function useRecoveryCode(userId, code) {
  const norm = String(code).toLowerCase().replace(/[^0-9a-f]/g, '');
  if (norm.length !== 8) return false;
  const row = db.prepare('SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used = 0').get(userId, sha256(norm));
  if (!row) return false;
  db.prepare('UPDATE recovery_codes SET used = 1 WHERE id = ?').run(row.id);
  return true;
}

// 6 számjegy -> TOTP, egyébként visszaállító kód
function verifySecondFactor(user, code) {
  const c = String(code || '').replace(/\s+/g, '');
  if (/^\d{6}$/.test(c)) return checkTotp(user, c) ? 'totp' : false;
  return useRecoveryCode(user.id, c) ? 'recovery' : false;
}

function remainingRecoveryCodes(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used = 0').get(userId).n;
}

module.exports = { newSecret, setupData, checkTotp, verifySecondFactor, generateRecoveryCodes, remainingRecoveryCodes, encrypt };
