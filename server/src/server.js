// Verzio: v2.0.0 - 2026-10-19
// cYc szerver belépési pontja: biztonsági fejlécek, munkamenet, API-k, statikus oldalak,
// valamint a csak jogosultaknak létező rejtett felület és admin panel.
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
require('./db');
const { loadSession, csrfProtect, clientIp } = require('./lib/session');
const { publicCaptchaConfig, verifyCaptcha } = require('./lib/captcha');
const { getRates } = require('./lib/rates');
const { CRYPTO, FIAT } = require('./lib/currencies');
const mailer = require('./lib/mailer');
const v = require('./lib/validate');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// --- Biztonsági fejlécek (CSP: csak a saját domain + Google / captcha szolgáltatók) ---
const captchaHosts = {
  turnstile: ['https://challenges.cloudflare.com'],
  recaptcha: ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
  hcaptcha: ['https://js.hcaptcha.com', 'https://*.hcaptcha.com', 'https://hcaptcha.com'],
  none: [],
}[config.captcha.provider];
const googleHosts = config.google.clientId ? ['https://accounts.google.com/gsi/'] : [];

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", ...googleHosts.map((h) => h + 'client'), ...captchaHosts],
      'style-src': ["'self'", "'unsafe-inline'", ...googleHosts.map((h) => h + 'style'), ...captchaHosts],
      'img-src': ["'self'", 'data:', 'https://*.googleusercontent.com'],
      'connect-src': ["'self'", ...googleHosts, ...captchaHosts],
      'frame-src': [...googleHosts, ...captchaHosts],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': config.isProd ? [] : null,
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // Google bejelentkezési ablakhoz
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use((req, res, next) => {
  res.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

app.use(cookieParser());
app.use(express.json({ limit: '32kb' }));
app.use(loadSession);

// --- API ---------------------------------------------------------------------
const api = express.Router();
api.use(csrfProtect);
api.use((req, res, next) => { res.set('cache-control', 'no-store'); next(); });

const generalLimiter = rateLimit({ windowMs: 60e3, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Túl sok kérés.' } });
api.use(generalLimiter);

api.get('/config', (req, res) => {
  res.json({
    version: config.version,
    registrationEnabled: config.registrationEnabled,
    passwordMinLength: config.passwordMinLength,
    captcha: publicCaptchaConfig(),
    googleClientId: config.google.clientId || null,
    contactEnabled: !!config.mail.contactTo,
  });
});

api.get('/rates', v.wrap(async (req, res) => {
  const r = await getRates();
  res.set('cache-control', 'public, max-age=15');
  res.json({
    usd: r.usd,
    change24h: r.change24h || {},
    updatedAt: r.updatedAt,
    stale: !!r.stale,
    partial: !!r.partial,
    currencies: { crypto: CRYPTO.map(({ cg, ...c }) => c), fiat: FIAT },
  });
}));

const contactLimiter = rateLimit({ windowMs: 3600e3, limit: config.isProd ? 5 : 1000, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Túl sok üzenet. Próbáld újra később.' } });
api.post('/contact', contactLimiter, v.wrap(async (req, res) => {
  if (!config.mail.contactTo) throw new v.HttpError(503, 'Az üzenetküldés jelenleg nem elérhető.');
  if (!(await verifyCaptcha(req.body.captcha, clientIp(req)))) throw new v.HttpError(400, 'A captcha ellenőrzés sikertelen.', 'CAPTCHA');
  const subjects = { technical: 'Technikai támogatás', feature: 'Funkció kérés', bug: 'Hibabejelentés', business: 'Üzleti megkeresés', other: 'Egyéb' };
  const subject = subjects[req.body.subject];
  if (!subject) throw new v.HttpError(400, 'Válassz témát.');
  await mailer.sendContact({
    name: v.text(req.body.name, { min: 2, max: 80, field: 'Név' }),
    email: v.email(req.body.email),
    subject,
    message: v.text(req.body.message, { min: 10, max: 5000, field: 'Üzenet' }),
  });
  res.json({ ok: true });
}));

api.use('/auth', require('./routes/auth').router);
api.use('/account', require('./routes/account'));
api.use('/me', require('./routes/data'));
api.use('/admin', require('./routes/admin'));

// Fejlesztői postafiók: csak kifejezett DEV_OUTBOX=true esetén, nem-production módban (a tesztek használják).
// Élesben soha ne legyen bekapcsolva, mert a megerősítő és jelszó-visszaállító linkeket mutatja!
if (!config.isProd && process.env.DEV_OUTBOX === 'true') {
  api.get('/dev/outbox', (req, res) => res.json({ mails: mailer.devOutbox }));
}

api.use((req, res) => res.status(404).json({ error: 'Nem található.' }));
app.use('/api', api);

// --- 404 oldal (a rejtett felület is pontosan ezt adja nem jogosultnak) ---------
const notFoundFile = path.join(config.publicDir, '404.html');
function send404(req, res) {
  res.status(404);
  res.set('cache-control', 'no-store');
  if (req.accepts('html')) return res.sendFile(notFoundFile);
  res.type('txt').send('Not found');
}

// --- Rejtett belső felület ----------------------------------------------------
// A tartalma a server/private/hidden mappában van, NEM a public-ban, így statikusan sem érhető el.
const hiddenDir = path.join(config.privateDir, 'hidden');
const canSeeHidden = (u) => !!u && !u.disabled && (u.hidden_access === 1 || u.role === 'admin');

function guarded(check, dir, indexFile) {
  const statics = express.static(dir, { index: false, dotfiles: 'deny', fallthrough: true });
  return (req, res, next) => {
    if (!check(req.user)) return send404(req, res);
    res.set('cache-control', 'no-store');
    res.set('x-robots-tag', 'noindex, nofollow');
    if (req.path === '/' || req.path === '') {
      // Perjel nélküli címről átirányítás, hogy a relatív (./xyz.js) hivatkozások jó helyre mutassanak
      if (!req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(302, req.baseUrl + '/');
      return res.sendFile(path.join(dir, indexFile));
    }
    statics(req, res, () => send404(req, res));
  };
}

app.use(config.hiddenPath, guarded(canSeeHidden, hiddenDir, 'index.html'));
app.use(config.adminPath, guarded((u) => !!u && u.role === 'admin', path.join(config.privateDir, 'admin'), 'index.html'));

// --- Statikus nyilvános oldalak -------------------------------------------------
app.use(express.static(config.publicDir, {
  extensions: ['html'],
  index: 'index.html',
  dotfiles: 'ignore',
  setHeaders(res, file) {
    if (file.endsWith('.html')) res.set('cache-control', 'no-cache');
    else res.set('cache-control', 'public, max-age=86400');
  },
}));

app.use(send404);

// --- Központi hibakezelő ----------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Hibás kérés.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Túl nagy kérés.' });
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[cYc] Szerverhiba:', err);
  res.status(status).json({ error: status >= 500 && !err.code ? 'Szerverhiba. Próbáld újra később.' : err.message, code: err.code });
});

if (!fs.existsSync(path.join(hiddenDir, 'index.html'))) {
  console.warn('[cYc] Figyelem: a rejtett felulet (server/private/hidden/index.html) hianyzik.');
}

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    console.log(`[cYc] v${config.version} fut: http://${config.host}:${config.port}  (nyilvanos cim: ${config.appOrigin})`);
    console.log(`[cYc] Captcha: ${config.captcha.provider} | Google: ${config.google.clientId ? 'be' : 'ki'} | SMTP: ${mailer.hasSmtp() ? 'be' : 'ki (konzolra ir)'}`);
  });
}

module.exports = app;
