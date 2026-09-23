# 环境一：现有仓库的基础 CPU 纯文字离线包

本文说明本仓库现有 `text-only` 离线包的目标环境与交付边界。它与另一台支持 x86-64-v2 的 CentOS 7 调研服务器是两个独立环境，不能互相套用 CPU 条件或验证结果。

## 目标与环境

目标是在不支持 x86-64-v2 的 Linux x86_64 环境中运行 DeepSeek Harness 的文本会话、Web 界面和本地工具。目标机使用 glibc 2.17 或更高版本，不需要安装 npm、pnpm，也不需要在安装和启动时联网、使用 sudo 或运行 Docker。模型通过目标机可访问的 API 提供；离线包不包含模型权重。

| 项目 | 现有包的兼容性约束 |
| --- | --- |
| CPU | 基础 x86-64，不要求 x86-64-v2 |
| C 运行库 | glibc ≥ 2.17；不支持 musl 或私有 glibc 目录 |
| ELF 符号上限 | `GLIBC_2.17`、`GLIBCXX_3.4.19`、`CXXABI_1.3.7` |
| WebAssembly | 不得要求 WASM SIMD |
| 图片附件 | 不支持；服务主动拒绝图片，Web 图片入口关闭 |
| 本地工具沙箱 | 包内含 `landlock-run`；Linux 3.10 需要目标机另行提供可用的 bubblewrap |

这里的 Linux 3.10 条件是包的适配边界，不代表环境一的具体内核已经确认。另一环境的 Xeon Gold 6354 型号、CPU flags 和内核版本不属于本环境的已知信息。

## 当前实现

构建器使用固定摘要的 manylinux2014 镜像和经过校验的 Node.js 22.23.2 glibc217 运行时，重编译 `node-pty`，装入固定版本并校验过的 Landlock 平台包，并对 Linux 产物中的不适用原生依赖进行处理。

为了满足基础 CPU 和旧运行库约束，打包过程替换原有附件服务，关闭 Web 图片附件入口，并移除 sharp 及其图片处理运行时。图片支持被移除是本交付方案的明确边界，不能仅通过打开界面配置恢复。

文本聊天和 Web 启动不依赖 Landlock 或 bubblewrap；运行 Bash 等本地工具则需要可用沙箱。在 Linux 3.10 上，附带 `landlock-run` 不等于本地工具已可用，仍须验证实际用户能否运行 bubblewrap。

## 构建与交付

产品源码位于独立检出目录，在有 Docker 的 Linux x64 构建机运行：

```bash
./scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

目标机不需要 Docker。构建输出位于 `.artifacts/offline/`，下载缓存位于 `.cache/dsh-offline/`；生成文件不纳入 Git。

正式交付按 [OFFLINE.md](../OFFLINE.md) 通过版本化 GitHub Release 提供归档、SHA-256 文件、`install-and-run.sh` 和 `INSTALL-text-only.zh.md`。使用该次构建渲染的安装说明；维护者先验证校验文件，再配置一键脚本的公共归档路径及同目录的 `settings.yaml`。

真实 API 密钥仅在目标机自己的 `DSH_HOME/.env` 中配置，不得进入源码、归档或 Release。

## 验证范围与验收

现有完整构建流程包含 ELF 版本审计、归档校验、CLI 版本检查、图片附件拒绝测试、安装脚本首次及重复运行检查、带认证的 Web 冒烟测试，以及构建宿主内核上的 Landlock 探测。流程包含这些检查，不代表任意新产物已经通过，也不代表真实旧内核已通过验证。

部署验收需要确认：

1. 归档版本、源码提交及 SHA-256 与交付记录一致。
2. 目标机文本会话及真实模型 API 的流式响应正常。
3. Web 认证和访问正常，图片附件按预期拒绝。
4. 实际用户下的沙箱、本地工具调用、文件读写和 PTY 正常；Linux 3.10 重点检查 bubblewrap。

本文整理自仓库现有实现和约束，不新增一次构建、发布或目标机测试结论。

相关文档：[仓库制作规范](../OFFLINE.md) · [构建细节](../scripts/offline/README.zh.md) · [环境二调研说明](environment-b-centos7-wasm.zh.md)
