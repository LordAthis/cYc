// Verzio: v2.0.0 - 2026-10-19
// E-mail küldés (nodemailer). Ha nincs SMTP beállítva, a levél a konzolra kerül (fejlesztéshez).
'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

let transport = null;
if (config.mail.host) {
  transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  });
}

// Fejlesztői "postafiók": a tesztek innen olvassák ki a linkeket
const devOutbox = [];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout(title, bodyHtml) {
  return `<!doctype html><html lang="hu"><body style="margin:0;background:#14111f;color:#e9e6f5;font-family:Segoe UI,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<div style="font-size:22px;font-weight:700;color:#a5b4fc;margin-bottom:16px">cYc - CryptoCalc</div>
<div style="background:#1f1b2e;border-radius:14px;padding:24px;line-height:1.6">
<h2 style="margin-top:0;color:#fff">${escapeHtml(title)}</h2>${bodyHtml}</div>
<p style="color:#8b86a3;font-size:12px;margin-top:16px">Ha nem te kezdeményezted, nyugodtan hagyd figyelmen kívül ezt a levelet.</p>
</div></body></html>`;
}

function button(url, label) {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#667eea;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#8b86a3;word-break:break-all">${escapeHtml(url)}</p>`;
}

async function send({ to, subject, html, text, replyTo }) {
  if (!transport) {
    devOutbox.push({ to, subject, text, at: Date.now() });
    if (devOutbox.length > 50) devOutbox.shift();
    // Konzolra ékezet nélkül írunk
    const plain = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    console.log(`[cYc] (nincs SMTP) Level -> ${to} | ${plain(subject)}\n${plain(text)}\n`);
    return;
  }
  await transport.sendMail({ from: config.mail.from, to, subject, html, text, replyTo });
}

async function sendVerification(to, url) {
  await send({
    to,
    subject: 'cYc - E-mail cím megerősítése',
    text: `Erősítsd meg az e-mail címedet ezen a linken (24 óráig érvényes):\n${url}`,
    html: layout('E-mail cím megerősítése', `<p>Köszönjük a regisztrációt! A fiók aktiválásához kattints a gombra (24 óráig érvényes).</p>${button(url, 'Megerősítés')}`),
  });
}

async function sendPasswordReset(to, url) {
  await send({
    to,
    subject: 'cYc - Jelszó visszaállítása',
    text: `Új jelszót ezen a linken állíthatsz be (1 óráig érvényes):\n${url}`,
    html: layout('Jelszó visszaállítása', `<p>Jelszó-visszaállítást kértek a fiókodhoz. Új jelszót a gombra kattintva adhatsz meg (1 óráig érvényes).</p>${button(url, 'Új jelszó beállítása')}`),
  });
}

async function sendSecurityNotice(to, what) {
  await send({
    to,
    subject: 'cYc - Biztonsági értesítés',
    text: `Változás történt a fiókodban: ${what}. Ha nem te voltál, azonnal állíts be új jelszót.`,
    html: layout('Biztonsági értesítés', `<p>Változás történt a fiókodban: <strong>${escapeHtml(what)}</strong>.</p><p>Ha nem te voltál, azonnal állíts be új jelszót.</p>`),
  });
}

async function sendContact({ name, email, subject, message }) {
  const to = config.mail.contactTo;
  if (!to) throw new Error('CONTACT_TO nincs beallitva');
  await send({
    to,
    replyTo: email,
    subject: `cYc kapcsolat: ${subject} - ${name}`,
    text: `Nev: ${name}\nE-mail: ${email}\nTema: ${subject}\n\n${message}`,
    html: layout('Új üzenet a kapcsolati űrlapról', `<p><strong>Név:</strong> ${escapeHtml(name)}<br><strong>E-mail:</strong> ${escapeHtml(email)}<br><strong>Téma:</strong> ${escapeHtml(subject)}</p><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`),
  });
}

module.exports = { sendVerification, sendPasswordReset, sendSecurityNotice, sendContact, devOutbox, hasSmtp: () => !!transport };
