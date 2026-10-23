#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 && -d $1 ]] || { echo "Usage: bash $0 DIRECTORY"; exit 2; }
count=0
while IFS= read -r -d '' file; do
  magic=$(od -An -tx1 -N4 "$file" | tr -d ' \n')
  [[ $magic == 7f454c46 ]] || continue
  count=$((count+1))
  readelf -h "$file" | grep -q 'Advanced Micro Devices X86-64' || { echo "Wrong ELF architecture: $file" >&2; exit 1; }
  for spec in GLIBC:2.17 GLIBCXX:3.4.19 CXXABI:1.3.7; do
    prefix=${spec%:*}; ceiling=${spec#*:}
    highest=$(readelf --version-info "$file" | grep -oE "${prefix}_[0-9]+(\.[0-9]+)+" | sed "s/^${prefix}_//" | sort -Vu | tail -1 || true)
    if [[ -n $highest && $(printf '%s\n%s\n' "$highest" "$ceiling" | sort -V | tail -1) != "$ceiling" ]]; then
      echo "ELF exceeds ${prefix}_$ceiling: $file needs $highest" >&2; exit 1
    fi
  done
done < <(find "$1" -type f -print0)
echo "PASS: $count x86_64 ELF files within glibc/C++ ceilings"
