/**
 * dsh-agent-desk —— 智能体值班台，宿主半。
 *
 * 只做两件事：在每个 agent 创建时，往它自己的作用域注册 `delegate_agent`
 * 与只读的 `list_agent_presets`，让 agent 能查目标预设、把任务交给另一个预设的
 * agent（例如把开发任务交给专门的开发预设），并前台拿回结果。没有默认委派对象：
 * preset 每次显式指定。
 *
 * 所有宿主服务都通过 `ctx.get('...')` 可选读取；注册与执行全程 try/catch，
 * 任何失败只 console.warn 后降级，绝不影响会话组装。
 *
 * 浏览器半在 `lib/client.js`，通过 package.json 的 `dsh.client` 声明被发现。
 */

export const name = 'dsh-agent-desk'

/** 工具名。改这里会同时改模型看到的调用名。 */
export const TOOL_NAME = 'delegate_agent'
export const LIST_TOOL_NAME = 'list_agent_presets'

/** 内置预设：只影响展示的 builtin 标记，不做任何默认目标或过滤。 */
export const BUILTIN_PRESETS = ['standard', 'minimal', 'ptc', 'cordis']

/** 是否为内置预设 id。 */
export function isBuiltinPreset(id) {
  return typeof id === 'string' && BUILTIN_PRESETS.indexOf(id.trim()) !== -1
}

/** 写死在工具描述里的确认纪律（模型侧约定，v0.3 再加 GUI 确认卡）。 */
const CONFIRM_RULE = [
  '纪律（必须遵守，不可跳过）：调用本工具之前，必须先向用户说明三件事并得到明确同意——',
  '① 目标 agent（preset id）；② 要交给它的完整任务；③ 期望产出或验收标准。',
  '没有拿到用户同意，绝对不能调用本工具。',
].join('')

const TOOL_DESCRIPTION = [
  '把一个自包含任务委派给另一个 agent 预设，前台等待它结束后返回其最终文本。',
  '目标 preset 必须已经注册；子 agent 看不到当前会话，所以 task 必须写全背景、约束、交付物与验收标准。',
  '',
  CONFIRM_RULE,
].join('\n')

const LIST_TOOL_DESCRIPTION = [
  '只读：列出当前已注册的 agent 预设，返回 JSON 数组，每项含 id、name、builtin。',
  '内置四个 standard / minimal / ptc / cordis 的 builtin 为 true。',
  '在向用户提委派方案前先调用它，确认目标 id 存在。delegate_agent 没有默认目标，preset 必须按次显式指定。',
].join('\n')

const TOOL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    preset: {
      type: 'string',
      description: '目标 agent 的预设 id（例如你的开发预设）。调用前必须先向用户确认。',
    },
    task: {
      type: 'string',
      description: '完整、自包含的任务：背景、约束、交付物、验收标准。子 agent 看不到当前会话。',
    },
    cwd: {
      type: 'string',
      description: '可选：子 agent 的初始工作目录。省略则继承调用方当前目录。',
    },
  },
  required: ['preset', 'task'],
}

/** 防御式日志：出错也不抛。 */
function warn(message) {
  try {
    console.warn(`[dsh-agent-desk] ${message}`)
  } catch {
    // 连 console 都不可用时保持静默。
  }
}

/** 把任意异常转成一行可读文本。 */
function errorText(error) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** 只取多行诊断的第一行，避免把整段堆栈塞进报错。 */
function firstLine(text) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (value === '') return ''
  const line = value.split(/\r?\n/).find((part) => part.trim() !== '')
  return line === undefined ? value : line.trim()
}

/** 可选读取宿主服务，任何异常都降级为 undefined。 */
function serviceOf(ctx, serviceName) {
  try {
    if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return undefined
    return ctx.get(serviceName)
  } catch (error) {
    warn(`读取服务 ${serviceName} 失败，按不可用处理：${errorText(error)}`)
    return undefined
  }
}

/**
 * 把子 agent 的结果内容块拼成最终文本。
 * 只收 type === 'text' 的非空块，块之间空一行。
 * @param {unknown} output
 * @returns {string}
 */
export function joinResultText(output) {
  if (typeof output === 'string') return output.trim() === '' ? '' : output
  if (!Array.isArray(output)) return ''
  const parts = []
  for (const block of output) {
    if (block === null || typeof block !== 'object') continue
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    if (block.text.trim() === '') continue
    parts.push(block.text)
  }
  return parts.join('\n\n')
}

/**
 * 读预设清单。registry 不支持或读取失败时返回 known: false，调用方跳过校验。
 * @param {unknown} service
 * @returns {Promise<{ known: boolean, rows: Array<object>, reason?: string }>}
 */
export async function describePresets(service) {
  if (service === null || service === undefined || typeof service.list !== 'function') {
    return { known: false, rows: [] }
  }
  try {
    const rows = await service.list()
    if (!Array.isArray(rows)) return { known: false, rows: [] }
    return {
      known: true,
      rows: rows.filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string' && row.id.trim() !== ''),
    }
  } catch (error) {
    warn(`列举 agent 预设失败，跳过预设校验：${errorText(error)}`)
    return { known: false, rows: [], reason: errorText(error) }
  }
}

/**
 * 一个预设的展示文本：`id（名称）`，不可用时附第一行诊断。
 * @param {{ id: string, name?: string, broken?: string }} row
 * @returns {string}
 */
export function presetLabel(row) {
  const id = String(row.id)
  const display = typeof row.name === 'string' && row.name.trim() !== '' && row.name.trim() !== id ? `${id}（${row.name.trim()}）` : id
  const broken = typeof row.broken === 'string' ? firstLine(row.broken) : ''
  return broken === '' ? display : `${display} [不可用: ${broken}]`
}

/** 预设清单的可读列表；空清单返回 `（无）`。 */
export function presetListText(listing) {
  if (listing === null || listing === undefined || listing.known !== true) return ''
  const labels = listing.rows.map(presetLabel)
  return labels.length === 0 ? '（无）' : labels.join('、')
}

/** 给错误消息补上可用预设清单（registry 支持列举时）。 */
export function withPresetHint(message, listing) {
  const text = presetListText(listing)
  if (text === '') return message
  return `${message}\n可用预设：${text}`
}

/**
 * 把 registry 行规整成只读工具的输出：id、name、builtin。
 * @param {Array<object>} rows
 * @returns {Array<{ id: string, name: string, builtin: boolean }>}
 */
export function presetCatalog(rows) {
  if (!Array.isArray(rows)) return []
  const result = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || typeof row.id !== 'string' || row.id.trim() === '') continue
    const id = row.id.trim()
    const name = typeof row.name === 'string' && row.name.trim() !== '' ? row.name.trim() : id
    result.push({ id, name, builtin: isBuiltinPreset(id) })
  }
  return result
}

/** 只读工具的文本输出：稳定排序的 JSON，便于模型和测试直接读。 */
export function formatPresetCatalog(rows) {
  return JSON.stringify(presetCatalog(rows), null, 2)
}

/**
 * 在可选 signal 生效期间等待 promise；取消时抛出稳定错误，监听器一定移除。
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<T>}
 */
function raceAbort(promise, signal) {
  if (signal === undefined || signal === null) return promise
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('委派在子 agent 启动前已被取消'))
      return
    }
    /** @param {() => void} cleanup */
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    /** @param {() => void} onAbort */
    function onAbort() {
      cleanup()
      reject(new Error('委派已被取消'))
    }
    /** @param {T} value */
    const onSettle = (value) => {
      cleanup()
      resolve(value)
    }
    /** @param {Error} error */
    const onReject = (error) => {
      cleanup()
      reject(error)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(onSettle, onReject)
  })
}

/**
 * 构造 `delegate_agent` 工具定义。每次 agent 创建时调用一次，注册到该 agent 的作用域。
 * @param {object} ctx 插件上下文（宿主层），只用于可选读取服务。
 * @returns {object} 可直接交给 `agent.ctx.tools.register` 的原始 ToolDefinition
 */
export function buildDelegateTool(ctx) {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const task = typeof args?.task === 'string' ? args.task.trim() : ''
      if (task === '') {
        throw new Error('`task` 不能为空：请写全任务背景、约束、交付物与验收标准。')
      }
      const preset = typeof args?.preset === 'string' ? args.preset.trim() : ''
      if (preset === '') {
        throw new Error('`preset` 不能为空：请填目标 agent 的预设 id。')
      }
      const parent = exec?.agent
      if (parent === null || parent === undefined) {
        throw new Error('delegate_agent 需要调用方 agent（exec.agent 为空），无法委派。')
      }

      const subagents = serviceOf(ctx, 'subagents')
      if (subagents === null || subagents === undefined || typeof subagents.startActivation !== 'function') {
        throw new Error('当前组合没有可用的 subagents 服务，无法委派。')
      }

      const listing = await describePresets(serviceOf(ctx, 'agentPresets'))
      if (listing.known) {
        const row = listing.rows.find((entry) => entry.id === preset)
        if (row === undefined) {
          throw new Error(withPresetHint(`未知的 agent 预设 "${preset}"。`, listing))
        }
        if (typeof row.broken === 'string' && row.broken.trim() !== '') {
          throw new Error(withPresetHint(`agent 预设 "${preset}" 当前不可用：${firstLine(row.broken)}`, listing))
        }
      }

      const request = {
        prompt: [{ type: 'text', text: task }],
        parent,
        agentPreset: preset,
      }
      const cwd = typeof args?.cwd === 'string' ? args.cwd.trim() : ''
      if (cwd !== '') request.cwd = cwd
      try {
        if (typeof subagents.resolveMaxDepth === 'function') {
          const maxDepth = subagents.resolveMaxDepth()
          if (Number.isSafeInteger(maxDepth) && maxDepth > 0) request.maxDepth = maxDepth
        }
      } catch {
        // 拿不到深度策略就沿用宿主默认。
      }

      let run
      try {
        run = await subagents.startActivation({
          provider: 'spawn',
          delivery: 'caller',
          label: `${TOOL_NAME}: ${task.slice(0, 60)}`,
          signal: exec?.signal,
          request,
        })
      } catch (error) {
        throw new Error(withPresetHint(`委派到预设 "${preset}" 启动失败：${errorText(error)}`, listing))
      }
      let pending
      try {
        pending = run === null || run === undefined ? undefined : run.result
      } catch (error) {
        pending = undefined
        warn(`读取子 agent 结果句柄失败：${errorText(error)}`)
      }
      if (pending === undefined) {
        try {
          if (run !== null && run !== undefined && typeof run.dispose === 'function') await run.dispose()
        } catch {
          // 清理失败不覆盖主错误。
        }
        throw new Error(withPresetHint(`委派到预设 "${preset}" 后没有拿到可等待的结果。`, listing))
      }

      let result
      try {
        result = await raceAbort(pending, exec?.signal)
      } catch (error) {
        throw new Error(withPresetHint(`委派到预设 "${preset}" 等待结果失败：${errorText(error)}`, listing))
      } finally {
        try {
          if (typeof run.dispose === 'function') await run.dispose()
        } catch (error) {
          warn(`子 agent 清理失败（不影响已拿到的结果）：${errorText(error)}`)
        }
      }

      const text = joinResultText(result?.output)
      const stopReason = typeof result?.stopReason === 'string' ? result.stopReason : ''
      if (stopReason === 'completed') {
        return text === '' ? '（子 agent 已结束，但没有留下最终文本。）' : text
      }
      if (stopReason === '' && text !== '') return text
      throw new Error(withPresetHint(
        `委派到预设 "${preset}" 未正常完成（stopReason: ${stopReason === '' ? '未知' : stopReason}）。${text === '' ? '子 agent 没有留下诊断文本。' : text}`,
        listing,
      ))
    },
  }
}

/**
 * 构造只读的 `list_agent_presets` 工具定义：列出 registry 里的预设与 builtin 标记。
 * @param {object} ctx 插件上下文（宿主层），只用于可选读取服务。
 * @returns {object} 可直接交给 `agent.ctx.tools.register` 的原始 ToolDefinition
 */
export function buildListPresetsTool(ctx) {
  return {
    name: LIST_TOOL_NAME,
    description: LIST_TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      const listing = await describePresets(serviceOf(ctx, 'agentPresets'))
      if (!listing.known) {
        throw new Error(`无法列举 agent 预设：${listing.reason === undefined ? '当前组合没有可用的 agentPresets 服务（或不支持 list）' : listing.reason}`)
      }
      return formatPresetCatalog(listing.rows)
    },
  }
}

/**
 * 宿主插件入口：在每个 agent 创建时，把 `delegate_agent` 与 `list_agent_presets`
 * 分别注册进它的作用域。整段 try/catch，任何异常都只告警，不影响会话组装。
 * @param {object} ctx
 */
export function apply(ctx) {
  try {
    if (ctx === null || ctx === undefined || typeof ctx.on !== 'function') {
      warn('ctx.on 不可用，delegate_agent 未注册（插件降级为空实现）')
      return
    }
    const installed = new WeakSet()
    ctx.on('agent/created', (payload) => {
      try {
        const agent = payload !== null && typeof payload === 'object' ? payload.agent : undefined
        if (agent === null || typeof agent !== 'object') return
        if (installed.has(agent)) return
        const tools = agent.ctx?.tools
        if (tools === null || tools === undefined || typeof tools.register !== 'function') {
          warn('agent.ctx.tools.register 不可用，跳过 agent-desk 工具注册')
          return
        }
        // 两个工具各自注册、各自失败，一个冲突不拖累另一个。
        for (const factory of [buildDelegateTool, buildListPresetsTool]) {
          try {
            tools.register(factory(ctx))
          } catch (error) {
            warn(`为 agent 注册 ${factory.name} 失败，已跳过：${errorText(error)}`)
          }
        }
        installed.add(agent)
      } catch (error) {
        warn(`为 agent 注册 agent-desk 工具失败，已跳过：${errorText(error)}`)
      }
    })
  } catch (error) {
    warn(`apply 失败，插件降级为无 agent-desk 工具：${errorText(error)}`)
  }
}
