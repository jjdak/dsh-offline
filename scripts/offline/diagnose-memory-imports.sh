#!/usr/bin/env bash
# Focused diagnostic, not a product build or a change to the offline payload.
set -euo pipefail
if [[ ${1:-} != --inside ]]; then
  [[ $# == 4 || ( $# == 5 && ( $5 == --questions || $5 == --usage ) ) ]] || { echo "Usage: bash $0 DSH_ARCHIVE MEMORY_BUNDLE UPSTREAM_NPM_TGZ REPORT_DIR [--questions|--usage]"; exit 2; }
  archive=$(realpath "$1"); memory=$(realpath "$2"); upstream=$(realpath "$3")
  mkdir -p "$4"
  output=$(realpath "$4")
  (cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
  scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  exec docker run --rm --pull never --network none \
    -v "$scripts:/tools:ro" -v "$(dirname "$archive"):/dsh:ro" \
    -v "$(dirname "$memory"):/memory:ro" -v "$(dirname "$upstream"):/upstream:ro" \
    -v "$output:/report" \
    centos@sha256:be65f488b7764ad3638f236b7b515b3678369a5124c47b8d32916d6487418ea4 \
    bash /tools/diagnose-memory-imports.sh --inside "$(basename "$archive")" "$(basename "$memory")" "$(basename "$upstream")" "${5:-}"
fi
scratch=$(mktemp -d /tmp/dsh-memory-diagnostic.XXXXXX)
tar -xzf "/dsh/$2" -C "$scratch"
runtime="$scratch/${2%.tar.gz}"
cd "$scratch"
exec "$runtime/node/bin/node" /tools/diagnose-memory-imports.mjs "/memory/$3" "/upstream/$4" /report "${5:-}"
