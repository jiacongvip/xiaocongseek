/**
 * 账号作品同步（Account Works）— 只用本机已授权的登录态，不接第三方 API：
 *   1) 从 publish-studio 落盘的登录态（account-files/<bindingId>.storage.json）取抖音 cookie
 *   2) 调抖音自家创作者中心的作品列表接口分页列作品
 *   3) 按 MediaCrawler 的抖音字段命名落盘，供账号监控（以及复盘）读取
 * 所有请求只发往 creator.douyin.com，没有任何外部服务参与。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RetroMetric } from './retro-review.js'

/** 一条作品，字段名对齐 MediaCrawler 的抖音 JSON。 */
export type AccountWorkRecord = {
  aweme_id: string
  title: string
  desc: string
  create_time: number
  nickname: string
  author_sec_uid: string
  liked_count: number
  comment_count: number
  share_count: number
  collected_count: number
  play_count: number
  aweme_url: string
  cover_url: string
  source_keyword: string
}

export type AccountWorksCache = {
  bindingId: string
  spaceId: string
  fetchedAt: number
  nickname: string
  authorSecUid: string
  total: number
  records: AccountWorkRecord[]
  errors: string[]
}

/** 缓存有效期：十分钟内不重复请求平台。 */
const TTL_MS = 10 * 60 * 1000
const MAX_PAGES = 6
const PAGE_COUNT = 20
const PAGE_DELAY_MS = 900
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function home() {
  return process.env.HOME || homedir()
}
function publishRoot() {
  return join(home(), '.dsh', 'publish-studio')
}
function worksRoot() {
  return join(home(), '.dsh', 'digital-human-studio', 'account-works')
}
function storageFile(spaceId: string, bindingId: string) {
  return join(publishRoot(), 'spaces', spaceId, 'account-files', `${bindingId}.storage.json`)
}

export function accountWorksPath(bindingId: string) {
  return join(worksRoot(), `${bindingId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`)
}

export function loadAccountWorks(bindingId: string): AccountWorksCache | null {
  const path = accountWorksPath(bindingId)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AccountWorksCache
    if (!parsed || !Array.isArray(parsed.records)) return null
    return parsed
  } catch {
    return null
  }
}

export function accountWorksFresh(cache: AccountWorksCache | null, ttlMs = TTL_MS) {
  if (!cache) return false
  return Date.now() - Number(cache.fetchedAt || 0) < ttlMs
}

type Cookie = { name?: string; value?: string; domain?: string; expires?: number }

function cookieHeader(storagePath: string): { header: string; count: number } {
  const raw = JSON.parse(readFileSync(storagePath, 'utf8')) as { cookies?: Cookie[] }
  const now = Math.floor(Date.now() / 1000)
  const cookies = (raw.cookies || []).filter((c) => {
    if (!c || !c.name || typeof c.value !== 'string') return false
    if (!String(c.domain || '').includes('douyin.com')) return false
    const exp = Number(c.expires ?? -1)
    return exp === -1 || exp === 0 || exp > now
  })
  return {
    header: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    count: cookies.length,
  }
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

type Aweme = Record<string, unknown>
type PostResponse = {
  status_code?: number
  has_more?: boolean
  max_cursor?: number
  total?: number
  aweme_list?: Aweme[]
}

function coverOf(a: Aweme): string {
  const candidates = [a.cover, a.Cover, (a.video as Aweme | undefined)?.cover, (a.video as Aweme | undefined)?.origin_cover]
  for (const c of candidates) {
    const urls = (c as Aweme | undefined)?.url_list
    if (Array.isArray(urls) && typeof urls[0] === 'string') return urls[0]
  }
  return ''
}

function toRecord(a: Aweme, nickname: string, secUid: string): AccountWorkRecord {
  const stat = (a.statistics || {}) as Record<string, unknown>
  const desc = str(a.desc).trim()
  const id = str(a.aweme_id)
  return {
    aweme_id: id,
    title: desc.slice(0, 60),
    desc,
    create_time: num(a.create_time),
    nickname,
    author_sec_uid: secUid,
    liked_count: num(stat.digg_count),
    comment_count: num(stat.comment_count),
    share_count: num(stat.share_count),
    collected_count: num(stat.collect_count),
    play_count: num(stat.play_count),
    aweme_url: id ? `https://www.douyin.com/video/${id}` : '',
    cover_url: coverOf(a),
    source_keyword: 'account-works',
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * 拉一遍该账号在创作者中心的作品列表并落盘。失败时保留旧缓存，抛错由调用方决定要不要吞。
 */
export async function syncAccountWorks(input: {
  spaceId: string
  bindingId: string
  timeoutMs?: number
}): Promise<AccountWorksCache> {
  const { spaceId, bindingId } = input
  const storagePath = storageFile(spaceId, bindingId)
  if (!existsSync(storagePath)) throw new Error('这个账号没有落盘的登录态，请先在账号页登录/扫码')

  const { header, count } = cookieHeader(storagePath)
  if (!header || count === 0) throw new Error('登录态里没有可用的抖音 cookie，请重新扫码登录')

  const errors: string[] = []
  const byId = new Map<string, AccountWorkRecord>()
  let nickname = ''
  let secUid = ''
  let total = 0
  let cursor = 0

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      `https://creator.douyin.com/web/api/media/aweme/post/?count=${PAGE_COUNT}` +
      `&max_cursor=${cursor}&status=0`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 20000)
    let payload: PostResponse
    try {
      const res = await fetch(url, {
        headers: {
          cookie: header,
          'user-agent': UA,
          referer: 'https://creator.douyin.com/',
          accept: 'application/json, text/plain, */*',
        },
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      payload = (await res.json()) as PostResponse
    } catch (e) {
      errors.push(`第 ${page + 1} 页失败：${e instanceof Error ? e.message : 'unknown'}`)
      break
    } finally {
      clearTimeout(timer)
    }

    if (num(payload.status_code) !== 0) {
      errors.push(`第 ${page + 1} 页被拒：status_code=${payload.status_code}`)
      break
    }
    total = num(payload.total) || total
    const list = payload.aweme_list || []
    for (const item of list) {
      const author = (item.author || {}) as Record<string, unknown>
      if (!nickname) nickname = str(author.nickname)
      if (!secUid) secUid = str(author.sec_uid)
      const record = toRecord(item, str(author.nickname), str(author.sec_uid))
      if (record.aweme_id) byId.set(record.aweme_id, record)
    }
    if (list.length === 0 || payload.has_more !== true) break
    cursor = num(payload.max_cursor)
    await sleep(PAGE_DELAY_MS)
  }

  if (byId.size === 0) throw new Error(errors[0] || '作品列表为空：登录态可能已失效，请重新扫码')

  const cache: AccountWorksCache = {
    bindingId,
    spaceId,
    fetchedAt: Date.now(),
    nickname,
    authorSecUid: secUid,
    total: total || byId.size,
    records: [...byId.values()].sort((a, b) => b.create_time - a.create_time),
    errors,
  }

  mkdirSync(worksRoot(), { recursive: true })
  writeFileSync(accountWorksPath(bindingId), JSON.stringify(cache, null, 2), 'utf8')
  return cache
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function localDay(ms: number) {
  const d = new Date(ms)
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hour: d.getHours() }
}

/** 把落盘作品转成与复盘同一套口径的指标。 */
export function worksToMetrics(cache: AccountWorksCache): RetroMetric[] {
  return cache.records.map((r) => {
    const publishedAt = r.create_time > 0 ? r.create_time * 1000 : Date.now()
    const day = localDay(publishedAt)
    const likes = num(r.liked_count)
    const comments = num(r.comment_count)
    const shares = num(r.share_count)
    const saves = num(r.collected_count)
    const views = num(r.play_count)
    return {
      id: `douyin:${r.aweme_id}`,
      platform: '抖音',
      externalId: r.aweme_id,
      title: r.title || r.desc.slice(0, 60) || '（无标题）',
      author: r.nickname || cache.nickname || undefined,
      publishedAt,
      day: day.day,
      hour: day.hour,
      views: views > 0 ? views : null,
      likes,
      comments,
      shares,
      saves,
      engagement: likes + comments + shares + saves,
      engagementRate: null,
      url: r.aweme_url || null,
      cover: r.cover_url || null,
    } satisfies RetroMetric
  })
}
