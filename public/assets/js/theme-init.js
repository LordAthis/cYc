// Verzio: v0.4.0 - 2026-10-19
// A <head>-ben, szinkron fut: a téma még a kirajzolás előtt beáll (nincs fehér villanás sötét módban).
(function () {
  var t = null;
  try { t = localStorage.getItem('cyc-theme'); } catch (e) { /* privát mód */ }
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', t);
})();
