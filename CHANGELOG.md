# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [未发布]

### 文档

- README 重构：目录、功能一览表、`delegate_agent` 参数与常见错误表、兼容性、已知限制、
  故障排查、安全与隐私、English summary；补 `docs/DESIGN.md` / `CHANGELOG.md` 的入口链接。
- 新增 `CONTRIBUTING.md`：环境、命令、宿主半/浏览器半的代码约定、测试与文档要求、提交信息格式。
- 新增 `docs/PUBLISHING.md`：社区收录机制（awesome-dsh-plugin → plugins.json → 市场）、硬门槛与
  现状盘点、需要作者决策的事项、建仓/元数据/素材/提 PR 的步骤与自检清单。
- `.gitignore` 增补 `dist/`、`*.bak*`、`docs/ROLLBACK.txt`，以及本机运维脚本
  `scripts/sync-installed-copies.*`、`scripts/install-and-upgrade.ps1`——含本机路径，不入库。

### 变更

- 对外文案去人格化：工具描述、示例、注释与文档里的个人预设名改为通用说法，
  确认对象统一写作「用户」；`preset` 参数示例不再写具体 id。
  行为不变：插件从不硬编码预设 id（只硬编码内置四个用于页面排除），目标仍由参数与 registry 决定。
- 测试夹具同步改为通用预设 id 与显示名，43 项测试全绿。
- `LICENSE` 版权署名定为 `hzzzcyn`，`package.json` 补 `author`。

本版无功能改动。

## [0.2.3] - 2026-11-09

### 修复

- 补齐缺失的包级图标 `icon.svg`：`package.json` 的 `icon` 与 `files` 早已声明该文件，但文件从未创建，
  安装后插件页报「包元信息错误：ENOENT ... icon.svg」。图形沿用侧栏 `AgentDeskIcon` 的几何，
  512 画布、整体内缩 0.72；`currentColor` 在独立 SVG 里会退化成黑色，描边改为显式 `#e6e8ef`。
- 子任务行标题改用 `subagentsByParent[parent].entries[].label`（会话头部下拉里的名字）；
  目录无 label 时依次退回子会话自己的 `title`、`子任务 <短 id>`，不再显示父标题或空字符串。

### 变更

- 删除占位 `repository` 字段（`https://github.com/OWNER/dsh-agent-desk` 是编造地址），
  避免插件页指向不存在的仓库、将来自动更新打空。
- 新增 `scripts/check-package-files.mjs`：检查 `files` 与 `icon` 声明的路径在磁盘上是否存在，
  缺失时打印缺失清单并非零退出；已接入 `npm run check` 与 `prepack`，防止 `npm pack` 再静默丢文件。

## [0.2.2] - 2026-11-09

### 新增

- 智能体页纳入子智能体会话：汇总 `origin: 'subagent'`、`parentSessionId` 与 sessions store 的
  `subagentsByParent` 目录；子任务作为父任务下的缩进行，带「子」标记，父行显示「含 N 个子任务」。
- 子任务优先按自己的自定义预设归组；自己的预设是内置或无预设时，归到最近祖先的自定义预设，
  并标「内置 standard」或「继承预设」，避免内置排除规则把委派任务吞掉。
- 点击子任务调用 `ctx.uiWorkspace.openSession({ parentSessionId, childSessionId, mode })`，
  打开带谱系的子会话；父任务仍按 session id 打开。

### 修复

- 子会话此前被 `blank` 过滤和「只收有自己预设的会话」两条条件挡掉，导致委派任务不计数。

### 变更

- 7 天窗口与组头/页头计数都包含子任务；子任务同样受 `TASK_WINDOW_MS` 过滤。

## [0.2.1] - 2026-11-09

### 修复

- 点击任务跳错会话：0.2.2-rc.1 的 `sessions` 服务没有 `open()`，原调用抛错被吞掉后又执行
  `layout.selectPanel(null)`，对话页显示 `mainView` 里的旧会话（排在最上面的那条）。
  改用 `uiWorkspace.openSession(id)`，并让点击任务只做这一次导航，不再额外重置面板。

### 变更

- 主区任务自动过滤为最近 7 天（`updatedAt`，常量 `TASK_WINDOW_MS`）；
  组头的运行 / 等待 / 任务数与页头统计都只算过滤后的集合，不提供「显示全部」开关。

## [0.2.0] - 2026-11-09

### 新增

- 宿主半 `delegate_agent` 工具：监听 `agent/created`，把工具注册进每个 agent 自己的作用域，
  通过 `ctx.get('subagents').startActivation({ provider: 'spawn', delivery: 'caller', request })`
  前台委派给目标预设，返回子 agent 的最终文本。
- 委派前用 `ctx.get('agentPresets').list()` 预检：未知预设 / 不可用预设直接报错并列出可用预设；
  registry 不可用时跳过预检、照常委派。
- 工具描述写死确认纪律：调用前必须先向用户说明目标 agent / 任务 / 期望产出并取得同意。
- 浏览器半改为**侧栏导航入口 + 主区整页**：`sidebar.panellist` 注册「智能体」入口，
  同 id 的 `main` keyed 槽注册页面；点任务跳回会话，页面提供「返回对话」。
- 智能体页按自定义预设分组：排除内置 `standard` / `minimal` / `ptc` / `cordis`，
  每组显示预设名、`运行 N · 等待 M` 与任务数；没有任务的自定义预设也占一行。
- 展开/收起状态存 `localStorage`；任务行显示状态点、标题、相对时间。
- 会话归属读 `projectionValues.agentPreset`，显示名读已有 `remote.agentPresets.list()`；
  完全拿不到归属时退化为平铺会话列表，页头提示「当前宿主未暴露会话所属预设，暂按会话平铺」。
- `test/` 最小测试：假 ctx / 假 sessions，覆盖预设不存在、结果文本拼接、四态归类、
  归属读取、分组与内置排除、平铺降级、相对时间、槽位注册失败等路径。

### 变更

- 移除 0.1.0 的侧栏浮层面板；「值班台」入口改为导航级「智能体」页。
- `apply()` 全部包 try/catch；所有宿主服务改为 `ctx.get('...')` 可选读取，失败只 `console.warn` 后降级。
- 页面会话读取与跳转加防御，异常时不影响宿主渲染。
- `package.json` 增加 `check` / `test` / `test:no-isolation` 脚本，版本升到 `0.2.0`。

### 修复

- 避免全局注册工具导致的同名冲突：改为按 agent 作用域注册，注册失败只跳过该 agent。

## [0.1.0] - 2026-11-09

### 新增

- 脚手架：`package.json`、bundle 补丁、侧栏「值班台」触发按钮与浮层面板雏形。
- 面板显示会话四态（运行中 / 等待确认 / 出错 / 空闲），点行跳转会话。
