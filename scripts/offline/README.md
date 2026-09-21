# Text-only Linux offline bundle

English | [中文](README.zh.md)

This directory builds a self-contained Linux x64 DeepSeek Harness archive for glibc 2.17 hosts that cannot load the `sharp` x86-64-v2 binary or its WebAssembly SIMD fallback. The archive supports text conversations and local tools but intentionally rejects image attachments. The [offline-builder Agent Note](../../.agents/notes/implemented/process/2026-08-25-text-only-offline-builder.md) records the packaging decision.

## Prerequisites

The recommended builder requires Docker on a Linux x64 host whose kernel permits a Landlock probe. It runs inside a digest-pinned manylinux2014 image whose glibc 2.17 baseline matches the deployment target; the container shares the host kernel for the probe. The first dependency install, container-image pull, Node runtime download, and pinned Landlock platform-package download require Internet access; the generated archive does not.

## Build

Pass the separate DeepSeek Harness source checkout to the container builder:

```sh
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

For a new upstream baseline, update and commit the product source checkout before running the builder so that `BUILD-MANIFEST.txt` names the packaged source commit:

```sh
git -C /root/deepseek-harness fetch upstream
git -C /root/deepseek-harness merge --no-edit upstream/master
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

The inner builder defaults to the checksum-verified Node 22.23.2 `linux-x64-glibc-217` community build. To package another compatible extracted Node distribution, place it below this tool repository or the source checkout so that the container can read it, then pass its directory through the container wrapper:

```sh
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness --node-runtime /root/dsh-offline/.cache/dsh-offline/node-v22.23.2-linux-x64-glibc-217
```

The direct `build-text-only.sh` entry point is available only on Linux x64 build hosts whose own glibc is no newer than 2.17. The builder rejects tracked worktree changes by default. `--skip-install` and `--skip-build` are intended only for a checkout whose locked dependencies and complete build outputs were already produced from the same commit.

## Install and start

Before distributing the rendered script, the maintainer sets its top-level `PUBLIC_ARCHIVE_PATH` to the absolute path of the stable archive symlink (for example `/shared/dsh/latest`) and puts `settings.yaml` beside that link. A user can then install or start the currently selected version from any directory without entering an asset path:

```sh
bash /shared/dsh/install-and-run.sh
```

The script requires Bash 4 or newer. Before changing files, it lists the checks, installation paths, configuration handling, sandbox probe, and startup action, then waits for the user to enter `y`; any other input cancels without changes. It checks Linux x64 and glibc 2.17, copies the selected archive only when its versioned installation is absent, installs below `~/.local/`, keeps existing `settings.yaml`, `.env`, and sessions in `DSH_HOME`, refreshes the offline patch, checks Landlock or bubblewrap, and starts the Web application in the foreground. An existing valid installation skips copying and extraction. Use `--install-only` for validation without startup, `--port PORT` to change the port, or `--yes` for explicit non-interactive confirmation. The installer does not verify a checksum; verify the Release checksum before making an archive available to users.

## Outputs

The default output directory is this repository's `.artifacts/offline/`. It receives the versioned `linux-x64-glibc217-text-only` `.tar.gz`, its `.sha256` file, the rendered `install-and-run.sh`, and a Chinese installation and intranet-model configuration tutorial. The Node and Landlock download cache stays in this repository's ignored `.cache/dsh-offline/`.

The builder installs dependencies, removes repository-owned stale build outputs, runs the repository build, deploys the production package set, materializes workspace links into an independent staging tree, substitutes the text-only attachment provider there, removes `sharp`, and creates a hard-link-free archive. It rebuilds `node-pty` from source with a statically linked C++ runtime, excludes the Windows-only `koffi`, ACL, and process packages, and uses Node's `--expose-internals` fallback instead of the incompatible native require-builtin bridge. It downloads the official Linux x64 Landlock platform package whose version matches the checkout, verifies the pinned SHA-512, installs its static launcher, verifies its executable mode and ELF architecture, and requires `landlock-run --probe` to pass before and after archiving. A Landlock source-version change requires an explicit asset URL and checksum update in `build-text-only.sh`.

Before packaging, the builder audits every staged ELF and rejects any dependency newer than `GLIBC_2.17`, `GLIBCXX_3.4.19`, or `CXXABI_1.3.7`; the complete result is stored in `ELF-AUDIT.txt`. It then extracts the archive, checks the CLI version and text-only rejection behavior, runs the installer through fresh and existing-installation paths, and starts the Web application through that installer for an authenticated HTTP smoke test. An upstream layout change, missing launcher, checksum mismatch, failed Landlock probe, installer failure, or incompatible ELF fails the build instead of emitting an unverified delivery.
