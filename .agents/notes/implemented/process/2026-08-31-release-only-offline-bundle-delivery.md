# Agent Note: Release-only offline bundle delivery

Status: implemented

English | [中文](2026-08-31-release-only-offline-bundle-delivery.zh.md)

## Problem

The verified text-only archive is approximately 96.6 MB. Storing that compressed output in Git permanently increases clone and fetch cost and exceeds GitHub's recommended 50 MB per-file threshold. Rebuilding on demand is not an equivalent handoff because external dependency artifacts can change or disappear, so each release still needs durable downloadable bytes tied to an identified source commit.

## Decision

The root [offline requirements](../../../../OFFLINE.md) own the current build, validation, target-host, and delivery rules. Git stores the builder, source installer and installation-guide templates, documentation, and Agent Notes. `.artifacts/offline/` remains ignored, and generated archives, checksum files, installers, and installation guides are never force-added.

Each deliverable is a versioned GitHub Release containing the `.tar.gz`, its `.sha256`, the rendered `install-and-run.sh`, and the rendered `INSTALL-text-only.zh.md`. Before distribution, the maintainer sets the installer's `PUBLIC_ARCHIVE_PATH` to the absolute path of a stable archive symlink and provides `settings.yaml` beside it. The Release records the product-source commit from the archive's `BUILD-MANIFEST.txt`, uses the text-only tag convention, and exposes prerelease status for alpha and rc versions. Delivery completes only after all four assets report `uploaded`, the downloaded archive matches the published checksum, and the downloaded installer passes Bash syntax validation. The installer itself does not check the checksum.

This standalone repository keeps packaging tools and documents separate from the DeepSeek Harness product checkout. Packaging-input changes use shell syntax checks and the complete container builder. Documentation-only and Release-metadata changes use focused document, checksum, asset-state, and Git-diff checks. Product repository-wide suites run only when a user explicitly requests them.

## Verification

The container builder checks dependency installation and compilation, every staged ELF version requirement, gzip integrity, absence of hard-link entries, the final checksum, CLI version, text-only attachment rejection, the installer's fresh and repeated paths, and the authenticated Web application started through that installer. Release verification checks the tag target, prerelease state where applicable, exact asset names and sizes, `uploaded` state, installer syntax, and checksum agreement before publication is announced.

## Alternatives considered

**Store delivery files in Git.** A clone receives the exact archive without a second service, but every clone carries the compressed binary and ordinary deletion cannot remove it from existing history. Embedding the archive in the source commit also cannot make `BUILD-MANIFEST.txt` name that containing commit without a circular input. Once a Release exists, Git storage creates a second delivery location without improving verification.

**Store the archive with Git LFS.** LFS reduces the Git object database but adds another external object service and repository configuration. GitHub Releases already provide the required asset service and keep generated delivery files separate from source history.

**Rebuild every requested version on demand.** The source remains small, but dependency downloads or selected artifacts can change or disappear. A retained Release asset and checksum preserve the verified bytes without requiring a reproducible external network indefinitely.

## Consequences

Repository clones do not contain current offline archives and must download them from GitHub Releases. Release retention is therefore part of delivery availability. Local builds remain available under the ignored `.artifacts/offline/` directory, and the Release assets remain independently verifiable from their checksum and recorded product-source commit. The product checkout contains no current offline tooling or delivery files.
