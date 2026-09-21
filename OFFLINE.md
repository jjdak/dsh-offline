# 离线包制作与发布要求

本仓库独立维护 `scripts/offline/` 下的 Linux x64 纯文字离线包制作能力。DeepSeek Harness 产品源码位于另一个检出目录，通过构建命令的 `--source` 指定；本仓库不存放或修改产品源码。

## 目标机环境

目标机必须是 Linux `x86_64`，使用 glibc 2.17 或更高版本；不支持 musl 或私有 glibc 目录。归档中的 ELF 不得要求高于 `GLIBC_2.17`、`GLIBCXX_3.4.19` 或 `CXXABI_1.3.7` 的符号，也不得要求 x86-64-v2 或 WebAssembly SIMD。

目标机安装和启动不需要 npm、pnpm、互联网、sudo 或 QEMU。归档内置 Linux x64 `landlock-run`；支持 Landlock 的内核可直接使用本地工具。Linux 3.10 内核早于 Landlock，使用 bash 等本地工具时需要目标机另行提供可用的 bubblewrap；纯文字聊天和 Web 启动不依赖这两种进程沙箱。离线包不包含图片处理运行时，并主动拒绝图片附件。

## 制作

在装有 Docker 的 Linux x64 构建机上，将 DeepSeek Harness 源码检出到单独目录并提交待打包改动，然后运行：

```bash
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

更新产品基线时，在产品源码仓库更新并提交，再传入该检出目录。归档的 `BUILD-MANIFEST.txt` 记录产品源码提交；离线工具仓库独立管理打包脚本版本。

```bash
git -C /root/deepseek-harness fetch upstream
git -C /root/deepseek-harness merge --no-edit upstream/master
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

容器包装脚本使用固定摘要的 manylinux2014 镜像，分别挂载产品源码目录和本工具仓库。内部构建器默认使用经过 SHA-256 校验的 Node.js 22.23.2 `linux-x64-glibc-217` 运行时。构建器还会下载与产品源码 `native/landlock-run/packages/linux-x64/package.json` 版本一致的官方 npm 平台包，通过脚本中固定的 SHA-512 校验后装入归档；源码版本变化而固定资产未更新时直接失败。构建机内核必须允许归档中的 `landlock-run --probe` 成功，因为容器共享宿主内核。构建输出位于本仓库 `.artifacts/offline/`，缓存位于本仓库 `.cache/dsh-offline/`；二者保持 Git 忽略状态。若通过 `--node-runtime` 或 `--out` 使用自定义路径，容器内必须能访问该路径。

两个仓库的 `.env` 和真实 API 密钥不得进入离线包或 Release。包内只携带 `scripts/offline/dsh.env.example` 占位模板；目标机管理员在自己的 `DSH_HOME/.env` 中填写实际值。

## 验证范围

修改构建脚本、运行时输入或包内容时，只运行离线包相关检查：

```bash
bash -n scripts/offline/build-text-only.sh
bash -n scripts/offline/build-text-only-container.sh
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

完整容器构建负责依赖安装、产品源码仓库的旧构建输出清理与编译、Landlock 平台包 SHA-512 校验、`landlock-run` 可执行权限与 ELF 架构检查、打包前后内核探测、全归档 ELF 版本审计、无硬链接归档检查、SHA-256 校验、CLI 版本检查、图片附件拒绝检查、一键脚本首次安装与重复运行检查，以及经该脚本启动的带认证 Web 冒烟测试。任何一项失败都不得发布产物。

仅修改文档或 Release 元数据时不重新构建离线包；只检查改动文档、现有 SHA-256、Release 资产状态和 Git diff。除非用户明确要求，不运行上游仓库级 `pnpm run test`、`test:coverage`、`build`、`typecheck`、`lint`、`hygiene`、`doc-sync` 或其他全仓聚合流程。

## Release 交付

每个版本只通过版本化 GitHub Release 交付生成文件，不得使用 `git add -f` 把 `.artifacts/` 重新加入 Git。Release 必须同时包含以下四项资产：

- `dsh-offline-<version>-linux-x64-glibc217-text-only.tar.gz`
- 对应的 `.tar.gz.sha256`
- 构建器渲染的 `install-and-run.sh`
- 构建器渲染的 `INSTALL-text-only.zh.md`

标签使用 `dsh-v<version>-text-only.<revision>` 形式；alpha 或 rc 版本标记为预发布。Release 说明必须写明 Linux `x86_64`、glibc 2.17、纯文字限制和归档 `BUILD-MANIFEST.txt` 中的源码提交。上传后必须确认四项资产均为 `uploaded`，再次按随附校验文件验证归档，运行 `bash -n install-and-run.sh`，并确认归档包含具有可执行权限的 `app/node_modules/@deepseek-ai/node-addon-landlock-run-linux-x64/bin/landlock-run`，然后才能宣布发布完成。

一键安装启动脚本以 `scripts/offline/install-and-run.sh.in` 为源，安装说明与内网模型配置以 `scripts/offline/INSTALL-text-only.zh.md.in` 为源。构建器渲染后，维护者必须在分发前将脚本顶部的 `PUBLIC_ARCHIVE_PATH` 填为归档固定软链接（如 `/share/dsh-offline/latest`）的绝对路径，并在同一目录放置 `settings.yaml`。目标机用户只运行脚本并确认，不输入资产路径。安装脚本按归档文件名识别版本；它不在安装时使用 Release 随附的 SHA-256 文件，维护者发布前必须验证该文件。
