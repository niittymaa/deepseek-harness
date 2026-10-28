# Agent Note: 外部 CLI 路由发现各 CLI 原生的模型目录

Status: implemented

[English](2026-10-28-external-cli-catalog-discovery.md) | 中文

## 问题

本地 CLI 路由只提供 `models` 设置中声明的模型，因此 Codex、Claude Code 或 Copilot 用户必须手动输入本机 CLI 已经知道的标识符，还要手动重新声明每个模型的推理级别。此前只有 Agy 会打印模型目录（`agy models`）。向 CLI 询问模型目录既不能消耗订阅额度中的一轮对话，也不能启动编码会话，更不能要求 harness 并不持有的凭据。

## 决定

`discoverCliModels` 通过每个 CLI 自有的元数据通道读取模型目录，返回 `{ id, name?, reasoningEfforts? }` 条目：

- Codex：`codex app-server`，先发 `initialize` 请求和 `initialized` 通知，再用 `includeHidden: false` 调用 `model/list`，并按 `nextCursor` 翻页。模型取自 `data[].model` 与 `displayName`，级别取自 `supportedReasoningEfforts[].reasoningEffort`。
- Claude Code：`claude --print --input-format stream-json --output-format stream-json --verbose --no-session-persistence`，并发送一次 `initialize` 控制请求。控制响应中的 `models[]` 带有 `value`、`displayName` 和 `supportedEffortLevels[]`。
- Copilot：`copilot --headless --no-auto-update --stdio`，用该通道会校验的 `clientInfo` 编辑器字段发起 `connect`，再通过 `Content-Length` 分帧调用 `models.list`。模型取自带有 `id` 和 `name` 的 `models[]`。

每个通道只交换元数据：不写入任何 prompt，目录一旦确定、调用失败或调用方的信号中止时，进程立即停止。配置的 `timeoutMs`（默认 120 秒）与 `discoveryMaxBytes`（默认 1 MiB，按标准输出与标准错误合计）限制这次查询，每次拒绝只带一个诊断代码：`CLI_TIMEOUT`、`CLI_CATALOG_TOO_LARGE`、`CLI_INVALID_CATALOG`、`CLI_DISCOVERY_FAILED` 或 `ABORTED`。

`ExternalCliAdapter` 为每条路由保留最近一次读取的目录。`listModels` 刷新它，`resolveModel` 与 `stream` 读取它，设置更新会清空它。因此聊天模型选择器在模型被保存之前就能提供发现的标识符及其公布的推理级别，而针对已发现模型的请求会从同一份目录解析级别参数，不会再次发起查询。`mergeModels` 允许配置条目替换它声明的名称和级别，并保留它未声明的已发现值。

原生目录为空是有效答案。部分安装中的 Copilot 不提供文本模型，因此其路由只列出 CLI 默认项和配置的模型。Agy 保留 `CLI_EMPTY_CATALOG`，因为 `agy models` 输出为空意味着调用失败，而不是该 CLI 否认所有模型。

## 考虑过的替代方案

- **解析 `--help`、`--version` 或其他文本输出。** 已否决：这些文本属于展示内容，措辞或语言环境变化会破坏解析，而且它们都不公布推理级别。
- **从一次模型请求的响应元数据中读取目录。** 已否决：这会消耗订阅额度中的一轮对话，还可能需要用户并未授予的权限或凭据。
- **在每次 `resolveModel` 调用中执行发现。** 已否决：`resolveModelInfo` 位于压缩、子代理和图片读取的请求路径上，这样做会让每个请求都启动一次 CLI。
- **通过 `LlmDiscoveredModel` 把推理级别带入模型设置。** 已否决：该类型描述 HTTP 模型目录列表，其中的级别是模型能力，而不是 `{effort}` 替换所发送的 CLI 参数值。等设置编辑器确有理由拥有级别映射时再存储它。
- **把发现留给模型设置编辑器。** 已否决：聊天模型选择器仍只会提供已保存的模型，CLI 默认项仍将是唯一未保存的选项。

## 后果

- 打开模型菜单会为每条已配置路由启动一个短生命周期 CLI 进程：在开发机上 Codex 为 0.2-1 秒、Claude Code 为 0.4 秒、Copilot 为 2 秒。
- 已发现的级别存在于适配器的按路由目录中，因此可编辑的模型条目仍只是名称和可选的级别映射。已保存的条目会沿用其 CLI 公布的级别，直到该条目自己声明级别。
- 若某个 CLI 版本重命名了方法、字段或连接元数据，该路由的列表会以 `CLI_INVALID_CATALOG` 或 `CLI_DISCOVERY_FAILED` 失败；配置的模型在聊天中仍可选择，消息会指出需要检查的 CLI 版本或身份验证。
- CLI 启动慢的路由会因这段启动时间延迟模型菜单，而且每次打开菜单都要再付一次。

## 测试

单元覆盖用一个脚本化的子进程跑通每个协议的握手、翻页、两种分帧、畸形载荷、上限、超时、中止、启动失败、提前退出与拆除。三个通道已在 Windows 上针对 codex-cli 0.164.0、Claude Code 2.1.311 和 GitHub Copilot CLI 1.0.105 验证。

## 相关

[模型选择升级指南](../../../../docs/upgrade-guide/v0.2.1-rc.3/external-cli-model-selection/guide.zh.md) 说明用户需要改动的内容，[包 README](../../../../packages/llm/llm-external-cli/README.md) 说明配置接口。
