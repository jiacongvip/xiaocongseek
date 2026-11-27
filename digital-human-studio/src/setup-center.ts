/**
 * 一键检测中心：把「这东西能不能跑」拆成一张可读的表。
 *
 * 客户拿到桌面端后，先来这里看一眼：绿的可以不管，红的点一下装。
 * 所有检测都只读，不做任何写盘；安装必须由前端显式点「安装」触发。
 *
 * 设计取舍：
 * - 不跑 bash 体检脚本（doctor-product.sh 是给我们自己排障用的），
 *   这里在进程内直接查，避免依赖 shell / PATH / 终端环境。
 * - 每一项都带 sizeHint，让用户知道点下去要下多少（体积是这位用户最在意的）。
 * - optional=true 的项缺失不影响剪片，只影响对应功能；engine/crawler 这种缺了就直接不能用的标 false。
 */
import { execFileSync, spawn } from 'node:child_process'
import { resolveEngineVenvDir, resolveEngineVenvPython } from './platform.js'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diagnoseEngine } from './engine-provision.js'
import { diagnoseMcEnv } from './mediacrawler-provision.js'
import { publishStudioRuntime } from './publish-studio-bridge.js'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = join(PLUGIN_ROOT, 'vendor')
const RUNTIME = join(VENDOR, 'runtime')
const XIAOCONGCUT = join(VENDOR, 'xiaocongcut')
const CRAWL = join(VENDOR, 'media-crawler')
const CACHE = join(homedir(), '.xiaocongcut', 'cache')

export type SetupKey =
  | 'runtime'
  | 'engine'
  | 'crawler'
  | 'ffmpeg'
  | 'fonts'
  | 'asr'
  | 'publish'
  | 'node'
  | 'data'

export type SetupItem = {
  key: SetupKey
  label: string
  /** 这一项是否就绪 */
  ok: boolean
  /** 缺了它，整个产品还能不能用别的东西 */
  blocking: boolean
  detail: string
  sizeHint?: string
  /** 能自动装就给按钮名；不能自动装就给指引 */
  action?: string
  hint?: string
}

function dirSize(path: string): number {
  let total = 0
  const stack = [path]
  while (stack.length) {
    const cur = stack.pop() as string
    let st
    try {
      st = statSync(cur)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      try {
        for (const name of readdirSync(cur)) stack.push(join(cur, name))
      } catch { /* ignore */ }
    } else {
      total += st.size
    }
  }
  return total
}

function hasModelBin(dir: string): boolean {
  if (!existsSync(dir)) return false
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop() as string
    let entries: string[] = []
    try {
      entries = readdirSync(cur)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name === 'model.bin') return true
      const full = join(cur, name)
      try {
        if (statSync(full).isDirectory()) stack.push(full)
      } catch { /* ignore */ }
    }
  }
  return false
}

function pyImportOk(python: string, mods: string): boolean {
  if (!existsSync(python)) return false
  try {
    execFileSync(python, ['-c', `import ${mods}`], { timeout: 20000, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Bundled standalone Python for this OS. A Mac folder does not count on Windows. */
function checkRuntime(): SetupItem {
  const py = runtimePython()
  const bundled = py.startsWith(RUNTIME) && existsSync(py)
  const folder = bundled ? py.slice(RUNTIME.length).split(/[\\/]/).filter(Boolean)[0] : ''
  return {
    key: 'runtime',
    label: '自带 Python',
    ok: bundled,
    blocking: true,
    detail: bundled ? `已带 ${folder}` : '插件里缺 standalone Python，安装包不完整',
    hint: bundled ? undefined : '重新安装完整包（vendor/runtime 必须随包分发，不能现装）',
  }
}

function checkEngine(engineRoot = XIAOCONGCUT): SetupItem {
  const root = engineRoot || XIAOCONGCUT
  const d = diagnoseEngine(root)
  const py = resolveEngineVenvPython(root)
  const venvDir = resolveEngineVenvDir(root)
  const ok = existsSync(join(root, 'capcut_server.py')) && existsSync(py) && pyImportOk(py, 'flask')
  return {
    key: 'engine',
    label: '渲染引擎',
    ok,
    blocking: true,
    detail: ok
      ? `已就绪（${d.steps.filter((s) => s.ok).length}/${d.steps.length} 项检查通过）`
      : '渲染环境没装好，剪片/导出都不能用',
    sizeHint: '约 200MB',
    action: ok ? undefined : 'engine',
    hint: ok ? undefined : `点「安装」会建 ${venvDir} 并装 flask / faster-whisper`,
  }
}

function checkCrawler(): SetupItem {
  const mc = diagnoseMcEnv()
  return {
    key: 'crawler',
    label: '采集环境',
    ok: mc.ready,
    blocking: false,
    detail: mc.ready ? '已就绪（httpx / playwright / pandas）' : '采集页用不了（热榜、下素材）',
    sizeHint: '约 500MB',
    action: mc.ready ? undefined : 'crawler',
    hint: mc.ready ? undefined : mc.hint,
  }
}

function checkFfmpeg(): SetupItem {
  const bin = join(RUNTIME, 'bin')
  const ffmpegNames = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg']
  const ffprobeNames = process.platform === 'win32' ? ['ffprobe.exe', 'ffprobe'] : ['ffprobe']
  const ok = ffmpegNames.some(name => existsSync(join(bin, name)))
    && ffprobeNames.some(name => existsSync(join(bin, name)))
  return {
    key: 'ffmpeg',
    label: 'ffmpeg / ffprobe',
    ok,
    blocking: true,
    detail: ok ? '已随包在（vendor/runtime/bin）' : '缺 ffmpeg/ffprobe，导不出片',
    sizeHint: '约 95MB',
    hint: ok ? undefined : '安装包不完整，需要重新解压完整包',
  }
}

function checkFonts(): SetupItem {
  const dir = join(XIAOCONGCUT, 'fonts')
  let n = 0
  let bytes = 0
  try {
    const names = readdirSync(dir).filter((f) => /\.(otf|ttf|ttc)$/i.test(f))
    n = names.length
    for (const f of names) {
      try { bytes += statSync(join(dir, f)).size } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  // 清单里的总数（随包核心 8 款 + 可点选下载的扩展字体）
  let total = 0
  try {
    const m = JSON.parse(readFileSync(join(XIAOCONGCUT, 'fonts-manifest.json'), 'utf8'))
    total = Array.isArray(m) ? m.length : (Array.isArray(m && m.fonts) ? m.fonts.length : 0)
  } catch { /* ignore */ }
  const mb = bytes ? Math.max(1, Math.round(bytes / 1048576)) : 0
  return {
    key: 'fonts',
    label: '字体库',
    ok: n > 0,
    blocking: false,
    detail: n
      ? `${n} 个字体文件${total ? ` / 共 ${total} 款可装` : ''}`
      : '字体目录为空，模板出字会错',
    sizeHint: mb ? `约 ${mb}MB${total && n < total ? '（其余按需下载）' : ''}` : '约 150MB（其余按需下载）',
    hint: n ? undefined : '安装包里缺 vendor/xiaocongcut/fonts',
  }
}

function checkAsr(): SetupItem {
  const dir = join(CACHE, 'asr-models')
  const ok = hasModelBin(dir)
  return {
    key: 'asr',
    label: '语音转字幕模型',
    ok,
    blocking: false,
    detail: ok ? '模型已在本地' : '首次点「语音转字幕」会自动下载',
    sizeHint: '约 480MB（按需）',
    action: ok ? undefined : 'asr',
    hint: ok ? undefined : '提前在这里下好，剪辑时就不等',
  }
}

function publishRuntimeStatusFile(): string {
  const override = (process.env.PUBLISH_STUDIO_RUNTIME_ROOT || '').trim()
  return join(override || join(homedir(), '.dsh', 'publish-studio', 'runtime'), 'status.json')
}

/**
 * Node 运行时：面板本身就是 node 起的，所以「能打开这页」≈ node 已够用。
 * 这里仍然列出来，是因为客户换机会先问「我到底缺什么」——把启动前提说清楚，
 * 并标出它是随包自带、还是一键装的、还是系统里本来就有的。
 */
function checkNode(): SetupItem {
  const execPath = String(process.execPath || '')
  const ver = String(process.version || '')
  const major = Number((ver.match(/\d+/) || [0])[0]) || 0
  const origin = execPath.includes(join('vendor', 'runtime', 'node'))
    ? '随包自带'
    : execPath.includes(join('.dsh', 'runtime', 'node'))
      ? '一键安装（~/.dsh/runtime）'
      : '系统 / 用户已装'
  const ok = major >= 22
  return {
    key: 'node',
    label: 'Node 运行时',
    ok,
    blocking: true,
    detail: ok ? `${ver} · ${origin}` : `${ver} 版本偏低（要 22+）· ${origin}`,
    sizeHint: '约 50MB 下载',
    action: ok ? undefined : 'node',
    hint: ok ? undefined : 'node 是面板自己的启动前提；点「安装」会下 v22 到 ~/.dsh/runtime/node',
  }
}

function checkPublish(): SetupItem {
  // 注意：publishStudioRuntime() 返回的是「授权 / 宿主连接」状态，不是「运行时是否装好」。
  // 装没装只认 runtime/status.json（由 ensure_runtime.py 写入）。
  const file = publishRuntimeStatusFile()
  let installed = false
  let reason = ''
  if (!existsSync(file)) {
    reason = '隔离运行时未安装（Playwright + Chromium 未下载）'
  } else {
    try {
      const raw: any = JSON.parse(readFileSync(file, 'utf8'))
      installed = !!raw.ready && raw.browsersReady !== false && raw.probeOk !== false
      if (!installed) {
        const miss = Array.isArray(raw.missing) ? raw.missing.map(String).join(' / ') : ''
        reason = miss ? `运行时缺组件：${miss}` : String(raw.message || '运行时未就绪')
      }
    } catch {
      reason = '运行时状态文件损坏，建议重装'
    }
  }
  let bridged = false
  try { bridged = (publishStudioRuntime() as any)?.mode === 'independent-publish-studio' } catch {}
  const detail = installed
    ? (bridged ? 'Playwright + Chromium 已就绪' : '运行时已装好；发布插件还没连到宿主（启用 publish-studio 后重启）')
    : reason
  return {
    key: 'publish',
    label: '发布运行时',
    ok: installed,
    blocking: false,
    detail,
    sizeHint: '约 613MB',
    action: installed ? undefined : 'publish',
    hint: installed
      ? (bridged ? undefined : '装是装好了，但插件没加载：检查 publish-studio 是否已 link 到 web profile')
      : '点「安装」会建隔离 venv 并下载 Chromium（扫码发抖音要用）',
  }
}

function checkData(): SetupItem {
  const dir = join(homedir(), '.dsh')
  const ok = existsSync(dir)
  let writable = false
  if (ok) {
    try {
      statSync(dir)
      writable = true
    } catch { /* ignore */ }
  }
  return {
    key: 'data',
    label: '数据目录',
    ok,
    blocking: false,
    detail: ok ? dir : '还没建（首次保存工程时自动创建）',
    hint: ok ? undefined : undefined,
  }
}

export function setupStatus(opts?: { engineRoot?: string }): {
  items: SetupItem[]
  okCount: number
  total: number
  ready: boolean
  missing: SetupKey[]
  blockingMissing: SetupKey[]
} {
  const engineRoot = opts?.engineRoot || XIAOCONGCUT
  const items = [
    checkNode(),
    checkRuntime(),
    checkEngine(engineRoot),
    checkFfmpeg(),
    checkFonts(),
    checkCrawler(),
    checkAsr(),
    checkPublish(),
    checkData(),
  ]
  const missing = items.filter((i) => !i.ok).map((i) => i.key)
  const blockingMissing = items.filter((i) => !i.ok && i.blocking).map((i) => i.key)
  return {
    items,
    okCount: items.filter((i) => i.ok).length,
    total: items.length,
    ready: blockingMissing.length === 0,
    missing,
    blockingMissing,
  }
}

/** 安装产物占用（让「准备」页能显示总占用） */
export function setupFootprint(opts?: { engineRoot?: string }): { xiaocongcut: number; crawler: number; runtime: number; fonts: number } {
  const engineRoot = opts?.engineRoot || XIAOCONGCUT
  const safe = (p: string) => {
    try { return dirSize(p) } catch { return 0 }
  }
  return {
    xiaocongcut: safe(resolveEngineVenvDir(engineRoot)),
    crawler: safe(join(VENDOR, 'venv')),
    runtime: safe(RUNTIME),
    fonts: safe(join(XIAOCONGCUT, 'fonts')),
  }
}


// ─────────────────────────────────────────────────────────────
// 发布运行时：按需安装（613MB 的 Chromium 不进安装包）
// ─────────────────────────────────────────────────────────────
export type PublishRuntimeInfo = {
  ready: boolean
  phase: string
  message: string
  missing: string[]
  updatedAt?: number
}

/** 只读 status.json（ensure_runtime.py 写的），不看授权状态。 */
export function readPublishRuntimeStatus(): PublishRuntimeInfo {
  const file = publishRuntimeStatusFile()
  if (!existsSync(file)) {
    return { ready: false, phase: 'missing', message: '发布运行时未安装（Playwright / Chromium 还没下）', missing: ['runtime'] }
  }
  try {
    const raw: any = JSON.parse(readFileSync(file, 'utf8'))
    return {
      ready: !!raw.ready && raw.browsersReady !== false && raw.probeOk !== false,
      phase: String(raw.phase || ''),
      message: String(raw.message || ''),
      missing: Array.isArray(raw.missing) ? raw.missing.map(String) : [],
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
    }
  } catch {
    return { ready: false, phase: 'corrupt', message: '运行时状态文件损坏，建议重装', missing: ['status'] }
  }
}

type PublishJob = { running: boolean; startedAt: number; ok?: boolean; text?: string }
let publishJob: PublishJob = { running: false, startedAt: 0 }

export function publishInstallState(): PublishJob {
  return publishJob
}

function publishEnsureScript(): string {
  const fromEnv = (process.env.XIAOCONG_PUBLISH_STUDIO_ROOT || '').trim()
  const candidates = [
    fromEnv ? join(fromEnv, 'publishing', 'ensure_runtime.py') : '',
    resolve(PLUGIN_ROOT, '..', 'publish-studio', 'publishing', 'ensure_runtime.py'),
  ].filter(Boolean)
  return candidates.find(path => existsSync(path)) || candidates[0] || ''
}

/** Prefer the CPython directory that matches this OS and CPU. Fall back to any bundled interpreter. */
function runtimePython(): string {
  let names: string[] = []
  try {
    names = readdirSync(RUNTIME).filter(name => name.startsWith('cpython-'))
  } catch {
    names = []
  }
  const osTag = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
  const archTag = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch
  const ranked = [...names].sort((left, right) => {
    const score = (name: string) => (name.includes(osTag) ? 2 : 0) + (name.includes(archTag) ? 1 : 0)
    return score(right) - score(left)
  })
  for (const name of ranked) {
    const bins = process.platform === 'win32'
      ? [join(RUNTIME, name, 'python.exe')]
      : [
          join(RUNTIME, name, 'bin', 'python3.12'),
          join(RUNTIME, name, 'bin', 'python3'),
          join(RUNTIME, name, 'bin', 'python'),
        ]
    for (const bin of bins) {
      if (existsSync(bin)) return bin
    }
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

async function runPublishEnsure(): Promise<{ ok: boolean; text: string }> {
  const script = publishEnsureScript()
  if (!script || !existsSync(script)) return { ok: false, text: '安装包不完整：缺 publish-studio/publishing/ensure_runtime.py' }
  const runner = runtimePython()
  return await new Promise((done) => {
    const child = spawn(runner, [script], { cwd: dirname(script), env: process.env })
    let buf = ''
    child.stdout?.on('data', (c) => { buf += c.toString() })
    child.stderr?.on('data', (c) => { buf += c.toString() })
    child.on('error', (e: any) => done({ ok: false, text: String(e?.message || e) }))
    child.on('close', (code) => done({ ok: code === 0, text: buf.slice(-4000) }))
  })
}

/** 幂等：已就绪直接返回；正在装返回 running；否则后台起一个。 */
export function startPublishInstall(): { ready: boolean; started: boolean; running: boolean } {
  if (readPublishRuntimeStatus().ready) return { ready: true, started: false, running: false }
  if (publishJob.running) return { ready: false, started: false, running: true }
  publishJob = { running: true, startedAt: Date.now() }
  void runPublishEnsure()
    .then((r) => { publishJob = { running: false, startedAt: 0, ok: r.ok, text: r.text } })
    .catch((e: any) => { publishJob = { running: false, startedAt: 0, ok: false, text: String(e?.message || e) } })
  return { ready: false, started: true, running: true }
}

/** 前端点「安装」时阻塞等结果（最多 maxMs）。 */
export async function waitPublishInstall(maxMs = 20 * 60 * 1000): Promise<void> {
  const t0 = Date.now()
  while (publishJob.running && Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 2000))
  }
}
