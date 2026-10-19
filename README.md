<!-- Verzio: v2.0.0 - 2026-10-19 -->
# cYc – Crypto Calculator

**Aktuális verzió: v2.0.0** (2026-10-19)

Valós idejű kripto- és deviza-árfolyam kalkulátor saját szerverrel, felhasználói fiókokkal,
eszközök között szinkronizált kedvencekkel/portfólióval/előzményekkel, és egyedileg engedélyezhető
rejtett belső felülettel.

## Verziótörténet

| Verzió | Dátum | Lényeg |
|---|---|---|
| v2.0.0 | 2026-10-19 | Saját Node.js szerver (VPS). Regisztráció és belépés e-maillel + jelszóval, captchával, Google-lel; kapcsolható 2FA visszaállító kódokkal. Kedvencek, portfólió, előzmények. Rejtett belső felület és admin panel. Sötét mód, új kriptók és devizák, árfolyam-gyorsítótár, működő kapcsolati űrlap, frissített adatvédelmi szabályzat. Kalkulátor-hibák javítva (pl. HUF→USD „0,00”). |
| v1.x | 2025-07 | Statikus HTML kalkulátor (BTC, ETH, SOL, BNB, TRX, USDC, USDT ↔ USD, EUR, HUF), jogi oldalak, 404-es oldal. |

## Funkciók állapota

### ✅ Kész
| Funkció | Óta |
|---|---|
| Árfolyam-kalkulátor (11 kriptó, 5 fiat), csere gomb, másolás, megosztható URL | v1.x / bővítve v2.0.0 |
| Választható számformátum (1'234,56 vagy 1 234.56) | v1.x / kapcsoló v2.0.0 |
| Szerveroldali árfolyam-gyorsítótár, tartalék forrás, részleges kiesés kezelése | v2.0.0 |
| 24 órás változás kriptóknál | v2.0.0 |
| Világos / sötét téma (rendszert követi, kapcsolható) | v2.0.0 |
| Regisztráció e-mail + jelszó, e-mail megerősítés | v2.0.0 |
| Bejelentkezés, kijelentkezés, fiókzárolás hibás próbálkozásoknál | v2.0.0 |
| Elfelejtett jelszó / új jelszó e-mailes linkkel | v2.0.0 |
| Kétlépcsős azonosítás (TOTP) + 10 visszaállító kód, felhasználónként kapcsolható | v2.0.0 |
| Kedvenc párok, portfólió (érték bármely pénznemben), előzmények + CSV export | v2.0.0 |
| Fiók oldal: profil, jelszó, 2FA, munkamenetek, adatexport (GDPR), fióktörlés | v2.0.0 |
| Rejtett belső felület (csak engedélyezett felhasználónak létezik, másnak 404) | v2.0.0 (váz) |
| Admin panel: rejtett hozzáférés, tiltás, szerepkör, napló | v2.0.0 |
| Parancssori admin (`npm run admin`) és napi mentés | v2.0.0 |

### Előkészítve (a kód kész, beállítás kell hozzá)
| Funkció | Mi kell |
|---|---|
| Captcha (Cloudflare Turnstile / reCAPTCHA v2 / hCaptcha) | `CAPTCHA_*` kulcsok a `.env`-ben (élesben teszteletlen – kulcs nélkül nem próbálható) |
| Google bejelentkezés és fiók-összekapcsolás | `GOOGLE_CLIENT_ID` (élesben teszteletlen) |
| E-mail küldés (megerősítés, jelszó, értesítések) | `SMTP_*` adatok; nélkülük a levelek a szerver konzoljára kerülnek |
| Kapcsolati űrlap | `CONTACT_TO` + SMTP |

### Fejlesztés alatt
- Rejtett belső felület tartalma (`server/private/hidden/`) – a pontos tartalom később jön.

### ⏳ Tervben (javaslatok)
- Árfolyam-riasztás (e-mail, ha egy kriptó átlép egy szintet).
- Árfolyam-grafikon (7/30 nap) a kalkulátorban és a portfólióban.
- Portfólió vételi ár és nyereség/veszteség számítás.
- PWA (telepíthető, offline utolsó árfolyammal).
- Passkey (WebAuthn) bejelentkezés.

## Felépítés

```
public/            nyilvános oldalak (HTML, CSS, JS, képek) – ezt szolgálja ki a szerver
server/
  src/             Express szerver: config, db (SQLite), routes (auth, account, data, admin), lib
  private/         CSAK jogosultaknak: admin/ és hidden/ (a public-ból nem érhető el)
  scripts/         cyc-admin.js (parancssori kezelés), backup.js (mentés)
  test/            végponttól végpontig füstteszt (npm test)
  .env.example     minden beállítás magyarázattal
deploy/            systemd szolgáltatás és nginx konfiguráció
```

A program verziója egyetlen helyen van: `server/package.json` → `version`. A lábléc és az API innen olvassa.

## Telepítés VPS-re (Ubuntu/Debian)

1. **Node.js 22 LTS** és nginx:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs nginx certbot python3-certbot-nginx
   ```
2. **Felhasználó és kód:**
   ```bash
   sudo useradd -r -m -d /opt/cyc -s /usr/sbin/nologin cyc
   sudo git clone https://github.com/LordAthis/cYc.git /opt/cyc   # vagy másold fel
   cd /opt/cyc/server && sudo npm ci --omit=dev
   sudo mkdir -p data && sudo chown -R cyc:cyc /opt/cyc
   ```
3. **Beállítások:** `sudo cp .env.example .env`, majd töltsd ki (legalább `APP_ORIGIN`, `APP_SECRET`,
   captcha, SMTP). APP_SECRET generálása:
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
   A `.env` jogosultsága: `sudo chmod 600 .env && sudo chown cyc:cyc .env`.
4. **Szolgáltatás:** `sudo cp ../deploy/cyc.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now cyc`
5. **Nginx + HTTPS:** a `deploy/nginx-cyc.conf` fejlécében leírt lépések, majd `sudo certbot --nginx -d <domain>`.
6. **Első admin:** regisztrálj az oldalon, erősítsd meg az e-mailt, majd:
   `cd /opt/cyc/server && sudo -u cyc node scripts/cyc-admin.js admin te@email.hu`
7. **Mentés (ajánlott):** `sudo -u cyc crontab -e` →
   `15 3 * * * cd /opt/cyc/server && /usr/bin/node scripts/backup.js >> data/backup.log 2>&1`

**Frissítés:** `cd /opt/cyc && sudo -u cyc git pull && cd server && sudo -u cyc npm ci --omit=dev && sudo systemctl restart cyc`

## Rejtett felület

- Útvonala a `.env`-ben: `HIDDEN_PATH` (válassz nehezen kitalálhatót). Admin panel: `ADMIN_PATH`.
- Aki nem jogosult (nincs belépve, vagy nincs engedélye), pontosan ugyanazt a 404-es oldalt kapja, mint bármely nem létező címen; a menüben sem jelenik meg.
- Engedélyezés felhasználónként: Admin panel → „Rejtett” kapcsoló, vagy parancssorból:
  `node scripts/cyc-admin.js hidden valaki@email.hu on`
- Tartalma: `server/private/hidden/` (index.html + hidden.js + tetszőleges további fájl).

## Fejlesztés helyben

```bash
cd server
npm install
RATES_MOCK=true npm run dev        # http://localhost:3000, internet nélkül is (kitalált árfolyamok)
npm test                           # teljes folyamat-teszt
```
SMTP nélkül a megerősítő és jelszó-visszaállító linkek a konzolon jelennek meg.

## Biztonság röviden

argon2id jelszó-hash · adatbázisban tárolt, HttpOnly/Secure/SameSite munkamenet-süti · CSRF-token + Origin-ellenőrzés ·
szigorú CSP és biztonsági fejlécek (helmet) · IP-alapú és fiókalapú próbálkozás-korlát · titkosított 2FA-kulcsok ·
egyszer használatos, lejáró e-mail tokenek (csak hash tárolva) · e-mail-cím kipuhatolás elleni egységes válaszok ·
biztonsági értesítő levelek · eseménynapló.
