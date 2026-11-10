# 设计说明

## 一、总体结构

```
dsh-agent-desk/
├─ cordis.patch.yml      # bundle 挂载声明（一行）
├─ lib/index.js          # 宿主半：agent/created 时注册工具、处理委派
├─ lib/client.js         # 浏览器半：侧栏入口 + 主区「智能体」页面
├─ test/                 # 不依赖宿主的最小测试（假 ctx / 假 sessions）
└─ package.json          # dsh.bundle / dsh.client 声明
```

宿主半与浏览器半各自独立：即使页面注册失败，委派工具也应该可用；反之亦然。

## 二、跨 agent 委派怎么实现

参考 dsh-agents-manager 与 dsh-ops 的实战记录，核心是**运行时调用宿主服务**，不通过 profile 配置拼装。

### 1. 注册时机：每个 agent 自己的作用域

`delegate_agent` / `list_agent_presets` 都不能注册到全局工具表：同名工具会在第二个 agent
创建时冲突，直接把新会话弄挂。正确做法是监听 `agent/created`，把工具注册进该 agent 的 `agent.ctx`：

```js
ctx.on('agent/created', ({ agent, source, signal }) => {
  for (const factory of [buildDelegateTool, buildListPresetsTool]) {
    try {
      agent.ctx.tools.register(factory(ctx))
    } catch (error) {
      console.warn('[dsh-agent-desk] 注册失败，跳过', error)
    }
  }
})
```

- 事件载荷是 `{ agent, source, signal }`，在 agent 作用域发布之后、队列工作放行之前触发；
- `agent.ctx` 上的注册随 agent 销毁自动回卷，不需要手动 dispose；
- `tools.register` 只收**一个对象参数**，返回值是 disposer；
- 原始注册必须给**对象根 JSON Schema**（`type: 'object'` + `properties` + `required`），
  不能只给字段映射表——`defineTool` 才会把字段映射编译成 JSON Schema；
- 用 `WeakSet` 防同一 agent 重复注册；冲突或失败只 `console.warn`。

### 2. 调用链

```js
const run = await ctx.get('subagents').startActivation({
  provider: 'spawn',
  delivery: 'caller',
  label: 'delegate_agent: …',
  signal: exec.signal,
  request: {
    prompt: [{ type: 'text', text: task }],
    parent: exec.agent,
    agentPreset: preset,
    cwd,            // 可选
    maxDepth,       // 可选，优先用 resolveMaxDepth() 的返回值
  },
})
const result = await run.result   // { output, structured, stopReason }
await run.dispose()               // finally 里清理
return joinResultText(result.output)
```

- `delivery: 'caller'` 表示结果只回到调用方，不向父 agent 发完成通知；
- `output` 是内容块数组，只拼接 `type === 'text'` 的非空块，块间空一行；
- `stopReason === 'completed'` 视为成功；其他值抛错并附上子 agent 的诊断文本；
- `dispose()` 放在 `finally`，清理失败只 warn，不覆盖已拿到的结果。

### 3. 预设校验与降级

`ctx.get('agentPresets')` 可选读取，registry 的 `list()` 是异步的，返回：

```ts
{ id: string, name?: string, description?: string, order?: number, broken?: string }[]
```

- `preset` 不在列表里 → 启动前报错，附「可用预设」；
- `preset` 在列表里但 `broken` 有值 → 报「当前不可用」并附诊断第一行；
- registry 不存在、没有 `list()`、或 `list()` 抛错 → 跳过预检，照常尝试委派，失败文本原样带回。

### 4. 确认流程

模型侧约定：先向用户说明「目标 agent / 任务 / 期望产出」，得到同意后才调用 `delegate_agent`。
工具描述里写死这条纪律；GUI 确认卡留待后续版本。

### 5. 无默认目标与只读预设清单

`preset` 是必填参数；插件**不读取任何全局默认预设、不写配置**。目标完全由模型在每次调用时
显式给出，指定不存在的 id 就报错并列出可用预设（registry 支持 `list()` 时）。

为让模型在提委派方案前先确认 id，同一作用域还注册只读工具 `list_agent_presets`：

- 无参数；
- 返回 JSON 数组 `[{ id, name, builtin }]`，`name` 缺失时用 id 补齐；
- 内置四个 `standard` / `minimal` / `ptc` / `cordis` 的 `builtin` 为 `true`；
- 工具描述要求模型「在向用户提委派方案前先调用它，确认目标 id 存在」；
- registry 缺失或不支持 `list()` 时抛可读错误，不返回伪造列表。

两个工具在 `agent/created` 时**各自注册、各自 try/catch**：一个名字冲突或注册失败不影响另一个，
也不影响会话组装。

## 三、浏览器半：侧栏入口 + 主区页面

### 1. 查证结论（2026-11-09，依据安装包 app.asar 内的 0.2.2-rc.1 客户端 bundle）

**问题：`useSessions()` 的会话行里有没有预设归属字段？**
**有。** 实际字段是 `projectionValues.agentPreset`，不是顶层 `agentPreset`：

- `@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js`：
  `state.byId[sessionId]?.projectionValues?.agentPreset`；
- `@deepseek-ai/dsh-client-ui-workspace/lib/client.js`：
  `summary?.projectionValues?.agentPreset`。

`agentPresetName` 在 0.2.2-rc.1 的客户端 bundle 里搜不到。预设显示名改从**已有的**
`remote.agentPresets.list()` 读：调用形状是 `{ ok, value: { presets: [{ id, name, ... }] } }`，
官方 `ui-agent-preset` 的 `readRoster()` 就是这么用的。这是宿主本来就挂载的 remote，
**没有新增任何宿主 HTTP 接口**。

因此本版走**分组方案**：每个自定义预设一行，可展开看任务，点击任务跳会话。
平铺方案仍保留为降级路径（万一未来宿主拿不到归属字段）。

### 2. 数据与分组规则

页面用 `useSessions((state) => state)` 读整个 store 快照，再按 `{ ids, byId }` 展开会话数组；
旧的数组返回形态也兼容。

会话行归属兼容读取顺序：`projectionValues.agentPreset` → 顶层 `agentPreset`。
两者都没有的会话不参与分组。

- 排除内置四个：`standard`、`minimal`、`ptc`、`cordis`；
- 预设名单里没有任务的自定义智能体也占一行，展开显示「这个智能体还没有任务」；
- 组名优先 `agentPresetName`，其次 remote 名单里的 `name`，最后退化为预设 id；
- 每组统计 `运行 N · 等待 M`（有出错时额外显示），右侧显示任务数；
- 组内任务排序：等待确认 → 运行中 → 出错 → 空闲，同状态按 `updatedAt` 倒序；
- 默认全部收起；展开状态存 `localStorage["dsh-agent-desk:expanded"]`，读写失败静默降级。

完全没有归属字段时（降级路径）：页头固定提示「当前宿主未暴露会话所属预设，暂按会话平铺」，
列表按等待确认 → 运行中 → 出错 → 空闲排序，带状态点、相对时间和点击跳转。

任务行显示：状态点、标题（缺省用 id）、相对时间、状态文字。普通任务点调用
`ctx.uiWorkspace.openSession(id)`；不要在点击后再额外 `selectPanel(null)`，否则导航失败会退回旧会话。

相对时间：`刚刚` / `N 分钟前` / `N 小时前` / `N 天前` / `YYYY-MM-DD`。

### 3. 子智能体会话

字段与识别（0.2.2-rc.1 客户端）：

- 会话摘要：`origin === 'subagent'`、`parentSessionId?`、`sessionId`、`updatedAt`、`blank`；
  宿主持久化 header 里对应 `origin: 'subagent'`、`parentSession`、`agentPreset`；
- sessions store 还有 `subagentsByParent[parentId].entries[]`，每项含 `id`、`mode`、`label`；
- 子会话可能 `blank: true`、摘要缺 `parentSessionId`、或不在 `ids` 里，所以：
  - 子智能体即使 `blank` 也列入；
  - 用目录给缺字段的子会话补 `parentSessionId` / `origin`；
  - 从目录把不在 `ids` 里的子会话从 `byId` 补回。

归组与展示：

- 子任务自己的预设是**自定义**时按它归组；
- 自己是内置预设或没有预设时，沿父链归到最近的自定义预设，并标「内置 standard」或「继承预设」；
  否则内置排除规则会把委派任务再次吞掉；
- 同组父子嵌套成缩进行，带「子」标记；父行显示「含 N 个子任务」；
- 子行标题取目录 `entries[].label`；缺失时退子会话自己的 `title`，再缺退 `子任务 <短 id>`；
- 父任务在另一组时，子任务组里生成一条不计数量的「父」上下文行；
- 组头与页头计数含子任务，7 天窗口同样过滤子任务。

跳转：官方 API 是 `ctx.uiWorkspace.openSession({ parentSessionId, childSessionId, mode })`，
`mode` 来自目录（缺失退化为 `unknown`）。它会打开带谱系的子会话。
**没有公开 API 能打开父会话头部那个「N 个子智能体」下拉目录**：该目录是 `ui-subagent`
组件内的本地状态，只暴露 slot inject 回调。因此本版直达子会话，而不是父会话+展开目录。

### 4. 状态判定

顺序不可换：

```
pendingInteraction 存在 → 等待确认
running === true      → 运行中
error                 → 出错
其余                  → 空闲
```

任何字段缺失、类型不对、`useSessions()` 抛错，一律降级为空列表，不抛错。

## 四、槽位

| 槽位 | 用途 | 注册键 |
|---|---|---|
| `sidebar.panellist` | 左侧导航入口「智能体」 | `id: 'agent-desk'`，`order: 20`，`label: () => '智能体'` |
| `main` | 主区页面 | `key: 'agent-desk'`（keyed 槽用 `key`，不是 `id`） |

```js
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist', id: 'agent-desk', order: 20, label: () => '智能体',
}, AgentDeskIcon))

ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main', key: 'agent-desk',
  inject: () => ({ openSession, closePanel, loadAgentPresets }),
}, AgentDeskPage))
```

依据安装包内的官方实现：

- `sidebar.panellist` 的组件是**图标**，收到 `{ size, active }`；`label` 负责可见文字、
  无障碍名和收起时 tooltip；
- 官方 `ui-plugin-manager` 的主区注册为 `ctx.slots.register({ name: 'main', key: 'plugins', ... })`；
  `ui-layout` 读取 `entry.options.key` 判断面板是否存在，`selectPanel(id)` 用这个 key；
- 页面与入口必须成对注册；少一个就会出现「点了没反应」或 `selectPanel` 抛错；
- `apply()` 两段各自 try/catch，缺槽位只 warn，不影响宿主启动。

## 五、浏览器半的包格式

DSH 的客户端模块系统要求手写 ModuleLoader 外壳（无构建）：

```js
window.__ModuleLoader__.load({
  id: 'dsh-agent-desk',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    // ...组件与 apply...
    exports.inject = ['sessions', 'slots', 'layout']
    exports.apply = apply
    return module.exports
  },
})
```

为了能用 `node --test` 直接测纯函数，`exports.__internals` 额外暴露状态判定、归属读取、
分组模型与相对时间等函数；浏览器侧不会读取这个字段。

## 六、已验证清单

1. ~~`agent/created` 事件的确切形态，以及 `agent.ctx.tools.register` 的签名~~
   → 已确认：载荷 `{ agent, source, signal }`；`register(definition)` 单对象参数；按 agent 作用域注册。
2. ~~`ctx.agentPresets` 是否有 `list()`~~
   → 已确认：`agentPresets.list(): Promise<{id,name?,description?,order?,broken?}[]>`；
   `resolve(id)` 失败时抛 `agent-preset/not-found` 并带 `available`。
3. ~~`useSessions()` 返回项里是否带 `agentPreset` 字段~~
   → 已确认：在 `projectionValues.agentPreset`；没有 `agentPresetName`；显示名从
   `remote.agentPresets.list()` 取。
4. ~~`startActivation` 在 0.2.2 的错误形态~~
   → 已确认 registry 层：未知预设为 `agent-preset/not-found`，预设不可用为
   `agent-preset/invalid`，两者都带预设信息；本插件先用 `list()` 预检。
5. ~~`sidebar.panellist` 与 `main` 的注册契约~~
   → 已确认：入口用 `id/order/label`，图标组件收 `{size, active}`；主区是 keyed 槽，
   用 `key` 对齐入口 id；返回对话调用 `ctx.layout.selectPanel(null)`。

仍未验证：**真实跑一次委派与页面交互**（本次边界不重启 DSH）。留待重启后新建会话实测。

## 七、兼容策略

- `engines.dsh: ">=0.2.1-rc.1 <0.3.0"`；
- 所有宿主 API 调用包 try/catch，失败只 `console.warn`，绝不让插件把会话组装弄挂；
- 服务一律 `ctx.get('...')` 可选读取，不假设属性一定存在；
- 会话归属字段做双路径读取，拿不到就整体退化为平铺列表；
- 原始工具注册用完整 JSON Schema 对象根，避免模型侧 schema 校验失败。
