import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isSpaceId, spaceRoot } from './paths.js'
import { getAccountBinding, listAccountSummaries, resolveCredentialPath } from './accounts.js'
import { resolveRuntimePython, spawnRuntimeEnv } from './runtime.js'

export type PatrolChannel = 'messages' | 'comments'
export type AdapterStatus = 'unsupported' | 'not_configured' | 'pending_verification' | 'need_page' | 'selector_mismatch' | 'ready'
export type ObstacleKind = 'none' | 'login_wall' | 'captcha' | 'blocked'
export type ClerkStatus = '未登录' | '待验证' | '可巡查' | '还不能巡查'
export type VerificationOutcome = 'matched_list' | 'empty_list' | 'selector_mismatch' | 'login_wall' | 'captcha' | 'blocked' | 'need_page' | 'stopped'

export type OfficialPage = { kind: string; url: string; source: string; note?: string }

export type PlatformInboxCapability = {
  platform: string
  messages: AdapterStatus
  comments: AdapterStatus
  commentsListMapped?: boolean
  knownOfficialPages: OfficialPage[]
  inboxPage: string | null
  commentsPage: string | null
  inboxVerification?: string
  commentsVerification?: string
  missing: string[]
  note: string
}

export type PatrolPolicy = {
  version: 1
  spaceId: string
  enabled: boolean
  intervalMinutes: number
  timeoutMs: number
  stopOnCaptcha: boolean
  stopOnLoginWall: boolean
  accounts: { bindingId: string; channels: PatrolChannel[]; enabled: boolean }[]
  updatedAt: number
}

export type InboundItem = {
  id: string
  spaceId: string
  bindingId: string
  platform: string
  channel: PatrolChannel
  fingerprint: string
  visibleKey: string
  visibleText: string
  seenAt: number
  authorName?: string
  workUrl?: string
  visibleTime?: string
  commentId?: string
}

export type ReplyDraft = {
  id: string
  spaceId: string
  itemId: string
  body: string
  status: 'pending_confirmation'
  createdAt: number
}

export type PatrolRun = {
  id: string
  spaceId: string
  bindingId?: string
  startedAt: number
  endedAt?: number
  status: AdapterStatus | 'stopped' | 'busy' | 'ok'
  claimedRead: boolean
  reason: string
  added: number
  duplicates: number
  obstacle?: ObstacleKind
}

type Store = {
  version: 1
  policy: PatrolPolicy
  items: InboundItem[]
  drafts: ReplyDraft[]
  runs: PatrolRun[]
  lastRunAt?: number
  exitRequested: boolean
}

export type VisibleInboxAdapter = {
  read(input: {
    spaceId: string
    bindingId: string
    platform: string
    channel: PatrolChannel
  }): Promise<{
    status: AdapterStatus
    claimedRead: boolean
    obstacle: ObstacleKind
    reason: string
    items: { visibleKey: string; visibleText: string; authorName?: string; workUrl?: string; visibleTime?: string; commentId?: string; channel?: string; itemType?: string }[]
  }>
}

const root = dirname(fileURLToPath(import.meta.url))
const contractFile = join(root, '..', 'publishing', 'inbox-page-contract.json')

const DEFAULT_INTERVAL_MINUTES = 30
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_HISTORY = 200
const MAX_RUNS = 50

const locks = new Map<string, { runId: string; startedAt: number }>()
let testAdapter: VisibleInboxAdapter | undefined

function loadContract(): { platforms: Record<string, { pages?: OfficialPage[]; inboxPage?: string | null; commentsPage?: string | null; inboxVerification?: string; commentsVerification?: string; commentsListMapped?: boolean }> } {
  return JSON.parse(readFileSync(contractFile, 'utf8'))
}

export function listInboxCapabilities(): PlatformInboxCapability[] {
  const contract = loadContract()
  return Object.keys(contract.platforms || {}).map((platform) => inboxCapability(platform, contract))
}

export function inboxCapability(platform: string, contract = loadContract()): PlatformInboxCapability {
  const entry = contract.platforms?.[platform]
  if (!entry) {
    return {
      platform,
      messages: 'unsupported',
      comments: 'unsupported',
      commentsListMapped: false,
      knownOfficialPages: [],
      inboxPage: null,
      commentsPage: null,
      missing: ['本轮只先界定抖音与小红书；该平台没有已证实的个人号私信/评论页。'],
      note: '不支持：仓库没有该平台的已验证私信或评论页面契约。',
    }
  }
  const pages = Array.isArray(entry.pages) ? entry.pages : []
  const inboxPage = entry.inboxPage || null
  const commentsPage = entry.commentsPage || null
  const inboxVerification = entry.inboxVerification || (inboxPage ? 'pending_page_check' : 'not_configured')
  const commentsVerification = entry.commentsVerification || (commentsPage ? 'pending_page_check' : 'not_configured')
  const commentsListMapped = entry.commentsListMapped !== false && commentsVerification !== 'awaiting_list_dom' && !!commentsPage
  const messages: AdapterStatus = !inboxPage ? 'not_configured' : (inboxVerification === 'verified' ? 'ready' : 'pending_verification')
  const comments: AdapterStatus = !commentsListMapped
    ? 'not_configured'
    : (commentsVerification === 'verified' ? 'ready' : 'pending_verification')
  const missing: string[] = []
  if (messages === 'pending_verification') missing.push('私信列表已按授权上游官方网页映射，仍待真实网页核对：选择器是否仍有效、创作者中心登录与 www 页是否同一登录态。夹具通过不代表已在真实网页读过。')
  if (comments === 'pending_verification') missing.push('评论列表已按公开官方页（MediaMate MIT / 创作者中心评论管理）映射，仍待真实网页核对。夹具通过不代表已在真实网页读过。')
  if (platform === 'xiaohongshu' && commentsPage && !commentsListMapped) {
    missing.push('小红书通知页地址和分区标签（评论和@ / 赞和收藏 / 新增关注）已知，但通知列表条目选择器没有取得可独立编写的许可证据，不能当作已接入。不会用笔记页评论区冒充通知列表，也不会用隐藏接口。')
  }
  if (!inboxPage) missing.push('请提供登录后打开私信时地址栏里的官方完整网址，以及列表里一条可见私信如何辨认（可见文字或无障碍名称）。不要内部接口或Cookie。')
  if (!commentsPage) missing.push('还没有可映射的该平台官方页评论地址与可见列表契约。不会搬用 B 站评论接口，也不会假装已经能读。')
  let note = '还没有可映射的官方私信或评论页地址与可见列表契约，不能假装已经能读。'
  if (platform === 'douyin') {
    note = '抖音私信和评论已按官方页映射，仍待真实网页核对，不能当作已上线。夹具通过不代表已在真实网页读过。默认不开启定时，也不会自动发送。'
  } else if (platform === 'xiaohongshu') {
    note = '小红书私信已按官方页映射，仍待真实网页核对。通知评论列表还缺列表结构证据，不能当作已接入。夹具通过不代表已在真实网页读过。默认不开启定时，也不会自动发送。'
  } else if (messages === 'ready' && comments === 'ready') {
    note = '已接入已在真实网页验证过的官方页面契约。'
  }
  return {
    platform,
    messages,
    comments,
    commentsListMapped,
    knownOfficialPages: pages,
    inboxPage,
    commentsPage,
    inboxVerification,
    commentsVerification,
    missing,
    note,
  }
}

export function adapterReady(cap: PlatformInboxCapability, channel?: PatrolChannel) {
  if (channel === 'messages') return cap.messages === 'ready'
  if (channel === 'comments') return cap.comments === 'ready'
  return cap.messages === 'ready' || cap.comments === 'ready'
}

export function hasDomMapping(cap: PlatformInboxCapability, channel?: PatrolChannel) {
  const mapped = (status: AdapterStatus) => status === 'ready' || status === 'pending_verification'
  if (channel === 'messages') return mapped(cap.messages)
  if (channel === 'comments') return mapped(cap.comments)
  return mapped(cap.messages) || mapped(cap.comments)
}

export function isLiveSamplingEnabled() {
  return process.env.PUBLISH_STUDIO_INBOX_LIVE_DOM === '1'
}

export function verificationLedgerFile(spaceId: string) {
  return join(spaceRoot(spaceId), 'inbox-page-verification.json')
}

export type LiveVerificationEntry = {
  spaceId: string
  bindingId: string
  platform: string
  channel: PatrolChannel
  officialUrl: string
  sampledAt: number
  evidenceSource: 'live_page'
  outcome: VerificationOutcome
  itemCount: number
  adapterStatus: string
}

type Ledger = { version: 1; entries: LiveVerificationEntry[] }

function emptyLedger(): Ledger {
  return { version: 1, entries: [] }
}

export function loadVerificationLedger(spaceId: string): Ledger {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  const f = verificationLedgerFile(spaceId)
  if (!existsSync(f)) return emptyLedger()
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'))
    const entries = Array.isArray(raw.entries) ? raw.entries.filter((row: LiveVerificationEntry) => row && row.evidenceSource === 'live_page') : []
    return { version: 1, entries }
  } catch {
    return emptyLedger()
  }
}

function saveVerificationLedger(spaceId: string, ledger: Ledger) {
  const f = verificationLedgerFile(spaceId)
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
  const tmp = `${f}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify({ version: 1, entries: ledger.entries.slice(0, 100) }, null, 2), { flag: 'wx', mode: 0o600 })
    renameSync(tmp, f)
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp)
  }
}

export function outcomeFromAdapter(result: { status: string; claimedRead?: boolean; obstacle?: string; items?: unknown[]; empty?: boolean }): VerificationOutcome {
  if (result.obstacle && result.obstacle !== 'none') {
    if (result.obstacle === 'login_wall' || result.obstacle === 'captcha' || result.obstacle === 'blocked') return result.obstacle
  }
  if (result.status === 'selector_mismatch') return 'selector_mismatch'
  if (result.status === 'need_page') return 'need_page'
  if (result.status === 'ready' && result.claimedRead === true) {
    const count = Array.isArray(result.items) ? result.items.length : 0
    return count === 0 || result.empty === true ? 'empty_list' : 'matched_list'
  }
  return 'stopped'
}

export function recordLiveVerification(spaceId: string, entry: Omit<LiveVerificationEntry, 'spaceId' | 'sampledAt'> & { sampledAt?: number; evidenceSource?: string; liveLaunched?: boolean }) {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  if (entry.evidenceSource !== 'live_page' || entry.liveLaunched === false) {
    throw new Error('只有真实网页只读采样才能记入核验记录，不能手动标记为已验证。')
  }
  const next: LiveVerificationEntry = {
    spaceId,
    bindingId: entry.bindingId,
    platform: entry.platform,
    channel: entry.channel,
    officialUrl: entry.officialUrl,
    sampledAt: entry.sampledAt || Date.now(),
    evidenceSource: 'live_page',
    outcome: entry.outcome,
    itemCount: entry.itemCount,
    adapterStatus: entry.adapterStatus,
  }
  const ledger = loadVerificationLedger(spaceId)
  ledger.entries = [next, ...ledger.entries.filter((row) => !(row.bindingId === next.bindingId && row.platform === next.platform && row.channel === next.channel))]
  saveVerificationLedger(spaceId, ledger)
  return next
}

export function rejectMarkVerified() {
  throw new Error('不能手动标记为已验证。只有真实网页只读采样可以记入核验记录。')
}

export function isLiveVerifiedOutcome(outcome: VerificationOutcome) {
  return outcome === 'matched_list' || outcome === 'empty_list'
}

export function spaceHasLiveVerification(spaceId: string) {
  return loadVerificationLedger(spaceId).entries.some((row) => isLiveVerifiedOutcome(row.outcome))
}

export function channelLiveVerified(spaceId: string, bindingId: string, platform: string, channel: PatrolChannel) {
  return loadVerificationLedger(spaceId).entries.some((row) => row.bindingId === bindingId && row.platform === platform && row.channel === channel && isLiveVerifiedOutcome(row.outcome))
}

export function clerkStatusFor(args: { mapped: boolean; sessionPresent?: boolean; liveVerified?: boolean }): ClerkStatus {
  if (!args.mapped) return '还不能巡查'
  if (args.liveVerified) return '可巡查'
  if (args.sessionPresent === false) return '未登录'
  return '待验证'
}

export function sessionStoragePath(spaceId: string, bindingId: string): string | null {
  try {
    const resolved = resolveCredentialPath(spaceId, bindingId)
    if (resolved?.path && existsSync(resolved.path)) return resolved.path
  } catch {
    return null
  }
  return null
}

const ADAPTER_STATUSES: AdapterStatus[] = ['unsupported', 'not_configured', 'pending_verification', 'need_page', 'selector_mismatch', 'ready']

function parseAdapterStatus(value: string): AdapterStatus {
  return ADAPTER_STATUSES.includes(value as AdapterStatus) ? value as AdapterStatus : 'not_configured'
}

function pythonBin() {
  try { return resolveRuntimePython() } catch { return 'python3' }
}

function spawnJson(bin: string, args: string[], timeoutMs: number) {
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: spawnRuntimeEnv(),
  })
  return result
}

export function officialPageUrl(cap: PlatformInboxCapability, channel: PatrolChannel) {
  return channel === 'comments' ? cap.commentsPage : cap.inboxPage
}

export function readOfficialDom(input: {
  spaceId: string
  bindingId: string
  platform: string
  channel: PatrolChannel
  intent?: 'patrol' | 'verify'
}) {
  const cap = inboxCapability(input.platform)
  const runner = join(root, '..', 'publishing', 'inbox_dom_runner.py')
  const adapter = join(root, '..', 'publishing', 'inbox_ui_adapter.py')
  const pageUrl = officialPageUrl(cap, input.channel) || ''
  const storage = sessionStoragePath(input.spaceId, input.bindingId)
  const live = isLiveSamplingEnabled()
  const htmlFile = join(tmpdir(), `ps-inbox-${input.spaceId}-${input.bindingId}-${input.channel}-${process.pid}.html`)
  const runnerArgs = [
    runner,
    '--platform', input.platform,
    '--channel', input.channel,
    '--space-id', input.spaceId,
    '--binding-id', input.bindingId,
    '--page-url', pageUrl,
    '--html-file', htmlFile,
    '--mode', live ? 'live' : 'dry',
  ]
  if (storage) runnerArgs.push('--storage-file', storage)
  if (live) runnerArgs.push('--allow-live-dom')
  const spawned = spawnJson(pythonBin(), runnerArgs, 90_000)
  let runnerBody: any = {}
  try { runnerBody = JSON.parse(String(spawned.stdout || '{}')) } catch { runnerBody = {} }
  if ((spawned.error || (spawned.status || 0) !== 0) && !runnerBody.status) {
    return {
      status: 'not_configured' as AdapterStatus,
      claimedRead: false,
      obstacle: 'none' as ObstacleKind,
      reason: '只读页面核对程序未能运行，没有读取。',
      items: [] as any[],
      verifyEntry: true,
      runnerConfigured: true,
      sessionPresent: !!storage,
      liveLaunched: false,
      sampleKind: 'not_run' as const,
    }
  }
  const sessionPresent = runnerBody.sessionPresent === true || !!storage
  if (runnerBody.liveLaunched === true && runnerBody.htmlFile && existsSync(String(runnerBody.htmlFile))) {
    const parse = spawnJson(pythonBin(), [
      adapter,
      '--platform', input.platform,
      '--channel', input.channel,
      '--mode', 'parse',
      '--html-file', String(runnerBody.htmlFile),
      '--page-url', String(runnerBody.finalUrl || pageUrl),
      '--sample-kind', 'live_page',
    ], 20_000)
    try { if (existsSync(htmlFile)) unlinkSync(htmlFile) } catch { /* ignore */ }
    try { if (runnerBody.htmlFile && runnerBody.htmlFile !== htmlFile && existsSync(String(runnerBody.htmlFile))) unlinkSync(String(runnerBody.htmlFile)) } catch { /* ignore */ }
    try {
      const body = JSON.parse(String(parse.stdout || '{}'))
      const obstacle = (['none', 'login_wall', 'captcha', 'blocked'] as const).includes(body.obstacle) ? body.obstacle : (runnerBody.obstacleHint && runnerBody.obstacleHint !== 'none' ? runnerBody.obstacleHint : 'none')
      return {
        status: parseAdapterStatus(String(body.status || 'pending_verification')),
        claimedRead: body.claimedRead === true,
        obstacle: obstacle as ObstacleKind,
        reason: String(body.reason || runnerBody.reason || ''),
        items: Array.isArray(body.items) ? body.items : [],
        empty: body.empty === true,
        verifyEntry: true,
        runnerConfigured: true,
        sessionPresent,
        liveLaunched: true,
        sampleKind: 'live_page' as const,
        officialUrl: pageUrl,
        evidenceSource: 'live_page' as const,
      }
    } catch {
      return {
        status: 'pending_verification' as AdapterStatus,
        claimedRead: false,
        obstacle: 'none' as ObstacleKind,
        reason: '已采样官方页，但解析结果无法读取，没有记为已验证。',
        items: [] as any[],
        verifyEntry: true,
        runnerConfigured: true,
        sessionPresent,
        liveLaunched: true,
        sampleKind: 'live_page' as const,
        officialUrl: pageUrl,
        evidenceSource: 'live_page' as const,
      }
    }
  }
  try { if (existsSync(htmlFile)) unlinkSync(htmlFile) } catch { /* ignore */ }
  const status = parseAdapterStatus(String(runnerBody.status || (hasDomMapping(cap, input.channel) ? 'pending_verification' : 'not_configured')))
  return {
    status,
    claimedRead: false,
    obstacle: ((['none', 'login_wall', 'captcha', 'blocked'] as const).includes(runnerBody.obstacleHint) ? runnerBody.obstacleHint : 'none') as ObstacleKind,
    reason: String(runnerBody.reason || '只读核对入口已接上，本环境未做实页采样，不会记为已验证。'),
    items: [] as any[],
    verifyEntry: runnerBody.verifyEntry !== false,
    runnerConfigured: runnerBody.runnerConfigured !== false,
    sessionPresent,
    liveLaunched: false,
    sampleKind: 'not_run' as const,
    officialUrl: pageUrl,
    clerkStatus: runnerBody.clerkStatus,
    evidenceSource: 'not_run' as const,
  }
}

function officialDomAdapter(): VisibleInboxAdapter {
  return {
    async read(input) {
      const result = readOfficialDom(input)
      return {
        status: result.status,
        claimedRead: result.claimedRead,
        obstacle: result.obstacle,
        reason: result.reason,
        items: result.items,
      }
    },
  }
}

export async function verifyPatrolPage(spaceId: string, input: Record<string, unknown> = {}) {
  const bindingId = String(input.bindingId || '').trim()
  if (!bindingId) throw new Error('请明确要核对的账号')
  const binding = getAccountBinding(spaceId, bindingId)
  const requested = String(input.channel || '').trim()
  const cap = inboxCapability(binding.platform)
  const channels = (['messages', 'comments'] as PatrolChannel[]).filter((channel) => !requested || requested === channel)
  const results = []
  let recorded = 0
  for (const channel of channels) {
    const result = readOfficialDom({ spaceId, bindingId, platform: binding.platform, channel, intent: 'verify' })
    let verificationRecorded = false
    if (result.liveLaunched && result.evidenceSource === 'live_page') {
      recordLiveVerification(spaceId, {
        bindingId,
        platform: binding.platform,
        channel,
        officialUrl: result.officialUrl || officialPageUrl(cap, channel) || '',
        evidenceSource: 'live_page',
        liveLaunched: true,
        outcome: outcomeFromAdapter(result),
        itemCount: Array.isArray(result.items) ? result.items.length : 0,
        adapterStatus: result.status,
      })
      verificationRecorded = true
      recorded += 1
    }
    results.push({
      channel,
      status: result.status,
      claimedRead: result.claimedRead,
      reason: result.reason,
      verifyEntry: true,
      runnerConfigured: true,
      sessionPresent: result.sessionPresent,
      liveLaunched: result.liveLaunched === true,
      verificationRecorded,
      clerkStatus: clerkStatusFor({
        mapped: hasDomMapping(cap, channel),
        sessionPresent: result.sessionPresent,
        liveVerified: channelLiveVerified(spaceId, bindingId, binding.platform, channel),
      }),
    })
  }
  const connected = spaceHasLiveVerification(spaceId)
  return {
    success: true,
    spaceId,
    bindingId,
    verificationRecorded: recorded > 0,
    recorded,
    liveSamplingEnabled: isLiveSamplingEnabled(),
    connected,
    verifyEntry: true,
    reason: recorded > 0
      ? '已把真实网页只读采样记入核验记录。'
      : '只读核对入口可用。本环境未做实页采样，不会记为已验证。',
    results,
    ledger: publicVerificationLedger(spaceId),
  }
}

export function publicVerificationLedger(spaceId: string) {
  return loadVerificationLedger(spaceId).entries.map((row) => ({
    bindingId: row.bindingId,
    platform: row.platform,
    channel: row.channel,
    officialUrl: row.officialUrl,
    sampledAt: row.sampledAt,
    evidenceSource: row.evidenceSource,
    outcome: row.outcome,
    itemCount: row.itemCount,
    adapterStatus: row.adapterStatus,
  }))
}

export function defaultPatrolPolicy(spaceId: string): PatrolPolicy {
  return {
    version: 1,
    spaceId,
    enabled: false,
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    stopOnCaptcha: true,
    stopOnLoginWall: true,
    accounts: [],
    updatedAt: 0,
  }
}

function file(spaceId: string) {
  return join(spaceRoot(spaceId), 'inbox-patrol.json')
}

function emptyStore(spaceId: string): Store {
  return { version: 1, policy: defaultPatrolPolicy(spaceId), items: [], drafts: [], runs: [], exitRequested: false }
}

function load(spaceId: string): Store {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  const f = file(spaceId)
  if (!existsSync(f)) return emptyStore(spaceId)
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'))
    if (raw.version !== 1 || !raw.policy) throw new Error()
    return {
      version: 1,
      policy: { ...defaultPatrolPolicy(spaceId), ...raw.policy, spaceId, enabled: raw.policy.enabled === true },
      items: Array.isArray(raw.items) ? raw.items : [],
      drafts: Array.isArray(raw.drafts) ? raw.drafts : [],
      runs: Array.isArray(raw.runs) ? raw.runs : [],
      lastRunAt: raw.lastRunAt,
      exitRequested: raw.exitRequested === true,
    }
  } catch {
    throw new Error('巡查记录损坏，已保留原文件')
  }
}

function save(spaceId: string, store: Store) {
  const f = file(spaceId)
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
  const tmp = `${f}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(store, null, 2), { flag: 'wx', mode: 0o600 })
    renameSync(tmp, f)
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp)
  }
}

export function classifyVisibleObstacle(visibleText: string): ObstacleKind {
  const text = String(visibleText || '')
  if (!text.trim()) return 'none'
  if (/(验证码|安全验证|滑动验证|captcha|unusual traffic|robot check)/i.test(text)) return 'captcha'
  if (/(请先登录|请登录|登录后查看|扫码登录|登录已过期|session expired|sign in to continue)/i.test(text)) return 'login_wall'
  if (/(访问频率过高|操作过于频繁|账号异常|暂时无法访问|请求被拦截)/i.test(text)) return 'blocked'
  return 'none'
}

export function inboundFingerprint(spaceId: string, bindingId: string, channel: PatrolChannel, visibleKey: string) {
  return createHash('sha256').update(`${spaceId}\0${bindingId}\0${channel}\0${String(visibleKey || '').trim()}`).digest('hex')
}

export function mergeInbound(existing: InboundItem[], incoming: InboundItem[]) {
  const seen = new Set(existing.map((item) => item.fingerprint))
  const added: InboundItem[] = []
  let duplicates = 0
  for (const item of incoming) {
    if (seen.has(item.fingerprint)) {
      duplicates += 1
      continue
    }
    seen.add(item.fingerprint)
    added.push(item)
  }
  const items = [...added, ...existing].slice(0, MAX_HISTORY)
  return { items, added: added.length, duplicates }
}

export function isTickDue(policy: Pick<PatrolPolicy, 'enabled' | 'intervalMinutes'>, lastRunAt: number | undefined, now: number) {
  if (!policy.enabled) return false
  const interval = Math.max(1, Number(policy.intervalMinutes) || DEFAULT_INTERVAL_MINUTES) * 60_000
  if (!lastRunAt) return true
  return now - lastRunAt >= interval
}

export function lockKey(spaceId: string, bindingId: string) {
  return `${spaceId}:${bindingId}`
}

export function canStartPatrolRun(args: { spaceId: string; bindingId: string; now: number; timeoutMs: number; exitRequested: boolean }) {
  if (args.exitRequested) return { ok: false, status: 'stopped' as const, reason: '已请求退出巡查' }
  const key = lockKey(args.spaceId, args.bindingId)
  const current = locks.get(key)
  if (current && args.now - current.startedAt < Math.max(1000, args.timeoutMs)) {
    return { ok: false, status: 'busy' as const, reason: '该公司该账号的巡查仍在进行' }
  }
  if (current) locks.delete(key)
  return { ok: true, status: 'ok' as const, reason: '' }
}

export function shouldApplyPatrolResult(args: { requestSpaceId: string; currentSpaceId: string; live: boolean }) {
  return args.live && !!args.requestSpaceId && args.requestSpaceId === args.currentSpaceId
}

function publicPolicy(policy: PatrolPolicy) {
  return {
    enabled: policy.enabled === true,
    intervalMinutes: policy.intervalMinutes,
    timeoutMs: policy.timeoutMs,
    stopOnCaptcha: policy.stopOnCaptcha !== false,
    stopOnLoginWall: policy.stopOnLoginWall !== false,
    accounts: policy.accounts,
    updatedAt: policy.updatedAt,
  }
}

function publicRun(run: PatrolRun) {
  return {
    id: run.id,
    bindingId: run.bindingId || '',
    startedAt: run.startedAt,
    endedAt: run.endedAt || null,
    status: run.status,
    claimedRead: run.claimedRead === true,
    reason: run.reason,
    added: run.added,
    duplicates: run.duplicates,
    obstacle: run.obstacle || 'none',
  }
}

function publicItem(item: InboundItem) {
  return {
    id: item.id,
    bindingId: item.bindingId,
    platform: item.platform,
    channel: item.channel,
    visibleText: item.visibleText,
    seenAt: item.seenAt,
    authorName: item.authorName || '',
    workUrl: item.workUrl || '',
    visibleTime: item.visibleTime || '',
    commentId: item.commentId || '',
  }
}

export function getPatrolState(spaceId: string) {
  const store = load(spaceId)
  const capabilities = listInboxCapabilities()
  return {
    success: true,
    spaceId,
    policy: publicPolicy(store.policy),
    capabilities,
    lastRunAt: store.lastRunAt || null,
    lastRun: store.runs[0] ? publicRun(store.runs[0]) : null,
    history: store.items.map(publicItem),
    drafts: store.drafts.map((d) => ({ id: d.id, itemId: d.itemId, body: d.body, status: d.status, createdAt: d.createdAt })),
    exitRequested: store.exitRequested === true,
    connected: spaceHasLiveVerification(spaceId),
    verifyEntry: true,
    liveSamplingEnabled: isLiveSamplingEnabled(),
    pageEvidence: publicVerificationLedger(spaceId),
    note: '抖音私信、抖音评论和小红书私信已按官方页映射，仍待真实网页核对。小红书通知评论列表还缺列表结构证据。默认关闭定时。只读核对不会自动发送。夹具通过不代表已在真实网页读过。',
  }
}

export function savePatrolPolicy(spaceId: string, input: Record<string, unknown>) {
  const store = load(spaceId)
  const enabled = input.enabled === true
  const capabilities = listInboxCapabilities()
  if (enabled && !spaceHasLiveVerification(spaceId) && !capabilities.some((cap) => adapterReady(cap))) {
    throw new Error('官方页面仍待真实网页核对或尚未接入，不能开启定时巡查。不会假装功能已可用。')
  }
  const accounts = Array.isArray(input.accounts) ? input.accounts : store.policy.accounts
  const nextAccounts = (accounts as any[]).map((row) => {
    const bindingId = String(row.bindingId || '').trim()
    if (!bindingId) throw new Error('请明确账号')
    getAccountBinding(spaceId, bindingId)
    const channels = (Array.isArray(row.channels) ? row.channels : ['messages', 'comments']).filter((c: string) => c === 'messages' || c === 'comments')
    return { bindingId, channels: (channels.length ? channels : ['messages', 'comments']) as PatrolChannel[], enabled: row.enabled !== false }
  })
  store.policy = {
    ...store.policy,
    spaceId,
    enabled,
    intervalMinutes: Math.min(24 * 60, Math.max(5, Number(input.intervalMinutes) || store.policy.intervalMinutes || DEFAULT_INTERVAL_MINUTES)),
    timeoutMs: Math.min(5 * 60_000, Math.max(5_000, Number(input.timeoutMs) || store.policy.timeoutMs || DEFAULT_TIMEOUT_MS)),
    stopOnCaptcha: input.stopOnCaptcha === false ? false : true,
    stopOnLoginWall: input.stopOnLoginWall === false ? false : true,
    accounts: nextAccounts,
    updatedAt: Date.now(),
  }
  store.exitRequested = false
  save(spaceId, store)
  return { success: true, spaceId, policy: publicPolicy(store.policy), connected: spaceHasLiveVerification(spaceId), note: '已保存巡查策略。定时默认关闭，页面仍待真实网页核对或未接入时不能打开。' }
}

export function requestPatrolStop(spaceId: string) {
  const store = load(spaceId)
  store.exitRequested = true
  save(spaceId, store)
  for (const key of [...locks.keys()]) {
    if (key.startsWith(`${spaceId}:`)) locks.delete(key)
  }
  return { success: true, spaceId, exitRequested: true, note: '已请求停止巡查，不会删除历史或账号。' }
}

export function prepareReplyDraft(spaceId: string, itemId: string, body: string) {
  const store = load(spaceId)
  const item = store.items.find((row) => row.id === itemId)
  if (!item) throw new Error('找不到当前公司的这条消息或评论')
  const text = String(body || '').trim()
  if (!text) throw new Error('请填写回复草稿')
  const draft: ReplyDraft = { id: `draft-${randomUUID()}`, spaceId, itemId, body: text.slice(0, 2000), status: 'pending_confirmation', createdAt: Date.now() }
  store.drafts = [draft, ...store.drafts].slice(0, MAX_HISTORY)
  save(spaceId, store)
  return { success: true, spaceId, draft: { id: draft.id, itemId: draft.itemId, body: draft.body, status: draft.status, createdAt: draft.createdAt }, note: '草稿已保存，等待确认。此阶段不会发送。' }
}

export function rejectPatrolSend() {
  throw new Error('此阶段不执行真实回复或自动发送。只能保存待确认草稿。')
}

export function setInboxAdapterForTests(adapter?: VisibleInboxAdapter) {
  testAdapter = adapter
}

function recordRun(store: Store, run: PatrolRun) {
  store.runs = [run, ...store.runs].slice(0, MAX_RUNS)
  store.lastRunAt = run.endedAt || run.startedAt
}

export async function runPatrol(spaceId: string, input: Record<string, unknown> = {}) {
  const bindingId = String(input.bindingId || '').trim()
  if (!bindingId) throw new Error('请明确要巡查的账号')
  const binding = getAccountBinding(spaceId, bindingId)
  const store = load(spaceId)
  const now = Date.now()
  const timeoutMs = store.policy.timeoutMs || DEFAULT_TIMEOUT_MS
  const start = canStartPatrolRun({ spaceId, bindingId, now, timeoutMs, exitRequested: store.exitRequested })
  if (!start.ok) {
    const run: PatrolRun = { id: `run-${randomUUID()}`, spaceId, bindingId, startedAt: now, endedAt: now, status: start.status, claimedRead: false, reason: start.reason, added: 0, duplicates: 0 }
    recordRun(store, run)
    save(spaceId, store)
    return { success: true, spaceId, claimedRead: false, status: start.status, reason: start.reason, added: 0, duplicates: 0, items: [], lastRun: publicRun(run) }
  }

  const cap = inboxCapability(binding.platform)
  const channels = (store.policy.accounts.find((row) => row.bindingId === bindingId)?.channels || ['messages', 'comments']) as PatrolChannel[]
  const runId = `run-${randomUUID()}`
  const run: PatrolRun = { id: runId, spaceId, bindingId, startedAt: now, status: 'not_configured', claimedRead: false, reason: '', added: 0, duplicates: 0 }
  locks.set(lockKey(spaceId, bindingId), { runId, startedAt: now })
  try {
    if (!channels.some((channel) => hasDomMapping(cap, channel) || adapterReady(cap, channel)) && !testAdapter) {
      run.status = cap.messages === 'unsupported' && cap.comments === 'unsupported' ? 'unsupported' : 'not_configured'
      run.claimedRead = false
      run.reason = cap.note
      run.endedAt = Date.now()
      recordRun(store, run)
      save(spaceId, store)
      return { success: true, spaceId, claimedRead: false, status: run.status, reason: run.reason, added: 0, duplicates: 0, items: [], capability: cap, lastRun: publicRun(run), missing: cap.missing }
    }

    const incoming: InboundItem[] = []
    let obstacle: ObstacleKind = 'none'
    let reason = ''
    let claimedRead = false
    let status: PatrolRun['status'] = 'ok'
    for (const channel of channels) {
      if (!testAdapter && !hasDomMapping(cap, channel)) {
        if (channel === 'comments') {
          if (status === 'ok') reason = reason || '该平台评论页尚未映射官方列表。'
          continue
        }
        status = cap.messages === 'unsupported' ? 'unsupported' : 'not_configured'
        reason = cap.note
        continue
      }
      const adapter = testAdapter || officialDomAdapter()
      const result = await adapter.read({ spaceId, bindingId, platform: binding.platform, channel })
      obstacle = result.obstacle
      reason = result.reason || reason
      if (result.obstacle !== 'none') {
        status = 'stopped'
        claimedRead = false
        reason = result.obstacle === 'captcha'
          ? '页面出现验证码或安全拦截，已停止，需要你在官方页面处理。'
          : result.obstacle === 'login_wall'
            ? '页面需要重新登录，已停止，需要你在官方页面处理。'
            : '页面被拦截，已停止，需要你在官方页面处理。'
        break
      }
      if (result.status !== 'ready' || result.claimedRead !== true) {
        status = result.status
        claimedRead = false
        reason = result.reason || cap.note
        continue
      }
      claimedRead = true
      for (const row of result.items || []) {
        const visibleKey = String(row.visibleKey || row.visibleText || '').trim()
        if (!visibleKey) continue
        incoming.push({
          id: `in-${randomUUID()}`,
          spaceId,
          bindingId,
          platform: binding.platform,
          channel,
          fingerprint: inboundFingerprint(spaceId, bindingId, channel, visibleKey),
          visibleKey,
          visibleText: String(row.visibleText || visibleKey).slice(0, 500),
          seenAt: Date.now(),
          authorName: String(row.authorName || '').slice(0, 200) || undefined,
          workUrl: String(row.workUrl || '').slice(0, 500) || undefined,
          visibleTime: String(row.visibleTime || '').slice(0, 80) || undefined,
          commentId: String(row.commentId || '').slice(0, 200) || undefined,
        })
      }
    }
    const merged = mergeInbound(store.items, incoming)
    store.items = merged.items
    if (!claimedRead && status === 'ok' && (hasDomMapping(cap, 'messages') || hasDomMapping(cap, 'comments'))) status = 'pending_verification'
    run.status = claimedRead ? 'ok' : status
    run.claimedRead = claimedRead
    run.reason = reason || (claimedRead ? '已从可见页面文本收录（去重后）' : cap.note)
    run.added = merged.added
    run.duplicates = merged.duplicates
    run.obstacle = obstacle
    run.endedAt = Date.now()
    recordRun(store, run)
    save(spaceId, store)
    return {
      success: true,
      spaceId,
      claimedRead,
      status: run.status,
      reason: run.reason,
      added: merged.added,
      duplicates: merged.duplicates,
      items: claimedRead ? incoming.map(publicItem) : [],
      lastRun: publicRun(run),
      capability: cap,
    }
  } finally {
    const current = locks.get(lockKey(spaceId, bindingId))
    if (current?.runId === runId) locks.delete(lockKey(spaceId, bindingId))
  }
}

export function maybeTickPatrol(spaceId: string, now = Date.now()) {
  const store = load(spaceId)
  if (!isTickDue(store.policy, store.lastRunAt, now)) {
    return { success: true, spaceId, due: false, claimedRead: false, note: '未到巡查时间，或定时仍关闭。未启动持久调度。' }
  }
  if (!spaceHasLiveVerification(spaceId) && !listInboxCapabilities().some((cap) => adapterReady(cap))) {
    return { success: true, spaceId, due: false, claimedRead: false, status: 'not_configured', note: '页面未接入或仍待真实网页核对，即使策略想开启也不会真正巡查。' }
  }
  return { success: true, spaceId, due: true, claimedRead: false, note: '仅报告到期，本阶段不自动拉起浏览器或发送。' }
}

export function resetPatrolLocksForTests() {
  locks.clear()
}

export function listAccountOptions(spaceId: string) {
  return listAccountSummaries(spaceId).map((item) => ({ id: item.id, platform: item.platform, label: item.label, status: item.status }))
}
