<!-- Verzio: v0.4.2 - 2026-10-20 -->
# cYc – Crypto Calculator

**Aktuális verzió: v0.4.2** (2026-10-20)

Valós idejű kripto- és deviza-árfolyam kalkulátor saját szerverrel, felhasználói fiókokkal,
eszközök között szinkronizált kedvencekkel/portfólióval/előzményekkel, és egyedileg engedélyezhető
rejtett belső felülettel.

## Verziótörténet

Verziózás: 1.0 előtt vagyunk (az élő oldal még átállás alatt). Javítás → harmadik szám (0.4.**1**), új funkciócsoport → második szám (0.**5**.0). Nagy ugrás csak egyeztetés után.

| Verzió | Dátum | Lényeg |
|---|---|---|
| v0.4.2 | 2026-10-20 | A 404-es oldal ismét az eredeti, teljes minőségű képet (404_001.png) használja; a kép a régi és az új kiszolgálási módban is megjelenik. |
| v0.4.1 | 2026-10-19 | Kompatibilis mód az élő szerverhez: a weboldal Node nélkül, statikusan is működik (a kalkulátor a böngészőből kéri az árfolyamot), a régi címek átirányítanak a `public/` mappába, IP-címes HTTP-üzem (süti, biztonsági fejlécek), biztonságos frissítő (`deploy/update.sh`) és csak olvasó diagnosztika (`deploy/diagnose.sh`), szigorúbb `.gitignore`. |
| v0.4.0 | 2026-10-19 | (A GitHub commit üzenetében tévesen „v2.0.0” szerepel.) Saját Node.js szerver (VPS). Regisztráció és belépés e-maillel + jelszóval, captchával, Google-lel; kapcsolható 2FA visszaállító kódokkal. Kedvencek, portfólió, előzmények. Rejtett belső felület és admin panel. Sötét mód, új kriptók és devizák, árfolyam-gyorsítótár, működő kapcsolati űrlap, frissített adatvédelmi szabályzat. Kalkulátor-hibák javítva (pl. HUF→USD „0,00”). |
| v0.3 | 2025-07 | Az eredeti, élesben futó statikus HTML kalkulátor (BTC, ETH, SOL, BNB, TRX, USDC, USDT ↔ USD, EUR, HUF), jogi oldalak, 404-es oldal. |

## Funkciók állapota

### ✅ Kész
| Funkció | Óta |
|---|---|
| Árfolyam-kalkulátor (11 kriptó, 5 fiat), csere gomb, másolás, megosztható URL | v0.3 / bővítve v0.4.0 |
| Statikus kompatibilis mód (Node nélkül is működik, fiókfunkciók rejtve) | v0.4.1 |
| Régi (v0.3) címek átirányítása (`/about.html` → `public/about.html`), ha a webszerver még a repó gyökerét szolgálja ki | v0.4.1 |
| IP-címes, HTTP-s üzem (domain nélkül) | v0.4.1 |
| Biztonságos frissítés (`deploy/update.sh`): nem ír felül, nem töröl, mentést készít | v0.4.1 |
| Választható számformátum (1'234,56 vagy 1 234.56) | v0.3 / kapcsoló v0.4.0 |
| Szerveroldali árfolyam-gyorsítótár, tartalék forrás, részleges kiesés kezelése | v0.4.0 |
| 24 órás változás kriptóknál | v0.4.0 |
| Világos / sötét téma (rendszert követi, kapcsolható) | v0.4.0 |
| Regisztráció e-mail + jelszó, e-mail megerősítés | v0.4.0 |
| Bejelentkezés, kijelentkezés, fiókzárolás hibás próbálkozásoknál | v0.4.0 |
| Elfelejtett jelszó / új jelszó e-mailes linkkel | v0.4.0 |
| Kétlépcsős azonosítás (TOTP) + 10 visszaállító kód, felhasználónként kapcsolható | v0.4.0 |
| Kedvenc párok, portfólió (érték bármely pénznemben), előzmények + CSV export | v0.4.0 |
| Fiók oldal: profil, jelszó, 2FA, munkamenetek, adatexport (GDPR), fióktörlés | v0.4.0 |
| Rejtett belső felület (csak engedélyezett felhasználónak létezik, másnak 404) | v0.4.0 (váz) |
| Admin panel: rejtett hozzáférés, tiltás, szerepkör, napló | v0.4.0 |
| Parancssori admin (`npm run admin`) és napi mentés | v0.4.0 |

### Előkészítve (a kód kész, beállítás kell hozzá)
| Funkció | Mi kell |
|---|---|
| Captcha (Cloudflare Turnstile / reCAPTCHA v2 / hCaptcha) | `CAPTCHA_*` kulcsok + **domain** (IP-címen a szolgáltatók nem engedik) – élesben teszteletlen |
| Google bejelentkezés és fiók-összekapcsolás | `GOOGLE_CLIENT_ID` + **domain HTTPS-sel** (IP-címen a Google nem engedi) – élesben teszteletlen |
| E-mail küldés (megerősítés, jelszó, értesítések) | `SMTP_*` adatok; nélkülük a levelek a szerver konzoljára kerülnek |
| Kapcsolati űrlap | `CONTACT_TO` + SMTP |

### Fejlesztés alatt
- Rejtett belső felület tartalma (`server/private/hidden/`) – a pontos tartalom később jön.
- Átállás az élő szerveren (lásd lent): diagnosztika → statikus mód → Node mód.

### ⏳ Tervben (javaslatok)
- Árfolyam-riasztás (e-mail, ha egy kriptó átlép egy szintet).
- Árfolyam-grafikon (7/30 nap) a kalkulátorban és a portfólióban.
- Portfólió vételi ár és nyereség/veszteség számítás.
- PWA (telepíthető, offline utolsó árfolyammal).
- Domain + ingyenes HTTPS (Let's Encrypt) – ez kell a Google belépéshez és a captchához.
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
deploy/            diagnose.sh, update.sh, systemd szolgáltatás, nginx minták (statikus és Node mód)
*.html (gyökér)    ÁTMENETI átirányítások a public/-ba (régi v0.3 címek); később törölhetők
```

A program verziója egyetlen helyen van: `server/package.json` → `version`. A lábléc és az API innen olvassa.

## Élő szerver – kompatibilis átállás (FONTOS)

Az oldal már fut egy VPS-en, IP-címmel, és ugyanazon a szerveren egy rejtett útvonalon egy **teljesen különálló
másik weboldal** is fut. Ezért minden lépés visszafordítható, és a másik oldalhoz egyik sem nyúl.
Frissítés a szerveren **mindig** a `deploy/update.sh` szkripttel (sima `git pull` helyett). Soha ne fusson
`git clean`, `git add -A` vagy `git stash -u` az élő klónban.

| Lépés | Mit csinál | Kockázat | Visszaállás |
|---|---|---|---|
| 0. Diagnosztika | `git fetch origin && git show origin/main:deploy/diagnose.sh \| sudo bash > ~/cyc-diag.txt 2>&1` – csak olvas, a munkamappát sem változtatja | nincs | – |
| 1. v2.x lehúzása | `bash deploy/update.sh` – ha a webszerver a repó gyökerét szolgálja ki, a régi címek átirányítanak a `public/`-ba, a kalkulátor Node nélkül is megy | kicsi | a szkript kiírja a `git reset --hard <régi>` parancsot |
| 2. Webszerver gyökere → `public/` | `deploy/nginx-cyc-static.conf` minta alapján, a másik weboldal meglévő blokkját változatlanul megtartva | kicsi | régi konfig vissza + `nginx -t` + reload |
| 3. Node mód | Node.js + `server/.env` + `cyc.service` + `deploy/nginx-cyc.conf` – belépés, fiók, admin | közepes | nginx vissza a 2. lépés konfigjára |

A másik weboldal mappáját, ha a cYc klónon belül van, csak **helyben** zárd ki (így a neve nem kerül a repóba):
`echo "/<mappanev>/" >> .git/info/exclude`

## Admin felület elérése

Csak **Node módban** (3. lépés) létezik. Lépések:
1. Regisztrálj az oldalon (`http://<IP>/register.html`).
2. E-mail küldés (SMTP) nélkül a megerősítő link a szerver naplójában van: `journalctl -u cyc -n 50`,
   vagy erősítsd meg kézzel: `cd <cYc>/server && sudo -u cyc node scripts/cyc-admin.js verify te@email.hu`
3. Adj magadnak admin jogot: `sudo -u cyc node scripts/cyc-admin.js admin te@email.hu`
4. Lépj be; a jobb felső menüben megjelenik az **🛡️ Admin** pont. Közvetlen cím: `http://<IP>/<ADMIN_PATH>/`
   (alapból `/admin/`; a `.env`-ben átírható nehezebben kitalálhatóra). Nem adminnak ez a cím sima 404.
5. Ha nincs captcha (IP-címes üzem), a saját regisztrációd után érdemes `REGISTRATION_ENABLED=false`-ra állítani,
   és `sudo systemctl restart cyc`.

## Telepítés VPS-re – Node mód (Ubuntu/Debian)

1. **Node.js 22 LTS** (az nginx-hez NE nyúlj: az `apt install nginx` egy már telepítettet frissítene és újraindítana):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
2. **Kód és függőségek:** a MEGLÉVŐ cYc klónt használd (ne klónozz újat a régi fölé); a `<cYc>` jelölés ennek a mappáját jelenti.
   ```bash
   cd <cYc>/server && npm ci --omit=dev
   mkdir -p data
   ```
   (Ha külön, korlátozott felhasználóval futtatod – ajánlott –, a `data` mappa legyen az övé, és a `cyc.service`
   fájlban a `User=`, `WorkingDirectory=` és `ReadWritePaths=` sorokat ehhez igazítsd.)
3. **Beállítások:** `sudo cp .env.example .env`, majd töltsd ki (legalább `APP_ORIGIN` – IP-címnél `http://<IP>` –,
   `APP_SECRET`, és ha van: captcha, SMTP). APP_SECRET generálása:
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
   A `.env` jogosultsága: `sudo chmod 600 .env && sudo chown cyc:cyc .env`.
4. **Szolgáltatás:** `sudo cp ../deploy/cyc.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now cyc`
5. **Nginx:** a `deploy/nginx-cyc.conf` minta alapján, a **meglévő** konfigurációval egyeztetve (a másik weboldal blokkja maradjon).
   HTTPS csak domainnel: `sudo certbot --nginx -d <domain>`.
6. **Első admin:** regisztrálj az oldalon, erősítsd meg az e-mailt, majd:
   `cd /opt/cyc/server && sudo -u cyc node scripts/cyc-admin.js admin te@email.hu`
7. **Mentés (ajánlott):** `sudo -u cyc crontab -e` →
   `15 3 * * * cd /opt/cyc/server && /usr/bin/node scripts/backup.js >> data/backup.log 2>&1`

**Frissítés:** `cd <cYc> && bash deploy/update.sh` (mentés, csak fast-forward, függőségek, újraindítás, ellenőrzés).

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
