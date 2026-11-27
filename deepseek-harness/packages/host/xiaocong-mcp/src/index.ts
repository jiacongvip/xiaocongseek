/**
 * Shell-owned local MCP server for Xiaocongseek.
 *
 * External AI agents (WorkBuddy, Claude Code, Cursor, Codex, OpenCode) get a
 * streamable HTTP MCP endpoint on a fixed loopback port and call the studio's
 * editing capabilities — project, render, subtitle, media, digital human,
 * image — through it. Every tool proxies one route of the digital-human-studio
 * plugin's local REST bridge, so the engine, recipes and credentials stay in
 * one place and this package owns no business logic.
 *
 * The same plugin serves two small settings routes (/xiaocong/mcp/status and
 * /xiaocong/mcp/bind) so the Settings → Account panel can show the server URL
 * and toggle each agent's MCP config file.
 */

import type { Context } from '@deepseek-ai/cordis'
// Empty type import: merges `webServer` into the Context interface.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { AGENT_SPECS, readAgentState, setAgentBound } from './agent-configs.js'
import { ROUTE, type XcyMcpStatus } from './shared.js'

export { ROUTE } from './shared.js'
export type { XcyMcpStatus, XcyMcpAgentState, XcyMcpBindBody } from './shared.js'

export const name = 'xiaocong-mcp'

/** Only the web server is required; same injection contract as xiaocong-auth. */
export const inject = ['webServer']

/** Local listen port; Xiaocongcut owns 18845, so Xiaocongseek takes the next one. */
const DEFAULT_PORT = 18846
/** Streamable HTTP path the agents' configs point at. */
const MCP_PATH = '/api/v1/mcp'
/** Server identity reported by tools/list and initialize. */
const SERVER_NAME = 'xiaocongseek'
const SERVER_VERSION = '0.2.2'

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

interface XcyMcpState {
  running: boolean
  port: number
  error?: string
}

function crossOrigin(req: IncomingMessage): boolean {
  const origin = String(req.headers.origin ?? '')
  if (!origin) return false
  try {
    const host = new URL(origin).hostname
    return !LOOPBACK_HOSTS.includes(host)
  } catch {
    return true
  }
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function portFromEnv(): number {
  const raw = (process.env.XIAOCONG_MCP_PORT ?? '').trim()
  if (!raw) return DEFAULT_PORT
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT
}

/** Build the local MCP server with one tool per plugin bridge route. */
function buildMcpServer(shellPort: () => number | undefined): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  /** The plugin bridge lives on the shell web server; its port is resolved through the reference captured at apply time. */
  const bridge = (): string => {
    const port = shellPort()
    if (!port) throw new Error('Xiaocongseek 本地服务尚未就绪，请稍后重试')
    return `http://127.0.0.1:${String(port)}`
  }

  const text = (value: unknown): { content: { type: 'text'; text: string }[] } => {
    const raw = JSON.stringify(value)
    const limited = raw.length > 30000 ? `${raw.slice(0, 30000)}…（已截断）` : raw
    return { content: [{ type: 'text', text: limited }] }
  }

  const get = async (path: string, query?: Record<string, string>, timeoutMs = 60_000) => {
    const url = new URL(`${bridge()}${path}`)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) })
    return response.json() as Promise<unknown>
  }

  const post = async (path: string, body: Record<string, unknown>, timeoutMs = 60_000) => {
    const response = await fetch(`${bridge()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.json() as Promise<unknown>
  }

  const registerGet = (
    tool: string,
    description: string,
    route: string,
    query?: Record<string, { name: string; description: string; optional?: boolean }>,
    timeoutMs?: number,
  ) => {
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [key, meta] of Object.entries(query ?? {})) {
      shape[key] = meta.optional
        ? z.string().optional().describe(meta.description)
        : z.string().describe(meta.description)
    }
    server.registerTool(tool, { title: tool, description, inputSchema: shape }, async (args) => {
      const picked: Record<string, string> = {}
      for (const key of Object.keys(query ?? {})) {
        const value = args?.[key]
        if (typeof value === 'string' && value !== '') picked[key] = value
      }
      try {
        return text(await get(route, picked, timeoutMs))
      } catch (error) {
        return text({ success: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  }

  const registerPost = (tool: string, description: string, route: string, timeoutMs?: number) => {
    server.registerTool(tool, {
      title: tool,
      description,
      inputSchema: { payload: z.record(z.string(), z.unknown()).describe('转发给剪辑引擎的完整参数对象') },
    }, async (args) => {
      const payload = (args?.payload ?? {}) as Record<string, unknown>
      try {
        return text(await post(route, payload, timeoutMs))
      } catch (error) {
        return text({ success: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  }

  // ── Read-only tools ───────────────────────────────────────────────────────
  registerGet('xiaocong_status', 'Xiaocongseek 整体状态：插件、剪辑引擎（Xiaocongcut）、素材目录是否就绪', '/digital-human-studio/status')
  registerGet('xiaocong_capabilities', '能力清单：技能/工具/样式/音效/模板数量与详情', '/digital-human-studio/capabilities')
  registerGet('xiaocong_account_balance', 'XiaocongAPI 账户余额（充值余额、已用额度）', '/digital-human-studio/account/balance')
  registerGet('xiaocong_project_list', '列出本地工程目录下的所有工程', '/digital-human-studio/projects')
  registerGet('xiaocong_media_list', '列出本地素材库（工程源素材 + 公司素材）', '/digital-human-studio/media')
  registerGet('xiaocong_materials_list', '列出指定公司（或当前公司）的分类素材库', '/digital-human-studio/materials', {
    space: { name: 'space', description: '可选：公司 ID（可从 xiaocong_company_list 或 xiaocong_company_brief 获取），不传则查当前公司', optional: true },
  })
  registerGet('xiaocong_works_list', '列出指定公司（或当前公司）的成片库（导出成品、数字人视频、已写文案与封面）', '/digital-human-studio/history', {
    space: { name: 'space', description: '可选：公司 ID，不传则查当前公司', optional: true },
  })
  registerGet('xiaocong_company_list', '列出所有公司空间及每家公司的完整档案（brief：身份、主营卖点、受众、口吻、禁忌、品牌事实、痛点、证据、行动号召等）', '/digital-human-studio/spaces')
  registerGet('xiaocong_fonts', '列出可用字体及安装状态', '/digital-human-studio/fonts')
  registerGet('xiaocong_templates', '列出可用模板', '/digital-human-studio/templates')
  registerGet('xiaocong_recipes', '列出可用出片配方（recipes）', '/digital-human-studio/recipes')
  registerGet('xiaocong_engine_doctor', '剪辑引擎体检：Xiaocongcut 依赖、字体、Python 环境', '/digital-human-studio/engine/doctor', undefined, 120_000)
  registerGet('xiaocong_render_batch_status', '批量渲染队列状态', '/digital-human-studio/render_batch_status')
  registerGet('xiaocong_image_models', '列出可用生图模型', '/digital-human-studio/image/models')
  registerGet('xiaocong_digital_human_defaults', '数字人默认配置（模型/声音/形象）', '/digital-human-studio/digital-human/defaults')

  registerGet('xiaocong_project_load', '按名称载入一个工程到剪辑台', '/digital-human-studio/project', {
    name: { name: 'name', description: '工程名称（与 project_list 返回的一致）' },
  })
  registerGet('xiaocong_render_status', '查询渲染任务进度', '/digital-human-studio/render_status', {
    task_id: { name: 'task_id', description: '渲染任务 id（xiaocong_render 返回值）' },
  })
  registerGet('xiaocong_digital_human_task', '查询数字人任务进度', '/digital-human-studio/digital-human/task', {
    id: { name: 'id', description: '数字人任务 id' },
  })
  registerGet('xiaocong_image_task', '查询生图任务进度', '/digital-human-studio/image/task', {
    id: { name: 'id', description: '生图任务 id' },
  })
  registerGet('xiaocong_media_ingest_status', '查询素材采集任务（抖音链接下载）进度', '/digital-human-studio/media-ingest', {
    id: { name: 'id', description: '采集任务 id，缺省返回全部任务' },
  })
  registerGet('xiaocong_srt_export', '导出当前工程字幕为 SRT', '/digital-human-studio/srt_export')

  // ── Mutating tools ────────────────────────────────────────────────────────
  registerPost('xiaocong_trendy_koubo', '一键按「网感口播」模板（高级红 trendy_red / 黑金杂志 trendy_gold / 极简白青 trendy_cyan）直出 mp4：支持前 5 秒双行反色大标题、思源粗宋中英双语错落字幕、关键词放大厚描边、金句缩放、提示音与 BGM，返回 task_id', '/digital-human-studio/trendy_koubo', 300_000)
  registerPost('xiaocong_render', '发起一次渲染（按当前工程与参数出片），返回 task_id', '/digital-human-studio/render', 300_000)
  registerPost('xiaocong_render_cancel', '取消渲染任务', '/digital-human-studio/render_cancel')
  registerPost('xiaocong_transcribe', '对本地视频做语音转写生成字幕（词级时间轴）', '/digital-human-studio/transcribe', 300_000)
  registerPost('xiaocong_preview_range', '渲染指定时间区间的预览', '/digital-human-studio/preview_range', 300_000)
  registerPost('xiaocong_media_ingest', '采集外部视频素材（如抖音链接）入库', '/digital-human-studio/media-ingest', 300_000)
  registerPost('xiaocong_template_apply', '套用模板到当前工程', '/digital-human-studio/templates/apply', 120_000)
  registerPost('xiaocong_project_save', '保存当前工程', '/digital-human-studio/project/save')
  registerPost('xiaocong_project_saveas', '当前工程另存为新工程', '/digital-human-studio/project/saveas')

  server.registerTool('xiaocong_digital_human_create', {
    title: 'xiaocong_digital_human_create',
    description: '创建数字人口播任务（model 必须以 xdh- 开头，其余参数随 payload 转发）',
    inputSchema: {
      model: z.string().describe('数字人模型名，必须 xdh- 开头'),
      payload: z.record(z.string(), z.unknown()).describe('其余任务参数（文本/声音/形象等）'),
    },
  }, async (args) => {
    const payload = { ...((args?.payload ?? {}) as Record<string, unknown>), model: args?.model }
    try {
      return text(await post('/digital-human-studio/digital-human/create', payload, 120_000))
    } catch (error) {
      return text({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  server.registerTool('xiaocong_image_create', {
    title: 'xiaocong_image_create',
    description: '创建生图任务（参数随 payload 转发，如 model/prompt/size），返回任务 id',
    inputSchema: { payload: z.record(z.string(), z.unknown()).describe('生图参数对象') },
  }, async (args) => {
    try {
      return text(await post('/digital-human-studio/image/create', (args?.payload ?? {}) as Record<string, unknown>, 120_000))
    } catch (error) {
      return text({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  // ── Company & brief tools ─────────────────────────────────────────────────
  const resolveCompanySpace = async (idInput?: string, nameInput?: string, includeKnowledge = false) => {
    const raw = await get('/digital-human-studio/spaces', includeKnowledge ? { includeKnowledge: '1' } : undefined) as {
      success?: boolean
      currentId?: string
      spaces?: Array<{
        id: string
        name: string
        brief?: Record<string, unknown>
        preferredVoiceId?: string
        preferredMusic?: string
        knowledgeFiles?: string[]
        knowledgeSummary?: string
        [key: string]: unknown
      }>
    }
    const list = Array.isArray(raw?.spaces) ? raw.spaces : []
    const currentId = String(raw?.currentId || '')
    const id = String(idInput || '').trim()
    const queryName = String(nameInput || '').trim()
    let matched = id ? list.find(s => s.id === id) : undefined
    if (!matched && queryName) {
      matched = list.find(s => s.name === queryName)
        || list.find(s => s.name.toLowerCase().includes(queryName.toLowerCase()))
    }
    if (!matched && !id && !queryName) {
      matched = list.find(s => s.id === currentId) || list[0]
    }
    return { matched, currentId, list }
  }

  server.registerTool('xiaocong_company_brief', {
    title: 'xiaocong_company_brief',
    description: '读取某家公司的完整档案（含文案底稿：身份/卖点/受众/口吻/禁忌/品牌事实/痛点/证据/CTA/关键词/样稿，以及剪辑视听规范：画幅时长/剪辑节奏/字幕花字调色/声音BGM/固定片头片尾，外加偏好音色、BGM 与知识库资料摘要）。支持按公司 ID 或公司名查询；都不传则返回当前公司档案。写口播、写文案、剪辑前必调。',
    inputSchema: {
      id: z.string().optional().describe('可选：公司 ID（如 co-xxxx 或 default）'),
      name: z.string().optional().describe('可选：公司名称（支持精确或模糊匹配，如「测试公司」）'),
    },
  }, async (args) => {
    try {
      const { matched, currentId, list } = await resolveCompanySpace(args?.id, args?.name, true)
      if (!matched) {
        return text({
          success: false,
          error: `找不到匹配的公司（id=${args?.id || ''}, name=${args?.name || ''}）`,
          available: list.map(s => ({ id: s.id, name: s.name })),
        })
      }
      return text({
        success: true,
        id: matched.id,
        name: matched.name,
        isCurrent: matched.id === currentId,
        brief: matched.brief ?? {},
        preferredVoiceId: matched.preferredVoiceId || '',
        preferredMusic: matched.preferredMusic || '',
        knowledgeFiles: matched.knowledgeFiles ?? [],
        knowledgeSummary: matched.knowledgeSummary || '',
      })
    } catch (error) {
      return text({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  server.registerTool('xiaocong_company_select', {
    title: 'xiaocong_company_select',
    description: '切换 Xiaocongseek 当前活动的公司空间（传公司 ID 或公司名）。切换后素材库、成片库与剪辑均默认落到该公司。',
    inputSchema: {
      id: z.string().optional().describe('可选：公司 ID'),
      name: z.string().optional().describe('可选：公司名称（未传 id 时按名称匹配）'),
    },
  }, async (args) => {
    try {
      const { matched, list } = await resolveCompanySpace(args?.id, args?.name)
      if (!matched) {
        return text({
          success: false,
          error: `找不到匹配的公司（id=${args?.id || ''}, name=${args?.name || ''}）`,
          available: list.map(s => ({ id: s.id, name: s.name })),
        })
      }
      return text(await post('/digital-human-studio/spaces', { action: 'select', id: matched.id }))
    } catch (error) {
      return text({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  server.registerTool('xiaocong_company_brief_update', {
    title: 'xiaocong_company_brief_update',
    description: '更新指定公司（或当前公司）的档案字段（文案：identity/business/audience/brand/pains/proof/cta/voice/tone/avoid/keywords/sample；剪辑规范：videoFormat/editStyle/visualStyle/audioStyle/outroTemplate）。',
    inputSchema: {
      id: z.string().optional().describe('可选：公司 ID'),
      name: z.string().optional().describe('可选：公司名称（未传 id 时按名称匹配）'),
      brief: z.record(z.string(), z.unknown()).describe('要写入的档案字段对象（只需传要改的字段，会自动与现有档案合并）'),
    },
  }, async (args) => {
    try {
      const { matched, list } = await resolveCompanySpace(args?.id, args?.name)
      if (!matched) {
        return text({
          success: false,
          error: `找不到匹配的公司（id=${args?.id || ''}, name=${args?.name || ''}）`,
          available: list.map(s => ({ id: s.id, name: s.name })),
        })
      }
      const merged = { ...(matched.brief ?? {}), ...((args?.brief ?? {}) as Record<string, unknown>) }
      return text(await post('/digital-human-studio/spaces', { action: 'brief', id: matched.id, brief: merged }))
    } catch (error) {
      return text({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  return server
}

export function apply(ctx: Context): void {
  const state: XcyMcpState = { running: false, port: portFromEnv() }
  const transports = new Map<string, StreamableHTTPServerTransport>()

  // Cordis tracks service access per effect scope; tool handlers run later,
  // outside any scope. Capture the web server reference inside the same
  // effect scope that registers the shell routes (the pattern the auth
  // package uses), and read its port from the captured object afterwards.
  let shellWebServer: { readonly port: number | undefined } | null = null

  const status = (): XcyMcpStatus => ({
    success: true,
    running: state.running,
    port: state.port,
    url: `http://127.0.0.1:${String(state.port)}${MCP_PATH}`,
    serverName: SERVER_NAME,
    toolCount: 35,
    ...(state.error ? { error: state.error } : {}),
    agents: AGENT_SPECS.map(spec => readAgentState(spec, `http://127.0.0.1:${String(state.port)}${MCP_PATH}`)),
  })

  const register = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): void => {
    try {
      ctx.effect(() => {
        shellWebServer = ctx.webServer
        return ctx.webServer.register({ kind: 'exact', path, handler })
      }, `xiaocong-mcp: ${path}`)
    } catch (error) {
      ctx.logger.warn(`xiaocong-mcp: register ${path} failed (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  register(ROUTE.mcpStatus, (req, res) => {
    if (req.method !== 'GET') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    if (crossOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
    sendJson(res, 200, status())
  })

  register(ROUTE.mcpBind, async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    if (crossOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
    let body: { agent?: unknown; enabled?: unknown } = {}
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { agent?: unknown; enabled?: unknown }
    } catch {
      sendJson(res, 400, { success: false, error: '请求体必须是 JSON' })
      return
    }
    const agentKey = String(body.agent ?? '')
    const spec = AGENT_SPECS.find(item => item.key === agentKey)
    if (!spec) {
      sendJson(res, 400, { success: false, error: `未知的 Agent：${agentKey || '(空)'}` })
      return
    }
    const enabled = body.enabled === true
    const url = `http://127.0.0.1:${String(state.port)}${MCP_PATH}`
    const error = setAgentBound(spec, url, enabled)
    sendJson(res, error ? 500 : 200, { ...status(), lastWrite: { agent: agentKey, enabled, error: error ?? undefined } })
  })

  // ── The MCP listener itself ───────────────────────────────────────────────
  ctx.effect(() => {
    const server = createServer(async (req, res) => {
      const target = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (target.pathname !== MCP_PATH) { res.writeHead(404); res.end(); return }

      // Local-only: refuse cross-origin browser probes like the rest of the shell.
      if (req.headers.origin && crossOrigin(req)) { res.writeHead(403); res.end(); return }

      const sessionId = target.searchParams.get('sessionId')

      if (req.method === 'POST' || req.method === 'DELETE') {
        let transport = sessionId ? transports.get(sessionId) : undefined
        if (sessionId && !transport) {
          res.writeHead(400, { 'content-type': 'text/plain' })
          res.end('Invalid session ID')
          return
        }
        let parsedBody: unknown
        if (req.method === 'POST') {
          try {
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
            parsedBody = Buffer.concat(chunks).length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            res.writeHead(400, { 'content-type': 'text/plain' })
            res.end('Request body must be valid JSON')
            return
          }
        }
        if (!transport) {
          transport = new StreamableHTTPServerTransport({
            onsessioninitialized: (id) => {
              if (transport) transports.set(id, transport)
            },
          })
          // A stateless request owns its transport, so it owns a fresh McpServer
          // too: Protocol.connect rejects a second transport on one instance.
          const connectionServer = buildMcpServer(() => shellWebServer?.port)
          transport.onclose = () => {
            const id = transport?.sessionId
            if (id) transports.delete(id)
            void connectionServer.close().catch(() => undefined)
          }
          try {
            await (connectionServer as unknown as { connect(transport: unknown): Promise<void> }).connect(transport)
          } catch (error) {
            ctx.logger.warn(`xiaocong-mcp: connect failed (${error instanceof Error ? error.message : String(error)})`)
            res.writeHead(500, { 'content-type': 'text/plain' })
            res.end('MCP server connect failed')
            return
          }
        }
        try {
          await transport.handleRequest(req, res, parsedBody)
        } catch (error) {
          ctx.logger.warn(`xiaocong-mcp: handleRequest failed (${error instanceof Error ? error.message : String(error)})`)
          if (!res.headersSent) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('MCP request failed') }
          else res.end()
        }
        return
      }

      if (req.method === 'GET') {
        // No server-initiated notifications in this build: SSE GET is not offered.
        res.writeHead(405, { 'content-type': 'text/plain' })
        res.end('SSE stream not supported; use POST')
        return
      }

      res.writeHead(405, { 'content-type': 'text/plain' })
      res.end('Method not allowed')
    })

    server.on('error', (error: NodeJS.ErrnoException) => {
      const message = error.code === 'EADDRINUSE'
        ? `端口 ${String(state.port)} 已被占用，可在启动时用 XIAOCONG_MCP_PORT 换一个`
        : (error.message || String(error))
      state.running = false
      state.error = message
      ctx.logger.warn(`xiaocong-mcp: listener error (${message})`)
    })

    server.listen(state.port, '127.0.0.1', () => {
      state.running = true
      delete state.error
      ctx.logger.info(`xiaocong-mcp: MCP 服务已就绪 http://127.0.0.1:${String(state.port)}${MCP_PATH}`)
    })

    return async () => {
      state.running = false
      await Promise.all([...transports.values()].map(transport => transport.close().catch(() => undefined)))
      transports.clear()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    }
  }, 'xiaocong-mcp: streamable http server')
}
