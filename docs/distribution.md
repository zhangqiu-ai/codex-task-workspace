# Task Workspace · macOS 浮层安装指南

当前桌面方案是独立 AppKit 辅助程序。它只读取官方 Codex 的进程与屏幕窗口位置，在窗口上方显示“工作台”入口和看板；不会修改 `/Applications/ChatGPT.app`，不会复制 Codex 配置，也不会要求重新登录。

## 数据与安全边界

- Codex 登录、项目、任务历史和动态工具仍由官方应用及 `~/.codex` 管理。
- 看板事实源位于 `~/Applications/Task Workspace/data`，沿用早期开发数据。
- 看板 HTTP 服务只监听随机本机回环端口，并校验 Host、Origin 和 Fetch-Site。
- 浮层退出或意外终止时，它持有的标准输入管道关闭，本地 Node 服务随之退出。
- 当前应用使用 ad-hoc 签名，尚未 Developer ID 签名或公证，因此仍是本机验收候选版。

## 开发者构建

需要 macOS Apple Silicon、Swift 编译器、Node.js 22.13+，以及已校验的 Node 22.22.3 arm64 归档：

```sh
npm ci
npm test
npm run test:e2e
node scripts/package-sidecar.mjs
```

打包脚本先运行回归，校验 Node 归档 SHA-256，在同目录暂存完整应用、验证签名后原子改名。它明确拒绝将产物写进官方 Codex 应用目录。

## 使用

1. 正常打开官方 Codex。
2. 打开 `Task Workspace.app`。
3. 官方窗口左侧顶部会出现“工作台”；点击后，看板覆盖右侧内容区。
4. 点击“返回 Codex”关闭看板。关闭官方 Codex 后，浮层和本地服务会自动退出。

浮层暂时跟随最前方的一个官方 Codex 主窗口。多窗口、不同 Space、全屏切换和睡眠唤醒仍需更长时间验收。Continue Task 目前生成可复制上下文，不会代替用户向 Codex 自动发送消息。

早期 `Workspace Codex.app` 是修改后重新签名的实验副本，会失去官方开发者身份并导致动态工具拒绝连接。该方案已经停用，不应继续安装或发布。
