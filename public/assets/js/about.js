// Verzio: v0.4.3 - 2026-11-09
// Rólunk oldal: a nyilvános verziótörténet kirajzolása az assets/data/changelog.json alapján.
// Node szerver nélkül (statikus módban) is működik; csak publikus változások szerepelnek a fájlban.
(function () {
  'use strict';
  const C = window.cYc;
  const { $, h } = C;

  C.loadChangelog().then((data) => {
    const list = $('#changelog');
    list.replaceChildren(...data.versions.map((v) => h('li', { class: 'changelog-entry' },
      h('h3', {}, 'v' + v.version, h('small', {}, v.date)),
      h('ul', {}, v.items.map((t) => h('li', {}, t)))
    )));
    $('#changelogStatus').remove();
  }).catch(() => {
    $('#changelogStatus').textContent = 'A verziótörténet most nem tölthető be.';
  });
})();
