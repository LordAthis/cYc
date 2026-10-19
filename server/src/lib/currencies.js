// Verzio: v0.4.1 - 2026-10-19
// A támogatott valuták EGYETLEN forrása: public/assets/data/currencies.json.
// A szerver innen olvassa, és a statikus (Node nélküli) kompatibilis mód is ugyanezt a fájlt tölti be,
// így új kriptó felvételéhez elég oda egy sort írni.
'use strict';

const path = require('path');
const fs = require('fs');

const file = path.join(__dirname, '..', '..', '..', 'public', 'assets', 'data', 'currencies.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const CRYPTO = data.crypto;
const FIAT = data.fiat;

const ALL_CODES = new Set([...CRYPTO, ...FIAT].map((c) => c.code));

function isValidCurrency(code) {
  return typeof code === 'string' && ALL_CODES.has(code);
}

module.exports = { CRYPTO, FIAT, isValidCurrency };
