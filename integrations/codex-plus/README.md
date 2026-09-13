> 2026-09-13 用户明确否决独立配置方案。现行安装器复用原版配置与历史，并拦截并行启动；以下隔离流程仅为历史验收记录，不再作为使用说明。详见 [安装指南](../../docs/distribution.md)。

> 以下保留早期 v6 手动验收记录。新安装包使用自动服务与固定应用位置，操作请以 [安装指南](../../docs/distribution.md) 为准。

# Codex 全局工作台：本机适配候选

用户授权采用 Codex Plus Patcher 的应用副本方案。此目录只存放我们的适配代码，不包含或分发 OpenAI 应用。禁止 Tauri。

## 范围与原理

- 精确支持 ChatGPT/Codex 桌面 26.908.40834，build 8881，源 ASAR SHA-256 `bb40cd8811887363104a19291346af9595632e0e956316a1086b274fb8e3eafc`。
- 使用上游 `michaelw/codex-plus-patcher` 的 ASAR/签名引擎，锁定 `759b60d66b0399517cac3a2cbe815ccd7b8d5981`；未移植其全套功能。
- 三个入口：主进程加载原生页面适配器，preload 暴露受限消息，HTML 加载可读导航适配器。未重写 React 编译缓存分支。
- 左侧顶部新增工作台图标；主区域以 Electron WebContentsView 加载 `http://127.0.0.1:4317/`。每个应用窗口复用一个看板，不属于会话。
- 看板无 Node、无 preload；开启 sandbox/contextIsolation，拒绝权限、弹窗和异地导航。HTTP/CSRF/CSP 未放宽；不使用 iframe。
- 侧栏会话点击返回原生内容；再开看板保留页面状态。顶部返回按钮始终可用。

## 构建和启动

先准备锁定版本的上游检出，运行 `npm ci --ignore-scripts`。本机位置为 `/Users/feature/code/codex-workspace-patcher`。不要运行上游默认 apply，以免应用其全部补丁。

在本项目根目录执行：

```sh
export WORKSPACE_PATCHER_ROOT=/Users/feature/code/codex-workspace-patcher
export WORKSPACE_APP_TARGET='work/Workspace Codex v6.app'
node integrations/codex-plus/apply.cjs --check
node integrations/codex-plus/apply.cjs
```

apply 拒绝版本、build、哈希不匹配和已有目标；先检查实际转换后的 JS，再复制、签名、验证副本，并复核源应用未改变。每次构建使用新的目标目录。应用副本仅放在上游检出的 work 目录，不提交二进制。

验收使用 `work/workspace-home` 中的私有 Codex 配置和 SQLite 一致快照，以及 `work/workspace-electron` 中独立的 Electron 数据。首次配置需离线复制 config/auth/global-state，并用 SQLite backup API 生成状态快照；不要把运行中的 SQLite 主文件直接复制或把 CODEX_HOME 指向原版。当前机器已准备好快照。未复制原版插件、skills 和会话文件，因此不用于完整代理执行验收。

先启动本地看板（当前用户允许共享开发数据）：

```sh
TASK_WORKSPACE_HOME=/Users/feature/code/codex-task-workspace/.data/preview npm start
```

然后启动副本：

```sh
node integrations/codex-plus/launch.cjs
```

仅调试时加 `--inspect`，启用本地 9234 调试端口；日常启动不启用。切勿同时启动多个副本共享这一私有目录。

## 回退与升级

关闭副本即可回到 `/Applications/ChatGPT.app` 原版，原版程序不被修改。开发看板仍共享原 SQLite 数据，关闭副本不会撤销已经保存的任务编辑。验收前备份位于 `.data/backups/pre-native-page-20260913`，恢复须使用项目非覆盖式恢复流程。

Codex 升级后必须重新核验适配；未知版本拒绝执行。布局选择器与此版本绑定，不宣称跨版本兼容。代码已准备，但此候选不是官方扩展，也未通过完整生产审计。

## 已验证及限制

2026-09-13 实测：签名验证通过，副本启动；顶部图标与完整四列看板可见；原生会话与看板往返；任务二 Focus 写入 API/SQLite 并恢复原值（更新时间随操作更新）。修改前备份完整性 ok，4 项目、5 任务、1 memory。集成 VM 测试覆盖来源校验、权限隔离、边界、加载失败重试和异步关闭竞争；不是对宿主行为的替代。

仍需日常观察：长期运行、多个窗口、宿主缩放/主题适配、系统快捷键、真实 Hooks/MCP/会话续接。副本启动日志出现 `CUAService ... Sender process is not authenticated`，修改签名后的宿主电脑控制能力不能视为可用；本阶段只验收看板，不替换原版工作客户端。上游安装报告 6 个依赖漏洞（3 moderate、3 high），未运行自动升级；发布前需单独审查构建工具链。

最终构建 v6 增加启动前强制私有 CODEX_HOME 与 Electron 数据目录，即使直接打开副本也不会回退到原版状态。最终全套回归 60 项通过，实际断开服务显示错误提示、恢复服务后重新打开成功；从 Show local tasks 和 Show TaskPlanner board 两个会话返回同一看板通过。默认交付启动关闭远程调试端口。

构建过程 v4/v5 曾将 Node 隔离模块误注入 sandbox preload，导致桥接失败和启动停滞；v6 限定主进程注入，并加入专门回归测试。中间构建不作为交付。
