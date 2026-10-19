// Verzio: v0.4.0 - 2026-10-19
// Bemenet-ellenőrző segédek. Hiba esetén HttpError-t dobnak, amit a központi hibakezelő ad vissza.
'use strict';

const config = require('../config');

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function email(v) {
  const e = String(v || '').trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) throw new HttpError(400, 'Érvénytelen e-mail cím.');
  return e;
}

function password(v) {
  const p = String(v || '');
  if (p.length < config.passwordMinLength) {
    throw new HttpError(400, `A jelszó legalább ${config.passwordMinLength} karakter legyen.`);
  }
  if (p.length > 256) throw new HttpError(400, 'A jelszó túl hosszú.');
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (kinds < 2 && p.length < 16) {
    throw new HttpError(400, 'A jelszó legyen változatosabb (kis- és nagybetű, szám vagy írásjel), vagy legalább 16 karakter.');
  }
  return p;
}

function text(v, { max = 100, min = 0, field = 'Mező' } = {}) {
  const s = String(v ?? '').trim();
  if (s.length < min) throw new HttpError(400, `${field}: túl rövid.`);
  if (s.length > max) throw new HttpError(400, `${field}: túl hosszú (max. ${max}).`);
  return s;
}

function number(v, { min = -Infinity, max = Infinity, field = 'Szám' } = {}) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${field}: érvénytelen érték.`);
  return n;
}

function totpCode(v) {
  const c = String(v || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c) && !/^[0-9a-f]{4}-?[0-9a-f]{4}$/i.test(c)) throw new HttpError(400, 'Érvénytelen kód.');
  return c;
}

// async route-hibák továbbítása a hibakezelőnek (Express 5 ezt már magától is kezeli, de így egyértelmű)
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, email, password, text, number, totpCode, wrap };
