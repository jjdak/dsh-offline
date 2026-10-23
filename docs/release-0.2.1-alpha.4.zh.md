# 环境二 0.2.1-alpha.4 离线包制作记录

交付：[GitHub 预发布](https://github.com/jjdak/dsh-offline/releases/tag/dsh-v0.2.1-alpha.4-image-wasm.1)。本版保留图片、排除实验性语音输入，要求 Linux x86_64、glibc 2.17+、x86-64-v2 与 WASM SIMD。

## 固定输入与制作

产品标签 `dsh-v0.2.1-alpha.4`，源码提交 `86a402200d95fecef4529d969836f1fe13c6cb0d`。独立检出到忽略的 `.cache/dsh-offline/source-0.2.1-alpha.4`；不修改已有产品工作区或产品源码。

复用固定 manylinux2014 镜像、Node `22.23.2` glibc217、system 平台包 `0.1.2`、Koffi `3.1.1` 兼容构建与 PTY 重编。新增 sharp `0.35.5` 对应 WASM 包的官方 SHA-512 固定值，继续使用固定的 emnapi `1.11.3` 与 tslib `2.8.1`。图片输入记录在归档 `IMAGE-RUNTIME.json`。

新版产品的 `build` 同时执行产物构建与测试/脚本聚合类型检查；打包器改用其 `build:artifacts`，旧版保留原构建入口。完整容器流程重新安装锁定依赖、清理旧输出并生成产品产物，无 `--skip-install`、`--skip-build` 或 `--allow-dirty`。

```bash
DSH_OFFLINE_DOCKER_NETWORK=host scripts/offline/build-text-only-container.sh \
  --source /root/dsh-offline/.cache/dsh-offline/source-0.2.1-alpha.4 \
  --profile image-wasm \
  --out /root/dsh-offline/.artifacts/offline/0.2.1-alpha.4/image-wasm
```

本机代理使用宿主回环地址，构建容器需要 host 网络。产物和日志均保持 Git 忽略，交付四项 Release 资产，不将生成物加入源码仓库。

## 验证结果（2026-10-16）

- Bash/Node 语法及 Git diff 检查通过。
- 完整容器构建通过，原生平台包摘要、Landlock 探测、CLI 版本、首次及重复安装、带认证 Web 启动全部通过。
- 7 个 ELF 全部满足 `GLIBC_2.17`、`GLIBCXX_3.4.19`、`CXXABI_1.3.7` 上限；归档无硬链接，不含 `.env`，`landlock-run` 保持可执行权限。
- PNG/JPEG/WebP/GIF 编解码、附件归一化、存储/读取、请求变体、EXIF 旋转及损坏图片拒绝通过；Web 图片入口保留；语音入口、服务及 sherpa 原生运行时缺席。
- 最终归档在固定 CentOS 7 镜像中以 `--network none`、只读输入运行 CLI、文件锁竞争与释放、沙箱 Bash 文件读写、PTY、图片及认证 Web 检查，全部通过。
- 安装回归覆盖 `0.1.7-rc.1 → 0.2.1-alpha.4` 的首次、重复安装与升级，保留模拟配置、环境文件及会话标记；模拟迁移后的 `settings.yaml.imported` 和 profile 在公共配置存在/缺失时均保留，不重新创建 `settings.yaml`。此项不证明历史会话数据库兼容。

日志位于 `.cache/dsh-offline/image-build-0.2.1-alpha.4.log`、`centos7-0.2.1-alpha.4.log`、`installer-upgrade-0.2.1-alpha.4.log`。公开安装器保留 `PUBLIC_ARCHIVE_PATH` 空白，内网维护者分发前填写实际共享归档路径，并在旁边放置 `settings.yaml`。

## 目标机验收边界

容器共享构建机内核，真实 Linux 3.10 的 bubblewrap、本地工具及真实内网模型网关仍需现场验收。图片处理通过不表示文本模型能够理解图片。升级前停止旧实例并备份配置和会话；默认数据路径仍为 `~/.local/share/dsh-text-only`，不保证降级兼容，自定义插件需确认新产品版本兼容性。
