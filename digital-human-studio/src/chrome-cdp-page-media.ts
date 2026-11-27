/**
 * Chrome CDP page-media adapter (Douyin watch-page playback capture).
 * Uses an already-running local Chrome remote-debugging endpoint.
 * Does not read cookie files / browser_data / .env; does not log signed URLs.
 * Separate from MediaCrawler detail CLI (which may return empty→account blocked mapping).
 */
import { spawn } from 'node:child_process'
import { venvPythonCandidates } from './platform.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { addStudioMaterial, isMaterialSlot, pruneDownloadSidecarCovers, type MaterialSlot, type StudioMaterial } from './studio-materials.js'
import { isSpaceId, spaceAssetRoot } from './spaces.js'

export const DEFAULT_CDP = 'http://127.0.0.1:9222'

function parseDySource(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = String(raw || '').trim()
  const m = trimmed.match(/https?:\/\/[^\s\u4e00-\u9fff]+/i)
  const source = (m ? m[0].replace(/[),.;，。！？】》"']+$/g, '') : trimmed)
  let url: URL
  try { url = new URL(source) } catch { return { ok: false, error: '无法解析 URL' } }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: '仅支持 http(s)' }
  const host = url.hostname.toLowerCase()
  if (!(/(^|\.)douyin\.com$/i.test(host) || /(^|\.)iesdouyin\.com$/i.test(host))) {
    return { ok: false, error: 'Chrome CDP 页面媒体目前仅支持抖音链接' }
  }
  return { ok: true, url: source }
}


const here = dirname(fileURLToPath(import.meta.url))
/** Dist is digital-human-studio/dist → tools at ../tools */
export function pageMediaScriptPath(): string {
  const candidates = [
    resolve(here, '../tools/chrome-cdp-page-media/download_dy_page_media.py'),
    resolve(here, '../../tools/chrome-cdp-page-media/download_dy_page_media.py'),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return candidates[0]
}

export function detectMcPython(): string | null {
  const roots = [resolve(here, '../vendor/media-crawler'), resolve(here, '../../vendor/media-crawler')]
  for (const root of roots) {
    for (const py of [...venvPythonCandidates(root), ...venvPythonCandidates(resolve(root, '..'))]) {
      if (existsSync(py)) return py
    }
  }
  return null
}

export async function probeChromeCdp(cdp = DEFAULT_CDP): Promise<{ ok: boolean; browser?: string; error?: string }> {
  try {
    const u = new URL('/json/version', cdp)
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
      return { ok: false, error: 'only_local_cdp' }
    }
    const res = await fetch(u, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return { ok: false, error: `http_${res.status}` }
    const j = (await res.json()) as { Browser?: string }
    return { ok: true, browser: j.Browser || 'chrome' }
  } catch (e: any) {
    return { ok: false, error: e?.name || 'cdp_unreachable' }
  }
}

export type PageMediaTask = {
  id: string
  spaceId: string
  slot: MaterialSlot
  source: string
  platform: 'dy'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'needs_setup'
  code?: string
  error?: string
  nextStep?: string
  detail?: string
  runner: 'chrome-cdp-page-media'
  mock: false
  createdAt: number
  updatedAt: number
  exitCode?: number | null
  materials?: StudioMaterial[]
  mediaFiles?: string[]
  note?: string
}

function jobsRoot(spaceId: string) {
  return join(spaceAssetRoot(spaceId), 'chrome-cdp-page-media-jobs')
}
function tasksFile(spaceId: string) {
  return join(jobsRoot(spaceId), 'tasks.json')
}
function loadTasks(spaceId: string): PageMediaTask[] {
  const f = tasksFile(spaceId)
  if (!existsSync(f)) return []
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}
function saveTasks(spaceId: string, tasks: PageMediaTask[]) {
  mkdirSync(jobsRoot(spaceId), { recursive: true })
  writeFileSync(tasksFile(spaceId), JSON.stringify(tasks.slice(0, 40), null, 2))
}
function upsert(spaceId: string, task: PageMediaTask) {
  const rows = loadTasks(spaceId).filter((t) => t.id !== task.id)
  rows.unshift(task)
  saveTasks(spaceId, rows)
}

export function listPageMediaTasks(spaceId: string, limit = 20) {
  return loadTasks(spaceId)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.min(50, limit)))
}

function mapExit(code: number | null): { code: string; error: string; nextStep: string } {
  switch (code) {
    case 32:
      return {
        code: 'cdp_unavailable',
        error: '无法连接本机 Chrome CDP（127.0.0.1:9222）',
        nextStep: '请用已开启远程调试的本机 Chrome（不要改端口/扩大公开范围）；确认调试端口仅本机可访问后再试。',
      }
    case 41:
      return {
        code: 'platform_captcha',
        error: '页面出现可见验证码/安全验证，已停止（不会绕过）',
        nextStep: '请在该 Chrome 窗口内人工完成验证后，再授权一次下载；插件不会自动破解验证码。',
      }
    case 42:
      return {
        code: 'platform_login_wall',
        error: '页面出现登录/无法观看类提示，已停止',
        nextStep: '请在该 Chrome 会话中保持可播放状态后再试；不会搬用发布模块账号。',
      }
    case 43:
      return {
        code: 'no_media_capture',
        error: '未捕获到页面播放产生的媒体流响应',
        nextStep: '确认视频在该 Chrome 中能正常播放后再试一次；不会改签名或私有接口。',
      }
    case 44:
      return { code: 'ffmpeg_merge_failed', error: 'ffmpeg 合并失败', nextStep: '检查本机 ffmpeg 是否可用。' }
    case 45:
      return { code: 'cover_failed', error: '封面截图失败', nextStep: '检查 ffmpeg 与成片是否可读。' }
    case 46:
      return { code: 'audio_track_missing', error: '成片无音轨（未捕获页面音频分轨）', nextStep: '确认 Chrome 中有声音播放后再试；不绕过 DRM。' }
    case 47:
      return {
        code: 'media_fetch_failed',
        error: '媒体文件下载失败',
        nextStep: '已连上浏览器并看到播放流，但把文件拉回来时失败。请再试一次，或去素材柜上传。',
      }
    case 48:
      return {
        code: 'video_only',
        error: '已入库画面；这条没有单独音轨。',
        nextStep: '可在素材柜使用这条视频。',
      }
    default:
      return {
        code: `page_media_exit_${code ?? 'null'}`,
        error: `页面媒体下载退出码 ${code}`,
        nextStep: '查看任务 detail；不要粘贴签名 URL/cookies。',
      }
  }
}

function runWorker(input: {
  python: string
  script: string
  url: string
  outDir: string
  cdp: string
  timeoutMs: number
}): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      input.python,
      [input.script, '--url', input.url, '--out-dir', input.outDir, '--cdp', input.cdp, '--wait-s', '40'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      },
    )
    let stdout = ''
    let stderr = ''
    const max = 8000
    child.stdout?.on('data', (b) => {
      stdout += String(b)
      if (stdout.length > max) stdout = stdout.slice(-max)
    })
    child.stderr?.on('data', (b) => {
      // strip any accidental URLs
      const chunk = String(b).replace(/https?:\/\/\S+/g, '<url>')
      stderr += chunk
      if (stderr.length > max) stderr = stderr.slice(-max)
    })
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {}
    }, input.timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ exitCode: code ?? 1, stdout, stderr })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolvePromise({ exitCode: 32, stdout, stderr: stderr + `\nspawn_error:${e.message}` })
    })
  })
}

export async function runChromeCdpPageMediaDownload(input: {
  spaceId: string
  slot: string
  source: string
  cdp?: string
  python?: string
}): Promise<{ success: boolean; task: PageMediaTask; capability: ReturnType<typeof pageMediaCapabilityReport> }> {
  const spaceId = String(input.spaceId || '').trim()
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  if (!isMaterialSlot(String(input.slot || ''))) throw new Error('槽位只能是产品、门店或 Logo')
  const slot = String(input.slot) as MaterialSlot
  const parsed = parseDySource(input.source)
  if (!parsed.ok) {
    throw Object.assign(new Error(parsed.error), { code: 'bad_url' })
  }

  const task: PageMediaTask = {
    id: `cdp-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    spaceId,
    slot,
    source: String(input.source || '').trim(),
    platform: 'dy',
    status: 'queued',
    runner: 'chrome-cdp-page-media',
    mock: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    note: '本机 Chrome CDP 观察页面播放媒体流 → 素材库（非 MediaCrawler detail CLI）',
  }
  upsert(spaceId, task)

  const cdp = input.cdp || DEFAULT_CDP
  const probe = await probeChromeCdp(cdp)
  if (!probe.ok) {
    task.status = 'needs_setup'
    task.code = 'cdp_unavailable'
    task.error = `本机 Chrome CDP 不可用：${probe.error}`
    task.nextStep = '请使用已在 127.0.0.1:9222 开启调试的本机 Chrome（用户现有会话）；插件不会改 Chrome 启动参数或读取凭证文件。'
    task.updatedAt = Date.now()
    upsert(spaceId, task)
    return { success: false, task, capability: pageMediaCapabilityReport() }
  }

  const py = input.python || detectMcPython()
  const script = pageMediaScriptPath()
  if (!py || !existsSync(script)) {
    task.status = 'needs_setup'
    task.code = 'needs_setup'
    task.error = !py ? '未找到 MediaCrawler .venv python' : '缺少 download_dy_page_media.py'
    task.updatedAt = Date.now()
    upsert(spaceId, task)
    return { success: false, task, capability: pageMediaCapabilityReport() }
  }

  const outDir = join(jobsRoot(spaceId), task.id, 'out')
  mkdirSync(outDir, { recursive: true })
  task.status = 'running'
  task.updatedAt = Date.now()
  upsert(spaceId, task)

  const result = await runWorker({
    python: py,
    script,
    url: parsed.url,
    outDir,
    cdp,
    timeoutMs: 180_000,
  })

  task.exitCode = result.exitCode
  task.detail = result.stderr.slice(-2000)
  const video = join(outDir, 'video.mp4')
  const cover = join(outDir, 'cover.jpg')
  const videoOnly = result.exitCode === 48 && existsSync(video)
  if (result.exitCode !== 0 && !videoOnly) {
    const mapped = mapExit(result.exitCode)
    task.status = 'failed'
    task.code = mapped.code
    task.error = mapped.error
    task.nextStep = mapped.nextStep
    task.note = result.exitCode === 46
      ? '完整性校验未通过（缺音轨）；未入库。旧无声音频测试素材请人工甄别，插件不自动删除。'
      : task.note
    task.mediaFiles = [video, cover].filter((f) => existsSync(f))
    task.updatedAt = Date.now()
    upsert(spaceId, task)
    return { success: false, task, capability: pageMediaCapabilityReport() }
  }

  if (!existsSync(video) || (!videoOnly && !existsSync(cover))) {
    task.status = 'failed'
    task.code = 'no_media'
    task.error = 'worker 成功码但缺少 video.mp4/cover.jpg'
    task.updatedAt = Date.now()
    upsert(spaceId, task)
    return { success: false, task, capability: pageMediaCapabilityReport() }
  }

  const videoItem = addStudioMaterial(spaceId, slot, `dy-${task.id}.mp4`, readFileSync(video))
  pruneDownloadSidecarCovers(spaceId)
  task.materials = [videoItem]
  task.mediaFiles = [video, cover].filter((f) => existsSync(f))
  task.status = 'succeeded'
  task.code = videoOnly ? 'video_only' : task.code
  task.note = videoOnly ? '已入库画面；这条没有单独音轨。' : task.note
  task.updatedAt = Date.now()
  upsert(spaceId, task)
  return { success: true, task, capability: pageMediaCapabilityReport() }
}

export function pageMediaCapabilityReport() {
  return {
    adapter: 'chrome-cdp-page-media',
    cdpDefault: DEFAULT_CDP,
    platforms: ['dy'] as const,
    readsCookieFiles: false,
    modifiesChromeLaunch: false,
    logsSignedUrls: false,
    note: '依赖用户本机已开调试端口的 Chrome 正常播放会话；与发布账号、MediaCrawler detail CLI 隔离。',
  }
}
