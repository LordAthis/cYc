// Verzio: v0.4.0 - 2026-10-19
// Admin panel: felhasználók kezelése (rejtett felület egyedi engedélyezése, tiltás, szerepkör), napló.
(function () {
  'use strict';
  const C = window.cYc;
  const { $, h } = C;

  async function patch(id, body) {
    try {
      await C.api('PATCH', `/api/admin/users/${id}`, body);
      C.toast('Mentve');
    } catch (e) { C.toast(e.message, 'error'); }
    loadUsers();
  }

  function toggle(checked, onChange, label) {
    const cb = h('input', { type: 'checkbox', 'aria-label': label });
    cb.checked = checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'check' }, cb);
  }

  async function loadUsers() {
    const q = $('#search').value.trim();
    const { users } = await C.api('GET', '/api/admin/users' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    const tbody = $('#usersBody');
    tbody.innerHTML = '';
    const me = C.state.user.id;
    for (const u of users) {
      tbody.append(h('tr', {},
        h('td', {}, h('strong', {}, u.email), u.displayName ? h('div', { class: 'hint' }, u.displayName) : null,
          u.google ? h('span', { class: 'badge' }, 'Google') : null),
        h('td', {}, u.role === 'admin' ? h('span', { class: 'badge on' }, 'admin') : 'user'),
        h('td', {}, u.role === 'admin' ? h('span', { class: 'hint' }, 'mindig') : toggle(u.hiddenAccess, (v) => patch(u.id, { hiddenAccess: v }), `Rejtett felület: ${u.email}`)),
        h('td', {}, h('span', { class: 'badge ' + (u.totpEnabled ? 'on' : '') }, u.totpEnabled ? 'be' : 'ki')),
        h('td', {},
          u.disabled ? h('span', { class: 'badge off' }, 'tiltva') : h('span', { class: 'badge on' }, 'aktív'),
          !u.emailVerified ? h('div', { class: 'hint' }, 'nincs megerősítve') : null),
        h('td', {}, C.formatDate(u.lastLoginAt)),
        h('td', { class: 'num' },
          u.id === me ? h('span', { class: 'hint' }, '(te)') : [
            h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => patch(u.id, { disabled: !u.disabled }) }, u.disabled ? 'Engedélyez' : 'Letilt'), ' ',
            h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => {
              if (confirm(`${u.email} szerepköre legyen: ${u.role === 'admin' ? 'user' : 'admin'}?`)) patch(u.id, { role: u.role === 'admin' ? 'user' : 'admin' });
            } }, u.role === 'admin' ? 'Admin jog el' : 'Adminná'), ' ',
            h('button', { class: 'btn btn-secondary btn-small', type: 'button', title: 'Zárolás feloldása', onclick: () => patch(u.id, { unlock: true }) }, '🔓'),
            !u.emailVerified ? [' ', h('button', { class: 'btn btn-secondary btn-small', type: 'button', title: 'E-mail kézi megerősítése', onclick: () => patch(u.id, { verifyEmail: true }) }, '✓')] : null,
          ])
      ));
    }
    if (!users.length) tbody.append(h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'Nincs találat.')));
  }

  async function loadAudit() {
    const { events } = await C.api('GET', '/api/admin/audit');
    const tbody = $('#auditBody');
    tbody.innerHTML = '';
    for (const e of events) {
      tbody.append(h('tr', {}, h('td', {}, C.formatDate(e.created_at)), h('td', {}, e.event), h('td', {}, e.email || '–'), h('td', {}, e.ip || '–'), h('td', { class: 'hint' }, e.detail || '')));
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await C.ready;
    if (!C.requireLogin()) return;
    let t;
    $('#search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadUsers, 300); });
    loadUsers().catch((e) => C.toast(e.message, 'error'));
    loadAudit().catch(() => {});
  });
})();
