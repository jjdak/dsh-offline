# Agent Note: Reproducible text-only offline bundle builder

Status: implemented

English | [中文](2026-08-25-text-only-offline-builder.zh.md)

## Problem

The published Linux x64 dependency set includes `sharp`, whose native binary requires the x86-64-v2 microarchitecture level. Its WebAssembly fallback requires SIMD. A disconnected deployment host that exposes neither feature cannot load the attachment plugin, even when the deployment only needs text conversations. Reapplying product-source edits after every upstream update is not a reproducible packaging workflow.

## Decision

The standalone `scripts/offline/` builder accepts a separate DeepSeek Harness source checkout through `--source` and produces a versioned text-only Linux x64 archive without editing tracked product source. It installs locked dependencies, removes source-checkout stale build outputs, runs the official build, deploys the production package set, and materializes every runtime package into an independent staging tree before applying artifact-only substitutions. Generated archives and download caches stay in the offline-tool repository, not the product checkout.

The staged attachment provider advertises no image media types and rejects image operations. The staged Web composition disables its image UI, the offline overlay disables public-network Web search, and the package excludes `sharp` and its native and WebAssembly backends. Exact layout assertions stop the build when an upstream package change invalidates these substitutions.

The archive includes the checksum-verified Node.js 22.23.2 `linux-x64-glibc-217` community build, configuration examples, licenses, and installation instructions. The recommended entry point executes the build in a digest-pinned manylinux2014 container so that native dependencies cannot silently inherit a newer build-host glibc. The Linux artifact rebuilds `node-pty` against that baseline with a static C++ runtime, excludes the Windows-only Koffi, ACL, and process packages, and launches Node with `--expose-internals` instead of shipping the require-builtin native bridge.

The builder downloads the official Linux x64 Landlock platform package at the version declared by the checkout and verifies a pinned SHA-512 before installing its static `landlock-run` executable into the staged platform package. A source-version mismatch, missing executable, wrong ELF architecture, or failed kernel probe stops the build. The completed archive is extracted and the launcher checks and probe run again, so an archive operation cannot silently omit the binary or its executable mode.

Packaging dereferences hard links, records the source commit and runtime versions, rejects staged ELF files requiring symbols newer than `GLIBC_2.17`, `GLIBCXX_3.4.19`, or `CXXABI_1.3.7`, writes a SHA-256 checksum, extracts the completed archive, and runs CLI, attachment, Landlock, and authenticated HTTP Web smoke tests against the extracted files.

The builder renders a Bash 4 installation and launch script beside the archive. A maintainer sets the script's `PUBLIC_ARCHIVE_PATH` to a stable shared-filesystem symlink before distribution and provides `settings.yaml` beside it; users enter no path. Before changing files, the script reports its installation and startup actions and requires explicit confirmation; automation passes `--yes`. The script installs a missing version from a locally copied archive, preserves the Harness home, validates an existing versioned installation without copying it again, refreshes the offline patch, reports local sandbox availability, and launches Web in the foreground. The installer does not check the published checksum, so the maintainer verifies it before distribution. The build runs its fresh-install and existing-installation paths and performs the authenticated Web smoke through the installed command.

## Alternatives considered

**Patch the product source for baseline CPUs.** This would mix a deployment limitation into normal runtime behavior and require the same edits to be reconciled after upstream updates. Artifact-only substitution keeps the official checkout intact and makes upstream incompatibility a build failure.

**Commit generated archives to Git.** This would make a repository checkout carry the delivery payload, but large opaque objects would permanently expand repository history. The [release-only offline delivery decision](2026-08-31-release-only-offline-bundle-delivery.md) keeps archives, checksums, and rendered installation guides in versioned Release assets while Git retains the reviewable builder and documentation sources.

**Require x86-64-v2 or WebAssembly SIMD on every deployment host.** This preserves image attachment support and remains the preferred full-featured deployment. It does not serve controlled legacy virtual machines whose exposed CPU model cannot change.

**Launch a modern distribution runtime through a separately installed glibc 2.35 tree.** A loader and `libc.so.6` alone are not a complete isolated runtime, and mixing them with the host's older NSS, resolver, locale, and loader environment is fragile. Building the package for the host's native glibc 2.17 keeps startup conventional and testable.

**Compile `landlock-run` inside the manylinux2014 container.** The launcher release requires a native musl toolchain and publishes a verified static binary as its platform package, while the glibc baseline image does not provide `musl-gcc`. Reusing that immutable official platform package with a pinned checksum preserves the launcher release unit and avoids an additional unpinned compiler installation in the offline builder.

## Consequences

An updated checkout can produce another offline archive with one command, and the generated package can run on Linux x64 glibc 2.17 without musl, a private glibc tree, npm, pnpm, Internet access, sudo, or CPU emulation. The deployment retains text conversations and Linux local tools but gives up all image attachment and Windows behavior. A Landlock-capable target uses the packaged launcher; a Linux 3.10 deployment needs a usable bubblewrap installation because that kernel predates Landlock.

Users can run one Bash script from a shared asset directory for first installation and later launches. Versioned program directories can coexist while `~/.local/bin/dsh` selects the requested package and the shared Harness home retains configuration and sessions; prerelease storage formats still carry no downgrade compatibility promise.

Building still requires Docker or an equivalent glibc 2.17 Linux x64 toolchain, a host kernel that permits the mandatory Landlock probe, and initial access to locked dependencies, the pinned container image, the selected Node.js distribution, the pinned Landlock platform package, and the pinned node-gyp tool used for the `node-pty` rebuild. Updating the native package version requires updating its offline URL and SHA-512 in the builder before another archive can be emitted.
