#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} != --inside ]]; then
  [[ $# == 3 ]] || { echo "Usage: bash $0 DSH_ARCHIVE MEMORY_BUNDLE PET_BUNDLE"; exit 2; }
  archive=$(realpath "$1"); memory=$(realpath "$2"); pet=$(realpath "$3")
  (cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
  scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  exec docker run --rm --pull never --network none \
    -v "$scripts:/tools:ro" -v "$(dirname "$archive"):/dsh:ro" \
    -v "$(dirname "$memory"):/memory:ro" -v "$(dirname "$pet"):/pet:ro" \
    centos@sha256:be65f488b7764ad3638f236b7b515b3678369a5124c47b8d32916d6487418ea4 \
    bash /tools/verify-memory-container.sh --inside "$(basename "$archive")" "$(basename "$memory")" "$(basename "$pet")"
fi
scratch=$(mktemp -d /tmp/dsh-memory-verify.XXXXXX)
tar -xzf "/dsh/$2" -C "$scratch"
runtime="$scratch/${2%.tar.gz}"
export HOME="$scratch/user" DSH_HOME="$scratch/user/.local/share/dsh-text-only" DSH_TELEMETRY_DISABLED=1
mkdir -p "$DSH_HOME"
pid=''
stop_web() { if [[ -n $pid ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; pid=''; fi; }
trap stop_web EXIT
start_web() {
  "$runtime/bin/dsh" web --no-open --port 3085 >"$scratch/web.log" 2>&1 & pid=$!
  for ((i=0;i<60;i++)); do
    url=$(sed -n 's/^dsh web: \(http:\/\/[^ ]*\).*/\1/p' "$scratch/web.log" | tail -1)
    if [[ -n $url ]] && curl --noproxy '*' -fsSL -c "$scratch/cookies" -b "$scratch/cookies" "$url" -o "$scratch/index.html"; then return; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  cat "$scratch/web.log" >&2
  if [[ -d $HOME/.dsh/logs ]]; then find "$HOME/.dsh/logs" -type f -name '*error*' -exec tail -30 {} \; >&2; fi
  return 1
}
start_web; stop_web
cp "$DSH_HOME/profiles/web/cordis.patch.yml" "$scratch/user.patch"
touch "$DSH_HOME/session-preserve-marker"
bash /tools/install-plugin.sh "/pet/$4" --runtime "$runtime" --home "$DSH_HOME" --stopped
cp "$DSH_HOME/profiles/web/package.json" "$scratch/pet-only.json"
for pass in first repeat; do
  bash /tools/install-plugin.sh "/memory/$3" --runtime "$runtime" --home "$DSH_HOME" --stopped
done
start_web
curl --noproxy '*' -fsSL -b "$scratch/cookies" http://127.0.0.1:3085/roleplay -o "$scratch/roleplay.html"
grep -q '<html' "$scratch/roleplay.html"
curl --noproxy '*' -fsSL -b "$scratch/cookies" http://127.0.0.1:3085/dsh-pet-7340/config -o "$scratch/pet.json"
stop_web
plugin=$(readlink -f "$DSH_HOME/profiles/web/node_modules/@furongjun1999/dsh-memory")
"$runtime/node/bin/node" /tools/verify-memory-runtime.mjs "$plugin"
# Run the actual revised main installer against the existing archive. Its new
# installation path simulates a host upgrade; plugin bundles are not reinstalled.
"$runtime/node/bin/node" /tools/render-installer.mjs /tools/install-and-run.sh.in "$scratch/install.sh"
"$runtime/node/bin/node" --input-type=module - "$scratch/install.sh" "/dsh/$2" <<'JS'
import fs from 'node:fs';
const [file, archive] = process.argv.slice(2);
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('PUBLIC_ARCHIVE_PATH=""', `PUBLIC_ARCHIVE_PATH=${JSON.stringify(archive)}`));
JS
printf '%s\n' '# already migrated' >"$DSH_HOME/settings.yaml.imported"
cp "$DSH_HOME/profiles/web/package.json" "$scratch/before-main-upgrade.json"
bash "$scratch/install.sh" --yes --install-only
cmp "$scratch/before-main-upgrade.json" "$DSH_HOME/profiles/web/package.json"
mv "$runtime" "$scratch/old-program-disabled"
runtime="$HOME/.local/${2%.tar.gz}"
start_web; stop_web
bash /tools/install-plugin.sh "/memory/$3" --runtime "$runtime" --home "$DSH_HOME" --rollback --stopped
cmp "$scratch/pet-only.json" "$DSH_HOME/profiles/web/package.json"
cmp "$scratch/user.patch" "$DSH_HOME/profiles/web/cordis.patch.yml"
test -f "$DSH_HOME/session-preserve-marker"
test -d "$DSH_HOME/.dsh-memory/data/mdcg"
test -f "$HOME/.mdcg/token"
test -L "$DSH_HOME/profiles/web/node_modules/dsh-pet"
echo 'PASS: glibc 2.17 offline memory install/repeat, DSH activation, pet coexistence, persistence, rollback preserving memory and credentials'
