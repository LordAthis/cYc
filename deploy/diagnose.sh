#!/usr/bin/env bash
# Verzio: v0.4.1 - 2026-10-19
# CSAK OLVASÓ diagnosztika az élő szerverhez: semmit nem módosít, nem indít újra, nem ír fájlt.
# Kideríti, melyik webszerver fut, honnan szolgálja ki az oldalakat, hol van a cYc klón,
# van-e benne nem követett (pl. a másik, rejtett weboldalhoz tartozó) mappa, és van-e Node.js.
#
# Futtatás a cYc mappából, A MUNKAMAPPA MÓDOSÍTÁSA NÉLKÜL (a fetch csak letölt, a pull-lal ellentétben
# nem ír át fájlt; a szkript a letöltött változatból fut):
#   git fetch origin && git show origin/main:deploy/diagnose.sh | sudo bash > ~/cyc-diag.txt 2>&1
# Ha a fájl már a helyén van:   sudo bash deploy/diagnose.sh > ~/cyc-diag.txt 2>&1
# A kimenetet küldd el; a másik weboldal mappájának nevét nyugodtan írd át benne XXX-re.

set -u
hr() { printf '\n===== %s =====\n' "$1"; }

hr "Rendszer"
. /etc/os-release 2>/dev/null && echo "OS: ${PRETTY_NAME:-ismeretlen}"
echo "Felhasznalo: $(whoami)   Ido: $(date '+%F %T')"

hr "Futo webszerverek"
for s in nginx apache2 httpd caddy lighttpd; do
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "^$s\.service"; then
    echo "$s: $(systemctl is-active $s 2>/dev/null)"
  fi
done
echo "--- Figyelo portok (80/443/3000-3999/8000-8999):"
(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | awk 'NR==1 || /:(80|443|3[0-9]{3}|8[0-9]{3}) /'

if command -v nginx >/dev/null 2>&1; then
  hr "nginx beallitasok (osszevont, csak a lenyeges sorok)"
  nginx -T 2>/dev/null | grep -nE '^# configuration file|^\s*(listen|server_name|root|alias|index|location|try_files|error_page|proxy_pass|return|rewrite|include|autoindex|deny|allow)\b' \
    | grep -v '/etc/nginx/mime.types' | sed 's/^\s\+/  /'
fi

if command -v apache2ctl >/dev/null 2>&1 || command -v apachectl >/dev/null 2>&1; then
  hr "Apache beallitasok"
  (apache2ctl -S 2>/dev/null || apachectl -S 2>/dev/null)
  grep -rhnE '^\s*(DocumentRoot|Alias|ProxyPass|<Directory|AllowOverride|RewriteRule)' /etc/apache2 /etc/httpd 2>/dev/null | sed 's/^\s\+/  /'
fi

hr "cYc git klon"
# Fájlból futtatva a szkript helyéből, csőből (git show | bash) futtatva az aktuális mappából
if [ -f "$0" ] && [ "$(basename "$(dirname "$0")")" = "deploy" ]; then REPO="$(cd "$(dirname "$0")/.." && pwd)"; else REPO="$(pwd)"; fi
# sudo alatt a git "dubious ownership" hibat adna; csak erre a futasra engedelyezzuk (nem ir a beallitasokba)
git() { command git -c safe.directory="$REPO" "$@"; }
echo "Mappa: $REPO"
if git -C "$REPO" rev-parse >/dev/null 2>&1; then
  echo "Remote:  $(git -C "$REPO" remote get-url origin 2>/dev/null)"
  echo "Ag:      $(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
  echo "HEAD:    $(git -C "$REPO" log -1 --format='%h %ad %s' --date=short)"
  echo "--- Modositott kovetett fajlok (ha van, a pull elott tisztazni kell):"
  git -C "$REPO" status --porcelain --untracked-files=no | sed 's/^/  /'
  echo "--- NEM kovetett elemek a klonban (pl. a masik weboldal mappaja):"
  git -C "$REPO" status --porcelain --untracked-files=normal | grep '^??' | sed 's/^?? /  /'
  echo "--- Helyi kizarasok (.git/info/exclude):"
  grep -v '^#' "$REPO/.git/info/exclude" 2>/dev/null | sed '/^$/d;s/^/  /'
else
  echo "Ez nem git klon!"
fi
echo "--- Mappa tartalma:"
ls -la "$REPO" | sed 's/^/  /'

hr "Node.js"
echo "node: $(command -v node >/dev/null 2>&1 && node -v || echo 'NINCS')"
echo "npm:  $(command -v npm >/dev/null 2>&1 && npm -v || echo 'NINCS')"
[ -f "$REPO/server/.env" ] && echo "server/.env: VAN" || echo "server/.env: nincs"
[ -d "$REPO/server/node_modules" ] && echo "server/node_modules: VAN" || echo "server/node_modules: nincs"
systemctl list-unit-files 2>/dev/null | grep -q '^cyc\.service' && echo "cyc szolgaltatas: $(systemctl is-active cyc)" || echo "cyc szolgaltatas: nincs telepitve"

hr "Szabad hely"
df -h "$REPO" | sed 's/^/  /'

echo
echo "Kesz. Semmi nem valtozott a szerveren."
