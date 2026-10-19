// Verzio: v0.4.0 - 2026-10-19
// Bejelentkezés, regisztráció, e-mail megerősítés, elfelejtett jelszó és új jelszó oldalak logikája.
// Az aktuális oldalt a <body data-page="..."> dönti el.
(function () {
  'use strict';
  const C = window.cYc;
  const { $ } = C;

  const page = document.body.dataset.page;
  const alertEl = () => $('#formAlert');

  function fail(e) { C.showAlert(alertEl(), e.message || String(e), 'error'); }
  function ok(msg) { C.showAlert(alertEl(), msg, 'success'); }

  // Új Google-fióknál a feltételek elfogadását kérjük, majd ugyanazzal az azonosítóval újrapróbáljuk
  function askTerms() {
    return new Promise((resolve) => {
      const dlg = $('#termsDialog');
      if (!dlg || !dlg.showModal) return resolve(confirm('Új cYc fiók jön létre. Elfogadod a felhasználási feltételeket és az adatvédelmi szabályzatot?'));
      dlg.showModal();
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
    });
  }

  async function googleLogin(credential, acceptTerms) {
    C.hideAlert(alertEl());
    try {
      const r = await C.api('POST', '/api/auth/google', { credential, acceptTerms: !!acceptTerms });
      afterFirstStep(r);
    } catch (e) {
      if (e.code === 'TERMS') {
        if (await askTerms()) return googleLogin(credential, true);
        return C.showAlert(alertEl(), 'Fiók létrehozása nélkül a Google bejelentkezés nem folytatható.', 'info');
      }
      fail(e);
    }
  }

  function afterFirstStep(r) {
    if (r.mfaRequired) return showMfaStep();
    location.href = C.safeNext();
  }

  function showMfaStep() {
    $('#stepPassword') && ($('#stepPassword').hidden = true);
    const step = $('#stepMfa');
    step.hidden = false;
    C.hideAlert(alertEl());
    const input = $('#mfaCode');
    input.focus();
  }

  // --- Bejelentkezés -------------------------------------------------------------
  async function initLogin() {
    if (C.state.user) return location.replace(C.safeNext());
    const captcha = await C.mountCaptcha($('#captchaBox'));
    C.mountGoogleButton($('#googleBox'), (cred) => googleLogin(cred, false), 'signin_with')
      .then((shown) => { if (!shown) $('#googleDivider').hidden = true; });

    if (C.state.mfaPending) showMfaStep();

    const nextQ = new URLSearchParams(location.search).get('next');
    if (nextQ) $('#registerLink').href = '/register.html?next=' + encodeURIComponent(nextQ);

    $('#loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = e.submitter || $('#loginForm button[type=submit]');
      C.busy(btn, async () => {
        C.hideAlert(alertEl());
        try {
          const r = await C.api('POST', '/api/auth/login', {
            email: $('#email').value, password: $('#password').value, captcha: captcha.getToken(),
          });
          afterFirstStep(r);
        } catch (err) {
          captcha.reset();
          if (err.code === 'UNVERIFIED') {
            C.showAlert(alertEl(), err.message, 'warn');
            $('#resendLink').hidden = false;
            $('#resendLink').href = '/verify.html?email=' + encodeURIComponent($('#email').value);
          } else fail(err);
        }
      });
    });

    $('#mfaForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = e.submitter || $('#mfaForm button[type=submit]');
      C.busy(btn, async () => {
        try {
          const r = await C.api('POST', '/api/auth/login/2fa', { code: $('#mfaCode').value });
          if (r.usedRecoveryCode) C.storageSet('cyc-recovery-warning', true);
          location.href = C.safeNext();
        } catch (err) {
          if (err.code === 'NO_MFA') { $('#stepMfa').hidden = true; $('#stepPassword').hidden = false; }
          $('#mfaCode').select();
          fail(err);
        }
      });
    });
    $('#mfaCancel').addEventListener('click', async () => {
      await C.api('POST', '/api/auth/logout').catch(() => {});
      location.reload();
    });
  }

  // --- Regisztráció ----------------------------------------------------------------
  async function initRegister() {
    if (C.state.user) return location.replace(C.safeNext());
    if (C.state.config && C.state.config.registrationEnabled === false) {
      $('#registerForm').hidden = true;
      $('#googleBlock').hidden = true;
      return C.showAlert(alertEl(), 'A regisztráció jelenleg szünetel.', 'info');
    }
    const min = (C.state.config && C.state.config.passwordMinLength) || 10;
    $('#pwHint').textContent = `Legalább ${min} karakter; keverj kis- és nagybetűt, számot vagy írásjelet.`;
    $('#password').minLength = min;
    C.attachPasswordMeter($('#password'), $('#pwMeter'));

    const captcha = await C.mountCaptcha($('#captchaBox'));
    C.mountGoogleButton($('#googleBox'), (cred) => googleLogin(cred, $('#acceptTerms').checked), 'signup_with')
      .then((shown) => { if (!shown) $('#googleBlock').hidden = true; });

    $('#registerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = e.submitter || $('#registerForm button[type=submit]');
      if ($('#password').value !== $('#password2').value) return fail(new Error('A két jelszó nem egyezik.'));
      C.busy(btn, async () => {
        C.hideAlert(alertEl());
        try {
          const r = await C.api('POST', '/api/auth/register', {
            displayName: $('#displayName').value,
            email: $('#email').value,
            password: $('#password').value,
            acceptTerms: $('#acceptTerms').checked,
            captcha: captcha.getToken(),
          });
          if (r.verificationSent) {
            $('#registerForm').hidden = true;
            $('#googleBlock').hidden = true;
            ok('Majdnem kész! Küldtünk egy megerősítő levelet. Kattints a benne lévő linkre a fiók aktiválásához (nézd meg a levélszemét mappát is).');
          } else {
            location.href = C.safeNext();
          }
        } catch (err) {
          captcha.reset();
          fail(err);
        }
      });
    });
  }

  // --- E-mail megerősítés ---------------------------------------------------------------
  async function initVerify() {
    const q = new URLSearchParams(location.search);
    const token = q.get('token');
    if (token) {
      // A token ne maradjon a böngésző előzményeiben
      history.replaceState(null, '', '/verify.html');
      C.showAlert(alertEl(), 'Megerősítés folyamatban...', 'info');
      try {
        const r = await C.api('POST', '/api/auth/verify', { token });
        ok('Az e-mail címed megerősítve. Átirányítunk...');
        setTimeout(() => afterFirstStep(r), 900);
        return;
      } catch (e) {
        fail(e);
      }
    }
    $('#resendBlock').hidden = false;
    if (q.get('email')) $('#email').value = q.get('email');
    const captcha = await C.mountCaptcha($('#captchaBox'));
    $('#resendForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = e.submitter || $('#resendForm button[type=submit]');
      C.busy(btn, async () => {
        try {
          await C.api('POST', '/api/auth/resend-verification', { email: $('#email').value, captcha: captcha.getToken() });
          ok('Ha a cím regisztrálva van és még nincs megerősítve, új levelet küldtünk.');
        } catch (err) { fail(err); }
        captcha.reset();
      });
    });
  }

  // --- Elfelejtett jelszó -------------------------------------------------------------------
  async function initForgot() {
    const captcha = await C.mountCaptcha($('#captchaBox'));
    $('#forgotForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = e.submitter || $('#forgotForm button[type=submit]');
      C.busy(btn, async () => {
        try {
          await C.api('POST', '/api/auth/forgot', { email: $('#email').value, captcha: captcha.getToken() });
          $('#forgotForm').hidden = true;
          ok('Ha ehhez a címhez tartozik fiók, elküldtük a visszaállító linket (1 óráig érvényes).');
        } catch (err) { fail(err); captcha.reset(); }
      });
    });
  }

  // --- Új jelszó ---------------------------------------------------------------------------
  async function initReset() {
    const token = new URLSearchParams(location.search).get('token');
    if (!token) {
      $('#resetForm').hidden = true;
      return fail(new Error('Hiányzó vagy hibás link. Kérj új visszaállító levelet.'));
    }
    history.replaceState(null, '', '/reset.html');
    const min = (C.state.config && C.state.config.passwordMinLength) || 10;
    $('#pwHint').textContent = `Legalább ${min} karakter.`;
    C.attachPasswordMeter($('#password'), $('#pwMeter'));
    $('#resetForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = e.submitter || $('#resetForm button[type=submit]');
      if ($('#password').value !== $('#password2').value) return fail(new Error('A két jelszó nem egyezik.'));
      C.busy(btn, async () => {
        try {
          await C.api('POST', '/api/auth/reset', { token, password: $('#password').value });
          $('#resetForm').hidden = true;
          ok('Az új jelszó beállítva, minden eszközről kiléptettünk. Most már bejelentkezhetsz.');
          $('#afterReset').hidden = false;
        } catch (err) { fail(err); }
      });
    });
  }

  C.ready.then(() => {
    ({ login: initLogin, register: initRegister, verify: initVerify, forgot: initForgot, reset: initReset })[page]?.();
  });
})();
