# DSH Linux 离线包工具

本仓库保存 DeepSeek Harness 的 Linux x64、glibc 2.17 离线包制作脚本、安装模板和文档，支持基础 CPU 的 `text-only` 和环境二的 `image-wasm` 两种模式；产品源码单独检出。目标机要求与 Release 规则见 [OFFLINE.md](OFFLINE.md)，构建细节见 [scripts/offline/README.zh.md](scripts/offline/README.zh.md)。

在 Linux x64 Docker 构建机上，将 `--source` 指向产品源码检出目录：

```bash
./scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

环境二图片增强版使用同一入口，加 `--profile image-wasm`，输出到 `.artifacts/offline/image-wasm/`。两种包共用安装脚本与内部目录布局，默认用户数据路径均为 `~/.local/share/dsh-text-only`，启动入口均为 `~/.local/bin/dsh`；版本化程序目录以模式后缀区分。图片版要求 x86-64-v2 和 WASM SIMD。

默认归档和渲染后的安装文件放在本仓库 `.artifacts/offline/`，Node 与 Landlock 下载缓存放在 `.cache/dsh-offline/`。两处仅在本地保存，不纳入 Git；正式离线包固定通过 GitHub Release 交付。构建器会在所指定的产品源码检出目录内安装依赖、清理旧构建输出并运行产品构建，因此该目录默认必须没有已跟踪文件的未提交改动。

本仓库的讨论与检查只需面向离线打包。除非明确要求，不要默认扫描或运行产品源码仓库的全量检查。

## 两个独立环境的说明

- [环境一：现有仓库的基础 CPU 纯文字离线包](docs/environment-a-text-only.zh.md)：不支持 x86-64-v2 的目标环境及现有交付边界。
- [环境二：支持 x86-64-v2 的 CentOS 7 图片增强包](docs/environment-b-centos7-wasm.zh.md)：原始调研、独立实施与验证记录；保留图片，按用户要求排除实验性语音输入。

环境二 `0.1.7-alpha.1` 交付入口：[GitHub Release](https://github.com/jjdak/dsh-offline/releases/tag/dsh-v0.1.7-alpha.1-image-wasm.1)。下载归档、校验文件、安装脚本及中文说明；真实 Linux 3.10 沙箱与模型网关仍需目标机验收。
