import { existsSync } from 'node:fs'
import { loadPublishCalendar, setPlanAuto, planDueAt, type PublishPlan, markPlanPublished } from './publish-calendar.js'
import { loadPacks, packView, packDownload, savePack, checkPack, resolveCoverRef, type PublishPack } from './publish-packs.js'
import { ensureExportThumb, exportCoverFramePath } from './export-history.js'
import { getPublishStudio } from './publish-studio-bridge.js'
import { loadSpaceStore } from './spaces.js'
import { loadStudioHistory } from './studio-history.js'
import { cleanPlatformCopy, cleanPlatformTitle, cleanPlatformTopics } from './publication-service.js'

/** 错过窗口不再补发：宁可漏发一次让人手动补，也不要在两小时后突然把旧片子发出去。 */
const GRACE_MS = 60 * 60 * 1000
/** running 状态超过这个时间没有回执，就当作结果未知，禁止重试。 */
const STALE_RUNNING_MS = 20 * 60 * 1000

const PLATFORM_ALIAS: Record<string, string> = {
  抖音: 'douyin', 小红书: 'xiaohongshu', 视频号: 'tencent', 微信视频号: 'tencent',
  快手: 'kuaishou', B站: 'bilibili', 哔哩哔哩: 'bilibili',
  公众号: 'wechat_official', 微信公众号: 'wechat_official',
}

export type AutoFireRecord = { planId: string; title: string; state: string; taskId?: string; error?: string }
export type AutoSkipRecord = { planId: string; title: string; reason: string }
export type AutoSendReport = {
  enabled: boolean
  checkedAt: number
  scanned: number
  fired: AutoFireRecord[]
  skipped: AutoSkipRecord[]
}

export function autoPublishEnabled(): boolean {
  return String(process.env.XCY_AUTO_PUBLISH || '') !== '0'
}

function normalizePlatform(value: string): string {
  return PLATFORM_ALIAS[value] || value
}

async function bindingFor(studio: any, space: string, platform: string) {
  const listed = await studio.action(space, 'ui', { action: 'accounts.list' })
  const items: any[] = (listed && listed.items) || []
  return items.find((b: any) => b && b.enabled !== false && String(b.platform) === normalizePlatform(platform)) || null
}

/** 一条排期能不能自动发：能就返回准备信息，不能就返回原因（原因会写进日历，不静默丢掉）。 */
async function prepareAuto(space: string, plan: PublishPlan, studio: any, bindingOverride?: any) {
  const pack = loadPacks(space).find(p => p.planId === plan.id)
  if (!pack) return { blocked: '还没有发布包文案（去「发布」页写文案并检查）' as string }
  const view = packView(space, pack)
  if (!view.checked) return { blocked: '发布包没通过人工检查（文案或封面改过要重新点检查）' as string }
  if (view.missingVideo) return { blocked: '这条排期关联的成片不见了' as string }
  if (view.missingCover) return { blocked: '发布包没有可用封面' as string }
  const binding = bindingOverride || await bindingFor(studio, space, plan.platform || view.planPlatform)
  if (!binding) return { blocked: `没有「${plan.platform || '未填'}」平台的账号绑定（先去「平台账号」加账号）` as string }
  if (binding.status !== 'authorized' && binding.status !== 'ready') return { blocked: '账号登录态失效，请到「平台账号」重新扫码登录' as string }
  if (binding.hasCredentialFile === false) return { blocked: '账号登录态缺失，请重新扫码登录' as string }
  let video: any, cover: any
  try {
    video = packDownload(space, pack.id, 'video')
    cover = packDownload(space, pack.id, 'cover')
  } catch (e: any) {
    return { blocked: `素材不可用：${e?.message || '读取失败'}` as string }
  }
  if (!video?.path || !cover?.path) return { blocked: '本地视频或封面不可用' as string }
  return { blocked: null, pack, view, binding, videoPath: video.path as string, coverPath: cover.path as string }
}

async function firePlan(space: string, plan: PublishPlan, studio: any, dryRun: boolean, bindingOverride?: any, headless = true): Promise<AutoFireRecord> {
  const prep = await prepareAuto(space, plan, studio, bindingOverride)
  if (prep.blocked) {
    setPlanAuto(space, plan.id, { state: 'failed', at: Date.now(), error: prep.blocked })
    return { planId: plan.id, title: plan.title, state: 'failed', error: prep.blocked }
  }
  const pack = (prep as any).pack
  const binding = (prep as any).binding
  try {
    const prepared = await studio.action(space, 'ui', {
      action: 'task.prepare',
      packId: pack.id,
      packRevision: pack.revision,
      bindingId: binding.id,
      platform: binding.platform,
      title: cleanPlatformTitle(pack.title, binding.platform),
      body: binding.platform === 'douyin'
        ? ensureTitleHead(cleanPlatformTitle(pack.title, binding.platform), cleanPlatformCopy(pack.body, binding.platform))
        : cleanPlatformCopy(pack.body, binding.platform),
      topics: cleanPlatformTopics(pack.topics),
      stageVideoPath: (prep as any).videoPath,
      stageCoverPath: (prep as any).coverPath,
    })
    const task = prepared && prepared.item
    if (!task || !task.id) throw new Error('准备确认草稿失败')
    if (task.state !== 'unconfirmed') {
      const reason = `task 已处于 ${task.state}，不重复发送`
      setPlanAuto(space, plan.id, { state: 'unknown', taskId: task.id, at: Date.now(), error: reason })
      return { planId: plan.id, title: plan.title, state: 'unknown', taskId: task.id, error: reason }
    }
    setPlanAuto(space, plan.id, { state: 'running', taskId: task.id, at: Date.now() })
    if (!studio.autoSend) throw new Error('发布插件没有提供自动发送入口（版本不匹配）')
    const result = await studio.autoSend(space, { id: task.id, headless })
    const finalTask = (result && result.item) || {}
    const finalState = String(finalTask.state || (result && (result.blocked || result.success === false) ? 'failed' : 'unknown'))
    const verified = (finalTask as any)?.receipt?.verified
    const isAccepted = finalState === 'accepted' || !!(verified && verified.ok)
    const mapped = isAccepted
      ? 'done'
      : (result?.blocked || result?.success === false || finalState === 'failed' || finalState === 'unconfirmed')
        ? 'failed'
        : 'unknown'
    // 明确失败或成功时直接给中文原因，别再用「未核验」糊过去
    const error = isAccepted
      ? (verified && verified.ok
        ? `平台后台已核实到作品${verified.works ? `（作品共 ${verified.works} 条）` : ''}，审核中`
        : String((finalTask as any)?.receipt?.message || '平台发布已完成'))
      : mapped === 'failed'
        ? String(finalTask?.receipt?.error || result?.error || '发布失败，请查看任务日志')
        : '执行器已返回，平台是否真的发出未核验，请到平台看一眼'
    setPlanAuto(space, plan.id, { state: mapped as any, taskId: task.id, at: Date.now(), error })
    // 平台已确认发出去的，排期直接标已发（绿色），不用人工再点
    if (isAccepted) markPlanPublished(space, plan.id)
    return { planId: plan.id, title: plan.title, state: mapped, taskId: task.id, error }
  } catch (e: any) {
    const message = String(e?.message || e || '自动发送失败')
    setPlanAuto(space, plan.id, { state: 'failed', at: Date.now(), error: message })
    return { planId: plan.id, title: plan.title, state: 'failed', error: message }
  }
}

/** 定时器每分钟跑一次：扫所有公司的日历，把到点且用户勾了自动发的排期发出去。
 * 规则：错过 1 小时不补发；结果未知不重试；执行失败的排期留原因给人看。 */
export async function autoPublishTick(opts: { spaceId?: string; now?: number; dryRun?: boolean } = {}): Promise<AutoSendReport> {
  const report: AutoSendReport = { enabled: autoPublishEnabled(), checkedAt: Date.now(), scanned: 0, fired: [], skipped: [] }
  if (!report.enabled) return report
  const studio = getPublishStudio()
  if (!studio || !studio.autoSend) return report
  const now = opts.now ?? Date.now()
  const store = loadSpaceStore()
  const spaces = opts.spaceId ? store.spaces.filter(s => s.id === opts.spaceId) : store.spaces
  for (const space of spaces) {
    let plans: PublishPlan[]
    try { plans = loadPublishCalendar(space.id) } catch { continue }
    for (const plan of plans) {
      report.scanned++
      if (!plan.autoSend) continue
      if (plan.status === 'published') continue
      const auto = plan.auto
      if (auto?.state === 'running' && now - Number(auto.at || 0) < STALE_RUNNING_MS) {
        report.skipped.push({ planId: plan.id, title: plan.title, reason: '正在执行' }); continue
      }
      if (auto?.state === 'running') {
        setPlanAuto(space.id, plan.id, { ...auto, state: 'unknown', at: Date.now(), error: '执行超时没有回执，结果未知；请到平台核对，系统不会重试' })
        report.skipped.push({ planId: plan.id, title: plan.title, reason: '执行超时，转人工核对' }); continue
      }
      if (auto?.state === 'done' || auto?.state === 'unknown') {
        report.skipped.push({ planId: plan.id, title: plan.title, reason: '已执行过，不重复发送' }); continue
      }
      const due = planDueAt(plan)
      if (!Number.isFinite(due)) {
        setPlanAuto(space.id, plan.id, { state: 'failed', at: Date.now(), error: '排期时间无效' })
        report.skipped.push({ planId: plan.id, title: plan.title, reason: '时间无效' }); continue
      }
      if (now < due) continue
      if (now > due + GRACE_MS) {
        setPlanAuto(space.id, plan.id, { state: 'failed', at: Date.now(), error: '错过发送窗口（超过 1 小时），没有自动补发，请手动处理' })
        report.skipped.push({ planId: plan.id, title: plan.title, reason: '错过窗口，未补发' }); continue
      }
      if (opts.dryRun) {
        report.fired.push({ planId: plan.id, title: plan.title, state: 'dry-run' })
        continue
      }
      const record = await firePlan(space.id, plan, studio, false)
      report.fired.push(record)
    }
  }
  return report
}

/** 给界面看的：今天是哪几条会自动发、各自卡在哪。 */
export function autoPublishOverview(spaceId: string) {
  const plans = loadPublishCalendar(spaceId)
  const now = Date.now()
  return {
    enabled: autoPublishEnabled(),
    studioReady: !!getPublishStudio()?.autoSend,
    plans: plans.filter(p => p.autoSend).map(p => {
      const due = planDueAt(p)
      return {
        id: p.id, title: p.title, scheduledAt: p.scheduledAt, platform: p.platform,
        status: p.status, autoSend: true, auto: p.auto || { state: 'idle' },
        dueInMs: Number.isFinite(due) ? due - now : null,
        overdue: Number.isFinite(due) ? now > due : false,
        missedWindow: Number.isFinite(due) ? now > due + GRACE_MS : false,
      }
    }),
  }
}

/** 按排期平台挑出对应版本的文案与话题；没有分平台版本时回退默认文案。 */
function copyForPlanPlatform(copy: any, platform: string) {
  const norm = normalizePlatform(platform)
  const key = norm === 'tencent' ? 'shipinhao' : norm
  const plat = copy?.platforms && typeof copy.platforms === 'object' ? copy.platforms[key] : null
  const title = String(plat?.title || copy?.title || '').trim()
  const body = String(plat?.body || copy?.body || '').trim()
  const tags = Array.isArray(plat?.tags)
    ? plat.tags.map((t: unknown) => String(t || '').trim().replace(/^#+/, '')).filter(Boolean)
    : []
  const topics = tags.length ? tags.map((t: string) => `#${t}`).join(' ') : ''
  return { title, body, topics }
}

/**
 * 没有发布包（或旧发布包缺封面/缺正文）时，用这条排期关联成片的文案 + 封面现场组/补齐。
 * 封面优先级：成稿页 coverUrl → 本地取帧封面 cover-file → 成片 coverUrl → 视频自动抽帧 thumb → 图片成片自身。
 */
async function ensurePackFromWork(space: string, plan: PublishPlan, existing?: PublishPack): Promise<PublishPack> {
  const work = loadStudioHistory(space).find(x => x.id === plan.historyId)
  const copy: any = (work as any)?.copy
  const { title: copyTitle, body: copyBody, topics: copyTopics } = copyForPlanPlatform(copy, plan.platform)

  let coverRef = ''
  const tryRef = (candidate: unknown) => {
    const s = String(candidate || '').trim()
    if (!s) return ''
    return resolveCoverRef(space, s) ? s : ''
  }
  coverRef = tryRef(copy?.coverUrl)
  if (!coverRef && work?.id && existsSync(exportCoverFramePath(space, work.id))) {
    coverRef = tryRef(`/digital-human-studio/works/cover-file?space=${encodeURIComponent(space)}&id=${encodeURIComponent(work.id)}`)
  }
  if (!coverRef) coverRef = tryRef(work?.coverUrl)
  if (!coverRef && work && work.kind === 'xdh-export-video') {
    const thumb = await ensureExportThumb(space, work.id).catch(() => null)
    if (thumb) {
      coverRef = tryRef(`/digital-human-studio/works/thumb?space=${encodeURIComponent(space)}&id=${encodeURIComponent(work.id)}`)
    }
  }
  if (!coverRef && work && ['ximg', 'xdh-image'].includes(work.kind)) {
    coverRef = tryRef(`history:${work.id}`)
  }

  if (existing) {
    const view = packView(space, existing)
    const needCover = !view.coverUrl && !!coverRef
    const needBody = !existing.body.trim() && !!(copyBody || plan.notes || plan.title)
    const needTopics = !existing.topics.trim() && !!copyTopics
    if (!needCover && !needBody && !needTopics) return existing
    return savePack(space, {
      id: existing.id,
      planId: plan.id,
      title: existing.title || copyTitle || plan.title,
      body: existing.body.trim() ? existing.body : (copyBody || plan.notes || plan.title),
      topics: existing.topics.trim() ? existing.topics : copyTopics,
      coverRef: view.coverUrl ? existing.coverRef : coverRef,
      revision: existing.revision,
    })
  }

  return savePack(space, {
    planId: plan.id,
    title: copyTitle || plan.title,
    body: copyBody || plan.notes || plan.title,
    topics: copyTopics,
    coverRef,
    revision: 0,
  })
}

export type PublishNowResult = { bindingId: string; accountLabel: string; state: string; taskId?: string; error?: string }

/** 最近一次「现在发」的结果：给界面看「到底发没发出去、卡在哪」。进程内即可，重启后由任务列表兜底。 */
const lastNow = new Map<string, { at: number; results: PublishNowResult[] }>()
export function lastPublishNow(space: string) { return lastNow.get(space) || null }

/** 现在发：用户选定账号后立即发送。复用定时自动发同一条安全链路（发布包检查、账号登录态、执行器、不重复发送）。 */
export async function publishPlanNow(space: string, planId: string, bindingIds: string[], opts: { headless?: boolean; background?: boolean } = {}): Promise<PublishNowResult[]> {
  const plan = loadPublishCalendar(space).find(p => p.id === planId)
  if (!plan) throw new Error('排期不存在或已被删除')
  const studio = getPublishStudio()
  if (!studio || !studio.autoSend) throw new Error('发布插件未就绪，暂时不能发送')
  if (!Array.isArray(bindingIds) || bindingIds.length === 0) throw new Error('请先勾选要发的账号')
  const listed = await studio.action(space, 'ui', { action: 'accounts.list' })
  const bindings: any[] = (listed && listed.items) || []
  const firstBinding = bindingIds.map(id => bindings.find(b => b && b.id === id)).find(Boolean)
  const effectivePlan = firstBinding?.platform ? { ...plan, platform: String(firstBinding.platform) } : plan
  let pack = loadPacks(space).find(p => p.planId === plan.id)
  pack = await ensurePackFromWork(space, effectivePlan, pack)
  if (!packView(space, pack).checked) {
    try { pack = checkPack(space, pack.id, pack.revision) } catch (e: any) {
      const reason = String(e?.message || '发布包未通过检查')
      const failed = bindingIds.map(bindingId => ({ bindingId, accountLabel: '', state: 'failed', error: reason }))
      lastNow.set(space, { at: Date.now(), results: failed })
      return failed
    }
  }
  const headless = opts.headless !== false
  const runOne = async (bindingId: string): Promise<PublishNowResult> => {
    const binding = bindings.find(b => b && b.id === bindingId)
    const accountLabel = binding ? String(binding.name || binding.label || binding.platform || bindingId) : bindingId
    if (!binding) return { bindingId, accountLabel, state: 'failed', error: '账号绑定不存在，请到「平台账号」重新添加' }
    const record = await firePlan(space, plan, studio, false, binding, headless)
    return { bindingId, accountLabel, state: record.state, taskId: record.taskId, error: record.error }
  }
  if (opts.background) {
    // 后台顺序发送，前端轮询任务进度；不要让 HTTP 请求一直挂在执行上。
    void (async () => {
      const done: PublishNowResult[] = []
      for (const id of bindingIds) {
        try { done.push(await runOne(id)) }
        catch (e: any) { done.push({ bindingId: id, accountLabel: '', state: 'failed', error: String(e?.message || e || '发送失败') }) }
      }
      lastNow.set(space, { at: Date.now(), results: done })
    })().catch(() => {})
    return bindingIds.map(bindingId => ({ bindingId, accountLabel: '', state: 'started' }))
  }
  const results: PublishNowResult[] = []
  for (const bindingId of bindingIds) results.push(await runOne(bindingId))
  return results
}

/** 抖音前台只显示描述：开头补上标题，保证客户看得到。 */
function ensureTitleHead(title: string, body: string): string {
  const t = String(title || '').trim()
  // 抖音把「空行分段」渲染成行首 *，这里统一压成单换行，标题单独一行
  const flat = String(body || '').replace(/\n{2,}/g, '\n').trim()
  if (!t) return flat
  return flat.startsWith(t) ? flat : `${t}\n${flat}`
}
