// Verzio: v2.0.0 - 2026-10-19
// Füstteszt a teljes folyamatra: regisztráció -> megerősítés -> belépés -> 2FA -> adatok ->
// rejtett felület (404 / engedélyezés után 200) -> admin -> jelszó-visszaállítás -> törlés.
// Futtatás: npm test   (internet nem kell: kitalált árfolyamokkal fut)
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cyc-test-'));
Object.assign(process.env, {
  NODE_ENV: 'test', DB_FILE: path.join(tmp, 'test.sqlite'), RATES_MOCK: 'true', CAPTCHA_PROVIDER: 'none',
  APP_ORIGIN: 'http://test.local', APP_SECRET: 'x'.repeat(40), HIDDEN_PATH: 'titok/belso', ADMIN_PATH: 'vezerlo',
  SMTP_HOST: '', GOOGLE_CLIENT_ID: '', CONTACT_TO: '', REQUIRE_EMAIL_VERIFICATION: 'true', DEV_OUTBOX: 'true',
});

const app = require('../src/server');
const { authenticator } = require('otplib');
const { db } = require('../src/db');

let server; let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// Egyszerű "böngésző": süti + CSRF token
function client() {
  let cookie = '';
  let csrf = null;
  return {
    get csrf() { return csrf; },
    async req(method, url, body, extraHeaders = {}) {
      const headers = { origin: 'http://test.local', accept: 'application/json', ...extraHeaders };
      if (cookie) headers.cookie = cookie;
      if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const sc = res.headers.getSetCookie();
      for (const c of sc) {
        const [pair] = c.split(';');
        cookie = /=$/.test(pair) || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c) ? '' : pair;
      }
      const type = res.headers.get('content-type') || '';
      const data = type.includes('json') ? await res.json() : await res.text();
      if (data && data.csrf) csrf = data.csrf;
      return { status: res.status, data, headers: res.headers };
    },
  };
}

const lastMailLink = async (c, re) => {
  const { data } = await c.req('GET', '/api/dev/outbox');
  const m = [...data.mails].reverse().find((x) => re.test(x.text));
  return m && m.text.match(re)[1];
};

const EMAIL = 'teszt@example.com';
const PW = 'Nagyon-Eros-Jelszo-42';

test('teljes folyamat', async () => {
  const a = client();

  // Nyilvános végpontok
  let r = await a.req('GET', '/api/config');
  assert.equal(r.status, 200);
  assert.equal(r.data.version, require('../package.json').version);
  r = await a.req('GET', '/api/rates');
  assert.equal(r.status, 200);
  assert.ok(r.data.usd.BTC > 0 && r.data.usd.HUF > 0);
  r = await a.req('GET', '/');
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('content-security-policy'));

  // Idegen Origin elutasítva
  r = await a.req('POST', '/api/auth/login', { email: EMAIL, password: PW }, { origin: 'https://gonosz.example' });
  assert.equal(r.status, 403);

  // Gyenge jelszó, feltételek nélkül
  r = await a.req('POST', '/api/auth/register', { email: EMAIL, password: 'rovid', acceptTerms: true });
  assert.equal(r.status, 400);
  r = await a.req('POST', '/api/auth/register', { email: EMAIL, password: PW });
  assert.equal(r.status, 400);

  // Regisztráció -> még nem léphet be
  r = await a.req('POST', '/api/auth/register', { email: EMAIL, password: PW, acceptTerms: true, displayName: 'Teszt' });
  assert.equal(r.status, 200);
  assert.equal(r.data.verificationSent, true);
  r = await a.req('POST', '/api/auth/login', { email: EMAIL, password: PW });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'UNVERIFIED');

  // Megerősítés -> automatikus belépés
  const vtoken = await lastMailLink(a, /verify\.html\?token=([\w-]+)/);
  assert.ok(vtoken);
  r = await a.req('POST', '/api/auth/verify', { token: vtoken });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, EMAIL);
  r = await a.req('POST', '/api/auth/verify', { token: vtoken });
  assert.equal(r.status, 400, 'a token csak egyszer használható');

  // CSRF token nélkül elutasítva
  const saved = a.csrf;
  r = await fetch(base + '/api/me/favorites', { method: 'POST', headers: { origin: 'http://test.local', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 401); // süti nélkül nincs is munkamenet
  assert.ok(saved);

  // Kedvencek, portfólió, előzmények
  r = await a.req('POST', '/api/me/favorites', { from: 'BTC', to: 'HUF' });
  assert.equal(r.status, 200);
  r = await a.req('POST', '/api/me/favorites', { from: 'BTC', to: 'XXX' });
  assert.equal(r.status, 400);
  r = await a.req('GET', '/api/me/favorites');
  assert.equal(r.data.favorites.length, 1);

  r = await a.req('POST', '/api/me/portfolio', { currency: 'BTC', amount: 0.5, note: 'Ledger' });
  assert.equal(r.status, 200);
  r = await a.req('POST', '/api/me/portfolio', { currency: 'ETH', amount: '2,5' });
  assert.equal(r.status, 200);
  r = await a.req('GET', '/api/me/portfolio?base=USD');
  assert.equal(r.data.items.length, 2);
  assert.equal(Math.round(r.data.total), 0.5 * 98000 + 2.5 * 3600);

  r = await a.req('POST', '/api/me/history', { from: 'BTC', to: 'HUF', amount: 1 });
  assert.equal(r.status, 200);
  r = await a.req('POST', '/api/me/history', { from: 'BTC', to: 'HUF', amount: 1 });
  assert.equal(r.data.duplicate, true);
  r = await a.req('GET', '/api/me/history');
  assert.equal(r.data.history.length, 1);
  assert.equal(Math.round(r.data.history[0].result), 98000 * 365);

  // Rejtett felület: nem jogosultnak pontosan olyan 404, mint egy nem létező oldal
  const notFound = await a.req('GET', '/ez-nem-letezik', undefined, { accept: 'text/html' });
  r = await a.req('GET', '/titok/belso/', undefined, { accept: 'text/html' });
  assert.equal(r.status, 404);
  assert.equal(r.data, notFound.data);
  r = await a.req('GET', '/titok/belso/hidden.js', undefined, { accept: '*/*' });
  assert.equal(r.status, 404);
  r = await a.req('GET', '/vezerlo/', undefined, { accept: 'text/html' });
  assert.equal(r.status, 404);
  r = await a.req('GET', '/api/admin/users');
  assert.equal(r.status, 404);
  r = await a.req('GET', '/api/auth/me');
  assert.deepEqual(r.data.links, {});

  // Admin kinevezés (CLI-vel egyenértékű) -> admin panel és rejtett felület elérhető
  const B = 'masik@example.com';
  const b = client();
  await b.req('POST', '/api/auth/register', { email: B, password: PW, acceptTerms: true });
  db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(EMAIL);
  r = await a.req('GET', '/vezerlo/', undefined, { accept: 'text/html' });
  assert.equal(r.status, 200);
  r = await a.req('GET', '/vezerlo', undefined, { accept: 'text/html' });
  assert.equal(r.status, 302);
  r = await a.req('GET', '/api/admin/users');
  assert.equal(r.data.users.length, 2);
  const bId = r.data.users.find((u) => u.email === B).id;

  // B megerősítése adminból, majd egyedi rejtett hozzáférés
  await a.req('PATCH', `/api/admin/users/${bId}`, { verifyEmail: true });
  r = await b.req('POST', '/api/auth/login', { email: B, password: PW });
  assert.equal(r.status, 200);
  r = await b.req('GET', '/titok/belso/', undefined, { accept: 'text/html' });
  assert.equal(r.status, 404);
  await a.req('PATCH', `/api/admin/users/${bId}`, { hiddenAccess: true });
  r = await b.req('GET', '/titok/belso/', undefined, { accept: 'text/html' });
  assert.equal(r.status, 200);
  assert.match(r.data, /Belső felület/);
  r = await b.req('GET', '/api/auth/me');
  assert.equal(r.data.links.hidden, '/titok/belso/');
  assert.equal(r.data.links.admin, undefined);
  await a.req('PATCH', `/api/admin/users/${bId}`, { hiddenAccess: false });
  r = await b.req('GET', '/titok/belso/', undefined, { accept: 'text/html' });
  assert.equal(r.status, 404);

  // Letiltás -> B munkamenete azonnal megszűnik
  await a.req('PATCH', `/api/admin/users/${bId}`, { disabled: true });
  r = await b.req('GET', '/api/auth/me');
  assert.equal(r.data.user, null);

  // 2FA bekapcsolása
  r = await a.req('POST', '/api/account/2fa/setup');
  assert.ok(r.data.qrDataUrl.startsWith('data:image/png'));
  const secret = r.data.secret;
  r = await a.req('POST', '/api/account/2fa/enable', { code: '000000' });
  assert.equal(r.status, 400);
  r = await a.req('POST', '/api/account/2fa/enable', { code: authenticator.generate(secret) });
  assert.equal(r.status, 200);
  assert.equal(r.data.recoveryCodes.length, 10);
  const recovery = r.data.recoveryCodes;

  // Kilépés, belépés -> 2FA lépés kell
  await a.req('POST', '/api/auth/logout');
  r = await a.req('POST', '/api/auth/login', { email: EMAIL, password: PW });
  assert.equal(r.data.mfaRequired, true);
  r = await a.req('GET', '/api/me/favorites');
  assert.equal(r.status, 401, '2FA előtt nincs hozzáférés');
  r = await a.req('POST', '/api/auth/login/2fa', { code: '123456' });
  assert.equal(r.status, 401);
  r = await a.req('POST', '/api/auth/login/2fa', { code: recovery[0] });
  assert.equal(r.status, 200);
  assert.equal(r.data.usedRecoveryCode, true);
  r = await a.req('GET', '/api/account');
  assert.equal(r.data.recoveryCodesLeft, 9);

  // Ugyanaz a visszaállító kód másodszor nem jó
  await a.req('POST', '/api/auth/logout');
  await a.req('POST', '/api/auth/login', { email: EMAIL, password: PW });
  r = await a.req('POST', '/api/auth/login/2fa', { code: recovery[0] });
  assert.equal(r.status, 401);
  r = await a.req('POST', '/api/auth/login/2fa', { code: recovery[1] });
  assert.equal(r.status, 200);

  // Hibás jelszó -> zárolás 5 próbálkozás után
  const c = client();
  for (let i = 0; i < 5; i++) {
    r = await c.req('POST', '/api/auth/login', { email: EMAIL, password: 'rossz-jelszo-' + i });
    assert.equal(r.status, 401);
  }
  r = await c.req('POST', '/api/auth/login', { email: EMAIL, password: PW });
  assert.equal(r.status, 429);

  // Jelszó-visszaállítás (feloldja a zárolást, minden munkamenetet megszüntet)
  r = await c.req('POST', '/api/auth/forgot', { email: EMAIL });
  assert.equal(r.status, 200);
  r = await c.req('POST', '/api/auth/forgot', { email: 'nincs-ilyen@example.com' });
  assert.equal(r.status, 200, 'nem árulja el, hogy a cím nem létezik');
  const rtoken = await lastMailLink(c, /reset\.html\?token=([\w-]+)/);
  const NEWPW = 'Uj-Eros-Jelszo-2026!';
  r = await c.req('POST', '/api/auth/reset', { token: rtoken, password: NEWPW });
  assert.equal(r.status, 200);
  r = await a.req('GET', '/api/auth/me');
  assert.equal(r.data.user, null, 'a régi munkamenet megszűnt');

  // Adatexport és fióktörlés (az utolsó admin nem törölheti magát)
  r = await c.req('POST', '/api/auth/login', { email: EMAIL, password: NEWPW });
  assert.equal(r.data.mfaRequired, true);
  r = await c.req('POST', '/api/auth/login/2fa', { code: recovery[2] });
  assert.equal(r.status, 200);
  r = await c.req('GET', '/api/account/export');
  assert.equal(r.data.holdings.length, 2);
  r = await c.req('DELETE', '/api/account', { password: NEWPW });
  assert.equal(r.status, 400);
  db.prepare("UPDATE users SET role = 'user' WHERE email = ?").run(EMAIL);
  r = await c.req('DELETE', '/api/account', { password: 'rossz' });
  assert.equal(r.status, 401);
  r = await c.req('DELETE', '/api/account', { password: NEWPW });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM holdings').get().n, 0, 'kaszkád törlés');
});
