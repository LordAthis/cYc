#!/usr/bin/env bash
# Verzio: v0.4.1 - 2026-10-19
# Biztonságos frissítés az élő szerveren (a sima "git pull" helyett).
# - Megáll, ha a követett fájlokban helyi módosítás van (nem ír felül semmit).
# - A nem követett fájlokhoz (pl. a másik, rejtett weboldal mappájához) NEM nyúl: nincs git clean, nincs git add.
# - Ha van adatbázis, frissítés ELŐTT mentést készít.
# - Csak "fast-forward" frissítés (nincs merge, nincs történet-átírás).
# - Ha a Node mód be van állítva (server/.env + cyc szolgáltatás), függőséget frissít és újraindít,
#   majd ellenőrzi, hogy válaszol-e; ha nincs beállítva, csak a fájlok frissülnek (statikus mód).
# - Visszaállítás: a végén kiírt "git reset --hard <régi>" paranccsal.
#
# Futtatás a cYc mappából:   bash deploy/update.sh

set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
echo "[cYc] Frissites: $REPO"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[cYc] HIBA: helyi modositasok vannak a kovetett fajlokban:"
  git status --porcelain --untracked-files=no
  echo "[cYc] Nem frissitek. Elobb tisztazd ezeket (mentsd el oket, vagy kerdezz)."
  exit 1
fi

UNTRACKED="$(git status --porcelain --untracked-files=normal | grep '^??' || true)"
if [ -n "$UNTRACKED" ]; then
  echo "[cYc] Nem kovetett elemek (ezeket a frissites NEM bantja):"
  echo "$UNTRACKED" | sed 's/^?? /  /'
fi

# Adatbázis-mentés frissítés előtt (csak ha van mit menteni és a függőségek megvannak)
if [ -f server/data/cyc.sqlite ] && command -v node >/dev/null 2>&1 && [ -d server/node_modules ]; then
  echo "[cYc] Adatbazis mentese..."
  (cd server && node scripts/backup.js)
fi

OLD="$(git rev-parse HEAD)"
git fetch --quiet origin
if ! git merge-base --is-ancestor HEAD origin/main; then
  echo "[cYc] HIBA: a helyi ag eltert a GitHubon levotol (nem fast-forward). Nem frissitek."
  exit 1
fi
git merge --ff-only --quiet origin/main
NEW="$(git rev-parse HEAD)"

if [ "$OLD" = "$NEW" ]; then
  echo "[cYc] Nincs uj valtozas ($(git log -1 --format='%h %s'))."
  exit 0
fi

echo "[cYc] Frissitve: ${OLD:0:7} -> ${NEW:0:7}"
git log --oneline "$OLD..$NEW" | sed 's/^/  /'

# Node mód: csak ha be van állítva
if command -v node >/dev/null 2>&1 && [ -f server/.env ]; then
  if git diff --name-only "$OLD" "$NEW" | grep -q '^server/package-lock.json$' || [ ! -d server/node_modules ]; then
    echo "[cYc] Fuggosegek frissitese (npm ci)..."
    (cd server && npm ci --omit=dev --no-audit --no-fund)
  fi
  if systemctl list-unit-files 2>/dev/null | grep -q '^cyc\.service'; then
    echo "[cYc] Szolgaltatas ujrainditasa..."
    sudo systemctl restart cyc
    sleep 2
    PORT="$(grep -E '^PORT=' server/.env | cut -d= -f2 || true)"; PORT="${PORT:-3000}"
    if curl -fsS "http://127.0.0.1:${PORT}/api/config" >/dev/null; then
      echo "[cYc] OK: a szerver valaszol (port ${PORT})."
    else
      echo "[cYc] FIGYELEM: a szerver nem valaszol! Naplo: journalctl -u cyc -n 50"
      echo "[cYc] Visszaallitas: git reset --hard $OLD && sudo systemctl restart cyc"
      exit 1
    fi
  fi
else
  echo "[cYc] Statikus mod (nincs Node / server/.env) - csak a fajlok frissultek."
fi

echo "[cYc] Kesz. Ha valami nem jo, visszaallitas: git reset --hard $OLD"
