/**
 * Industry hotboard: reuse already-wired MediaCrawler --type search.
 * Xiaohongshu search defaults to SORT_TYPE=popularity_descending (most popular).
 * This is not a national 热搜词条榜 / Pro HomeFeed --type.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isSpaceId, spaceAssetRoot, type ClientBrief } from './spaces.js'
import {
  runPlatformKeywordSearch,
  summarizeKeywordSearchSample,
  type KeywordSearchHit,
  type McPlatform,
  type MediaCrawlerBrowserMode,
  type MediaCrawlerRuntimeConfig,
  type McTask,
  type CliRunner,
} from './mediacrawler-adapter.js'

export const INDUSTRY_HOTBOARD_DISCLAIMER =
  '按这家公司的行业词搜最近最热的样本。用的是已经接上的爬虫搜索（小红书默认按最热排）。'

export const FALLBACK_INDUSTRY_PARTS = ['装修', '瓷砖'] as const

const INDUSTRY_LEXICON = [
  '卫生间翻新',
  '厨房翻新',
  '旧房改造',
  '全屋定制',
  '全屋瓷砖',
  '系统门窗',
  '通体大理石',
  '大理石瓷砖',
  '集成灶',
  '浴室柜',
  '淋浴房',
  '室内门',
  '铝门窗',
  '木地板',
  '定制家具',
  '家装',
  '装修',
  '建材',
  '整装',
  '局改',
  '岩板',
  '瓷砖',
  '地板',
  '墙板',
  '涂料',
  '乳胶漆',
  '卫浴',
  '马桶',
  '花洒',
  '橱柜',
  '厨电',
  '门窗',
  '木门',
  '吊顶',
  '灯具',
  '灯饰',
  '家具',
  '沙发',
  '床垫',
  '软装',
  '硬装',
].sort((a, b) => b.length - a.length)

const STOP = new Set([
  '公司',
  '店铺',
  '门店',
  '我们',
  '专业',
  '专注',
  '提供',
  '服务',
  '客户',
  '老板',
  '团队',
  '一家',
  '主营',
  '卖点',
  '对外',
  '身份',
  '口吻',
  '不要',
  '例如',
  '可以',
  '以及',
  '还有',
  '这个',
  '那个',
  '进行',
  '通过',
  '打造',
  '帮您',
  '帮助',
  '解决',
  '问题',
  '需求',
  '产品',
  '品牌',
  '厂家',
  '工厂',
  '有限',
  '责任',
  '集团',
  '股份',
  'studio',
  'default',
  '默认',
])

export type IndustryHotboardSource = 'override' | 'brief' | 'fallback'

export type IndustryHotboardPreview = {
  query: string
  parts: string[]
  usedFallback: boolean
  source: IndustryHotboardSource
}

export type IndustryHotHit = {
  rank: number
  title?: string
  url?: string
  awemeId?: string
  nickname?: string
  likedCount?: string
  commentCount?: string
  shareCount?: string
  collectedCount?: string
  engagementScore: number
  sourceKind: 'keyword_search'
}

export type IndustryHotboardSnapshot = {
  version: 1
  spaceId: string
  query: string
  parts: string[]
  usedFallback: boolean
  source: IndustryHotboardSource
  platform: McPlatform
  collectedAt: number
  officialHotSearch: false
  sourceKind: 'keyword_search'
  sortNote: string
  hits: IndustryHotHit[]
  taskId?: string
}

function joinQuery(parts: string[]): string {
  const kept: string[] = []
  for (const part of parts) {
    const next = kept.length ? `${kept.join(' ')} ${part}` : part
    if (next.length > 40) break
    kept.push(part)
  }
  return kept.join(' ') || String(parts[0] || '').slice(0, 40)
}

export function resolveIndustryHotboardQuery(input: {
  spaceName?: string
  brief?: Partial<ClientBrief> | null
  override?: string
}): IndustryHotboardPreview {
  const override = String(input.override || '').trim().replace(/\s+/g, ' ')
  if (override) {
    const query = override.slice(0, 40)
    const parts = query.split(/[\s,，、]+/).filter(Boolean).slice(0, 3)
    return { query, parts: parts.length ? parts : [query], usedFallback: false, source: 'override' }
  }
  const blob = [input.brief?.identity, input.brief?.business, input.brief?.audience, input.spaceName]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
  const lexiconHits: string[] = []
  for (const term of INDUSTRY_LEXICON) {
    if (!blob.includes(term)) continue
    if (lexiconHits.some((hit) => hit.includes(term))) continue
    const shorter = lexiconHits.findIndex((hit) => term.includes(hit))
    if (shorter >= 0) lexiconHits[shorter] = term
    else lexiconHits.push(term)
    if (lexiconHits.length >= 3) break
  }
  if (lexiconHits.length) {
    return { query: joinQuery(lexiconHits), parts: lexiconHits.slice(0, 3), usedFallback: false, source: 'brief' }
  }
  const tokens = blob
    .split(/[\s,，、/|；;。.!！？?·\-—_]+/)
    .map((token) => token.trim())
    .filter((token) => {
      if (token.length < 2 || token.length > 10) return false
      if (STOP.has(token)) return false
      if (/^[0-9a-zA-Z]+$/.test(token)) return false
      return /[\u4e00-\u9fff]/.test(token)
    })
  const uniq: string[] = []
  for (const token of tokens) {
    if (!uniq.includes(token)) uniq.push(token)
    if (uniq.length >= 3) break
  }
  if (uniq.length) {
    return { query: joinQuery(uniq), parts: uniq, usedFallback: false, source: 'brief' }
  }
  const parts = [...FALLBACK_INDUSTRY_PARTS]
  return { query: joinQuery(parts), parts, usedFallback: true, source: 'fallback' }
}

function parseCount(value: unknown): number {
  if (value == null || value === '') return 0
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

export function rankIndustrySampleHits(hits: KeywordSearchHit[] | undefined): IndustryHotHit[] {
  const list = Array.isArray(hits) ? hits.slice(0, 10) : []
  return list
    .map((hit) => {
      const liked = parseCount(hit.likedCount)
      const comment = parseCount(hit.commentCount)
      const share = parseCount(hit.shareCount)
      const collected = parseCount(hit.collectedCount)
      return {
        rank: 0,
        title: hit.title,
        url: hit.url,
        awemeId: hit.awemeId,
        nickname: hit.nickname,
        likedCount: hit.likedCount,
        commentCount: hit.commentCount,
        shareCount: hit.shareCount,
        collectedCount: hit.collectedCount,
        engagementScore: liked + comment + share + collected,
        sourceKind: 'keyword_search' as const,
      }
    })
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .map((row, index) => ({ ...row, rank: index + 1 }))
}

export function industryHotboardPath(spaceId: string): string {
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  return join(spaceAssetRoot(spaceId), 'industry-hotboard.json')
}

export function loadIndustryHotboard(spaceId: string): IndustryHotboardSnapshot | null {
  const path = industryHotboardPath(spaceId)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!raw || raw.version !== 1 || !Array.isArray(raw.hits)) return null
    return {
      version: 1,
      spaceId,
      query: String(raw.query || ''),
      parts: Array.isArray(raw.parts) ? raw.parts.map((item: unknown) => String(item || '')).filter(Boolean) : [],
      usedFallback: !!raw.usedFallback,
      source: raw.source === 'override' || raw.source === 'brief' ? raw.source : 'fallback',
      platform: (['xhs', 'dy', 'ks', 'bili', 'wb'].includes(String(raw.platform)) ? raw.platform : 'xhs') as McPlatform,
      collectedAt: Number(raw.collectedAt) || 0,
      officialHotSearch: false,
      sourceKind: 'keyword_search',
      sortNote: String(raw.sortNote || ''),
      hits: rankIndustrySampleHits(raw.hits),
      taskId: raw.taskId ? String(raw.taskId) : undefined,
    }
  } catch {
    return null
  }
}

export function saveIndustryHotboard(spaceId: string, board: IndustryHotboardSnapshot): void {
  const path = industryHotboardPath(spaceId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(board, null, 2), 'utf8')
}

export function industryHotboardCapability() {
  return {
    industryHotBoard: {
      wiredInPlugin: true,
      officialHotSearch: false,
      availableInMediaCrawlerCli: true,
      crawlerType: 'search',
      defaultPlatform: 'xhs',
      xhsSort: 'popularity_descending',
      source: 'keyword_search',
      maxNotesCap: 10,
      downloadsMedia: false,
      downloadsComments: false,
      note: INDUSTRY_HOTBOARD_DISCLAIMER,
    },
  }
}

function sortNoteFor(platform: McPlatform): string {
  if (platform === 'xhs') return '小红书搜索默认按最热排（popularity_descending）'
  return '关键词搜索样本，按赞评排序'
}

export async function runIndustryHotboard(input: {
  spaceId: string
  spaceName?: string
  brief?: Partial<ClientBrief> | null
  keywords?: string
  platform?: McPlatform
  maxNotes?: number
  browserMode?: MediaCrawlerBrowserMode
  cdpPort?: number
  pluginConfig?: Partial<MediaCrawlerRuntimeConfig>
  runner?: CliRunner
}): Promise<{
  success: boolean
  preview: IndustryHotboardPreview
  board: IndustryHotboardSnapshot | null
  task: McTask
  capability: ReturnType<typeof industryHotboardCapability>
}> {
  const spaceId = String(input.spaceId || '').trim()
  if (!isSpaceId(spaceId)) throw new Error('非法空间')
  const platform = (input.platform || 'xhs') as McPlatform
  const preview = resolveIndustryHotboardQuery({
    spaceName: input.spaceName,
    brief: input.brief,
    override: input.keywords,
  })
  const result = await runPlatformKeywordSearch({
    spaceId,
    platform,
    keywords: preview.query,
    maxNotes: input.maxNotes ?? 10,
    browserMode: input.browserMode,
    cdpPort: input.cdpPort,
    pluginConfig: input.pluginConfig,
    runner: input.runner,
  })
  const capability = industryHotboardCapability()
  if (!result.success) {
    return { success: false, preview, board: loadIndustryHotboard(spaceId), task: result.task, capability }
  }
  const hits = rankIndustrySampleHits(result.task.searchHits)
  const board: IndustryHotboardSnapshot = {
    version: 1,
    spaceId,
    query: preview.query,
    parts: preview.parts,
    usedFallback: preview.usedFallback,
    source: preview.source,
    platform,
    collectedAt: result.task.collectedAt || Date.now(),
    officialHotSearch: false,
    sourceKind: 'keyword_search',
    sortNote: sortNoteFor(platform),
    hits,
    taskId: result.task.id,
  }
  if (!result.task.searchSampleAnalysis) {
    result.task.searchSampleAnalysis = summarizeKeywordSearchSample(result.task.searchHits, {
      keywords: preview.query,
      collectedAt: board.collectedAt,
    })
  }
  saveIndustryHotboard(spaceId, board)
  return { success: true, preview, board, task: result.task, capability }
}
