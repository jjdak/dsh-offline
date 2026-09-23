# 离线包制作与发布要求

本仓库独立维护 `scripts/offline/` 下的 Linux x64 离线包制作能力，支持默认 `text-only` 和环境二专用的 `image-wasm` 两种模式。DeepSeek Harness 产品源码位于另一个检出目录，通过构建命令的 `--source` 指定；本仓库不存放或修改产品源码。

## 目标机环境

目标机必须是 Linux `x86_64`，使用 glibc 2.17 或更高版本；不支持 musl 或私有 glibc 目录。两种归档中的 ELF 均不得要求高于 `GLIBC_2.17`、`GLIBCXX_3.4.19` 或 `CXXABI_1.3.7` 的符号。`text-only` 不得要求 x86-64-v2 或 WebAssembly SIMD；`image-wasm` 面向另一台已确认支持 v2 的服务器，允许并明确要求 x86-64-v2 和 WASM SIMD，不能交付给环境一。

目标机安装和启动不需要 npm、pnpm、互联网、sudo 或 QEMU。归档内置 Linux x64 `landlock-run`；支持 Landlock 的内核可直接使用本地工具。Linux 3.10 内核早于 Landlock，使用 bash 等本地工具时需要目标机另行提供可用的 bubblewrap；纯文字聊天和 Web 启动不依赖这两种进程沙箱。`text-only` 不包含图片处理运行时，并主动拒绝图片附件；`image-wasm` 保留上游附件服务及 Web 图片入口，排除 sharp 原生包，装入校验过的 WASM 运行时。模型是否能理解图片由模型 API 决定。

## 制作

两种离线模式均排除实验性语音输入 Bundle、UI、服务及 sherpa-onnx 原生依赖，不携带或下载语音模型。此范围已由用户确认；不能仅移除原生绑定而保留不可用的语音入口。

在装有 Docker 的 Linux x64 构建机上，将 DeepSeek Harness 源码检出到单独目录并提交待打包改动，然后运行：

```bash
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

环境二使用同一构建入口并指定模式：

```bash
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness --profile image-wasm
```

两种模式共用 `install-and-run.sh`、归档内 `app/`、`node/`、`bin/`、`config/`、`data/` 布局，以及默认用户数据路径 `~/.local/share/dsh-text-only`。程序目录仍在 `~/.local/` 下按版本及模式命名，命令入口仍为 `~/.local/bin/dsh`；安装器识别两种归档后缀，避免相同版本的两种包互相误用。图片版默认输出到 `.artifacts/offline/image-wasm/`，防止覆盖已有纯文字安装文件。两种构建不得并发使用同一产品工作目录。

更新产品基线时，在产品源码仓库更新并提交，再传入该检出目录。归档的 `BUILD-MANIFEST.txt` 记录产品源码提交；离线工具仓库独立管理打包脚本版本。

```bash
git -C /root/deepseek-harness fetch upstream
git -C /root/deepseek-harness merge --no-edit upstream/master
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

容器包装脚本使用固定摘要的 manylinux2014 镜像，分别挂载产品源码目录和本工具仓库。内部构建器默认使用经过 SHA-256 校验的 Node.js 22.23.2 `linux-x64-glibc-217` 运行时。构建器根据源码布局选择 `native/landlock-run` 或新版 `native/system` 的官方 npm 平台包，校验固定 SHA-512 和版本后装入归档；版本变化而固定资产未更新时直接失败。新版文件锁原生模块在 glibc 2.17 上重编；新版 Linux 子进程所需 Koffi 也从锁定源码重编，使用 POSIX stat 回退和基础 CPU 编译参数，静态链接 C++ 运行库。旧版仅供 Windows 使用的 Koffi 仍按原流程排除。图片版的 sharp、WASM、emnapi 和 tslib 输入记录在 `IMAGE-RUNTIME.json`。构建机内核必须允许 `landlock-run --probe` 成功，因为容器共享宿主内核。输出与缓存保持 Git 忽略状态；自定义运行时和输出路径必须可在容器中访问。

两个仓库的 `.env` 和真实 API 密钥不得进入离线包或 Release。包内只携带 `scripts/offline/dsh.env.example` 占位模板；目标机管理员在自己的 `DSH_HOME/.env` 中填写实际值。

部署阶段使用 isolated 依赖布局读取产品锁文件，再实体化为归档目录。不要改回 hoisted 部署：当前 pnpm 的 legacy hoisted deploy 会忽略锁文件，导致 sharp 等依赖漂移；固定运行时版本检查会拒绝这类产物。

## 验证范围

修改构建脚本、运行时输入或包内容时，只运行离线包相关检查：

```bash
bash -n scripts/offline/build-text-only.sh
bash -n scripts/offline/build-text-only-container.sh
bash -n scripts/offline/install-and-run.sh.in
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

图片版在完整构建命令中加 `--profile image-wasm`。除公共验证外，图片版验证 PNG/JPEG/WebP/GIF 附件的处理、存储及请求变体、EXIF 旋转和损坏图片拒绝；纯文字版继续验证图片拒绝行为。共享安装脚本修改还需验证原有 text-only 安装路径。容器通过不代表真实 3.10 内核或真实模型 API 已通过。

完整容器构建负责依赖安装、产品源码仓库的旧构建输出清理与编译、Landlock 平台包 SHA-512 校验、`landlock-run` 可执行权限与 ELF 架构检查、打包前后内核探测、全归档 ELF 版本审计、无硬链接归档检查、SHA-256 校验、CLI 版本检查、图片附件拒绝检查、一键脚本首次安装与重复运行检查，以及经该脚本启动的带认证 Web 冒烟测试。任何一项失败都不得发布产物。

仅修改文档或 Release 元数据时不重新构建离线包；只检查改动文档、现有 SHA-256、Release 资产状态和 Git diff。除非用户明确要求，不运行上游仓库级 `pnpm run test`、`test:coverage`、`build`、`typecheck`、`lint`、`hygiene`、`doc-sync` 或其他全仓聚合流程。

## Release 交付

每个版本只通过版本化 GitHub Release 交付生成文件，不得使用 `git add -f` 把 `.artifacts/` 重新加入 Git。Release 必须同时包含以下四项资产：

- `dsh-offline-<version>-linux-x64-glibc217-text-only.tar.gz`
- 对应的 `.tar.gz.sha256`
- 构建器渲染的 `install-and-run.sh`
- 构建器渲染的 `INSTALL-text-only.zh.md`

图片版对应四项资产为 `dsh-offline-<version>-linux-x64-glibc217-image-wasm.tar.gz`、对应 `.sha256`、同一模板渲染的 `install-and-run.sh` 和 `INSTALL-image-wasm.zh.md`；标签使用 `dsh-v<version>-image-wasm.<revision>`，预发布产品仍标记为预发布。说明必须写明 v2/WASM SIMD 要求及未完成的目标机验收，不得将图片版宣称为基础 CPU 兼容。

标签使用 `dsh-v<version>-text-only.<revision>` 形式；alpha 或 rc 版本标记为预发布。Release 说明必须写明 Linux `x86_64`、glibc 2.17、纯文字限制和归档 `BUILD-MANIFEST.txt` 中的源码提交。上传后必须确认四项资产均为 `uploaded`，再次按随附校验文件验证归档，运行 `bash -n install-and-run.sh`，并确认归档包含具有可执行权限的 `app/node_modules/@deepseek-ai/node-addon-landlock-run-linux-x64/bin/landlock-run`，然后才能宣布发布完成。

采用新版 `native/system` 的归档，应验证实际路径 `app/node_modules/@deepseek-ai/node-addon-system-linux-x64/bin/landlock-run`；安装器兼容两种原生包布局。

一键安装启动脚本以 `scripts/offline/install-and-run.sh.in` 为源，安装说明与内网模型配置以 `scripts/offline/INSTALL-text-only.zh.md.in` 为源。构建器渲染后，维护者必须在分发前将脚本顶部的 `PUBLIC_ARCHIVE_PATH` 填为归档固定软链接（如 `/share/dsh-offline/latest`）的绝对路径，并在同一目录放置 `settings.yaml`。目标机用户只运行脚本并确认，不输入资产路径。安装脚本按归档文件名识别版本；它不在安装时使用 Release 随附的 SHA-256 文件，维护者发布前必须验证该文件。
