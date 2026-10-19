// Verzio: v0.4.0 - 2026-10-19
// Felhasználói adatok (eszközök között szinkronban): kedvenc párok, portfólió, előzmények.
'use strict';

const express = require('express');
const { db } = require('../db');
const v = require('../lib/validate');
const { HttpError, wrap } = v;
const { requireAuth } = require('../lib/session');
const { isValidCurrency } = require('../lib/currencies');
const { getRates, convert } = require('../lib/rates');

const router = express.Router();
router.use(requireAuth);

const MAX_FAVORITES = 50;
const MAX_HOLDINGS = 100;
const MAX_HISTORY = 500;

function cur(code, field = 'Valuta') {
  const c = String(code || '').toUpperCase();
  if (!isValidCurrency(c)) throw new HttpError(400, `${field}: ismeretlen valuta.`);
  return c;
}

// --- Kedvencek ---------------------------------------------------------------

router.get('/favorites', (req, res) => {
  res.json({ favorites: db.prepare('SELECT id, from_cur AS "from", to_cur AS "to", created_at AS createdAt FROM favorites WHERE user_id = ? ORDER BY created_at').all(req.user.id) });
});

router.post('/favorites', wrap(async (req, res) => {
  const from = cur(req.body.from, 'Forrás');
  const to = cur(req.body.to, 'Cél');
  if (from === to) throw new HttpError(400, 'A két valuta nem lehet azonos.');
  const n = db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?').get(req.user.id).n;
  if (n >= MAX_FAVORITES) throw new HttpError(400, `Legfeljebb ${MAX_FAVORITES} kedvenc menthető.`);
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, from_cur, to_cur, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, from, to, Date.now());
  res.json({ ok: true });
}));

router.delete('/favorites/:id', (req, res) => {
  db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').run(Number(req.params.id) || 0, req.user.id);
  res.json({ ok: true });
});

// --- Portfólió ----------------------------------------------------------------

router.get('/portfolio', wrap(async (req, res) => {
  const base = isValidCurrency(String(req.query.base || '').toUpperCase()) ? String(req.query.base).toUpperCase() : 'HUF';
  const rows = db.prepare('SELECT id, currency, amount, note, updated_at AS updatedAt FROM holdings WHERE user_id = ? ORDER BY currency, id').all(req.user.id);
  let rates = null;
  try { rates = await getRates(); } catch { /* árfolyam nélkül is visszaadjuk a tételeket */ }
  let total = rates ? 0 : null;
  const items = rows.map((r) => {
    const value = rates ? convert(rates, r.currency, base, r.amount) : null;
    if (total !== null) total = value === null ? null : total + value;
    const ch = rates && rates.change24h ? rates.change24h[r.currency] : undefined;
    return { ...r, value, change24h: typeof ch === 'number' ? ch : null };
  });
  res.json({ base, items, total, ratesUpdatedAt: rates ? rates.updatedAt : null });
}));

router.post('/portfolio', wrap(async (req, res) => {
  const currency = cur(req.body.currency);
  const amount = v.number(req.body.amount, { min: 0, max: 1e15, field: 'Mennyiség' });
  const note = v.text(req.body.note, { max: 80, field: 'Megjegyzés' });
  const n = db.prepare('SELECT COUNT(*) AS n FROM holdings WHERE user_id = ?').get(req.user.id).n;
  if (n >= MAX_HOLDINGS) throw new HttpError(400, `Legfeljebb ${MAX_HOLDINGS} tétel lehet.`);
  const info = db.prepare('INSERT INTO holdings (user_id, currency, amount, note, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, currency, amount, note || null, Date.now());
  res.json({ ok: true, id: info.lastInsertRowid });
}));

router.put('/portfolio/:id', wrap(async (req, res) => {
  const amount = v.number(req.body.amount, { min: 0, max: 1e15, field: 'Mennyiség' });
  const note = v.text(req.body.note, { max: 80, field: 'Megjegyzés' });
  const r = db.prepare('UPDATE holdings SET amount = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(amount, note || null, Date.now(), Number(req.params.id) || 0, req.user.id);
  if (!r.changes) throw new HttpError(404, 'Nincs ilyen tétel.');
  res.json({ ok: true });
}));

router.delete('/portfolio/:id', (req, res) => {
  db.prepare('DELETE FROM holdings WHERE id = ? AND user_id = ?').run(Number(req.params.id) || 0, req.user.id);
  res.json({ ok: true });
});

// --- Előzmények ----------------------------------------------------------------

router.get('/history', (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  res.json({
    history: db.prepare(`SELECT id, from_cur AS "from", to_cur AS "to", amount, result, rate, created_at AS createdAt
      FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(req.user.id, limit),
  });
});

router.post('/history', wrap(async (req, res) => {
  const from = cur(req.body.from, 'Forrás');
  const to = cur(req.body.to, 'Cél');
  const amount = v.number(req.body.amount, { min: 0, max: 1e18, field: 'Összeg' });
  // Az eredményt a szerver számolja a saját árfolyamából, nem a klienstől fogadja el
  const rates = await getRates();
  const rate = convert(rates, from, to, 1);
  if (rate === null) throw new HttpError(400, 'Az árfolyam nem elérhető.');
  const last = db.prepare('SELECT from_cur, to_cur, amount, created_at FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user.id);
  // Azonos, közvetlenül ismételt bejegyzést nem duplikálunk
  if (last && last.from_cur === from && last.to_cur === to && last.amount === amount && Date.now() - last.created_at < 10 * 60e3) {
    return res.json({ ok: true, duplicate: true });
  }
  db.prepare('INSERT INTO history (user_id, from_cur, to_cur, amount, result, rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, from, to, amount, amount * rate, rate, Date.now());
  db.prepare(`DELETE FROM history WHERE user_id = ? AND id NOT IN
    (SELECT id FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`).run(req.user.id, req.user.id, MAX_HISTORY);
  res.json({ ok: true });
}));

router.delete('/history', (req, res) => {
  db.prepare('DELETE FROM history WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.delete('/history/:id', (req, res) => {
  db.prepare('DELETE FROM history WHERE id = ? AND user_id = ?').run(Number(req.params.id) || 0, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
