// Verzio: v2.0.0 - 2026-10-19
// Közös kliensoldali modul minden oldalra: fejléc/lábléc, téma, API-hívások CSRF-fel,
// bejelentkezési állapot, captcha és Google gomb betöltése, számformázás, értesítések.
(function () {
  'use strict';

  const state = { config: null, user: null, csrf: null, mfaPending: false, links: {} };

  // --- Segédek -------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function storageGet(key, def) {
    try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch { return def; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privát mód */ }
  }

  // --- API -------------------------------------------------------------------
  class ApiError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code; }
  }

  async function api(method, url, body, _retried) {
    const opts = { method, credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (state.csrf && method !== 'GET') opts.headers['x-csrf-token'] = state.csrf;
    let res;
    try {
      res = await fetch(url, opts);
    } catch {
      throw new ApiError('Nincs kapcsolat a szerverrel. Ellenőrizd az internetet.', 0, 'NETWORK');
    }
    let data = null;
    try { data = await res.json(); } catch { /* nem JSON */ }
    if (data && data.csrf) state.csrf = data.csrf;
    if (!res.ok) {
      const code = data && data.code;
      if (code === 'CSRF' && !_retried) {
        await refreshMe();
        return api(method, url, body, true);
      }
      throw new ApiError((data && data.error) || `Hiba (${res.status})`, res.status, code);
    }
    return data;
  }

  async function refreshMe() {
    const me = await api('GET', '/api/auth/me');
    state.user = me.user;
    state.csrf = me.csrf;
    state.mfaPending = me.mfaPending;
    state.links = me.links || {};
    renderAuthArea();
    return me;
  }

  // --- Értesítések ----------------------------------------------------------------
  function toast(msg, type) {
    let host = $('.toast-host');
    if (!host) { host = h('div', { class: 'toast-host', 'aria-live': 'polite' }); document.body.append(host); }
    const t = h('div', { class: 'toast' + (type === 'error' ? ' error' : ''), text: msg });
    host.append(t);
    setTimeout(() => t.remove(), type === 'error' ? 6000 : 3200);
  }

  function showAlert(el, msg, type = 'error') {
    if (!el) return;
    el.className = `alert alert-${type} show`;
    el.textContent = msg;
  }
  function hideAlert(el) { if (el) el.className = 'alert'; }

  // Gomb "dolgozik" állapot (1,5 mp feletti várakozásnál is legyen visszajelzés)
  async function busy(btn, fn) {
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> ' + btn.textContent.trim();
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
  }

  // --- Téma ---------------------------------------------------------------------
  function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('cyc-theme', t); } catch { /* */ }
    const b = $('#themeToggle');
    if (b) { b.textContent = t === 'dark' ? '☀️' : '🌙'; b.title = t === 'dark' ? 'Világos mód' : 'Sötét mód'; }
    document.dispatchEvent(new CustomEvent('cyc:theme', { detail: t }));
  }

  // --- Fejléc / lábléc -------------------------------------------------------------
  function renderShell() {
    const page = document.body.dataset.page || '';
    const header = $('#siteHeader');
    if (header) {
      header.className = 'header';
      header.innerHTML = '';
      header.append(h('div', { class: 'container' },
        h('div', { class: 'header-content' },
          h('a', { href: '/', class: 'logo' }, 'cYc ', h('small', {}, '- CryptoCalc')),
          h('nav', { class: 'nav', 'aria-label': 'Fő navigáció' },
            h('a', { href: '/', class: 'nav-link' + (page === 'calc' ? ' active' : '') }, 'Kalkulátor'),
            h('a', { href: '/about.html', class: 'nav-link' + (page === 'about' ? ' active' : '') }, 'Rólunk'),
            h('button', { class: 'glass-btn icon-btn', id: 'themeToggle', type: 'button', 'aria-label': 'Téma váltása',
              onclick: () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark') }),
            h('div', { id: 'authArea' })
          )
        )
      ));
      setTheme(currentTheme());
    }
    const footer = $('#siteFooter');
    if (footer) {
      footer.className = 'footer';
      footer.innerHTML = '';
      footer.append(h('div', { class: 'container' },
        h('div', { class: 'footer-content' },
          h('a', { href: '/about.html', class: 'footer-link' }, 'Rólunk'),
          h('a', { href: '/contact.html', class: 'footer-link' }, 'Kapcsolat'),
          h('a', { href: '/privacy.html', class: 'footer-link' }, 'Adatvédelem'),
          h('a', { href: '/terms.html', class: 'footer-link' }, 'Felhasználási feltételek')
        ),
        h('div', { class: 'footer-version', id: 'footerVersion' })
      ));
    }
  }

  function renderAuthArea() {
    const area = $('#authArea');
    if (!area) return;
    area.innerHTML = '';
    if (!state.user) {
      const next = encodeURIComponent(location.pathname + location.search);
      const onAuthPage = ['login', 'register'].includes(document.body.dataset.page);
      area.append(h('a', { class: 'glass-btn', href: onAuthPage ? '/login.html' : `/login.html?next=${next}` },
        h('span', { 'aria-hidden': 'true' }, '👤'), 'Belépés'));
      return;
    }
    const u = state.user;
    const name = u.displayName || u.email.split('@')[0];
    const menu = h('div', { class: 'user-menu' });
    const btn = h('button', { class: 'glass-btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
      h('span', { 'aria-hidden': 'true' }, '👤'), h('span', { class: 'user-name-short' }, name), '▾');
    const list = h('div', { class: 'user-menu-list', role: 'menu' },
      h('div', { class: 'menu-email' }, u.email),
      h('a', { href: '/dashboard.html', role: 'menuitem' }, '📊 Portfólió és kedvencek'),
      h('a', { href: '/account.html', role: 'menuitem' }, '⚙️ Fiók és biztonság'),
      state.links.hidden ? h('a', { href: state.links.hidden, role: 'menuitem' }, '◆ Belső felület') : null,
      state.links.admin ? h('a', { href: state.links.admin, role: 'menuitem' }, '🛡️ Admin') : null,
      h('button', { type: 'button', role: 'menuitem', onclick: logout }, '↩ Kijelentkezés')
    );
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.classList.remove('open'); });
    menu.append(btn, list);
    area.append(menu);
  }

  async function logout() {
    try { await api('POST', '/api/auth/logout'); } catch { /* */ }
    state.user = null;
    state.csrf = null;
    location.href = '/';
  }

  // --- Captcha (Turnstile / reCAPTCHA / hCaptcha) ------------------------------------
  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.async = true; s.defer = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Nem sikerült betölteni: ' + src));
        document.head.append(s);
      });
    }
    return scriptCache[src];
  }

  function waitFor(test, ms = 10000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function tick() {
        const v = test();
        if (v) return resolve(v);
        if (Date.now() - t0 > ms) return reject(new Error('Időtúllépés'));
        setTimeout(tick, 50);
      })();
    });
  }

  // Visszaad egy { getToken(), reset() } objektumot; "none" esetén üres tokent ad.
  async function mountCaptcha(container) {
    const c = state.config && state.config.captcha;
    const none = { getToken: () => '', reset: () => {} };
    if (!c || c.provider === 'none' || !container) return none;
    const theme = currentTheme() === 'dark' ? 'dark' : 'light';
    try {
      if (c.provider === 'turnstile') {
        await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
        const ts = await waitFor(() => window.turnstile);
        const id = ts.render(container, { sitekey: c.siteKey, theme, language: 'hu' });
        return { getToken: () => ts.getResponse(id) || '', reset: () => ts.reset(id) };
      }
      if (c.provider === 'recaptcha') {
        await loadScript('https://www.google.com/recaptcha/api.js?render=explicit&hl=hu');
        const g = await waitFor(() => window.grecaptcha && window.grecaptcha.render && window.grecaptcha);
        const id = g.render(container, { sitekey: c.siteKey, theme });
        return { getToken: () => g.getResponse(id) || '', reset: () => g.reset(id) };
      }
      if (c.provider === 'hcaptcha') {
        await loadScript('https://js.hcaptcha.com/1/api.js?render=explicit&hl=hu');
        const hc = await waitFor(() => window.hcaptcha && window.hcaptcha.render && window.hcaptcha);
        const id = hc.render(container, { sitekey: c.siteKey, theme });
        return { getToken: () => hc.getResponse(id) || '', reset: () => hc.reset(id) };
      }
    } catch (e) {
      container.textContent = 'A captcha nem töltődött be. Frissítsd az oldalt, vagy kapcsold ki a reklámblokkolót erre az oldalra.';
    }
    return none;
  }

  // --- Google bejelentkezés gomb -----------------------------------------------------
  async function mountGoogleButton(container, onCredential, text = 'continue_with') {
    const clientId = state.config && state.config.googleClientId;
    if (!clientId || !container) return false;
    try {
      await loadScript('https://accounts.google.com/gsi/client');
      const g = await waitFor(() => window.google && window.google.accounts && window.google.accounts.id);
      g.initialize({ client_id: clientId, callback: (r) => onCredential(r.credential), ux_mode: 'popup', auto_select: false, itp_support: true });
      g.renderButton(container, {
        theme: currentTheme() === 'dark' ? 'filled_black' : 'outline',
        size: 'large', shape: 'pill', text, locale: 'hu',
        width: Math.min(360, container.clientWidth || 320),
      });
      return true;
    } catch {
      return false;
    }
  }

  // --- Számformázás -------------------------------------------------------------------
  // Ezres elválasztó: aposztróf (1'234,56) vagy szóköz (1 234.56) - a felhasználó választhatja
  const fmtPrefs = () => storageGet('cyc-format', { apostrophe: true });

  function decimalsFor(value, base) {
    const a = Math.abs(value);
    if (!a || !Number.isFinite(a)) return base;
    // Kicsi értéknél legalább 4 értékes jegy látsszon (pl. 1 HUF = 0,002732 USD)
    if (a < 1) return Math.min(12, Math.max(base, Math.ceil(-Math.log10(a)) + 3));
    return base;
  }

  function formatNumber(num, decimals) {
    if (num === null || num === undefined || !Number.isFinite(num)) return '';
    const p = fmtPrefs();
    let [i, d] = num.toFixed(decimals).split('.');
    const neg = i.startsWith('-');
    if (neg) i = i.slice(1);
    i = i.replace(/\B(?=(\d{3})+(?!\d))/g, p.apostrophe ? "'" : ' ');
    if (d) d = d.replace(/0+$/, '').padEnd(Math.min(2, decimals), '0');
    const out = d ? i + (p.apostrophe ? ',' : '.') + d : i;
    return (neg ? '-' : '') + out;
  }

  // Bemenet értelmezése: "1'234,5", "1 234.5", "1.234,5" (európai), "1,234.5" (angol)
  function parseNumber(value) {
    if (value === null || value === undefined) return NaN;
    let s = String(value).trim().replace(/['\s ]/g, '');
    if (!s) return NaN;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      // Amelyik később jön, az a tizedesjel
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      s = s.replace(/,/g, '.');
      if ((s.match(/\./g) || []).length > 1) return NaN;
    }
    if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return NaN;
    return parseFloat(s);
  }

  function formatDate(ms) {
    if (!ms) return '–';
    return new Date(ms).toLocaleString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // Jelszóerősség-mérő (egyszerű becslés, a szerver a végső döntő)
  function passwordScore(pw) {
    if (!pw) return 0;
    let s = Math.min(4, Math.floor(pw.length / 4));
    s += [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    if (/^(.)\1+$/.test(pw) || /^(1234|qwer|asdf|jelszo|password)/i.test(pw)) s = 1;
    return Math.min(8, s);
  }
  function attachPasswordMeter(input, meter) {
    const bar = meter.querySelector('span');
    input.addEventListener('input', () => {
      const s = passwordScore(input.value);
      bar.style.width = (s / 8) * 100 + '%';
      bar.style.background = s < 4 ? '#e53e3e' : s < 6 ? '#d69e2e' : '#38a169';
    });
  }
  function attachPasswordToggles(root = document) {
    $$('.pw-toggle', root).forEach((b) => {
      b.addEventListener('click', () => {
        const input = b.parentElement.querySelector('input');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.textContent = show ? '🙈' : '👁';
        b.setAttribute('aria-label', show ? 'Jelszó elrejtése' : 'Jelszó megjelenítése');
      });
    });
  }

  function safeNext(def = '/dashboard.html') {
    const n = new URLSearchParams(location.search).get('next');
    // Csak saját oldalra irányítunk vissza (nyitott átirányítás ellen)
    if (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\')) return n;
    return def;
  }

  // Bejelentkezést igénylő oldalakon
  function requireLogin() {
    if (!state.user) {
      location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
      return false;
    }
    return true;
  }

  // --- Indítás ------------------------------------------------------------------------
  const ready = (async () => {
    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
    renderShell();
    attachPasswordToggles();
    try {
      const [cfg] = await Promise.all([api('GET', '/api/config'), refreshMe()]);
      state.config = cfg;
      const fv = $('#footerVersion');
      if (fv) fv.textContent = `cYc v${cfg.version}`;
    } catch (e) {
      state.config = state.config || { captcha: { provider: 'none' }, googleClientId: null, registrationEnabled: true, passwordMinLength: 10 };
      renderAuthArea();
    }
    return state;
  })();

  window.cYc = {
    state, ready, api, ApiError, refreshMe, toast, showAlert, hideAlert, busy, h, $, $$,
    storageGet, storageSet, mountCaptcha, mountGoogleButton, formatNumber, parseNumber, decimalsFor,
    formatDate, attachPasswordMeter, attachPasswordToggles, safeNext, requireLogin, fmtPrefs, currentTheme,
  };
})();
