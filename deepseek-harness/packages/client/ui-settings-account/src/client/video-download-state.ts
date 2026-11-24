/** Pure helpers for DigitalHumanVideoDownload — unit-tested without DOM. */

export type DownloadTab = 'download' | 'search' | 'wordcloud'

export type TaskLike = {
  id: string
  spaceId?: string
  status?: string
  code?: string
  mode?: string
  sourceKind?: string
  searchHits?: unknown[]
}

export function partitionMediaTasks<T extends TaskLike>(tasks: T[]): { download: T[]; search: T[] } {
  const download: T[] = []
  const search: T[] = []
  for (const t of tasks) {
    if (t.mode === 'search' || t.sourceKind === 'keyword_search') search.push(t)
    else download.push(t)
  }
  return { download, search }
}

export function hasActiveMediaTask(tasks: TaskLike[]): boolean {
  return tasks.some((t) => t.status === 'running' || t.status === 'queued' || t.status === 'needs_login')
}

export function needsLoginBanner(tasks: TaskLike[]): boolean {
  return tasks.some((t) => t.status === 'needs_login' || t.code === 'needs_login')
}

export function platformRestrictedBanner(tasks: TaskLike[]): boolean {
  return tasks.some((t) => t.code === 'platform_restricted')
}

/** Prefer explicit empty-input errors over stale notices. */
export function resolveActionErrorPriority(input: {
  emptyInputMessage?: string
  responseError?: string
  taskError?: string
  nextStep?: string
  fallback: string
}): string {
  if (input.emptyInputMessage) return input.emptyInputMessage
  const base = input.taskError || input.responseError || input.fallback
  return input.nextStep ? `${base}；${input.nextStep}` : base
}

export function wordcloudResultHref(spaceId: string, taskId: string, kind: 'png' | 'freq'): string {
  const q = new URLSearchParams({ space: spaceId, id: taskId, kind })
  return `/digital-human-studio/comment-wordcloud?${q.toString()}`
}

export function isSameOriginWordcloudPath(href: string): boolean {
  return href.startsWith('/digital-human-studio/comment-wordcloud?')
}

export function validateCommentImportFile(file: { size: number; name?: string } | null): {
  ok: boolean
  error?: string
  clearFixture?: boolean
} {
  if (!file) return { ok: false, error: '未选择文件' }
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: '文件超过 2MB 上限' }
  return { ok: true, clearFixture: true }
}

export function shouldApplyAsyncResult(args: {
  requestSpaceId: string
  currentSpaceId: string
  live: boolean
}): boolean {
  return args.live && args.requestSpaceId === args.currentSpaceId && !!args.currentSpaceId
}

export function filterTasksForSpace<T extends TaskLike>(tasks: T[], spaceId: string): T[] {
  if (!spaceId) return []
  // Legacy tasks may omit spaceId; keep them only when list was fetched for this space
  // (caller must clear on space change). If spaceId present, enforce match.
  return tasks.filter((t) => !t.spaceId || t.spaceId === spaceId)
}

export function defaultBrowserMode(
  fromCapability: string | undefined,
  current: 'standard' | 'cdp_existing' | 'cdp_launch',
  seeded: boolean,
): { mode: 'standard' | 'cdp_existing' | 'cdp_launch'; seeded: boolean } {
  if (seeded) return { mode: current, seeded: true }
  if (fromCapability === 'standard' || fromCapability === 'cdp_existing' || fromCapability === 'cdp_launch') {
    return { mode: fromCapability, seeded: true }
  }
  return { mode: current, seeded: false }
}

export function tabKeepsInFlightTasks(
  prevTab: DownloadTab,
  nextTab: DownloadTab,
  tasks: TaskLike[],
): boolean {
  // Switching tabs must not drop in-flight media tasks from local state.
  void prevTab
  void nextTab
  return hasActiveMediaTask(tasks) || tasks.length >= 0
}

export const COLLECT_PLATFORM_LABEL: Record<string, string> = {
  dy: '抖音',
  douyin: '抖音',
  xhs: '小红书',
  ks: '快手',
  kuaishou: '快手',
  bili: 'B站',
  bilibili: 'B站',
  wb: '微博',
  weibo: '微博',
}

export function collectPlatformLabel(platform?: string): string {
  if (!platform) return ''
  return COLLECT_PLATFORM_LABEL[platform] || COLLECT_PLATFORM_LABEL[platform.toLowerCase()] || platform
}

export function classifyHintText(parsed?: { platform?: string; mediaDownloadSupported?: boolean } | null): string {
  if (!parsed) return ''
  const name = collectPlatformLabel(parsed.platform)
  if (!name) return parsed.mediaDownloadSupported ? '可以下载' : '不能下载'
  return parsed.mediaDownloadSupported ? `${name}，可以下载` : `${name}，不能下载`
}

export function isDouyinPlatform(platform?: string, source?: string): boolean {
  const p = (platform || '').toLowerCase()
  if (p === 'dy' || p === 'douyin') return true
  return /douyin\.com|v\.douyin|iesdouyin/.test((source || '').toLowerCase())
}

export function douyinCdpHint(opts: { platform?: string; source?: string; cdpOk?: boolean }): string {
  if (!isDouyinPlatform(opts.platform, opts.source)) return ''
  if (opts.cdpOk === true) return ''
  return '抖音要先在本机打开并登录。下不下来就去素材柜传文件。'
}

/** First sentence only — never join a path/setup list onto the clerk banner. */
export function pendingSetupBanner(pendingSetup?: string[]): string {
  const first = (pendingSetup || []).map((item) => String(item || '').trim()).find(Boolean)
  if (!first) return '本机采集还没就绪'
  const sentence = first.split(/(?<=[。！？!?])/)[0]?.trim() || first
  if (!sentence || isTechnicalCollectText(sentence)) return '本机采集还没就绪'
  return sentence
}

export function collectStatusLabel(status?: string, mode: DownloadTab = 'download'): string {
  if (status === 'queued') return '排队中'
  if (status === 'running') {
    if (mode === 'search') return '搜索中'
    if (mode === 'wordcloud') return '生成中'
    return '下载中'
  }
  if (status === 'succeeded') return mode === 'download' ? '已入库' : '已完成'
  if (status === 'failed' || status === 'rejected') return '失败'
  if (status === 'needs_login') return '需登录'
  if (status === 'needs_setup') return '未配置'
  if (status === 'cancelled') return '已取消'
  return status || ''
}

export function collectSlotLabel(slot?: string): string {
  if (slot === 'product') return '产品'
  if (slot === 'store') return '门店'
  if (slot === 'logo') return 'Logo'
  return slot || ''
}

export function abbreviateCollectTitle(source: string, max = 28): string {
  const text = String(source || '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(1, max - 1))}…`
}

export function collectRailTitle(task: { source?: string; keywords?: string; sourceLabel?: string; id?: string }): string {
  if (task.keywords) return abbreviateCollectTitle(task.keywords)
  if (task.source) return abbreviateCollectTitle(task.source)
  if (task.sourceLabel) return abbreviateCollectTitle(task.sourceLabel)
  return task.id || ''
}

export function collectRailMeta(task: { platform?: string; slot?: string }): string {
  return [collectPlatformLabel(task.platform) || task.platform, collectSlotLabel(task.slot)].filter(Boolean).join(' · ')
}

export function collectRailEmpty(mode: DownloadTab): string {
  if (mode === 'search') return '还没有选题任务。'
  if (mode === 'wordcloud') return '还没有词云任务。'
  return '还没有采集任务。'
}

export function downloadSuccessNotice(slot: string): string {
  return `已放入素材柜（${collectSlotLabel(slot) || slot}）`
}

export type DownloadSubmission = {
  spaceId: string
  taskId: string
  source: string
  slot: string
  noticed?: boolean
}

/** Only the current company's current submission may notice/clear, and only once. */
export function shouldApplyDownloadSuccess(args: {
  submission: DownloadSubmission | null
  currentSpaceId: string
  live: boolean
  task?: { id?: string; status?: string; mock?: boolean } | null
}): { notice: boolean; sourceToClear?: string } {
  const sub = args.submission
  const task = args.task
  if (!sub || sub.noticed) return { notice: false }
  if (!shouldApplyAsyncResult({ requestSpaceId: sub.spaceId, currentSpaceId: args.currentSpaceId, live: args.live })) {
    return { notice: false }
  }
  if (!task || task.id !== sub.taskId || task.mock || task.status !== 'succeeded') return { notice: false }
  return { notice: true, sourceToClear: sub.source }
}

export function nextSourceAfterSuccess(currentSource: string, sourceToClear?: string): string {
  if (sourceToClear != null && currentSource.trim() === sourceToClear) return ''
  return currentSource
}

export const COLLECT_NEEDS_LOGIN_MESSAGE = '采集登录失效。请在原版爬虫里重新保存登录后再刷新，不用开日常浏览器。'
export const COLLECT_RESTRICTED_MESSAGE = '这条平台侧打不开，换一条试试。'
export const COLLECT_BROWSER_UNAVAILABLE_MESSAGE = '抖音这条要靠已经打开抖音的浏览器，现在连不上。'
export const COLLECT_FAILURE_FALLBACK = '下载没成功，请再试一次或去素材柜传文件。'
export const COLLECT_KEYWORD_EMPTY = '请输入关键词。选题不会下载视频。'
/** @deprecated use COLLECT_NEEDS_LOGIN_MESSAGE */
export const COLLECT_NEEDS_LOGIN_BANNER = COLLECT_NEEDS_LOGIN_MESSAGE
/** @deprecated use COLLECT_RESTRICTED_MESSAGE */
export const COLLECT_RESTRICTED_BANNER = COLLECT_RESTRICTED_MESSAGE

export type CollectFailureKind = 'browser_unavailable' | 'needs_login' | 'platform_restricted' | 'failed' | null

export type CollectFailureTask = {
  status?: string
  code?: string
  error?: string
  nextStep?: string
  detail?: string
  source?: string
  slot?: string
  spaceId?: string
}

const COLLECT_FAILURE_STATUSES = new Set(['failed', 'rejected', 'needs_login', 'needs_setup'])

export function isTechnicalCollectText(text?: string): boolean {
  return /cdp|9222|远程调试|devtools|debug(?:ger| port)?|127\.0\.0\.1|不要改端口|localhost:\d+/i.test(String(text || ''))
}

function collectFailureHaystack(task: CollectFailureTask): string {
  return [task.code, task.error, task.nextStep, task.detail].filter(Boolean).join(' ')
}

function isBrowserUnavailableFailure(task: CollectFailureTask): boolean {
  const haystack = collectFailureHaystack(task)
  const code = String(task.code || '')
  if (/cdp_unavailable/i.test(code) || /cdp_unavailable/i.test(haystack)) return true
  if (/无法连接.*(?:Chrome|CDP)|Chrome CDP|本机 Chrome 还没连上/i.test(haystack)) return true
  if (/127\.0\.0\.1:9222/.test(haystack) && /无法连接|连不上|不可用/i.test(haystack)) return true
  if (task.status === 'needs_setup' && /无法连接|连不上/.test(haystack) && /chrome|cdp/i.test(haystack)) return true
  return false
}

/** Classify the currently selected task only — never a tasks.some() of history. */
export function collectFailureKind(task?: CollectFailureTask | null): CollectFailureKind {
  if (!task) return null
  if (!COLLECT_FAILURE_STATUSES.has(String(task.status || ''))) return null
  const code = String(task.code || '')
  if (code === 'media_fetch_failed') return 'failed'
  if (isBrowserUnavailableFailure(task)) return 'browser_unavailable'
  if (task.status === 'needs_login' || code === 'needs_login' || /(?:^|\b)needs_login(?:\b|$)/i.test(code)) return 'needs_login'
  if (/platform_restricted|captcha/i.test(`${code} ${task.error || ''}`)) return 'platform_restricted'
  return 'failed'
}

export function collectFailureClerkMessage(kind: CollectFailureKind, task?: CollectFailureTask | null): string {
  if (kind === 'browser_unavailable') return COLLECT_BROWSER_UNAVAILABLE_MESSAGE
  if (kind === 'needs_login') return COLLECT_NEEDS_LOGIN_MESSAGE
  if (kind === 'platform_restricted') return COLLECT_RESTRICTED_MESSAGE
  if (kind === 'failed') {
    const error = String(task?.error || '').trim()
    if (!error || isTechnicalCollectText(error)) return COLLECT_FAILURE_FALLBACK
    return error.split(/(?<=[。！？!?])/)[0]?.trim() || error
  }
  return ''
}

export function collectFailureDetails(task?: CollectFailureTask | null): string {
  if (!task) return ''
  return [task.error, task.nextStep, task.detail].map((item) => String(item || '').trim()).filter(Boolean).join('\n\n')
}

export function collectVisibleSubmitError(error?: string, fallback = COLLECT_FAILURE_FALLBACK): string {
  const text = String(error || '').trim()
  if (!text || isTechnicalCollectText(text)) return fallback
  return text.split(/(?<=[。！？!?])/)[0]?.trim() || text
}

export function collectSubmitErrorFromResult(
  value?: { success?: boolean; error?: string; task?: CollectFailureTask | null } | null,
  fallback = COLLECT_FAILURE_FALLBACK,
): string {
  const clerk = collectFailureClerkMessage(collectFailureKind(value?.task), value?.task)
  if (clerk) return clerk
  return collectVisibleSubmitError(value?.error || value?.task?.error, fallback)
}

/** Retry must use the selected task's source/slot, never a stale input after setState. */
export function collectRetryRequest(args: {
  task?: CollectFailureTask | null
  currentSpaceId: string
  fallbackSlot: string
}): { source: string; slot: string } | null {
  const task = args.task
  const source = String(task?.source || '').trim()
  if (!task || !source) return null
  if (task.spaceId && args.currentSpaceId && task.spaceId !== args.currentSpaceId) return null
  return { source, slot: String(task.slot || args.fallbackSlot || 'product') }
}

export function collectIngestedVideoNames(materials?: { name?: string; kind?: string }[] | null): string[] {
  const names: string[] = []
  for (const item of materials || []) {
    const name = String(item.name || '').trim()
    if (!name) continue
    if (item.kind === 'image' || item.kind === 'cover' || item.kind === 'audio') continue
    if (/\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(name) || /[-_]cover\./i.test(name)) continue
    if (item.kind === 'video' || /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(name)) names.push(name)
  }
  return names
}

export function collectVideoOnlyNote(code?: string): string {
  return code === 'video_only' ? '这条没有单独音轨' : ''
}

export function collectDialogTitle(task?: { status?: string } | null, mode: DownloadTab = 'download'): string {
  const status = String(task?.status || '')
  const running = status === 'running' || status === 'queued'
  if (mode === 'search') {
    if (status === 'succeeded') return '选题完成'
    if (running) return '选题中'
    return '选题没成功'
  }
  if (mode === 'wordcloud') {
    if (status === 'succeeded') return '词云完成'
    if (running) return '词云生成中'
    return '词云没成功'
  }
  if (status === 'succeeded') return '已放入素材柜'
  if (running) return '下载中'
  return '下载没成功'
}

export function isCollectSessionTerminal(status?: string): boolean {
  return ['succeeded', 'failed', 'rejected', 'needs_setup', 'needs_login', 'cancelled'].includes(String(status || ''))
}

/** Auto-open only this-session submission terminals. History, first load, and dismissed ids stay closed. */
export function shouldAutoOpenCollectDialog(args: {
  live?: boolean
  submissionTaskId?: string
  submissionSpaceId?: string
  currentSpaceId: string
  task?: { id?: string; status?: string } | null
  dismissed?: { spaceId: string; taskId: string } | null
}): boolean {
  if (args.live === false) return false
  const submissionTaskId = String(args.submissionTaskId || '')
  const submissionSpaceId = String(args.submissionSpaceId || '')
  const currentSpaceId = String(args.currentSpaceId || '')
  if (!submissionTaskId || !submissionSpaceId || !currentSpaceId) return false
  if (submissionSpaceId !== currentSpaceId) return false
  const task = args.task
  if (!task || task.id !== submissionTaskId) return false
  if (!isCollectSessionTerminal(task.status)) return false
  const dismissed = args.dismissed
  if (dismissed && dismissed.spaceId === currentSpaceId && dismissed.taskId === task.id) return false
  return true
}
