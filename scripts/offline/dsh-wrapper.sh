#!/usr/bin/env bash
set -euo pipefail

script_path="${BASH_SOURCE[0]}"
while [[ -L "$script_path" ]]; do
  script_dir="$(cd -- "$(dirname -- "$script_path")" && pwd -P)"
  link_target="$(readlink -- "$script_path")"
  if [[ "$link_target" = /* ]]; then
    script_path="$link_target"
  else
    script_path="$script_dir/$link_target"
  fi
done

package_root="$(cd -- "$(dirname -- "$script_path")/.." && pwd -P)"
export PATH="$package_root/node/bin:$PATH"
export DSH_HOME="${DSH_HOME:-$package_root/data}"
export DSH_TELEMETRY_DISABLED="${DSH_TELEMETRY_DISABLED:-1}"
exec "$package_root/node/bin/node" --expose-internals "$package_root/app/lib/bin.js" "$@"
