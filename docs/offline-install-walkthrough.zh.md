# 在老服务器上离线运行 DeepSeek Harness：安装、端口转发与 API 配置

服务器上运行 DeepSeek Harness，Windows 上通过浏览器使用：这篇文章按「安装 → Windows 转发端口 → 浏览器配置 API」走一遍，最后集中说明常见问题和安装目录。

本文以 **0.1.7-rc.1 和安装脚本**为例，不代表后续版本的界面和配置格式。
离线包内置程序、Node.js 和所需依赖，目标服务器不用联网安装 npm 包，也不需要 sudo。但“离线安装”不等于“模型离线运行”：聊天仍需要服务器能访问你配置的模型 API。

## 1. 安装

### 在服务器上执行安装

先通过 SSH 登录服务器，然后运行：

```bash
bash /share/dsh-offline/install-and-run.sh --port 13085
```

脚本会列出操作计划，确认后检查环境、安装或复用对应版本的程序、创建命令入口、初始化缺失的配置，并启动 Web。已有配置和会话会保留；已有迁移记录时不会重新复制公共配置。

成功后，终端会输出类似：

```text
dsh web: http://127.0.0.1:13085/?token=这里是实际生成的认证令牌
```

保留这个终端，接下来建立端口转发。此时服务以前台方式运行；关闭终端可能导致服务退出，安装脚本并不是后台服务管理器。

如果暂时只想安装，不启动服务：

```bash
bash /share/dsh-offline/install-and-run.sh --install-only
```

之后仍可用第一条命令启动，安装器会复用已安装的同版本程序。启动前确认没有另一个实例占用相同端口。

### 发布目录结构：可跳过

应先校验归档 SHA-256，再提供以下共享文件，确保安装用户有读取权限：

```text
/share/dsh-offline/
├── install-and-run.sh       # 修正版，已填写 PUBLIC_ARCHIVE_PATH
├── settings.yaml            # 公共初始化配置，不放真实 API Key
└── latest -> /实际归档目录/dsh-offline-0.1.7-rc.1-linux-x64-glibc217-image-wasm.tar.gz
```

在归档所在目录校验：

```bash
sha256sum -c dsh-offline-0.1.7-rc.1-linux-x64-glibc217-image-wasm.tar.gz.sha256
```

首次创建链接（`latest` 尚不存在时）：

```bash
ln -s /实际归档目录/dsh-offline-0.1.7-rc.1-linux-x64-glibc217-image-wasm.tar.gz \
  /share/dsh-offline/latest
```

安装脚本顶部填写：

```bash
PUBLIC_ARCHIVE_PATH="/share/dsh-offline/latest"
```

公共配置从 `/share/dsh-offline/settings.yaml` 读取，即 `PUBLIC_ARCHIVE_PATH` 的父目录，不是软链接实际指向的归档目录，也不由执行脚本时的工作目录决定。

若希望用户完全通过浏览器添加 API，公共 `settings.yaml` 可采用合法的空 YAML 映射 `{}`。也可以使用仓库中的配置模板预置模型信息，但真实凭据应由用户自行配置。公共配置只用于初始化，不会持续同步到每个用户。

## 2. Windows 转发端口

在 Windows 上另外打开一个 PowerShell 或命令提示符（CMD）窗口，执行以下命令。

```shell
ssh -N -L 127.0.0.1:13085:127.0.0.1:13085 yourname@server
```

替换用户名和服务器地址，按提示登录。`-N` 表示只转发端口，不打开远程命令行；登录后窗口没有输出通常是正常现象。保持这个窗口运行。

这条命令把 Windows 本机的 `127.0.0.1:13085` 转发到服务器的 `127.0.0.1:13085`。

如果 SSH 使用非默认端口，例如 `2222`：

```shell
ssh -p 2222 -N -L 127.0.0.1:13085:127.0.0.1:13085 yourname@server
```

如果 Windows 本机的 `13085` 已被占用，可以只更换本地端口：

```shell
ssh -N -L 127.0.0.1:13086:127.0.0.1:13085 yourname@server
```

此时服务器仍使用 `13085`，但浏览器应访问 `13086`。

## 3. 打开浏览器，配置 API

### 打开带认证信息的链接

在 Windows 浏览器中打开服务器启动时打印的完整 URL，例如：

```text
http://127.0.0.1:13085/?token=实际生成的认证令牌
```

这里的 `127.0.0.1` 指 Windows 本机，SSH 会将请求转发到服务器。


### 添加模型 API

在 Web 的设置中进入“模型”，选择“添加模型提供商”。内网网关、自部署服务通常选择“自定义模型 API”，而不是直接选择官方服务。

按网关实际要求填写：

| 配置项 | 如何填写 |
| --- | --- |
| API 协议 | 与网关一致，例如 OpenAI Chat Completions，对应 `openai-completions` |
| API 地址 | 网关给出的基础地址，例如 `http://model-gateway.example.com:8000/v1`；不要随意拼接完整聊天请求路径 |
| 模型 ID | 网关实际接受的模型标识，大小写及名称需匹配 |
| API 密钥 | 使用该网关分配给你的凭据，不是 Web URL 中的 token |
| 上下文及输出上限 | 按服务端实际支持的值填写，不要仅凭模型名称猜测 |

上述地址仅是占位示例。模型 API 请求由服务器发起，因此需要 Linux 服务器能访问该地址；Windows 能访问并不足以证明可用。

保存后返回对话页面，选中刚配置的模型，先发送一条简单文字消息。确认文字正常，再验证图片或本地工具。

API 密钥可通过模型设置界面配置。如果界面提示由启动环境提供、只读，则检查管理员配置的环境变量或 `$DSH_HOME/.env`；不要将密钥写进公共共享配置、博客或截图。

### 使用图片

图片增强包可以处理图片，但所选模型和网关也必须支持图片输入。对自定义模型，如果能力配置中仅声明了文本，即使实际模型支持视觉，界面也可能提示“当前模型不支持图片”。

对于 `llm-pi-ai`，模型配置中的能力声明为：

```yaml
models:
  - id: YOUR_VISION_MODEL_ID
    input: [text, image]
```

这只是现有模型配置内部的片段，不是完整 `cordis.patch.yml`，不要用它覆盖整个文件。优先通过设置界面编辑；手工编辑时先备份，并修改当前 profile 中相应 provider 的模型条目。

只有后端确实支持视觉时才加入 `image`，添加这个字段不会让纯文字模型获得看图能力。保存并确认当前对话选中了该模型后，再粘贴一张小图片测试。本文不包含语音配置。

## QA

### Q：为什么 settings.yaml 变成了 settings.yaml.imported？

rc.1 启动时会先把旧 `settings.yaml` 改名，再尝试将各配置节导入当前 profile。常规 Web 启动的目标文件是：

```text
$DSH_HOME/profiles/web/cordis.patch.yml
```

`.imported` 是保留下来的旧配置，不会在每次启动时重新读取。之后应通过设置界面管理当前配置；修改公共配置或 `.imported` 都不会自动同步。

修正版安装器在发现 `.imported` 后不会重新复制公共配置。请保留它，不要为了重试随意改回 `settings.yaml`，否则可能重复导入并覆盖后续修改。

### Q：为什么关闭窗口后浏览器打不开？

有两个独立进程需要存活：服务器上的 Web 服务，以及 Windows 上的 SSH 转发。任意一个退出都会影响访问。SSH 隧道还在运行，也不代表服务器 Web 服务一定正常。

### Q：可以聊天，但 Bash 等本地工具不能运行？

文字聊天与 Web 启动不要求进程沙箱，本地工具则需要。较新内核可使用包内 Landlock；Linux 3.10 需要服务器另行提供可用的 bubblewrap。看到沙箱警告时可以开启full acesss模式。


### Q：安装文件夹结构是什么？

默认安装后，主要目录如下；会话和附件等数据未逐项展开：

```text
~/.local/
├── bin/
│   └── dsh -> ~/.local/dsh-offline-0.1.7-rc.1-linux-x64-glibc217-image-wasm/bin/dsh
├── dsh-offline-0.1.7-rc.1-linux-x64-glibc217-image-wasm/
│   ├── app/                         # 产品程序和依赖
│   ├── node/                        # 内置 Node.js
│   ├── bin/
│   │   └── dsh                      # 启动包装脚本
│   ├── config/                      # 随包配置模板
│   └── data/                        # 未设置 DSH_HOME 时的启动回退目录
└── share/
    └── dsh-text-only/               # 两种包共用的默认用户数据目录
        ├── .env                    # 环境变量/凭据配置，不要公开
        ├── offline.cordis.yml      # 安装器维护的离线功能 patch
        ├── settings.yaml           # 首次初始化输入，迁移后不再保留此名称
        ├── settings.yaml.imported  # 迁移时改名保留的旧文件
        ├── profiles/
        │   └── web/
        │       ├── package.json
        │       └── cordis.patch.yml # Web profile 的用户配置
        └── …                       # 其他用户数据
```

`settings.yaml` 与 `.imported` 在树中表示迁移前后两种状态，通常不会同时存在；链接目标中的 `~` 只是家目录的简写，实际目标为绝对路径。

如果设置了 `DSH_HOME`，安装器使用它作为数据目录；否则使用 `${XDG_DATA_HOME:-$HOME/.local/share}/dsh-text-only`。`XDG_DATA_HOME` 未设置是正常情况。

安装器会在未自定义 `DSH_HOME` 时向 `.bashrc` 写入默认设置，但不会改变父终端已有环境。直接调用 `dsh` 且未设置 `DSH_HOME` 时，包装脚本会回退到程序目录的 `data/`。为避免读到不同位置的数据，本文推荐通过安装启动脚本启动，或在自定义启动方式中明确设置正确的 `DSH_HOME`。
