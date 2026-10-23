# dsh-memory 0.8.1 离线插件包

实测主程序：`DSH 0.2.1-alpha.4 image-wasm`，Linux x86_64 / glibc 2.17+。更新后的通用安装器按插件声明的最低版本判断，允许满足要求的新版 DSH，不要求等于制作版本。可以与已安装的 `dsh-pet 0.3.7` 共存，无需替换 DSH 主程序安装脚本。

本包基于 [FuRongJun-1999/dsh-memory](https://github.com/FuRongJun-1999/dsh-memory) 的 npm 发行版 `@furongjun1999/dsh-memory@0.8.1`，随附 Python 3.12.8（python-build-standalone 20241206）。目标机不需要 npm、pnpm、pip、系统 Python 或编译器。随包运行时是固定版本，更新时需由维护者重新评估兼容性及安全更新。

## 安装

推荐共享目录布局：

```text
/share/plugins/
├── install-plugin.sh                 # 与 pet 共用
├── plugin-offline.mjs                # 与 pet 共用
├── dsh-pet/…
└── dsh-memory/0.8.1/
    ├── dsh-memory-0.8.1-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz
    ├── dsh-memory-0.8.1-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz.sha256
    └── INSTALL-memory.zh.md
```

先停止使用该用户数据目录的 DSH 进程（前台运行时按 Ctrl+C），执行：

```bash
bash /share/plugins/install-plugin.sh \
  /share/plugins/dsh-memory/0.8.1/dsh-memory-0.8.1-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz \
  --stopped
```

脚本验证摘要和宿主依赖后，向 `web` profile 注册 `@furongjun1999/dsh-memory`。其插件条目 ID 为 `furongjun1999-dsh-memory`。安装后正常重启 DSH Web，刷新页面。无需将示例 `cordis.yml` 再手工粘贴进用户配置。

程序或数据目录有自定义时，附加与 pet 安装时一致的参数：

```bash
  --runtime /你的版本化程序目录 --home /你的DSH数据目录
```

以上是参数片段，应放在完整安装命令中；`--runtime` 指含有 `app/` 和 `node/` 的程序目录，不是 `bin/dsh` 文件。文件名中的 `0.2.1-alpha.4` 是制作基线，安装时检查插件声明的最低 DSH 依赖；满足要求的 `0.2.1-rc.1` 等新版可安装。以后使用支持自动插件绑定的新版主安装脚本升级 DSH，只需先停止旧服务并保持同一 `DSH_HOME`，脚本会自动更新宿主依赖，保留原有记忆和凭据，不用再次安装插件。手动解压或仍使用旧主安装脚本时，才需要用原文件包重新绑定。新版接口是否仍兼容需实际使用验收。

## 使用与首次启动

默认启用认知图记忆和 `cg` / `stg` 两个核心工具。新记忆库为空是正常现象；可以让 Agent 列出记忆工具，然后明确提出需要记住的内容，在新会话中检查是否能召回。实际对话仍需你配置的模型 API，本次断网验证不代替真实模型的工具调用验收。

插件内部通过 Python stdio MCP 运行记忆引擎，不需要部署另一个网络服务。解释器默认使用随包 Python，用户明确设置的 `config.python` 或 `MDCG_PYTHON` 仍然优先；旧环境变量若指向系统 Python 2.7 或无效路径，需清除或改正后重启。

按该版本上游实现，首次启动没有显式令牌、环境令牌或本地密钥环时，会在本机生成并保存写入凭据。不会在安装包中附带通用令牌。若设置了 `MDCG_AUTO_ISSUE=0` 等禁用自动签发的配置，需按上游方式自行配置凭据，不能把插件加载成功当作已有写权限。

`cg(op=write)` 有内容审核和一致性等闸门。看到 `ok: true` 只表示请求被处理，真正持久化应检查 `committed: true`；文本缺少规定信息时可能进入审核队列或被拒绝。不要为了让检查通过而绕过这些闸门。离线验收使用了合成代码记忆，确认实际提交后读回。

基础记忆引擎不需要外部向量库或下载嵌入模型。Rust 蜂巢、外部 AEIS 身体后端及真实模型驱动的完整工作流不在本次验收范围。

## 数据、凭据与备份

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

## 回退

停止 DSH 后执行：

```bash
bash /share/plugins/install-plugin.sh \
  /share/plugins/dsh-memory/0.8.1/dsh-memory-0.8.1-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz \
  --rollback --stopped
```

回退只撤销本插件注册，保留 pet、其他插件、记忆数据和凭据，也保留插件文件以供恢复。再次使用需要重新安装并重启。不得在旧进程仍运行时更换记忆引擎文件。

## 本次验证

已完成固定输入校验和完整插件容器制作：npm SHA-512、Python 官方 SHA-256；在 glibc 2.17 构建容器中处理便携 Python，并检查所有 Python ELF 的架构和 `GLIBC_2.17` / `GLIBCXX_3.4.19` / `CXXABI_1.3.7` 上限。

固定 CentOS 7 镜像、`--network none`、全新临时 HOME 下通过：安装、重复安装、与 pet 共存、DSH Web 激活、Python MCP 握手、核心工具发现、本地凭据生成、记忆 `committed: true`、重启记忆进程后读回，以及回退保留用户数据与 pet。没有使用或打包真实密钥、会话或记忆。

本次为与 pet 相同的本地试用交付，不更改现有 DSH Release。正式发布按 `OFFLINE.md` 执行；真实内网模型会话仍需安装后验收。
