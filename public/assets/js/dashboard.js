// Verzio: v2.0.0 - 2026-10-19
// Irányítópult: portfólió (saját kripto-állomány értéke), kedvenc párok élő árfolyammal, előzmények.
// Minden adat a szerveren van, így minden eszközön ugyanaz látszik.
(function () {
  'use strict';
  const C = window.cYc;
  const { $, h } = C;

  let rates = null;
  let meta = {};

  const fmt = (v, code) => {
    const d = (meta[code] && meta[code].decimals) ?? 2;
    return C.formatNumber(v, C.decimalsFor(v, d));
  };
  const rateOf = (a, b) => (rates && rates.usd[a] && rates.usd[b] ? rates.usd[a] / rates.usd[b] : null);

  function currencyOptions(select, selected) {
    select.innerHTML = '';
    select.append(
      h('optgroup', { label: 'Kriptovaluták' }, rates.currencies.crypto.map((c) => h('option', { value: c.code }, `${c.code} – ${c.name}`))),
      h('optgroup', { label: 'Fiat valuták' }, rates.currencies.fiat.map((c) => h('option', { value: c.code }, `${c.code} – ${c.name}`)))
    );
    if (selected) select.value = selected;
  }

  function changeBadge(v) {
    if (typeof v !== 'number') return '–';
    return h('span', { class: 'change ' + (v >= 0 ? 'up' : 'down') }, `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}%`);
  }

  // --- Portfólió --------------------------------------------------------------------
  async function loadPortfolio() {
    const base = $('#baseCurrency').value;
    C.storageSet('cyc-portfolio-base', base);
    const tbody = $('#portfolioBody');
    try {
      const r = await C.api('GET', `/api/me/portfolio?base=${encodeURIComponent(base)}`);
      tbody.innerHTML = '';
      if (!r.items.length) {
        tbody.append(h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'Még nincs tétel. Add hozzá az első kriptódat lent.')));
      }
      for (const it of r.items) tbody.append(holdingRow(it, base));
      $('#portfolioTotal').textContent = r.total === null ? '–' : `${fmt(r.total, base)} ${base}`;
      $('#statTotal').textContent = r.total === null ? '–' : `${fmt(r.total, base)} ${base}`;
      $('#statCount').textContent = String(r.items.length);
    } catch (e) {
      C.toast(e.message, 'error');
    }
  }

  function holdingRow(it, base) {
    const tr = h('tr', {},
      h('td', {}, h('strong', {}, it.currency), meta[it.currency] ? h('div', { class: 'hint' }, meta[it.currency].name) : null),
      h('td', { class: 'num' }, fmt(it.amount, it.currency)),
      h('td', {}, it.note || ''),
      h('td', { class: 'num' }, it.value === null ? '–' : `${fmt(it.value, base)} ${base}`),
      h('td', { class: 'num' }, changeBadge(it.change24h)),
      h('td', { class: 'num' },
        h('button', { class: 'btn btn-secondary btn-small', type: 'button', title: 'Szerkesztés', onclick: () => editHolding(tr, it) }, '✎'),
        ' ',
        h('button', { class: 'btn btn-secondary btn-small', type: 'button', title: 'Törlés', onclick: () => deleteHolding(it) }, '🗑'))
    );
    return tr;
  }

  function editHolding(tr, it) {
    const amount = h('input', { class: 'input', value: String(it.amount), inputmode: 'decimal', 'aria-label': 'Mennyiség' });
    const note = h('input', { class: 'input', value: it.note || '', maxlength: 80, 'aria-label': 'Megjegyzés' });
    tr.children[1].replaceChildren(amount);
    tr.children[2].replaceChildren(note);
    tr.children[5].replaceChildren(
      h('button', { class: 'btn btn-small', type: 'button', onclick: async () => {
        const v = C.parseNumber(amount.value);
        if (!Number.isFinite(v) || v < 0) return C.toast('Érvénytelen mennyiség.', 'error');
        try {
          await C.api('PUT', `/api/me/portfolio/${it.id}`, { amount: v, note: note.value });
          loadPortfolio();
        } catch (e) { C.toast(e.message, 'error'); }
      } }, 'Mentés'),
      ' ',
      h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: loadPortfolio }, 'Mégse'));
    amount.focus();
  }

  async function deleteHolding(it) {
    if (!confirm(`Törlöd ezt a tételt: ${it.currency} ${fmt(it.amount, it.currency)}?`)) return;
    try { await C.api('DELETE', `/api/me/portfolio/${it.id}`); loadPortfolio(); } catch (e) { C.toast(e.message, 'error'); }
  }

  // --- Kedvencek -------------------------------------------------------------------------
  async function loadFavorites() {
    const box = $('#favList');
    try {
      const { favorites } = await C.api('GET', '/api/me/favorites');
      box.innerHTML = '';
      if (!favorites.length) {
        box.append(h('p', { class: 'empty' }, 'Nincs kedvenc pár. A kalkulátorban a ☆ gombbal adhatsz hozzá.'));
        return;
      }
      const tbody = h('tbody');
      for (const f of favorites) {
        const r = rateOf(f.from, f.to);
        tbody.append(h('tr', {},
          h('td', {}, h('a', { href: `/?from=${f.from}&to=${f.to}&amount=1` }, `${f.from} → ${f.to}`)),
          h('td', { class: 'num' }, r === null ? '–' : `1 ${f.from} = ${fmt(r, f.to)} ${f.to}`),
          h('td', { class: 'num' }, h('button', { class: 'btn btn-secondary btn-small', type: 'button', title: 'Törlés', onclick: async () => {
            await C.api('DELETE', `/api/me/favorites/${f.id}`).catch((e) => C.toast(e.message, 'error'));
            loadFavorites();
          } }, '✕'))
        ));
      }
      box.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, tbody)));
    } catch (e) { C.toast(e.message, 'error'); }
  }

  // --- Előzmények --------------------------------------------------------------------------
  let historyCache = [];
  async function loadHistory() {
    const tbody = $('#historyBody');
    try {
      const { history } = await C.api('GET', '/api/me/history?limit=200');
      historyCache = history;
      tbody.innerHTML = '';
      if (!history.length) {
        tbody.append(h('tr', {}, h('td', { colspan: 5, class: 'empty' }, 'Még nincs előzmény. A bejelentkezve végzett számítások automatikusan ide kerülnek.')));
      }
      for (const it of history) {
        tbody.append(h('tr', {},
          h('td', {}, C.formatDate(it.createdAt)),
          h('td', { class: 'num' }, `${fmt(it.amount, it.from)} ${it.from}`),
          h('td', { class: 'num' }, `${fmt(it.result, it.to)} ${it.to}`),
          h('td', { class: 'num hint' }, `1 ${it.from} = ${fmt(it.rate, it.to)} ${it.to}`),
          h('td', { class: 'num' },
            h('a', { class: 'btn btn-secondary btn-small', href: `/?from=${it.from}&to=${it.to}&amount=${it.amount}`, title: 'Újraszámolás mai árfolyammal' }, '↻'),
            ' ',
            h('button', { class: 'btn btn-secondary btn-small', type: 'button', title: 'Törlés', onclick: async () => {
              await C.api('DELETE', `/api/me/history/${it.id}`).catch(() => {});
              loadHistory();
            } }, '✕'))
        ));
      }
    } catch (e) { C.toast(e.message, 'error'); }
  }

  function exportHistoryCsv() {
    if (!historyCache.length) return C.toast('Nincs exportálható előzmény.');
    const rows = [['datum', 'forras', 'osszeg', 'cel', 'eredmeny', 'arfolyam']];
    for (const it of historyCache) rows.push([new Date(it.createdAt).toISOString(), it.from, it.amount, it.to, it.result, it.rate]);
    const csv = rows.map((r) => r.join(';')).join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'cyc-elozmenyek.csv' });
    document.body.append(a); a.click(); a.remove();
  }

  // --- Indítás ---------------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    await C.ready;
    if (!C.requireLogin()) return;
    const u = C.state.user;
    $('#hello').textContent = `Szia, ${u.displayName || u.email.split('@')[0]}!`;
    if (C.storageGet('cyc-recovery-warning', false)) {
      C.showAlert($('#dashAlert'), 'Visszaállító kóddal léptél be. Ha elveszett a telefonod, a Fiók oldalon kapcsold ki, majd állítsd be újra a 2FA-t, vagy generálj új kódokat.', 'warn');
      C.storageSet('cyc-recovery-warning', false);
    }

    try {
      rates = await C.api('GET', '/api/rates');
      for (const c of rates.currencies.crypto) meta[c.code] = c;
      for (const c of rates.currencies.fiat) meta[c.code] = c;
    } catch {
      rates = { usd: {}, currencies: { crypto: [], fiat: [{ code: 'HUF', name: 'Magyar forint', decimals: 0 }] } };
      C.showAlert($('#dashAlert'), 'Az árfolyamok most nem érhetők el; az értékek később jelennek meg.', 'warn');
    }

    currencyOptions($('#baseCurrency'), C.storageGet('cyc-portfolio-base', 'HUF'));
    currencyOptions($('#newCurrency'), 'BTC');
    $('#baseCurrency').addEventListener('change', loadPortfolio);

    $('#addHolding').addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = C.parseNumber($('#newAmount').value);
      if (!Number.isFinite(amount) || amount < 0) return C.toast('Érvénytelen mennyiség.', 'error');
      const btn = e.submitter || $('#addHolding button');
      await C.busy(btn, async () => {
        try {
          await C.api('POST', '/api/me/portfolio', { currency: $('#newCurrency').value, amount, note: $('#newNote').value });
          $('#newAmount').value = '';
          $('#newNote').value = '';
          await loadPortfolio();
        } catch (err) { C.toast(err.message, 'error'); }
      });
    });

    $('#clearHistory').addEventListener('click', async () => {
      if (!confirm('Biztosan törlöd az összes előzményt?')) return;
      await C.api('DELETE', '/api/me/history').catch((e) => C.toast(e.message, 'error'));
      loadHistory();
    });
    $('#exportHistory').addEventListener('click', exportHistoryCsv);

    await Promise.all([loadPortfolio(), loadFavorites(), loadHistory()]);
  });
})();
