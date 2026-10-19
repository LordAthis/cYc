// Verzio: v2.0.0 - 2026-10-19
// Saját, adatbázis-alapú munkamenet-kezelés + CSRF-védelem + jogosultság-ellenőrző middleware-ek.
// A sütiben csak egy véletlen azonosító van; az adatbázisban ennek SHA-256 hash-e tárolódik.
'use strict';

const config = require('../config');
const { db } = require('../db');
const { randomToken, sha256, safeEqual } = require('./security');

const DAY = 864e5;
const MFA_STAGE_MS = 10 * 60e3; // a 2FA-kódra 10 perc van

const qGet = db.prepare('SELECT * FROM sessions WHERE id_hash = ? AND expires_at > ?');
const qUser = db.prepare('SELECT * FROM users WHERE id = ?');
const qTouch = db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id_hash = ?');
const qInsert = db.prepare(`INSERT INTO sessions (id_hash, user_id, stage, csrf, created_at, expires_at, last_seen, ip, user_agent)
  VALUES (@id_hash, @user_id, @stage, @csrf, @now, @expires_at, @now, @ip, @ua)`);
const qDelete = db.prepare('DELETE FROM sessions WHERE id_hash = ?');

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: config.session.secureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || '';
}

// Minden kérésnél: süti -> munkamenet -> felhasználó
function loadSession(req, res, next) {
  req.session = null;
  req.user = null;
  const raw = req.cookies && req.cookies[config.session.cookieName];
  if (!raw || raw.length > 200) return next();

  const now = Date.now();
  const idHash = sha256(raw);
  const s = qGet.get(idHash, now);
  if (!s) {
    res.clearCookie(config.session.cookieName, cookieOptions(0));
    return next();
  }
  const user = qUser.get(s.user_id);
  if (!user || user.disabled) {
    qDelete.run(idHash);
    res.clearCookie(config.session.cookieName, cookieOptions(0));
    return next();
  }

  req.session = { idHash, userId: s.user_id, stage: s.stage, csrf: s.csrf };
  if (s.stage === 'full') {
    req.user = user;
    // Csúszó lejárat: legfeljebb 5 percenként írunk az adatbázisba
    if (now - s.last_seen > 5 * 60e3) {
      const exp = now + config.session.days * DAY;
      qTouch.run(now, exp, idHash);
      res.cookie(config.session.cookieName, raw, cookieOptions(config.session.days * DAY));
    }
  } else {
    req.pendingUser = user; // 2FA-ra váró felhasználó
  }
  next();
}

// Új munkamenet (bejelentkezéskor mindig új azonosító -> session fixation ellen)
function createSession(req, res, userId, stage = 'full') {
  if (req.session) qDelete.run(req.session.idHash);
  const raw = randomToken(32);
  const now = Date.now();
  const ttl = stage === 'full' ? config.session.days * DAY : MFA_STAGE_MS;
  const csrf = randomToken(24);
  qInsert.run({
    id_hash: sha256(raw),
    user_id: userId,
    stage,
    csrf,
    now,
    expires_at: now + ttl,
    ip: clientIp(req).slice(0, 64),
    ua: String(req.get('user-agent') || '').slice(0, 300),
  });
  res.cookie(config.session.cookieName, raw, cookieOptions(ttl));
  req.session = { idHash: sha256(raw), userId, stage, csrf };
  return csrf;
}

function destroySession(req, res) {
  if (req.session) qDelete.run(req.session.idHash);
  res.clearCookie(config.session.cookieName, cookieOptions(0));
  req.session = null;
  req.user = null;
}

function destroyAllSessions(userId, exceptIdHash) {
  if (exceptIdHash) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?').run(userId, exceptIdHash);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

// CSRF: módosító kéréseknél az Origin (vagy Referer) a saját domain kell legyen,
// és ha van munkamenet, az X-CSRF-Token fejlécnek egyeznie kell.
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  let source = origin;
  if (!source && referer) {
    try { source = new URL(referer).origin; } catch { source = null; }
  }
  if (source) {
    if (source !== config.appOrigin) return res.status(403).json({ error: 'Érvénytelen kérés forrása.' });
  } else if (config.isProd) {
    return res.status(403).json({ error: 'Hiányzó kérés-forrás.' });
  }

  if (req.session) {
    const token = req.get('x-csrf-token') || '';
    if (!safeEqual(token, req.session.csrf)) {
      return res.status(403).json({ error: 'Lejárt vagy érvénytelen biztonsági token. Frissítsd az oldalt.', code: 'CSRF' });
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Bejelentkezés szükséges.', code: 'AUTH' });
  next();
}

function requireAdmin(req, res, next) {
  // Nem jogosultnak 404, hogy kívülről ne derüljön ki a végpont létezése
  if (!req.user || req.user.role !== 'admin') return res.status(404).json({ error: 'Nem található.' });
  next();
}

module.exports = {
  loadSession, createSession, destroySession, destroyAllSessions,
  csrfProtect, requireAuth, requireAdmin, clientIp,
};
