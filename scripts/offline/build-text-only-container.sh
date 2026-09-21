#!/usr/bin/env bash
set -euo pipefail

builder_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
tool_root="$(cd -- "$builder_dir/../.." && pwd -P)"
image="${DSH_OFFLINE_BUILD_IMAGE:-quay.io/pypa/manylinux2014_x86_64@sha256:edb6edbd84c2fa9d40ee83abb160e302ebce82eb93570d43343942a1fb10b962}"

source_dir=""
args=("$@")
while (($# > 0)); do
  case "$1" in
    --source)
      source_dir="${2:?--source needs a directory}"
      shift 2
      ;;
    --node-runtime|--node-version|--out|--smoke-port)
      shift 2
      ;;
    --help)
      "$builder_dir/build-text-only.sh" --help
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done
[[ -n "$source_dir" ]] || {
  echo "build-text-only-container: --source DIR is required" >&2
  exit 2
}
repo_root="$(cd -- "$source_dir" && pwd -P)"
[[ -f "$repo_root/apps/cli/package.json" ]] || {
  echo "build-text-only-container: not a DeepSeek Harness source checkout: $repo_root" >&2
  exit 2
}

command -v docker >/dev/null || {
  echo "build-text-only-container: docker is required" >&2
  exit 1
}

exec docker run --rm --init \
  --entrypoint /bin/bash \
  --env DSH_OFFLINE_PYTHON=/opt/python/cp312-cp312/bin/python \
  --volume "$repo_root:$repo_root" \
  --volume "$tool_root:$tool_root" \
  --workdir "$repo_root" \
  "$image" \
  "$builder_dir/build-text-only.sh" "${args[@]}"
