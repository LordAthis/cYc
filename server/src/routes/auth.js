// Verzio: v0.4.0 - 2026-10-19
// Regisztráció, e-mail megerősítés, bejelentkezés (jelszó + captcha, Google), 2FA lépés,
// kijelentkezés, elfelejtett jelszó.
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');

const config = require('../config');
const { db, audit } = require('../db');
const v = require('../lib/validate');
const { HttpError, wrap } = v;
const { randomToken, sha256, hashPassword, verifyPassword } = require('../lib/security');
const { createSession, destroySession, destroyAllSessions, clientIp } = require('../lib/session');
const { verifyCaptcha } = require('../lib/captcha');
const mailer = require('../lib/mailer');
const { verifySecondFactor } = require('../lib/totp');

const router = express.Router();
const googleClient = config.google.clientId ? new OAuth2Client(config.google.clientId) : null;

// IP-alapú korlát az érzékeny végpontokra
const authLimiter = rateLimit({
  windowMs: 15 * 60e3,
  limit: config.isProd ? 30 : 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Túl sok próbálkozás. Próbáld újra néhány perc múlva.' },
});
const mailLimiter = rateLimit({
  windowMs: 60 * 60e3,
  limit: config.isProd ? 8 : 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Túl sok e-mail kérés. Próbáld újra később.' },
});

const LOCK_AFTER = 5;          // ennyi hibás jelszó után zárolás
const LOCK_MS = 15 * 60e3;

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name || '',
    emailVerified: !!u.email_verified,
    role: u.role,
    hasPassword: !!u.password_hash,
    googleLinked: !!u.google_sub,
    totpEnabled: !!u.totp_enabled,
    hiddenAccess: !!u.hidden_access,
    createdAt: u.created_at,
  };
}

async function requireCaptcha(req) {
  const ok = await verifyCaptcha(req.body && req.body.captcha, clientIp(req));
  if (!ok) throw new HttpError(400, 'A captcha ellenőrzés sikertelen. Próbáld újra.', 'CAPTCHA');
}

function issueToken(userId, purpose, ttlMs) {
  db.prepare('UPDATE tokens SET used = 1 WHERE user_id = ? AND purpose = ? AND used = 0').run(userId, purpose);
  const raw = randomToken(32);
  db.prepare('INSERT INTO tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(raw), userId, purpose, Date.now() + ttlMs);
  return raw;
}

function consumeToken(raw, purpose) {
  if (!raw || typeof raw !== 'string' || raw.length > 100) return null;
  const row = db.prepare('SELECT * FROM tokens WHERE token_hash = ? AND purpose = ? AND used = 0 AND expires_at > ?')
    .get(sha256(raw), purpose, Date.now());
  if (!row) return null;
  db.prepare('UPDATE tokens SET used = 1 WHERE token_hash = ?').run(row.token_hash);
  return row;
}

// Sikeres első lépés után: 2FA-ra vár, vagy teljes belépés
function finishLogin(req, res, user, method) {
  if (user.totp_enabled) {
    const csrf = createSession(req, res, user.id, 'mfa');
    audit(user.id, 'login_mfa_pending', clientIp(req), method);
    return res.json({ ok: true, mfaRequired: true, csrf });
  }
  const csrf = createSession(req, res, user.id, 'full');
  db.prepare('UPDATE users SET last_login_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').run(Date.now(), user.id);
  audit(user.id, 'login', clientIp(req), method);
  return res.json({ ok: true, user: publicUser(user), csrf });
}

// --- Állapot -------------------------------------------------------------

router.get('/me', (req, res) => {
  res.set('cache-control', 'no-store');
  const u = req.user;
  // A rejtett felület és az admin útvonala csak annak kerül a válaszba, aki jogosult rá
  const links = {};
  if (u && (u.hidden_access || u.role === 'admin')) links.hidden = config.hiddenPath + '/';
  if (u && u.role === 'admin') links.admin = config.adminPath + '/';
  res.json({
    user: publicUser(u),
    mfaPending: !!(req.session && req.session.stage === 'mfa'),
    csrf: req.session ? req.session.csrf : null,
    links,
  });
});

// --- Regisztráció ----------------------------------------------------------

router.post('/register', authLimiter, wrap(async (req, res) => {
  if (!config.registrationEnabled) throw new HttpError(403, 'A regisztráció jelenleg szünetel.');
  await requireCaptcha(req);
  const email = v.email(req.body.email);
  const password = v.password(req.body.password);
  const displayName = v.text(req.body.displayName, { max: 60, field: 'Név' });
  if (req.body.acceptTerms !== true) throw new HttpError(400, 'A felhasználási feltételek elfogadása kötelező.');

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    // Nem áruljuk el, hogy a cím foglalt; ha még nincs megerősítve, új linket küldünk
    if (!existing.email_verified) {
      const t = issueToken(existing.id, 'verify', 24 * 3600e3);
      await mailer.sendVerification(email, `${config.appOrigin}/verify.html?token=${t}`);
    }
    return res.json({ ok: true, verificationSent: true });
  }

  const hash = await hashPassword(password);
  const verified = config.requireEmailVerification ? 0 : 1;
  const info = db.prepare(`INSERT INTO users (email, password_hash, display_name, email_verified, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(email, hash, displayName || null, verified, Date.now());
  const userId = info.lastInsertRowid;
  audit(userId, 'register', clientIp(req));

  if (config.requireEmailVerification) {
    const t = issueToken(userId, 'verify', 24 * 3600e3);
    await mailer.sendVerification(email, `${config.appOrigin}/verify.html?token=${t}`);
    return res.json({ ok: true, verificationSent: true });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return finishLogin(req, res, user, 'register');
}));

router.post('/verify', authLimiter, wrap(async (req, res) => {
  const row = consumeToken(req.body.token, 'verify');
  if (!row) throw new HttpError(400, 'A megerősítő link érvénytelen vagy lejárt.');
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);
  audit(row.user_id, 'email_verified', clientIp(req));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (user.disabled) throw new HttpError(403, 'A fiók le van tiltva.');
  return finishLogin(req, res, user, 'verify');
}));

router.post('/resend-verification', mailLimiter, wrap(async (req, res) => {
  await requireCaptcha(req);
  const email = v.email(req.body.email);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user && !user.email_verified && !user.disabled) {
    const t = issueToken(user.id, 'verify', 24 * 3600e3);
    await mailer.sendVerification(email, `${config.appOrigin}/verify.html?token=${t}`);
  }
  res.json({ ok: true });
}));

// --- Bejelentkezés ---------------------------------------------------------

router.post('/login', authLimiter, wrap(async (req, res) => {
  await requireCaptcha(req);
  const email = v.email(req.body.email);
  const password = String(req.body.password || '').slice(0, 256);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const now = Date.now();

  if (user && user.locked_until && user.locked_until > now) {
    const min = Math.ceil((user.locked_until - now) / 60e3);
    throw new HttpError(429, `Túl sok hibás próbálkozás. A fiók ${min} percig zárolva.`);
  }

  const ok = await verifyPassword(user && user.password_hash, password);
  if (!user || !ok) {
    if (user) {
      const fails = user.failed_logins + 1;
      const lock = fails >= LOCK_AFTER ? now + LOCK_MS * Math.min(8, 2 ** (fails - LOCK_AFTER)) : null;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(fails, lock, user.id);
      audit(user.id, 'login_failed', clientIp(req));
    }
    throw new HttpError(401, 'Hibás e-mail cím vagy jelszó.');
  }
  if (user.disabled) throw new HttpError(403, 'A fiók le van tiltva.');
  if (!user.email_verified && config.requireEmailVerification) {
    throw new HttpError(403, 'Az e-mail cím még nincs megerősítve. Nézd meg a postafiókodat (a levélszemét mappát is).', 'UNVERIFIED');
  }
  return finishLogin(req, res, user, 'password');
}));

router.post('/login/2fa', authLimiter, wrap(async (req, res) => {
  if (!req.session || req.session.stage !== 'mfa' || !req.pendingUser) {
    throw new HttpError(400, 'Nincs folyamatban lévő bejelentkezés. Kezdd újra.', 'NO_MFA');
  }
  const user = req.pendingUser;
  const code = v.totpCode(req.body.code);
  const method = verifySecondFactor(user, code);
  if (!method) {
    const fails = user.failed_logins + 1;
    db.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').run(fails, user.id);
    audit(user.id, 'mfa_failed', clientIp(req));
    if (fails >= LOCK_AFTER * 2) {
      db.prepare('UPDATE users SET locked_until = ? WHERE id = ?').run(Date.now() + LOCK_MS, user.id);
      destroySession(req, res);
    }
    throw new HttpError(401, 'Hibás kód.');
  }
  const csrf = createSession(req, res, user.id, 'full');
  db.prepare('UPDATE users SET last_login_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').run(Date.now(), user.id);
  audit(user.id, 'login', clientIp(req), 'mfa:' + method);
  if (method === 'recovery') mailer.sendSecurityNotice(user.email, 'visszaállító kóddal történt bejelentkezés').catch(() => {});
  res.json({ ok: true, user: publicUser(user), csrf, usedRecoveryCode: method === 'recovery' });
}));

// Google bejelentkezés (Google Identity Services ID token)
async function verifyGoogle(credential) {
  if (!googleClient) throw new HttpError(400, 'A Google bejelentkezés nincs bekapcsolva.');
  if (!credential || typeof credential !== 'string' || credential.length > 4096) throw new HttpError(400, 'Hiányzó Google azonosító.');
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.google.clientId });
    const p = ticket.getPayload();
    if (!p || !p.sub || !p.email) throw new Error('hianyos payload');
    return p;
  } catch (e) {
    throw new HttpError(401, 'A Google azonosítás sikertelen.');
  }
}

router.post('/google', authLimiter, wrap(async (req, res) => {
  const p = await verifyGoogle(req.body.credential);
  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(p.sub);

  if (!user) {
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(p.email.toLowerCase());
    if (byEmail) {
      if (!p.email_verified) throw new HttpError(400, 'A Google fiók e-mail címe nincs megerősítve.');
      // Ha a meglévő fiók címe sosem lett megerősítve, a régi (ismeretlen eredetű) jelszót töröljük
      const dropPw = !byEmail.email_verified;
      db.prepare(`UPDATE users SET google_sub = ?, email_verified = 1 ${dropPw ? ', password_hash = NULL' : ''} WHERE id = ?`)
        .run(p.sub, byEmail.id);
      audit(byEmail.id, 'google_linked', clientIp(req), dropPw ? 'auto, jelszo torolve' : 'auto');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(byEmail.id);
    } else {
      if (!config.registrationEnabled) throw new HttpError(403, 'A regisztráció jelenleg szünetel.');
      if (req.body.acceptTerms !== true) {
        return res.status(400).json({ error: 'Új fiók létrehozásához fogadd el a felhasználási feltételeket.', code: 'TERMS' });
      }
      const info = db.prepare(`INSERT INTO users (email, google_sub, display_name, email_verified, created_at)
        VALUES (?, ?, ?, 1, ?)`).run(p.email.toLowerCase(), p.sub, (p.name || '').slice(0, 60) || null, Date.now());
      audit(info.lastInsertRowid, 'register', clientIp(req), 'google');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }
  }
  if (user.disabled) throw new HttpError(403, 'A fiók le van tiltva.');
  return finishLogin(req, res, user, 'google');
}));

router.post('/logout', (req, res) => {
  if (req.session) audit(req.session.userId, 'logout', clientIp(req));
  destroySession(req, res);
  res.json({ ok: true });
});

// --- Elfelejtett jelszó ----------------------------------------------------

router.post('/forgot', mailLimiter, wrap(async (req, res) => {
  await requireCaptcha(req);
  const email = v.email(req.body.email);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user && !user.disabled) {
    const t = issueToken(user.id, 'reset', 3600e3);
    await mailer.sendPasswordReset(email, `${config.appOrigin}/reset.html?token=${t}`);
    audit(user.id, 'reset_requested', clientIp(req));
  }
  // Mindig ugyanaz a válasz, hogy ne lehessen e-mail címeket kipuhatolni
  res.json({ ok: true });
}));

router.post('/reset', authLimiter, wrap(async (req, res) => {
  const password = v.password(req.body.password);
  const row = consumeToken(req.body.token, 'reset');
  if (!row) throw new HttpError(400, 'A visszaállító link érvénytelen vagy lejárt.');
  const hash = await hashPassword(password);
  // A link az e-mail cím birtoklását is igazolja
  db.prepare('UPDATE users SET password_hash = ?, email_verified = 1, failed_logins = 0, locked_until = NULL WHERE id = ?')
    .run(hash, row.user_id);
  destroyAllSessions(row.user_id);
  audit(row.user_id, 'password_reset', clientIp(req));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  mailer.sendSecurityNotice(user.email, 'a jelszó vissza lett állítva').catch(() => {});
  res.json({ ok: true });
}));

module.exports = { router, publicUser, verifyGoogle };
