#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} != --inside ]]; then
  [[ $# == 2 ]] || { echo "Usage: bash $0 DSH_ARCHIVE OUTPUT_DIR"; exit 2; }
  archive=$(realpath "$1")
  scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  repo=$(cd "$scripts/../.." && pwd)
  cache="$repo/.cache/dsh-offline/plugins/dsh-memory"
  mkdir -p "$cache" "$2"
  output=$(realpath "$2")
  if [[ ! -f $cache/dsh-memory-0.8.1.tgz ]]; then
    curl -fL --retry 2 'https://registry.npmjs.org/@furongjun1999/dsh-memory/-/dsh-memory-0.8.1.tgz' -o "$cache/dsh-memory-0.8.1.tgz"
  fi
  if [[ ! -f $cache/cpython-3.12.8-20241206.tar.gz ]]; then
    curl -fL --retry 2 'https://github.com/astral-sh/python-build-standalone/releases/download/20241206/cpython-3.12.8%2B20241206-x86_64-unknown-linux-gnu-install_only.tar.gz' -o "$cache/cpython-3.12.8-20241206.tar.gz"
  fi
  (cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
  exec docker run --rm --pull never --network none \
    -v "$scripts:/tools:ro" -v "$cache:/inputs:ro" -v "$output:/output" \
    -v "$(dirname "$archive"):/dsh:ro" \
    quay.io/pypa/manylinux2014_x86_64@sha256:edb6edbd84c2fa9d40ee83abb160e302ebce82eb93570d43343942a1fb10b962 \
    bash /tools/build-memory-container.sh --inside "$(basename "$archive")"
fi
scratch=$(mktemp -d /tmp/dsh-memory-build.XXXXXX)
trap 'rm -rf -- "$scratch"' EXIT
printf '%s  %s\n' b9d6ee5ddac1198e72d53112698773fc8bb597de095592eb849ca794306699ba /inputs/cpython-3.12.8-20241206.tar.gz | sha256sum -c -
tar -xzf "/dsh/$2" -C "$scratch"
runtime="$scratch/${2%.tar.gz}"
node="$runtime/node/bin/node"
"$node" --input-type=module -e 'import fs from "node:fs";import{createHash}from"node:crypto";import{inputs}from"/tools/build-memory-offline.mjs";const digest="sha512-"+createHash("sha512").update(fs.readFileSync("/inputs/dsh-memory-0.8.1.tgz")).digest("base64");if(digest!==inputs.npm.integrity)throw Error("npm integrity mismatch");console.log("npm SHA512 verified")'
tar -xzf /inputs/dsh-memory-0.8.1.tgz -C "$scratch"
tar -xzf /inputs/cpython-3.12.8-20241206.tar.gz -C "$scratch"
# Strip only the disposable build copy; the original pinned download stays intact.
find "$scratch/python" -type f \( -name '*.so' -o -name '*.so.*' -o -name python3.12 \) -exec strip --strip-unneeded {} +
bash /tools/verify-plugin-elf.sh "$scratch/python"
"$scratch/python/bin/python3.12" -c 'import sqlite3, ssl, sys; print(sys.version.split()[0], sqlite3.sqlite_version, ssl.OPENSSL_VERSION)'
"$node" /tools/plugin-offline.mjs build "$scratch/package" \
  /output/dsh-memory-0.8.1-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz "$scratch/python"
