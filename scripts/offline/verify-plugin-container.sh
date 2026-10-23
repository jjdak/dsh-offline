#!/usr/bin/env bash
# Complete focused plugin build/install test in network-isolated CentOS 7.
set -euo pipefail
if [[ ${1:-} != --inside ]]; then
  [[ $# == 2 ]] || { echo "Usage: bash $0 DSH_ARCHIVE PLUGIN_BUNDLE"; exit 2; }
  archive=$(realpath "$1"); plugin=$(realpath "$2")
  (cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
  scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  exec docker run --rm --pull never --network none \
    -v "$(dirname "$archive"):/dsh:ro" -v "$(dirname "$plugin"):/plugins:ro" -v "$scripts:/tools:ro" \
    centos@sha256:be65f488b7764ad3638f236b7b515b3678369a5124c47b8d32916d6487418ea4 \
    bash /tools/verify-plugin-container.sh --inside "$(basename "$archive")" "$(basename "$plugin")"
fi
scratch=$(mktemp -d /tmp/dsh-plugin-test.XXXXXX)
tar -xzf "/dsh/$2" -C "$scratch"
runtime="$scratch/${2%.tar.gz}"
"$runtime/node/bin/node" /tools/verify-plugin-installer.mjs "$runtime"
export DSH_HOME="$scratch/home" DSH_TELEMETRY_DISABLED=1
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
  cat "$scratch/web.log" >&2; return 1
}
start_web
stop_web
cp "$DSH_HOME/profiles/web/package.json" "$scratch/before.json"
cp "$DSH_HOME/profiles/web/cordis.patch.yml" "$scratch/before.patch"
touch "$DSH_HOME/session-preserve-marker"
for pass in first repeat; do
  bash /tools/install-plugin.sh "/plugins/$3" --runtime "$runtime" --home "$DSH_HOME" --stopped
done
cp "$DSH_HOME/profiles/web/package.json" "$scratch/installed.json"
# A corrupted checksum must fail without changing profile registration.
ln -s "/plugins/$3" "$scratch/bad.dsh-plugin.gz"
printf '%064d  bad.dsh-plugin.gz\n' 0 >"$scratch/bad.dsh-plugin.gz.sha256"
if bash /tools/install-plugin.sh "$scratch/bad.dsh-plugin.gz" --runtime "$runtime" --home "$DSH_HOME" --stopped; then
  echo 'FAIL: accepted checksum mismatch' >&2; exit 1
fi
cmp "$scratch/installed.json" "$DSH_HOME/profiles/web/package.json"
cmp "$scratch/before.patch" "$DSH_HOME/profiles/web/cordis.patch.yml"
start_web
curl --noproxy '*' -fsSL -b "$scratch/cookies" http://127.0.0.1:3085/dsh-pet-7340/config -o "$scratch/pet.json"
"$runtime/node/bin/node" -e 'const fs=require("fs"),a=require("assert/strict");const c=JSON.parse(fs.readFileSync(process.argv[1]));a.ok(c.main);a.ok(c.main.pets.length);for(const p of c.main.pets){a.equal(p.display,"web");a.equal(p.balanceEnabled,false);a.equal(p.whisperEnabled,false)};console.log("PASS: real plugin route loaded, offline defaults verified")' "$scratch/pet.json"
test ! -e "$DSH_HOME/electron"
stop_web
bash /tools/install-plugin.sh "/plugins/$3" --runtime "$runtime" --home "$DSH_HOME" --rollback --stopped
cmp "$scratch/before.json" "$DSH_HOME/profiles/web/package.json"
cmp "$scratch/before.patch" "$DSH_HOME/profiles/web/cordis.patch.yml"
test -f "$DSH_HOME/session-preserve-marker"
test ! -L "$DSH_HOME/profiles/web/node_modules/dsh-pet"
bash /tools/install-plugin.sh "/plugins/$3" --runtime "$runtime" --home "$DSH_HOME" --stopped
bash /tools/install-plugin.sh "/plugins/$3" --runtime "$runtime" --home "$DSH_HOME" --rollback --stopped
cmp "$scratch/before.json" "$DSH_HOME/profiles/web/package.json"
echo 'PASS: glibc 2.17 offline install/repeat/load/rollback; profile and user data preserved'
