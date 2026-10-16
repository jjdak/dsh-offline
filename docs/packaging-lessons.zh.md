# 离线包制作经验与复用工具

适用基线：环境二 `0.1.7-alpha.1 → alpha.2 → rc.1` 图片增强版，明确排除语音。环境一仍为独立的 `text-only` 模式，不能将图片版交给不支持 x86-64-v2 的机器。

## 已归档的实现

工具全部在 `scripts/offline/`，不依赖临时目录中的脚本：

| 工具 | 固化的经验 |
| --- | --- |
| `build-text-only-container.sh` / `build-text-only.sh` | 固定构建镜像、glibc 2.17 Node、平台包校验、原生模块重编、ELF 符号上限审计、归档及安装验证 |
| `materialize-deploy.mjs` | isolated 部署后实体化，避免 legacy hoisted deploy 忽略锁文件造成依赖漂移 |
| `stage-image-wasm.mjs` | 固定 sharp 0.35.3 与 WASM 后端，适配 CJS/ESM 双入口，排除原生 sharp/libvips |
| `stage-koffi.mjs` | 新版 Linux 子进程也需要 Koffi；旧 glibc 下使用 POSIX stat 回退和基础 CPU 编译参数 |
| `stage-internal-loader.mjs` | 适配 Node 内部模块加载；配合固定运行时和 `--expose-internals` |
| `exclude-voice.mjs` | 同时移除语音 Bundle、服务、UI 和原生依赖，不留下不可用入口 |
| `verify-native-runtime.mjs` | 文件锁竞争/释放、真实本地子进程、PTY 检查 |
| `verify-image-wasm.mjs` | 图片编码、存储、请求变体、旋转、坏图拒绝与无原生图片依赖检查 |
| `verify-centos7-container.sh` | 固定 CentOS 7 镜像、断网、只读输入下的 CLI/原生/图片/带认证 Web 验证 |
| `verify-installer-upgrade.mjs` | 临时 HOME 中首次/重复安装和跨版本升级，检查配置、模拟环境文件、会话标记保留及命令入口切换 |

后两项是本次从临时验证流程整理出来的独立工具，不改变构建输入或现有离线包。安装升级工具测试当前安装模板，而非历史 Release 内安装器；会话标记保留不等于历史数据库格式兼容。

## 可以复用与必须重做的部分

复用 Docker 镜像、`.pnpm-store/`、`.cache/dsh-offline/` 中已校验的 Node/npm 下载和打包适配脚本。alpha.2、rc.1 沿用了已有适配流程；缓存只是加速，不代替版本/摘要检查。

新版本必须重新编译产品、检查锁文件和原生包变化、运行完整构建验证。不能把上一版构建目录或通过结论直接带到新版；`--skip-build` / `--skip-install` 只用于同一源码提交的调试。不要并发使用同一产品源码目录。

产品源码通过 `--source` 独立传入；打包适配在暂存产物上完成，不要把兼容性改动混入用户产品工作区。归档的 `BUILD-MANIFEST.txt` 和 `IMAGE-RUNTIME.json` 是追溯输入的依据。

关键坑点：

- sharp 新版入口为 `dist/sharp.cjs` / `.mjs`，不能只改旧 `lib/sharp.js`；不要寄希望于原生加载失败自动回退，旧 CPU 可能先崩溃。
- `native/landlock-run` 迁移到 `native/system` 后增加文件锁模块，需同步平台包路径、固定摘要和 glibc 2.17 重编步骤。
- Koffi 的 statx 会提高 glibc 要求；所有 ELF 都要审计，不能只检查 Node。符号上限保持 `GLIBC_2.17`、`GLIBCXX_3.4.19`、`CXXABI_1.3.7`。
- 单独 `--version` 不足以覆盖启动链，必须实际启动带认证 Web 并执行原生、图片检查。
- sherpa-onnx 的原生依赖超出旧系统能力；本任务按明确需求排除语音，不随升级悄悄恢复。
- 小内存构建机曾发生 TypeScript OOM。应安排足够内存，必要时由维护者管理临时 swap；验证工具不自动修改宿主 swap。
- 容器代理地址指向宿主回环地址时，默认 bridge 网络无法访问；可用 `DSH_OFFLINE_DOCKER_NETWORK=host` 运行构建入口。最终 CentOS 7 验证仍使用断网模式。
- 构建日志存入忽略目录 `.cache/dsh-offline/`，不要仅放 `/tmp` 或依赖终端历史。

## 下一版操作清单

1. 在独立产品检出目录确认版本、源码提交和干净状态；检查依赖变化是否仍被现有适配器支持。
2. 先读 [OFFLINE.md](../OFFLINE.md)，按实际改动运行 Bash/Node 语法检查；构建输出显式按版本和模式分目录：

   ```bash
   bash scripts/offline/build-text-only-container.sh \
     --source /path/to/product-checkout --profile image-wasm \
     --out /root/dsh-offline/.artifacts/offline/0.1.7-rc.1/image-wasm
   ```

   上例为 rc.1 路径；制作下一版时替换版本。text-only 使用相应模式和目录。不要覆盖已经交付的版本。

3. 对可信的成品归档运行独立验证（旁边必须有 `.sha256`）：

   ```bash
   bash scripts/offline/verify-centos7-container.sh /path/to/new-image-wasm.tar.gz
   node scripts/offline/verify-installer-upgrade.mjs /path/to/old.tar.gz /path/to/new.tar.gz
   ```

   实际文件名须保持 `dsh-offline-<version>-linux-x64-glibc217-<profile>.tar.gz`。CentOS 工具接受版本化 image-wasm 归档；更新产品时仍须检查验证器使用的原生和图片 API。镜像固定为 `centos@sha256:be65f488b7764ad3638f236b7b515b3678369a5124c47b8d32916d6487418ea4`，需提前加载；工具使用 `--pull never --network none`，不自动下载、不发布端口。构建机内核须支持验证器使用的 Landlock。安装工具需要 Linux x64、Node、Bash、SHA-256 工具及足够临时空间；只在自建临时 HOME 写入模拟数据，结束后清理。

4. 全部通过后按 OFFLINE.md 发布四项 Release 资产，先检查上传状态、归档摘要和安装器语法，再宣布交付。不要把生成物强制加入 Git；本次仅归档验证工具，无需重新发布旧包。

## 目录与配置约定

本地归档采用 `.artifacts/offline/<产品版本>/<profile>/`，每版保留归档、校验文件、渲染后的安装器和中文说明；共享下载放 `dependencies/`，缓存仍留 `.cache/`，不要混入版本交付目录。历史缺失的安装器不要用最新版冒充补齐。构建器默认输出未改，后续须显式传 `--out`。

两种模式共用 `app/node/bin/config/data` 布局、安装模板、`~/.local/bin/dsh` 入口及 `~/.local/share/dsh-text-only` 用户数据目录。版本化程序目录包含模式后缀，避免覆盖。分发前维护者需填写安装器 `PUBLIC_ARCHIVE_PATH`，并在共享目录提供 `settings.yaml`；公开安装模板故意留空该路径。

旧 settings.yaml 通常保留；自定义过 `spill-policy.maxInlineBytes` 的配置从 alpha.2 起需检查 `maxInlineTokens`，自定义插件还需确认 rc.1 兼容性。升级前备份真实配置和会话；不承诺数据降级兼容。真实 `.env`、API 密钥一律不入库、不入包。

## 验证边界

本次归档工具实测通过：`0.1.7-rc.1 image-wasm` 断网 CentOS 7 CLI/原生/图片/认证 Web；`0.1.7-alpha.2 → 0.1.7-rc.1 image-wasm` 首次、重复安装及升级保留检查。Bash/Node 语法检查通过；未修改打包输入、未重建或重新发布已有归档。

CentOS 7 容器证明旧用户空间运行情况，不证明 Linux 3.10 内核可用，因为容器共享宿主内核。真实旧服务器的 bubblewrap、本地工具与模型网关仍需目标机验收；纯聊天和 Web 启动不依赖进程沙箱。图片处理验证也不等于模型能理解图片。不要为离线包任务额外运行产品全仓测试、lint、coverage 或文档聚合流程。
