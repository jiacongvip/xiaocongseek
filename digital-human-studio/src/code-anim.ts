/**
 * 内置 341 种代码动画风格提示词库 + 确定性 HTML -> MP4/WebM 渲染器。
 *
 * 设计要点：
 * - index.json 轻量索引放内存缓存，绝不把 341 份长提示词一次塞进上下文。
 * - AI 先按关键词/系列检索前 N 条，再按编号精读 1 份完整 .md 提示词。
 * - 渲染直接用 Node 原生 WebSocket + Chrome/Edge/Chromium CDP 逐帧截图直喂 ffmpeg：
 *   不依赖 Python playwright，Mac/Windows 开箱即用，支持竖屏 1080×1920、横屏 1920×1080、透明底 WebM。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { IS_WIN, findMediaTool, whichSync } from './platform.js'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STYLES_ROOT = join(PLUGIN_ROOT, 'assets', 'code-anim-styles')
const INDEX_PATH = join(STYLES_ROOT, 'index.json')

export type CodeAnimStyleItem = {
  id: string
  name: string
  series: string
  seriesLabel: string
  category: string
  summary: string
  suitable: string
  keywords: string
  hasStill: boolean
  hasCode: boolean
  featured: boolean
  mdPath: string
  stillPath: string
}

export type CodeAnimIndex = {
  version: number
  total: number
  withStill: number
  featuredCount: number
  series: Array<{ code: string; label: string; count: number }>
  items: CodeAnimStyleItem[]
}

let cachedIndex: CodeAnimIndex | null = null

export function loadCodeAnimIndex(): CodeAnimIndex {
  if (cachedIndex) return cachedIndex
  if (!existsSync(INDEX_PATH)) {
    return { version: 1, total: 0, withStill: 0, featuredCount: 0, series: [], items: [] }
  }
  const parsed = JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as CodeAnimIndex
  cachedIndex = parsed
  return parsed
}

export function listCodeAnimStyles(opts?: {
  query?: string
  series?: string
  featuredOnly?: boolean
  hasStill?: boolean
  limit?: number
}) {
  const idx = loadCodeAnimIndex()
  const q = String(opts?.query || '').trim().toLowerCase()
  const series = String(opts?.series || '').trim().toUpperCase()
  const featuredOnly = !!opts?.featuredOnly
  const hasStill = opts?.hasStill === true
  const limit = Math.max(1, Math.min(100, Number(opts?.limit) || 24))

  let list = idx.items
  if (series) {
    list = list.filter((it) => it.series.toUpperCase() === series)
  }
  if (hasStill) {
    list = list.filter((it) => it.hasStill)
  }
  if (featuredOnly) {
    list = list.filter((it) => it.featured)
  }
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean)
    const scored = list
      .map((it) => {
        const hay = `${it.id} ${it.name} ${it.category} ${it.summary} ${it.suitable} ${it.keywords}`.toLowerCase()
        let score = 0
        for (const t of terms) {
          if (it.id.toLowerCase() === t) score += 100
          else if (it.name.toLowerCase().includes(t)) score += 30
          else if (hay.includes(t)) score += 10
        }
        if (score > 0 && it.featured) score += 4
        if (score > 0 && it.hasStill) score += 2
        return { it, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
    list = scored.map((x) => x.it)
  } else if (!series && !featuredOnly) {
    const featured = list.filter((it) => it.featured)
    const rest = list.filter((it) => !it.featured && it.hasStill)
    list = [...featured, ...rest]
  }

  const matched = list.length
  const items = list.slice(0, limit).map((it) => ({
    id: it.id,
    name: it.name,
    series: it.series,
    category: it.category,
    summary: it.summary,
    suitable: it.suitable,
    keywords: it.keywords,
    hasStill: it.hasStill,
    hasCode: it.hasCode,
    featured: it.featured,
    stillUrl: it.stillPath ? `/digital-human-studio/code-anim/still?path=${encodeURIComponent(it.stillPath)}` : '',
  }))

  return {
    success: true,
    total: idx.total,
    withStill: idx.withStill,
    matched,
    returned: items.length,
    series: idx.series,
    items,
  }
}

export function getCodeAnimStyle(idOrQuery: string, orientation: 'vertical' | 'horizontal' | 'auto' = 'auto') {
  const idx = loadCodeAnimIndex()
  const key = String(idOrQuery || '').trim()
  if (!key) {
    return { success: false, error: '请传入风格编号（如 L42、Z5、B6、H1）或风格名称' }
  }
  const lower = key.toLowerCase()
  const found =
    idx.items.find((it) => it.id.toLowerCase() === lower) ||
    idx.items.find((it) => it.name.toLowerCase() === lower) ||
    idx.items.find((it) => it.name.toLowerCase().includes(lower))
  if (!found) {
    return {
      success: false,
      error: `找不到代码动画风格「${key}」，请先调用 list 接口按关键词检索`,
    }
  }
  const absMd = resolve(STYLES_ROOT, found.mdPath)
  if (!existsSync(absMd)) {
    return { success: false, error: `风格提示词文件缺失：${found.mdPath}` }
  }
  const prompt = readFileSync(absMd, 'utf8')
  const stillAbs = found.stillPath ? resolve(STYLES_ROOT, found.stillPath) : ''
  const aspectHint =
    orientation === 'vertical'
      ? '【竖屏口播适配要求】请将 canvas / 视口画幅改为 1080×1920（9:16 竖屏）并做纵向居中构图适配；严格保留本风格的配色、字体质感、图形语言与动效语法；必须暴露全局 window.draw(t)（t 为秒）与 window.__T_END = 总秒数，且支持 ?t=秒 静态定位与确定性渲染。'
      : orientation === 'horizontal'
        ? '【横屏适配要求】画幅 1920×1080（16:9）；必须暴露全局 window.draw(t)（t 为秒）与 window.__T_END = 总秒数，且支持 ?t=秒 静态定位与确定性渲染。'
        : '【渲染规范】必须输出完整单文件 HTML（无外部网络依赖），暴露全局 window.draw(t)（t 为秒）与 window.__T_END = 总秒数，并支持 ?t=秒 定位（若做竖屏口播插片请用 1080×1920，横屏请用 1920×1080）。'

  return {
    success: true,
    id: found.id,
    name: found.name,
    series: found.series,
    seriesLabel: found.seriesLabel,
    category: found.category,
    summary: found.summary,
    suitable: found.suitable,
    hasStill: found.hasStill,
    hasCode: found.hasCode,
    stillUrl: found.stillPath ? `/digital-human-studio/code-anim/still?path=${encodeURIComponent(found.stillPath)}` : '',
    stillFilePath: stillAbs && existsSync(stillAbs) ? stillAbs : '',
    aspectHint,
    prompt,
  }
}

export function resolveCodeAnimStillPath(relPath: string): string {
  const clean = String(relPath || '').trim().replace(/^\/+/, '')
  if (!clean || clean.includes('..') || !clean.startsWith('styles/')) return ''
  const abs = resolve(STYLES_ROOT, clean)
  const rootPrefix = STYLES_ROOT.endsWith(sep) ? STYLES_ROOT : STYLES_ROOT + sep
  if (!abs.startsWith(rootPrefix)) return ''
  if (!existsSync(abs)) return ''
  return abs
}

function findChromiumInPlaywrightDir(dir: string): string {
  if (!dir || !existsSync(dir)) return ''
  try {
    const entries = readdirSync(dir).filter((n) => n.startsWith('chromium-')).sort().reverse()
    for (const entry of entries) {
      const base = join(dir, entry)
      const bins = IS_WIN
        ? [join(base, 'chrome-win', 'chrome.exe'), join(base, 'chrome-win64', 'chrome.exe')]
        : process.platform === 'darwin'
          ? [
              join(base, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
              join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
              join(base, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            ]
          : [join(base, 'chrome-linux', 'chrome')]
      for (const b of bins) {
        if (existsSync(b)) return b
      }
    }
  } catch { /* ignore */ }
  return ''
}

function findHeadlessBrowser(): string {
  const envBin = (process.env.XIAOCONG_CHROME_PATH || '').trim()
  if (envBin && existsSync(envBin)) return envBin

  const publishRuntimeRoot = (process.env.PUBLISH_STUDIO_RUNTIME_ROOT || '').trim() || join(homedir(), '.dsh', 'publish-studio', 'runtime')
  const pwCandidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH || '',
    join(publishRuntimeRoot, 'browsers'),
    IS_WIN ? join(process.env.LOCALAPPDATA || '', 'ms-playwright') : join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
  ]
  for (const dir of pwCandidates) {
    const hit = findChromiumInPlaywrightDir(dir)
    if (hit) return hit
  }

  const sysCandidates = IS_WIN
    ? [
        join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        ]
      : [whichSync('google-chrome'), whichSync('chromium'), whichSync('chromium-browser')]

  for (const c of sysCandidates) {
    if (c && existsSync(c)) return c
  }
  return ''
}

const VIRTUAL_CLOCK_SCRIPT = `(() => {
  if (window.__xcyVirtualClockInstalled) return;
  window.__xcyVirtualClockInstalled = true;
  let nowMs = 0;
  let nextId = 1;
  const callbacks = new Map();
  const baseDate = Date.now();
  window.__xcyEnableVirtualClock = () => {
    performance.now = () => nowMs;
    Date.now = () => baseDate + Math.floor(nowMs);
    window.requestAnimationFrame = (cb) => { const id = nextId++; callbacks.set(id, cb); return id; };
    window.cancelAnimationFrame = (id) => { callbacks.delete(id); };
    window.__xcyStepMs = (targetMs) => {
      nowMs = targetMs;
      const batch = Array.from(callbacks.entries());
      callbacks.clear();
      for (const [, cb] of batch) { try { cb(nowMs); } catch (_) {} }
    };
  };
})();`

class CdpClient {
  private ws: WebSocket
  private seq = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private waiters = new Map<string, Array<() => void>>()

  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString('utf8'))
        if (typeof msg.id === 'number') {
          const p = this.pending.get(msg.id)
          if (p) {
            this.pending.delete(msg.id)
            if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
            else p.resolve(msg.result)
          }
        } else if (typeof msg.method === 'string') {
          const list = this.waiters.get(msg.method)
          if (list && list.length) {
            this.waiters.delete(msg.method)
            for (const fn of list) fn()
          }
        }
      } catch { /* ignore */ }
    })
  }

  static async connect(wsUrl: string): Promise<CdpClient> {
    const ws = new WebSocket(wsUrl)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP 连接超时')), 15000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      ws.addEventListener('error', (e: any) => { clearTimeout(timer); reject(new Error(`CDP 连接失败: ${e?.message || 'error'}`)) }, { once: true })
    })
    return new CdpClient(ws)
  }

  send(method: string, params?: Record<string, unknown>, timeoutMs = 20000): Promise<any> {
    const id = this.seq++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP ${method} 超时`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.ws.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }))
    })
  }

  waitEvent(method: string, timeoutMs = 20000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待 ${method} 超时`)), timeoutMs)
      const list = this.waiters.get(method) || []
      list.push(() => { clearTimeout(timer); resolve() })
      this.waiters.set(method, list)
    })
  }

  close() {
    try { this.ws.close() } catch { /* ignore */ }
  }
}

export async function renderCodeAnimHtml(opts: {
  htmlPath?: string
  html?: string
  outputPath?: string
  width?: number
  height?: number
  fps?: number
  duration?: number
  transparent?: boolean
  workDir?: string
}): Promise<{
  success: boolean
  output?: string
  htmlPath?: string
  width?: number
  height?: number
  fps?: number
  duration?: number
  frames?: number
  transparent?: boolean
  mode?: string
  sizeBytes?: number
  error?: string
}> {
  const workDir = opts.workDir || join(homedir(), '.xiaocongcut', 'code-anim')
  mkdirSync(workDir, { recursive: true })

  let htmlPath = String(opts.htmlPath || '').trim()
  if (!htmlPath && opts.html) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    htmlPath = join(workDir, `anim-${stamp}.html`)
    writeFileSync(htmlPath, String(opts.html), 'utf8')
  }
  if (!htmlPath || !existsSync(htmlPath)) {
    return { success: false, error: `请提供存在的 html_path 或完整的 html 内容（当前：${htmlPath || '空'}）` }
  }

  const ffmpeg = findMediaTool(PLUGIN_ROOT, 'ffmpeg')
  if (!ffmpeg) {
    return { success: false, error: '找不到 ffmpeg，无法编码代码动画视频' }
  }
  const chromeBin = findHeadlessBrowser()
  if (!chromeBin) {
    return { success: false, error: '找不到 Chrome / Edge / Chromium 浏览器，请安装 Chrome/Edge 或「发布运行时」' }
  }

  const htmlText = readFileSync(htmlPath, 'utf8')
  const supportsQueryT = htmlText.includes('URLSearchParams') || htmlText.includes('location.search')
  let width = Math.round(Number(opts.width) || 0)
  let height = Math.round(Number(opts.height) || 0)
  if (width <= 0 || height <= 0) {
    const m = /<canvas[^>]*\bwidth=["']?(\d+)["']?[^>]*\bheight=["']?(\d+)/i.exec(htmlText)
    if (m) {
      width = width || Number(m[1])
      height = height || Number(m[2])
    } else {
      width = width || 1080
      height = height || 1920
    }
  }
  width -= width % 2
  height -= height % 2
  const fps = Math.max(1, Math.min(60, Math.round(Number(opts.fps) || 30)))
  const transparent = !!opts.transparent

  const ext = transparent ? '.webm' : '.mp4'
  let outPath = String(opts.outputPath || '').trim()
  if (!outPath) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    outPath = join(workDir, `anim-${stamp}${ext}`)
  }
  mkdirSync(dirname(outPath), { recursive: true })

  const userDataDir = mkdtempSync(join(tmpdir(), 'xcy-anim-chrome-'))
  const chromeArgs = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${width},${height}`,
    'about:blank',
  ]

  const chrome = spawn(chromeBin, chromeArgs, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })

  let cdp: CdpClient | null = null
  try {
    const debugPort = await new Promise<number>((resolvePort, rejectPort) => {
      let errBuf = ''
      const timer = setTimeout(() => rejectPort(new Error(`启动无头浏览器超时：${errBuf.slice(-400)}`)), 20000)
      chrome.stderr?.on('data', (chunk) => {
        errBuf += chunk.toString()
        const m = /DevTools listening on ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)\//i.exec(errBuf)
        if (m) {
          clearTimeout(timer)
          resolvePort(Number(m[1]))
        }
      })
      chrome.on('error', (e) => { clearTimeout(timer); rejectPort(e) })
      chrome.on('exit', (code) => { clearTimeout(timer); rejectPort(new Error(`无头浏览器提前退出（code ${code}）：${errBuf.slice(-400)}`)) })
    })

    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()) as any[]
    const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || targets[0]
    if (!pageTarget?.webSocketDebuggerUrl) {
      return { success: false, htmlPath, error: '无法获取无头浏览器页面调试地址' }
    }

    cdp = await CdpClient.connect(String(pageTarget.webSocketDebuggerUrl))
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    if (transparent) {
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 },
      })
    }
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: VIRTUAL_CLOCK_SCRIPT })

    const fileUrl = pathToFileURL(resolve(htmlPath)).href
    const openUrl = supportsQueryT ? `${fileUrl}?t=0` : fileUrl
    const loadWait = cdp.waitEvent('Page.loadEventFired', 25000)
    await cdp.send('Page.navigate', { url: openUrl })
    await loadWait
    await new Promise((r) => setTimeout(r, 120))

    const probeRes = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        drawFn: typeof window.__draw === 'function' ? '__draw' : (typeof window.draw === 'function' ? 'draw' : ''),
        tEnd: Number(window.__T_END || window.T_END || window.DURATION || 0) || 0
      })`,
      returnByValue: true,
    })
    const probe = JSON.parse(String(probeRes?.result?.value || '{}'))
    const drawFn = String(probe.drawFn || '')
    const detectedEnd = Number(probe.tEnd) > 0 ? Number(probe.tEnd) : 0
    const duration = Math.max(0.5, Math.min(180, Number(opts.duration) || detectedEnd || 6.0))
    const totalFrames = Math.max(1, Math.round(duration * fps))

    let mode = 'virtual_clock'
    if (drawFn) {
      mode = `window.${drawFn}`
    } else if (supportsQueryT) {
      mode = 'query_t'
    } else {
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: 'window.__xcyEnableVirtualClock && window.__xcyEnableVirtualClock();',
      })
      const reloadWait = cdp.waitEvent('Page.loadEventFired', 25000)
      await cdp.send('Page.navigate', { url: fileUrl })
      await reloadWait
    }

    if (transparent) {
      await cdp.send('Runtime.evaluate', {
        expression: 'document.documentElement.style.background="transparent";document.body.style.background="transparent";',
      })
    }

    const ffArgs = transparent
      ? [
          '-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(fps), '-i', '-',
          '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '26', '-auto-alt-ref', '0',
          outPath,
        ]
      : [
          '-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(fps), '-i', '-',
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
          outPath,
        ]

    const ff = spawn(ffmpeg, ffArgs, {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let ffErr = ''
    ff.stderr?.on('data', (c) => { ffErr += c.toString() })

    const ffDone = new Promise<number | null>((resolveExit, rejectExit) => {
      ff.on('error', rejectExit)
      ff.on('close', resolveExit)
    })

    for (let i = 0; i < totalFrames; i += 1) {
      const t = i / fps
      if (drawFn) {
        await cdp.send('Runtime.evaluate', {
          expression: `window[${JSON.stringify(drawFn)}](${t})`,
          awaitPromise: true,
        })
      } else if (mode === 'query_t') {
        const w = cdp.waitEvent('Page.loadEventFired', 15000)
        await cdp.send('Page.navigate', { url: `${fileUrl}?t=${t.toFixed(4)}` })
        await w
      } else {
        await cdp.send('Runtime.evaluate', {
          expression: `window.__xcyStepMs && window.__xcyStepMs(${t * 1000})`,
        })
      }
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const png = Buffer.from(String(shot?.data || ''), 'base64')
      if (!ff.stdin.write(png)) {
        await new Promise<void>((r) => ff.stdin.once('drain', r))
      }
    }
    ff.stdin.end()

    const exitCode = await ffDone
    if (exitCode !== 0 || !existsSync(outPath) || statSync(outPath).size === 0) {
      return {
        success: false,
        htmlPath,
        error: `ffmpeg 编码失败（exit ${exitCode}）：${ffErr.slice(-800)}`,
      }
    }

    return {
      success: true,
      output: outPath,
      htmlPath,
      width,
      height,
      fps,
      duration: Math.round(duration * 1000) / 1000,
      frames: totalFrames,
      transparent,
      mode,
      sizeBytes: statSync(outPath).size,
    }
  } catch (e: any) {
    return {
      success: false,
      htmlPath,
      error: e?.message || String(e),
    }
  } finally {
    if (cdp) cdp.close()
    try { chrome.kill('SIGKILL') } catch { /* ignore */ }
    try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
