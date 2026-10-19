// Verzio: v2.0.0 - 2026-10-19
// A támogatott valuták EGYETLEN listája. A frontend is innen kapja (/api/rates -> currencies),
// így új kriptó felvételéhez elég ide egy sort írni.
'use strict';

const CRYPTO = [
  { code: 'BTC', name: 'Bitcoin', cg: 'bitcoin', decimals: 8 },
  { code: 'ETH', name: 'Ethereum', cg: 'ethereum', decimals: 8 },
  { code: 'SOL', name: 'Solana', cg: 'solana', decimals: 6 },
  { code: 'BNB', name: 'BNB', cg: 'binancecoin', decimals: 6 },
  { code: 'XRP', name: 'XRP', cg: 'ripple', decimals: 4 },
  { code: 'ADA', name: 'Cardano', cg: 'cardano', decimals: 4 },
  { code: 'DOGE', name: 'Dogecoin', cg: 'dogecoin', decimals: 4 },
  { code: 'TRX', name: 'TRON', cg: 'tron', decimals: 4 },
  { code: 'LTC', name: 'Litecoin', cg: 'litecoin', decimals: 6 },
  { code: 'USDC', name: 'USD Coin', cg: 'usd-coin', decimals: 2, stable: true },
  { code: 'USDT', name: 'Tether', cg: 'tether', decimals: 2, stable: true },
];

const FIAT = [
  { code: 'USD', name: 'Amerikai dollár', decimals: 2 },
  { code: 'EUR', name: 'Euró', decimals: 2 },
  { code: 'HUF', name: 'Magyar forint', decimals: 0 },
  { code: 'GBP', name: 'Angol font', decimals: 2 },
  { code: 'CHF', name: 'Svájci frank', decimals: 2 },
];

const ALL_CODES = new Set([...CRYPTO, ...FIAT].map((c) => c.code));

function isValidCurrency(code) {
  return typeof code === 'string' && ALL_CODES.has(code);
}

module.exports = { CRYPTO, FIAT, isValidCurrency };
