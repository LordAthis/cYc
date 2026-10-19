#!/usr/bin/env node
// Verzio: v0.4.0 - 2026-10-19
// Parancssori kezelő a VPS-en (az első admin kinevezéséhez és vészhelyzetre).
// Használat:
//   node scripts/cyc-admin.js list
//   node scripts/cyc-admin.js admin <email>          admin jog megadása
//   node scripts/cyc-admin.js user <email>           admin jog elvétele
//   node scripts/cyc-admin.js hidden <email> on|off  rejtett felület engedélyezése
//   node scripts/cyc-admin.js unlock <email>         zárolás feloldása
//   node scripts/cyc-admin.js disable2fa <email>     2FA kikapcsolása (elveszett telefon)
//   node scripts/cyc-admin.js verify <email>         e-mail cím kézi megerősítése
'use strict';

const { db, audit } = require('../src/db');

const [cmd, email, arg] = process.argv.slice(2);

function findUser() {
  if (!email) { console.error('Hianyzik az e-mail cim.'); process.exit(1); }
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!u) { console.error('Nincs ilyen felhasznalo: ' + email); process.exit(1); }
  return u;
}

switch (cmd) {
  case 'list': {
    const rows = db.prepare('SELECT id, email, role, hidden_access, disabled, email_verified, totp_enabled FROM users ORDER BY id').all();
    for (const r of rows) {
      console.log(`${String(r.id).padStart(4)}  ${r.email.padEnd(36)} ${r.role.padEnd(6)} rejtett:${r.hidden_access ? 'igen' : 'nem '} 2FA:${r.totp_enabled ? 'be' : 'ki'} ${r.email_verified ? '' : '(nincs megerositve)'} ${r.disabled ? '[TILTVA]' : ''}`);
    }
    console.log(`Osszesen: ${rows.length}`);
    break;
  }
  case 'admin':
  case 'user': {
    const u = findUser();
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(cmd, u.id);
    audit(u.id, 'cli_role', null, cmd);
    console.log(`Kesz: ${u.email} szerepkore most: ${cmd}`);
    break;
  }
  case 'hidden': {
    const u = findUser();
    if (!['on', 'off'].includes(arg)) { console.error('Hasznalat: hidden <email> on|off'); process.exit(1); }
    db.prepare('UPDATE users SET hidden_access = ? WHERE id = ?').run(arg === 'on' ? 1 : 0, u.id);
    audit(u.id, 'cli_hidden', null, arg);
    console.log(`Kesz: ${u.email} rejtett feluletet ${arg === 'on' ? 'LATHAT' : 'NEM lathat'}.`);
    break;
  }
  case 'unlock': {
    const u = findUser();
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(u.id);
    console.log('Kesz: zarolas feloldva.');
    break;
  }
  case 'disable2fa': {
    const u = findUser();
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(u.id);
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(u.id);
    audit(u.id, 'cli_2fa_disabled', null);
    console.log('Kesz: 2FA kikapcsolva.');
    break;
  }
  case 'verify': {
    const u = findUser();
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(u.id);
    console.log('Kesz: e-mail cim megerositve.');
    break;
  }
  default:
    console.log('Parancsok: list | admin <email> | user <email> | hidden <email> on|off | unlock <email> | disable2fa <email> | verify <email>');
}
