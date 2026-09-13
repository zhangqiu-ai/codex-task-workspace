# 本地验证记录

日期：2026-09-13。环境：macOS，Node.js 22.22.3。本记录仅覆盖第一开发切片。

## 自动验证

`npm test`：13 项通过。覆盖真实 SQLite 重开持久化与外键、Focus/Active、会话移动和原评估清理、带依据记忆的同 scope 替代、Markdown 输出、Continue 最新事实、Promote 不写文件、Git 会话归属检查、Hooks 幂等及 Inbox 隔离、时区归一化、中文 UTF-8 分块请求、HTTP 跨源阻断、真实 MCP initialize/list/call，以及实际 Hook CLI 正常/失败退出。

TypeScript 构建通过；plugin-creator manifest 验证通过；UI JavaScript 语法检查通过。npm install 审计报告 0 vulnerabilities（安装时快照，不是永久安全保证）。

## 浏览器验收

在独立 `.data/preview` 数据目录启动 HTTP 服务，打开 Codex 内置浏览器：

1. 新建“本地验收示例”项目及“验证任务记忆与继续工作”任务，卡片正确出现。
2. 输入中文 Memory 和依据，详情从 SQLite 读回内容。
3. Continue Task 输出包含刚写入记忆的提示词，并设置 Active Task。
4. 标记 Focus、改为进行中，刷新页面后保留状态且卡片位于进行中列。
5. 检查桌面截图：项目栏、四列、卡片、Active 和 Hook Health 显示正常。

未进行实际 Codex 会话启动/发送、安装后 Hook 生命周期回调、MCP Apps 内嵌、移动端验收或独立后台 AI 提取。本次页面中没有 Hook 事件，正确显示 unknown。自动测试中的 Hook 事件为隔离测试输入。

## 修复并回归

开发中发现并修复 SQL INSERT 参数数量、HTTP 分块解码中文字符、Hook 带时区时间戳的字典序比较问题。相应持久化与边界测试已通过。
