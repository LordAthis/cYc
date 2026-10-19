<!-- Verzio: v0.4.1 - 2026-10-19 -->
# cYc – szabályok Claude számára

- Kommunikáció a felhasználóval: magyarul. Minden üzenet elején a jelenlegi verzió (pl. „[cYc v0.4.0]”).
- Szerepek: a kódot a Cowork/Claude chat írja; a Claude Code session CSAK feltölt (ZIP kicsomagolás, változtatás nélkül, commit, push).
- Git: author és committer kizárólag `LordAthis <lordathis@gmail.com>`; nincs Co-Authored-By / Claude-Session / „Generated with” sor. Munka szóköz nélküli útvonalon (pl. `C:\Temp\cycclone`).
- Minden fájl elején verzió+dátum komment (`Verzio: vX.Y.Z - ÉÉÉÉ-HH-NN`); érdemi változásnál frissíteni.
- A program verziója egyetlen helyen: `server/package.json` → `version`.
- Kódkommentek ékezetesen; a szerver konzolra írt szövegei ékezet nélkül. A weboldal felhasználói szövegei ékezetes magyar.
- UTF-8, BOM nélkül.
- Sötét módban nincs világító fehér felület (oldal, dokumentum, kép, dialógus).
- 1,5 mp-nél hosszabb várakozásnál látható visszajelzés (spinner).
- A rejtett felület tartalma kizárólag `server/private/hidden/` alá kerülhet, SOHA a `public/`-ba; nem jogosultnak mindig a normál 404.
- Inline `<script>` tilos (CSP); minden JS külön fájlban.
- Minden kör végén: README frissítés (verziótörténet + funkcióállapot), `npm test` zöld, ZIP + Code-prompt.
- A `.env` és a `server/data/` soha nem kerül a repóba.

## Élő oldal – kompatibilitás (lásd a cyc-elo-oldal-kompatibilitas skillt is)
- Ez egy MŰKÖDŐ weboldal (VPS, Linux, nginx valószínűleg, IP-cím, HTTP, domain nélkül). Nem nulláról indul.
- Frissítés a szerveren: `deploy/update.sh` (git pull helyett). Minden kör úgy készüljön, hogy a lehúzás után az oldal a jelenlegi webszerver-beállítással is működjön.
- Ugyanazon a szerveren, rejtett útvonalon egy TELJESEN KÜLÖN weboldal fut, párhuzamos, független fejlesztéssel: annak nevét/útvonalát a repóba soha nem írjuk, a fájljaihoz nem nyúlunk, a webszerver-mintákban csak helyőrző szerepel.
- `.gitignore` kritikus: titok, adatbázis, mentés, napló soha nem kerül a repóba; a másik oldal mappája csak helyben, `.git/info/exclude`-ban.
- Tilos az élő klónban: `git clean`, `git add -A`, `git stash -u`, `git reset --hard` (kivéve a dokumentált visszaállítást), `apt install nginx`, nginx-konfig vak felülírása, `.htaccess` (AllowOverride ismerete nélkül 500-as hibát okozhat).
- Adatbázis-séma csak bővíthető (új migráció a lista végére, oszlop nem törölhető/átnevezhető egy lépésben); frissítés előtt mentés.
- IP/HTTP üzem: süti nem Secure, nincs HSTS/upgrade-insecure-requests; Google-belépés és captcha csak domainnel.
