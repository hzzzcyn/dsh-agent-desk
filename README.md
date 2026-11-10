# dsh-agent-desk · 智能体值班台

> DeepSeek Harness 插件：**在侧栏进入「智能体」页，按自定义预设查看每个 agent 的任务与状态；并让 agent 之间安全地互相委派。**

- 版本：`0.2.3`（侧栏入口 + 主区智能体页 + `delegate_agent` 委派 + `list_agent_presets` 只读清单）
- 适用：DSH `>=0.2.1-rc.1 <0.3.0`，Node `>=20`（开发与验证在 `0.2.2-rc.1`）
- 零运行时依赖、无构建步骤
- 许可：MIT

## 目录

- [解决什么问题](#解决什么问题)
- [功能一览](#功能一览)
- [安装](#安装)
- [用法：智能体页](#用法智能体页)
- [用法：跨 agent 委派](#用法跨-agent-委派)
- [兼容性](#兼容性)
- [已知限制](#已知限制)
- [故障排查](#故障排查)
- [安全与隐私](#安全与隐私)
- [开发](#开发)
- [路线图](#路线图)
- [截图](#截图)
- [许可](#许可)
- [English summary](#english-summary)

## 解决什么问题

1. **看不见**：开了多个自定义 agent 之后，不知道谁在跑、谁在等我确认、每个 agent 下有哪些任务。
   → 侧栏「智能体」入口打开整页：每个自定义预设一行，显示运行中 / 等待确认数量；展开后逐行列出该预设的会话，点任务回到对应会话。
2. **跨 agent 干活难**：私人助手需要开发工程师帮忙时，只能靠人肉复制粘贴。
   → `delegate_agent` 工具：先把「目标 agent / 任务 / 期望产出」提给用户确认，再把任务交给另一个预设的 agent（比如你的开发预设），前台等它结束后拿回最终文本。

## 功能一览

| 能力 | 行为 |
|---|---|
| 侧栏入口 | 导航级「智能体」项（收起侧栏时为机器人图标），`order: 20` |
| 预设分组 | 只列用户自定义预设，内置 `standard` / `minimal` / `ptc` / `cordis` 自动排除 |
| 状态统计 | 每组显示 `运行 N · 等待 M`（有出错时额外显示）与任务数 |
| 子任务 | 委派产生的子会话作为缩进行挂在父任务下，带「子」标记；父行显示「含 N 个子任务」 |
| 跳转 | 普通任务打开会话；子任务打开带谱系的子会话（`parentSessionId` + `childSessionId`） |
| 时间窗口 | 只显示最近 7 天有更新的任务，页头统计同步过滤 |
| 记忆 | 展开/收起状态存 `localStorage["dsh-agent-desk:expanded"]` |
| 委派工具 | `delegate_agent`：`preset` 必填，无默认目标；调用前必须先取得用户同意 |
| 只读清单 | `list_agent_presets`：返回 `[{ id, name, builtin }]`，供模型确认目标 id |

## 安装

### 前置

- DSH `>=0.2.1-rc.1 <0.3.0`；
- 至少有一个**自定义** agent 预设（内置四个会被页面排除）；
- 宿主组合里要有 `subagents` 服务（委派用）。

### 从本地目录（开发）

```bash
dsh plugin --profile desktop add <本目录绝对路径>
```

### 从 npm 或 GitHub（发布后）

```bash
dsh plugin --profile desktop add dsh-agent-desk
dsh plugin --profile desktop add github:<owner>/dsh-agent-desk
```

### 装完怎么验证

1. 重启 DSH；
2. **新建一个会话**——工具按 `agent/created` 事件注册进**每个新 agent 自己的作用域**，已存在的会话不会凭空多出工具；
3. 新会话的工具表里应出现 `delegate_agent` 与 `list_agent_presets`；
4. 左侧导航出现「智能体」，点开是主区整页。

## 用法：智能体页

点左侧栏「智能体」（收起侧栏时为机器人图标）打开主区页面：

- **只列用户自己添加的预设**，内置 `standard` / `minimal` / `ptc` / `cordis` 自动排除；
- 任务只列最近 7 天有更新的（常量 `TASK_WINDOW_MS`），组头与页头统计都按过滤后的集合算；
- 收起的每个智能体一行：预设名 + `运行 N · 等待 M` + 任务数；
- 点一行展开，逐行列出该预设的会话：状态点、标题、相对时间；
- 子智能体会话也会列出：父任务下缩进显示，带「子」标记，父行显示「含 N 个子任务」；
- 点任务：普通任务打开会话；子任务用 `{ parentSessionId, childSessionId, mode }` 地址打开子会话；
- 默认全部收起；展开状态记在浏览器 `localStorage`；
- 预设名单里存在但还没有任务的智能体也会占一行，展开显示「这个智能体还没有任务」。

预设名来自宿主已有的 `remote.agentPresets.list()`；读不到时退化为预设 id，不影响页面。

### 降级：宿主不暴露归属

如果宿主完全拿不到会话归属（`projectionValues.agentPreset`），页面自动退化为平铺会话列表，
页头提示「当前宿主未暴露会话所属预设，暂按会话平铺」，排序仍为等待确认 → 运行中 → 出错 → 空闲。

### 状态判定顺序

```
pendingInteraction 存在 → 等待确认
running === true      → 运行中
error                 → 出错
其余                  → 空闲
```

## 用法：跨 agent 委派

### `delegate_agent`

| 参数 | 必填 | 说明 |
|---|---|---|
| `preset` | 是 | 目标 agent 的预设 id，例如 `dev` |
| `task` | 是 | 完整、自包含的任务（子 agent 看不到当前会话） |
| `cwd` | 否 | 子 agent 的初始目录，省略则继承调用方 |

工具描述里写死了纪律：**调用前必须先向用户说明目标 agent / 任务 / 期望产出，得到同意后才调用。**

典型提示词（对 model 说）：

> 把「给 desktop profile 加一个定时巡检脚本」交给开发预设做。先说清目标 agent、完整任务和验收标准，我点头后再调用。

### 没有默认委派对象

`preset` 是必填参数，每次调用都由模型显式指定；插件**不读取任何全局默认预设、不写配置**。

不确定 id 时先调用 `list_agent_presets`：它返回 `[{ id, name, builtin }]`，内置四个的 `builtin` 为 `true`。
registry 不支持 `list()` 时该工具报可读错误，不返回伪造列表。

### 调用链与返回

```
delegate_agent → subagents.startActivation({ provider: 'spawn', delivery: 'caller', request })
             → 前台等待 run.result
             → 只拼接 type === 'text' 的内容块，块间空一行
             → run.dispose()（finally）
```

- 返回子 agent 的最终文本；`stopReason === 'completed'` 才算成功；
- 结果为空时返回「（子 agent 已结束，但没有留下最终文本。）」；
- 其他结束原因抛错，并附上子 agent 的诊断文本与可用预设清单。

### 常见错误

| 现象 | 原因 / 处理 |
|---|---|
| `` `task` 不能为空 `` | 传了空任务；写全背景、约束、交付物、验收标准 |
| `` `preset` 不能为空 `` | 没指定目标预设 |
| `未知的 agent 预设 "x"` | 消息里会附「可用预设」；先 `list_agent_presets` 核对 |
| `agent 预设 "x" 当前不可用` | 预设注册失败，措辞里带第一行诊断 |
| `当前组合没有可用的 subagents 服务` | 宿主未启用 subagents，插件不做兜底 |
| `委派已被取消` | 调用方的 `signal` 被中止；子 agent 会一并清理 |

## 兼容性

| DSH 版本 | 状态 |
|---|---|
| `0.2.1-rc.1` 及以后 | 按 `engines.dsh` 声明支持 |
| `0.2.2-rc.1` | 开发版本；页面交互与真实委派待重启后实测（见下） |
| `>=0.3.0` | 未验证，`engines` 主动挡掉 |

设计上所有宿主 API 都通过 `ctx.get('...')` 可选读取，读不到只 `console.warn` 后降级，
不会把会话组装弄挂。槽位与 API 契约的查证记录见 [`docs/DESIGN.md`](docs/DESIGN.md)。

> 状态说明：本次改动的页面交互与一次真实委派尚待重启后新建会话实测，验证结论会补到
> [`docs/STATUS.md`](docs/STATUS.md)。

## 已知限制

- **无法直达父会话的子智能体目录**：官方没有公开 API 打开会话头部那个「N 个子智能体」下拉，
  本版直达子会话。
- **7 天窗口固定**，不提供「显示全部」开关。
- **只做 Web/桌面端的侧栏页面**：无 CLI/TUI 形态。
- **没有 GUI 确认卡**（计划在 0.3.0）：确认靠工具描述里的纪律，模型必须自觉遵守。
- **前台阻塞**：`delegate_agent` 等子 agent 结束才返回，长任务会占住调用方这一轮。
- **权限不扩也不限**：子 agent 能做什么由目标预设决定，插件只负责按预设启动，不额外扩权。

## 故障排查

| 症状 | 先查什么 |
|---|---|
| 侧栏没有「智能体」 | 装完是否重启；`dsh.profile.bundles` 是否含 `dsh-agent-desk` |
| 新会话工具表没有 `delegate_agent` | 是否**新建**了会话；旧会话不会补注册 |
| 插件页报「包元信息错误：ENOENT ... icon.svg」 | 0.2.3 已修（补了 `icon.svg` + 打包前校验） |
| 点任务跳到旧会话 | 0.2.1 起改用 `uiWorkspace.openSession`，旧版才有此问题 |
| 页面提示「当前宿主未暴露会话所属预设」 | 宿主未暴露 `projectionValues.agentPreset`，走平铺降级 |
| 某智能体显示「还没有任务」 | 该预设 7 天内没有会话 |
| 委派报「没有可用的 subagents 服务」 | 目标 profile 的宿主组合未启用 subagents |

宿主日志目录（桌面版）：`%APPDATA%\@deepseek-ai\dsh-desktop\logs\`。

## 安全与隐私

- **不写配置**：插件不读取也不写入任何默认预设、不保存委派历史；
- **无网络请求**：宿主半只调用宿主已挂载的服务，浏览器半只读宿主已提供的会话 store；
- **不采集数据**：仅使用宿主已有的会话数据与 `localStorage` 里的展开状态；
- **委派需要明确同意**：工具描述写死「先说明目标/任务/验收，得到同意再调用」；
- **子 agent 的权限由目标预设决定**：委派内容会进入子 agent 会话，按宿主既有机制持久化——
  不要把不该给子 agent 看的内容写进 `task`。

## 开发

```bash
npm run check   # 校验 files 声明 + node --check 两个入口
npm test        # node --test test/*.test.js
```

受限沙箱里 `node --test` 默认用子进程隔离会 EPERM，可用：

```bash
npm run test:no-isolation
```

### 目录结构

```
dsh-agent-desk/
├─ cordis.patch.yml      # bundle 挂载声明（一行 insert）
├─ lib/index.js          # 宿主半（ESM）：agent/created 注册工具、处理委派
├─ lib/client.js         # 浏览器半：手写 ModuleLoader 包，侧栏入口 + 主区页面
├─ icon.svg              # 包级图标（插件页列表用）
├─ test/                 # 不依赖宿主的最小测试（假 ctx / 假 sessions）
├─ scripts/              # 打包前 files 校验
└─ docs/                 # 设计说明、进展记录
```

无构建步骤：宿主半是 ESM，浏览器半是由宿主提供 React 的 ModuleLoader 包。
测试不依赖宿主：假 `ctx`、假 `agent.ctx.tools`、假 `sessions`，覆盖预设不存在、结果文本拼接、
会话归属读取、分组与内置排除、平铺降级、状态归类等路径。

详见 [`docs/DESIGN.md`](docs/DESIGN.md)（含槽位契约与查证结论）、
[`CHANGELOG.md`](CHANGELOG.md)（变更记录）、[`docs/STATUS.md`](docs/STATUS.md)（进展与待办）。

## 路线图

| 版本 | 内容 | 状态 |
|---|---|---|
| 0.1.0 | 侧栏浮层面板雏形 | 已完成（已被 0.2.0 取代） |
| 0.2.0 | 侧栏入口 + 主区智能体页 + `delegate_agent` 委派工具 | 已完成 |
| 0.2.1 | 修复点击跳转；任务 7 天窗口 | 已完成 |
| 0.2.2 | 纳入子智能体会话与子任务跳转 | 已完成 |
| 0.2.3 | 补包级图标；打包前 files 校验 | 已完成 |
| 0.3.0 | 页面内确认卡、每预设任务计数、委派历史 | 计划中 |
| 1.0.0 | 文档、截图、npm 发布、兼容矩阵 | 计划中 |

## 截图

> 待补：侧栏「智能体」入口、分组页、一次 `delegate_agent` 调用。
> 占位路径：`docs/screenshot-sidebar-entry.png`、`docs/screenshot-agent-page.png`。
> 若上架插件市场，另在 `package.json` 旁放 `screenshots.json` 声明 1–8 张仓库内图片。

## 许可

[MIT](LICENSE)

## English summary

`dsh-agent-desk` is a DeepSeek Harness plugin with two halves. The browser half adds a
sidebar **Agents** entry and a main-area page that groups recent sessions (last 7 days) by
custom agent preset, showing running / awaiting-confirmation counts, delegated sub-agent rows
and click-to-open navigation; it is read-only and degrades to a flat session list when the host
does not expose `projectionValues.agentPreset`. The host half registers `delegate_agent` and the
read-only `list_agent_presets` tool inside each agent's own scope on `agent/created`, and
delegates a self-contained task to another registered preset via
`subagents.startActivation({ provider: 'spawn', delivery: 'caller' })`, returning the child
agent's final text after it finishes. There is no default delegation target — `preset` is a
required argument — and the tool description mandates explaining the target, task and expected
output to the user before calling it. No runtime dependencies, no build step, MIT licensed.
