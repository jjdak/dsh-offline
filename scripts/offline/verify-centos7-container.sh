#!/usr/bin/env bash
# Test trusted image-wasm release archives, without network or real user data.
set -euo pipefail

if [[ ${1:-} != --inside ]]; then
  if [[ $# != 1 || ${1:-} == --help ]]; then
    echo "Usage: bash $0 ARCHIVE.tar.gz (image-wasm; Docker required)"
    [[ ${1:-} == --help ]] && exit 0
    exit 2
  fi
  archive=$(realpath -- "$1")
  name=$(basename -- "$archive")
  [[ $name =~ ^dsh-offline-[0-9]+\.[0-9]+\.[0-9]+(-[[:alnum:].-]+)?-linux-x64-glibc217-image-wasm\.tar\.gz$ ]] || {
    echo 'Expected a versioned image-wasm archive' >&2; exit 2;
  }
  (cd "$(dirname -- "$archive")" && sha256sum --check --strict "$name.sha256")
  scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  exec docker run --rm --pull never --network none \
    -v "$(dirname -- "$archive"):/bundle:ro" -v "$scripts:/tools:ro" \
    centos@sha256:be65f488b7764ad3638f236b7b515b3678369a5124c47b8d32916d6487418ea4 \
    bash /tools/verify-centos7-container.sh --inside "$name"
fi

[[ $# == 2 ]]
scratch=$(mktemp -d /tmp/dsh-centos.XXXXXX)
tar -xzf "/bundle/$2" -C "$scratch"
pkg="$scratch/${2%.tar.gz}"
getconf GNU_LIBC_VERSION
"$pkg/bin/dsh" --version
"$pkg/node/bin/node" --expose-internals /tools/verify-native-runtime.mjs "$pkg/app"
"$pkg/node/bin/node" --expose-internals /tools/verify-image-wasm.mjs "$pkg/app"
export DSH_HOME="$scratch/data" DSH_TELEMETRY_DISABLED=1
mkdir -p "$DSH_HOME"
cp "$pkg/config/settings-openai-compatible.yaml.example" "$DSH_HOME/settings.yaml"
cp "$pkg/config/dsh.env.example" "$DSH_HOME/.env"
"$pkg/bin/dsh" web --port 3085 >"$scratch/web.log" 2>&1 &
web_pid=$!
trap 'kill "$web_pid" 2>/dev/null || true; wait "$web_pid" 2>/dev/null || true' EXIT
for ((attempt=0; attempt<40; attempt++)); do
  url=$(sed -n 's/^dsh web: \(http:\/\/[^ ]*\).*/\1/p' "$scratch/web.log" | tail -1)
  if [[ -n "$url" ]] && curl --noproxy '*' -fsSL --cookie-jar "$scratch/cookies" --cookie "$scratch/cookies" "$url" -o "$scratch/index.html"; then
    test -s "$scratch/index.html"
    echo 'PASS: CentOS 7 offline CLI/native/image/authenticated Web smoke'
    exit 0
  fi
  kill -0 "$web_pid" 2>/dev/null || break
  sleep 1
done
cat "$scratch/web.log" >&2
exit 1
