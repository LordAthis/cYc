// Verzio: v2.0.0 - 2026-10-19
// Admin API: felhasználók listája, rejtett felület engedélyezése egyedileg, tiltás, szerepkör.
// Nem admin kérésre mindig 404 (a végpont létezése se derüljön ki).
'use strict';

const express = require('express');
const { db, audit } = require('../db');
const { HttpError, wrap } = require('../lib/validate');
const { requireAdmin, destroyAllSessions, clientIp } = require('../lib/session');

const router = express.Router();
router.use(requireAdmin);

router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const rows = db.prepare(`SELECT id, email, display_name, role, hidden_access, disabled, email_verified,
      totp_enabled, google_sub IS NOT NULL AS google, created_at, last_login_at
    FROM users ${q ? 'WHERE email LIKE ? OR display_name LIKE ?' : ''}
    ORDER BY created_at DESC LIMIT 500`).all(...(q ? [`%${q}%`, `%${q}%`] : []));
  res.json({
    users: rows.map((r) => ({
      id: r.id, email: r.email, displayName: r.display_name || '', role: r.role,
      hiddenAccess: !!r.hidden_access, disabled: !!r.disabled, emailVerified: !!r.email_verified,
      totpEnabled: !!r.totp_enabled, google: !!r.google, createdAt: r.created_at, lastLoginAt: r.last_login_at,
    })),
  });
});

router.patch('/users/:id', wrap(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw new HttpError(404, 'Nincs ilyen felhasználó.');
  const b = req.body || {};
  const changes = [];

  if (typeof b.hiddenAccess === 'boolean') {
    db.prepare('UPDATE users SET hidden_access = ? WHERE id = ?').run(b.hiddenAccess ? 1 : 0, id);
    changes.push(`hidden=${b.hiddenAccess}`);
  }
  if (typeof b.disabled === 'boolean') {
    if (id === req.user.id) throw new HttpError(400, 'Saját magadat nem tilthatod le.');
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(b.disabled ? 1 : 0, id);
    if (b.disabled) destroyAllSessions(id);
    changes.push(`disabled=${b.disabled}`);
  }
  if (b.role === 'admin' || b.role === 'user') {
    if (id === req.user.id && b.role !== 'admin') throw new HttpError(400, 'Saját admin jogodat nem veheted el.');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, id);
    changes.push(`role=${b.role}`);
  }
  if (b.unlock === true) {
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(id);
    changes.push('unlock');
  }
  if (b.verifyEmail === true) {
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(id);
    changes.push('verify');
  }
  audit(req.user.id, 'admin_update', clientIp(req), `user ${id}: ${changes.join(', ')}`);
  res.json({ ok: true });
}));

router.get('/audit', (req, res) => {
  const rows = db.prepare(`SELECT a.event, a.ip, a.detail, a.created_at, u.email FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 200`).all();
  res.json({ events: rows });
});

module.exports = router;
