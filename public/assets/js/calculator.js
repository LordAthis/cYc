// Verzio: v0.4.1 - 2026-10-19
// Árfolyam-kalkulátor: szerveroldali árfolyamokkal, kedvenc párokkal, automatikus előzménnyel,
// megosztható URL-lel (?from=BTC&to=HUF&amount=1) és állítható számformátummal.
// Kompatibilis mód: ha a szerver /api/rates végpontja nem érhető el (nincs Node), a böngésző maga kéri le
// az árfolyamokat a CoinGecko-tól és az ExchangeRate-API-tól - úgy, ahogy a v0.3 verzió tette.
(function () {
  'use strict';
  const C = window.cYc;
  const { $, h } = C;

  const REFRESH_MS = 60e3;
  const HISTORY_SETTLE_MS = 3000;

  const el = {};
  let rates = null;          // { usd, change24h, updatedAt, currencies }
  let meta = {};             // code -> { name, decimals, crypto }
  let favorites = [];
  let refreshTimer = null;
  let debounceTimer = null;
  let historyTimer = null;

  function initElements() {
    for (const id of ['fromCurrency', 'toCurrency', 'fromAmount', 'toAmount', 'swapButton', 'loading', 'error',
      'rateInfo', 'lastUpdated', 'favBtn', 'favRow', 'refreshBtn', 'copyBtn', 'formatBtn', 'changeInfo']) {
      el[id] = document.getElementById(id);
    }
  }

  function fillSelects() {
    const { crypto, fiat } = rates.currencies;
    meta = {};
    for (const c of crypto) meta[c.code] = { ...c, crypto: true };
    for (const f of fiat) meta[f.code] = { ...f, crypto: false };
    for (const sel of [el.fromCurrency, el.toCurrency]) {
      const keep = sel.value;
      sel.innerHTML = '';
      sel.append(
        h('optgroup', { label: 'Kriptovaluták' }, crypto.map((c) => h('option', { value: c.code }, `${c.name} (${c.code})`))),
        h('optgroup', { label: 'Fiat valuták' }, fiat.map((f) => h('option', { value: f.code }, `${f.name} (${f.code})`)))
      );
      if (keep && meta[keep]) sel.value = keep;
    }
  }

  function restoreSelection() {
    const q = new URLSearchParams(location.search);
    const saved = C.storageGet('cyc-last', { from: 'BTC', to: 'HUF', amount: '1' });
    const from = (q.get('from') || saved.from || 'BTC').toUpperCase();
    const to = (q.get('to') || saved.to || 'HUF').toUpperCase();
    el.fromCurrency.value = meta[from] ? from : 'BTC';
    el.toCurrency.value = meta[to] ? to : 'HUF';
    const amt = q.get('amount') ?? saved.amount ?? '1';
    el.fromAmount.value = amt;
    formatInputField();
  }

  function remember() {
    const from = el.fromCurrency.value;
    const to = el.toCurrency.value;
    const raw = C.parseNumber(el.fromAmount.value);
    C.storageSet('cyc-last', { from, to, amount: Number.isFinite(raw) ? String(raw) : '' });
    const q = new URLSearchParams({ from, to });
    if (Number.isFinite(raw) && raw > 0) q.set('amount', String(raw));
    history.replaceState(null, '', '?' + q.toString());
  }

  // Kliensoldali tartalék: ugyanolyan szerkezetű adatot állít elő, mint az /api/rates
  let currencyList = null;
  async function fetchJson(url) {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async function clientRates() {
    if (!currencyList) currencyList = await fetchJson('assets/data/currencies.json');
    const { crypto, fiat } = currencyList;
    const usd = { USD: 1 };
    const change24h = {};
    const prev = rates ? rates.usd : {};
    const [fx, cg] = await Promise.allSettled([
      fetchJson('https://open.er-api.com/v6/latest/USD').catch(() => fetchJson('https://api.exchangerate-api.com/v4/latest/USD')),
      fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${crypto.map((c) => c.cg).join(',')}&vs_currencies=usd&include_24hr_change=true`),
    ]);
    if (fx.status === 'fulfilled') for (const f of fiat) if (f.code !== 'USD' && fx.value.rates[f.code]) usd[f.code] = 1 / fx.value.rates[f.code];
    if (cg.status === 'fulfilled') {
      for (const c of crypto) {
        const row = cg.value[c.cg];
        if (row && typeof row.usd === 'number') usd[c.code] = row.usd;
        if (row && typeof row.usd_24h_change === 'number') change24h[c.code] = row.usd_24h_change;
      }
    }
    for (const k of Object.keys(prev)) if (usd[k] === undefined) usd[k] = prev[k];
    if (Object.keys(usd).length <= 1) throw new Error('Nincs elérhető árfolyam');
    return {
      usd, change24h, updatedAt: Date.now(), stale: false,
      partial: fx.status !== 'fulfilled' || cg.status !== 'fulfilled',
      currencies: { crypto: crypto.map(({ cg: _cg, ...c }) => c), fiat },
    };
  }

  async function loadRates(manual) {
    showLoading(true);
    try {
      let r;
      if (C.state.backend) {
        try { r = await C.api('GET', '/api/rates'); } catch { r = await clientRates(); }
      } else {
        r = await clientRates();
      }
      const first = !rates;
      rates = r;
      if (first) { fillSelects(); restoreSelection(); }
      el.lastUpdated.textContent = `Utolsó frissítés: ${new Date(r.updatedAt).toLocaleString('hu-HU')}`
        + (r.stale ? ' (a forrás most nem elérhető, a legutóbbi adat látszik)' : '')
        + (r.partial ? ' (részleges frissítés)' : '');
      hideError();
      calculate();
      if (manual) C.toast('Árfolyamok frissítve');
    } catch (e) {
      showError(rates ? 'Az árfolyamok frissítése most nem sikerült, a legutóbbi adatokkal számolunk.' : 'Nem sikerült betölteni az árfolyamokat. Kérjük, próbáld újra később.');
    } finally {
      showLoading(false);
    }
  }

  function rateOf(from, to) {
    if (!rates) return null;
    const a = rates.usd[from];
    const b = rates.usd[to];
    if (!a || !b) return null;
    return a / b;
  }

  function calculate() {
    if (!rates) return;
    const from = el.fromCurrency.value;
    const to = el.toCurrency.value;
    const amount = C.parseNumber(el.fromAmount.value);
    updateFavButton();
    remember();

    const rate = rateOf(from, to);
    if (rate === null) {
      el.toAmount.value = '';
      showError('Ehhez a párhoz most nincs árfolyam.');
      return;
    }
    hideError();
    const baseDec = (meta[to] && meta[to].decimals) ?? 2;
    el.rateInfo.textContent = `1 ${from} = ${C.formatNumber(rate, C.decimalsFor(rate, baseDec))} ${to}`;
    renderChange(from, to);

    if (!Number.isFinite(amount) || amount <= 0) {
      el.toAmount.value = '';
      return;
    }
    const result = amount * rate;
    el.toAmount.value = C.formatNumber(result, C.decimalsFor(result, baseDec));
    scheduleHistory(from, to, amount);
  }

  function renderChange(from, to) {
    el.changeInfo.innerHTML = '';
    const ch = rates.change24h || {};
    const show = (code) => {
      if (typeof ch[code] !== 'number') return null;
      const v = ch[code];
      return h('span', { class: 'change ' + (v >= 0 ? 'up' : 'down') }, `${code} 24 óra: ${v >= 0 ? '▲ +' : '▼ '}${v.toFixed(2).replace('.', ',')}%`);
    };
    const parts = [show(from), show(to)].filter(Boolean);
    parts.forEach((p, i) => { if (i) el.changeInfo.append(' · '); el.changeInfo.append(p); });
  }

  // Bejelentkezve: a megállapodott számítás bekerül az előzményekbe (a szerver számol újra)
  function scheduleHistory(from, to, amount) {
    clearTimeout(historyTimer);
    if (!C.state.user) return;
    historyTimer = setTimeout(() => {
      C.api('POST', '/api/me/history', { from, to, amount }).catch(() => {});
    }, HISTORY_SETTLE_MS);
  }

  function debounceCalculate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(calculate, 250);
  }

  function formatInputField() {
    const v = C.parseNumber(el.fromAmount.value);
    if (Number.isFinite(v) && v > 0) {
      const dec = (meta[el.fromCurrency.value] && meta[el.fromCurrency.value].decimals) ?? 2;
      el.fromAmount.value = C.formatNumber(v, C.decimalsFor(v, Math.max(dec, 8)));
    }
  }
  function cleanInputField() {
    const v = C.parseNumber(el.fromAmount.value);
    const raw = Number.isFinite(v) ? String(v).replace('.', C.fmtPrefs().apostrophe ? ',' : '.') : el.fromAmount.value;
    // Csak akkor írjuk át, ha tényleg más (különben elveszne a kurzor / kijelölés), majd kijelöljük
    if (raw !== el.fromAmount.value) el.fromAmount.value = raw;
    requestAnimationFrame(() => { if (document.activeElement === el.fromAmount) el.fromAmount.select(); });
  }

  function swapCurrencies() {
    const f = el.fromCurrency.value;
    el.fromCurrency.value = el.toCurrency.value;
    el.toCurrency.value = f;
    calculate();
  }

  // --- Kedvencek -------------------------------------------------------------------
  async function loadFavorites() {
    if (!C.state.user) { favorites = []; renderFavorites(); return; }
    try {
      favorites = (await C.api('GET', '/api/me/favorites')).favorites;
    } catch { favorites = []; }
    renderFavorites();
  }

  function renderFavorites() {
    el.favRow.innerHTML = '';
    for (const f of favorites) {
      const active = f.from === el.fromCurrency.value && f.to === el.toCurrency.value;
      const chip = h('button', { type: 'button', class: 'chip' + (active ? ' active' : ''), title: 'Pár kiválasztása' },
        `★ ${f.from} → ${f.to}`,
        h('span', { class: 'x', title: 'Eltávolítás', role: 'button', 'aria-label': `${f.from}-${f.to} kedvenc törlése` }, '✕'));
      chip.addEventListener('click', async (e) => {
        if (e.target.classList.contains('x')) {
          e.stopPropagation();
          await C.api('DELETE', `/api/me/favorites/${f.id}`).catch((err) => C.toast(err.message, 'error'));
          return loadFavorites().then(updateFavButton);
        }
        el.fromCurrency.value = f.from;
        el.toCurrency.value = f.to;
        calculate();
        renderFavorites();
      });
      el.favRow.append(chip);
    }
  }

  function currentFav() {
    return favorites.find((f) => f.from === el.fromCurrency.value && f.to === el.toCurrency.value);
  }
  function updateFavButton() {
    const fav = currentFav();
    el.favBtn.textContent = fav ? '★ Kedvenc' : '☆ Kedvencekhez';
    el.favBtn.classList.toggle('active', !!fav);
    renderFavorites();
  }

  async function toggleFavorite() {
    if (!C.state.user) {
      C.toast('A kedvencek mentéséhez jelentkezz be.');
      return;
    }
    const fav = currentFav();
    try {
      if (fav) await C.api('DELETE', `/api/me/favorites/${fav.id}`);
      else await C.api('POST', '/api/me/favorites', { from: el.fromCurrency.value, to: el.toCurrency.value });
      await loadFavorites();
      updateFavButton();
    } catch (e) { C.toast(e.message, 'error'); }
  }

  // --- Egyéb ---------------------------------------------------------------------------
  async function copyResult() {
    if (!el.toAmount.value) return;
    try {
      await navigator.clipboard.writeText(`${el.toAmount.value} ${el.toCurrency.value}`);
      C.toast('Eredmény a vágólapon');
    } catch { el.toAmount.select(); }
  }

  function updateFormatButton() {
    const p = C.fmtPrefs();
    el.formatBtn.textContent = p.apostrophe ? "1'234,56" : '1 234.56';
  }
  function toggleFormat() {
    const p = C.fmtPrefs();
    C.storageSet('cyc-format', { apostrophe: !p.apostrophe });
    updateFormatButton();
    formatInputField();
    calculate();
  }

  function showLoading(v) { el.loading.style.display = v ? 'block' : 'none'; }
  function showError(m) { C.showAlert(el.error, m, 'error'); }
  function hideError() { C.hideAlert(el.error); }

  function startAutoRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => { if (!document.hidden) loadRates(false); }, REFRESH_MS);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initElements();
    el.fromAmount.addEventListener('input', debounceCalculate);
    el.fromAmount.addEventListener('blur', formatInputField);
    el.fromAmount.addEventListener('focus', cleanInputField);
    el.fromAmount.addEventListener('keydown', (e) => { if (e.key === 'Enter') { el.fromAmount.blur(); } });
    el.fromCurrency.addEventListener('change', calculate);
    el.toCurrency.addEventListener('change', calculate);
    el.swapButton.addEventListener('click', swapCurrencies);
    el.favBtn.addEventListener('click', toggleFavorite);
    el.refreshBtn.addEventListener('click', () => loadRates(true));
    el.copyBtn.addEventListener('click', copyResult);
    el.formatBtn.addEventListener('click', toggleFormat);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && rates && Date.now() - rates.updatedAt > REFRESH_MS) loadRates(false);
    });
    updateFormatButton();

    await C.ready;
    if (!C.state.backend) el.favBtn.hidden = true; // statikus módban nincs fiók, így kedvenc sem
    await loadRates(false);
    await loadFavorites();
    updateFavButton();
    startAutoRefresh();
  });
})();
