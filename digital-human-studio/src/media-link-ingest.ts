/**
 * Independent media-link ingest → company materials.
 *
 * NOT MediaCrawler. Upstream MediaCrawler (/Users/.../MediaCrawler) uses
 * NON-COMMERCIAL LEARNING LICENSE 1.1 and depends on CDP/Playwright login-state
 * + JS signature extraction. That code must NOT be copied into this commercial
 * product. This module only accepts:
 *   - fixture: names under artifacts/media-ingest-fixtures (local test)
 *   - http(s)://127.0.0.1|localhost loopback URLs (controlled local servers)
 * Platform page URLs (xhs/dy/ks/bili/wb/tieba/zhihu) are rejected with an
 * actionable error — no session cookies, no private API, no MC exec.
 */
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { addStudioMaterial, isMaterialSlot, type MaterialSlot, type StudioMaterial } from './studio-materials.js'
import { isSpaceId, spaceAssetRoot } from './spaces.js'
import { isPathInside } from './platform.js'

export const MEDIA_INGEST_BLOCKED_REASON =
  'MediaCrawler 为「非商业学习许可证 1.1」，禁止未经书面授权的商业用途；且其下载依赖 CDP/Playwright 登录态与浏览器内签名，不属于可商用公开直链 CLI。本工具不会调用 MediaCrawler，也不会读取 cookies/login 缓存。'

const PLATFORM_PAGE_HOSTS = [
  /(^|\.)xiaohongshu\.com$/i,
  /(^|\.)xhscdn\.com$/i,
  /(^|\.)douyin\.com$/i,
  /(^|\.)iesdouyin\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)kuaishou\.com$/i,
  /(^|\.)gifshow\.com$/i,
  /(^|\.)bilibili\.com$/i,
  /(^|\.)bilivideo\.com$/i,
  /(^|\.)weibo\.com$/i,
  /(^|\.)weibo\.cn$/i,
  /(^|\.)zhihu\.com$/i,
  /(^|\.)tieba\.baidu\.com$/i,
  /(^|\.)baidu\.com$/i,
]

export type IngestTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'rejected'

export type IngestTask = {
  id: string
  spaceId: string
  slot: MaterialSlot
  source: string
  status: IngestTaskStatus
  createdAt: number
  updatedAt: number
  error?: string
  code?: string
  material?: StudioMaterial
  bytes?: number
  contentType?: string
  note?: string
}

const MAX_BYTES = 80 * 1024 * 1024
const FETCH_TIMEOUT_MS = 12_000

function pluginRoot(): string {
  // dist/media-link-ingest.js → ../ ; src during tsc emit same relative
  const here = dirname(fileURLToPath(import.meta.url))
  // when running from dist/, root is parent; when from src via tsx unlikely
  return existsSync(join(here, 'artifacts')) ? here : resolve(here, '..')
}

export function mediaIngestFixturesDir(): string {
  return join(pluginRoot(), 'artifacts', 'media-ingest-fixtures')
}

function tasksPath(spaceId: string): string {
  return join(spaceAssetRoot(spaceId), 'media-ingest', 'tasks.json')
}

function loadTasks(spaceId: string): IngestTask[] {
  const file = tasksPath(spaceId)
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveTasks(spaceId: string, tasks: IngestTask[]) {
  const file = tasksPath(spaceId)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(tasks.slice(0, 100), null, 2), 'utf8')
}

export function listIngestTasks(spaceId: string, limit = 20): IngestTask[] {
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  return loadTasks(spaceId)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.min(50, limit)))
}

export function getIngestTask(spaceId: string, id: string): IngestTask | undefined {
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  return loadTasks(spaceId).find((t) => t.id === id)
}

function upsertTask(spaceId: string, task: IngestTask) {
  const rows = loadTasks(spaceId).filter((t) => t.id !== task.id)
  rows.unshift(task)
  saveTasks(spaceId, rows)
}

export type UrlClass =
  | { ok: true; kind: 'fixture'; name: string }
  | { ok: true; kind: 'loopback'; url: URL }
  | { ok: false; code: string; error: string }

export function classifyMediaLink(raw: string): UrlClass {
  const source = String(raw || '').trim()
  if (!source) return { ok: false, code: 'empty', error: '链接不能为空' }

  if (/^fixture:/i.test(source)) {
    const name = source.slice('fixture:'.length).replace(/^\/+/, '')
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
      return { ok: false, code: 'bad_fixture', error: 'fixture 名非法（仅允许 fixtures 目录下文件名）' }
    }
    return { ok: true, kind: 'fixture', name }
  }

  let url: URL
  try {
    url = new URL(source)
  } catch {
    return { ok: false, code: 'bad_url', error: '无法解析为 URL' }
  }

  if (url.protocol === 'file:') {
    return { ok: false, code: 'file_blocked', error: '拒绝 file://；请用 fixture: 或本机 loopback HTTP' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'bad_scheme', error: '仅支持 http(s) 或 fixture:' }
  }

  const host = url.hostname.toLowerCase()
  if (PLATFORM_PAGE_HOSTS.some((re) => re.test(host))) {
    return {
      ok: false,
      code: 'platform_page_blocked',
      error: `拒绝平台页/CDN 主机 ${host}。${MEDIA_INGEST_BLOCKED_REASON}`,
    }
  }

  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
  if (!isLoopback) {
    return {
      ok: false,
      code: 'host_not_allowed',
      error:
        '本轮仅允许 fixture: 与 127.0.0.1/localhost 受控直链（防 SSRF）。公开平台页需合法商用授权 API/书面许可后另接，不调用 MediaCrawler。',
    }
  }

  // basic SSRF extras: no userinfo, no weird ports abuse beyond 1-65535 (URL already parses)
  if (url.username || url.password) {
    return { ok: false, code: 'userinfo_blocked', error: '拒绝带账号口令的 URL' }
  }

  return { ok: true, kind: 'loopback', url }
}

function safeFixturePath(name: string): string {
  const root = mediaIngestFixturesDir()
  const abs = resolve(join(root, name))
  if (!isPathInside(root, abs, true)) {
    throw Object.assign(new Error('fixture 路径越界'), { code: 'fixture_escape' })
  }
  if (!existsSync(abs)) throw Object.assign(new Error(`找不到 fixture: ${name}`), { code: 'fixture_missing' })
  return abs
}

async function fetchLoopback(url: URL): Promise<{ bytes: Buffer; contentType: string; fileName: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: ctrl.signal,
      headers: { accept: 'image/*,video/*,audio/*,application/octet-stream' },
    })
    if (!res.ok) {
      throw Object.assign(new Error(`下载失败 HTTP ${res.status}`), { code: 'http_status' })
    }
    const len = Number(res.headers.get('content-length') || 0)
    if (len > MAX_BYTES) {
      throw Object.assign(new Error('文件过大'), { code: 'too_large' })
    }
    const ab = await res.arrayBuffer()
    if (ab.byteLength > MAX_BYTES) {
      throw Object.assign(new Error('文件过大'), { code: 'too_large' })
    }
    const contentType = String(res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim()
    const pathName = basename(url.pathname) || 'download.bin'
    return { bytes: Buffer.from(ab), contentType, fileName: pathName }
  } finally {
    clearTimeout(timer)
  }
}

function guessName(fileName: string, contentType: string): string {
  const base = basename(String(fileName || 'download').split('?')[0] || 'download')
  if (extname(base)) return base.slice(0, 80)
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3',
  }
  return `${base.slice(0, 60)}${map[contentType] || '.bin'}`
}

export type IngestResult = {
  success: boolean
  task: IngestTask
  mediCrawlerIntegrated: false
  blockedReason?: string
}

export async function runMediaLinkIngest(input: {
  spaceId: string
  slot: string
  source: string
  fileName?: string
}): Promise<IngestResult> {
  const spaceId = String(input.spaceId || '').trim()
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  const slotRaw = String(input.slot || 'product').trim()
  if (!isMaterialSlot(slotRaw)) throw new Error('槽位只能是产品、门店或 Logo')
  const slot = slotRaw

  const task: IngestTask = {
    id: `ing-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    spaceId,
    slot,
    source: String(input.source || '').trim(),
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    note: 'independent ingest; MediaCrawler not used',
  }
  upsertTask(spaceId, task)

  const classified = classifyMediaLink(task.source)
  if (!classified.ok) {
    task.status = 'rejected'
    task.code = classified.code
    task.error = classified.error
    task.updatedAt = Date.now()
    if (classified.code === 'platform_page_blocked') task.note = MEDIA_INGEST_BLOCKED_REASON
    upsertTask(spaceId, task)
    return { success: false, task, mediCrawlerIntegrated: false, blockedReason: MEDIA_INGEST_BLOCKED_REASON }
  }

  task.status = 'running'
  task.updatedAt = Date.now()
  upsertTask(spaceId, task)

  try {
    let bytes: Buffer
    let contentType = 'application/octet-stream'
    let fileName = String(input.fileName || '').trim()

    if (classified.kind === 'fixture') {
      const path = safeFixturePath(classified.name)
      bytes = readFileSync(path)
      contentType = extname(path).toLowerCase() === '.png' ? 'image/png' : 'application/octet-stream'
      fileName = fileName || classified.name
    } else {
      const got = await fetchLoopback(classified.url)
      bytes = got.bytes
      contentType = got.contentType
      fileName = fileName || got.fileName
    }

    if (!bytes.length) throw Object.assign(new Error('空文件'), { code: 'empty_body' })
    const material = addStudioMaterial(spaceId, slot, guessName(fileName, contentType), bytes)
    task.status = 'succeeded'
    task.material = material
    task.bytes = bytes.length
    task.contentType = contentType
    task.updatedAt = Date.now()
    upsertTask(spaceId, task)
    return { success: true, task, mediCrawlerIntegrated: false }
  } catch (e: any) {
    task.status = 'failed'
    task.code = e?.code || 'ingest_failed'
    task.error = e?.message || '入库失败'
    task.updatedAt = Date.now()
    upsertTask(spaceId, task)
    return { success: false, task, mediCrawlerIntegrated: false }
  }
}

/** Local-only helper for tests: serve a fixture file on loopback once. */
export async function withLoopbackFixtureServer<T>(
  filePath: string,
  run: (url: string, server: Server) => Promise<T>,
): Promise<T> {
  const abs = resolve(filePath)
  if (!existsSync(abs) || !isAbsolute(abs)) throw new Error('fixture file missing')
  const body = readFileSync(abs)
  const server = createServer((req, res) => {
    if (req.url !== '/sample.png') {
      res.writeHead(404)
      res.end('no')
      return
    }
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': body.length })
    res.end(body)
  })
  await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', () => resolveReady()))
  const addr = server.address()
  if (!addr || typeof addr === 'string') {
    server.close()
    throw new Error('no bind')
  }
  try {
    return await run(`http://127.0.0.1:${addr.port}/sample.png`, server)
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
}

export function mediCrawlerCapabilityReport() {
  return {
    integrated: false as const,
    license: 'NON-COMMERCIAL LEARNING LICENSE 1.1',
    commercialUse: false,
    requiresWrittenConsent: true,
    platformsClaimedInUpstreamReadme: ['xhs', 'dy', 'ks', 'bili', 'wb', 'tieba', 'zhihu'],
    mediaDownloadPlatformsInUpstreamReadme: ['xhs', 'dy', 'ks', 'bili', 'wb'],
    mediaDownloadNotInUpstream: ['tieba', 'zhihu'],
    upstreamEntry: 'uv/python main.py --platform ... --get_media true (after login)',
    upstreamTech: ['Playwright', 'CDP reuse Chrome login', 'JS expression signatures', 'optional cookie login'],
    blockedReason: MEDIA_INGEST_BLOCKED_REASON,
    allowedNow: ['fixture:name', 'http://127.0.0.1/...', 'http://localhost/...'],
    materialsEntry: 'addStudioMaterial → company space materials catalog',
  }
}
