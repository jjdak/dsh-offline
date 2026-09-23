# DSH offline packaging

Read [OFFLINE.md](OFFLINE.md) before changing packaging scripts or release instructions. This repository contains only offline packaging tools and documentation; the DeepSeek Harness product source is a separate checkout supplied through `--source DIR`.

Keep generated archives, checksums, rendered installers and guides, and download caches out of Git. Deliver verified archives through GitHub Release assets. Never include `.env` files or API keys.

For script or packaging-input changes, run focused Bash syntax checks and the complete container builder before publishing a new archive. Documentation-only and Release-metadata changes need only focused document, asset, and Git-diff checks. Do not run product repository-wide test, build, lint, coverage, hygiene, or documentation aggregates unless explicitly requested.

Target Linux `x86_64` with glibc 2.17 or newer. Both profiles include `landlock-run`; Linux 3.10 needs a usable bubblewrap installation for local tools. Text chat and Web startup do not require a process sandbox. The default `text-only` profile excludes images and must not require x86-64-v2 or WebAssembly SIMD. The separate `image-wasm` profile targets environment two, requires x86-64-v2 and WASM SIMD, and retains the upstream image service with a pinned WASM backend. Both profiles retain ELF symbol ceilings `GLIBC_2.17`, `GLIBCXX_3.4.19`, and `CXXABI_1.3.7`, share the installer and internal archive layout, and default to `~/.local/share/dsh-text-only` for user data. Distinct versioned program directories prevent profile collisions.
