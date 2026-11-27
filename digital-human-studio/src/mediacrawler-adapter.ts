/**
 * MediaCrawler documented-CLI adapter for digital-human-studio.
 * - Does NOT copy MediaCrawler sources; invokes local documented CLI only.
 * - Production default runner = live (real spawn). Fake ONLY via explicit DI in tests.
 * - No dual env gates required for users; paths come from plugin StudioConfig (+ detectable local candidate).
 * - Never reads publish-studio cookies; never passes --cookies on argv.
 * - Reuses original MediaCrawler saved login (browser_data + .douyin_cookies.txt) via sidecar.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { venvPythonCandidates } from './platform.js'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { addStudioMaterial, isDownloadSidecarCover, isMaterialSlot, type MaterialSlot, type StudioMaterial } from './studio-materials.js'
import { isSpaceId, spaceAssetRoot } from './spaces.js'

/** Legacy detectable default (this desktop only). The bundled vendor copy takes precedence. */
export const DETECTABLE_MC_ROOT = '/Users/jiacong/Desktop/开发文件/MediaCrawler'

/** Root candidates: vendored copy inside the plugin first. The legacy desktop checkout is only listed when it exists. */
export function mcRootCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url))
  const list = [
    resolve(here, '../vendor/media-crawler'),
    resolve(here, '../../vendor/media-crawler'),
  ]
  if (existsSync(DETECTABLE_MC_ROOT)) list.push(resolve(DETECTABLE_MC_ROOT))
  return list.filter((p, i) => list.indexOf(p) === i)
}

/** Python candidates for a MediaCrawler root: root/.venv first, then the sibling vendor venv. */
export function mcPythonCandidates(root: string): string[] {
  return [
    ...venvPythonCandidates(root),
    ...venvPythonCandidates(resolve(root, '..')),
  ]
}

export function normalizeBrowserMode(raw: unknown): MediaCrawlerBrowserMode {
  const v = String(raw || 'standard').trim().toLowerCase()
  if (v === 'cdp_existing' || v === 'cdp' || v === 'connect_existing' || v === 'existing') return 'cdp_existing'
  if (v === 'cdp_launch' || v === 'cdp_new' || v === 'launch') return 'cdp_launch'
  return 'standard'
}

export function normalizeCdpPort(raw: unknown, fallback = 9222): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return fallback
  // Do not invent alternate debug ports; only 9222 (authorized existing) or explicit same fallback.
  if (Math.floor(n) !== 9222) return fallback
  return 9222
}

export function mediacrawlerRunnerScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '../tools/mediacrawler-runner/run_mc_main.py'),
    resolve(here, '../../tools/mediacrawler-runner/run_mc_main.py'),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return candidates[0]
}

export function browserModeEnv(mode: MediaCrawlerBrowserMode, cdpPort: number, mcRoot: string): Record<string, string> {
  return {
    DH_MC_BROWSER_MODE: mode,
    DH_MC_CDP_PORT: String(cdpPort),
    DH_MC_ROOT: mcRoot,
  }
}


export type McPlatform = 'xhs' | 'dy' | 'ks' | 'bili' | 'wb' | 'tieba' | 'zhihu'
export type LoginPhase = 'not_prepared' | 'needs_setup' | 'needs_login' | 'running' | 'failed' | 'ready'
export type McTaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'needs_setup'
  | 'needs_login'
  | 'cancelled'

export type MediaCrawlerBrowserMode = 'standard' | 'cdp_existing' | 'cdp_launch'

export type MediaCrawlerRuntimeConfig = {
  /** Absolute MediaCrawler project root containing main.py */
  mediaCrawlerRoot: string
  /** Absolute python interpreter (usually <root>/.venv/Scripts/python.exe on Windows, .venv/bin/python elsewhere) */
  mediaCrawlerPython: string
  /** CLI timeout ms */
  mediaCrawlerTimeoutMs: number
  /** When false, tools return needs_setup even if paths detect */
  mediaCrawlerEnabled: boolean
  /** Process-scoped MC browser mode via plugin sidecar (does not edit MC base_config). */
  mediaCrawlerBrowserMode?: MediaCrawlerBrowserMode
  /** Existing Chrome debug port only (default 9222); never expand/launch new debug ports. */
  mediaCrawlerCdpPort?: number
}

export type ParsedMediaLink = {
  platform: McPlatform
  specifiedId: string
  mediaDownloadSupported: boolean
  host: string
}

export type McCliPlan = {
  cwd: string
  bin: string
  argv: string[]
  saveDataPath: string
  platform: McPlatform
  specifiedId: string
  timeoutMs: number
  /** detail = link download; search = keyword search (NOT platform hot-board). */
  mode?: 'detail' | 'search'
  keywords?: string
  browserMode?: MediaCrawlerBrowserMode
  cdpPort?: number
}

export type KeywordSearchHit = {
  awemeId?: string
  title?: string
  url?: string
  likedCount?: string
  commentCount?: string
  shareCount?: string
  collectedCount?: string
  nickname?: string
  createTime?: string | number
  sourceKeyword?: string
  /** Always keyword_search — never claim platform hot-board. */
  sourceKind: 'keyword_search'
}

/**
 * Local sample metrics from keyword-search hits already on disk/API.
 * NOT MediaCrawler wordcloud (needs comments + ENABLE_GET_WORDCLOUD).
 * NOT platform hot-board / realtime trends. Honest plugin-side aggregation.
 */
export type KeywordSearchSampleAnalysis = {
  kind: 'keyword_search_sample_metrics'
  implementation: 'plugin_local_aggregate'
  reusedMediaCrawlerModule: false
  notHotBoard: true
  notRealtimeTrend: true
  keywords?: string
  sampleSize: number
  collectedAt?: number
  totals: {
    liked: number
    comment: number
    share: number
    collected: number
  }
  /** Ranked by liked+comment+share+collected (sample engagement proxy). */
  topByEngagement: Array<{
    rank: number
    title?: string
    url?: string
    awemeId?: string
    likedCount?: string
    commentCount?: string
    shareCount?: string
    collectedCount?: string
    engagementScore: number
  }>
  missingForMcWordcloud: {
    availableInMediaCrawler: true
    wiredInPlugin: false
    requiresComments: true
    requiresEnableGetWordcloud: true
    reason: string
  }
}

function parseCount(v: unknown): number {
  if (v == null || v === '') return 0
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

export function summarizeKeywordSearchSample(
  hits: KeywordSearchHit[] | undefined,
  opts?: { keywords?: string; collectedAt?: number },
): KeywordSearchSampleAnalysis | null {
  const list = Array.isArray(hits) ? hits.slice(0, 10) : []
  if (!list.length) return null
  const totals = { liked: 0, comment: 0, share: 0, collected: 0 }
  const scored = list.map((h) => {
    const liked = parseCount(h.likedCount)
    const comment = parseCount(h.commentCount)
    const share = parseCount(h.shareCount)
    const collected = parseCount(h.collectedCount)
    totals.liked += liked
    totals.comment += comment
    totals.share += share
    totals.collected += collected
    return {
      title: h.title,
      url: h.url,
      awemeId: h.awemeId,
      likedCount: h.likedCount,
      commentCount: h.commentCount,
      shareCount: h.shareCount,
      collectedCount: h.collectedCount,
      engagementScore: liked + comment + share + collected,
    }
  })
  scored.sort((a, b) => b.engagementScore - a.engagementScore)
  return {
    kind: 'keyword_search_sample_metrics',
    implementation: 'plugin_local_aggregate',
    reusedMediaCrawlerModule: false,
    notHotBoard: true,
    notRealtimeTrend: true,
    keywords: opts?.keywords,
    sampleSize: list.length,
    collectedAt: opts?.collectedAt,
    totals,
    topByEngagement: scored.slice(0, 5).map((row, i) => ({ rank: i + 1, ...row })),
    missingForMcWordcloud: {
      availableInMediaCrawler: true,
      wiredInPlugin: false,
      requiresComments: true,
      requiresEnableGetWordcloud: true,
      reason:
        'MC 词云在 tools/words.py + async_file_writer.generate_wordcloud_from_comments；需 ENABLE_GET_COMMENT 与 ENABLE_GET_WORDCLOUD，且 json/jsonl 评论落盘。当前关键词搜索 get_comment=false，无评论数据，故不调用词云、不假装分析成功。',
    },
  }
}

export type McTask = {
  id: string
  spaceId: string
  slot: MaterialSlot
  source: string
  platform?: McPlatform
  status: McTaskStatus
  loginPhase: LoginPhase
  runner: 'live' | 'injected'
  createdAt: number
  updatedAt: number
  argv?: string[]
  cwd?: string
  saveDataPath?: string
  exitCode?: number | null
  stdoutTail?: string
  stderrTail?: string
  error?: string
  code?: string
  /** Short sanitized CLI/diagnostic excerpt for UI (no secrets/home paths). */
  detail?: string
  /** User-facing next action. */
  nextStep?: string
  materials?: StudioMaterial[]
  mediaFiles?: string[]
  note?: string
  loginHint?: string
  mock?: boolean
  mode?: 'detail' | 'search'
  keywords?: string
  /** Keyword-search metadata rows (no media import). */
  searchHits?: KeywordSearchHit[]
  /** Plugin-local sample metrics (not MC wordcloud / not hot board). */
  searchSampleAnalysis?: KeywordSearchSampleAnalysis | null
  collectedAt?: number
  /** Honest label for UI: keyword_search | detail_download — never hot_board. */
  sourceKind?: 'keyword_search' | 'detail_download'
  browserMode?: MediaCrawlerBrowserMode
  cdpPort?: number
  pongSkippedLogin?: boolean
}

export type RunCliResult = {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  cancelled?: boolean
  mock: boolean
  loginSeen?: boolean
}

export type CliRunner = (plan: McCliPlan, ctx: { taskId: string; onLog?: (chunk: string, stream: 'stdout' | 'stderr') => void }) => Promise<RunCliResult>

const MEDIA_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.mov', '.m4v', '.webm'])
const MAX_IMPORT_BYTES = 200 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 300_000

const LOGIN_HINT =
  '使用原版 MediaCrawler 已保存的登录（.douyin_cookies.txt / browser_data）。和账号页发布登录不是同一套。只有这份登录缺失时才会扫码。'

/** QR / interactive login wait — not cookie inject. `Begin login ... by cookie` is success path. */
const LOGIN_LOG_RE =
  /login_by_qrcode|Begin login .{0,80} by qrcode|请确认扫码|扫码已完成|animate_qrcode|login-panel-new|qrcode not found|Waiting for login|waiting login|login state invalid|仍未登录/i
const COOKIE_LOGIN_LOG_RE =
  /login_by_cookies|Begin login .{0,80} by cookie|saved cookie login/i

const DETAIL_MAX = 900

/** Redact secrets and absolute home paths before persisting/returning CLI logs. */
export function sanitizeCliLog(raw: string, max = DETAIL_MAX): string {
  let s = String(raw || '')
  s = s.replace(/\r/g, '')
  s = s.replace(/(cookie|cookies|authorization|token|session|password|passwd|secret)\s*[=:]\s*\S+/gi, '$1=<redacted>')
  s = s.replace(/Bearer\s+[A-Za-z0-9._\-+=/]+/gi, 'Bearer <redacted>')
  // macOS/Linux home paths
  s = s.replace(/\/Users\/[^/\s]+/g, '~')
  s = s.replace(/\/home\/[^/\s]+/g, '~')
  // Windows-ish
  s = s.replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '~')
  // collapse long absolute MediaCrawler internals already home-redacted
  if (s.length > max) s = s.slice(-max)
  return s.trim()
}

export type CliFailureClass = {
  code: string
  error: string
  nextStep: string
  detail: string
  status: McTaskStatus
  loginPhase: LoginPhase
}

/**
 * Distinctive log classifiers. Returns null when logs do not match a known category.
 * Evidence notes (Douyin client.py): empty body OR literal "blocked" → raises Exception("account blocked").
 * That string is MediaCrawler's own mapping, not proof the platform permanently banned an account.
 */
export function classifyCliLogs(input: {
  exitCode?: number | null
  stdout?: string
  stderr?: string
  loginSeen?: boolean
}): CliFailureClass | null {
  const exitCode = input.exitCode
  const blob = `${input.stderr || ''}\n${input.stdout || ''}`
  if (!blob.trim()) return null
  const detail = sanitizeCliLog(blob)

  if (/Executable doesn't exist|playwright install|Please run the following command to download new browsers/i.test(blob)) {
    return {
      code: 'playwright_browser_missing',
      error: 'Playwright 浏览器未安装（Chromium 可执行文件不存在）',
      nextStep:
        '在 MediaCrawler 目录用它的 .venv 解释器执行：python -m playwright install chromium（需本机联网下载，插件不会代装）。装好后重试下载。',
      detail,
      status: 'failed',
      loginPhase: 'failed',
    }
  }
  if (/ModuleNotFoundError|No module named/i.test(blob)) {
    const m = blob.match(/No module named ['"]?([\w.]+)/)
    const mod = m?.[1] || '依赖包'
    return {
      code: 'python_dep_missing',
      error: `MediaCrawler Python 缺少依赖：${mod}`,
      nextStep: '在 MediaCrawler 的 .venv 中按项目文档安装依赖后重试（插件不代装包）。',
      detail,
      status: 'failed',
      loginPhase: 'failed',
    }
  }
  if (/libs\/douyin\.js|FileNotFoundError:.*libs\//i.test(blob)) {
    return {
      code: 'mc_cwd_or_assets_missing',
      error: 'MediaCrawler 资源/工作目录异常（缺少 libs 脚本）',
      nextStep: '确认插件指向完整 MediaCrawler 根目录（含 main.py 与 libs/），且 CLI cwd 为该根目录。',
      detail,
      status: 'failed',
      loginPhase: 'failed',
    }
  }
  if (/uv: command not found|No such file or directory:.*python/i.test(blob) && /spawn|ENOENT/i.test(blob)) {
    return {
      code: 'python_bin_missing',
      error: 'Python 解释器路径无效',
      nextStep: '在插件设置中填写可用的 mediaCrawlerPython（通常是 MediaCrawler 的 .venv 解释器：Windows 在 .venv\\Scripts\\python.exe，mac 在 .venv/bin/python）。',
      detail,
      status: 'needs_setup',
      loginPhase: 'needs_setup',
    }
  }

  // Platform restricted / anti-bot — BEFORE login guess.
  // MC Douyin client: if response.text == "" or response.text == "blocked": raise Exception("account blocked")
  if (
    /account blocked/i.test(blob) ||
    /request params incrr/i.test(blob) ||
    (/response\.text:\s*blocked\b/i.test(blob) && /incrr|blocked/i.test(blob))
  ) {
    return {
      code: 'platform_restricted',
      error:
        '上游详情接口返回空正文或字面 "blocked"；MediaCrawler 将其映射为 account blocked（工具通用文案，不等于已证实平台永久封号）',
      nextStep:
        '请停止在本页自动重试/扫码绕过。请到抖音官方页面自行打开该链接确认是否可播；若官方也不可用或提示异常，以官方为准。发布已保存账号与下载互不共享，不能用来绕过此限制。',
      detail,
      status: 'failed',
      loginPhase: 'failed',
    }
  }
  if (/验证码|captcha|滑块|risk_control|风控|访问太频繁|too many requests|rate.?limit/i.test(blob)) {
    return {
      code: 'platform_restricted',
      error: '日志出现验证码/风控/频控类提示（需人工在官方侧确认，插件不会自动重试）',
      nextStep: '停止自动重试；请在官方 App/网页自行确认该内容与账号状态后再决定是否继续。',
      detail,
      status: 'failed',
      loginPhase: 'failed',
    }
  }

  // Search/API explicitly demands login — even if pong skipped qrcode (pong ≠ search auth).
  if (
    /status_code['\"]?\s*[:=]\s*2483\b/.test(blob) ||
    /status_code\D+2483\b/.test(blob) ||
    /请先登录，再继续搜索/.test(blob) ||
    /请先登录/.test(blob) && /search/i.test(blob)
  ) {
    return {
      code: 'needs_login',
      error: '抖音搜索需要登录。请用原版 MediaCrawler 已保存的登录后再刷新。',
      nextStep: '不要开日常浏览器。账号页的发布登录不能共用。',
      detail,
      status: 'needs_login',
      loginPhase: 'needs_login',
    }
  }

  // Cookie inject logs "Begin login ... by cookie"; that is not a QR wait.
  if (COOKIE_LOGIN_LOG_RE.test(blob) && !LOGIN_LOG_RE.test(blob) && !input.loginSeen) {
    return null
  }

  // Skip-login alone is not "logged in for search"; 2483 handled above.
  // Only treat qrcode-wait signals as needs_login when skip-login did NOT happen,
  // OR when loginSeen during an actual qrcode attempt.
  const skippedLogin = /pong=True,\s*skip login/i.test(blob)
  const loginLike =
    (!!input.loginSeen || LOGIN_LOG_RE.test(blob) || /仍未登录|请确认扫码|login_by_qrcode/i.test(blob)) &&
    (!skippedLogin || !!input.loginSeen) &&
    !(COOKIE_LOGIN_LOG_RE.test(blob) && !LOGIN_LOG_RE.test(blob))
  if (loginLike) {
    return {
      code: 'needs_login',
      error: `登录未完成或失败${exitCode != null ? `（exit ${exitCode}）` : ''}。${LOGIN_HINT}`,
      nextStep: '仅在 MediaCrawler 窗口明确要求登录时扫码；不要用发布侧已保存账号代替，二者未互通。',
      detail,
      status: 'needs_login',
      loginPhase: 'needs_login',
    }
  }
  return null
}

/** Map non-zero CLI exit (+ logs) to actionable categories. Prefer evidence over guessing login. */
export function classifyCliFailure(input: {
  exitCode: number | null | undefined
  stdout?: string
  stderr?: string
  loginSeen?: boolean
}): CliFailureClass {
  const exitCode = input.exitCode ?? 1
  const hit = classifyCliLogs(input)
  if (hit) return hit
  const blob = `${input.stderr || ''}\n${input.stdout || ''}`
  const detail = sanitizeCliLog(blob)
  const errLine =
    [...blob.split('\n')].reverse().find((l) => /Error:|Exception|Traceback/i.test(l)) ||
    `CLI 退出码 ${exitCode}`
  return {
    code: `cli_exit_${exitCode}`,
    error: sanitizeCliLog(errLine, 220) || `CLI 退出码 ${exitCode}`,
    nextStep: '查看下方诊断摘录；若仍失败，把脱敏后的原因发回排查（不要粘贴 cookies/二维码）。',
    detail,
    status: 'failed',
    loginPhase: 'failed',
  }
}

type PlatformRule = { platform: McPlatform; media: boolean; hosts: RegExp[] }

const PLATFORM_RULES: PlatformRule[] = [
  { platform: 'xhs', media: true, hosts: [/(^|\.)xiaohongshu\.com$/i, /(^|\.)xhslink\.com$/i] },
  { platform: 'dy', media: true, hosts: [/(^|\.)douyin\.com$/i, /(^|\.)iesdouyin\.com$/i, /(^|\.)v\.douyin\.com$/i] },
  { platform: 'ks', media: true, hosts: [/(^|\.)kuaishou\.com$/i, /(^|\.)gifshow\.com$/i, /(^|\.)v\.kuaishou\.com$/i] },
  { platform: 'bili', media: true, hosts: [/(^|\.)bilibili\.com$/i, /(^|\.)b23\.tv$/i] },
  { platform: 'wb', media: true, hosts: [/(^|\.)weibo\.com$/i, /(^|\.)weibo\.cn$/i] },
  { platform: 'tieba', media: false, hosts: [/(^|\.)tieba\.baidu\.com$/i] },
  { platform: 'zhihu', media: false, hosts: [/(^|\.)zhihu\.com$/i] },
]

const runningChildren = new Map<string, ChildProcess>()

function jobsRoot(spaceId: string): string {
  return join(spaceAssetRoot(spaceId), 'mediacrawler-jobs')
}

function tasksFile(spaceId: string): string {
  return join(jobsRoot(spaceId), 'tasks.json')
}

function loadTasks(spaceId: string): McTask[] {
  const file = tasksFile(spaceId)
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveTasks(spaceId: string, tasks: McTask[]) {
  mkdirSync(jobsRoot(spaceId), { recursive: true })
  writeFileSync(tasksFile(spaceId), JSON.stringify(tasks.slice(0, 80), null, 2), 'utf8')
}

function upsertTask(spaceId: string, task: McTask) {
  const rows = loadTasks(spaceId).filter((t) => t.id !== task.id)
  rows.unshift(task)
  saveTasks(spaceId, rows)
}

export function listMcTasks(spaceId: string, limit = 20): McTask[] {
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  return loadTasks(spaceId)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.min(50, limit)))
}

export function getMcTask(spaceId: string, id: string): McTask | undefined {
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  return loadTasks(spaceId).find((t) => t.id === id)
}

export function emptyMediaCrawlerConfig(): MediaCrawlerRuntimeConfig {
  return {
    mediaCrawlerRoot: '',
    mediaCrawlerPython: '',
    mediaCrawlerTimeoutMs: DEFAULT_TIMEOUT_MS,
    mediaCrawlerEnabled: true,
    mediaCrawlerBrowserMode: 'standard',
    mediaCrawlerCdpPort: 9222,
  }
}

function detectFirstCandidateRoot(): string {
  return mcRootCandidates()[0]
}

/** First existing root that actually contains main.py. */
export function defaultMcRoot(): string {
  for (const root of mcRootCandidates()) {
    if (existsSync(join(root, 'main.py'))) return root
  }
  return mcRootCandidates()[0]
}

export function detectMediaCrawlerCandidate(): { root: string; python: string } | null {
  for (const root of mcRootCandidates()) {
    if (!existsSync(join(root, 'main.py'))) continue
    for (const py of mcPythonCandidates(root)) {
      if (existsSync(py)) return { root, python: py }
    }
    return { root, python: '' }
  }
  return null
}

/** Merge plugin config with detectable desktop candidate (does not write profile). */
export function resolveRuntimeConfig(partial?: Partial<MediaCrawlerRuntimeConfig>): {
  config: MediaCrawlerRuntimeConfig
  source: 'plugin' | 'detected' | 'bundled' | 'none'
  pendingSetup: string[]
} {
  const pendingSetup: string[] = []
  const base = { ...emptyMediaCrawlerConfig(), ...(partial || {}) }
  let source: 'plugin' | 'detected' | 'bundled' | 'none' = 'none'
  let root = String(base.mediaCrawlerRoot || '').trim()
  let python = String(base.mediaCrawlerPython || '').trim()
  const timeout = Math.max(30_000, Math.min(30 * 60_000, Number(base.mediaCrawlerTimeoutMs) || DEFAULT_TIMEOUT_MS))
  const enabled = base.mediaCrawlerEnabled !== false

  if (root && existsSync(join(resolve(root), 'main.py'))) {
    source = 'plugin'
    root = resolve(root)
  } else {
    root = ''
  }

  if (!root) {
    const detected = detectMediaCrawlerCandidate()
    if (detected) {
      root = detected.root
      if (!python) python = detected.python
      source = detectFirstCandidateRoot() === root ? 'bundled' : 'detected'
      if (!detected.python) {
        pendingSetup.push(`采集代码已内置（${detected.root}），但还没建 Python 环境；插件启动时会尝试自动创建 vendor/venv。`)
      }
    } else {
      pendingSetup.push('未找到采集代码（vendor/media-crawler 或本机候选）。')
    }
  }

  if (root && !python) {
    for (const c of mcPythonCandidates(root)) {
      if (existsSync(c)) { python = c; break }
    }
    if (!python) pendingSetup.push('内置采集代码缺 Python 环境（vendor/venv）；插件启动时自动创建，也可在配置里填 mediaCrawlerPython。')
  }

  if (python && !existsSync(python)) {
    pendingSetup.push(`mediaCrawlerPython 不存在: ${python}`)
    python = ''
  }

  if (!enabled) pendingSetup.push('mediaCrawlerEnabled=false')

  return {
    config: {
      mediaCrawlerRoot: root,
      mediaCrawlerPython: python,
      mediaCrawlerTimeoutMs: timeout,
      mediaCrawlerEnabled: enabled,
      mediaCrawlerBrowserMode: normalizeBrowserMode(base.mediaCrawlerBrowserMode),
      mediaCrawlerCdpPort: normalizeCdpPort(base.mediaCrawlerCdpPort, 9222),
    },
    source,
    pendingSetup,
  }
}

export function extractFirstHttpUrl(raw: string): string | null {
  const text = String(raw || '')
  const m = text.match(/https?:\/\/[^\s\u4e00-\u9fff]+/i)
  if (!m) return null
  return m[0].replace(/[),.;，。！？】》"']+$/g, '')
}

export function parsePlatformMediaLink(raw: string): ParsedMediaLink {
  const trimmed = String(raw || '').trim()
  if (!trimmed) throw Object.assign(new Error('链接不能为空'), { code: 'empty' })
  const source = extractFirstHttpUrl(trimmed) || trimmed
  let url: URL
  try {
    url = new URL(source)
  } catch {
    throw Object.assign(new Error('无法解析 URL'), { code: 'bad_url' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('仅支持 http(s) 平台链接'), { code: 'bad_scheme' })
  }
  if (url.username || url.password) {
    throw Object.assign(new Error('拒绝带账号口令的 URL'), { code: 'userinfo_blocked' })
  }
  const host = url.hostname.toLowerCase()
  if (
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw Object.assign(new Error('平台下载不接受内网/loopback 地址'), { code: 'ssrf_blocked' })
  }
  const rule = PLATFORM_RULES.find((r) => r.hosts.some((re) => re.test(host)))
  if (!rule) throw Object.assign(new Error(`未识别的平台主机: ${host}`), { code: 'unknown_platform' })
  return { platform: rule.platform, specifiedId: source, mediaDownloadSupported: rule.media, host }
}

export function buildMcCliPlan(input: {
  root: string
  python: string
  platform: McPlatform
  specifiedId: string
  saveDataPath: string
  timeoutMs?: number
}): McCliPlan {
  const saveDataPath = resolve(input.saveDataPath)
  const root = resolve(input.root)
  const norm = saveDataPath.replace(/\\/g, '/')
  if (!norm.includes('/mediacrawler-jobs/')) {
    throw Object.assign(new Error('save_data_path 必须落在公司任务隔离目录 mediacrawler-jobs'), { code: 'bad_save_path' })
  }
  const rootNorm = root.replace(/\\/g, '/')
  if (norm === rootNorm || norm.startsWith(rootNorm + '/data')) {
    throw Object.assign(new Error('禁止写入 MediaCrawler 共享 data 目录'), { code: 'mc_data_forbidden' })
  }
  const mainPy = join(root, 'main.py')
  if (!existsSync(mainPy)) throw Object.assign(new Error('main.py 缺失'), { code: 'mc_main_missing' })

  // Documented CLI flags (cmd_arg/arg.py): --platform --lt --type --specified_id --get_media --save_data_path …
  // Sidecar applies original MC saved cookie login in-process (no --cookies on argv).
  const runner = mediacrawlerRunnerScriptPath()
  if (!existsSync(runner)) {
    throw Object.assign(new Error('缺少插件 sidecar run_mc_main.py'), { code: 'runner_missing' })
  }
  const argv = [
    runner,
    '--platform',
    input.platform,
    '--lt',
    'qrcode',
    '--type',
    'detail',
    '--specified_id',
    input.specifiedId,
    '--get_media',
    'true',
    '--get_comment',
    'false',
    '--get_sub_comment',
    'false',
    '--save_data_option',
    'jsonl',
    '--save_data_path',
    saveDataPath,
    '--enable_ip_proxy',
    'false',
    '--crawler_max_notes_count',
    '1',
    '--max_concurrency_num',
    '1',
    '--headless',
    'true',
  ]

  return {
    cwd: root,
    bin: resolve(input.python),
    argv,
    saveDataPath,
    platform: input.platform,
    specifiedId: input.specifiedId,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
}

export function normalizeSearchKeyword(raw: string): string {
  const k = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!k) throw Object.assign(new Error('关键词不能为空'), { code: 'empty_keyword' })
  if (k.length > 40) throw Object.assign(new Error('关键词过长（最多 40 字）'), { code: 'keyword_too_long' })
  if (/[\n\r\0]/.test(k)) throw Object.assign(new Error('关键词含非法字符'), { code: 'keyword_illegal' })
  return k
}

/** Documented MediaCrawler --type search (keywords). This is NOT a platform hot-board. */
export function buildMcSearchCliPlan(input: {
  root: string
  python: string
  platform: McPlatform
  keywords: string
  saveDataPath: string
  maxNotes?: number
  timeoutMs?: number
  browserMode?: MediaCrawlerBrowserMode
  cdpPort?: number
}): McCliPlan {
  const saveDataPath = resolve(input.saveDataPath)
  const root = resolve(input.root)
  const norm = saveDataPath.replace(/\\/g, '/')
  if (!norm.includes('/mediacrawler-jobs/')) {
    throw Object.assign(new Error('save_data_path 必须落在公司任务隔离目录 mediacrawler-jobs'), { code: 'bad_save_path' })
  }
  const rootNorm = root.replace(/\\/g, '/')
  if (norm === rootNorm || norm.startsWith(rootNorm + '/data')) {
    throw Object.assign(new Error('禁止写入 MediaCrawler 共享 data 目录'), { code: 'mc_data_forbidden' })
  }
  const mainPy = join(root, 'main.py')
  if (!existsSync(mainPy)) throw Object.assign(new Error('main.py 缺失'), { code: 'mc_main_missing' })
  const keywords = normalizeSearchKeyword(input.keywords)
  const maxNotes = Math.max(1, Math.min(10, Number(input.maxNotes || 10) || 10))
  const browserMode = normalizeBrowserMode(input.browserMode)
  const cdpPort = normalizeCdpPort(input.cdpPort, 9222)
  const runner = mediacrawlerRunnerScriptPath()
  if (!existsSync(runner)) {
    throw Object.assign(new Error('缺少插件 sidecar run_mc_main.py'), { code: 'runner_missing' })
  }
  // Metadata-only search. Sidecar applies process-scoped CDP overrides (no MC base_config edit).
  const argv = [
    runner,
    '--platform',
    input.platform,
    '--lt',
    'qrcode',
    '--type',
    'search',
    '--keywords',
    keywords,
    '--get_media',
    'false',
    '--get_comment',
    'false',
    '--get_sub_comment',
    'false',
    '--save_data_option',
    'jsonl',
    '--save_data_path',
    saveDataPath,
    '--enable_ip_proxy',
    'false',
    '--crawler_max_notes_count',
    String(maxNotes),
    '--max_concurrency_num',
    '1',
    '--headless',
    'true',
  ]
  return {
    cwd: root,
    bin: resolve(input.python),
    argv,
    saveDataPath,
    platform: input.platform,
    specifiedId: '',
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    mode: 'search',
    keywords,
    browserMode,
    cdpPort,
  }
}

export function collectKeywordSearchHits(saveDataPath: string, limit = 10): KeywordSearchHit[] {
  const root = resolve(saveDataPath)
  if (!existsSync(root)) return []
  const hits: KeywordSearchHit[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!name.endsWith('.jsonl') && !name.endsWith('.json')) continue
      let text = ''
      try {
        text = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      const lines = name.endsWith('.jsonl') ? text.split(/\n+/).filter(Boolean) : [text]
      for (const line of lines) {
        let row: any
        try {
          row = JSON.parse(line)
        } catch {
          continue
        }
        // unwrap common shapes
        const item = row?.aweme_id || row?.title || row?.desc ? row : row?.data || row?.content || row
        if (!item || typeof item !== 'object') continue
        const awemeId = String(item.aweme_id || item.awemeId || item.id || '').trim()
        const title = String(item.title || item.desc || '').trim()
        if (!awemeId && !title) continue
        hits.push({
          awemeId: awemeId || undefined,
          title: title || undefined,
          url: item.aweme_url || (awemeId ? `https://www.douyin.com/video/${awemeId}` : undefined),
          likedCount: item.liked_count != null ? String(item.liked_count) : undefined,
          commentCount: item.comment_count != null ? String(item.comment_count) : undefined,
          shareCount: item.share_count != null ? String(item.share_count) : undefined,
          collectedCount: item.collected_count != null ? String(item.collected_count) : undefined,
          nickname: item.nickname != null ? String(item.nickname) : undefined,
          createTime: item.create_time,
          sourceKeyword: item.source_keyword != null ? String(item.source_keyword) : undefined,
          sourceKind: 'keyword_search',
        })
        if (hits.length >= limit) return hits
      }
    }
  }
  return hits
}

export function assertSafeCliPlan(plan: McCliPlan, mcRoot: string) {
  const root = resolve(mcRoot)
  const bin = resolve(plan.bin)
  const allowedBins = mcPythonCandidates(root).map((p) => resolve(p))
  // allow configured python if it resolves under root/.venv OR equals configured absolute that passed preflight
  if (!allowedBins.includes(bin) && !bin.includes(`${root}/.venv/`) && !bin.includes(`${root}\\.venv\\`)) {
    // still allow explicit absolute python that exists and was configured (same root check via plan.cwd)
    if (resolve(plan.cwd) !== root || !existsSync(bin)) {
      throw Object.assign(new Error('拒绝非白名单解释器'), { code: 'bin_not_allowed' })
    }
  }
  if (resolve(plan.cwd) !== root) {
    throw Object.assign(new Error('cwd 必须为 MediaCrawler 根目录'), { code: 'cwd_not_allowed' })
  }
  const argv0 = resolve(plan.argv[0])
  const mainPy = resolve(join(root, 'main.py'))
  const runnerPy = resolve(mediacrawlerRunnerScriptPath())
  if (argv0 !== mainPy && argv0 !== runnerPy) {
    throw Object.assign(new Error('argv[0] 必须为 main.py 或插件 mediacrawler-runner sidecar'), { code: 'argv_not_allowed' })
  }
  for (const a of plan.argv) {
    if (/\n|\r|\0/.test(a)) throw Object.assign(new Error('参数含非法控制字符'), { code: 'argv_control' })
  }
  if (plan.argv.includes('--cookies')) {
    throw Object.assign(new Error('禁止传入 --cookies'), { code: 'cookies_forbidden' })
  }
  const typeIdx = plan.argv.indexOf('--type')
  const typ = typeIdx >= 0 ? plan.argv[typeIdx + 1] : ''
  if (typ && typ !== 'detail' && typ !== 'search') {
    throw Object.assign(new Error('仅允许 --type detail|search'), { code: 'type_not_allowed' })
  }
  if (typ === 'search') {
    if (!plan.argv.includes('--keywords')) {
      throw Object.assign(new Error('search 模式缺少 --keywords'), { code: 'keywords_required' })
    }
    // search must stay metadata-only in this adapter
    const mediaIdx = plan.argv.indexOf('--get_media')
    if (mediaIdx >= 0 && String(plan.argv[mediaIdx + 1]).toLowerCase() === 'true') {
      throw Object.assign(new Error('关键词搜索禁止顺带下载媒体'), { code: 'search_media_forbidden' })
    }
  }
}

/** Production live runner — real spawn. Tests must inject a different runner. */
export function liveMcRunner(
  plan: McCliPlan,
  ctx: { taskId: string; onLog?: (chunk: string, stream: 'stdout' | 'stderr') => void },
): Promise<RunCliResult> {
  assertSafeCliPlan(plan, plan.cwd)
  return new Promise((resolvePromise, reject) => {
    let timedOut = false
    let cancelled = false
    let stdout = ''
    let stderr = ''
    let loginSeen = false
    let child: ChildProcess
    try {
      const mode = normalizeBrowserMode(plan.browserMode)
      const port = normalizeCdpPort(plan.cdpPort, 9222)
      const modeEnv = browserModeEnv(mode, port, plan.cwd)
      child = spawn(plan.bin, plan.argv, {
        cwd: plan.cwd,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: process.env.LANG || 'en_US.UTF-8',
          ...modeEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      })
    } catch (e: any) {
      reject(Object.assign(new Error(e?.message || 'spawn failed'), { code: 'spawn_failed' }))
      return
    }
    runningChildren.set(ctx.taskId, child)

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 2000)
    }, plan.timeoutMs)

    const ingest = (d: Buffer | string, stream: 'stdout' | 'stderr') => {
      const text = String(d)
      if (LOGIN_LOG_RE.test(text)) loginSeen = true
      ctx.onLog?.(text, stream)
      if (stream === 'stdout') {
        stdout += text
        if (stdout.length > 200_000) stdout = stdout.slice(-200_000)
      } else {
        stderr += text
        if (stderr.length > 200_000) stderr = stderr.slice(-200_000)
      }
    }
    child.stdout?.on('data', (d) => ingest(d, 'stdout'))
    child.stderr?.on('data', (d) => ingest(d, 'stderr'))
    child.on('error', (err) => {
      clearTimeout(timer)
      runningChildren.delete(ctx.taskId)
      reject(Object.assign(err, { code: 'spawn_error' }))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      runningChildren.delete(ctx.taskId)
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        cancelled = cancelled || timedOut
      }
      resolvePromise({
        exitCode: code ?? (timedOut ? 124 : 1),
        stdout,
        stderr,
        timedOut,
        cancelled,
        mock: false,
        loginSeen,
      })
    })
  })
}

/** Test-only helper: writes synthetic media. MUST NOT be production default. */
export async function fakeMcRunnerForTests(
  plan: McCliPlan,
  _ctx: { taskId: string; onLog?: (chunk: string, stream: 'stdout' | 'stderr') => void },
): Promise<RunCliResult> {
  assertSafeCliPlan(plan, plan.cwd)
  for (const need of ['--platform', '--lt', 'qrcode', '--type', 'detail', '--specified_id', '--get_media', 'true', '--save_data_path']) {
    if (!plan.argv.includes(need)) {
      throw Object.assign(new Error(`fake runner: missing argv token ${need}`), { code: 'argv_incomplete' })
    }
  }
  const mediaDir = join(plan.saveDataPath, plan.platform, 'media', 'fake-content-id')
  mkdirSync(mediaDir, { recursive: true })
  writeFileSync(join(mediaDir, 'cover.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3]))
  writeFileSync(join(mediaDir, 'video.mp4'), Buffer.from('....ftypisom....fake-mp4-fixture'))
  return {
    exitCode: 0,
    stdout: '[injected-fake-runner] mock only — not production default\n',
    stderr: '',
    timedOut: false,
    mock: true,
    loginSeen: false,
  }
}

export function cancelMcTask(spaceId: string, taskId: string): McTask | undefined {
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  const child = runningChildren.get(taskId)
  if (child) {
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
  const task = getMcTask(spaceId, taskId)
  if (!task) return undefined
  if (task.status === 'running' || task.status === 'needs_login' || task.status === 'queued') {
    task.status = 'cancelled'
    task.updatedAt = Date.now()
    task.note = '用户取消'
    upsertTask(spaceId, task)
  }
  return task
}

function listMediaFiles(saveDataPath: string, platform: McPlatform): string[] {
  const mediaRoot = join(saveDataPath, platform, 'media')
  if (!existsSync(mediaRoot)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (st.isFile()) {
        const ext = extname(name).toLowerCase()
        if (!MEDIA_EXT.has(ext)) continue
        if (st.size <= 0 || st.size > MAX_IMPORT_BYTES) continue
        const resolved = resolve(p)
        if (!resolved.startsWith(resolve(saveDataPath) + '/')) continue
        out.push(resolved)
      }
    }
  }
  walk(mediaRoot)
  return out
}

function importMediaFiles(spaceId: string, slot: MaterialSlot, files: string[]): StudioMaterial[] {
  const materials: StudioMaterial[] = []
  for (const file of files) {
    if (isDownloadSidecarCover(file)) continue
    const bytes = readFileSync(file)
    materials.push(addStudioMaterial(spaceId, slot, basename(file), bytes))
  }
  return materials
}

export function defaultProductionRunner(): CliRunner {
  return liveMcRunner
}

export async function runPlatformMediaDownload(input: {
  spaceId: string
  slot: string
  source: string
  pluginConfig?: Partial<MediaCrawlerRuntimeConfig>
  /** Test-only injection. Production handlers MUST omit this. */
  runner?: CliRunner
}): Promise<{ success: boolean; task: McTask; capability: ReturnType<typeof mediacrawlerCapabilityReport> }> {
  const spaceId = String(input.spaceId || '').trim()
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  if (!isMaterialSlot(String(input.slot || ''))) throw new Error('槽位只能是产品、门店、Logo、场景背景或服装套装')
  const slot = String(input.slot) as MaterialSlot

  const task: McTask = {
    id: `mc-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    spaceId,
    slot,
    source: String(input.source || '').trim(),
    status: 'queued',
    loginPhase: 'not_prepared',
    runner: input.runner ? 'injected' : 'live',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    note: 'MediaCrawler documented CLI → 当前公司素材库',
    mock: false,
  }
  upsertTask(spaceId, task)

  try {
    const parsed = parsePlatformMediaLink(task.source)
    task.platform = parsed.platform
    if (!parsed.mediaDownloadSupported) {
      task.status = 'rejected'
      task.code = 'media_unsupported'
      task.error = `${parsed.platform} 上游无媒体下载字段（仅元数据）；本适配器不入库媒体`
      task.updatedAt = Date.now()
      upsertTask(spaceId, task)
      return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
    }

    const resolved = resolveRuntimeConfig(input.pluginConfig)
    const { config } = resolved
    if (!config.mediaCrawlerEnabled || !config.mediaCrawlerRoot || !config.mediaCrawlerPython) {
      task.status = 'needs_setup'
      task.loginPhase = 'needs_setup'
      task.code = 'needs_setup'
      task.error = resolved.pendingSetup.join(' ') || 'MediaCrawler 未配置'
      task.note = resolved.pendingSetup.join('\n')
      task.updatedAt = Date.now()
      upsertTask(spaceId, task)
      return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
    }

    const saveDataPath = join(jobsRoot(spaceId), task.id, 'out')
    mkdirSync(saveDataPath, { recursive: true })
    const plan = buildMcCliPlan({
      root: config.mediaCrawlerRoot,
      python: config.mediaCrawlerPython,
      platform: parsed.platform,
      specifiedId: parsed.specifiedId,
      saveDataPath,
      timeoutMs: config.mediaCrawlerTimeoutMs,
    })
    assertSafeCliPlan(plan, config.mediaCrawlerRoot)
    task.argv = [plan.bin, ...plan.argv]
    task.cwd = plan.cwd
    task.saveDataPath = plan.saveDataPath
    task.loginPhase = 'needs_login'
    task.loginHint = LOGIN_HINT
    task.status = 'running'
    task.updatedAt = Date.now()
    upsertTask(spaceId, task)

    const runner = input.runner || defaultProductionRunner()
    if (!input.runner && runner !== liveMcRunner) {
      // belt-and-suspenders: production path must be liveMcRunner identity when not injected
    }

    const result = await runner(plan, {
      taskId: task.id,
      onLog: (chunk) => {
        if (LOGIN_LOG_RE.test(chunk)) {
          task.loginPhase = 'needs_login'
          task.loginHint = LOGIN_HINT
          task.stdoutTail = (task.stdoutTail || '') + chunk
          if ((task.stdoutTail || '').length > 4000) task.stdoutTail = task.stdoutTail.slice(-4000)
          task.updatedAt = Date.now()
          upsertTask(spaceId, task)
        }
      },
    })

    task.exitCode = result.exitCode
    task.stdoutTail = sanitizeCliLog(result.stdout, 4000)
    task.stderrTail = sanitizeCliLog(result.stderr, 4000)
    task.mock = result.mock === true
    if (result.loginSeen) {
      task.loginPhase = 'needs_login'
      task.loginHint = LOGIN_HINT
    }

    if (result.cancelled) {
      task.status = 'cancelled'
      task.code = 'cancelled'
      task.error = '任务已取消'
      task.updatedAt = Date.now()
      upsertTask(spaceId, task)
      return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
    }
    if (result.timedOut) {
      task.status = result.loginSeen ? 'needs_login' : 'failed'
      task.code = result.loginSeen ? 'needs_login_timeout' : 'timeout'
      task.error = result.loginSeen
        ? `等待登录超时。${LOGIN_HINT}`
        : `CLI 超时（${plan.timeoutMs}ms）`
      task.nextStep = result.loginSeen
        ? '在扫码窗口完成登录后重试。'
        : '可加大 mediaCrawlerTimeoutMs，或检查本机浏览器是否卡住。'
      task.detail = sanitizeCliLog(`${result.stderr}\n${result.stdout}`)
      task.loginPhase = result.loginSeen ? 'needs_login' : 'failed'
      task.updatedAt = Date.now()
      upsertTask(spaceId, task)
      return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
    }
    if (result.exitCode !== 0) {
      const classified = classifyCliFailure({
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        loginSeen: result.loginSeen,
      })
      task.status = classified.status
      task.code = classified.code
      task.error = classified.error
      task.nextStep = classified.nextStep
      task.detail = classified.detail
      task.stderrTail = sanitizeCliLog(result.stderr, 4000)
      task.stdoutTail = sanitizeCliLog(result.stdout, 4000)
      task.loginPhase = classified.loginPhase
      if (classified.status === 'needs_login') task.loginHint = LOGIN_HINT
      task.updatedAt = Date.now()
      upsertTask(spaceId, task)
      return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
    }

    if (result.mock) {
      // Injected test runner only — never treat as silent platform success in notes
      task.note = 'injected test runner（非生产默认；非实网平台成功）'
    }

    const files = listMediaFiles(saveDataPath, parsed.platform)
    task.mediaFiles = files
    if (!files.length) {
      const fromLogs = classifyCliLogs({
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        loginSeen: result.loginSeen,
      })
      if (fromLogs) {
        task.status = fromLogs.status
        task.code = fromLogs.code
        task.error = fromLogs.error
        task.nextStep = fromLogs.nextStep
        task.detail = fromLogs.detail
        task.loginPhase = fromLogs.loginPhase
        if (fromLogs.status === 'needs_login') task.loginHint = LOGIN_HINT
        task.updatedAt = Date.now()
        upsertTask(spaceId, task)
        return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
      }
      task.status = 'failed'
      task.code = 'no_media'
      task.error = 'CLI 以成功码结束，但隔离目录未发现可入库媒体'
      task.nextStep =
        '先看诊断摘录是否含平台受限/空响应；不要默认扫码。确认帖子本身有视频/图，且发布账号与 MediaCrawler 登录互不共享。'
      task.detail = sanitizeCliLog(`${result.stderr}\n${result.stdout}`)
      task.loginPhase = 'failed'
      task.updatedAt = Date.now()
      upsertTask(spaceId, task)
      return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
    }

    const materials = importMediaFiles(spaceId, slot, files)
    task.materials = materials
    task.status = 'succeeded'
    task.loginPhase = 'ready'
    task.updatedAt = Date.now()
    upsertTask(spaceId, task)
    return { success: true, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
  } catch (e: any) {
    task.status = 'failed'
    task.code = e?.code || 'adapter_error'
    task.error = e?.message || '适配失败'
    task.loginPhase = 'failed'
    task.updatedAt = Date.now()
    upsertTask(spaceId, task)
    return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
  }
}

export async function runPlatformKeywordSearch(input: {
  spaceId: string
  platform?: McPlatform
  keywords: string
  maxNotes?: number
  browserMode?: MediaCrawlerBrowserMode
  cdpPort?: number
  pluginConfig?: Partial<MediaCrawlerRuntimeConfig>
  runner?: CliRunner
}): Promise<{ success: boolean; task: McTask; capability: ReturnType<typeof mediacrawlerCapabilityReport> }> {
  const spaceId = String(input.spaceId || '').trim()
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  const keywords = normalizeSearchKeyword(input.keywords)
  const platform = (input.platform || 'dy') as McPlatform
  if (!['xhs', 'dy', 'ks', 'bili', 'wb'].includes(platform)) {
    throw Object.assign(new Error('该平台暂未接入关键词搜索'), { code: 'platform_unsupported' })
  }
  const maxNotes = Math.max(1, Math.min(10, Number(input.maxNotes || 10) || 10))
  const resolved = resolveRuntimeConfig(input.pluginConfig)
  const { config } = resolved
  const browserMode = normalizeBrowserMode(
    input.browserMode ?? config.mediaCrawlerBrowserMode ?? 'standard',
  )
  const cdpPort = normalizeCdpPort(input.cdpPort ?? config.mediaCrawlerCdpPort, 9222)
  const task: McTask = {
    id: `mc-search-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    spaceId,
    slot: 'product',
    source: `keyword:${keywords}`,
    platform,
    status: 'queued',
    loginPhase: 'not_prepared',
    runner: input.runner ? 'injected' : 'live',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: 'search',
    keywords,
    sourceKind: 'keyword_search',
    browserMode,
    cdpPort,
    note: `MediaCrawler --type search 关键词搜索（非热榜）；browserMode=${browserMode}` +
      (browserMode === 'cdp_existing' ? `:@${cdpPort}` : '') +
      '；仅元数据，不下载媒体/评论。pong≠搜索授权。',
    mock: false,
  }
  upsertTask(spaceId, task)

  if (!config.mediaCrawlerEnabled || !config.mediaCrawlerRoot || !config.mediaCrawlerPython) {
    task.status = 'needs_setup'
    task.loginPhase = 'needs_setup'
    task.code = 'needs_setup'
    task.error = 'MediaCrawler 未配置或未启用'
    task.updatedAt = Date.now()
    upsertTask(spaceId, task)
    return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
  }

  const outDir = join(jobsRoot(spaceId), task.id, 'out')
  mkdirSync(outDir, { recursive: true })
  let plan: McCliPlan
  try {
    plan = buildMcSearchCliPlan({
      root: config.mediaCrawlerRoot,
      python: config.mediaCrawlerPython,
      platform,
      keywords,
      saveDataPath: outDir,
      maxNotes,
      timeoutMs: config.mediaCrawlerTimeoutMs,
      browserMode,
      cdpPort,
    })
    assertSafeCliPlan(plan, config.mediaCrawlerRoot)
  } catch (e: any) {
    task.status = 'failed'
    task.code = e?.code || 'plan_error'
    task.error = e?.message || '无法构建搜索命令'
    task.updatedAt = Date.now()
    upsertTask(spaceId, task)
    return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
  }

  task.status = 'running'
  task.loginPhase = 'running'
  task.argv = plan.argv
  task.cwd = plan.cwd
  task.saveDataPath = plan.saveDataPath
  task.updatedAt = Date.now()
  upsertTask(spaceId, task)

  const runner = input.runner || defaultProductionRunner()
  try {
    const result = await runner(plan, { taskId: task.id })
    task.exitCode = result.exitCode
    task.stdoutTail = sanitizeCliLog(result.stdout)
    task.stderrTail = sanitizeCliLog(result.stderr)
    task.mock = !!result.mock
    if (result.mock) task.note = `${task.note || ''}; injected`.trim()
    const logBlob = `${result.stderr || ''}\n${result.stdout || ''}`
    task.pongSkippedLogin = /pong=True,\s*skip login/i.test(logBlob)
    const cookieInjectOnly =
      COOKIE_LOGIN_LOG_RE.test(logBlob) && !LOGIN_LOG_RE.test(logBlob)
    const classified = classifyCliFailure({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      loginSeen: cookieInjectOnly ? false : result.loginSeen,
    })
    const hits = collectKeywordSearchHits(outDir, maxNotes)
    if (hits.length && result.exitCode === 0) {
      task.searchHits = hits
      task.collectedAt = Date.now()
      task.searchSampleAnalysis = summarizeKeywordSearchSample(hits, {
        keywords,
        collectedAt: task.collectedAt,
      })
      task.status = 'succeeded'
      task.loginPhase = 'ready'
      task.updatedAt = Date.now()
      upsertTask(spaceId, task)
      return { success: true, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
    }
    const qrLoginNeeded =
      classified.code === 'needs_login' || (result.loginSeen && !cookieInjectOnly)
    if (qrLoginNeeded) {
      task.status = 'needs_login'
      task.loginPhase = 'needs_login'
      task.loginHint = LOGIN_HINT
      task.code = 'needs_login'
      task.error = classified.error || '关键词搜索需要有效登录态（与发布账号隔离）'
      task.nextStep =
        classified.nextStep ||
        (browserMode === 'cdp_existing'
          ? '确认已登录的 Chrome 里抖音能搜，再刷新。'
          : '使用原版 MediaCrawler 已保存的登录后再刷新，不用开日常浏览器。')
      task.detail = classified.detail
      task.updatedAt = Date.now()
      upsertTask(spaceId, task)
      return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
    }
    task.searchHits = hits
    task.collectedAt = Date.now()
    task.searchSampleAnalysis = summarizeKeywordSearchSample(hits, {
      keywords,
      collectedAt: task.collectedAt,
    })
    if (!hits.length) {
      // Empty after exit 0: prefer login/restricted classification from logs over generic no_search_hits
      if (classified.code === 'needs_login' || /2483|请先登录/.test(logBlob)) {
        task.status = 'needs_login'
        task.loginPhase = 'needs_login'
        task.code = 'needs_login'
        task.error =
          '搜索无结果且日志表明需登录（可能 pong 跳过扫码后仍 2483）。pong≠搜索授权。'
        task.nextStep =
          browserMode === 'cdp_existing'
            ? '确认已登录的 Chrome 里抖音能搜，再刷新。'
            : '使用原版 MediaCrawler 已保存的登录后再刷新，不用开日常浏览器。'
        task.loginHint = LOGIN_HINT
        task.detail = classified.detail || sanitizeCliLog(logBlob)
        task.updatedAt = Date.now()
        upsertTask(spaceId, task)
        return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
      }
      if (classified.code === 'platform_restricted') {
        task.status = 'failed'
        task.code = classified.code
        task.error = classified.error
        task.nextStep = classified.nextStep
        task.detail = classified.detail
        task.loginPhase = 'failed'
        task.updatedAt = Date.now()
        upsertTask(spaceId, task)
        return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
      }
      task.status = 'failed'
      task.code = 'no_search_hits'
      task.error = '未得到关键词搜索结果（非热榜；空结果不当成功）'
      task.nextStep = '确认关键词有效且当前 browserMode 下会话可搜；勿把赞评排序当热榜。'
      task.loginPhase = 'failed'
      task.detail = classified.detail || sanitizeCliLog(logBlob)
      task.updatedAt = Date.now()
      upsertTask(spaceId, task)
      return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
    }
    task.status = 'succeeded'
    task.loginPhase = 'ready'
    task.updatedAt = Date.now()
    upsertTask(spaceId, task)
    return { success: true, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
  } catch (e: any) {
    task.status = 'failed'
    task.code = e?.code || 'adapter_error'
    task.error = e?.message || '关键词搜索失败'
    task.loginPhase = 'failed'
    task.updatedAt = Date.now()
    upsertTask(spaceId, task)
    return { success: false, task, capability: mediacrawlerCapabilityReport(input.pluginConfig) }
  }
}

export function mediacrawlerCapabilityReport(partial?: Partial<MediaCrawlerRuntimeConfig>) {
  const resolved = resolveRuntimeConfig(partial)
  const { config, source, pendingSetup } = resolved
  const ready = !!(config.mediaCrawlerEnabled && config.mediaCrawlerRoot && config.mediaCrawlerPython)
  return {
    adapter: 'mediacrawler-documented-cli',
    productionDefaultRunner: 'live' as const,
    fakeOnlyViaTestInjection: true,
    copiesMediaCrawlerSource: false,
    configured: ready,
    configSource: source,
    mediaCrawlerRoot: config.mediaCrawlerRoot || null,
    mediaCrawlerPython: config.mediaCrawlerPython || null,
    mediaCrawlerTimeoutMs: config.mediaCrawlerTimeoutMs,
    mediaCrawlerEnabled: config.mediaCrawlerEnabled,
    loginPhase: ready ? ('needs_login' as LoginPhase) : ('needs_setup' as LoginPhase),
    loginHint: LOGIN_HINT,
    pendingSetup,
    cliShape:
      'python main.py --platform <p> --lt qrcode --type detail --specified_id <url> --get_media true --save_data_path <isolated> --get_comment false --enable_ip_proxy false',
    isolation: 'per-task --save_data_path under company space mediacrawler-jobs/<task>/out',
    mediaDownloadPlatforms: ['xhs', 'dy', 'ks', 'bili', 'wb'] as const,
    metadataOnlyPlatforms: ['tieba', 'zhihu'] as const,
    acceptedLinkForms: [
      'https://www.xiaohongshu.com/...',
      'https://www.douyin.com/... / https://v.douyin.com/...',
      'https://www.kuaishou.com/...',
      'https://www.bilibili.com/video/... / https://b23.tv/...',
      'https://weibo.com/...',
    ],
    materialsTarget: '当前公司空间素材库（product/store/logo）',
    keywordSearch: {
      availableInMediaCrawler: true,
      wiredInPlugin: true,
      cli: 'sidecar run_mc_main.py → MC --type search (process-scoped browserMode; no base_config edit)',
      note: '关键词搜索（非热榜）。默认复用原版 MediaCrawler 已保存登录（.douyin_cookies.txt / browser_data），argv 不带 cookie。缺登录才扫码。',
      maxNotesCap: 10,
      downloadsMedia: false,
      downloadsComments: false,
      browserModes: ['standard', 'cdp_existing', 'cdp_launch'],
      defaultBrowserMode: config.mediaCrawlerBrowserMode || 'standard',
      cdpPort: config.mediaCrawlerCdpPort || 9222,
    },
    hotBoard: {
      availableInMediaCrawlerCli: true,
      wiredInPlugin: true,
      crawlerType: 'search',
      defaultPlatform: 'xhs',
      xhsSort: 'popularity_descending',
      officialHotSearch: false,
      note: '行业热榜复用已接入的 --type search。抖音走原版已保存登录。小红书默认 SORT_TYPE=popularity_descending。不是全国热搜词条榜，也不是 README Pro HomeFeed。',
    },
    contentAnalysis: {
      mcCommentWordcloud: {
        availableInMediaCrawler: true,
        sourceFiles: ['tools/words.py', 'tools/async_file_writer.py', 'main.py:_generate_wordcloud_if_needed'],
        wiredInPlugin: true,
        requiresComments: true,
        defaultEnableGetWordcloud: false,
        importOnly: true,
        route: '/digital-human-studio/comment-wordcloud',
        note: '复用 MC AsyncWordCloudGenerator：用户导入已有评论（不新采）。输出词频+词云图；非 AI 情绪、非热榜。',
      },
      mcAiCommentAgent: {
        availableInMediaCrawler: false,
        wiredInPlugin: false,
        note: 'README_en 标明 comment-analysis AI Agent under development，非已实现。',
      },
      pluginKeywordSampleMetrics: {
        available: true,
        implementation: 'plugin_local_aggregate',
        reusedMediaCrawlerModule: false,
        notHotBoard: true,
        note: '对已有 keyword_search 样本的赞/评/藏/转汇总与样本内排行；非热榜/非实时趋势/非词云。',
      },
    },
    notDone: [
      '自动安装依赖',
      '自动 playwright install',
      '读取发布侧 cookies',
      '私有 API/签名',
      '与发布模块共享平台登录会话',
      'account blocked 时自动换号/代理/重试',
      '全国热搜词条榜 / Pro HomeFeed（无独立 --type）',
    ],
    sessionIsolation: {
      publishAccounts: 'publish-studio 公司账号绑定 + 官方登录页凭证文件（与下载隔离）',
      mediaCrawlerDownload: '原版 MediaCrawler 自己的 browser_data / .douyin_cookies.txt（sidecar --lt cookie，argv 不带 cookie 值）',
      sharedOfficialOAuth: false,
      note: '会复用原版 MediaCrawler 已保存的登录，不会搬用发布模块账号。',
    },
    knownSetupHints: [
      '若报 Playwright Chromium 不存在：在 MediaCrawler 的 .venv 里执行 python -m playwright install chromium',
      '分享口令可粘贴整段，适配器会抽取其中首个 http(s) 链接',
      '日志出现 account blocked：多为上游空响应或字面 blocked 被 MC 映射，不等于已证实封号；请停自动重试并在官方页自行确认',
    ],
  }
}
