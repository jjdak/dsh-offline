#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 1 || ${1:-} == --help ]]; then
  echo 'Usage: bash install-plugin.sh BUNDLE [--runtime DIR] [--home DIR] [--profile NAME] [--rollback] --stopped'
  echo 'Stop all DSH processes using this data directory first. Install trusted bundles only.'
  exit 0
fi
bundle=$1; shift
runtime=''; data_home=${DSH_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/dsh-text-only}
action=install; stopped=''; profile=''
while [[ $# -gt 0 ]]; do
  case $1 in
    --runtime|--home|--profile)
      [[ $# -ge 2 && -n $2 && $2 != --* ]] || { echo "Missing value for $1" >&2; exit 2; }
      case $1 in
        --runtime) runtime=$2;;
        --home) data_home=$2;;
        --profile) profile=$2;;
      esac
      shift 2;;
    --rollback) action=rollback; shift;;
    --stopped) stopped=--stopped; shift;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done
if [[ -z $runtime ]]; then
  entry=$(readlink -f "$HOME/.local/bin/dsh")
  runtime=$(dirname "$(dirname "$entry")")
fi
[[ -x $runtime/node/bin/node && -f $runtime/app/package.json ]] || { echo 'Pass --runtime with the offline program directory' >&2; exit 2; }
scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec "$runtime/node/bin/node" "$scripts/plugin-offline.mjs" "$action" "$bundle" "$runtime" "$data_home" "$stopped" "$profile"
