# 本机运行、备份和部署验收

本次交付是本机验收候选版，不是已通过真实宿主验收的生产发布。当前仅支持单用户、本机回环访问；不要绑定公网或用反向代理绕过 Host/Origin 限制。

## 运行目录与数据目录

Node.js 22.13+；本次验证 22.22.3。运行目录包含 dist、ui、node_modules、hooks、skills、manifest。数据目录独立于代码，默认 `~/.local/share/codex-task-workspace`。HTTP、MCP、Hooks 必须使用同一绝对路径的 `TASK_WORKSPACE_HOME`。预览数据 `.data/preview` 和验收数据 `.data/readiness-audit` 不应被当成正式业务数据。

在源码目录执行：

```sh
npm ci
npm test
npm start
```

在 Codex 中要求“打开 Task Workspace 看板”，由插件 skill 检查本地服务并调用受支持的内置浏览器面板。地址是 `http://127.0.0.1:4317/`。它不注册原生侧栏入口。不应把嵌入式 iframe 作为替代：服务拒绝被其他页面 iframe 嵌套。

进程仅监听回环。端口被占用时退出并提示，不会杀掉其他进程或自行切换到另一份数据库。

## 构建独立本地运行包

```sh
node scripts/prepare-release.mjs /absolute/new-release-directory
```

脚本先执行完整测试，然后复制运行文件并按 lockfile 安装生产依赖。目标目录必须不存在。`RELEASE.json` 记录构建信息和宿主尚未验收标记。它是本地目录包，不是已经发布到 marketplace 的插件。

运行包无需 TypeScript 编译器：

```sh
TASK_WORKSPACE_HOME=/absolute/data-directory node /absolute/new-release-directory/dist/http.js
```

正式部署阶段再安装插件并验证宿主 PATH 中的 Node 版本。不能只复制 manifest：MCP 与 Hook 都依赖包内 dist 和运行依赖。

## 在线备份和恢复演练

以下命令从源码根目录执行，运行包也可直接调用 `node dist/maintenance.js`：

```sh
TASK_WORKSPACE_HOME=/absolute/data-directory npm run doctor
TASK_WORKSPACE_HOME=/absolute/data-directory npm run backup -- /absolute/new-backup-directory
npm run restore -- /absolute/backup-directory /absolute/new-data-directory
TASK_WORKSPACE_HOME=/absolute/new-data-directory npm run doctor
```

备份通过 SQLite VACUUM INTO 产生一致快照，包含已提交 WAL 数据，不要求停止业务进程。备份前后验证版本、完整性、外键及关键表，文件权限 0600，目录 0700。备份目录必须不存在，命令不会覆盖旧备份。

恢复同样只允许全新目录，绝不覆盖活动数据库及 WAL。先完成恢复检查，再停止旧 HTTP/MCP/Hook 写入，把三个入口统一指向恢复目录。生成式 Markdown 不必备份，可由 SQLite 重建；源项目、Git 仓库和权威文档需要各自的备份策略。

首次正式使用前做一次恢复演练；之后在升级前和重要工作结束后备份。当前没有自动备份轮换调度，别把备份命令当作已配置的定时备份。磁盘故障会同时影响同盘数据和备份，重要副本应由用户现有备份工具保存。

## macOS 登录启动（部署时执行）

先生成可审阅配置，不自动安装或加载服务：

```sh
TASK_WORKSPACE_HOME=/absolute/data-directory node scripts/launch-agent.mjs /absolute/release-directory /absolute/new-service.plist
plutil -lint /absolute/new-service.plist
```

配置固定当前 Node 的绝对路径、运行目录、数据目录和 4317 端口。安装到 `~/Library/LaunchAgents/local.codex-task-workspace.plist` 后可用 launchctl bootstrap 加载。卸载时先 bootout 再移除配置。升级 Node 导致旧绝对路径失效时，需要重新生成配置。此阶段未在用户电脑安装登录服务。

## 升级与回滚

1. 用当前版本做在线备份并通过 doctor。
2. 在新目录构建候选版本，使用备份恢复出的隔离数据验收。
3. 停止旧服务及使用该目录的 MCP/Hook，统一切换运行目录，再启动。
4. 数据库版本高于程序支持值时拒绝启动，不能手改 user_version 绕过检查。
5. 本次未变更 schema 版本。未来涉及迁移的升级必须单独验证迁移和回滚。回退旧程序不能直接打开未来版本数据；应恢复升级前备份到新目录，保留新版本数据供核查。

## 发布前真实宿主验收（尚未通过）

- 安装运行包后，新开一个明确用于验收的 Codex 任务；确认插件工具与 skill 真正可发现。
- 在新任务的 SessionStart / Stop / SessionEnd 生命周期中检查实际事件进入同一数据目录。独立脚本投递成功不满足此项。
- 检查 Global Inbox → 显式关联 → 会话排序/记忆 → Continue 上下文链路。
- 用受支持的宿主 list/read 验证候选会话存在，再执行用户授权的真实续接，并核对结果。UI 的 Continue 按钮目前生成上下文，不会自行向宿主发送工作。
- 验证 Codex 重启、电脑登录后的启动与数据目录一致性，以及备份恢复。
- 至少完成一个实际项目的持续试用；当前回归不是长时间运行证明。

以上项目完成前，发布判断仍为 NO-GO。禁止将手工任务状态、呼吸动效或接收到模拟事件表述为 AI 正在真实运行。
