# dsh-memory 0.8.1：26 项可选缺失的本地诊断

验证日期：2026-10-16。对象为当前交付的 `dsh-memory-0.8.1-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz`。

## 结论

可以复现。不是缺少 26 条记忆，也不是 26 个 npm 包。启动自检把去重后的 Python 导入引用归类为 `unavailable`，其中 25 项属于 AEIS 扩展，1 项因 NumPy 不存在而无法导入。

不能说所有功能都不受影响：核心记忆通道通过本次定向测试，部分扩展明确不可用，矩阵传播计算被跳过。另外发现一项独立的白箱新事实问答探针失败，不能据此宣称插件全部功能通过。

未改动插件实现、现有离线包、真实用户配置或记忆。只新增可重复运行的诊断工具与本记录，没有发布或重建归档。

## 环境与对照

- 固定 CentOS 7 容器，glibc 2.17，`--network none`，输入只读挂载。
- 主包运行时：DSH 0.2.1-alpha.4 image-wasm 中的 Node.js 22.23.2。
- Python：插件实际携带的 Python 3.12.8，而不是系统解释器。
- 官方 npm 原始压缩包与离线插件包分别解压到容器临时目录；校验主包/插件 SHA-256 和 npm SHA-512。
- 两份插件各用独立临时 HOME、MDCG_ROOT、MDCG_AUX_ROOT；不使用真实模型网关。
- 离线插件中 208 个运行时 Python 文件与官方 npm 包逐字节一致；两者的运行时代指纹均为 `0cd574848047`，缺失列表也完全一致。

因此，本次缺失不是离线打包删改这 208 个运行时源码文件造成的。此对照使用相同的随包 Python，并不代表测试过安装额外第三方库后的所有行为。

## 26 项分别影响什么

| 来源 | 引用项数 | 本次查明的影响 |
| --- | ---: | --- |
| AEIS 世界/空间/3D 等模块 | 16 | 涉及 `world3d`、`voxel_world`、`world_server`、`scene_simulator`、`spacetime_consistency`、`world_model`、`world_learner`、`curiosity_explorer`、`seven_layer_loop`、`game_web`、`vprim`；直接调用的探针返回 `*_not_ready` 或 `blindspot` |
| AEIS `knowledge` | 4 | `ingest_text/file/url/search` 引用不可用；直接调用 AEIS `Agent.ingest_text` 抛 `ModuleNotFoundError` |
| AEIS `channel_credibility` | 1 | 通道可信度扩展直接调用失败 |
| AEIS `nightly_cleanup` | 1 | AEIS 夜间整理扩展直接调用失败 |
| AEIS `search_providers` | 1 | AEIS 可插拔外部搜索接口缺少实现；未执行联网请求 |
| AEIS `layered` | 1 | 旧 AEIS LLM 分层模块未携带；本次未对其做真实模型调用 |
| AEIS `roleplay_chat` | 1 | 旧 AEIS 角色对话接口返回“角色扮演管线未就绪” |
| `wisdom.condition_algebra` / NumPy | 1 | 该模块直接导入失败；影响雅可比矩阵传播计算 |

这里的计数是导入引用数，不是互不重复的模块数：例如 `knowledge` 被引用四个函数，`vprim` 也有多项引用。

上游 `whitebox_kb/aeis_core/__init__.py` 明确将自身定义为 AEIS 的最小可移植子集，不携带身体/世界模型等模块。DSH 插件默认只启动 md_cg，额外的 capability 后端默认不启用。

注意区分不同入口：缺少的是 **AEIS 的 `Agent.ingest_*` 扩展**，不能据此断言 md_cg 的 `cg(op=ingest)` 也不可用；后者转到独立的 `md_cg.sources`。同理，旧 AEIS 角色对话接口不等于当前 DSH 的全部角色功能。本次没有穷举这些独立入口。

NumPy 降级做了实际调用：相同的“高压锅在高原上煮饭”问题，串行与并行组合都返回 `ok=true`，答案一致；无 NumPy 时 `jacobian_steps=0`。因此该样例仍能生成组合答案，但矩阵传播部分没有执行，不能说这项缺失毫无影响。

## MCP 实测功能范围

通过插件自己的 `MdcgClient` 调用真实 Python MCP，而不是只检查服务能启动。18 项探针中 17 项通过，1 项失败。

通过项包括：

- cg/stg 工具发现。
- 合成代码记忆写入返回 `committed=true`。
- 按节点 ID 读取、关键词检索、带预算的召回、stg 时间线。
- 自动记忆使用的客户端写入路径：返回 `ACCEPT` 与已写入节点 ID，随后可以读回。
- 近期事件写入与会话上下文读取。
- 白箱连通性、已有知识问答、已有知识验证。
- 重启 MCP 后，代码记忆、关键词检索、自动记忆节点和近期会话上下文仍可读回。

“自动记忆客户端路径”不等于真实模型对话的全部 hooks 端到端验证；本次没有发起真实模型请求。

### 未通过：白箱新事实问答

合成事实为“离线诊断项目七三九的测试颜色是青色。”，追问项目的测试颜色，预期回答包含“青色”。

此项由 `cg(op=whitebox, action=verify_encoding)` 调用，实际返回 `encoded=true`、`recalled=false`、`ok=false`，回答却转到“拖延不是懒是任务太大……”的无关知识。不能以 `encoded=true` 当作问答验证成功。

同一探针在官方 npm 原包和离线包中返回相同的无关回答。只读检查两者的临时 SQLite 图库，都能找到完整测试事实（各 1 条），因此该样例是问答召回失败，而非事实未落盘。对照调用期间未观察到 NumPy 或上述缺失扩展的导入尝试，暂未发现与 26 项缺失的直接关联；没有进行补齐 NumPy 的 A/B 实验，也未穷举所有白箱问答场景。

这与核心 `cg(read)` 的按 ID/关键词读取是不同路径。不能把白箱答非所问等同于数据被删除，也不能因为核心持久化通过就承诺白箱能准确召回任意新事实。

后续已扩展到每份包 8 组事实、32 次问答，并检查默认自检及已有知识对照；详见 [白箱多问法复现](dsh-memory-0.8.1-whitebox-questions.zh.md)。其中也收紧了本节“白箱已有知识验证通过”的解释：返回成功/非空不是对回答正确性的独立证明。

使用范围再次澄清：白箱验证不等于普通记忆检索。同一组事实改走官方普通记忆客户端写入及 `cg(op=read)` 后，两份包均为 32/32 检索包含预期值、8/8 重启后读回。不能将白箱 0/32 外推成普通记忆不可用；具体用法与边界见上述复现文档末尾。

## 复现工具与报告

入口：[diagnose-memory-imports.sh](../scripts/offline/diagnose-memory-imports.sh)。它只做定向诊断，不联网安装依赖，不重建产品，不改写现有包。要求构建机已有指定 Docker 镜像及三份输入文件：

```bash
bash scripts/offline/diagnose-memory-imports.sh \
  .artifacts/offline/0.2.1-alpha.4/image-wasm/dsh-offline-0.2.1-alpha.4-linux-x64-glibc217-image-wasm.tar.gz \
  .artifacts/offline/plugins/dsh-memory/0.8.1/dsh-memory-0.8.1-dsh-0.2.1-alpha.4-r1.dsh-plugin.gz \
  .cache/dsh-offline/plugins/dsh-memory/dsh-memory-0.8.1.tgz \
  .cache/dsh-offline/memory-import-diagnostic/final
```

报告目录包含 `upstream.json`（官方 npm 代码）、`offline.json`（实际离线包代码）、`mcp-features.json`（实际客户端调用结果）。合成数据与临时凭据随容器退出丢弃，报告不记录令牌。生成报告留在 Git 忽略目录。

存在未通过功能探针时脚本以非零状态结束，这是如实保留失败，而不是安装包损坏或容器验证全部通过。此诊断结果也不能替代真实目标机内核、真实模型跨会话及全部插件能力验收。
