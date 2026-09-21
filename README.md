# DSH 纯文字离线包工具

本仓库只保存 DeepSeek Harness 的 Linux x64、glibc 2.17 纯文字离线包制作脚本、安装模板和文档；产品源码单独检出，不复制到这里。目标机要求与 Release 规则见 [OFFLINE.md](OFFLINE.md)，构建细节见 [scripts/offline/README.zh.md](scripts/offline/README.zh.md)。

在 Linux x64 Docker 构建机上，将 `--source` 指向产品源码检出目录：

```bash
./scripts/offline/build-text-only-container.sh --source /root/deepseek-harness
```

默认归档和渲染后的安装文件放在本仓库 `.artifacts/offline/`，Node 与 Landlock 下载缓存放在 `.cache/dsh-offline/`。两处仅在本地保存，不纳入 Git；正式离线包固定通过 GitHub Release 交付。构建器会在所指定的产品源码检出目录内安装依赖、清理旧构建输出并运行产品构建，因此该目录默认必须没有已跟踪文件的未提交改动。

本仓库的讨论与检查只需面向离线打包。除非明确要求，不要默认扫描或运行产品源码仓库的全量检查。
