import { useEffect, useRef, useState } from 'react'
import { useRecordRail } from './DigitalHumanRecordRail.tsx'
import { DigitalHumanDeskModal } from './DigitalHumanDeskModal.tsx'
import css from './DigitalHumanCalendarDesk.module.css'
import { confirmCalendarDelete } from './digital-human-calendar-actions.ts'

type AutoInfo = { state: 'idle' | 'running' | 'done' | 'failed' | 'unknown'; taskId?: string; at?: number; error?: string }
type Plan = { id?: string; title: string; scheduledAt: string; platform: string; notes: string; status: 'pending' | 'published'; historyId: string; autoSend?: boolean; auto?: AutoInfo }
type Work = { id: string; title: string; kind: string; at?: number; copyTitle?: string; coverUrl?: string }
const workDisplayTitle = (work?: Work | null) => (work?.copyTitle || work?.title || '').trim()
type Binding = { id: string; platform: string; name: string; enabled: boolean; status: string; hasCredentialFile: boolean }
const PLATFORM_NAME: Record<string, string> = { douyin: '抖音', xiaohongshu: '小红书', tencent: '视频号', kuaishou: '快手', bilibili: 'B站', wechat_official: '公众号' }
const canFireBinding = (b: Binding) => b.enabled && (b.status === 'authorized' || b.status === 'ready') && b.hasCredentialFile
const PLATFORM_ALIAS: Record<string, string> = { 抖音: 'douyin', 小红书: 'xiaohongshu', 视频号: 'tencent', 微信视频号: 'tencent', 快手: 'kuaishou', B站: 'bilibili', 哔哩哔哩: 'bilibili', 公众号: 'wechat_official', 微信公众号: 'wechat_official' }
const planPlatformCode = (plan: Plan | null) => plan ? (PLATFORM_ALIAS[plan.platform] || plan.platform) : ''
const bindingMatchesPlan = (b: Binding, plan: Plan | null) => !plan || b.platform === planPlatformCode(plan)
type PublishTask = { id: string; state: string; title: string; platform: string; accountLabel: string; updatedAt: number; dispatchStartedAt: number; error: string; events: { at: number; code: string }[]; verified?: { ok?: boolean; works?: number; pendingReview?: number; title?: string } | null; summary?: string }
function taskStateInfo(t: PublishTask): { label: string; pct: number; color: string } {
  if (t.state === 'accepted' || (t.verified && t.verified.ok)) return { label: '已发布（审核中）', pct: 100, color: '#267f57' }
  if (t.state === 'failed') return { label: '失败', pct: 100, color: '#b3362b' }
  if (t.state === 'unknown') return { label: '已提交，待平台核对', pct: 100, color: '#267f57' }
  if (t.state === 'cancelled') return { label: '已取消', pct: 100, color: '#9aa0a6' }
  if (t.dispatchStartedAt) return { label: '发布中…', pct: 65, color: '#7a5af5' }
  if (t.state === 'unconfirmed') return { label: '已准备，排队发送', pct: 30, color: '#7a5af5' }
  return { label: t.state || '待处理', pct: 12, color: '#7a5af5' }
}
type Payload = { success?: boolean; error?: string; spaceId: string; items: Plan[]; works: Work[] }

export const todayBJ = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export const blank = (day: string): Plan => ({ title: '', scheduledAt: `${day}T09:00`, platform: '抖音', notes: '', status: 'pending', historyId: '' })

/** 自动发的执行状态，人话给到界面。 */
export function calendarAutoLabel(plan: Plan): string {
  if (!plan.autoSend) return ''
  const auto = plan.auto
  if (!auto || auto.state === 'idle') return '到点自动发'
  if (auto.state === 'running') return '自动发执行中'
  if (auto.state === 'done') return '已自动执行（待核对）'
  if (auto.state === 'unknown') return '结果未知，需核对'
  if (auto.state === 'failed') return `自动发失败：${auto.error || '原因未记录'}`
  return ''
}

export function calendarMonthMeta(month: string): { year: number; monthNumber: number; firstWeekday: number; days: number } {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { year, monthNumber, firstWeekday, days }
}

export function calendarMonthShift(month: string, amount: number): string {
  const { year, monthNumber } = calendarMonthMeta(month)
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function calendarWorkLabel(works: Work[], id: string): string {
  if (!id) return ''
  const work = works.find(row => row.id === id)
  return work ? (workDisplayTitle(work) || '未命名成片') : '成片已不在'
}
/** 日历上显示哪条视频：优先用成片已写好的文案标题，老数据回退素材名。 */
function planDisplayTitle(plan: Plan, works: Work[]): string {
  const work = plan.historyId ? works.find(row => row.id === plan.historyId) : undefined
  const title = (work ? workDisplayTitle(work) : '') || plan.title || '未命名排期'
  return title
}
function planCover(plan: Plan, works: Work[]): string {
  const work = plan.historyId ? works.find(row => row.id === plan.historyId) : undefined
  return work?.coverUrl || ''
}

export function calendarStatusLabel(status: Plan['status']): string {
  return status === 'published' ? '已发' : '待发布'
}

/** 排期三态：待发送（黄）/ 已发送（绿）/ 自动发失败（红） */
export type PlanTone = 'pending' | 'published' | 'failed'
export function calendarPlanTone(plan: Plan): PlanTone {
  if (plan.auto?.state === 'failed') return 'failed'
  return plan.status === 'published' ? 'published' : 'pending'
}
export function calendarPlanLabel(plan: Plan): string {
  const tone = calendarPlanTone(plan)
  return tone === 'published' ? '已发' : tone === 'failed' ? '自动发失败' : '待发送'
}

export function calendarDayHeading(selected: string, count: number): string {
  const monthNumber = Number(selected.slice(5, 7))
  const day = Number(selected.slice(8, 10))
  return `${monthNumber}月${day}日 · ${count} 条`
}

export function calendarOverflowLabel(count: number): string {
  return count > 2 ? `还有 ${count - 2} 条` : ''
}

/** Mounted with key=spaceId: old company requests cannot replace the new company UI. */
export function DigitalHumanCalendar({
  spaceId,
  primaryClassName = '',
  ghostClassName = '',
  emptyClassName = '',
  onOpenWork,
  onGoAccounts,
}: {
  spaceId: string
  companyName?: string
  primaryClassName?: string
  ghostClassName?: string
  emptyClassName?: string
  onOpenWork?: (work: Work) => void
  onGoAccounts?: () => void
}) {
  const [month, setMonth] = useState(() => todayBJ().slice(0, 7))
  const [selected, setSelected] = useState(todayBJ)
  const [items, setItems] = useState<Plan[]>([])
  const [works, setWorks] = useState<Work[]>([])
  const [editing, setEditing] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dragWorkId, setDragWorkId] = useState('')
  const [publishTarget, setPublishTarget] = useState<Plan | null>(null)
  const [bindings, setBindings] = useState<Binding[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishMsg, setPublishMsg] = useState('')
  const [showBrowser, setShowBrowser] = useState(true)
  const [tasks, setTasks] = useState<PublishTask[]>([])
  const [lastSend, setLastSend] = useState<{ at: number; results: { bindingId: string; accountLabel: string; state: string; error?: string }[] } | null>(null)
  const [justFired, setJustFired] = useState(false)
  const [flight, setFlight] = useState<{ x: number; y: number; dx: number; dy: number; go: boolean } | null>(null)
  const [taskPanelOpen, setTaskPanelOpen] = useState(false)
  const taskPanelRef = useRef(false)
  const pollToken = useRef(0)
  const [dropDay, setDropDay] = useState('')
  const live = useRef(true)
  const requestVersion = useRef(0)
  const writeInFlight = useRef(false)
  const apply = (data: Payload) => {
    if (!live.current || data.spaceId !== spaceId) return
    setItems(data.items || [])
    setWorks(data.works || [])
  }
  useEffect(() => {
    live.current = true
    const controller = new AbortController()
    const version = ++requestVersion.current
    void fetch(`/digital-human-studio/publish-calendar?space=${encodeURIComponent(spaceId)}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json() as Payload
        if (!response.ok || data.success === false) throw new Error(data.error || '读取日历失败')
        return data
      })
      .then(data => { if (live.current && version === requestVersion.current) apply(data) })
      .catch(reason => { if (!controller.signal.aborted && live.current) setError(reason.message || '读取日历失败') })
      .finally(() => { if (live.current) setLoading(false) })
    return () => { live.current = false; controller.abort() }
  }, [spaceId])
  const mutate = async (body: Record<string, unknown>) => {
    if (writeInFlight.current || loading) return
    writeInFlight.current = true
    ++requestVersion.current
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/digital-human-studio/publish-calendar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, space: spaceId }) })
      const data = await response.json() as Payload
      if (!response.ok || data.success === false) throw new Error(data.error || '保存排期失败')
      if (live.current) { apply(data); setEditing(null) }
    } catch (reason) {
      if (live.current) setError(reason instanceof Error ? reason.message : '保存排期失败')
    } finally {
      writeInFlight.current = false
      if (live.current) setBusy(false)
    }
  }
  /** 把成片拖到某一天：直接建一条待发排期，标题和关联成片都填好。 */
  const scheduleWork = (day: string, work: Work) => {
    void mutate({ action: 'upsert', item: { ...blank(day), title: work.title || '未命名成片', historyId: work.id } })
  }
  /** 现在发：打开账号勾选弹窗，默认勾上所有可发的账号。 */
  const openPublish = async (plan: Plan) => {
    setPublishTarget(plan)
    setBindings([])
    setPicked([])
    setPublishMsg('')
    setPublishBusy(true)
    try {
      const response = await fetch('/digital-human-studio/publish-now', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'accounts', space: spaceId }) })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error(data.error || '读取账号失败')
      const list: Binding[] = data.items || []
      setBindings(list)
      setPicked(list.filter(b => canFireBinding(b) && bindingMatchesPlan(b, plan)).map(b => b.id))
      if (!list.some(b => canFireBinding(b) && bindingMatchesPlan(b, plan))) setPublishMsg(`没有可用于「${plan.platform}」的已授权账号，请先去添加账号。`)
    } catch (reason) {
      setPublishMsg(reason instanceof Error ? reason.message : '读取账号失败')
    } finally { setPublishBusy(false) }
  }
  const firePublish = async (event?: React.MouseEvent) => {
    if (!publishTarget?.id || picked.length === 0 || publishBusy) return
    const fromX = event?.clientX ?? Math.round(window.innerWidth / 2)
    const fromY = event?.clientY ?? Math.round(window.innerHeight / 2)
    setPublishBusy(true)
    setPublishMsg('')
    try {
      const response = await fetch('/digital-human-studio/publish-now', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'fire', space: spaceId, planId: publishTarget.id, bindingIds: picked, showBrowser }) })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error(data.error || '发送失败')
      if (Array.isArray(data.items)) setItems(data.items)
      if (data.last) setLastSend(data.last)
      setJustFired(true)
      setPublishTarget(null)
      openTaskPanel()
      // 小光点从按钮飞到右上角任务栏
      const toX = Math.max(72, window.innerWidth - 176)
      const toY = 96
      setFlight({ x: fromX, y: fromY, dx: toX - fromX, dy: toY - fromY, go: false })
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setFlight(f => (f ? { ...f, go: true } : f)))
      })
      window.setTimeout(() => setFlight(null), 720)
    } catch (reason) {
      setPublishMsg(reason instanceof Error ? reason.message : '发送失败')
    } finally { setPublishBusy(false) }
  }
  /** 打开发布任务面板并开始轮询进度。 */
  const pollTasks = async () => {
    const token = ++pollToken.current
    let tries = 0
    const tick = async () => {
      tries++
      try {
        const response = await fetch('/digital-human-studio/publish-now', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'tasks', space: spaceId }) })
        const data = await response.json()
        const list: PublishTask[] = data.items || []
        // 后端已把成功的任务同步成「已发」时，日历跟着刷新
        if (data.calendarChanged && Array.isArray(data.calendar)) setItems(data.calendar as Plan[])
        if (data.last) setLastSend(data.last)
        list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        setTasks(list.slice(0, 8))
        const active = list.some(t => t.state !== 'failed' && t.state !== 'unknown' && t.state !== 'cancelled' && Date.now() - (t.updatedAt || 0) < 10 * 60 * 1000)
        if (list.length > 0) setJustFired(false)
        if (token === pollToken.current && taskPanelRef.current && (active || tries < 40)) setTimeout(tick, 3000)
      } catch { if (token === pollToken.current && taskPanelRef.current && tries < 40) setTimeout(tick, 3000) }
    }
    await tick()
  }
  const openTaskPanel = () => { taskPanelRef.current = true; setTaskPanelOpen(true); void pollTasks() }
  const closeTaskPanel = () => { taskPanelRef.current = false; setTaskPanelOpen(false); ++pollToken.current }
  const { year, monthNumber, firstWeekday, days } = calendarMonthMeta(month)
  const shiftMonth = (amount: number) => {
    const next = calendarMonthShift(month, amount)
    setMonth(next)
    setSelected(`${next}-01`)
    setEditing(null)
  }
  const daily = items.filter(plan => plan.scheduledAt.slice(0, 10) === selected)
  const usableBindings = bindings.filter(b => canFireBinding(b) && bindingMatchesPlan(b, publishTarget))
  const activeTaskCount = tasks.filter(t => t.state !== 'failed' && t.state !== 'unknown' && t.state !== 'cancelled').length
  const monthHasPlans = items.some(plan => plan.scheduledAt.startsWith(month))
  useRecordRail({
    title: '这天排期',
    empty: '这一天没有排期',
    stamp: `${selected}:${editing?.id || ''}:${busy}`,
    items: daily.map(plan => ({
      id: plan.id || `${plan.scheduledAt}-${plan.title}`,
      title: planDisplayTitle(plan, works),
      status: calendarPlanLabel(plan),
      statusTone: calendarPlanTone(plan) === 'published' ? 'ok' : calendarPlanTone(plan) === 'failed' ? 'fail' : 'warn',
      thumb: planCover(plan, works)
        ? <img className={css.railThumb} src={planCover(plan, works)} alt={planDisplayTitle(plan, works)} />
        : (
          <span className={css.timeChip} data-state={calendarPlanTone(plan)}>
            <b>{plan.scheduledAt.slice(11, 16)}</b>
            <i>{`周${'日一二三四五六'[new Date(plan.scheduledAt).getDay()]}`}</i>
          </span>
        ),
      meta: `${plan.scheduledAt.slice(11, 16)} · ${plan.platform || '平台未填'}${calendarAutoLabel(plan) ? ` · ${calendarAutoLabel(plan)}` : ''}`,
      selected: !!(editing && editing.id && editing.id === plan.id),
      onClick: () => {
        const linked = plan.historyId ? works.find(work => work.id === plan.historyId) : undefined
        if (linked && onOpenWork) onOpenWork(linked)
        else setEditing({ ...plan, title: planDisplayTitle(plan, works), scheduledAt: plan.scheduledAt.slice(0, 16) })
      },
      actionsAlways: true,
      actions: (
        <>
          <button type="button" className={primaryClassName} disabled={busy || !plan.id} onClick={event => { event.preventDefault(); event.stopPropagation(); void openPublish(plan) }}>现在发</button>
          <button type="button" className={ghostClassName} disabled={busy} onClick={event => { event.preventDefault(); event.stopPropagation(); setEditing({ ...plan, title: planDisplayTitle(plan, works), scheduledAt: plan.scheduledAt.slice(0, 16) }) }}>编辑</button>
          <button type="button" className={ghostClassName} disabled={busy} onClick={event => { event.preventDefault(); event.stopPropagation(); void mutate({ action: 'upsert', item: { ...plan, status: plan.status === 'published' ? 'pending' : 'published' } }) }}>{plan.status === 'published' ? '标未发' : '标已发'}</button>
          <button type="button" className={ghostClassName} style={{ color: '#b3362b' }} disabled={busy} onClick={event => { event.preventDefault(); event.stopPropagation(); confirmCalendarDelete(plan.title, plan.id, message => window.confirm(message), id => { void mutate({ action: 'delete', id }) }) }}>删除</button>
        </>
      ),
    })),
  })
  const monthItems = items.filter(plan => plan.scheduledAt.startsWith(month))
  const publishedCount = monthItems.filter(plan => plan.status === 'published').length
  const pendingCount = monthItems.length - publishedCount
  const monthNameEn = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(Date.UTC(year, monthNumber - 1, 1)))
  const today = todayBJ()
  return (
    <section className={css.root} aria-label="公司日历">
      {error ? <p className={css.error} role="alert">{error}</p> : null}
      <div className={css.body}>
        <aside className={css.tray} aria-label="可排期的成片">
          <div className={css.trayHead}>
            <h2>成片</h2>
            <span>{works.length}</span>
          </div>
          <p className={css.trayHint}>拖到日历上任意一天，直接生成排期</p>
          {works.length === 0 ? (
            <p className={css.trayEmpty}>还没有成片，去「创作」做一条。</p>
          ) : (
            <ul className={css.trayList}>
              {works.map(work => (
                <li key={work.id}>
                  <button
                    type="button"
                    className={css.trayItem}
                    data-dragging={dragWorkId === work.id ? 'on' : undefined}
                    draggable
                    onDragStart={event => {
                      setDragWorkId(work.id)
                      event.dataTransfer.setData('text/plain', work.id)
                      event.dataTransfer.effectAllowed = 'copy'
                    }}
                    onDragEnd={() => { setDragWorkId(''); setDropDay('') }}
                    onClick={() => setEditing({ ...blank(selected), title: workDisplayTitle(work) || '', historyId: work.id })}
                    title={`拖到日历上排期：${workDisplayTitle(work) || work.id}`}
                  >
                    {work.coverUrl ? <img className={css.trayThumb} src={work.coverUrl} alt={workDisplayTitle(work)} /> : <i className={css.trayDot} aria-hidden />}
                    <span className={css.trayName}>{workDisplayTitle(work) || '未命名成片'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div className={css.sheet}>
        <div className={css.head}>
          <div className={css.monthBlock}>
            <span className={css.monthTop}>
              <span className={css.monthNumber}>{String(monthNumber).padStart(2, '0')}</span>
              <span className={css.monthYear}>{year}</span>
            </span>
            <span className={css.monthName}>{monthNameEn}</span>
          </div>
          <div className={css.stats}>
            <div className={css.stat}>
              <span>本月排期</span>
              <b>{monthItems.length}<em>条</em></b>
            </div>
            <div className={css.stat}>
              <span>已发</span>
              <b>{publishedCount}<em>条</em></b>
            </div>
            <div className={css.stat}>
              <span>待发</span>
              <b>{pendingCount}<em>条</em></b>
            </div>
          </div>
          <div className={css.headActions}>
            <button type="button" className={css.navBtn} disabled={busy || (year <= 2000 && monthNumber === 1)} onClick={() => shiftMonth(-1)} aria-label="上月">‹</button>
            <button
              type="button"
              className={css.todayBtn}
              disabled={busy}
              onClick={() => { const day = todayBJ(); setMonth(day.slice(0, 7)); setSelected(day); setEditing(null) }}
            >
              今天
            </button>
            <button type="button" className={css.navBtn} disabled={busy || (year >= 2100 && monthNumber === 12)} onClick={() => shiftMonth(1)} aria-label="下月">›</button>
            <button type="button" className={ghostClassName} onClick={openTaskPanel}>发布任务{activeTaskCount > 0 ? ` ${activeTaskCount}` : ''}</button>
            <button type="button" className={primaryClassName} disabled={busy || loading} onClick={() => setEditing(blank(selected))}>新增排期</button>
          </div>
        </div>
        {loading ? <p className={css.status}>正在读取当前公司日历…</p> : (
          <>
            <div className={css.cal}>
              <div className={css.grid}>
                {['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map(day => <div className={css.weekday} key={day}>{day}</div>)}
                {Array.from({ length: firstWeekday }, (_, index) => <div key={`empty-${index}`} className={css.pad} aria-hidden />)}
                {Array.from({ length: days }, (_, index) => {
                  const day = `${month}-${String(index + 1).padStart(2, '0')}`
                  const plans = items.filter(plan => plan.scheduledAt.slice(0, 10) === day)
                  const isToday = day === today
                  return (
                    <button
                      type="button"
                      key={day}
                      aria-pressed={day === selected}
                      data-today={isToday ? 'on' : undefined}
                      data-drop={dropDay === day ? 'on' : undefined}
                      className={css.day}
                      onClick={() => { setSelected(day); setEditing(null) }}
                      onDragOver={event => {
                        if (!dragWorkId) return
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'copy'
                        if (dropDay !== day) setDropDay(day)
                      }}
                      onDragLeave={() => { if (dropDay === day) setDropDay('') }}
                      onDrop={event => {
                        event.preventDefault()
                        const id = event.dataTransfer.getData('text/plain') || dragWorkId
                        const work = works.find(item => item.id === id)
                        setDropDay('')
                        setDragWorkId('')
                        if (work) scheduleWork(day, work)
                      }}
                      disabled={busy}
                    >
                      <span className={css.dayNum}>{index + 1}</span>
                      {plans.slice(0, 2).map(plan => (
                        <span key={plan.id} className={css.event} data-state={calendarPlanTone(plan)} data-done={plan.status === 'published' ? 'on' : undefined} data-auto={plan.autoSend ? (plan.auto?.state || 'on') : undefined}>
                          <i className={css.dot} aria-hidden />
                          <span className={css.eventText} title={plan.scheduledAt.slice(11, 16) + ' ' + planDisplayTitle(plan, works) + (plan.autoSend ? '（到点自动发）' : '')}>{plan.autoSend ? '自动 · ' : ''}{planDisplayTitle(plan, works)}</span>
                        </span>
                      ))}
                      {calendarOverflowLabel(plans.length) ? <small className={css.overflow}>{calendarOverflowLabel(plans.length)}</small> : null}
                    </button>
                  )
                })}
              </div>
            </div>
            {!monthHasPlans ? <div className={emptyClassName}>这个月还没有排期。选一天，点「新增排期」。</div> : null}
            <p className={css.dayHint}>{calendarDayHeading(selected, daily.length)} · 右侧可改状态或删除 · <span className={css.legendDot} data-state="pending" />待发送 <span className={css.legendDot} data-state="published" />已发送 <span className={css.legendDot} data-state="failed" />失败</p>
          </>
        )}
        </div>
      </div>
      <DigitalHumanDeskModal
        open={!!editing}
        title={editing?.id ? '改排期' : '新建排期'}
        maxWidth={640}
        onClose={() => { if (!busy) setEditing(null) }}
      >
        {editing ? (
          <form className={css.editor} onSubmit={event => { event.preventDefault(); void mutate({ action: 'upsert', item: { ...editing, auto: undefined } }) }}>
            <div className={css.editorGrid}>
              <label className={`${css.field} ${css.fieldWide}`}>
                标题
                <input required maxLength={120} placeholder="例如：瓷砖防滑实测口播" value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} />
              </label>
              <label className={css.field}>
                时间
                <input type="datetime-local" required min="2000-01-01T00:00" max="2100-12-31T23:59" value={editing.scheduledAt.slice(0, 16)} onChange={event => setEditing({ ...editing, scheduledAt: event.target.value })} />
              </label>
              <label className={css.field}>
                平台
                <input list="xdh-publish-platforms" maxLength={60} value={editing.platform} onChange={event => setEditing({ ...editing, platform: event.target.value })} />
                <datalist id="xdh-publish-platforms">{['抖音', '小红书', '视频号', '快手', 'B站', '公众号'].map(item => <option key={item} value={item} />)}</datalist>
              </label>
              <label className={css.field}>
                关联成片
                <select value={editing.historyId} onChange={event => setEditing({ ...editing, historyId: event.target.value })}>
                  <option value="">不关联成片</option>
                  {editing.historyId && !works.some(work => work.id === editing.historyId) && <option value={editing.historyId}>{calendarWorkLabel(works, editing.historyId)}</option>}
                  {works.map(work => <option key={work.id} value={work.id}>{work.title || work.id}</option>)}
                </select>
              </label>
              <label className={css.field}>
                状态
                <select value={editing.status} onChange={event => setEditing({ ...editing, status: event.target.value as Plan['status'] })}>
                  <option value="pending">待发布</option>
                  <option value="published">已发</option>
                </select>
              </label>
              <label className={`${css.field} ${css.fieldWide}`}>
                备注
                <textarea rows={3} maxLength={2000} placeholder="选填" value={editing.notes} onChange={event => setEditing({ ...editing, notes: event.target.value })} />
              </label>
              <label className={`${css.field} ${css.fieldWide}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" checked={!!editing.autoSend} disabled={busy} onChange={event => setEditing({ ...editing, autoSend: event.target.checked })} />
                <span>到点自动发</span>
                <small style={{ opacity: 0.7 }}>电脑和小葱要开着；发布包要先点过「检查」；错过 1 小时不补发</small>
              </label>
              {editing.auto && editing.auto.state !== 'idle' ? (
                <p className={`${css.field} ${css.fieldWide}`} style={{ opacity: 0.85 }}>
                  上次自动执行：{editing.auto.state === 'done' ? '已执行（需到平台核对）' : editing.auto.state === 'running' ? '执行中' : editing.auto.state === 'unknown' ? '结果未知，系统不会重试' : '失败'}
                  {editing.auto.error ? ` · ${editing.auto.error}` : ''}
                </p>
              ) : null}
            </div>
            {error ? <p className={css.error} role="alert">{error}</p> : null}
            <div className={css.actions}>
              <p className={css.disclaimer}>{editing.autoSend ? '勾了自动发：到点小葱会直接发到平台，发完回来点「标已发」核对。' : '没勾自动发：到点不会发，标已发只是记一笔。'}</p>
              <button type="button" className={ghostClassName} disabled={busy} onClick={() => setEditing(null)}>取消</button>
              <button type="submit" className={primaryClassName} disabled={busy || loading}>{busy ? '保存中' : editing.id ? '保存修改' : '添加排期'}</button>
            </div>
          </form>
        ) : null}
      </DigitalHumanDeskModal>
      <DigitalHumanDeskModal
        open={!!publishTarget}
        title={`现在发 · ${publishTarget?.title || ''}`}
        onClose={() => { if (!publishBusy) setPublishTarget(null) }}
        maxWidth={520}
      >
        <p style={{ margin: '0 0 12px', color: 'var(--ink2)', fontSize: 13 }}>勾选要发布的账号，点「开始发」立即发送。发送后请到平台核对是否发出。</p>
        {bindings.length === 0 && !publishBusy ? (
          <p style={{ color: 'var(--ink3)', fontSize: 13 }}>还没有账号，请先到「平台账号」添加并扫码授权。</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bindings.map(binding => {
              const usable = canFireBinding(binding) && bindingMatchesPlan(binding, publishTarget)
              return (
                <li key={binding.id}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: '1px solid var(--line, #ececee)', borderRadius: 10, cursor: usable ? 'pointer' : 'not-allowed', opacity: usable ? 1 : 0.55 }}>
                    <input
                      type="checkbox"
                      disabled={!usable || publishBusy}
                      checked={picked.includes(binding.id)}
                      onChange={event => setPicked(previous => event.target.checked ? [...previous, binding.id] : previous.filter(id => id !== binding.id))}
                    />
                    <span style={{ fontWeight: 600 }}>{PLATFORM_NAME[binding.platform] || binding.platform}</span>
                    <span style={{ color: 'var(--ink2)' }}>{binding.name || binding.id}</span>
                    {!usable ? <em style={{ marginLeft: 'auto', fontSize: 12, color: '#b3362b', fontStyle: 'normal' }}>{!bindingMatchesPlan(binding, publishTarget) ? '与排期平台不一致' : (binding.status && binding.status !== 'authorized' && binding.status !== 'ready') ? '登录态失效，请重新扫码' : '不可用'}</em> : null}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        {publishMsg ? <p role="status" style={{ whiteSpace: 'pre-line', marginTop: 12, fontSize: 13, color: 'var(--ink2)' }}>{publishMsg}</p> : null}
        {usableBindings.length > 0 ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, fontSize: 13, color: 'var(--ink2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showBrowser} disabled={publishBusy} onChange={event => setShowBrowser(event.target.checked)} />
            显示浏览器（发布时能看到自动操作过程）
          </label>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className={ghostClassName} disabled={publishBusy} onClick={() => setPublishTarget(null)}>取消</button>
          {usableBindings.length === 0 ? (
            <button type="button" className={primaryClassName} onClick={() => { setPublishTarget(null); onGoAccounts?.() }}>去增加账号</button>
          ) : (
            <button type="button" className={primaryClassName} disabled={publishBusy || picked.length === 0} onClick={e => void firePublish(e)}>{publishBusy ? '提交中…' : `开始发${picked.length ? `（${picked.length}）` : ''}`}</button>
          )}
        </div>
      </DigitalHumanDeskModal>
      {flight ? (
        <div className={css.flyDot} style={{ left: flight.x, top: flight.y, transform: flight.go ? `translate(${flight.dx}px, ${flight.dy}px) scale(.55)` : 'translate(0px, 0px) scale(1)', opacity: flight.go ? 0.25 : 1 }} />
      ) : null}
      {taskPanelOpen ? (
        <div className={css.taskPanel} style={{ position: 'fixed', top: 76, right: 16, width: 'min(312px, calc(100vw - 32px))', zIndex: 300, background: '#fff', border: '1px solid #ececee', borderRadius: 14, boxShadow: '0 16px 48px rgba(20,20,30,.16)', padding: 12, maxHeight: '70vh', overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <b style={{ fontSize: 14 }}>发布任务</b>
            <span>
              <button type="button" className={ghostClassName} style={{ marginRight: 6 }} onClick={() => void pollTasks()}>刷新</button>
              <button type="button" className={ghostClassName} onClick={closeTaskPanel}>收起</button>
            </span>
          </div>
          {lastSend ? (
            <div style={{ background: '#fafafa', border: '1px solid #f0f0f2', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
              <b style={{ fontSize: 12, color: 'var(--ink2)' }}>最近一次发送</b>
              {lastSend.results.map(r => (
                <div key={r.bindingId} style={{ fontSize: 12, marginTop: 4, color: r.state === 'failed' ? '#b3362b' : '#267f57' }}>
                  {r.accountLabel || '账号'}：{r.state === 'failed' ? '失败' : '已提交，请到平台核对'}{r.error ? `（${r.error}）` : ''}
                </div>
              ))}
            </div>
          ) : null}
          {tasks.filter(t => t.state !== 'cancelled').length === 0 ? (
            <p style={{ color: 'var(--ink3)', fontSize: 13 }}>{justFired ? '已提交，正在准备发送任务…' : '还没有发布任务。'}</p>
          ) : tasks.filter(t => t.state !== 'cancelled').map(task => {
            const info = taskStateInfo(task)
            return (
              <div key={task.id} style={{ padding: '10px 0', borderTop: '1px solid #f2f2f3' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <b style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title || '未命名'}</b>
                  <span style={{ fontSize: 12, color: info.color, flex: 'none' }}>{info.label}</span>
                </div>
                <small style={{ color: 'var(--ink3)', fontSize: 11 }}>{PLATFORM_NAME[task.platform] || task.platform} · {task.accountLabel || '账号'}</small>
                <div style={{ height: 5, borderRadius: 999, background: '#f0f0f2', marginTop: 6, overflow: 'hidden' }}>
                  <i style={{ display: 'block', height: '100%', width: `${info.pct}%`, background: info.color, borderRadius: 999, transition: 'width .4s' }} />
                </div>
                {task.verified && task.verified.ok ? (
                  <small style={{ color: '#267f57', fontSize: 11 }}>平台已核实 · {task.verified.works ? `作品共 ${task.verified.works} 条 · ` : ''}审核中</small>
                ) : null}
                {task.state === 'failed' ? (
                  <div style={{ marginTop: 6, background: '#fdf1ef', border: '1px solid #f6d9d3', borderRadius: 8, padding: '7px 9px' }}>
                    <b style={{ fontSize: 12, color: '#b3362b' }}>没发出去</b>
                    <div style={{ fontSize: 12, color: '#b3362b', lineHeight: 1.5, marginTop: 2 }}>{task.error || '发布失败，请查看任务日志'}</div>
                  </div>
                ) : task.error ? <small style={{ color: '#b3362b', fontSize: 11 }}>{task.error}</small> : null}
              </div>
            )
          })}
        </div>
      ) : (
        <button type="button" className={primaryClassName} style={{ position: 'fixed', right: 16, bottom: 24, zIndex: 300, borderRadius: 999 }} onClick={openTaskPanel}>发布任务</button>
      )}
    </section>
  )
}
