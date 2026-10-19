// Verzio: v2.0.0 - 2026-10-19
// Kriptográfiai segédfüggvények: tokenek, hash, jelszó (argon2id), 2FA-titok titkosítás.
'use strict';

const crypto = require('crypto');
const argon2 = require('@node-rs/argon2');
const config = require('../config');

const ARGON_OPTS = { algorithm: 2 /* argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 };

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function hashPassword(password) {
  return argon2.hash(password, ARGON_OPTS);
}

// Időzítés-egyenletesítéshez: nem létező felhasználónál is lefut egy ellenőrzés
let dummyHash = null;
async function verifyPassword(hash, password) {
  if (!hash) {
    if (!dummyHash) dummyHash = await argon2.hash('dummy-password-for-timing', ARGON_OPTS);
    await argon2.verify(dummyHash, String(password)).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(hash, String(password));
  } catch {
    return false;
  }
}

// 2FA titkok titkosítása nyugalmi állapotban (AES-256-GCM, kulcs az APP_SECRET-ből)
const encKey = crypto.createHash('sha256').update('cyc-totp:' + config.appSecret).digest();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString('base64url')).join('.');
}

function decrypt(packed) {
  const [iv, tag, data] = String(packed).split('.').map((s) => Buffer.from(s, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { randomToken, sha256, safeEqual, hashPassword, verifyPassword, encrypt, decrypt };
