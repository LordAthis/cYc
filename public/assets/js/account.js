// Verzio: v0.4.0 - 2026-10-19
// Fiók és biztonság: profil, jelszó, kétlépcsős azonosítás (TOTP), Google összekapcsolás,
// aktív munkamenetek, adatexport, fióktörlés.
(function () {
  'use strict';
  const C = window.cYc;
  const { $, h } = C;

  let user = null;
  let recoveryLeft = 0;

  async function reload() {
    const r = await C.api('GET', '/api/account');
    user = r.user;
    recoveryLeft = r.recoveryCodesLeft;
    C.state.user = user;
    render();
  }

  function render() {
    $('#accEmail').value = user.email;
    $('#accName').value = user.displayName || '';
    $('#emailBadge').replaceChildren(h('span', { class: 'badge ' + (user.emailVerified ? 'on' : 'off') }, user.emailVerified ? 'megerősítve' : 'nincs megerősítve'));

    // Jelszó: ha nincs (csak Google), "beállítás" mód
    $('#currentPwField').hidden = !user.hasPassword;
    $('#pwTitle').textContent = user.hasPassword ? 'Jelszó módosítása' : 'Jelszó beállítása';
    $('#pwInfo').textContent = user.hasPassword ? '' : 'Jelenleg csak Google-lel lépsz be. Ha jelszót is beállítasz, e-mail címmel is be tudsz lépni.';

    // 2FA
    const on = user.totpEnabled;
    $('#tfaBadge').replaceChildren(h('span', { class: 'badge ' + (on ? 'on' : 'off') }, on ? 'bekapcsolva' : 'kikapcsolva'));
    $('#tfaOff').hidden = on;
    $('#tfaOn').hidden = !on;
    $('#tfaSetup').hidden = true;
    $('#recoveryLeft').textContent = String(recoveryLeft);
    $('#tfaDisablePwField').hidden = !user.hasPassword;

    // Google
    $('#googleBadge').replaceChildren(h('span', { class: 'badge ' + (user.googleLinked ? 'on' : '') }, user.googleLinked ? 'összekapcsolva' : 'nincs összekapcsolva'));
    $('#googleUnlink').hidden = !user.googleLinked;
    $('#googleLinkBox').hidden = user.googleLinked;

    // Törlés
    $('#delPwField').hidden = !user.hasPassword;
    $('#delCodeField').hidden = user.hasPassword || !user.totpEnabled;
    $('#delConfirmField').hidden = user.hasPassword || user.totpEnabled;
  }

  function showCodes(codes) {
    const box = $('#codesBox');
    box.replaceChildren(h('div', { class: 'codes-grid' }, codes.map((c) => h('div', {}, c))));
    $('#codesDialog').showModal();
    $('#codesCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(codes.join('\n')); C.toast('Kódok a vágólapon'); } catch { /* */ }
    };
    $('#codesDownload').onclick = () => {
      const a = h('a', { href: URL.createObjectURL(new Blob([`cYc visszaallito kodok (${user.email})\r\n\r\n${codes.join('\r\n')}\r\n`], { type: 'text/plain' })), download: 'cyc-visszaallito-kodok.txt' });
      document.body.append(a); a.click(); a.remove();
    };
  }

  function bindForm(sel, fn) {
    $(sel).addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = e.submitter || $(sel + ' button[type=submit]');
      C.busy(btn, async () => {
        try { await fn(e); } catch (err) { C.toast(err.message, 'error'); }
      });
    });
  }

  async function loadSessions() {
    const { sessions } = await C.api('GET', '/api/account/sessions');
    const tbody = $('#sessionsBody');
    tbody.innerHTML = '';
    for (const s of sessions) {
      tbody.append(h('tr', {},
        h('td', {}, shortUa(s.userAgent), s.current ? [' ', h('span', { class: 'badge on' }, 'ez az eszköz')] : null),
        h('td', {}, s.ip || '–'),
        h('td', {}, C.formatDate(s.lastSeen))));
    }
  }
  function shortUa(ua) {
    if (!ua) return 'Ismeretlen eszköz';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Egyéb';
    const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Böngésző';
    return `${br} · ${os}`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await C.ready;
    if (!C.requireLogin()) return;
    C.attachPasswordMeter($('#newPw'), $('#pwMeter'));
    await reload();
    loadSessions().catch(() => {});

    bindForm('#profileForm', async () => {
      await C.api('PATCH', '/api/account/profile', { displayName: $('#accName').value });
      await C.refreshMe();
      C.toast('Profil mentve');
    });

    bindForm('#pwForm', async () => {
      if ($('#newPw').value !== $('#newPw2').value) throw new Error('A két új jelszó nem egyezik.');
      await C.api('POST', '/api/account/password', { currentPassword: $('#curPw').value, newPassword: $('#newPw').value });
      $('#pwForm').reset();
      await reload();
      C.toast('Jelszó mentve. A többi eszközről kiléptettünk.');
    });

    // 2FA bekapcsolás: 1) titok + QR, 2) kód ellenőrzése, 3) visszaállító kódok
    $('#tfaStart').addEventListener('click', (e) => C.busy(e.currentTarget, async () => {
      try {
        const r = await C.api('POST', '/api/account/2fa/setup');
        $('#tfaQr').src = r.qrDataUrl;
        $('#tfaSecret').textContent = r.secret.replace(/(.{4})/g, '$1 ').trim();
        $('#tfaOff').hidden = true;
        $('#tfaSetup').hidden = false;
        $('#tfaCode').focus();
      } catch (err) { C.toast(err.message, 'error'); }
    }));
    $('#tfaCancel').addEventListener('click', () => { $('#tfaSetup').hidden = true; $('#tfaOff').hidden = false; });
    bindForm('#tfaEnableForm', async () => {
      const r = await C.api('POST', '/api/account/2fa/enable', { code: $('#tfaCode').value });
      $('#tfaEnableForm').reset();
      await reload();
      showCodes(r.recoveryCodes);
    });
    bindForm('#tfaDisableForm', async () => {
      if (!confirm('Biztosan kikapcsolod a kétlépcsős azonosítást? A fiókod kevésbé lesz védett.')) return;
      await C.api('POST', '/api/account/2fa/disable', { code: $('#tfaDisableCode').value, password: $('#tfaDisablePw').value });
      $('#tfaDisableForm').reset();
      await reload();
      C.toast('2FA kikapcsolva');
    });
    bindForm('#tfaRegenForm', async () => {
      const r = await C.api('POST', '/api/account/2fa/recovery-codes', { code: $('#tfaRegenCode').value });
      $('#tfaRegenForm').reset();
      await reload();
      showCodes(r.recoveryCodes);
    });

    // Google
    C.mountGoogleButton($('#googleLinkBox'), async (credential) => {
      try {
        await C.api('POST', '/api/account/google/link', { credential });
        await reload();
        C.toast('Google fiók összekapcsolva');
      } catch (err) { C.toast(err.message, 'error'); }
    }, 'continue_with').then((shown) => {
      if (!shown && !user.googleLinked) $('#googleSection').hidden = true;
    });
    $('#googleUnlink').addEventListener('click', async () => {
      if (!confirm('Leválasztod a Google fiókot?')) return;
      try { await C.api('POST', '/api/account/google/unlink'); await reload(); C.toast('Leválasztva'); } catch (err) { C.toast(err.message, 'error'); }
    });

    $('#revokeOthers').addEventListener('click', async () => {
      try { await C.api('POST', '/api/account/sessions/revoke-others'); await loadSessions(); C.toast('A többi eszközről kiléptettünk.'); } catch (err) { C.toast(err.message, 'error'); }
    });

    $('#exportBtn').addEventListener('click', () => { location.href = '/api/account/export'; });

    $('#deleteBtn').addEventListener('click', () => $('#deleteDialog').showModal());
    $('#deleteCancel').addEventListener('click', () => $('#deleteDialog').close());
    bindForm('#deleteForm', async () => {
      await C.api('DELETE', '/api/account', {
        password: $('#delPw').value, code: $('#delCode').value, confirm: $('#delConfirm').value.trim().toUpperCase(),
      });
      location.href = '/?torolve=1';
    });
  });
})();
