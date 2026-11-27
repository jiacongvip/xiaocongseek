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
import { randomBytes } from 'node:crypto'
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
const MCP_BRIDGE_TOKEN_SYMBOL = Symbol.for('xiaocong.mcp.bridgeToken')

function ensureBridgeToken(): string {
  const store = globalThis as Record<symbol, unknown>
  const existing = store[MCP_BRIDGE_TOKEN_SYMBOL]
  if (typeof existing === 'string' && existing.length >= 32) return existing
  const token = randomBytes(32).toString('hex')
  store[MCP_BRIDGE_TOKEN_SYMBOL] = token
  return token
}

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
function buildMcpServer(shellPort: () => number | undefined, bridgeToken: string): { server: McpServer; toolCount: number } {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
  let toolCount = 0

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
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'x-xiaocong-mcp-bridge': bridgeToken },
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.json() as Promise<unknown>
  }

  const post = async (path: string, body: Record<string, unknown>, timeoutMs = 60_000) => {
    const response = await fetch(`${bridge()}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-xiaocong-mcp-bridge': bridgeToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.json() as Promise<unknown>
  }

  const addTool = <T extends Record<string, z.ZodTypeAny>>(
    tool: string,
    config: { title: string; description: string; inputSchema: T },
    handler: (args: { [K in keyof T]: z.infer<T[K]> }) => Promise<{ content: { type: 'text'; text: string }[] }>,
  ) => {
    toolCount += 1
    server.registerTool(tool, config, handler as never)
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
    addTool(tool, { title: tool, description, inputSchema: shape }, async (args) => {
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
    addTool(tool, {
      title: tool,
      description,
      inputSchema: { payload: z.record(z.string(), z.unknown()).optional().describe('转发给接口的 JSON 参数对象（无参接口可省略）') },
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

  addTool('xiaocong_digital_human_create', {
    title: 'xiaocong_digital_human_create',
    description: '创建数字人视频/音频/克隆任务（model 必须以 xdh- 开头，如 xdh-avatar-video / xdh-audio / xdh-avatar-clone / xdh-voice-clone，其余参数随 payload 转发）',
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

  addTool('xiaocong_image_create', {
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

  // ── Voice / TTS / Audio / Digital Human / Upload ──────────────────────────
  registerGet('xiaocong_voices_list', '列出全部可用配音音色（内置风格预设：热心老板/避坑提醒/稳重师傅/带看效果 + 已克隆音色 + 当前公司偏好音色）', '/digital-human-studio/voices', {
    space: { name: 'space', description: '可选：公司 ID，不传则查当前公司', optional: true },
  })

  addTool('xiaocong_tts', {
    title: 'xiaocong_tts',
    description: '文字转配音（TTS）：传文案与音色（支持预设名如 warm_boss / 热心老板 / 避坑提醒 / 稳重师傅，或已克隆音色名/ID，支持自定义语气 instruction），直接合成 mp3 下载到本地并返回路径、公网音频地址与时长',
    inputSchema: {
      text: z.string().describe('要合成配音的口播文案'),
      voice: z.string().optional().describe('可选：预设音色或克隆音色名/ID（如 warm_boss / 热心老板），不传用当前公司默认音色或热心老板'),
      voice_id: z.string().optional().describe('可选：直接指定底层 voice_id'),
      instruction: z.string().optional().describe('可选：语气与情绪指令（如「语速稍快、像实体店老板热情介绍」）'),
      language: z.string().optional().describe('可选：语言代码，默认 zh'),
      space: z.string().optional().describe('可选：公司 ID，音频落在该公司目录'),
    },
  }, async (args) => {
    try {
      return text(await post('/digital-human-studio/tts', (args ?? {}) as Record<string, unknown>, 120_000))
    } catch (error) {
      return text({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  registerGet('xiaocong_digital_human_resources', '列出所有已克隆的数字人形象（avatars）与音色（voices）资源库，供生成视频/配音选择', '/digital-human-studio/digital-human/resources')

  addTool('xiaocong_digital_human_speak', {
    title: 'xiaocong_digital_human_speak',
    description: '一句话直出数字人口播视频：自动使用默认形象与默认音色生成配音并驱动数字人，一步返回任务与视频结果',
    inputSchema: {
      text: z.string().describe('口播文案内容'),
    },
  }, async (args) => {
    try {
      return text(await post('/digital-human-studio/digital-human/speak', { text: args?.text ?? '' }, 180_000))
    } catch (error) {
      return text({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  registerGet('xiaocong_music_list', '列出本机内置 BGM 垫乐库与剪辑引擎可用背景音乐路径', '/digital-human-studio/music', {
    space: { name: 'space', description: '可选：公司 ID', optional: true },
  })
  registerGet('xiaocong_sfx_list', '列出本机可用音效库（转场/提示音/强调音等）及其本地路径', '/digital-human-studio/sfx')
  registerGet('xiaocong_style_library', '查询数字人形象换装公共造型风格库', '/digital-human-studio/style-library')

  addTool('xiaocong_upload_local', {
    title: 'xiaocong_upload_local',
    description: '把本机图片/音频/视频文件上传到公网对象存储，返回公网 HTTPS URL（克隆形象/音色或图生图前使用）',
    inputSchema: {
      path: z.string().describe('本机文件绝对路径（支持 png/jpg/webp/mp3/wav/m4a/mp4/mov 等，最大 200MB）'),
    },
  }, async (args) => {
    try {
      return text(await post('/digital-human-studio/upload/local', { path: args?.path ?? '' }, 120_000))
    } catch (error) {
      return text({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  // ── Engine / Batch Render / QC / Matte / Drafts / Maintenance ─────────────
  registerPost('xiaocong_engine_start', '启动本机 Xiaocongcut 剪辑引擎（若离线时调用）', '/digital-human-studio/engine_start', 60_000)
  registerPost('xiaocong_engine_stop', '停止本机 Xiaocongcut 剪辑引擎', '/digital-human-studio/engine_stop')
  registerPost('xiaocong_render_batch', '提交批量渲染队列（多条配方一次排队出片），配合 xiaocong_render_batch_status 查进度', '/digital-human-studio/render_batch', 300_000)
  registerPost('xiaocong_qc_video', '对成片做自动质检（检测黑帧、静音、音画异常、时长等）', '/digital-human-studio/qc', 120_000)
  registerPost('xiaocong_matte_webm', '对人物视频做自动人像抠图，导出带透明通道的 WebM', '/digital-human-studio/matte_webm', 300_000)
  registerPost('xiaocong_template_save', '把指定配方保存为可复用剪辑模板（payload 含 name、recipe）', '/digital-human-studio/templates/save')
  registerGet('xiaocong_pack_options', '查询剪辑引擎支持的字幕样式、LUT 调色滤镜、贴图与 BGM 选项', '/digital-human-studio/pack_options')
  registerGet('xiaocong_draft_list', '列出本机剪映草稿目录中的所有草稿', '/digital-human-studio/list_drafts')
  registerPost('xiaocong_draft_create', '新建一个剪映草稿（payload 可传 width/height/fps）', '/digital-human-studio/create_draft')
  registerPost('xiaocong_draft_save', '保存剪映草稿到目标目录（payload 含 draft_id、draft_folder）', '/digital-human-studio/save_draft', 120_000)
  registerPost('xiaocong_fonts_install', '按文件名下载并安装扩展字体（payload 含 file，文件名从 xiaocong_fonts 获取）', '/digital-human-studio/fonts/install', 180_000)
  registerPost('xiaocong_cache_clean', '清理本机剪辑渲染与转写缓存（payload 可传 max_gb / max_age_days / dry_run）', '/digital-human-studio/cache_clean')

  // ── Works Copy / Cover / Import ───────────────────────────────────────────
  registerPost('xiaocong_work_copy', '为成片一键生成抖音/小红书/视频号多平台标题、正文与话题标签（payload 含 id、space?、platforms?）', '/digital-human-studio/works/copy', 120_000)
  registerPost('xiaocong_work_copy_revise', '按指令修改成片已生成的文案（payload 含 id、instruction、space?、platform?）', '/digital-human-studio/works/copy/revise', 120_000)
  registerPost('xiaocong_work_cover', '为成片 AI 生成或重画封面图（payload 含 id、space?、prompt?）', '/digital-human-studio/works/copy/cover', 180_000)
  registerPost('xiaocong_work_cover_frame', '从成片指定秒数抽帧作为封面（payload 含 id、at 秒数、apply 是否落库、space?）', '/digital-human-studio/works/cover-frame', 60_000)
  registerPost('xiaocong_work_cover_text', '保存带花字的成片封面图（payload 含 id、image dataURL、space?）', '/digital-human-studio/works/cover-text', 60_000)

  addTool('xiaocong_work_import', {
    title: 'xiaocong_work_import',
    description: '将本机已剪好的 mp4 视频导入指定公司的成片库，导入后可继续生成文案、封面、排期或一键发布',
    inputSchema: {
      path: z.string().describe('本机 mp4 视频绝对路径'),
      space: z.string().optional().describe('可选：目标公司 ID，不传导入当前公司'),
      name: z.string().optional().describe('可选：成片文件名或标题'),
    },
  }, async (args) => {
    try {
      return text(await post('/digital-human-studio/works/import', (args ?? {}) as Record<string, unknown>, 120_000))
    } catch (error) {
      return text({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  // ── Hotboard / Platform Crawl / Wordcloud / Monitor / Retro Review ────────
  registerGet('xiaocong_hotboard', '查询当前公司的行业热榜与选题推荐', '/digital-human-studio/industry-hotboard', {
    space: { name: 'space', description: '可选：公司 ID', optional: true },
  }, 120_000)
  registerPost('xiaocong_platform_media', '通过 MediaCrawler 发起社媒平台关键词搜索或对标视频采集（抖音/小红书等，payload 含 action/platform/keywords/space?）', '/digital-human-studio/platform-media', 180_000)
  registerGet('xiaocong_platform_media_status', '查询社媒采集任务列表或单条采集进度', '/digital-human-studio/platform-media', {
    space: { name: 'space', description: '可选：公司 ID', optional: true },
    id: { name: 'id', description: '可选：采集任务 id', optional: true },
  })
  registerPost('xiaocong_comment_wordcloud', '对采集到的评论数据生成高频词云与用户痛点分析', '/digital-human-studio/comment-wordcloud', 180_000)
  registerGet('xiaocong_account_monitor', '读取账号发布核对与作品互动监控数据', '/digital-human-studio/account-monitor', {
    space: { name: 'space', description: '可选：公司 ID', optional: true },
    account: { name: 'account', description: '可选：账号 bindingId', optional: true },
    sync: { name: 'sync', description: '可选：传 1 触发同步刷新', optional: true },
  }, 120_000)
  registerGet('xiaocong_retro_review', '读取公司运营复盘报告与作品互动统计', '/digital-human-studio/retro-review', {
    space: { name: 'space', description: '可选：公司 ID', optional: true },
  }, 120_000)

  // ── Publishing Accounts / Calendar / Packs / Publish Now ──────────────────
  registerGet('xiaocong_accounts_list', '查询公司已授权的发布平台账号（抖音/小红书/视频号/快手）及发布任务总览', '/digital-human-studio/publication-management', {
    space: { name: 'space', description: '可选：公司 ID', optional: true },
    action: { name: 'action', description: '可选：overview（默认）/ tasks.list / tasks.get / pack.list / calendar.list', optional: true },
    id: { name: 'id', description: '可选：查询单条 task/pack 时的 id', optional: true },
  })
  registerGet('xiaocong_publish_calendar_list', '查询公司的发布日历排期列表及可排期成片', '/digital-human-studio/publish-calendar', {
    space: { name: 'space', description: '可选：公司 ID', optional: true },
  })
  registerPost('xiaocong_publish_calendar_update', '新增、修改或删除发布日历排期（payload 含 action: upsert/delete、space?、item 或 id）', '/digital-human-studio/publish-calendar')
  registerGet('xiaocong_publish_packs_list', '查询公司的发布包列表', '/digital-human-studio/publish-packs', {
    space: { name: 'space', description: '可选：公司 ID', optional: true },
  })
  registerPost('xiaocong_publish_packs_action', '保存、核查或删除发布包（payload 含 action: save/check/delete、space?、item/id/revision）', '/digital-human-studio/publish-packs')
  registerPost('xiaocong_publish_now', '查询可发账号或一键立即发布排期成片到抖音/小红书/视频号（payload 含 action: accounts/fire/tasks/retry、space?、planId、bindingIds、showBrowser?）', '/digital-human-studio/publish-now', 120_000)

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

  addTool('xiaocong_company_brief', {
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

  addTool('xiaocong_company_select', {
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

  addTool('xiaocong_company_brief_update', {
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

  return { server, toolCount }
}

export function apply(ctx: Context): void {
  const bridgeToken = ensureBridgeToken()
  const advertisedToolCount = buildMcpServer(() => undefined, bridgeToken).toolCount
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
    toolCount: advertisedToolCount,
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
          const { server: connectionServer } = buildMcpServer(() => shellWebServer?.port, bridgeToken)
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
