// Verzio: v0.4.0 - 2026-10-19
// Captcha ellenőrzés szerveroldalon: Cloudflare Turnstile, Google reCAPTCHA v2 vagy hCaptcha.
'use strict';

const config = require('../config');

const VERIFY_URLS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
};

async function verifyCaptcha(token, ip) {
  const provider = config.captcha.provider;
  if (provider === 'none') return true;
  if (!token || typeof token !== 'string' || token.length > 4096) return false;

  const body = new URLSearchParams({ secret: config.captcha.secret, response: token });
  if (ip) body.set('remoteip', ip);

  try {
    const r = await fetch(VERIFY_URLS[provider], {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    return data && data.success === true;
  } catch (e) {
    console.error('[cYc] Captcha ellenorzes sikertelen:', e.message);
    return false;
  }
}

function publicCaptchaConfig() {
  return { provider: config.captcha.provider, siteKey: config.captcha.siteKey };
}

module.exports = { verifyCaptcha, publicCaptchaConfig };
