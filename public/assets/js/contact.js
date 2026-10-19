// Verzio: v0.4.0 - 2026-10-19
// Kapcsolati űrlap: captchával védve, a szerver e-mailben továbbítja (CONTACT_TO).
(function () {
  'use strict';
  const C = window.cYc;
  const { $ } = C;

  C.ready.then(async () => {
    const alertEl = $('#formAlert');
    if (C.state.config && !C.state.config.contactEnabled) {
      C.showAlert(alertEl, 'Az üzenetküldés jelenleg nem elérhető. Kérjük, használd a GitHub Issues felületet.', 'info');
      $('#contactForm').hidden = true;
      return;
    }
    if (C.state.user) $('#email').value = C.state.user.email;
    const captcha = await C.mountCaptcha($('#captchaBox'));
    $('#contactForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = e.submitter || $('#contactForm button[type=submit]');
      C.busy(btn, async () => {
        C.hideAlert(alertEl);
        try {
          await C.api('POST', '/api/contact', {
            name: $('#name').value, email: $('#email').value, subject: $('#subject').value,
            message: $('#message').value, captcha: captcha.getToken(),
          });
          $('#contactForm').reset();
          C.showAlert(alertEl, 'Köszönjük az üzenetet! Hamarosan válaszolunk.', 'success');
        } catch (err) {
          C.showAlert(alertEl, err.message, 'error');
        }
        captcha.reset();
      });
    });
  });
})();
