<!-- Verzio: v2.0.0 - 2026-10-19 -->
# cYc – szabályok Claude számára

- Kommunikáció a felhasználóval: magyarul. Minden üzenet elején a jelenlegi verzió (pl. „[cYc v2.0.0]”).
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
