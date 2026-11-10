import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import {
  apply,
  buildDelegateTool,
  buildListPresetsTool,
  describePresets,
  formatPresetCatalog,
  isBuiltinPreset,
  joinResultText,
  presetCatalog,
  presetLabel,
  presetListText,
  withPresetHint,
} from '../lib/index.js'

// 测试期静音插件告警，避免污染断言输出。
let originalWarn
before(() => {
  originalWarn = console.warn
  console.warn = () => {}
})
after(() => {
  console.warn = originalWarn
})

/** 假上下文：只实现 ctx.get / ctx.on / ctx.on 的返回值。 */
function makeCtx({ presets, subagents, on } = {}) {
  const handlers = new Map()
  const ctx = {
    get(serviceName) {
      if (serviceName === 'agentPresets') return presets
      if (serviceName === 'subagents') return subagents
      return undefined
    },
    on: on ?? ((event, handler) => {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    }),
  }
  return { ctx, handlers }
}

/** 预设 registry 的假实现。 */
function makePresets(rows) {
  return { async list() { return rows } }
}

/** 组一个成功的子 agent 运行句柄。 */
function makeRun({ output, stopReason = 'completed', onDispose } = {}) {
  return {
    result: Promise.resolve({ output, stopReason }),
    async dispose() {
      if (typeof onDispose === 'function') onDispose()
    },
  }
}

test('joinResultText 只拼接非空 text 块', () => {
  assert.equal(joinResultText([
    { type: 'text', text: '第一段' },
    { type: 'tool_use', name: 'x' },
    { type: 'text', text: '   ' },
    { type: 'text', text: '第二段' },
  ]), '第一段\n\n第二段')
  assert.equal(joinResultText(undefined), '')
  assert.equal(joinResultText('纯文本结果'), '纯文本结果')
  assert.equal(joinResultText('   '), '')
})

test('presetLabel / presetListText / withPresetHint 可读且带可用列表', () => {
  const rows = [
    { id: 'assistant', name: '助手' },
    { id: 'dev', name: '开发', broken: 'activation failed\nstack' },
  ]
  assert.equal(presetLabel(rows[0]), 'assistant（助手）')
  assert.match(presetLabel(rows[1]), /dev.*不可用: activation failed/)
  const listing = { known: true, rows }
  assert.equal(presetListText(listing), 'assistant（助手）、dev（开发） [不可用: activation failed]')
  assert.match(withPresetHint('出错了', listing), /可用预设：assistant/)
  assert.equal(withPresetHint('出错了', { known: false, rows: [] }), '出错了')
})

test('describePresets 在服务缺失或抛错时降级为 known:false', async () => {
  assert.deepEqual(await describePresets(undefined), { known: false, rows: [] })
  assert.deepEqual(await describePresets({}), { known: false, rows: [] })
  const broken = await describePresets({ async list() { throw new Error('boom') } })
  assert.equal(broken.known, false)
  assert.match(broken.reason, /boom/)
})

test('presetCatalog 输出 id/name/builtin，内置四个标记 true', () => {
  const rows = [
    { id: 'dev', name: '开发' },
    { id: 'standard', name: '标准' },
    { id: 'minimal' },
    { id: 'ptc', name: 'PTC' },
    { id: 'cordis', name: 'Creator' },
    { id: '  ' },
    null,
  ]
  assert.equal(isBuiltinPreset('standard'), true)
  assert.equal(isBuiltinPreset('dev'), false)
  assert.equal(isBuiltinPreset(' standard '), true)
  assert.deepEqual(presetCatalog(rows), [
    { id: 'dev', name: '开发', builtin: false },
    { id: 'standard', name: '标准', builtin: true },
    { id: 'minimal', name: 'minimal', builtin: true },
    { id: 'ptc', name: 'PTC', builtin: true },
    { id: 'cordis', name: 'Creator', builtin: true },
  ])
  assert.equal(formatPresetCatalog([{ id: 'dev', name: '开发' }]), JSON.stringify([{ id: 'dev', name: '开发', builtin: false }], null, 2))
})

test('list_agent_presets 返回 registry 里的 id/name/builtin', async () => {
  const presets = makePresets([
    { id: 'dev', name: '开发' },
    { id: 'standard', name: '标准' },
  ])
  const { ctx } = makeCtx({ presets })
  const tool = buildListPresetsTool(ctx)
  assert.equal(tool.name, 'list_agent_presets')
  const rows = JSON.parse(await tool.execute({}, {}))
  assert.deepEqual(rows, [
    { id: 'dev', name: '开发', builtin: false },
    { id: 'standard', name: '标准', builtin: true },
  ])
})

test('list_agent_presets 在 registry 不可用或读取失败时报可读错误', async () => {
  const missing = buildListPresetsTool(makeCtx({}).ctx)
  await assert.rejects(missing.execute({}, {}), /无法列举 agent 预设.*没有可用的 agentPresets 服务/)

  const broken = buildListPresetsTool(makeCtx({ presets: { async list() { throw new Error('registry down') } } }).ctx)
  await assert.rejects(broken.execute({}, {}), /无法列举 agent 预设：registry down/)
})

test('apply 在 agent/created 时注册两个工具，且重复事件不重复注册', () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx)
  const handler = handlers.get('agent/created')
  assert.equal(typeof handler, 'function')

  const registered = []
  const agent = { ctx: { tools: { register(definition) { registered.push(definition); return () => {} } } } }
  handler({ agent, source: 'startup', signal: undefined })
  handler({ agent, source: 'startup', signal: undefined })

  assert.equal(registered.length, 2)
  const delegate = registered.find((definition) => definition.name === 'delegate_agent')
  const list = registered.find((definition) => definition.name === 'list_agent_presets')
  assert.ok(delegate)
  assert.ok(list)
  assert.match(delegate.description, /必须先向用户说明/)
  assert.match(delegate.description, /同意/)
  assert.equal(delegate.parameters.required.includes('preset'), true)
  assert.equal(delegate.parameters.required.includes('task'), true)
  assert.match(list.description, /先调用它/)
  assert.match(list.description, /没有默认目标/)
  assert.equal(list.parameters.type, 'object')
  assert.deepEqual(list.parameters.properties, {})
})

test('一个工具注册失败不拖累另一个', () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx)
  const registered = []
  const agent = {
    ctx: {
      tools: {
        register(definition) {
          if (definition.name === 'delegate_agent') throw new Error('name taken')
          registered.push(definition)
        },
      },
    },
  }
  assert.doesNotThrow(() => handlers.get('agent/created')({ agent }))
  assert.deepEqual(registered.map((definition) => definition.name), ['list_agent_presets'])
})

test('apply 遇到坏 ctx / 坏 agent 也不抛错', () => {
  assert.doesNotThrow(() => apply(undefined))

  const { ctx, handlers } = makeCtx()
  apply(ctx)
  const handler = handlers.get('agent/created')
  assert.doesNotThrow(() => handler(undefined))
  assert.doesNotThrow(() => handler({ agent: {} }))
  assert.doesNotThrow(() => handler({ agent: 'not-an-object' }))
})

test('ctx.on 抛错时 apply 只降级不抛出', () => {
  const { ctx } = makeCtx({ on() { throw new Error('no events') } })
  assert.doesNotThrow(() => apply(ctx))
})

test('delegate_agent 正常委派：前台等结果、拼接文本、清理句柄', async () => {
  const calls = []
  let disposed = 0
  const presets = makePresets([{ id: 'assistant', name: '助手' }, { id: 'dev', name: '开发' }])
  const subagents = {
    resolveMaxDepth() { return 1 },
    async startActivation(request) {
      calls.push(request)
      return makeRun({
        output: [{ type: 'text', text: '改完了' }, { type: 'text', text: '测试通过' }],
        onDispose: () => { disposed += 1 },
      })
    },
  }
  const { ctx } = makeCtx({ presets, subagents })
  const tool = buildDelegateTool(ctx)

  const text = await tool.execute({ preset: 'dev', task: '修一下测试', cwd: 'D:\\work' }, { agent: { id: 'parent' } })
  assert.equal(text, '改完了\n\n测试通过')
  assert.equal(disposed, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].provider, 'spawn')
  assert.equal(calls[0].delivery, 'caller')
  assert.equal(calls[0].request.agentPreset, 'dev')
  assert.equal(calls[0].request.cwd, 'D:\\work')
  assert.equal(calls[0].request.maxDepth, 1)
  assert.deepEqual(calls[0].request.prompt, [{ type: 'text', text: '修一下测试' }])
})

test('预设不存在时报错，并列出可用预设', async () => {
  const presets = makePresets([{ id: 'assistant', name: '助手' }, { id: 'dev', name: '开发' }])
  const { ctx } = makeCtx({ presets, subagents: { async startActivation() { throw new Error('should not start') } } })
  const tool = buildDelegateTool(ctx)

  await assert.rejects(
    tool.execute({ preset: 'nope', task: '随便' }, { agent: { id: 'parent' } }),
    (error) => {
      assert.match(error.message, /未知的 agent 预设 "nope"/)
      assert.match(error.message, /可用预设：assistant（助手）、dev（开发）/)
      return true
    },
  )
})

test('预设存在但不可用时报错，带上诊断', async () => {
  const presets = makePresets([{ id: 'dev', broken: 'agent-preset/invalid: tool missing\nmore' }])
  const subagents = { async startActivation() { throw new Error('should not start') } }
  const { ctx } = makeCtx({ presets, subagents })
  const tool = buildDelegateTool(ctx)

  await assert.rejects(
    tool.execute({ preset: 'dev', task: '写代码' }, { agent: { id: 'parent' } }),
    /当前不可用：agent-preset\/invalid: tool missing/,
  )
})

test('空 task / 空 preset / 缺 exec.agent 都报可读错误', async () => {
  const { ctx } = makeCtx({})
  const tool = buildDelegateTool(ctx)
  await assert.rejects(tool.execute({ preset: 'dev', task: '  ' }, { agent: {} }), /task.*不能为空/)
  await assert.rejects(tool.execute({ preset: ' ', task: 'x' }, { agent: {} }), /preset.*不能为空/)
  await assert.rejects(tool.execute({ preset: 'dev', task: 'x' }, {}), /exec\.agent 为空/)
})

test('缺 subagents 服务时报可读错误', async () => {
  const { ctx } = makeCtx({ presets: undefined, subagents: undefined })
  const tool = buildDelegateTool(ctx)
  await assert.rejects(
    tool.execute({ preset: 'dev', task: 'x' }, { agent: { id: 'parent' } }),
    /没有可用的 subagents 服务/,
  )
})

test('startActivation 失败时带出原因和可用预设', async () => {
  const presets = makePresets([{ id: 'dev' }])
  const subagents = { async startActivation() { throw new Error('spawn rejected') } }
  const { ctx } = makeCtx({ presets, subagents })
  const tool = buildDelegateTool(ctx)

  await assert.rejects(
    tool.execute({ preset: 'dev', task: 'x' }, { agent: { id: 'parent' } }),
    (error) => {
      assert.match(error.message, /启动失败：spawn rejected/)
      assert.match(error.message, /可用预设：dev/)
      return true
    },
  )
})

test('预设 registry 读取失败不阻塞委派', async () => {
  const presets = { async list() { throw new Error('registry down') } }
  const subagents = { async startActivation() { return makeRun({ output: [{ type: 'text', text: '仍然成功' }] }) } }
  const { ctx } = makeCtx({ presets, subagents })
  const tool = buildDelegateTool(ctx)

  const text = await tool.execute({ preset: 'dev', task: 'x' }, { agent: { id: 'parent' } })
  assert.equal(text, '仍然成功')
})

test('子 agent 异常结束时抛错并保留其诊断文本', async () => {
  const presets = makePresets([{ id: 'dev' }])
  const subagents = {
    async startActivation() {
      return makeRun({ output: [{ type: 'text', text: '找不到文件' }], stopReason: 'error' })
    },
  }
  const { ctx } = makeCtx({ presets, subagents })
  const tool = buildDelegateTool(ctx)

  await assert.rejects(
    tool.execute({ preset: 'dev', task: 'x' }, { agent: { id: 'parent' } }),
    (error) => {
      assert.match(error.message, /未正常完成（stopReason: error）/)
      assert.match(error.message, /找不到文件/)
      return true
    },
  )
})

test('完成但没有文本时返回明确的占位说明', async () => {
  const presets = makePresets([{ id: 'dev' }])
  const subagents = { async startActivation() { return makeRun({ output: [] }) } }
  const { ctx } = makeCtx({ presets, subagents })
  const tool = buildDelegateTool(ctx)

  const text = await tool.execute({ preset: 'dev', task: 'x' }, { agent: { id: 'parent' } })
  assert.match(text, /没有留下最终文本/)
})
