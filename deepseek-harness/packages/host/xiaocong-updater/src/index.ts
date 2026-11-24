import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import type { Context } from '@deepseek-ai/cordis'
// Empty type import: merges `webServer` into the Context interface.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { ROUTE, type XcyUpdateRelease, type XcyUpdateStatus } from './shared.js'

export { ROUTE } from './shared.js'
export type { XcyUpdateRelease, XcyUpdateStatus } from './shared.js'

export const name = 'xiaocong-updater'

/** Only the web server is required; same injection contract as xiaocong-auth. */
export const inject = ['webServer']

/** Default feed on the XiaocongAPI console; override with XIAOCONG_UPDATE_URL. */
const DEFAULT_FEED = 'https://xiaocongapi.azheteng.cn/xiaocongseek/latest.json'
/** First background check delay after boot, then the steady interval. */
const FIRST_CHECK_DELAY_MS = 8_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
/** Per-request network cap. */
const FETCH_TIMEOUT_MS = 12_000

interface DownloadState {
  phase: 'idle' | 'downloading' | 'done' | 'failed'
  progress: number
  downloadedBytes: number
  totalBytes: number
  path: string | null
}

interface UpdaterState {
  checking: boolean
  lastCheckAt: string | null
  latest: XcyUpdateRelease | null
  error?: string
  download: DownloadState
}

const download = (state: UpdaterState, value: Partial<DownloadState>): void => {
  state.download = { ...state.download, ...value }
}

/** Compare dotted numeric versions; missing segments count as 0. */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(n => Number.parseInt(n, 10) || 0)
  const right = b.split('.').map(n => Number.parseInt(n, 10) || 0)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    if (l !== r) return l - r
  }
  return 0
}

/** Fetch text over http(s) with a hard timeout. */
function fetchText(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https://') ? httpsGet : httpGet
    const req = get(url, { headers: { accept: 'application/json', 'user-agent': 'Xiaocongseek-updater' } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`feed responded ${String(res.statusCode)}`))
          return
        }
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('feed request timed out')))
    req.on('error', reject)
  })
}

/** Stream a file to disk, reporting progress through the callback. */
function downloadFile(url: string, dest: string, onProgress: (downloaded: number, total: number) => void, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https://') ? httpsGet : httpGet
    const req = get(url, { headers: { 'user-agent': 'Xiaocongseek-updater' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        const target = res.headers.location
        if (typeof target !== 'string' || target.length === 0) {
          reject(new Error('redirect without location'))
          return
        }
        downloadFile(new URL(target, url).toString(), dest, onProgress, timeoutMs).then(resolve, reject)
        return
      }
      if ((res.statusCode ?? 0) >= 400) {
        reject(new Error(`download responded ${String(res.statusCode)}`))
        return
      }
      const total = Number(res.headers['content-length'] ?? 0)
      const out = createWriteStream(dest)
      let received = 0
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        onProgress(received, total)
      })
      res.pipe(out)
      out.on('finish', () => resolve())
      out.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('download timed out')))
    req.on('error', reject)
  })
}

/** Turn transport-level failures into short, non-technical copy for the UI. */
function friendlyFeedError(message: string): string {
  const status = /^feed responded (\d+)/u.exec(message)
  if (status !== null) {
    const code = status[1] ?? ''
    if (code === '404') return '更新服务器上还没有发布版本信息，请稍后再试'
    return `更新服务器返回异常（HTTP ${code}）`
  }
  // A site-wide SPA fallback answers with the homepage HTML; that means the
  // feed file has not been published yet.
  if (message === 'feed is not valid JSON') return '更新服务器上还没有发布版本信息，请稍后再试'
  if (message.startsWith('feed must be') || message.startsWith('feed missing')) {
    return '更新服务器返回的版本信息不完整'
  }
  if (message.includes('timed out')) return '连接更新服务器超时，请稍后重试'
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/u.test(message)) return '连不上更新服务器，请检查网络后重试'
  return message
}

/** Same treatment for download failures. */
function friendlyDownloadError(message: string): string {
  const status = /^download responded (\d+)/u.exec(message)
  if (status !== null) return `更新包下载失败（HTTP ${status[1] ?? ''}）`
  if (message.includes('timed out')) return '下载超时，请重试'
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/u.test(message)) return '下载失败，请检查网络后重试'
  return message
}

/** Parse and validate a feed body into a release record. */
function parseRelease(raw: string): XcyUpdateRelease {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('feed is not valid JSON')
  }
  if (typeof value !== 'object' || value === null) throw new Error('feed must be a JSON object')
  const record = value as Record<string, unknown>
  const version = typeof record.version === 'string' ? record.version.trim() : ''
  const dmgUrl = typeof record.dmgUrl === 'string' ? record.dmgUrl.trim() : ''
  const exeUrl = typeof record.exeUrl === 'string' ? record.exeUrl.trim() : ''
  if (version === '') throw new Error('feed missing version')
  // A feed may publish one platform only; readers on the other platform get a
  // clear "no installer for this system" error when they try to download.
  if (dmgUrl === '' && exeUrl === '') throw new Error('feed missing dmgUrl and exeUrl')
  const notes = typeof record.notes === 'string' ? record.notes : undefined
  const publishedAt = typeof record.publishedAt === 'string' ? record.publishedAt : undefined
  const minVersion = typeof record.minVersion === 'string' ? record.minVersion : undefined
  return {
    version,
    ...(dmgUrl !== '' ? { dmgUrl } : {}),
    ...(exeUrl !== '' ? { exeUrl } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    ...(minVersion !== undefined ? { minVersion } : {}),
  }
}

/** Feed field that carries the installer for the running platform. */
function releaseUrlFor(release: XcyUpdateRelease): string | null {
  if (process.platform === 'win32') return release.exeUrl ?? null
  if (process.platform === 'darwin') return release.dmgUrl ?? null
  return release.dmgUrl ?? release.exeUrl ?? null
}

/** File name to save the installer under; keeps the URL name when it has one. */
function installerFileName(url: string, version: string): string {
  let fromUrl = ''
  try {
    fromUrl = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
  } catch {
    fromUrl = ''
  }
  if (fromUrl !== '') return fromUrl
  const extension = process.platform === 'win32' ? 'exe' : 'dmg'
  const arch = process.platform === 'win32' ? 'win-x64' : 'mac-arm64'
  return `xiaocongseek-${version}-${arch}.${extension}`
}

export function apply(ctx: Context): void {
  const feedUrl = (process.env.XIAOCONG_UPDATE_URL ?? DEFAULT_FEED).replace(/\/+$/, '')
  const state: UpdaterState = {
    checking: false,
    lastCheckAt: null,
    latest: null,
    download: { phase: 'idle', progress: 0, downloadedBytes: 0, totalBytes: 0, path: null },
  }

  // The desktop shell stamps the client version into the host environment as
  // DSH_CLIENT_VERSION (apps/desktop/src/main.ts). Read that first; fall back
  // to the XIAOCONG_APP_VERSION stamp for tests, then to Electron itself.
  const readElectronVersion = (): string | null => {
    try {
      // The bundle is CJS and electron is external, so require resolves to
      // Electron's built-in module inside the main process.
      const electronApi = require('electron') as { app?: { getVersion?: () => string } } | undefined
      const version = electronApi?.app?.getVersion?.()
      if (version !== undefined && version.length > 0) return version
    } catch (error) {
      ctx.logger.warn('xiaocong-updater: electron version read failed', error)
    }
    return null
  }
  const currentVersion = process.env.DSH_CLIENT_VERSION
    ?? process.env.XIAOCONG_APP_VERSION
    ?? readElectronVersion()
    ?? '0.0.0'

  const snapshot = (): XcyUpdateStatus => {
    // The downloaded file may have been removed (or cleaned up) between
    // requests; report it as idle so the panel offers the download again.
    if (state.download.phase === 'done' && state.download.path !== null && !existsSync(state.download.path)) {
      download(state, { phase: 'idle', progress: 0, downloadedBytes: 0, totalBytes: 0, path: null })
    }
    const latest = state.latest
    const hasUpdate = latest !== null && compareVersions(currentVersion, latest.version) < 0
    const updateRequired = latest !== null && latest.minVersion !== undefined
      && compareVersions(currentVersion, latest.minVersion) < 0
    return {
      success: true,
      currentVersion,
      feedUrl,
      platform: process.platform,
      checking: state.checking,
      lastCheckAt: state.lastCheckAt,
      latest,
      hasUpdate,
      updateRequired,
      download: { ...state.download },
      ...(state.error ? { error: state.error } : {}),
      autoCheck: true,
    }
  }

  const check = async (): Promise<void> => {
    if (state.checking) return
    state.checking = true
    delete state.error
    try {
      const raw = await fetchText(feedUrl, FETCH_TIMEOUT_MS)
      const release = parseRelease(raw)
      state.latest = release
      state.lastCheckAt = new Date().toISOString()
      // A finished download for an older version is stale.
      if (state.download.phase === 'done' && state.download.path !== null) {
        const stale = state.download.path.includes(release.version) === false
        if (stale) download(state, { phase: 'idle', progress: 0, downloadedBytes: 0, totalBytes: 0, path: null })
      }
    } catch (error) {
      state.error = friendlyFeedError(error instanceof Error ? error.message : String(error))
    } finally {
      state.checking = false
    }
  }

  const startDownload = (): Promise<void> => {
    const latest = state.latest
    if (latest === null) return Promise.reject(new Error('还没有可用的更新信息，先检查一次'))
    if (state.download.phase === 'downloading') return Promise.reject(new Error('下载已在进行中'))
    const url = releaseUrlFor(latest)
    if (url === null) {
      return Promise.reject(new Error('更新服务器没有提供当前系统的安装包'))
    }
    const downloadsDir = join(homedir(), 'Downloads')
    mkdirSync(downloadsDir, { recursive: true })
    const dest = join(downloadsDir, installerFileName(url, latest.version))
    if (existsSync(dest) && statSync(dest).size > 0) {
      // Assume a fully downloaded file with the same name is reusable.
      const size = statSync(dest).size
      download(state, { phase: 'done', progress: 1, downloadedBytes: size, totalBytes: size, path: dest })
      return Promise.resolve()
    }
    download(state, { phase: 'downloading', progress: 0, downloadedBytes: 0, totalBytes: 0, path: dest })
    delete state.error
    return downloadFile(
      url,
      dest,
      (received, total) => {
        download(state, {
          phase: 'downloading',
          downloadedBytes: received,
          totalBytes: total,
          progress: total > 0 ? Math.min(received / total, 1) : 0,
          path: dest,
        })
      },
      10 * 60 * 1000,
    ).then(() => {
      const size = existsSync(dest) ? statSync(dest).size : 0
      download(state, { phase: 'done', progress: 1, downloadedBytes: size, totalBytes: size, path: dest })
    }).catch((error) => {
      download(state, { phase: 'failed', progress: 0, path: dest })
      state.error = friendlyDownloadError(error instanceof Error ? error.message : String(error))
    })
  }

  /** Launch the downloaded Windows installer; setup must outlive the shell it replaces. */
  const launchInstaller = (path: string): Promise<void> => new Promise((resolve, reject) => {
    const child = spawn(path, [], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })

  /** Mount the macOS DMG and show its volume in Finder. */
  const mountDmg = async (path: string): Promise<void> => {
    // `open <dmg>` relies on LaunchServices, which the shell host process cannot
    // always reach (it fails with -600 procNotFound). Mount the image with
    // hdiutil instead, which is independent of LaunchServices, then let Finder
    // show the mounted volume on a best-effort basis.
    let volume = await findMountedVolume(path)
    if (volume === null) {
      await execTool('hdiutil', ['attach', '-noverify', path])
      volume = await findMountedVolume(path)
    }
    if (volume !== null) {
      try {
        await execTool('open', [volume])
      } catch (error) {
        // The image is mounted either way; Finder just could not be asked.
        ctx.logger.warn('xiaocong-updater: open volume failed', error)
      }
    }
  }

  const install = async (): Promise<void> => {
    const path = state.download.phase === 'done' ? state.download.path : null
    if (path === null || !existsSync(path)) throw new Error('请先完成下载')
    if (process.platform === 'win32') {
      await launchInstaller(path)
      return
    }
    if (process.platform === 'darwin') {
      await mountDmg(path)
      return
    }
    throw new Error('当前系统不支持自动安装，请手动打开下载的更新包')
  }

  const findMountedVolume = async (dmgPath: string): Promise<string | null> => {
    try {
      const info = await execTool('hdiutil', ['info'])
      let inTarget = false
      for (const line of info.split('\n')) {
        if (line.includes('image-path')) inTarget = line.includes(dmgPath)
        if (inTarget) {
          const match = line.match(/\/Volumes\/[^\t]+/u)
          if (match !== null) return match[0].trim()
        }
      }
    } catch {
      // hdiutil info is best-effort; attach will surface real failures.
    }
    return null
  }

  const execTool = (file: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) reject(error)
      else resolve(stdout)
    })
  })

  // ── Shell routes ──────────────────────────────────────────────────────────
  const crossOrigin = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin
    if (typeof origin !== 'string' || origin.length === 0) return false
    let host: string
    try {
      host = new URL(origin).host
    } catch {
      return true
    }
    return host !== '127.0.0.1' && host !== 'localhost'
  }
  const sendJson = (res: ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  const register = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): void => {
    try {
      ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), `xiaocong-updater: ${path}`)
    } catch (error) {
      ctx.logger.warn(`xiaocong-updater: register ${path} failed (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  register(ROUTE.updateStatus, (req, res) => {
    if (req.method !== 'GET') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    if (crossOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
    sendJson(res, 200, snapshot())
  })

  register(ROUTE.updateCheck, async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    if (crossOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
    if (state.checking) { sendJson(res, 200, snapshot()); return }
    await check()
    sendJson(res, 200, snapshot())
  })

  register(ROUTE.updateDownload, (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    if (crossOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
    if (state.latest === null) {
      sendJson(res, 200, { ...snapshot(), error: '还没有可用的更新信息，先检查一次' })
      return
    }
    if (state.download.phase === 'downloading') { sendJson(res, 200, snapshot()); return }
    // Answer right away with the fresh "downloading" state; the panel polls
    // /status for progress. Waiting for the whole transfer here would leave the
    // UI stuck on its previous state until the download finished.
    void startDownload().catch(() => { /* download() reports its own error state */ })
    sendJson(res, 202, snapshot())
  })

  register(ROUTE.updateInstall, async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    if (crossOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
    try {
      await install()
      sendJson(res, 200, snapshot())
    } catch (error) {
      sendJson(res, 500, { ...snapshot(), error: error instanceof Error ? error.message : String(error) })
    }
  })

  // ── Background schedule ───────────────────────────────────────────────────
  const first = setTimeout(() => { void check() }, FIRST_CHECK_DELAY_MS)
  if (typeof first.unref === 'function') first.unref()
  const interval = setInterval(() => { void check() }, CHECK_INTERVAL_MS)
  if (typeof interval.unref === 'function') interval.unref()
  ctx.effect(() => () => {
    clearTimeout(first)
    clearInterval(interval)
  }, 'xiaocong-updater: schedule')
}
