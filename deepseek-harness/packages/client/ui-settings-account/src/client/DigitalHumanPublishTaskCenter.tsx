import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * 「发布」选项卡里的任务中心：正在发 / 已完成 / 有问题三类可筛，
 * 有问题的任务直接显示原因，并支持手动重发。
 */
type Task = {
  id: string
  state: string
  title: string
  platform: string
  accountLabel: string
  updatedAt: number
  createdAt: number
  dispatchStartedAt: number
  error: string
  events: { at: number; code: string }[]
  verified?: { ok?: boolean; works?: number; pendingReview?: number; title?: string } | null
  summary?: string
}
type Payload = { success?: boolean; error?: string; items?: Task[]; last?: { at: number; results: { accountLabel: string; state: string; error?: string }[] } | null }

const PLATFORM_NAME: Record<string, string> = { douyin: '抖音', xiaohongshu: '小红书', wechat_video: '视频号', kuaishou: '快手', bilibili: 'B站' }

export type TaskFilter = 'all' | 'running' | 'done' | 'problem'

/** 一条任务归到哪一类：进行中 / 已完成 / 有问题。 */
export const taskGroup = (t: Task): Exclude<TaskFilter, 'all'> => {
  const state = String(t.state || '')
  if (state === 'failed' || state === 'cancelled') return 'problem'
  if (state === 'unknown' || state === 'accepted') return 'done'
  return 'running'
}

export const taskGroupLabel = (t: Task): { label: string; color: string; pct: number } => {
  const state = String(t.state || '')
  if (state === 'failed') return { label: '没发出去', color: '#b3362b', pct: 100 }
  if (state === 'cancelled') return { label: '已取消', color: '#9aa0a6', pct: 100 }
  if (state === 'accepted') return { label: '已发布（审核中）', color: '#267f57', pct: 100 }
  if (state === 'unknown') return { label: '已提交，待平台核对', color: '#267f57', pct: 100 }
  if (state === 'running') return { label: '正在发…', color: '#7a5af5', pct: 70 }
  if (state === 'queued') return { label: '排队中', color: '#7a5af5', pct: 40 }
  return { label: '已准备，等待发送', color: '#7a5af5', pct: 20 }
}

export const canRetryTask = (t: Task): boolean => ['failed', 'cancelled', 'unknown'].includes(String(t.state || ''))

export const formatTaskTime = (at: number): string => {
  if (!at) return ''
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const filterCounts = (tasks: Task[]): Record<TaskFilter, number> => ({
  all: tasks.length,
  running: tasks.filter(t => taskGroup(t) === 'running').length,
  done: tasks.filter(t => taskGroup(t) === 'done').length,
  problem: tasks.filter(t => taskGroup(t) === 'problem').length,
})

export const emptyMessageFor = (filter: TaskFilter): string => {
  if (filter === 'running') return '现在没有正在发的任务。'
  if (filter === 'done') return '还没有已经发出的任务。'
  if (filter === 'problem') return '没有出问题的任务，很好。'
  return '还没有发布任务。在日历排期里点「现在发」就会出现在这里。'
}

export function DigitalHumanPublishTaskCenter(props: { spaceId: string; onGoAccounts?: () => void; onGoCalendar?: () => void }) {
  const { spaceId, onGoAccounts, onGoCalendar } = props
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [busyId, setBusyId] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  const load = async () => {
    try {
      const res = await fetch('/digital-human-studio/publish-now', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'tasks', space: spaceId }),
      })
      const data: Payload = await res.json()
      if (!alive.current) return
      if (Array.isArray(data.items)) setTasks(data.items)
    } catch {
      /* 静默：下次轮询再试 */
    } finally {
      if (alive.current) setLoading(false)
    }
  }

  useEffect(() => {
    alive.current = true
    void load()
    const timer = window.setInterval(() => { void load() }, 5000)
    return () => { alive.current = false; window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId])

  const retry = async (task: Task) => {
    if (busyId) return
    setBusyId(task.id)
    setNote('')
    try {
      const res = await fetch('/digital-human-studio/publish-now', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'retry', space: spaceId, taskId: task.id }),
      })
      const data: Payload = await res.json()
      if (!res.ok || data.success === false) throw new Error(data.error || '重发失败')
      setNote('已重新提交，正在准备发送…')
      void load()
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : '重发失败')
    } finally {
      setBusyId('')
    }
  }

  const counts = useMemo(() => filterCounts(tasks), [tasks])
  const shown = useMemo(() => tasks.filter(t => filter === 'all' || taskGroup(t) === filter), [tasks, filter])
  const tabs: { id: TaskFilter; label: string }[] = [
    { id: 'all', label: '全部' },
    { id: 'running', label: '进行中' },
    { id: 'done', label: '已完成' },
    { id: 'problem', label: '有问题' },
  ]

  return (
    <section style={{ border: '1px solid var(--line, var(--dsw-alias-border-l2))', borderRadius: 14, background: 'var(--card, var(--dsw-alias-bg-layer-2))', color: 'var(--ink, var(--dsw-alias-label-primary))', padding: 14, marginBottom: 14 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>发布任务</b>
        <div style={{ display: 'flex', gap: 6 }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              style={{
                border: '1px solid ' + (filter === tab.id ? 'var(--purple, var(--dsw-alias-button-primary-fill))' : 'var(--line-strong, var(--dsw-alias-border-l3))'),
                background: filter === tab.id ? 'var(--purple, var(--dsw-alias-button-primary-fill))' : 'var(--card, var(--dsw-alias-bg-layer-2))',
                color: filter === tab.id ? 'var(--purple-fg, var(--dsw-alias-label-primary-foreground))' : 'var(--ink2)',
                borderRadius: 999, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
              }}
            >
              {tab.label}{counts[tab.id] ? ` ${counts[tab.id]}` : ''}
            </button>
          ))}
        </div>
      </header>

      {note ? <p style={{ margin: '10px 0 0', fontSize: 12, color: note.includes('失败') ? 'var(--danger, #b3362b)' : 'var(--success, #267f57)' }}>{note}</p> : null}

      {loading ? <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--ink3)' }}>读取任务中…</p> : null}
      {!loading && shown.length === 0 ? (
        <div style={{ marginTop: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink3)' }}>{emptyMessageFor(filter)}</p>
          {tasks.length === 0 ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {onGoCalendar ? <button type="button" onClick={onGoCalendar} style={{ border: '1px solid var(--line-strong, var(--dsw-alias-border-l3))', background: 'var(--card, var(--dsw-alias-bg-layer-2))', color: 'var(--ink)', borderRadius: 999, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>去日历排期</button> : null}
              {onGoAccounts ? <button type="button" onClick={onGoAccounts} style={{ border: '1px solid var(--line-strong, var(--dsw-alias-border-l3))', background: 'var(--card, var(--dsw-alias-bg-layer-2))', color: 'var(--ink)', borderRadius: 999, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>看授权账号</button> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        {shown.map(task => {
          const info = taskGroupLabel(task)
          return (
            <div key={task.id} style={{ padding: '12px 0', borderTop: '1px solid var(--line, var(--dsw-alias-border-l2))' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <b style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title || '未命名'}</b>
                <span style={{ fontSize: 12, color: info.color, flex: 'none' }}>{info.label}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
                <small style={{ color: 'var(--ink3)', fontSize: 11 }}>
                  {PLATFORM_NAME[task.platform] || task.platform || '平台'} · {task.accountLabel || '账号'} · {formatTaskTime(task.createdAt || task.updatedAt)}
                </small>
                {canRetryTask(task) ? (
                  <button
                    type="button"
                    disabled={!!busyId}
                    onClick={() => void retry(task)}
                    style={{ border: '1px solid var(--line-strong, var(--dsw-alias-border-l3))', background: 'var(--card, var(--dsw-alias-bg-layer-2))', color: 'var(--ink)', borderRadius: 999, padding: '4px 12px', fontSize: 12, cursor: busyId ? 'wait' : 'pointer', flex: 'none' }}
                  >
                    {busyId === task.id ? '重发中…' : '手动重发'}
                  </button>
                ) : null}
              </div>
              <div style={{ height: 4, borderRadius: 999, background: 'var(--tool, var(--dsw-alias-bg-module-platform))', marginTop: 8, overflow: 'hidden' }}>
                <i style={{ display: 'block', height: '100%', width: `${info.pct}%`, background: info.color, borderRadius: 999, transition: 'width .4s' }} />
              </div>
              {task.verified && task.verified.ok ? (
                <div style={{ marginTop: 8, background: 'var(--success-soft, var(--dsw-alias-state-success-tertiary))', border: '1px solid var(--success-line, color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent))', borderRadius: 8, padding: '8px 10px' }}>
                  <b style={{ fontSize: 12, color: 'var(--success, var(--dsw-alias-state-success-primary))' }}>平台已核实</b>
                  <div style={{ fontSize: 12, color: 'var(--success, var(--dsw-alias-state-success-primary))', lineHeight: 1.55, marginTop: 2 }}>
                    后台已出现这条作品{task.verified.works ? ` · 作品共 ${task.verified.works} 条` : ''}{task.verified.pendingReview ? ' · 审核中' : ''}
                  </div>
                </div>
              ) : null}
              {task.error ? (
                <div style={{ marginTop: 8, background: 'var(--danger-soft, var(--dsw-alias-code-diff-deleted))', border: '1px solid var(--danger-line, color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent))', borderRadius: 8, padding: '8px 10px' }}>
                  <b style={{ fontSize: 12, color: 'var(--danger, var(--dsw-alias-state-error-primary))' }}>{task.state === 'failed' ? '没发出去' : '说明'}</b>
                  <div style={{ fontSize: 12, color: 'var(--danger, var(--dsw-alias-state-error-primary))', lineHeight: 1.55, marginTop: 2 }}>{task.error}</div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
