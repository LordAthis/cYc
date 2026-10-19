// Verzio: v2.0.0 - 2026-10-19
// Árfolyamok szerveroldali lekérése és gyorsítótárazása.
// Minden ár USD-ben tárolódik (usd[code] = 1 egység ára dollárban), így bármely pár
// egyetlen osztással számolható, és a kliensek nem terhelik közvetlenül a CoinGecko-t.
'use strict';

const config = require('../config');
const { CRYPTO, FIAT } = require('./currencies');

let cache = null;      // { usd: {...}, updatedAt, source }
let inflight = null;

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} - ${url}`);
  return r.json();
}

function mockRates() {
  const usd = { USD: 1, EUR: 1.08, HUF: 1 / 365, GBP: 1.27, CHF: 1.12 };
  const p = { BTC: 98000, ETH: 3600, SOL: 180, BNB: 620, XRP: 0.6, ADA: 0.45, DOGE: 0.15, TRX: 0.25, LTC: 85, USDC: 1, USDT: 1 };
  const change24h = {};
  for (const c of CRYPTO) {
    usd[c.code] = p[c.code];
    change24h[c.code] = c.stable ? 0.01 : Math.round((Math.sin(c.code.length * 7) * 600)) / 100;
  }
  return { usd, change24h, updatedAt: Date.now(), source: 'mock' };
}

async function fetchFiat() {
  // Elsődleges: open.er-api.com, tartalék: exchangerate-api.com v4
  const urls = ['https://open.er-api.com/v6/latest/USD', 'https://api.exchangerate-api.com/v4/latest/USD'];
  let lastErr;
  for (const u of urls) {
    try {
      const d = await getJson(u);
      if (d && d.rates && d.rates.EUR) return d.rates;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Fiat arfolyam nem elerheto');
}

async function fetchCrypto() {
  const ids = CRYPTO.map((c) => c.cg).join(',');
  const headers = config.rates.coingeckoKey ? { 'x-cg-demo-api-key': config.rates.coingeckoKey } : {};
  return getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`, headers);
}

async function refresh() {
  if (config.rates.mock) return mockRates();

  const [fiatRes, cryptoRes] = await Promise.allSettled([fetchFiat(), fetchCrypto()]);
  const usd = { USD: 1 };
  const change24h = {};
  const prev = cache ? cache.usd : {};

  if (fiatRes.status === 'fulfilled') {
    // rates[X] = hány X ér 1 USD-t -> 1 X = 1/rates[X] USD
    for (const f of FIAT) if (f.code !== 'USD' && fiatRes.value[f.code]) usd[f.code] = 1 / fiatRes.value[f.code];
  } else {
    console.error('[cYc] Fiat arfolyam hiba:', fiatRes.reason && fiatRes.reason.message);
  }
  if (cryptoRes.status === 'fulfilled') {
    for (const c of CRYPTO) {
      const row = cryptoRes.value[c.cg];
      if (row && typeof row.usd === 'number') {
        usd[c.code] = row.usd;
        if (typeof row.usd_24h_change === 'number') change24h[c.code] = row.usd_24h_change;
      }
    }
  } else {
    console.error('[cYc] Kripto arfolyam hiba:', cryptoRes.reason && cryptoRes.reason.message);
  }

  // Ami most nem jött meg, azt a korábbi értékből pótoljuk (részleges kiesésnél is működjön)
  for (const k of Object.keys(prev)) if (usd[k] === undefined) usd[k] = prev[k];

  if (Object.keys(usd).length <= 1) throw new Error('Egyik arfolyam-forras sem elerheto');
  const partial = fiatRes.status !== 'fulfilled' || cryptoRes.status !== 'fulfilled';
  return { usd, change24h: Object.keys(change24h).length ? change24h : (cache && cache.change24h) || {}, updatedAt: Date.now(), source: 'live', partial };
}

async function getRates() {
  const maxAge = config.rates.cacheSeconds * 1000;
  if (cache && Date.now() - cache.updatedAt < maxAge) return cache;
  if (!inflight) {
    inflight = refresh()
      .then((r) => { cache = r; return r; })
      .catch((e) => {
        console.error('[cYc] Arfolyam frissites sikertelen:', e.message);
        if (cache) return { ...cache, stale: true };
        throw e;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

function convert(rates, from, to, amount) {
  const a = rates.usd[from];
  const b = rates.usd[to];
  if (!a || !b) return null;
  return (amount * a) / b;
}

module.exports = { getRates, convert };
