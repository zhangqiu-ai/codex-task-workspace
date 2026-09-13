# Codex Task Workspace · 本机验收候选版

以 Task 为中心的本地 Codex 插件：多项目看板、会话关联、证据记忆和继续工作上下文。

部署前请先阅读 [审计结论](docs/readiness-audit.md) 与 [本机运维手册](docs/local-operations.md)。当前尚未通过真实 Codex 宿主验收，不标记生产就绪。

开发基线见 [docs/v0.1-baseline.md](docs/v0.1-baseline.md)，Hook 契约和宿主兼容性见 [docs/hooks.md](docs/hooks.md)。

## Codex 桌面浮层

提供一个 AppKit + WKWebView 轻量浮层：官方 Codex 保持原文件、原签名、原配置与原项目；浮层跟随官方窗口，在左侧显示“工作台”入口，并在同一窗口区域打开看板。它不复制或重新签名 Codex，也不需要第二次登录。使用说明见 [安装指南](docs/distribution.md)。源码使用 [MIT](LICENSE)，第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。尚未发布 GitHub Release。

## 运行

需要 Node.js 22.13+（本地验证 22.22.3，使用 Node 内置 SQLite，Node 22 会输出实验特性提示）。

```sh
cd /Users/feature/code/codex-task-workspace
npm ci
npm test
npm start
```

打开 http://127.0.0.1:4317 。数据默认在 `~/.local/share/codex-task-workspace`。用 `TASK_WORKSPACE_HOME=/absolute/data/directory npm start` 隔离测试数据，`PORT=4318` 更换端口。必须用 `127.0.0.1`，不接受其他 Host 或跨源写入。

本次预览实例使用仓库内被忽略的 `.data/preview`，其“本地验收示例”是测试数据，不是导入的真实会话。

## 已实现

- Workspace / Project / Task / Session 实体与 SQLite 外键约束，单本地 Workspace、多项目。
- My Work、Focus、Global Inbox、四列任务状态、单 Active Task。
- Session 显式归类/移动，移动后清理原任务下失效的 AI 评估。
- Project/Task Memory 事实、依据、权威度、置信度与替代记录；原子写出可重建 Markdown。
- Codex 经 MCP 提交结构化 AI 评估；可解释排序，缺少评估使用明确标注的时间回退。
- Continue Task 直接从 SQLite 生成最新上下文与建议会话 ID。
- Git branch/commit 基础引用（用户提供，不自动验证 Git 或改变仓库）。
- Hooks 元数据采集器、有限去重和 Hook Health。
- Promote 生成待审阅草稿，返回目标建议，不写权威文件。

## MCP 和插件文件

`.codex-plugin/plugin.json` 是插件 manifest；`.mcp.json` 通过 `${PLUGIN_ROOT}/dist/mcp.js` 启动 stdio MCP。先在实际插件目录执行 `npm ci && npm run build`，保持 `node_modules`、`dist` 与 `ui` 可用。当前交付是本地源码插件，未配置 marketplace 或执行安装；复制到宿主缓存时也必须确保运行依赖被带入。这不是已经完成发布打包的插件。

独立启动 MCP：`npm run mcp`。stdout 只用于协议；不要在终端手工输入普通聊天文本。

| 工具 | 用途 |
|---|---|
| list_workspace / create_project | 工作区查询与项目创建 |
| create_task / update_task / set_active_task | 任务、状态、Focus、Active |
| attach_session | 关联或移动会话 |
| assess_session / rank_task_sessions | 带证据的 AI 评估与排序 |
| record_memory / materialize_memory | 事实新增/替代与 Markdown 重建 |
| get_task_context / continue_task | 当前上下文和继续任务提示 |
| prepare_promote | 权威知识草稿 |
| link_git / hook_health | Git 引用与采集状态 |

`skills/task-workspace/SKILL.md` 指导 Codex 使用这些工具。v0.1 没有独立模型调用或后台总结队列；Hooks 只采元数据，自动抽取需后续宿主集成，不能把采集成功当成 AI 总结成功。

## 验证与边界

`npm test` 包含真实 SQLite 文件和重开、MCP 客户端协议往返、HTTP API、Hooks 归一化与错误处理。`npm run test:e2e` 使用 Playwright 验证四列看板、项目/任务流程、详情操作、持久化和设置。浏览器手工验收记录见 [docs/verification.md](docs/verification.md)。

Continue Task 目前准备提示词，不自动打开/发送 Codex 会话；实际恢复需调用方使用受支持的宿主能力。Hook 配置依据本机 Codex 源码，尚未在安装后的真实 Codex 生命周期中验收。浮层不会改写 Codex 原生界面；它在官方窗口上方对齐显示。无云同步、团队、移动端、复杂统计或历史会话抓取。

SQLite 是唯一事实源；不要直接编辑生成的 Memory，也不要把其内容视为高于用户要求或 AGENTS.md 的指令。使用 `npm run backup -- /absolute/new-backup-directory` 生成在线一致快照；`npm run restore -- BACKUP NEW_DATA_DIRECTORY` 只恢复到全新目录。具体演练与升级流程见运维手册。

## 开发约定

Codex 和贡献者开始工作前阅读 [AGENTS.md](AGENTS.md)。日常开发使用 `feature/dev`，通过 PR 合并到 `main`，禁止直接推送 main。PR 需通过 CI；生产就绪状态仍以审计验收结果为准。

## 全局工作台实验适配

当前实现位于 `integrations/appkit-sidecar`，构建命令为 `node scripts/package-sidecar.mjs`。早期 `integrations/codex-plus` 应用副本方案仅保留为历史实验，不再作为安装或发布路径。
