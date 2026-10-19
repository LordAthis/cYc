// Verzio: v2.0.0 - 2026-10-19
// Központi konfiguráció: minden beállítás a .env fájlból (vagy környezeti változóból) jön.
// A program verziója EGYETLEN helyen van: server/package.json -> "version".
'use strict';

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const pkg = require('../package.json');

function bool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on', 'igen'].includes(String(v).toLowerCase());
}
function int(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : def;
}
function str(name, def = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? def : String(v);
}

const isProd = str('NODE_ENV', 'development') === 'production';

const config = {
  version: pkg.version,
  isProd,
  port: int('PORT', 3000),
  host: str('HOST', '127.0.0.1'),
  // Nyilvános cím (séma + domain), pl. https://cyc.example.hu - e-mail linkekhez és Origin-ellenőrzéshez
  appOrigin: str('APP_ORIGIN', 'http://localhost:3000').replace(/\/+$/, ''),
  // Nginx mögött 1 (egy proxy-ugrás), hogy a valós kliens IP-t lássuk
  trustProxy: int('TRUST_PROXY', isProd ? 1 : 0),

  // Hosszú, véletlen titok (min. 32 karakter) - 2FA titkok titkosítására
  appSecret: str('APP_SECRET', ''),

  dbFile: path.resolve(path.join(__dirname, '..'), str('DB_FILE', './data/cyc.sqlite')),
  publicDir: path.join(__dirname, '..', '..', 'public'),
  privateDir: path.join(__dirname, '..', 'private'),

  session: {
    // A __Host- előtag csak Secure sütivel érvényes, ezért a név ehhez igazodik
    cookieName: str('SESSION_COOKIE', bool('COOKIE_SECURE', isProd) ? '__Host-cyc_sid' : 'cyc_sid'),
    days: int('SESSION_DAYS', 30),
    secureCookie: bool('COOKIE_SECURE', isProd),
  },

  registrationEnabled: bool('REGISTRATION_ENABLED', true),
  requireEmailVerification: bool('REQUIRE_EMAIL_VERIFICATION', true),
  passwordMinLength: int('PASSWORD_MIN_LENGTH', 10),

  captcha: {
    // turnstile | recaptcha | hcaptcha | none
    provider: str('CAPTCHA_PROVIDER', 'none').toLowerCase(),
    siteKey: str('CAPTCHA_SITE_KEY'),
    secret: str('CAPTCHA_SECRET'),
  },

  google: {
    clientId: str('GOOGLE_CLIENT_ID'),
  },

  mail: {
    host: str('SMTP_HOST'),
    port: int('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: str('SMTP_USER'),
    pass: str('SMTP_PASS'),
    from: str('MAIL_FROM', 'cYc <no-reply@localhost>'),
    contactTo: str('CONTACT_TO'),
  },

  // Rejtett belső felület útvonala (pl. /x/belso). Csak jogosult, belépett felhasználónak létezik.
  hiddenPath: '/' + str('HIDDEN_PATH', 'x').replace(/^\/+|\/+$/g, ''),
  // Admin panel útvonala - nem jogosultnak 404
  adminPath: '/' + str('ADMIN_PATH', 'admin').replace(/^\/+|\/+$/g, ''),

  rates: {
    cacheSeconds: int('RATES_CACHE_SECONDS', 60),
    mock: bool('RATES_MOCK', false),
    coingeckoKey: str('COINGECKO_API_KEY'),
  },
};

if (!config.appSecret || config.appSecret.length < 32) {
  if (isProd) {
    console.error('[cYc] HIBA: APP_SECRET hianyzik vagy rovidebb 32 karakternel. Lasd: server/.env.example');
    process.exit(1);
  }
  config.appSecret = 'dev-only-insecure-secret-change-me-0123456789';
  console.warn('[cYc] Figyelem: fejlesztoi APP_SECRET van hasznalatban (production modban ez hiba lenne).');
}

if (!['turnstile', 'recaptcha', 'hcaptcha', 'none'].includes(config.captcha.provider)) {
  console.error('[cYc] HIBA: ismeretlen CAPTCHA_PROVIDER: ' + config.captcha.provider);
  process.exit(1);
}
if (isProd && config.captcha.provider === 'none') {
  console.warn('[cYc] Figyelem: production modban nincs captcha bekapcsolva (CAPTCHA_PROVIDER=none).');
}

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

module.exports = config;
