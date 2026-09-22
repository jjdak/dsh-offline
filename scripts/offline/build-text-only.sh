#!/usr/bin/env bash
set -euo pipefail

builder_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
tool_root="$(cd -- "$builder_dir/../.." && pwd -P)"
repo_root=""
out_dir="$tool_root/.artifacts/offline"
node_runtime=""
node_version="22.23.2"
skip_install=false
skip_build=false
keep_work=false
allow_dirty=false
smoke_port=3291
max_glibc="2.17"
max_glibcxx="3.4.19"
max_cxxabi="1.3.7"
node_download_base="https://unofficial-builds.nodejs.org/download/release"
landlock_version="0.1.1"
landlock_archive_sha512="3870333d6d82a1efe26286c0240000f02795ac1a0a578067347b20c2f5f039f8ac871914552592bddcb1ad93e2c18457bada48195ad2a3dcd5dd6390cb67ae04"
landlock_download_base="https://registry.npmjs.org/@deepseek-ai/node-addon-landlock-run-linux-x64/-"

usage() {
  cat <<'EOF'
Usage: build-text-only.sh --source DIR [options]

Build a glibc 2.17-compatible Linux x64 text-only DeepSeek Harness archive.

Options:
  --source DIR        DeepSeek Harness source checkout (required)
  --node-runtime DIR  copy an existing glibc 2.17-compatible Linux x64 Node distribution
  --node-version VER  Node release from unofficial-builds (default: 22.23.2)
  --out DIR           output directory (default: tool repository .artifacts/offline)
  --skip-install      reuse the checkout's installed dependencies
  --skip-build        reuse existing lib/ build outputs
  --allow-dirty       allow tracked checkout changes
  --keep-work         keep the temporary build directory
  --smoke-port PORT   loopback port for final Web smoke (default: 3291)
  --help              show this help

Without --node-runtime, the script downloads the pinned linux-x64-glibc-217 Node release,
verifies it against SHASUMS256.txt, and caches it below the tool repository's .cache/dsh-offline/. The builder
also downloads the version-matched official landlock-run Linux x64 package and verifies
its pinned SHA-512 before adding the static launcher to the archive.

Run this script on a glibc 2.17 build host. build-text-only-container.sh supplies the
pinned manylinux2014 environment when Docker is available.
EOF
}

while (($# > 0)); do
  case "$1" in
    --source)
      repo_root="${2:?--source needs a directory}"
      shift 2
      ;;
    --node-runtime)
      node_runtime="${2:?--node-runtime needs a directory}"
      shift 2
      ;;
    --node-version)
      node_version="${2:?--node-version needs a version}"
      shift 2
      ;;
    --out)
      out_dir="${2:?--out needs a directory}"
      shift 2
      ;;
    --skip-install)
      skip_install=true
      shift
      ;;
    --skip-build)
      skip_build=true
      shift
      ;;
    --allow-dirty)
      allow_dirty=true
      shift
      ;;
    --keep-work)
      keep_work=true
      shift
      ;;
    --smoke-port)
      smoke_port="${2:?--smoke-port needs a port}"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "build-text-only: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -n "$repo_root" ]] || {
  echo "build-text-only: --source DIR is required" >&2
  exit 2
}
repo_root="$(cd -- "$repo_root" && pwd -P)"
[[ -f "$repo_root/apps/cli/package.json" && -f "$repo_root/pnpm-lock.yaml" ]] || {
  echo "build-text-only: not a DeepSeek Harness source checkout: $repo_root" >&2
  exit 2
}
source_git_root="$(git -C "$repo_root" rev-parse --show-toplevel)"
[[ "$source_git_root" == "$repo_root" ]] || {
  echo "build-text-only: --source must point to the checkout root: $source_git_root" >&2
  exit 2
}

case "$smoke_port" in
  ''|*[!0-9]*)
    echo "build-text-only: --smoke-port must be an integer" >&2
    exit 2
    ;;
esac
if ((smoke_port < 1024 || smoke_port > 65535)); then
  echo "build-text-only: --smoke-port must be from 1024 through 65535" >&2
  exit 2
fi

for command in git tar gzip sha256sum sha512sum curl awk readelf getconf; do
  command -v "$command" >/dev/null || {
    echo "build-text-only: required command is missing: $command" >&2
    exit 1
  }
done

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo "build-text-only: build host must be Linux x86_64" >&2
  exit 1
fi

case "$node_version" in
  ''|*[!0-9.]*)
    echo "build-text-only: --node-version must contain only decimal version components" >&2
    exit 2
    ;;
esac

build_glibc="$(getconf GNU_LIBC_VERSION | awk '$1 == "glibc" { print $2 }')"
if [[ -z "$build_glibc" ]]; then
  echo "build-text-only: build host must provide glibc" >&2
  exit 1
fi
if [[ "$(printf '%s\n%s\n' "$max_glibc" "$build_glibc" | sort -V | tail -1)" != "$max_glibc" ]]; then
  echo "build-text-only: build host glibc $build_glibc exceeds target $max_glibc; use build-text-only-container.sh" >&2
  exit 1
fi

if ! $allow_dirty && [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]]; then
  echo "build-text-only: tracked checkout changes are present; commit/stash them or pass --allow-dirty" >&2
  exit 1
fi

cache_dir="$tool_root/.cache/dsh-offline"
mkdir -p "$cache_dir" "$out_dir"

node_archive=""
node_archive_hash="external-runtime"
if [[ -n "$node_runtime" ]]; then
  node_runtime="$(cd -- "$node_runtime" && pwd -P)"
else
  node_archive="node-v$node_version-linux-x64-glibc-217.tar.xz"
  cached_archive="$cache_dir/$node_archive"
  cached_sums="$cache_dir/node-v$node_version-SHASUMS256.txt"
  if [[ ! -f "$cached_archive" ]]; then
    curl --fail --location --show-error \
      --output "$cached_archive.part" \
      "$node_download_base/v$node_version/$node_archive"
    mv "$cached_archive.part" "$cached_archive"
  fi
  if [[ ! -f "$cached_sums" ]]; then
    curl --fail --location --show-error \
      --output "$cached_sums.part" \
      "$node_download_base/v$node_version/SHASUMS256.txt"
    mv "$cached_sums.part" "$cached_sums"
  fi
  expected_node_hash="$(awk -v file="$node_archive" '$2 == file { print $1 }' "$cached_sums")"
  actual_node_hash="$(sha256sum "$cached_archive" | awk '{ print $1 }')"
  if [[ -z "$expected_node_hash" || "$actual_node_hash" != "$expected_node_hash" ]]; then
    echo "build-text-only: Node archive checksum mismatch: $cached_archive" >&2
    exit 1
  fi
  node_archive_hash="$actual_node_hash"
  node_runtime="$cache_dir/node-v$node_version-linux-x64-glibc-217"
  if [[ ! -x "$node_runtime/bin/node" ]]; then
    rm -rf -- "$node_runtime"
    mkdir -p "$node_runtime"
    tar --no-same-owner -xJf "$cached_archive" -C "$node_runtime" --strip-components=1
  fi
fi

node_bin="$node_runtime/bin/node"
if [[ ! -x "$node_bin" ]]; then
  echo "build-text-only: Node is unavailable below $node_runtime" >&2
  exit 1
fi

node_platform="$($node_bin -p 'process.platform + "-" + process.arch')"
if [[ "$node_platform" != linux-x64 ]]; then
  echo "build-text-only: Node must be linux-x64, got $node_platform" >&2
  exit 1
fi
node_version="$($node_bin -p 'process.versions.node')"
version="$($node_bin -p 'require(process.argv[1]).version' "$repo_root/apps/cli/package.json")"
commit="$(git -C "$repo_root" rev-parse HEAD)"
source_epoch="$(git -C "$repo_root" show -s --format=%ct HEAD)"

workspace_landlock_version="$($node_bin -p 'require(process.argv[1]).version' \
  "$repo_root/native/landlock-run/packages/linux-x64/package.json")"
if [[ "$workspace_landlock_version" != "$landlock_version" ]]; then
  echo "build-text-only: landlock-run source version $workspace_landlock_version does not match pinned asset $landlock_version; update the offline asset URL and SHA-512" >&2
  exit 1
fi
landlock_archive="node-addon-landlock-run-linux-x64-$landlock_version.tgz"
cached_landlock_archive="$cache_dir/$landlock_archive"
if [[ ! -f "$cached_landlock_archive" ]]; then
  curl --fail --location --show-error \
    --output "$cached_landlock_archive.part" \
    "$landlock_download_base/$landlock_archive"
  mv "$cached_landlock_archive.part" "$cached_landlock_archive"
fi
actual_landlock_hash="$(sha512sum "$cached_landlock_archive" | awk '{ print $1 }')"
if [[ "$actual_landlock_hash" != "$landlock_archive_sha512" ]]; then
  echo "build-text-only: landlock-run archive checksum mismatch: $cached_landlock_archive" >&2
  exit 1
fi
landlock_cache_dir="$cache_dir/landlock-run-linux-x64-$landlock_version"
rm -rf -- "$landlock_cache_dir"
mkdir -p "$landlock_cache_dir"
tar --no-same-owner -xzf "$cached_landlock_archive" -C "$landlock_cache_dir" \
  --strip-components=2 package/bin/landlock-run
landlock_binary="$landlock_cache_dir/landlock-run"
if [[ ! -x "$landlock_binary" ]]; then
  echo "build-text-only: downloaded landlock-run is missing or not executable: $landlock_binary" >&2
  exit 1
fi

corepack_bin="$(cd -- "$(dirname -- "$node_bin")" && pwd -P)/corepack"
if [[ ! -x "$corepack_bin" ]]; then
  echo "build-text-only: Corepack is missing beside $node_bin" >&2
  exit 1
fi
export COREPACK_HOME="$cache_dir/corepack"
export XDG_CACHE_HOME="$cache_dir/xdg"
corepack_shims="$cache_dir/bin"
mkdir -p "$corepack_shims"
export PATH="$(dirname -- "$node_bin"):/usr/bin:/bin:${PATH:-}"
"$corepack_bin" enable --install-directory "$corepack_shims"
export PATH="$corepack_shims:$PATH"
pnpm=("$corepack_shims/pnpm")

if ! $skip_install; then
  env CI=true "${pnpm[@]}" --dir "$repo_root" install --frozen-lockfile --ignore-scripts
  # koffi is a Windows-only implementation detail in this Linux package. Its
  # install hook either selects an x86-64-v2 prebuild or compiles with that ISA,
  # so run only the lifecycle hooks required by the Linux build and runtime.
  "${pnpm[@]}" --dir "$repo_root" rebuild esbuild protobufjs
fi

node_pty_manifest="$($node_bin -e '
  const { createRequire } = require("node:module")
  const requireFromSubprocess = createRequire(process.argv[1])
  console.log(requireFromSubprocess.resolve("node-pty/package.json"))
' "$repo_root/packages/subprocess/subprocess-local/package.json")"
node_pty_dir="${node_pty_manifest%/*}"
node_pty_binary="$node_pty_dir/build/Release/pty.node"
if ! $skip_install; then
  python_bin="${DSH_OFFLINE_PYTHON:-${PYTHON:-}}"
  if [[ -z "$python_bin" ]]; then
    python_bin="$(command -v python3 || true)"
  fi
  if [[ ! -x "$python_bin" ]]; then
    echo "build-text-only: Python 3 is required to rebuild node-pty" >&2
    exit 1
  fi
  rm -rf -- "$node_pty_dir/prebuilds" "$node_pty_dir/build"
  (
    cd "$node_pty_dir"
    env PYTHON="$python_bin" LDFLAGS="-static-libstdc++ -static-libgcc" \
      "${pnpm[@]}" dlx node-gyp@11.4.2 rebuild --nodedir="$node_runtime"
  )
fi
if [[ ! -f "$node_pty_binary" ]]; then
  echo "build-text-only: compatible node-pty build is missing: $node_pty_binary" >&2
  exit 1
fi
if ! $skip_build; then
  "${pnpm[@]}" --dir "$repo_root" run clean
  "${pnpm[@]}" --dir "$repo_root" run build
fi

work_root="$(mktemp -d /tmp/dsh-offline-text.XXXXXX)"
cleanup() {
  if $keep_work; then
    echo "build-text-only: kept work directory: $work_root"
  else
    rm -rf -- "$work_root"
  fi
}
trap cleanup EXIT

package_name="dsh-offline-$version-linux-x64-glibc217-text-only"
stage="$work_root/stage/$package_name"
mkdir -p "$stage"
deployed="$work_root/deployed-app"

"${pnpm[@]}" --dir "$repo_root" --filter @deepseek-ai/dsh deploy \
  --legacy \
  --prefer-offline \
  --prod \
  --config.ignore-scripts=true \
  --config.node-linker=hoisted \
  --config.auto-install-peers=false \
  --config.link-workspace-packages=true \
  "$deployed"

"$node_bin" "$builder_dir/materialize-deploy.mjs" "$deployed" "$stage/app" "$repo_root"
if find "$stage/app/node_modules" -type l -print -quit | grep -q .; then
  echo "build-text-only: materialized app still contains symbolic links" >&2
  exit 1
fi

attachment_package="$stage/app/node_modules/@deepseek-ai/dsh-attachment-local"
web_bundle="$stage/app/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml"
subprocess_package="$stage/app/node_modules/@deepseek-ai/dsh-subprocess-local"
fs_package="$stage/app/node_modules/@deepseek-ai/dsh-fs-local"
loader_package="$stage/app/node_modules/@deepseek-ai/cordis-plugin-loader"
sandbox_local_package="$stage/app/node_modules/@deepseek-ai/dsh-sandbox-local"
landlock_platform_package="$stage/app/node_modules/@deepseek-ai/node-addon-landlock-run-linux-x64"
staged_node_pty="$stage/app/node_modules/node-pty"
if [[ ! -f "$attachment_package/lib/index.js" || ! -f "$web_bundle" \
  || ! -f "$subprocess_package/lib/index.js" || ! -f "$fs_package/package.json" \
  || ! -f "$loader_package/package.json" || ! -f "$sandbox_local_package/lib/index.js" \
  || ! -f "$landlock_platform_package/prebuilds.json" \
  || ! -f "$staged_node_pty/lib/utils.js" ]]; then
  echo "build-text-only: deployed attachment or Web bundle layout changed" >&2
  exit 1
fi

install -m 0644 "$builder_dir/text-only-attachment.js" "$attachment_package/lib/index.js"
install -m 0644 "$builder_dir/text-only-attachment.d.ts" "$attachment_package/lib/types/index.d.ts"

"$node_bin" --input-type=module - \
  "$attachment_package/package.json" \
  "$web_bundle" \
  "$subprocess_package/package.json" \
  "$subprocess_package/lib/index.js" \
  "$fs_package/package.json" \
  "$stage/app/package.json" \
  "$loader_package/package.json" \
  "$sandbox_local_package/package.json" \
  "$sandbox_local_package/lib/index.js" <<'NODE'
import { readFile, writeFile } from 'node:fs/promises'

const [
  manifestPath,
  webBundlePath,
  subprocessManifestPath,
  subprocessEntryPath,
  fsManifestPath,
  appManifestPath,
  loaderManifestPath,
  sandboxManifestPath,
  sandboxEntryPath,
]
  = process.argv.slice(2)
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.description = 'Text-only attachment service for the offline baseline-CPU package'
delete manifest.dependencies?.sharp
delete manifest.dependencies?.['@deepseek-ai/schemastery']
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const webBundle = await readFile(webBundlePath, 'utf8')
const row = "    - id: ui-attachment\n      name: '@deepseek-ai/dsh-client-ui-attachment'\n"
if (!webBundle.includes(row)) throw new Error('ui-attachment row changed; refusing an unverified text-only package')
await writeFile(webBundlePath, webBundle.replace(row, `${row}      disabled: true\n`))

const subprocessManifest = JSON.parse(await readFile(subprocessManifestPath, 'utf8'))
delete subprocessManifest.dependencies?.koffi
await writeFile(subprocessManifestPath, `${JSON.stringify(subprocessManifest, null, 2)}\n`)

const subprocessEntry = await readFile(subprocessEntryPath, 'utf8')
const koffiImport = 'import koffi from "koffi";'
if (subprocessEntry.split(koffiImport).length !== 2) {
  throw new Error('subprocess-local koffi import changed; refusing an unverified Linux package')
}
await writeFile(subprocessEntryPath, subprocessEntry.replace(
  koffiImport,
  'const koffi = { pointer: () => ({}) }; // Windows FFI is excluded from this Linux-only artifact.',
))

const fsManifest = JSON.parse(await readFile(fsManifestPath, 'utf8'))
delete fsManifest.dependencies?.koffi
await writeFile(fsManifestPath, `${JSON.stringify(fsManifest, null, 2)}\n`)

for (const path of [appManifestPath, loaderManifestPath]) {
  const value = JSON.parse(await readFile(path, 'utf8'))
  delete value.dependencies?.['node-addon-require-builtin']
  delete value.optionalDependencies?.['node-addon-require-builtin']
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

const sandboxManifest = JSON.parse(await readFile(sandboxManifestPath, 'utf8'))
delete sandboxManifest.dependencies?.['@deepseek-ai/dsh-sandbox-windows-acl']
await writeFile(sandboxManifestPath, `${JSON.stringify(sandboxManifest, null, 2)}\n`)

const sandboxEntry = await readFile(sandboxEntryPath, 'utf8')
const windowsAclImport = 'import { AclWriteGrant, assertTempRootOutsideWorkspace, tempWriteSid, workspaceWriteSid } from "@deepseek-ai/dsh-sandbox-windows-acl";'
if (sandboxEntry.split(windowsAclImport).length !== 2) {
  throw new Error('sandbox-local Windows ACL import changed; refusing an unverified Linux package')
}
const windowsAclStub = `const windowsAclUnavailable = () => { throw new Error("Windows ACL sandbox is excluded from this Linux-only artifact") };
const AclWriteGrant = class { constructor() { windowsAclUnavailable() } };
const assertTempRootOutsideWorkspace = windowsAclUnavailable;
const tempWriteSid = windowsAclUnavailable;
const workspaceWriteSid = windowsAclUnavailable;`
await writeFile(sandboxEntryPath, sandboxEntry.replace(windowsAclImport, windowsAclStub))
NODE

rm -rf -- \
  "$stage/app/node_modules/sharp" \
  "$stage/app/node_modules/@img/sharp-linux-x64" \
  "$stage/app/node_modules/@img/sharp-libvips-linux-x64" \
  "$stage/app/node_modules/@img/sharp-wasm32" \
  "$stage/app/node_modules/@img/colour" \
  "$stage/app/node_modules/@emnapi/runtime"

find "$stage/app/node_modules" -depth -type d \
  \( -name koffi -o -path '*/@koromix/koffi-*' \) -exec rm -rf -- {} +
find "$stage/app/node_modules" -depth -type d \
  \( -name node-addon-require-builtin -o -name 'node-addon-require-builtin-*' \
    -o -name node-addon-native-custom-loader \) -exec rm -rf -- {} +
rm -rf -- \
  "$stage/app/node_modules/@deepseek-ai/dsh-sandbox-windows-acl" \
  "$stage/app/node_modules/@deepseek-ai/dsh-win32-process"
mkdir -p "$landlock_platform_package/bin"
install -m 0755 "$landlock_binary" "$landlock_platform_package/bin/landlock-run"
"$node_bin" "$repo_root/native/landlock-run/scripts/verify-launcher-binary.mjs" \
  "$landlock_platform_package"
if ! landlock_probe="$($landlock_platform_package/bin/landlock-run --probe 2>&1)"; then
  echo "$landlock_probe" >&2
  echo "build-text-only: staged landlock-run cannot enforce on the Docker host kernel" >&2
  exit 1
fi
rm -rf -- "$staged_node_pty/prebuilds" "$staged_node_pty/build"
mkdir -p "$staged_node_pty/build/Release"
install -m 0755 "$node_pty_binary" "$staged_node_pty/build/Release/pty.node"

mkdir -p "$stage/node"
cp -a "$node_runtime/." "$stage/node/"

mkdir -p "$stage/bin" "$stage/config" "$stage/data"
install -m 0755 "$builder_dir/dsh-wrapper.sh" "$stage/bin/dsh"
install -m 0644 "$builder_dir/offline.cordis.yml" "$stage/config/offline.cordis.yml"
install -m 0644 "$builder_dir/settings-openai-compatible.yaml.example" "$stage/config/settings-openai-compatible.yaml.example"
install -m 0644 "$builder_dir/settings-native-deepseek.yaml.example" "$stage/config/settings-native-deepseek.yaml.example"
install -m 0644 "$builder_dir/dsh.env.example" "$stage/config/dsh.env.example"
install -m 0644 "$repo_root/LICENSE" "$stage/LICENSE"
install -m 0644 "$repo_root/THIRD_PARTY_NOTICES.md" "$stage/THIRD_PARTY_NOTICES.md"

sed "s/@DSH_VERSION@/$version/g" "$builder_dir/README.zh.md.in" >"$stage/README.zh.md"
cat >"$stage/BUILD-MANIFEST.txt" <<EOF
dsh_version=$version
git_commit=$commit
target=linux-x64-glibc217-text-only
node_version=$node_version
node_archive=${node_archive:-external-runtime}
node_archive_sha256=$node_archive_hash
landlock_run_version=$landlock_version
landlock_run_archive_sha512=$actual_landlock_hash
landlock_run_probe=$landlock_probe
pnpm_build_version=$("${pnpm[@]}" --version)
build_glibc=$build_glibc
maximum_glibc=$max_glibc
maximum_glibcxx=$max_glibcxx
maximum_cxxabi=$max_cxxabi
attachment_backend=text-only
sharp_runtime=absent
koffi_runtime=absent
require_builtin_runtime=expose-internals
node_pty_build=glibc217-source
archive_hardlinks=none
EOF

if find "$stage/app/node_modules" -maxdepth 2 \( -path '*/sharp' -o -path '*/@img/sharp-*' \) -print -quit | grep -q .; then
  echo "build-text-only: sharp runtime remains in the staged package" >&2
  exit 1
fi

audit_file="$stage/ELF-AUDIT.txt"
: >"$audit_file"
elf_count=0
while IFS= read -r -d '' path; do
  if ! readelf -h "$path" >/dev/null 2>&1; then
    continue
  fi
  elf_count=$((elf_count + 1))
  relative="${path#"$stage"/}"
  required_glibc="$(readelf --version-info "$path" 2>/dev/null \
    | sed -n 's/.*Name: GLIBC_\([0-9.]*\).*/\1/p' | sort -V | tail -1)"
  required_glibcxx="$(readelf --version-info "$path" 2>/dev/null \
    | sed -n 's/.*Name: GLIBCXX_\([0-9.]*\).*/\1/p' | sort -V | tail -1)"
  required_cxxabi="$(readelf --version-info "$path" 2>/dev/null \
    | sed -n 's/.*Name: CXXABI_\([0-9.]*\).*/\1/p' | sort -V | tail -1)"
  printf '%s glibc=%s glibcxx=%s cxxabi=%s\n' \
    "$relative" "${required_glibc:-none}" "${required_glibcxx:-none}" \
    "${required_cxxabi:-none}" >>"$audit_file"
  if [[ -n "$required_glibc" \
    && "$(printf '%s\n%s\n' "$max_glibc" "$required_glibc" | sort -V | tail -1)" != "$max_glibc" ]]; then
    echo "build-text-only: $relative requires GLIBC_$required_glibc, target maximum is GLIBC_$max_glibc" >&2
    exit 1
  fi
  if [[ -n "$required_glibcxx" \
    && "$(printf '%s\n%s\n' "$max_glibcxx" "$required_glibcxx" | sort -V | tail -1)" != "$max_glibcxx" ]]; then
    echo "build-text-only: $relative requires GLIBCXX_$required_glibcxx, target maximum is GLIBCXX_$max_glibcxx" >&2
    exit 1
  fi
  if [[ -n "$required_cxxabi" \
    && "$(printf '%s\n%s\n' "$max_cxxabi" "$required_cxxabi" | sort -V | tail -1)" != "$max_cxxabi" ]]; then
    echo "build-text-only: $relative requires CXXABI_$required_cxxabi, target maximum is CXXABI_$max_cxxabi" >&2
    exit 1
  fi
done < <(find "$stage" -type f -print0)
if ((elf_count == 0)); then
  echo "build-text-only: staged package contains no ELF files" >&2
  exit 1
fi
printf 'elf_count=%s\n' "$elf_count" >>"$audit_file"

archive_work="$work_root/$package_name.tar.gz"
(
  cd "$work_root/stage"
  find "$package_name" -print0 | sort -z \
    | tar --null --no-recursion --hard-dereference \
      --mtime="@$source_epoch" \
      --owner=0 --group=0 --numeric-owner \
      -cf - -T -
) | gzip -n >"$archive_work"
gzip -t "$archive_work"

hard_link_entries="$(tar -tvzf "$archive_work" | awk 'substr($1,1,1) == "h" { count++ } END { print count + 0 }')"
if [[ "$hard_link_entries" != 0 ]]; then
  echo "build-text-only: archive contains $hard_link_entries hard-link entries" >&2
  exit 1
fi

verify_root="$work_root/verify"
mkdir -p "$verify_root" "$work_root/link-bin"
tar --no-same-owner -xzf "$archive_work" -C "$verify_root"
verified="$verify_root/$package_name"
ln -s "$verified/bin/dsh" "$work_root/link-bin/dsh"
reported_version="$($work_root/link-bin/dsh --version)"
if [[ "$reported_version" != "$version" ]]; then
  echo "build-text-only: dsh reported $reported_version, expected $version" >&2
  exit 1
fi

verified_landlock_package="$verified/app/node_modules/@deepseek-ai/node-addon-landlock-run-linux-x64"
"$verified/node/bin/node" "$repo_root/native/landlock-run/scripts/verify-launcher-binary.mjs" \
  "$verified_landlock_package"
if ! verified_landlock_probe="$($verified_landlock_package/bin/landlock-run --probe 2>&1)"; then
  echo "$verified_landlock_probe" >&2
  echo "build-text-only: archived landlock-run cannot enforce on the Docker host kernel" >&2
  exit 1
fi

DSH_APP="$verified/app" "$verified/node/bin/node" --input-type=module <<'NODE'
const { Context } = await import(`${process.env.DSH_APP}/node_modules/@deepseek-ai/cordis/lib/index.js`)
const { default: Store } = await import(`${process.env.DSH_APP}/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js`)

const store = new Store(new Context())
if (store.imageLimits.mediaTypes.length !== 0) throw new Error('text-only store advertises image media types')
try {
  await store.saveImages([{ data: new Uint8Array([1]), mediaType: 'image/png' }])
  throw new Error('text-only store accepted an image')
} catch (error) {
  if (error?.code !== 'UNSUPPORTED_IMAGE_TYPE') throw error
}
NODE

web_log="$work_root/dsh-web.log"
delivery_dir="$work_root/delivery"
installer_home="$work_root/installer-home"
mkdir -p "$delivery_dir" "$installer_home"
cp "$archive_work" "$delivery_dir/$package_name.tar.gz"
(
  cd "$delivery_dir"
  sha256sum "$package_name.tar.gz" >"$package_name.tar.gz.sha256"
)
sed "s/@DSH_VERSION@/$version/g" "$builder_dir/install-and-run.sh.in" \
  >"$delivery_dir/install-and-run.sh"
chmod 0755 "$delivery_dir/install-and-run.sh"
bash -n "$delivery_dir/install-and-run.sh"
(
  cd "$delivery_dir"
  sha256sum -c "$package_name.tar.gz.sha256"
)

# The published installer is intentionally unconfigured. Use a local copy with
# the shared archive link configured for the install and Web smoke tests.
ln -s "$package_name.tar.gz" "$delivery_dir/latest"
cp "$verified/config/settings-openai-compatible.yaml.example" "$delivery_dir/settings.yaml"
sed "s|^PUBLIC_ARCHIVE_PATH=\"\"$|PUBLIC_ARCHIVE_PATH=\"$delivery_dir/latest\"|" \
  "$delivery_dir/install-and-run.sh" >"$work_root/smoke-install-and-run.sh"
bash -n "$work_root/smoke-install-and-run.sh"

wrong_shell_log="$work_root/installer-wrong-shell.log"
if ! sh -c 'test -n "${BASH_VERSION:-}"'; then
  if sh "$work_root/smoke-install-and-run.sh" --help >"$wrong_shell_log" 2>&1; then
    echo "build-text-only: installer accepted a non-Bash shell" >&2
    exit 1
  fi
  grep -F '请使用 Bash' "$wrong_shell_log" >/dev/null || {
    cat "$wrong_shell_log" >&2
    echo "build-text-only: installer did not explain its Bash requirement" >&2
    exit 1
  }
fi

env -u DSH_HOME -u XDG_DATA_HOME HOME="$installer_home" \
  bash "$work_root/smoke-install-and-run.sh" --install-only --yes
installed_home="$installer_home/.local/share/dsh-text-only"
printf '%s\n' 'user-owned-settings' >"$installed_home/settings.yaml"
printf '%s\n' 'USER_OWNED_ENV=1' >"$installed_home/.env"
touch "$installed_home/session-preserve-sentinel"
env -u DSH_HOME -u XDG_DATA_HOME HOME="$installer_home" \
  bash "$work_root/smoke-install-and-run.sh" --install-only --yes
grep -Fx 'user-owned-settings' "$installed_home/settings.yaml" >/dev/null
grep -Fx 'USER_OWNED_ENV=1' "$installed_home/.env" >/dev/null
test -e "$installed_home/session-preserve-sentinel"
cp "$verified/config/settings-openai-compatible.yaml.example" "$installed_home/settings.yaml"
cp "$verified/config/dsh.env.example" "$installed_home/.env"

env -u DSH_HOME -u XDG_DATA_HOME HOME="$installer_home" \
  DSH_TELEMETRY_DISABLED=1 \
  bash "$work_root/smoke-install-and-run.sh" --yes --port "$smoke_port" >"$web_log" 2>&1 &
web_pid=$!
web_ok=false
web_cookie_jar="$work_root/dsh-web.cookies"
for _ in $(seq 1 30); do
  authenticated_url="$(sed -n 's/^dsh web: \(http:\/\/[^ ]*\).*/\1/p' "$web_log" | tail -1)"
  if [[ -n "$authenticated_url" ]] \
    && curl --noproxy '*' --fail --silent --show-error --location \
      --cookie-jar "$web_cookie_jar" --cookie "$web_cookie_jar" \
      --output /dev/null "$authenticated_url" 2>/dev/null; then
    web_ok=true
    break
  fi
  if ! kill -0 "$web_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done
kill "$web_pid" 2>/dev/null || true
wait "$web_pid" 2>/dev/null || true
if ! $web_ok; then
  cat "$web_log" >&2
  echo "build-text-only: final Web smoke failed" >&2
  exit 1
fi

final_archive="$out_dir/$package_name.tar.gz"
final_checksum="$final_archive.sha256"
final_installer="$out_dir/install-and-run.sh"
mv -f "$delivery_dir/$package_name.tar.gz" "$final_archive"
mv -f "$delivery_dir/$package_name.tar.gz.sha256" "$final_checksum"
mv -f "$delivery_dir/install-and-run.sh" "$final_installer"
sed "s/@DSH_VERSION@/$version/g" "$builder_dir/INSTALL-text-only.zh.md.in" >"$out_dir/INSTALL-text-only.zh.md"

echo "build-text-only: complete"
echo "  archive: $final_archive"
echo "  checksum: $final_checksum"
echo "  installer: $final_installer"
echo "  tutorial: $out_dir/INSTALL-text-only.zh.md"
echo "  hard_link_entries: $hard_link_entries"
echo "  elf_entries: $elf_count"
echo "  landlock_probe: $verified_landlock_probe"
