// Verzio: v2.0.0 - 2026-10-19
// Fiókbeállítások: profil, jelszó, 2FA be/ki, visszaállító kódok, Google összekapcsolás,
// munkamenetek, adatexport (GDPR), fióktörlés.
'use strict';

const express = require('express');
const config = require('../config');
const { db, audit } = require('../db');
const v = require('../lib/validate');
const { HttpError, wrap } = v;
const { hashPassword, verifyPassword, encrypt } = require('../lib/security');
const { requireAuth, destroyAllSessions, destroySession, clientIp } = require('../lib/session');
const totp = require('../lib/totp');
const mailer = require('../lib/mailer');
const { publicUser, verifyGoogle } = require('./auth');

const router = express.Router();
router.use(requireAuth);

const reload = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

// Érzékeny műveletekhez: jelszó, vagy (jelszó nélküli Google-fióknál) 2FA kód
async function confirmIdentity(user, body) {
  if (user.password_hash) {
    if (!(await verifyPassword(user.password_hash, body.password))) throw new HttpError(401, 'Hibás jelszó.');
  } else if (user.totp_enabled) {
    if (!totp.checkTotp(user, String(body.code || ''))) throw new HttpError(401, 'Hibás 2FA kód.');
  } else if (body.confirm !== 'TORLES' && body.confirm !== true) {
    throw new HttpError(400, 'Megerősítés szükséges.');
  }
}

router.get('/', (req, res) => {
  res.json({ user: publicUser(req.user), recoveryCodesLeft: req.user.totp_enabled ? totp.remainingRecoveryCodes(req.user.id) : 0 });
});

router.patch('/profile', wrap(async (req, res) => {
  const name = v.text(req.body.displayName, { max: 60, field: 'Név' });
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name || null, req.user.id);
  res.json({ ok: true, user: publicUser(reload(req.user.id)) });
}));

router.post('/password', wrap(async (req, res) => {
  const u = req.user;
  const next = v.password(req.body.newPassword);
  if (u.password_hash && !(await verifyPassword(u.password_hash, req.body.currentPassword))) {
    throw new HttpError(401, 'A jelenlegi jelszó hibás.');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), u.id);
  destroyAllSessions(u.id, req.session.idHash); // a többi eszközről kiléptetünk
  audit(u.id, u.password_hash ? 'password_changed' : 'password_set', clientIp(req));
  mailer.sendSecurityNotice(u.email, u.password_hash ? 'a jelszó megváltozott' : 'jelszó lett beállítva').catch(() => {});
  res.json({ ok: true, user: publicUser(reload(u.id)) });
}));

// --- 2FA ----------------------------------------------------------------

router.post('/2fa/setup', wrap(async (req, res) => {
  if (req.user.totp_enabled) throw new HttpError(400, 'A 2FA már be van kapcsolva.');
  const secret = totp.newSecret();
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(encrypt(secret), req.user.id);
  res.json(await totp.setupData(req.user.email, secret));
}));

router.post('/2fa/enable', wrap(async (req, res) => {
  const u = req.user;
  if (u.totp_enabled) throw new HttpError(400, 'A 2FA már be van kapcsolva.');
  if (!u.totp_secret) throw new HttpError(400, 'Előbb indítsd el a beállítást.');
  if (!totp.checkTotp(u, String(req.body.code || '').replace(/\s+/g, ''))) {
    throw new HttpError(400, 'Hibás kód. Ellenőrizd a telefonod óráját is.');
  }
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(u.id);
  const codes = totp.generateRecoveryCodes(u.id);
  destroyAllSessions(u.id, req.session.idHash);
  audit(u.id, '2fa_enabled', clientIp(req));
  mailer.sendSecurityNotice(u.email, 'a kétlépcsős azonosítás bekapcsolva').catch(() => {});
  res.json({ ok: true, recoveryCodes: codes, user: publicUser(reload(u.id)) });
}));

router.post('/2fa/disable', wrap(async (req, res) => {
  const u = req.user;
  if (!u.totp_enabled) throw new HttpError(400, 'A 2FA nincs bekapcsolva.');
  if (!totp.verifySecondFactor(u, req.body.code)) throw new HttpError(401, 'Hibás kód.');
  if (u.password_hash && !(await verifyPassword(u.password_hash, req.body.password))) throw new HttpError(401, 'Hibás jelszó.');
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(u.id);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(u.id);
  audit(u.id, '2fa_disabled', clientIp(req));
  mailer.sendSecurityNotice(u.email, 'a kétlépcsős azonosítás kikapcsolva').catch(() => {});
  res.json({ ok: true, user: publicUser(reload(u.id)) });
}));

router.post('/2fa/recovery-codes', wrap(async (req, res) => {
  const u = req.user;
  if (!u.totp_enabled) throw new HttpError(400, 'A 2FA nincs bekapcsolva.');
  if (!totp.checkTotp(u, String(req.body.code || ''))) throw new HttpError(401, 'Hibás kód.');
  const codes = totp.generateRecoveryCodes(u.id);
  audit(u.id, 'recovery_regenerated', clientIp(req));
  res.json({ ok: true, recoveryCodes: codes });
}));

// --- Google összekapcsolás --------------------------------------------------

router.post('/google/link', wrap(async (req, res) => {
  const p = await verifyGoogle(req.body.credential);
  const other = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(p.sub);
  if (other && other.id !== req.user.id) throw new HttpError(409, 'Ez a Google fiók már egy másik cYc fiókhoz tartozik.');
  db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(p.sub, req.user.id);
  audit(req.user.id, 'google_linked', clientIp(req), 'manual');
  res.json({ ok: true, user: publicUser(reload(req.user.id)) });
}));

router.post('/google/unlink', wrap(async (req, res) => {
  if (!req.user.password_hash) throw new HttpError(400, 'Előbb állíts be jelszót, különben nem tudnál belépni.');
  db.prepare('UPDATE users SET google_sub = NULL WHERE id = ?').run(req.user.id);
  audit(req.user.id, 'google_unlinked', clientIp(req));
  res.json({ ok: true, user: publicUser(reload(req.user.id)) });
}));

// --- Munkamenetek -----------------------------------------------------------

router.get('/sessions', (req, res) => {
  const rows = db.prepare(`SELECT id_hash, created_at, last_seen, ip, user_agent FROM sessions
    WHERE user_id = ? AND stage = 'full' AND expires_at > ? ORDER BY last_seen DESC`).all(req.user.id, Date.now());
  res.json({
    sessions: rows.map((r) => ({
      id: r.id_hash.slice(0, 16),
      current: r.id_hash === req.session.idHash,
      createdAt: r.created_at,
      lastSeen: r.last_seen,
      ip: r.ip,
      userAgent: r.user_agent,
    })),
  });
});

router.post('/sessions/revoke-others', (req, res) => {
  destroyAllSessions(req.user.id, req.session.idHash);
  audit(req.user.id, 'sessions_revoked', clientIp(req));
  res.json({ ok: true });
});

// --- Adatexport és törlés ---------------------------------------------------

router.get('/export', (req, res) => {
  const id = req.user.id;
  const data = {
    exportedAt: new Date().toISOString(),
    app: 'cYc',
    version: config.version,
    user: publicUser(req.user),
    favorites: db.prepare('SELECT from_cur, to_cur, created_at FROM favorites WHERE user_id = ?').all(id),
    holdings: db.prepare('SELECT currency, amount, note, updated_at FROM holdings WHERE user_id = ?').all(id),
    history: db.prepare('SELECT from_cur, to_cur, amount, result, rate, created_at FROM history WHERE user_id = ? ORDER BY created_at DESC').all(id),
    securityLog: db.prepare('SELECT event, ip, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(id),
  };
  res.set('content-disposition', 'attachment; filename="cyc-adataim.json"');
  res.json(data);
});

router.delete('/', wrap(async (req, res) => {
  const u = req.user;
  await confirmIdentity(u, req.body || {});
  if (u.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get().n;
    if (admins <= 1) throw new HttpError(400, 'Az utolsó admin fiók nem törölhető.');
  }
  audit(null, 'account_deleted', clientIp(req), `user ${u.id}`);
  destroySession(req, res);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id); // a többi tábla ON DELETE CASCADE
  res.json({ ok: true });
}));

module.exports = router;
