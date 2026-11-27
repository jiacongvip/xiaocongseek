/**
 * 复盘（Retro Review）— 口径照抄 media-desk（dsh-media-desk@2.6.1 src/learn.js）：
 *   - engagement = likes + comments + shares + saves
 *   - engagementRate 只统计 views > 0 的记录，分子分母同时受限
 *   - 平台分布：各平台都有播放量数据用 views，否则用 engaged
 *   - 按本机时区归日（localDay），避免早 8 点被算进前一天
 * 数据源 = 本机 MediaCrawler 落盘 JSON（douyin/xhs/bilibili），不调第三方 API。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { DETECTABLE_MC_ROOT } from './mediacrawler-adapter.js'
import { isSpaceId, spaceAssetRoot } from './spaces.js'

export type RetroMetric = {
  id: string
  platform: string
  externalId: string
  title: string
  author?: string
  publishedAt: number
  day: string
  hour: number
  views: number | null
  likes: number
  comments: number
  shares: number
  saves: number
  engagement: number
  engagementRate: number | null
  url: string | null
  cover: string | null
}

export type RetroCommentDoc = {
  content: string
  likes: number
}

export type RetroTrendPoint = { day: string; works: number; engagement: number; views: number }
export type RetroPlatformRow = { platform: string; works: number; views: number; engaged: number }
export type RetroTopWork = { id: string; platform: string; title: string; engagement: number; views: number | null }
export type RetroBucketRow = { key: string; works: number; avgEngagement: number }
export type RetroWordRow = { word: string; count: number; docs: number }
export type RetroWorkRow = {
  id: string
  title: string
  day: string
  hour: number
  views: number | null
  likes: number
  comments: number
  shares: number
  saves: number
  engagement: number
  engagementRate: number | null
  url: string | null
  cover: string | null
}

export type RetroInsights = {
  totals: { works: number; views: number; engagement: number; likes: number; comments: number; shares: number; saves: number; commentsCrawled: number }
  trend: RetroTrendPoint[]
  byPlatform: RetroPlatformRow[]
  byPlatformMode: 'views' | 'engaged'
  topWorks: RetroTopWork[]
  hourBuckets: RetroBucketRow[]
  topicBuckets: RetroBucketRow[]
  commentWords: RetroWordRow[]
  workRows: RetroWorkRow[]
}

export type RetroRule = {
  id: string
  status: 'proposed' | 'active' | 'exported'
  kind: string
  title: string
  detail: string
  confidence: number
  evidence: string
  createdAt: number
}

export type RetroSnapshot = {
  version: 1
  spaceId: string
  skills: RetroRule[]
  lastScan: { at: number; source: string; works: number; comments: number; platforms: string[]; errors: string[] }
}

export type RetroScanPayload = { metrics: RetroMetric[]; comments: RetroCommentDoc[]; platforms: string[]; errors: string[] }

const PLATFORM_SCANNERS = [
  { dir: 'douyin', label: '抖音' },
  { dir: 'xhs', label: '小红书' },
  { dir: 'bilibili', label: 'B站' },
] as const

const STOP_WORDS = new Set([
  '这个', '那个', '真的', '就是', '一个', '没有', '什么', '怎么', '不是', '可以', '自己', '还是', '现在', '知道',
  '东西', '感觉', '视频', '作品', '大家', '我们', '你们', '他们', '因为', '所以', '但是', '如果', '已经',
  '一定', '非常', '可能', '应该', '这样', '那样', '看到', '觉得', '希望', '加油', '支持', '喜欢', '哈哈',
  '谢谢', 'up', 'up主', '博主', 'up主', '老师', '厉害', '666', '？？', '？', '啊', '嗯', '哦', '呀', '吧', '呢', '吗',
  '抖音', '小红书', '哔哩', 'b站', 'bilibili', 'douyin', '视频号',
])

const EMOJI_PLACEHOLDER = new Set([
  '呲牙', '捂脸', '流泪', '大笑', '赞', '比心', '爱心', '玫瑰', '鼓掌', '强', '得意', '害羞', '悠闲',
  '可爱', '微笑', '酷', '笑哭', '狗头', '抠鼻', '机智', '灵机一动', '打call', 'good',
])

function num(raw: unknown, key: string): number {
  const v = (raw as Record<string, unknown> | null)?.[key]
  const n = typeof v === 'string' ? Number(v) : Number(v ?? 0)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
}

function str(raw: unknown, key: string): string {
  const v = (raw as Record<string, unknown> | null)?.[key]
  return typeof v === 'string' ? v.trim() : ''
}

function toMs(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : Number(v ?? 0)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 1e12 ? n : n * 1000 // 秒级 → 毫秒
}

/** 本机时区归日：Y-m-d 与小时。media-desk localDay 同口径。 */
function localDay(ms: number): { day: string; hour: number } {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return { day: `${y}-${m}-${day}`, hour: d.getHours() }
}

function readJsonLines(text: string): unknown[] {
  const rows: unknown[] = []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    rows.push(parsed)
  } catch {
    for (const line of text.split(/\n+/)) {
      const t = line.trim()
      if (!t) continue
      try { rows.push(JSON.parse(t)) } catch { /* skip broken line */ }
    }
  }
  return rows
}

function scanJsonDir(root: string, dirName: string, platform: string, out: { works: RetroMetric[]; comments: RetroCommentDoc[]; errors: string[] }): void {
  const dir = join(root, 'data', dirName, 'json')
  if (!existsSync(dir)) return
  let files: string[] = []
  try { files = readdirSync(dir).filter(f => f.endsWith('.json') || f.endsWith('.jsonl')) } catch { return }
  for (const file of files) {
    const path = join(dir, file)
    try {
      if (statSync(path).size > 512 * 1024 * 1024) { out.errors.push(`${path} 超过 512MB，跳过`); continue }
      const rows = readJsonLines(readFileSync(path, 'utf8'))
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const r = row as Record<string, unknown>
        if (platform === '抖音') {
          if (r.aweme_id && !r.comment_id) {
            out.works.push(toDouyinMetric(r))
          } else if (r.comment_id && typeof r.content === 'string') {
            out.comments.push({ content: r.content, likes: num(r, 'like_count') })
          }
        } else if (platform === '小红书') {
          if ((r.note_id || r.model_type === 'note') && !r.comment_id) out.works.push(toXhsMetric(r))
          else if (r.comment_id && typeof r.content === 'string') out.comments.push({ content: r.content, likes: num(r, 'like_count') })
        } else if (platform === 'B站') {
          if (r.bvid && !r.rpid && !r.cid) out.works.push(toBiliMetric(r))
          else if ((r.rpid || r.cid) && typeof r.content === 'string') out.comments.push({ content: r.content, likes: num(r, 'like') })
        }
      }
    } catch (e) {
      out.errors.push(`${path} 解析失败：${e instanceof Error ? e.message : 'unknown'}`)
    }
  }
}

function toDouyinMetric(r: Record<string, unknown>): RetroMetric {
  const publishedAt = toMs(r.create_time ?? r.last_modify_ts) || Date.now()
  const day = localDay(publishedAt)
  const views = num(r, 'play_count')
  const likes = num(r, 'liked_count')
  const comments = num(r, 'comment_count')
  const shares = num(r, 'share_count')
  const saves = num(r, 'collected_count')
  return {
    id: `douyin:${String(r.aweme_id)}`,
    platform: '抖音',
    externalId: String(r.aweme_id),
    title: str(r, 'title') || str(r, 'desc').slice(0, 60),
    author: str(r, 'nickname') || undefined,
    publishedAt, day: day.day, hour: day.hour,
    views: views > 0 ? views : null,
    likes, comments, shares, saves,
    engagement: likes + comments + shares + saves,
    engagementRate: null,
    url: r.aweme_url ? String(r.aweme_url) : null,
    cover: r.cover_url ? String(r.cover_url) : null,
  }
}

function toXhsMetric(r: Record<string, unknown>): RetroMetric {
  const publishedAt = toMs(r.time ?? r.last_update_time) || Date.now()
  const day = localDay(publishedAt)
  const views = num(r, 'view_count') || null
  const likes = num(r, 'liked_count')
  const comments = num(r, 'comment_count')
  const shares = num(r, 'share_count')
  const saves = num(r, 'collected_count')
  const engagement = likes + comments + shares + saves
  return {
    id: `xhs:${String(r.note_id ?? r.noteId ?? r.id)}`,
    platform: '小红书',
    externalId: String(r.note_id ?? r.noteId ?? r.id),
    title: str(r, 'title') || str(r, 'desc').slice(0, 60),
    author: str(r, 'nickname') || undefined,
    publishedAt, day: day.day, hour: day.hour,
    views, likes, comments, shares, saves,
    engagement,
    engagementRate: views && views > 0 ? engagement / views : null,
    url: r.note_url ? String(r.note_url) : null,
    cover: r.cover ? String(r.cover) : null,
  }
}

function toBiliMetric(r: Record<string, unknown>): RetroMetric {
  const publishedAt = toMs(r.pubdate ?? r.pub_time) || Date.now()
  const day = localDay(publishedAt)
  const views = num(r, 'view') || null
  const likes = num(r, 'like')
  const comments = num(r, 'comment') || num(r, 'reply')
  const shares = num(r, 'share')
  const saves = num(r, 'favorite')
  const engagement = likes + comments + shares + saves
  return {
    id: `bili:${String(r.bvid)}`,
    platform: 'B站',
    externalId: String(r.bvid),
    title: str(r, 'title'),
    author: str(r, 'name') || str(r, 'owner_name') || undefined,
    publishedAt, day: day.day, hour: day.hour,
    views, likes, comments, shares, saves,
    engagement,
    engagementRate: views && views > 0 ? engagement / views : null,
    url: r.bvid ? `https://www.bilibili.com/video/${String(r.bvid)}` : null,
    cover: r.pic ? String(r.pic) : null,
  }
}

/** 按 externalId 去重，取最新修改时间的一条（media-desk 同口径）。 */
function dedupe(works: RetroMetric[]): RetroMetric[] {
  const byId = new Map<string, RetroMetric>()
  for (const w of works) {
    const prev = byId.get(w.id)
    if (!prev || w.publishedAt >= prev.publishedAt) byId.set(w.id, w)
  }
  return [...byId.values()]
}

export function scanMediaCrawlerForRetro(mcRoot: string = DETECTABLE_MC_ROOT): RetroScanPayload {
  const works: RetroMetric[] = []
  const comments: RetroCommentDoc[] = []
  const errors: string[] = []
  const platforms: string[] = []
  if (!existsSync(resolve(mcRoot))) return { metrics: [], comments: [], platforms, errors: [`MediaCrawler 目录不存在：${mcRoot}`] }
  for (const p of PLATFORM_SCANNERS) {
    const before = works.length + comments.length
    scanJsonDir(resolve(mcRoot), p.dir, p.label, { works, comments, errors })
    if (works.length + comments.length > before) platforms.push(p.label)
  }
  return { metrics: dedupe(works).sort((a, b) => a.publishedAt - b.publishedAt), comments, platforms, errors }
}

/** media-desk computeInsights(state) 同口径纯计算。 */
export function computeRetroInsights(payload: RetroScanPayload): RetroInsights {
  const metrics = payload.metrics
  const totals = metrics.reduce((acc, m) => {
    acc.works += 1
    acc.likes += m.likes
    acc.comments += m.comments
    acc.shares += m.shares
    acc.saves += m.saves
    acc.engagement += m.engagement
    if (m.views && m.views > 0) acc.views += m.views
    return acc
  }, { works: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0, engagement: 0, commentsCrawled: payload.comments.length })

  const byDay = new Map<string, { works: number; engagement: number; views: number }>()
  for (const m of metrics) {
    const cur = byDay.get(m.day) ?? { works: 0, engagement: 0, views: 0 }
    cur.works += 1
    cur.engagement += m.engagement
    cur.views += m.views ?? 0
    byDay.set(m.day, cur)
  }
  const trend = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, ...v }))

  const byPlatform = new Map<string, { works: number; views: number; engaged: number }>()
  for (const m of metrics) {
    const cur = byPlatform.get(m.platform) ?? { works: 0, views: 0, engaged: 0 }
    cur.works += 1
    cur.views += m.views ?? 0
    cur.engaged += m.engagement
    byPlatform.set(m.platform, cur)
  }
  const platformRows = [...byPlatform.entries()].map(([platform, v]) => ({ platform, ...v }))
  const byPlatformMode = platformRows.every(p => p.views > 0) ? 'views' : 'engaged'
  platformRows.sort((a, b) => b.views - a.views)

  const topWorks = [...metrics]
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 5)
    .map(m => ({ id: m.id, platform: m.platform, title: m.title || '（无标题）', engagement: m.engagement, views: m.views }))

  const hourBuckets = new Map<number, { works: number; total: number }>()
  for (const m of metrics) {
    const cur = hourBuckets.get(m.hour) ?? { works: 0, total: 0 }
    cur.works += 1
    cur.total += m.engagement
    hourBuckets.set(m.hour, cur)
  }
  const hours = [...hourBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, v]) => ({ key: `${String(hour).padStart(2, '0')}:00`, works: v.works, avgEngagement: Math.round(v.total / v.works) }))

  const topicBuckets = buildTopicBuckets(metrics)
  const commentWords = extractCommentWords(payload.comments)

  const workRows: RetroWorkRow[] = [...metrics]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .map(m => ({
      id: m.id,
      title: m.title || '（无标题）',
      day: m.day,
      hour: m.hour,
      views: m.views,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      saves: m.saves,
      engagement: m.engagement,
      engagementRate: m.engagementRate,
      url: m.url,
      cover: m.cover,
    }))

  return { totals, trend, byPlatform: platformRows, byPlatformMode, topWorks, hourBuckets: hours, topicBuckets, commentWords, workRows }
}

const TOPIC_STOP_CHARS = new Set(['的', '了', '是', '我', '你', '他', '她', '它', '在', '有', '和', '与', '就', '都', '也', '这', '那', '个', '一', '不', '要', '说', '看', '让', '被', '把', '给', '从', '到', '为', '很', '最', '还', '会', '能', '想', '做', '用', '比', '跟', '等', '及', '或', '又', '再', '没', '只', '上', '下', '中', '里', '外', '之', '后', '前', '时', '天', '年', '月', '日', '今', '明', '昨', '你', '们', '么', '什', '怎', '哪', '多', '少'])

function buildTopicBuckets(metrics: RetroMetric[]): RetroBucketRow[] {
  const buckets = new Map<string, { works: number; total: number }>()
  for (const m of metrics) {
    const text = (m.title || '').trim()
    if (!text) continue
    const seen = new Set<string>()
    const collect = (word: string) => {
      if (word.length < 2 || word.length > 10 || seen.has(word)) return
      seen.add(word)
      if (STOP_WORDS.has(word)) return
      const cur = buckets.get(word) ?? { works: 0, total: 0 }
      cur.works += 1
      cur.total += m.engagement
      buckets.set(word, cur)
    }
    // 1) 整段短语：按标点/空格切段，直接作为话题候选（不切碎真实词组）
    for (const seg of text.split(/[，,。.!！?？、;；:\s]+/)) {
      const t = seg.trim()
      if (!t) continue
      if (t.length <= 8) collect(t)
      else {
        // 长段内部再取 2-gram 补充
        const runs = t.match(/[\u4e00-\u9fff]{2,}/g) ?? []
        for (const run of runs) {
          for (let i = 0; i + 2 <= run.length; i += 1) {
            const a = run[i]
            const b = run[i + 1]
            if (TOPIC_STOP_CHARS.has(a) || TOPIC_STOP_CHARS.has(b)) continue
            collect(a + b)
          }
        }
      }
    }
    // 2) 英文完整单词
    const enRuns = text.match(/[A-Za-z][A-Za-z0-9_+#.-]{2,}/g) ?? []
    for (const w of enRuns) collect(w.toLowerCase().replace(/[.]+$/, ''))
  }
  let rows = [...buckets.entries()]
    .filter(([, v]) => v.works >= 2)
    .map(([key, v]) => ({ key, works: v.works, avgEngagement: Math.round(v.total / v.works) }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.works - a.works)
  // 包含合并：短词是更长词的子串且条数相同（说明来自同一批标题）时并入长词
  const merged: RetroBucketRow[] = []
  for (const row of rows) {
    const longer = merged.find(m => m.key.length > row.key.length && m.key.includes(row.key) && m.works === row.works)
    if (longer) continue
    merged.push(row)
  }
  return merged.slice(0, 20)
}

function isHan(ch: string): boolean {
  return /[\u4e00-\u9fff]/.test(ch)
}

function extractCommentWords(comments: RetroCommentDoc[]): RetroWordRow[] {
  const counter = new Map<string, { count: number; docs: Set<number> }>()
  comments.forEach((c, docIdx) => {
    const text = c.content.replace(/\s+/g, ' ').trim()
    if (!text) return
    // 抖音表情占位词与语气词直接过滤
    for (const w of EMOJI_PLACEHOLDER) if (text.includes(w)) return
    const seen = new Set<string>()
    const add = (word: string) => {
      if (word.length < 2 || word.length > 8) return
      if (STOP_WORDS.has(word)) return
      if (/^\d+$/.test(word)) return
      const cur = counter.get(word) ?? { count: 0, docs: new Set<number>() }
      cur.count += 1
      cur.docs.add(docIdx)
      counter.set(word, cur)
      seen.add(word)
    }
    // 中文：只在连续汉字片段内取 2-4 n-gram（不切碎英文单词）
    const hanRuns = text.match(/[\u4e00-\u9fff]{2,}/g) ?? []
    for (const run of hanRuns) {
      for (let n = 2; n <= Math.min(4, run.length); n += 1) {
        for (let i = 0; i + n <= run.length; i += 1) {
          const seg = run.slice(i, i + n)
          if (n === 3 && STOP_WORDS.has(seg.slice(0, 2)) && STOP_WORDS.has(seg.slice(1))) continue
          add(seg)
        }
      }
    }
    // 英文：按完整单词（长度 ≥3 才收）
    const enRuns = text.match(/[A-Za-z][A-Za-z0-9_+#.-]{2,}/g) ?? []
    for (const w of enRuns) {
      const lower = w.toLowerCase().replace(/[.]+$/, '')
      if (lower.length >= 3) add(lower)
    }
  })
  const rows: RetroWordRow[] = []
  for (const [word, v] of counter) {
    if (v.count >= 3 && v.docs.size >= 2) rows.push({ word, count: v.count, docs: v.docs.size })
  }
  rows.sort((a, b) => b.count - a.count || b.docs - a.docs)
  return rows.slice(0, 24)
}

/** media-desk proposeRules 三条门槛 + 评论热词规则。 */
export function proposeRetroRules(insights: RetroInsights, existing: RetroRule[]): RetroRule[] {
  const next: RetroRule[] = []
  const titles = new Set(existing.map(r => r.title))
  const at = Date.now()
  const push = (kind: string, title: string, detail: string, confidence: number, evidence: string) => {
    if (titles.has(title)) return
    titles.add(title)
    next.push({
      id: `retro-${kind}-${at}-${next.length}`,
      status: 'proposed',
      kind, title, detail, confidence, evidence,
      createdAt: at,
    })
  }

  // 1) 首发平台：≥2 平台，第一名的平均互动 > 第二名 ×1.3；conf=min(0.85, 0.4+0.12n)
  const plats = insights.byPlatform.filter(p => p.works >= 1)
  if (plats.length >= 2) {
    const first = plats[0]
    const second = plats[1]
    const firstAvg = first.engaged / Math.max(1, first.works)
    const secondAvg = second.engaged / Math.max(1, second.works)
    if (firstAvg > secondAvg * 1.3 && firstAvg > 0) {
      const conf = Math.min(0.85, 0.4 + 0.12 * first.works)
      push('首发平台', `首发发「${first.platform}」`, `「${first.platform}」均互动 ${Math.round(firstAvg)}，是「${second.platform}」的 ${(firstAvg / Math.max(1, secondAvg)).toFixed(1)} 倍。新片先发 ${first.platform}，再分发其余平台。`, Math.round(conf * 100) / 100, `平台分布：${plats.map(p => `${p.platform} ${p.works} 条`).join('、')}`)
    }
  }

  // 2) 发布时间：≥2 个时段，最佳时段 ≥2 条；conf=0.5
  const hours = insights.hourBuckets.filter(h => h.works >= 1)
  if (hours.length >= 2) {
    const sorted = [...hours].sort((a, b) => b.avgEngagement - a.avgEngagement)
    const best = sorted[0]
    if (best && best.works >= 2) {
      const overallAvg = insights.totals.engagement / Math.max(1, insights.totals.works)
      push('发布时间', `${best.key} 前后发`, `该时段均互动 ${Math.round(best.avgEngagement)}，整体均值 ${Math.round(overallAvg)}。排期尽量落在 ${best.key} 前后。`, 0.5, `按时段统计 ${hours.length} 个时段，${best.key} ${best.works} 条`)
    }
  }

  // 3) 高频话题：≥2 条，取平均互动最高
  const topics = insights.topicBuckets.filter(t => t.works >= 2)
  if (topics.length) {
    const sorted = [...topics].sort((a, b) => b.avgEngagement - a.avgEngagement)
    const best = sorted[0]
    const rest = sorted.slice(1)
    if (rest.length) {
      const secondAvg = Math.max(1, rest[0].avgEngagement)
      if (best.avgEngagement > secondAvg * 1.3) {
        push('选题方向', `多做「${best.key}」`, `「${best.key}」均互动 ${Math.round(best.avgEngagement)}，比第二名高 ${Math.round((best.avgEngagement / secondAvg - 1) * 100)}%。选题往这个方向靠。`, Math.min(0.9, 0.5 + 0.08 * best.works), `${best.works} 条相关作品`)
      }
    }
  }

  // 4) 评论热词
  if (insights.commentWords.length) {
    const top = insights.commentWords.slice(0, 3).map(w => `「${w.word}」(${w.count} 次)`)
    push('评论区', `回应评论区${top.join('、')}`, `评论区高频词 ${top.join('、')}。下条视频主动回应这些词，促进评论互动。`, Math.min(0.9, 0.5 + 0.08 * insights.commentWords[0].docs), `来自 ${insights.totals.commentsCrawled} 条评论`)
  }

  return next
}

export function retroReviewPath(spaceId: string): string {
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  return join(spaceAssetRoot(spaceId), 'retro-review.json')
}

export function retroRulesMarkdownPath(spaceId: string): string {
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  return join(spaceAssetRoot(spaceId), 'retro-rules.md')
}

export function loadRetroReview(spaceId: string): RetroSnapshot | null {
  const path = retroReviewPath(spaceId)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!raw || raw.version !== 1 || !Array.isArray(raw.skills)) return null
    return {
      version: 1,
      spaceId,
      skills: raw.skills.filter((s: unknown) => s && typeof s === 'object' && typeof (s as RetroRule).id === 'string'),
      lastScan: {
        at: Number(raw.lastScan?.at) || 0,
        source: String(raw.lastScan?.source || ''),
        works: Number(raw.lastScan?.works) || 0,
        comments: Number(raw.lastScan?.comments) || 0,
        platforms: Array.isArray(raw.lastScan?.platforms) ? raw.lastScan.platforms.map(String) : [],
        errors: Array.isArray(raw.lastScan?.errors) ? raw.lastScan.errors.map(String) : [],
      },
    }
  } catch {
    return null
  }
}

export function saveRetroReview(spaceId: string, snapshot: RetroSnapshot): void {
  const path = retroReviewPath(spaceId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf8')
}

export function exportRetroRules(spaceId: string, skills: RetroRule[], companyName: string): string {
  const path = retroRulesMarkdownPath(spaceId)
  const lines = [
    `# ${companyName || '公司'} · 复盘规则`,
    '',
    `> 由「复盘」自动提炼，口径同自媒体工作台复盘：互动 = 赞 + 评 + 转 + 藏。`,
    `> 导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
  ]
  if (!skills.length) lines.push('（暂无规则）')
  for (const s of skills) {
    lines.push(`## ${s.title}`, '', `${s.detail}`, '', `- 置信度：${s.confidence}`, `- 依据：${s.evidence}`, '')
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, lines.join('\n'), 'utf8')
  return path
}

export function retroReviewCapability() {
  return {
    retroReview: {
      wiredInPlugin: true,
      source: 'mediacrawler_local_json',
      platforms: PLATFORM_SCANNERS.map(p => p.label),
      noThirdPartyApi: true,
      note: '复盘口径与 dsh-media-desk@2.6.1 learn.js 一致；数据只读本机 MediaCrawler 落盘 JSON，不调用第三方数据 API。',
    },
  }
}
