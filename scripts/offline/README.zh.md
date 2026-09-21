# 纯文字 Linux 离线包

[English](README.md) | 中文

本目录用于构建自包含的 Linux x64 DeepSeek Harness 归档，适用于使用 glibc 2.17，且无法加载 `sharp` x86-64-v2 二进制文件及其 WebAssembly SIMD 后备实现的主机。归档支持文字会话和本地工具，但会主动拒绝图片附件。[离线构建器 Agent Note](../../.agents/notes/implemented/process/2026-08-25-text-only-offline-builder.zh.md)记录了这项打包决策。

## 前置条件

推荐的构建器要求 Linux x64 主机装有 Docker，并且主机内核允许 Landlock 探测。它在固定镜像摘要的 manylinux2014 镜像内运行；该镜像的 glibc 2.17 基线与部署目标一致，容器执行探测时与主机共享内核。首次安装依赖、拉取容器镜像、下载 Node 运行时及下载固定 Landlock 平台包需要访问互联网；生成的归档不需要网络安装依赖。

## 构建

将独立的 DeepSeek Harness 产品源码检出目录传给容器构建器：

```sh
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

更新上游基线时，应先在产品源码仓库更新并提交，再运行构建器，确保 `BUILD-MANIFEST.txt` 指向打包的产品源码提交：

```sh
git -C /root/deepseek-harness fetch upstream
git -C /root/deepseek-harness merge --no-edit upstream/master
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

内部构建器默认使用经过校验和验证的 Node 22.23.2 `linux-x64-glibc-217` 社区构建。如需打包另一个已解压的兼容 Node 发行目录，请先将它放在本工具仓库或产品源码检出目录下，使容器可读，再通过容器包装脚本传入该目录：

```sh
scripts/offline/build-text-only-container.sh --source /root/deepseek-harness --node-runtime /root/dsh-offline/.cache/dsh-offline/node-v22.23.2-linux-x64-glibc-217
```

直接入口 `build-text-only.sh` 只可在自身 glibc 不高于 2.17 的 Linux x64 构建主机上运行。构建器默认拒绝存在已跟踪文件变更的 worktree。只有当前检出的同一提交已经生成锁定依赖和完整构建输出时，才可使用 `--skip-install` 和 `--skip-build`。

## 安装并启动

维护者分发渲染后的脚本前，在脚本顶部将 `PUBLIC_ARCHIVE_PATH` 设置为归档固定软链接（例如 `/shared/dsh/latest`）的绝对路径，并在同一目录放置 `settings.yaml`。用户随后可以从任意当前目录安装或启动当前选中的版本，不需要输入资产路径：

```sh
bash /shared/dsh/install-and-run.sh
```

脚本要求 Bash 4 或更高版本。修改文件前，它会列出检查项目、安装路径、配置处理、沙箱探测和启动操作，然后等待用户输入 `y`；其他输入会取消且不做修改。它检查 Linux x64 和 glibc 2.17，仅在缺少带版本号的安装目录时复制归档，将程序安装到 `~/.local/`，保留 `DSH_HOME` 中已有的 `settings.yaml`、`.env` 和会话，刷新离线 patch，检查 Landlock 或 bubblewrap，并以前台方式启动 Web 应用。有效的现有安装会跳过复制和解压。使用 `--install-only` 可只验证而不启动，使用 `--port PORT` 可更改端口，使用 `--yes` 可明确确认非交互运行。安装脚本本身不检查校验和；向用户开放归档前须验证 Release 校验文件。

## 产物

默认输出目录是本仓库的 `.artifacts/offline/`，其中包含带版本号及 `linux-x64-glibc217-text-only` 标识的 `.tar.gz`、对应的 `.sha256` 文件、渲染后的 `install-and-run.sh`，以及中文安装和内网模型配置教程。Node 与 Landlock 下载缓存位于本仓库忽略的 `.cache/dsh-offline/`。

构建器安装依赖，清理仓库管理的陈旧构建输出，运行仓库构建，部署生产包集合，将工作区链接实体化到独立暂存目录，在其中替换纯文字附件提供方，移除 `sharp`，并创建不含硬链接的归档。它会从源码重编 `node-pty` 并静态链接 C++ 运行库，排除仅供 Windows 使用的 `koffi`、ACL 与进程包，并使用 Node 的 `--expose-internals` 后备路径替代不兼容的原生 require-builtin 桥。构建器下载与当前检出版本一致的官方 Linux x64 Landlock 平台包，验证固定 SHA-512，装入静态启动器，检查可执行权限及 ELF 架构，并要求 `landlock-run --probe` 在打包前后均成功。Landlock 源码版本变化时，必须显式更新 `build-text-only.sh` 中的资产 URL 和校验和。

打包前，构建器会审计暂存目录中的每个 ELF，拒绝高于 `GLIBC_2.17`、`GLIBCXX_3.4.19` 或 `CXXABI_1.3.7` 的依赖，并将完整结果写入 `ELF-AUDIT.txt`。随后它会解压归档，检查 CLI 版本和纯文字拒绝行为，运行一键脚本的首次安装与已有安装路径，并通过该脚本启动 Web 应用执行带认证的 HTTP 冒烟测试。上游目录布局变化、启动器缺失、校验和不匹配、Landlock 探测失败、安装脚本失败或 ELF 不兼容都会使构建直接失败，不会生成未经验证的交付内容。
