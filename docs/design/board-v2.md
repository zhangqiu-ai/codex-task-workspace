# Task Board v2 · 图像参考与实现

2026-09-13。用户要求先图像设计，再重做布局。使用内置 image_gen 工具生成 `board-reference-v2.png`；工具没有模型选择字段，未声明使用 Image 2.5。

## 生成提示词

Create a high fidelity UI design mockup image for a Chinese local desktop app called Task Workspace. Landscape 1536x1024. This is a precise implementation reference for an existing functional task management app. Sophisticated calm productivity software, Linear meets editorial Swiss design, warm almost white #f7f8fa canvas, charcoal text, thin neutral borders, restrained emerald accent, no gradients, no illustrations. Compact left navigation sidebar 180px with small geometric logo, My Work selected, Focus, Global Inbox, PROJECTS list. Main area elegant compact header My Work, subtitle Chinese, refresh and emerald New Task button; slim horizontal Active Task status strip with small hook status at right. MOST IMPORTANT: FOUR EQUAL KANBAN COLUMNS ALWAYS SIDE BY SIDE in ONE horizontal row, never 2x2 grid. Column headings 待开始, 进行中, 受阻, 已完成 with small count pills and distinct subtle gray/green/amber dots. Each column light gray well with subtle border and 3 vertically stacked white task cards. Cards have small project label, clear Chinese task title, quiet metadata row e.g. 3 个会话, small focus star where applicable. One active card has slim emerald left border. Example titles: 完善任务上下文, 接入会话采集, 验证记忆生成, 整理项目文档. No fake progress bars, charts, percentages, avatars, dates, statistics, search box, tabs, or unsupported controls. Crisp legible typography, efficient density, 12-16px gaps, generous but not excessive whitespace. Show full desktop interface edge to edge no device frame. Design should be straightforward to reproduce with plain HTML CSS. At narrow widths intended columns retain minimum width and horizontal scroll, NOT wrapping.

## 实现

- 采用参考图的浅灰列底、白卡片、绿色 Active 左边线和紧凑侧栏；不添加图中的虚构任务或设置入口。
- 移除原 1100px 两列和 640px 单列规则。Grid 自动按列放置，每列至少 200px；更多状态可继续横向排列。
- 只有看板水平滚动；保留状态文字，加入键盘焦点入口及导航 aria-current。
- 改动限于三个 UI 文件，未改变数据库或业务 API。

## 浏览器验证

1440、1100、1024、768、390px 均实测列数 4、四列 Y 坐标一致、页面没有横向溢出。1440/1100px 全部显示，1024px 以下看板内部滚动。390px 下键盘右箭头实际改变 scrollLeft。恢复用户原窗口后检查四列显示、详情和导航。参考图是设计素材；页面仍显示真实本地数据。

## 紧凑化调整

按用户后续要求压缩信息密度：侧栏 156–166px，主标题 20px，任务标题保留 12px；压缩顶部上下间距与卡片内边距。说明文案改为悬停提示，Hook 状态用右侧一行；卡片项目、会话数、Focus 和 Active 标记放在同一行。刷新、新建任务、关闭、Focus、Active、Continue、复制采用图标，保留 aria-label、title；图标按钮键盘焦点也显示说明。

当前 1083px 窗口实测看板起点从约 193px 提升至 86px，现有单行标题卡片高度 63px。1280/960/640px 实测四列 Y 坐标一致、页面无横向溢出。浏览器验证 Enter 可打开新建任务表单、取消返回、任务详情保留状态和记忆。JS 语法检查通过；未修改业务 API 或数据。
