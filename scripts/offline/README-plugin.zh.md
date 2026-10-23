# 通用插件离线安装器与打包配方

所有插件共用 `install-plugin.sh` 和 `plugin-offline.mjs`。安装器从文件包读取插件名、版本、平台、profile 和依赖要求，按插件声明的最低 DSH 版本判断，不要求与制作时的版本完全相同。安装、重复安装和回退的命令一致，只需更换文件包路径。

制作环节仍需按插件审查、构建和适配，入口为 `build-plugin-offline.mjs`。当前已在 `DSH 0.2.1-alpha.4 image-wasm` 验证 `dsh-pet 0.3.7` 浏览器版和 [`dsh-memory 0.8.1` 自带 Python 版](#dsh-memory-081)。例如 `0.2.1-rc.1` 不会因与制作版本不同而被拒绝。pet 的 DSH 依赖最低为 `0.2.0-rc.1`；其他插件以各自声明为准。达到版本要求允许安装，实际功能仍取决于新版 DSH 的接口。安装器通用并不意味着可以直接安装任意源码 ZIP/npm tarball，或自动满足插件的数据库、原生模块、外部服务需求。

共享目录只需保留本文 `INSTALL-plugins.zh.md` 一个说明入口。每个插件版本目录可以另附独立说明，便于单独交付；制作源文件分别保存在工具仓库中。

## 安装用户

建议维护一个共享工具目录，所有插件只分发各自的文件包和校验文件：

```text
/share/plugins/
├── install-plugin.sh             # 所有插件共用
├── plugin-offline.mjs            # 所有插件共用，与 Bash 入口一起更新
├── dsh-pet/0.3.7/
│   ├── dsh-pet-0.3.7-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz
│   └── dsh-pet-0.3.7-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz.sha256
└── dsh-memory/0.8.1/
    ├── dsh-memory-0.8.1-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz
    └── dsh-memory-0.8.1-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz.sha256
```

工具文件彼此放在同一目录，插件包可以在其他任意可读目录。也可以像最初的宠物交付那样，将以下四个文件全部放在同一目录：

- `install-plugin.sh`
- `plugin-offline.mjs`
- `dsh-pet-0.3.7-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz`
- 对应的 `.sha256`

`.dsh-plugin.gz` 是本工具的 gzip JSON 文件包，不是 npm tarball，不能交给 `npm install` 或 `tar`。它将普通文件及权限编码入清单，由 Node 校验路径后展开，避免解压时接受任意软链接。构建源和交付文件必须可信；SHA-256 能发现传输损坏，但不能证明作者可信，也不能将第三方代码沙箱化。

先用离线主程序启动一次 Web，生成 `profiles/web`；然后停止所有使用同一个用户数据目录的 DSH 进程。按需选择下面的插件，两个命令可依次执行，然后统一重启 DSH。

安装 pet：

```bash
bash /share/plugins/install-plugin.sh \
  /share/plugins/dsh-pet/0.3.7/dsh-pet-0.3.7-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz --stopped
```

安装 memory：

```bash
bash /share/plugins/install-plugin.sh \
  /share/plugins/dsh-memory/0.8.1/dsh-memory-0.8.1-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz --stopped
```

默认根据 `~/.local/bin/dsh` 找到主程序，使用 `DSH_HOME`，或 `${XDG_DATA_HOME:-$HOME/.local/share}/dsh-text-only`。目标 profile 取自插件包，旧格式包默认 `web`；可用 `--profile NAME` 指定其他已初始化的 profile。路径有自定义时请明确传入：

```bash
bash /share/plugins/install-plugin.sh \
  /share/plugins/dsh-pet/0.3.7/dsh-pet-0.3.7-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz \
  --runtime "$HOME/.local/dsh-offline-0.2.1-alpha.4-linux-x64-glibc217-image-wasm" \
  --home "$HOME/.local/share/dsh-text-only" --stopped
```

`--stopped` 是你已停止相关进程的确认，不会替你杀进程。脚本使用主程序包内的 Node，不需要目标机系统安装 Node/npm/pnpm，也不执行安装生命周期脚本或联网操作。建议留出至少 512 MB 空闲内存；文件包解码会短暂占用额外内存。

安装完成后正常启动 DSH Web，并刷新浏览器。pet 和 memory 的特有设置、数据位置见下文；无需再手工复制各插件的示例 cordis.yml。

主程序目录不改动，模型配置和 `cordis.patch.yml` 不覆盖。安装器只修改 `profiles/web/package.json` 的插件依赖、bundle 注册，并建立插件链接：

```text
$DSH_HOME/
├── offline-plugins/
│   ├── dsh-pet-0.3.7-<摘要前缀>/node_modules/dsh-pet/
│   └── dsh-pet.receipt.json    # 原 profile manifest 及回退信息，权限 0600
└── profiles/web/
    ├── package.json           # 合并注册，不替换其他插件
    └── node_modules/dsh-pet -> 独立插件目录
```

宿主依赖链接到安装时所选主程序，浏览器依赖使用 DSH 的 Web 模块注册表。**使用支持自动插件绑定的新版 `install-and-run.sh` 升级 DSH 时，会从同一个 `DSH_HOME` 自动识别已有插件、检查最低要求并更新依赖链接，不需要再次运行插件安装命令，也不需要原插件文件包。** 插件本体、profile 配置、记忆和凭据沿用原位置。

升级前停止旧服务；替换主安装脚本时保留维护者填写的 `PUBLIC_ARCHIVE_PATH`。该脚本已内嵌绑定逻辑，无需额外拷贝 Node 辅助文件，也能配合已有 DSH 主程序归档使用。旧版主安装脚本、手动解压或直接启动二进制不会执行此步骤，此时仍可用原插件包运行插件安装器手动重新绑定。不要在自动绑定完成前删除旧程序目录。

## 回退与重复安装

同一文件包在同一宿主上重复安装不会重复注册；主安装器已自动绑定到该宿主时，也不会再复制插件。已有其他方式安装的同名插件会被拒绝，不强行覆盖。插件自身换版本/修订时仍需先回退再安装新包；DSH 升级会自动重新绑定，无需先回退。

停止 DSH 后，使用该插件原文件包回退；下面以 pet 为例，回退 memory 时换成对应 memory 文件包路径：

```bash
bash /share/plugins/install-plugin.sh \
  /share/plugins/dsh-pet/0.3.7/dsh-pet-0.3.7-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz \
  --rollback --stopped
```

自定义的 `--runtime` / `--home` / `--profile` 必须与安装时一致。回退只撤销该插件的依赖和 bundle 注册，保留其他插件、用户后续编辑、插件文件及用户数据；若 manifest 未被其他操作修改，则恢复安装前的原始文本。若这个插件自己的注册链接或依赖已被改动，回退会拒绝自动处理，需要根据 receipt 手工合并。可以先安装 A、再安装 B，然后单独回退 A，B 仍保留。

若安装被强制中断，可能留下 `.install-lock` 或 receipt。先确认所有进程停止，再检查 receipt、profile 和插件链接的一致性，由维护者恢复；不要盲目删除锁后重试。

## 各插件的使用与数据

### dsh-pet 0.3.7

此次变体在打包副本中关闭 Electron 启动与下载，移除了相关原生解压依赖；默认仅浏览器显示，余额查询和自动碎碎念关闭。已有 `$DSH_HOME/dsh-pet/` 用户设置不覆盖：如果以前安装过宠物，请手动检查其中的显示和联网功能设置。主动聊天仍需可用模型 API。

宠物的用户设置与记忆位于 `$DSH_HOME/dsh-pet/`，与版本化插件文件分开保存。

### dsh-memory 0.8.1

本包包含便携 Python 3.12.8（python-build-standalone 20241206），无需目标机安装系统 Python 或 pip。通过通用安装器注册的插件条目 ID 为 `furongjun1999-dsh-memory`。

#### 使用与首次启动

默认启用认知图记忆和 `cg` / `stg` 两个核心工具。新记忆库为空是正常现象；可以让 Agent 列出记忆工具，然后明确提出需要记住的内容，在新会话中检查是否能召回。实际对话仍需你配置的模型 API，本次断网验证不代替真实模型的工具调用验收。

插件内部通过 Python stdio MCP 运行记忆引擎，不需要部署另一个网络服务。解释器默认使用随包 Python，用户明确设置的 `config.python` 或 `MDCG_PYTHON` 仍然优先；旧环境变量若指向系统 Python 2.7 或无效路径，需清除或改正后重启。

按该版本上游实现，首次启动没有显式令牌、环境令牌或本地密钥环时，会在本机生成并保存写入凭据。不会在安装包中附带通用令牌。若设置了 `MDCG_AUTO_ISSUE=0` 等禁用自动签发的配置，需按上游方式自行配置凭据，不能把插件加载成功当作已有写权限。

`cg(op=write)` 有内容审核和一致性等闸门。看到 `ok: true` 只表示请求被处理，真正持久化应检查 `committed: true`；文本缺少规定信息时可能进入审核队列或被拒绝。不要为了让检查通过而绕过这些闸门。离线验收使用了合成代码记忆，确认实际提交后读回。

基础记忆引擎不需要外部向量库或下载嵌入模型。Rust 蜂巢、外部 AEIS 身体后端及真实模型驱动的完整工作流不在本次验收范围。

#### 数据、凭据与备份

默认位置如下（`DSH_HOME` 默认是 `~/.local/share/dsh-text-only`）：

```text
$DSH_HOME/
├── .dsh-memory/
│   ├── data/mdcg/             # 持久化记忆
│   ├── paths.json            # 用户自定义路径配置，存在时优先使用
│   └── run/                  # Python 子进程工作目录
├── offline-plugins/…         # 插件及随包 Python
└── profiles/web/…            # 插件注册，不覆盖模型配置

~/.mdcg/                     # 上游默认的身份/凭据根
├── token                    # 本地明文令牌，不要公开
├── _tokens.json             # 令牌校验记录
├── master.key               # 私有内容加密主密钥，按需要生成
└── …

~/.dsh/logs/                 # 上游桥接/激活诊断日志
```

树中列出的是按需要生成的文件，不保证首启全部出现。请同时备份 **`$DSH_HOME/.dsh-memory` 和 `~/.mdcg`**；私有记忆可能依赖密钥和身份信息，仅复制记忆文档不一定可以解密。备份中有凭据，不要上传公共仓库或提供给他人排查。

如果设置了 `MDCG_ROOT`、`MDCG_STATE_ROOT`、`MDCG_DATA_ROOT`、`MDCG_AUX_ROOT` 或已有 `paths.json`，以实际生效路径为准。不要把记忆根设在版本化插件目录内，避免后续维护时丢失数据。

#### memory 验证范围

已完成固定输入校验和完整插件容器制作：npm SHA-512、Python 官方 SHA-256；在 glibc 2.17 构建容器中处理便携 Python，并检查所有 Python ELF 的架构和 `GLIBC_2.17` / `GLIBCXX_3.4.19` / `CXXABI_1.3.7` 上限。

固定 CentOS 7 镜像、`--network none`、全新临时 HOME 下通过：安装、重复安装、与 pet 共存、DSH Web 激活、Python MCP 握手、核心工具发现、本地凭据生成、记忆 `committed: true`、重启记忆进程后读回，以及回退保留用户数据与 pet。没有使用或打包真实密钥、会话或记忆。

本次为与 pet 相同的本地试用交付，不更改现有 DSH Release。正式发布按 `OFFLINE.md` 执行；真实内网模型会话仍需安装后验收。

## 制作与验证

构建输入是可信的已安装发行包，不是个人 DSH 数据目录。仅复制插件的发行文件，不复制 `.env`、密钥、会话、宠物记忆或本机配置。pet 配方接受 dsh-pet 0.3.7，memory 的固定输入与便携 Python 由下文容器入口处理；适配只修改构建副本，不修改本机原插件。保留许可证，未知原生二进制、软链接、可选依赖或依赖版本冲突会报错，需单独审查。

```bash
node scripts/offline/plugin-offline.mjs build \
  /path/to/profiles/web/node_modules/dsh-pet \
  .artifacts/offline/plugins/dsh-pet/0.3.7/dsh-pet-0.3.7-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz

bash scripts/offline/verify-plugin-container.sh \
  .artifacts/offline/0.2.1-alpha.4/image-wasm/dsh-offline-0.2.1-alpha.4-linux-x64-glibc217-image-wasm.tar.gz \
  .artifacts/offline/plugins/dsh-pet/0.3.7/dsh-pet-0.3.7-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz
```

验证容器使用固定 CentOS 7 镜像、`--network none`、只读挂载和临时用户目录，检查首次安装、重复安装、实际插件 HTTP 路由、浏览器模式默认值、回退和用户数据保留。容器检查不是对真实 Linux 3.10、所有浏览器、全部宠物交互功能的认证。

通用安装器回归使用独立的轻量测试包（包括 `@scope/name` 形式），检查多个插件共存、独立回退、默认/自定义 profile、最低版本与非法路径拒绝，以及模拟 `0.2.1-alpha.4 → 0.2.1-rc.1` 的宿主升级、旧安装记录迁移和依赖重绑定。另覆盖 rc.2/rc.10 排序及非 DSH 依赖范围检查；模拟版本测试只证明安装器判断和链接行为，真实插件运行仍以实际验收版本为准。

主安装器自动绑定还覆盖：没有原插件包时处理旧安装记录；多个 profile；旧程序目录已不存在；重复运行无变更；某插件不满足要求时所有链接均保持原状。CentOS 7 断网测试中，真实主安装脚本识别 pet/memory 并更新 14 个依赖链接，移走旧程序后仍能加载两者。

## 通用文件包清单

制作器生成 `format: 2` 的 gzip JSON 文件包。通用安装器兼容原有 `format: 1` 宠物包，不需要重新下载 60 MB 资源，只需更新共用的两份安装工具。

清单中的主要字段为：`name`、`version`、`dshVersion`（制作/验证用宿主版本）、`platform`、`arch`、`profile`、`packages`、`peers`、`browserPeers`、`files`。文件名中的 DSH 版本也表示制作基线，不是唯一允许版本。

版本判断优先使用插件 `package.json` 的 `engines.dsh` 和 `@deepseek-ai/dsh-*` 依赖的最低版本；对于 DSH 依赖，只取声明的最低版本，不额外锁定上限。没有上述声明时，使用清单 `minDshVersion`，未填写再以 `dshVersion` 作为最低值。使用语义化版本排序，支持 alpha/rc/正式版；不会用字符串大小比较版本。非 DSH 的宿主依赖（如 Cordis）仍按其原有依赖范围校验。

`browserPeers` 指宿主 Web 模块注册表提供的依赖，其余 peer 在安装时检查版本并链接到宿主。可以通过 `installNotes` 提供插件安装后的提示文字；清单不支持任意安装钩子或 shell 命令。

新插件的制作配方只需输出该格式并提供完整、已审查的文件与依赖。目标机的通用安装器不需要增加插件名判断。需要数据库、编译、额外模型下载的插件，仍由制作侧处理并验证，不能仅修改清单宣称兼容。

## dsh-memory 制作与验证

`build-memory-container.sh` 固定 npm 0.8.1 和便携 Python 的下载地址与摘要，复用下载缓存，在断网 glibc 2.17 容器内处理运行时、审计 ELF 并打包。源发行包、下载缓存和生成文件都不进入 Git。

```bash
bash scripts/offline/build-memory-container.sh \
  .artifacts/offline/0.2.1-alpha.4/image-wasm/dsh-offline-0.2.1-alpha.4-linux-x64-glibc217-image-wasm.tar.gz \
  .artifacts/offline/plugins/dsh-memory/0.8.1

bash scripts/offline/verify-memory-container.sh \
  .artifacts/offline/0.2.1-alpha.4/image-wasm/dsh-offline-0.2.1-alpha.4-linux-x64-glibc217-image-wasm.tar.gz \
  .artifacts/offline/plugins/dsh-memory/0.8.1/dsh-memory-0.8.1-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz \
  .artifacts/offline/plugins/dsh-pet/0.3.7/dsh-pet-0.3.7-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz
```

不要覆盖已交付的同名文件包；重新制作时使用新的空输出目录或明确的新修订。插件版本变化必须先审查配方，不能只改输出文件名。

2026-10-16 实测：pet 的断网验证通过，损坏校验文件被拒绝，回退后重新安装通过；临时 DSH 数据目录和 Chromium 中 `.dsh-pet-root` 可见，640×360 动画播放。memory 的断网安装、与 pet 共存、实际提交/重启读回及回退保留数据通过。没有使用用户原有配置、凭据或记忆。

本工具包属于本地试用流程。正式发布新归档前仍遵循仓库 `OFFLINE.md` 的完整容器构建与 Release 要求；生成文件保持 Git 忽略，不在未经确认的情况下替换现有 Release。后续接入其他插件，需要补充各自的依赖、网络访问和版本兼容性审查。
