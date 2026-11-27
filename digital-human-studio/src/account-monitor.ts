/**
 * 账号监控（Account Monitor）— 账号维度，不新增第三方调用：
 *   1) 已授权账号：读 publish-studio 的 accounts.json（只读，不读密钥文件内容）
 *   2) 发布核对：读同 space 的 tasks.json，按 bindingId 汇总「已核实 / 没发出 / 待核对」
 *   3) 作品数据：读本机 MediaCrawler 落盘 JSON，按账号昵称匹配作品与互动
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DETECTABLE_MC_ROOT } from './mediacrawler-adapter.js'
import { isSpaceId } from './spaces.js'
import { scanMediaCrawlerForRetro } from './retro-review.js'
import type { RetroMetric } from './retro-review.js'
import { accountWorksFresh, loadAccountWorks, syncAccountWorks, worksToMetrics } from './account-works.js'

export type AccountMonitorTask = {
  id: string
  title: string
  state: string
  at: number
  reason: string
}

export type AccountMonitorPayload = {
  account: {
    id: string
    platform: string
    platformLabel: string
    label: string
    nickname: string
    status: string
    enabled: boolean
    hasCredential: boolean
  }
  publish: {
    total: number
    verified: number
    failed: number
    unknown: number
    running: number
    cancelled: number
  }
  recent: AccountMonitorTask[]
  works: {
    matchedBy: 'nickname' | 'uid' | ''
    nickname: string
    total: number
    syncError: string
    totalEngagement: number
    latestAt: number
    latestTitle: string
    top: { title: string; engagement: number; day: string }[]
    note: string
  }
  source: {
    mcRoot: string
    scannedWorks: number
    scannedComments: number
    accountsFile: string
    tasksFile: string
    at: number
    errors: string[]
  }
}

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  xhs: '小红书',
  bilibili: 'B站',
  bili: 'B站',
  kuaishou: '快手',
  weibo: '微博',
  tiktok: 'TikTok',
  instagram: 'Instagram',
}

function platformLabel(p: string): string {
  return PLATFORM_LABELS[String(p || '').toLowerCase()] || String(p || '')
}

function readJson(path: string): any {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** publish-studio 的空间根：优先同名 space，没有则用 default。 */
function publishSpaceDir(spaceId: string): string {
  const root = join(homedir(), '.dsh', 'publish-studio', 'spaces')
  const candidate = isSpaceId(spaceId) ? join(root, spaceId) : ''
  if (candidate && existsSync(candidate)) return candidate
  return join(root, 'default')
}

function pickAccount(accountsFile: string, bindingId: string): any | null {
  const store = readJson(accountsFile)
  if (!store || !Array.isArray(store.bindings)) return null
  const id = String(bindingId || '').trim()
  if (id) return store.bindings.find((b: any) => String(b?.id || '') === id) || null
  return store.bindings[0] || null
}

type TaskCounts = AccountMonitorPayload['publish']
function summarizeTasks(tasksFile: string, bindingId: string, account: any): { counts: TaskCounts; recent: AccountMonitorTask[] } {
  const store = readJson(tasksFile)
  const tasks: any[] = Array.isArray(store?.tasks) ? store.tasks : []
  const short = (s: string): string => {
    const v = String(s || '')
    if (/^[a-z0-9-]{8,}$/i.test(v)) return `${v.slice(0, 6)}…`
    return v
  }
  const rows = tasks
    .filter((t: any) => {
      const bId = String(t?.snapshot?.bindingId || '')
      if (bindingId) return bId === bindingId
      // 没给 bindingId 时按账号标签兜底
      const label = String(t?.snapshot?.accountLabel || '')
      return !!account && (bId === String(account.id || '') || label === String(account.label || ''))
    })
    .sort((a: any, b: any) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))

  const counts = { total: rows.length, verified: 0, failed: 0, unknown: 0, running: 0, cancelled: 0 }
  for (const t of rows) {
    const state = String(t?.state || '')
    if (state === 'accepted') counts.verified += 1
    else if (state === 'failed') counts.failed += 1
    else if (state === 'cancelled') counts.cancelled += 1
    else if (state === 'unknown') counts.unknown += 1
    else if (state === 'queued' || state === 'running') counts.running += 1
  }

  const recent: AccountMonitorTask[] = rows.slice(0, 6).map((t: any) => {
    const receipt = t?.receipt || {}
    const reason = String(receipt.reason || receipt.error || receipt.message || receipt.detail || receipt.summary || '')
    return {
      id: String(t?.id || ''),
      title: String(t?.snapshot?.title || '（无标题）'),
      state: String(t?.state || ''),
      at: Number(t?.updatedAt || t?.createdAt || 0),
      reason: reason ? short(reason) : '',
    }
  })
  return { counts, recent }
}

export async function accountMonitor(
  spaceId: string,
  bindingId: string,
  mcRoot: string = DETECTABLE_MC_ROOT,
  opts: { sync?: boolean } = {},
): Promise<AccountMonitorPayload> {
  const dir = publishSpaceDir(spaceId)
  const accountsFile = join(dir, 'accounts.json')
  const tasksFile = join(dir, 'tasks.json')
  const account = pickAccount(accountsFile, bindingId)
  if (!account) throw new Error('没有找到这个已授权账号（请先在账号页添加/授权）')

  const { counts, recent } = summarizeTasks(tasksFile, String(account.id || bindingId || ''), account)

  let scannedWorks = 0
  let scannedComments = 0
  let scanErrors: string[] = []

  const platform = platformLabel(account.platform)
  const nickname = String(account.nickname || account.label || '').trim()

  // 作品：优先用该账号自己的创作者中心作品列表（本机登录态直连，不是第三方 API）
  let cache = loadAccountWorks(bindingId)
  let syncError = ''
  if ((opts.sync === true && !accountWorksFresh(cache, 30_000)) || !cache) {
    try {
      cache = await syncAccountWorks({ spaceId, bindingId })
    } catch (e) {
      syncError = e instanceof Error ? e.message : 'unknown'
    }
  }

  let worksList: RetroMetric[] = []
  let matchedBy: 'nickname' | 'uid' | '' = ''
  let note = ''
  let displayNickname = nickname

  if (cache && cache.records.length > 0) {
    worksList = worksToMetrics(cache)
    matchedBy = 'uid'
    displayNickname = cache.nickname || nickname
    const at = new Date(cache.fetchedAt)
    const stamp = `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    note =
      `来自抖音创作者中心作品列表：${worksList.length} 条（账号「${displayNickname}」，` +
      `本机授权登录态直连，不是第三方接口），${stamp} 更新。` +
      (cache.errors.length ? ` 部分页面告警：${cache.errors.join('；')}` : '')
  } else {
    const scanned = scanMediaCrawlerForRetro(mcRoot)
    const normalize = (v: string) => String(v || '').replace(/[\s*＊]/g, '')
    worksList = scanned.metrics.filter((m: RetroMetric) => {
      if (m.platform !== platform) return false
      const a = normalize(nickname)
      const b = normalize(m.author || '')
      if (!a || !b) return false
      if (a === b) return true
      if (b.includes('*')) {
        const head = b.replace(/\*+/g, '')
        return head.length >= 1 && a.startsWith(head)
      }
      return a.includes(b) || b.includes(a)
    })
    matchedBy = worksList.length ? 'nickname' : ''
    note = worksList.length
      ? `按昵称在本地 MediaCrawler 数据里匹配到 ${worksList.length} 条作品（昵称匹配不可靠，建议用同步）。`
      : `还没有这个账号的作品：${syncError ? `同步失败：${syncError}` : '本地 MediaCrawler 数据里没有匹配到'}。点「刷新监控」重新同步。`
    scannedWorks = scanned.metrics.length
    scannedComments = scanned.comments.length
    scanErrors = scanned.errors
  }

  const totalEngagement = worksList.reduce((sum, m) => sum + m.engagement, 0)
  const latest = worksList.slice().sort((a, b) => b.publishedAt - a.publishedAt)[0]
  const top = worksList
    .slice()
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 3)
    .map((m) => ({ title: m.title || '（无标题）', engagement: m.engagement, day: m.day }))

  return {
    account: {
      id: String(account.id || ''),
      platform: String(account.platform || ''),
      platformLabel: platform,
      label: String(account.label || ''),
      nickname,
      status: String(account.status || ''),
      enabled: account.enabled !== false,
      hasCredential: !!account.hasCredentialFile,
    },
    publish: counts,
    recent,
    works: {
      matchedBy,
      nickname: displayNickname,
      total: worksList.length,
      syncError,
      totalEngagement,
      latestAt: latest ? latest.publishedAt : 0,
      latestTitle: latest ? latest.title : '',
      top,
      note,
    },
    source: {
      mcRoot,
      scannedWorks,
      scannedComments,
      accountsFile,
      tasksFile,
      at: Date.now(),
      errors: scanErrors,
    },
  }
}

/** 复盘用：整家公司（space）所有已授权账号的作品指标。 */
export function spaceAccountWorks(spaceId: string): {
  metrics: RetroMetric[]
  accounts: { id: string; nickname: string; platform: string; works: number; fetchedAt: number }[]
} {
  const dir = publishSpaceDir(spaceId)
  const accountsFile = join(dir, 'accounts.json')
  const store = readJson(accountsFile)
  const bindings: any[] = Array.isArray(store?.bindings) ? store.bindings : []
  const metrics: RetroMetric[] = []
  const accounts: { id: string; nickname: string; platform: string; works: number; fetchedAt: number }[] = []
  for (const b of bindings) {
    const id = String(b?.id || '')
    if (!id) continue
    const cache = loadAccountWorks(id)
    if (!cache || !cache.records.length) continue
    metrics.push(...worksToMetrics(cache))
    accounts.push({
      id,
      nickname: cache.nickname || String(b?.nickname || ''),
      platform: platformLabel(b?.platform),
      works: cache.records.length,
      fetchedAt: cache.fetchedAt,
    })
  }
  return { metrics, accounts }
}

export function accountMonitorCapability() {
  return {
    accountMonitor: {
      wiredInPlugin: true,
      accountSource: 'publish-studio accounts.json (read-only)',
      publishCheckSource: 'publish-studio tasks.json',
      worksSource: 'creator-center work list via local authorized session (fallback: mediacrawler local json)',
      noThirdPartyApi: true,
      note: '账号监控按账号维度汇总：发布是否发出去、作品与互动。作品优先同步该账号自己的创作者中心作品列表。',
    },
  }
}
