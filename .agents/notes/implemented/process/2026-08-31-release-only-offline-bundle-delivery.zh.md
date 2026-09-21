# Agent Note: 仅通过 Release 交付离线包

Status: implemented

[English](2026-08-31-release-only-offline-bundle-delivery.md) | 中文

## Problem

经过验证的纯文字归档约为 96.6 MB。将该压缩产物存入 Git 会永久增加 clone 与 fetch 成本，并超过 GitHub 建议的单文件 50 MB 阈值。按需重新构建并不是等价交付，因为外部依赖产物可能变化或消失，所以每个版本仍需要与明确源码提交关联的持久可下载文件。

## Decision

根目录[离线包要求](../../../../OFFLINE.md)负责当前构建、验证、目标机和交付规则。Git 保存构建器、安装脚本和安装指南源模板、文档及 Agent Note。`.artifacts/offline/` 保持忽略状态，生成的归档、校验文件、安装脚本和安装指南不得强制加入 Git。

每项交付都使用版本化 GitHub Release，其中包含 `.tar.gz`、对应的 `.sha256`、已渲染的 `install-and-run.sh` 和已渲染的 `INSTALL-text-only.zh.md`。分发前，维护者将安装脚本的 `PUBLIC_ARCHIVE_PATH` 设置为归档固定软链接的绝对路径，并在旁边提供 `settings.yaml`。Release 记录归档 `BUILD-MANIFEST.txt` 中的产品源码提交，使用纯文字标签约定，并为 alpha 和 rc 版本标记预发布。只有四项资产均报告 `uploaded`、下载归档与已发布校验和一致，并且下载的安装脚本通过 Bash 语法检查后，交付才算完成。安装脚本本身不检查校验和。

本独立仓库将打包工具及文档与 DeepSeek Harness 产品源码检出目录分开。打包输入变更使用 shell 语法检查和完整容器构建器；仅文档和 Release 元数据变更使用聚焦的文档、校验和、资产状态与 Git diff 检查。只有用户明确要求时才运行产品源码仓库级检查。

## Verification

容器构建器检查依赖安装与编译、每个暂存 ELF 的版本要求、gzip 完整性、无硬链接条目、最终校验和、CLI 版本、纯文字附件拒绝行为、安装脚本的首次及重复运行路径，以及通过该脚本启动的带认证 Web 应用。Release 验证检查标签目标、适用时的预发布状态、准确的资产名称与大小、`uploaded` 状态、安装脚本语法，以及宣布发布前的校验和一致性。

## Alternatives considered

**将交付文件存入 Git。** clone 无需第二项服务即可获得准确归档，但每个 clone 都要携带压缩二进制文件，普通删除也无法从已有历史中移除它。如果源码提交内嵌归档，`BUILD-MANIFEST.txt` 也无法在不形成循环输入的情况下指名包含它的提交。Release 已存在时，Git 存储只会增加第二个交付位置，不会改善验证。

**通过 Git LFS 存储归档。** LFS 可以缩小 Git 对象数据库，但会增加另一项外部对象服务和仓库配置。GitHub Release 已提供所需资产服务，并将生成的交付文件与源码历史分离。

**每次请求版本时重新构建。** 源码保持较小，但依赖下载或选中的产物可能变化或消失。保留 Release 资产和校验文件可以保存经过验证的字节，而不要求外部网络无限期保持可重现。

## Consequences

仓库 clone 不包含当前离线归档，必须从 GitHub Release 下载，因此保留 Release 是交付可用性的一部分。本地构建保存在被忽略的 `.artifacts/offline/` 目录中，Release 资产可通过校验和与记录的产品源码提交独立验证。产品源码检出目录不再包含当前离线工具或交付文件。
