import { test, before } from 'node:test'
import assert from 'node:assert/strict'

let internals
let clientModule

/** 最小 React 替身：createElement 只建节点，由 renderHostNodes 手动展开函数组件。 */
function createElement(type, props, ...children) {
  const next = { ...(props || {}) }
  if (children.length === 1) next.children = children[0]
  else if (children.length > 1) next.children = children
  return { type, props: next }
}

/** 收集节点文本，便于按标题定位任务行。 */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node.props) return textOf(node.props.children)
  return ''
}

/** 展开函数组件，收集所有宿主节点（div/button/span…）。 */
function renderHostNodes(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) renderHostNodes(child, out)
    return out
  }
  if (typeof node.type === 'function') {
    renderHostNodes(node.type(node.props), out)
    return out
  }
  out.push(node)
  renderHostNodes(node.props && node.props.children, out)
  return out
}

before(async () => {
  let entry
  globalThis.window = {
    __ModuleLoader__: {
      load(value) { entry = value },
    },
  }
  await import('../lib/client.js')
  const reactStub = {
    createElement,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
  }
  clientModule = entry.factory((id) => {
    if (id !== 'react') throw new Error(`unexpected require: ${id}`)
    return reactStub
  })
  internals = clientModule.__internals
})

const NOW = Date.parse('2026-11-09T12:00:00+08:00')

test('statusOf 四态判定：等待确认优先于运行中', () => {
  const { statusOf } = internals
  assert.equal(statusOf(null), 'idle')
  assert.equal(statusOf({ pendingInteraction: { kind: 'approval' }, running: true }), 'waiting')
  assert.equal(statusOf({ running: true }), 'running')
  assert.equal(statusOf({ error: new Error('x') }), 'error')
  assert.equal(statusOf({}), 'idle')
  assert.equal(statusOf({ running: false, pendingInteraction: null }), 'idle')
})

test('sessionsFromSnapshot 支持 sessions store 的 { ids, byId } 与数组形态', () => {
  const { sessionsFromSnapshot } = internals
  assert.deepEqual(
    sessionsFromSnapshot({ ids: ['a', 'b'], byId: { a: { id: 'a' }, b: { id: 'b' } } }),
    [{ id: 'a' }, { id: 'b' }],
  )
  assert.deepEqual(sessionsFromSnapshot([{ id: 'a' }]), [{ id: 'a' }])
  assert.deepEqual(sessionsFromSnapshot(undefined), [])
  assert.deepEqual(sessionsFromSnapshot({ ids: 'bad' }), [])
})

test('snapshotParts 从 subagentsByParent 目录补回不在 ids 里的子会话', () => {
  const { snapshotParts } = internals
  const parent = { id: 'p', title: '父' }
  const child = { id: 'c', title: '子', parentSessionId: 'p', origin: 'subagent' }
  const parts = snapshotParts({
    ids: ['p'],
    byId: { p: parent, c: child },
    subagentsByParent: { p: { entries: [{ id: 'c', mode: 'one-shot' }] } },
  })
  assert.deepEqual(parts.sessions.map((row) => row.id), ['p', 'c'])
  assert.equal(parts.catalogs.p.entries[0].mode, 'one-shot')
})

test('countStatuses 统计四态与总数，坏数据跳过', () => {
  const { countStatuses } = internals
  const counts = countStatuses([
    { id: 'a', running: true },
    { id: 'b', pendingInteraction: {} },
    { id: 'c', error: true },
    { id: 'd' },
    null,
    { id: 'e', running: true },
  ])
  assert.deepEqual(counts, { running: 2, waiting: 1, error: 1, idle: 1, total: 5 })
  assert.deepEqual(countStatuses('not-array'), { running: 0, waiting: 0, error: 0, idle: 0, total: 0 })
})

test('presetIdOf 读取 0.2.2 的 projectionValues.agentPreset，并兼容顶层字段', () => {
  const { presetIdOf } = internals
  assert.equal(presetIdOf({ projectionValues: { agentPreset: 'dev' } }), 'dev')
  assert.equal(presetIdOf({ agentPreset: 'assistant' }), 'assistant')
  assert.equal(presetIdOf({ projectionValues: { agentPreset: 'dev' }, agentPreset: 'assistant' }), 'dev')
  assert.equal(presetIdOf({ projectionValues: { agentPreset: 42 } }), '')
  assert.equal(presetIdOf({ projectionValues: null }), '')
  assert.equal(presetIdOf(null), '')
})

test('排序：等待确认 > 运行中 > 出错 > 空闲，同状态按更新时间倒序', () => {
  const { sortSessions } = internals
  const rows = sortSessions([
    { id: 'idle', updatedAt: 500 },
    { id: 'error', error: true, updatedAt: 100 },
    { id: 'running-new', running: true, updatedAt: 900 },
    { id: 'waiting', pendingInteraction: {}, updatedAt: 200 },
    { id: 'running-old', running: true, updatedAt: 300 },
  ])
  assert.deepEqual(rows.map((row) => row.id), ['waiting', 'running-new', 'running-old', 'error', 'idle'])
})

test('relativeTime 覆盖刚刚 / 分钟 / 小时 / 天 / 日期 / 缺失', () => {
  const { relativeTime } = internals
  const now = Date.parse('2026-11-09T12:00:00+08:00')
  assert.equal(relativeTime(now - 30 * 1000, now), '刚刚')
  assert.equal(relativeTime(now - 5 * 60 * 1000, now), '5 分钟前')
  assert.equal(relativeTime(now - 3 * 60 * 60 * 1000, now), '3 小时前')
  assert.equal(relativeTime(now - 2 * 24 * 60 * 60 * 1000, now), '2 天前')
  assert.equal(relativeTime(Date.parse('2026-10-01T00:00:00+08:00'), now), '2026-10-01')
  assert.equal(relativeTime(undefined, now), '')
  assert.equal(relativeTime('not-a-date', now), '')
})

test('展开状态：坏 JSON 回退为空对象，toggle 可开可关', () => {
  const { parseExpanded, toggleExpansion } = internals
  assert.deepEqual(parseExpanded('{"dev":true}'), { dev: true })
  assert.deepEqual(parseExpanded('not-json'), {})
  assert.deepEqual(parseExpanded('[]'), {})
  const opened = toggleExpansion({}, 'dev')
  assert.deepEqual(opened, { dev: true })
  assert.deepEqual(toggleExpansion(opened, 'dev'), {})
})

test('normalizeRoster 只接受 ok + presets 数组', () => {
  const { normalizeRoster } = internals
  const roster = normalizeRoster({ ok: true, value: { presets: [{ id: 'dev', name: '开发' }, { name: 'x' }, null] } })
  assert.deepEqual(roster.map((row) => row.id), ['dev'])
  assert.deepEqual(normalizeRoster({ ok: false, error: { message: 'no' } }), [])
  assert.deepEqual(normalizeRoster({ ok: true, value: {} }), [])
  assert.deepEqual(normalizeRoster(undefined), [])
})

test('无归属字段时走平铺：带固定提示，按等待/运行/空闲排序', () => {
  const { buildViewModel, FLAT_NOTE } = internals
  const model = buildViewModel([
    { id: 'idle', title: '空闲', updatedAt: NOW - 3000 },
    { id: 'running', title: '运行', running: true, updatedAt: NOW - 2000 },
    { id: 'waiting', title: '等待', pendingInteraction: {}, updatedAt: NOW - 1000 },
    { id: 'old', title: '旧任务', updatedAt: NOW - internals.TASK_WINDOW_MS - 1000 },
    { id: 'blank', blank: true },
  ], [], NOW)
  assert.equal(model.mode, 'flat')
  assert.equal(model.note, FLAT_NOTE)
  assert.match(model.note, /当前宿主未暴露会话所属预设/)
  assert.deepEqual(model.sessions.map((row) => row.id), ['waiting', 'running', 'idle'])
  assert.equal(model.groups.length, 0)
})

test('有归属字段时按自定义预设分组，排除内置四个并统计', () => {
  const { buildViewModel } = internals
  const model = buildViewModel([
    { id: 'a', title: '修 bug', projectionValues: { agentPreset: 'dev' }, running: true, updatedAt: NOW - 3000 },
    { id: 'b', title: '等确认', projectionValues: { agentPreset: 'dev' }, pendingInteraction: {}, updatedAt: NOW - 2000 },
    { id: 'c', title: '助手任务', agentPreset: 'assistant', error: true, updatedAt: NOW - 1000 },
    { id: 'd', title: '内置', projectionValues: { agentPreset: 'standard' }, running: true, updatedAt: NOW - 500 },
    { id: 'e', title: '没归属', updatedAt: NOW - 400 },
    { id: 'blank', blank: true },
  ], [
    { id: 'dev', name: '开发', order: 20 },
    { id: 'assistant', name: '助手', order: 10 },
    { id: 'writer', name: '写手', order: 30 },
    { id: 'standard', name: '标准', order: 0 },
  ], NOW)

  assert.equal(model.mode, 'grouped')
  assert.equal(model.note, '')
  assert.equal(model.total, 3)
  assert.equal(model.builtinCount, 1)
  assert.equal(model.unattributed, 1)
  assert.deepEqual(model.groups.map((group) => group.id), ['assistant', 'dev', 'writer'])
  assert.deepEqual(model.groups.map((group) => group.name), ['助手', '开发', '写手'])
  const writer = model.groups.find((group) => group.id === 'writer')
  assert.equal(writer.counts.total, 0)
  assert.deepEqual(writer.sessions, [])

  const dev = model.groups.find((group) => group.id === 'dev')
  assert.equal(dev.counts.running, 1)
  assert.equal(dev.counts.waiting, 1)
  assert.equal(dev.counts.total, 2)
  assert.deepEqual(dev.sessions.map((row) => row.id), ['b', 'a'])
})

test('子智能体会话纳入分组：内置预设子任务归到父预设并打标', () => {
  const { buildViewModel } = internals
  const parent = { id: 'p', title: '助手任务', agentPreset: 'assistant', updatedAt: NOW - 100 }
  const child = (id, preset, updatedAt) => ({
    id,
    parentSessionId: 'p',
    origin: 'subagent',
    blank: true,
    projectionValues: { agentPreset: preset },
    updatedAt,
  })
  const model = buildViewModel([
    parent,
    child('c1', 'standard', NOW - 200),
    child('c2', 'standard', NOW - 300),
    child('c3', 'standard', NOW - 400),
  ], [{ id: 'assistant', name: '助手', order: 10 }], NOW, {
    p: { entries: [
      { id: 'c1', mode: 'continuable', label: '阶段1' },
      { id: 'c2', mode: 'continuable', label: '验证开发预设委派' },
      { id: 'c3', mode: 'one-shot', label: '实现 agent-desk 委派与面板' },
    ] },
  })

  assert.equal(model.mode, 'grouped')
  assert.equal(model.total, 4)
  const assistant = model.groups.find((group) => group.id === 'assistant')
  assert.equal(assistant.counts.total, 4)
  assert.equal(assistant.trees.length, 1)
  const root = assistant.trees[0]
  assert.equal(root.id, 'p')
  assert.equal(root.childCount, 3)
  assert.deepEqual(root.children.map((node) => node.id), ['c1', 'c2', 'c3'])
  assert.deepEqual(root.children.map((node) => node.label), ['阶段1', '验证开发预设委派', '实现 agent-desk 委派与面板'])
  for (const node of root.children) {
    assert.equal(node.child, true)
    assert.equal(node.adoptedPreset, 'standard')
    assert.equal(node.inheritedPreset, false)
  }
})

test('摘要缺 parent/origin 时用 subagentsByParent 目录补出子会话归属', () => {
  const { buildViewModel } = internals
  const model = buildViewModel([
    { id: 'p', title: '父', agentPreset: 'assistant', updatedAt: NOW - 100 },
    { id: 'c', title: '子', blank: true, projectionValues: { agentPreset: 'standard' }, updatedAt: NOW - 200 },
  ], [{ id: 'assistant', name: '助手' }], NOW, {
    p: { entries: [{ id: 'c', mode: 'continuable' }] },
  })
  const assistant = model.groups.find((group) => group.id === 'assistant')
  assert.equal(assistant.counts.total, 2)
  assert.deepEqual(assistant.trees[0].children.map((node) => node.id), ['c'])
  assert.equal(assistant.trees[0].children[0].adoptedPreset, 'standard')
})

test('子任务标题优先级：目录 label > 会话 title > 短 id', () => {
  const { taskTitleOf } = internals
  assert.equal(taskTitleOf({
    id: 'abcdef123456',
    child: true,
    label: '开发空跑一分钟',
    session: { title: '旧标题' },
  }), '开发空跑一分钟')
  assert.equal(taskTitleOf({
    id: 'abcdef123456',
    child: true,
    label: '   ',
    session: { title: '修 dsh-agent-desk 图标缺失' },
  }), '修 dsh-agent-desk 图标缺失')
  assert.equal(taskTitleOf({
    id: 'abcdef123456',
    child: true,
    label: '',
    session: {},
  }), '子任务 abcdef12')
  assert.equal(taskTitleOf({
    id: 'abcdef123456',
    child: false,
    label: '',
    session: {},
  }), 'abcdef123456')
})

test('子任务按自己的自定义预设归组；父任务不在本组时生成“父”上下文行', () => {
  const { buildViewModel } = internals
  const parent = { id: 'p', title: '助手任务', agentPreset: 'assistant', updatedAt: NOW - 100 }
  const model = buildViewModel([
    parent,
    { id: 'c1', parentSessionId: 'p', origin: 'subagent', projectionValues: { agentPreset: 'dev' }, updatedAt: NOW - 200 },
    { id: 'c2', parentSessionId: 'p', origin: 'subagent', updatedAt: NOW - 300 },
  ], [
    { id: 'assistant', name: '助手', order: 10 },
    { id: 'dev', name: '开发', order: 20 },
  ], NOW, { p: { entries: [{ id: 'c1', mode: 'one-shot' }, { id: 'c2', mode: 'unknown' }] } })

  assert.equal(model.total, 3)
  const dev = model.groups.find((group) => group.id === 'dev')
  assert.equal(dev.counts.total, 1)
  assert.equal(dev.trees.length, 1)
  assert.equal(dev.trees[0].context, true)
  assert.equal(dev.trees[0].id, 'p')
  assert.deepEqual(dev.trees[0].children.map((node) => node.id), ['c1'])
  assert.equal(dev.trees[0].children[0].mode, 'one-shot')

  const assistant = model.groups.find((group) => group.id === 'assistant')
  assert.equal(assistant.counts.total, 2)
  assert.equal(assistant.trees[0].childCount, 2)
  assert.deepEqual(assistant.trees[0].children.map((node) => node.id), ['c2'])
  assert.equal(assistant.trees[0].children[0].inheritedPreset, true)
})

test('7 天过滤同样作用于子任务', () => {
  const { buildViewModel, TASK_WINDOW_MS } = internals
  const parent = { id: 'p', title: '父', agentPreset: 'assistant', updatedAt: NOW - 100 }
  const model = buildViewModel([
    parent,
    { id: 'new', parentSessionId: 'p', origin: 'subagent', projectionValues: { agentPreset: 'dev' }, updatedAt: NOW - 1000 },
    { id: 'old', parentSessionId: 'p', origin: 'subagent', projectionValues: { agentPreset: 'dev' }, updatedAt: NOW - TASK_WINDOW_MS - 1000 },
  ], [{ id: 'assistant', name: '助手' }, { id: 'dev', name: '开发' }], NOW)

  const dev = model.groups.find((group) => group.id === 'dev')
  assert.equal(dev.counts.total, 1)
  assert.deepEqual(dev.trees[0].children.map((node) => node.id), ['new'])
  const assistant = model.groups.find((group) => group.id === 'assistant')
  assert.equal(assistant.trees[0].childCount, 1)
})

test('只有内置预设会话时分组为空，不把内置当自定义', () => {
  const { buildViewModel } = internals
  const model = buildViewModel([
    { id: 'a', projectionValues: { agentPreset: 'standard' }, updatedAt: NOW - 1000 },
    { id: 'b', projectionValues: { agentPreset: 'ptc' }, updatedAt: NOW - 2000 },
  ], [{ id: 'standard', name: '标准' }, { id: 'ptc', name: 'PTC' }], NOW)
  assert.equal(model.mode, 'grouped')
  assert.equal(model.groups.length, 0)
  assert.equal(model.builtinCount, 2)
  assert.equal(model.total, 0)
})

test('只保留最近 7 天任务，组头与总数按过滤后集合统计', () => {
  const { buildViewModel, TASK_WINDOW_MS } = internals
  assert.equal(TASK_WINDOW_MS, 7 * 24 * 60 * 60 * 1000)

  const model = buildViewModel([
    { id: 'new', projectionValues: { agentPreset: 'dev' }, running: true, updatedAt: NOW - 1000 },
    { id: 'old', projectionValues: { agentPreset: 'dev' }, updatedAt: NOW - TASK_WINDOW_MS - 1000 },
    { id: 'old-builtin', projectionValues: { agentPreset: 'standard' }, updatedAt: NOW - TASK_WINDOW_MS - 1 },
  ], [{ id: 'dev', name: '开发' }], NOW)

  assert.equal(model.mode, 'grouped')
  assert.equal(model.total, 1)
  assert.equal(model.builtinCount, 0)
  const dev = model.groups.find((group) => group.id === 'dev')
  assert.equal(dev.counts.total, 1)
  assert.equal(dev.counts.running, 1)
  assert.deepEqual(dev.sessions.map((row) => row.id), ['new'])
})

test('全部任务都过期时仍保留自定义预设，但计数为 0', () => {
  const { buildViewModel, TASK_WINDOW_MS } = internals
  const model = buildViewModel([
    { id: 'old', projectionValues: { agentPreset: 'dev' }, updatedAt: NOW - TASK_WINDOW_MS - 1000 },
  ], [
    { id: 'dev', name: '开发', order: 20 },
    { id: 'writer', name: '写手', order: 30 },
  ], NOW)
  assert.equal(model.mode, 'grouped')
  assert.equal(model.total, 0)
  assert.deepEqual(model.groups.map((group) => group.id), ['dev', 'writer'])
  for (const group of model.groups) assert.equal(group.counts.total, 0)
})

test('空列表返回 empty，不抛错', () => {
  const { buildViewModel } = internals
  assert.equal(buildViewModel(null, null).mode, 'empty')
  assert.equal(buildViewModel([null, { blank: true }], []).mode, 'empty')
})

test('apply 注册侧栏入口与主区页面，失败也只降级', () => {
  const registrations = []
  const ctx = {
    slots: {
      inject(_name, callback) { callback() },
      register(descriptor, component) { registrations.push({ descriptor, component }); return () => {} },
    },
  }
  assert.doesNotThrow(() => clientModule.apply(ctx))
  assert.equal(registrations.length, 2)
  const [entry, page] = registrations
  assert.equal(entry.descriptor.name, 'sidebar.panellist')
  assert.equal(entry.descriptor.id, 'agent-desk')
  assert.equal(entry.descriptor.order, 20)
  assert.equal(entry.descriptor.label(), '智能体')
  assert.equal(page.descriptor.name, 'main')
  assert.equal(page.descriptor.key, 'agent-desk')

  const broken = { slots: { inject() { throw new Error('no slots') } } }
  assert.doesNotThrow(() => clientModule.apply(broken))
})

test('主区页面注入的 openSession 走 uiWorkspace.openSession，而不是 sessions.open', () => {
  const registrations = []
  const opened = []
  const panels = []
  const ctx = {
    slots: {
      inject(_name, callback) { callback() },
      register(descriptor) { registrations.push(descriptor); return () => {} },
    },
    uiWorkspace: { openSession(id) { opened.push(id) } },
    layout: { selectPanel(id) { panels.push(id) } },
    sessions: { open() { throw new Error('sessions.open must not be used') } },
  }
  clientModule.apply(ctx)
  const main = registrations.find((descriptor) => descriptor.name === 'main')
  const injected = main.inject()
  injected.openSession('sess-42')
  injected.closePanel()
  assert.deepEqual(opened, ['sess-42'])
  assert.deepEqual(panels, [null])
  assert.ok(clientModule.inject.includes('uiWorkspace'))
})

test('点子任务传精确的父子地址；点父任务传 session id', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => JSON.stringify({ assistant: true, dev: true }), setItem: () => {} },
  })
  const base = Date.now()
  const parent = { id: 'p', title: '父任务', agentPreset: 'assistant', updatedAt: base - 100 }
  const child = (id, title, updatedAt) => ({
    id,
    title,
    parentSessionId: 'p',
    origin: 'subagent',
    blank: true,
    projectionValues: { agentPreset: 'dev' },
    updatedAt,
  })
  const snapshot = {
    ids: ['p', 'c1'],
    byId: { p: parent, c1: child('c1', '子任务一', base - 200) },
    subagentsByParent: { p: { entries: [{ id: 'c1', mode: 'one-shot', label: '阶段1' }] } },
  }
  const opened = []
  const tree = createElement(internals.AgentDeskPage, {
    useSessions: (selector) => selector(snapshot),
    openSession: (target) => opened.push(target),
    loadAgentPresets: () => Promise.resolve([{ id: 'assistant', name: '助手' }, { id: 'dev', name: '开发' }]),
  })
  const rows = renderHostNodes(tree).filter((node) => node.props && node.props.role === 'button')
  const childRow = rows.find((row) => textOf(row).includes('阶段1'))
  assert.ok(childRow)
  childRow.props.onClick()
  const parentRow = rows.find((row) => textOf(row).includes('父任务'))
  assert.ok(parentRow)
  parentRow.props.onClick()
  assert.deepEqual(opened, [
    { parentSessionId: 'p', childSessionId: 'c1', mode: 'one-shot' },
    'p',
  ])
})

test('点击三条任务分别把各自的 id 交给 openSession', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => JSON.stringify({ dev: true }), setItem: () => {} },
  })
  const base = Date.now()
  const session = (id, updatedAt) => ({
    id,
    title: `任务 ${id}`,
    projectionValues: { agentPreset: 'dev' },
    updatedAt,
  })
  const snapshot = {
    ids: ['a', 'b', 'c'],
    byId: {
      a: session('a', base - 1000),
      b: session('b', base - 2000),
      c: session('c', base - 3000),
    },
  }
  const opened = []
  const closed = []
  const tree = createElement(internals.AgentDeskPage, {
    useSessions: (selector) => selector(snapshot),
    openSession: (id) => opened.push(id),
    closePanel: () => closed.push(true),
    loadAgentPresets: () => Promise.resolve([]),
  })
  const rows = renderHostNodes(tree).filter((node) => node.props && node.props.role === 'button')
  assert.equal(rows.length, 3)
  for (const row of rows) row.props.onClick()
  assert.deepEqual(opened, ['a', 'b', 'c'])
  // 点击任务只做一次导航；不能再额外 selectPanel(null) 重置回旧会话。
  assert.equal(closed.length, 0)
})
