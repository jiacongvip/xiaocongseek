import { useCallback, useEffect, useRef, useState } from 'react'

type Monitor = {
  account: { id: string; platform: string; platformLabel: string; label: string; nickname: string; status: string; enabled: boolean; hasCredential: boolean }
  publish: { total: number; verified: number; failed: number; unknown: number; running: number; cancelled: number }
  recent: { id: string; title: string; state: string; at: number; reason: string }[]
  works: { total: number; totalEngagement: number; latestAt: number; latestTitle: string; top: { title: string; engagement: number; day: string }[]; note: string }
  source: { mcRoot: string; scannedWorks: number; scannedComments: number; accountsFile: string; tasksFile: string; at: number; errors: string[] }
}

const GREEN = 'var(--success, var(--dsw-alias-state-success-primary, #267f57))'
const RED = 'var(--danger, var(--dsw-alias-state-error-primary, #b3362b))'
const AMBER = 'var(--warn, var(--dsw-alias-state-warn-label, #b7791f))'
const BLUE = 'var(--dsw-alias-link, #3d6df2)'

function stateLabel(state: string): { text: string; color: string } {
  if (state === 'accepted') return { text: '已核实', color: GREEN }
  if (state === 'failed') return { text: '没发出', color: RED }
  if (state === 'unknown') return { text: '待核对', color: AMBER }
  if (state === 'cancelled') return { text: '已取消', color: 'var(--ink3, var(--dsw-alias-label-tertiary, #8a8f99))' }
  return { text: '进行中', color: BLUE }
}

function fmtTime(ms: number): string {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`
  return String(Math.round(n))
}

const CARD: React.CSSProperties = { border: '1px solid var(--line, var(--dsw-alias-border-l2))', background: 'var(--card, var(--dsw-alias-bg-layer-2))', borderRadius: 10, padding: '10px 12px', minWidth: 0 }
const CARD_HEAD: React.CSSProperties = { fontSize: 12, color: 'var(--ink3, var(--dsw-alias-label-tertiary))', fontWeight: 600 }

export function DigitalHumanAccountMonitor({ spaceId, bindingId }: { spaceId: string; bindingId: string }) {
  const [data, setData] = useState<Monitor | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(true)

  const load = useCallback(async (sync = false) => {
    setBusy(true)
    setError('')
    try {
      const query = `space=${encodeURIComponent(spaceId)}&account=${encodeURIComponent(bindingId)}${sync ? '&sync=1' : ''}`
      const response = await fetch(`/digital-human-studio/account-monitor?${query}`)
      const value = await response.json().catch(() => ({}))
      if (!live.current) return
      if (!response.ok || !value.success) {
        setError(value.error || `读取失败（${response.status}）`)
        return
      }
      setData(value as Monitor)
    } catch (e) {
      if (live.current) setError(e instanceof Error ? e.message : '读取失败')
    } finally {
      if (live.current) setBusy(false)
    }
  }, [spaceId, bindingId])

  useEffect(() => {
    live.current = true
    void load(true)
    return () => { live.current = false }
  }, [load])

  const publishRate = data && data.publish.total > 0 ? data.publish.verified / data.publish.total : null

  return (
    <section aria-label="账号监控" style={{ borderTop: '1px solid var(--line, var(--dsw-alias-border-l2))', paddingTop: 12, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>监控</b>
          {data ? (
            <small style={{ fontSize: 11, color: 'var(--ink3, var(--dsw-alias-label-tertiary))' }}>
              {data.account.platformLabel} · {data.account.nickname || data.account.label} · 授权{data.account.status === 'authorized' || data.account.status === 'ready' ? '正常' : '待检查'}
            </small>
          ) : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(true)}
          style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--line-strong, var(--dsw-alias-border-l4))', background: 'var(--card, var(--dsw-alias-bg-layer-2))', color: 'var(--ink2, var(--dsw-alias-label-secondary))', fontSize: 12, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1 }}
        >
          {busy ? '同步中…' : '刷新监控'}
        </button>
      </div>

      {error ? <p style={{ background: 'var(--danger-soft, var(--dsw-alias-code-diff-deleted))', border: '1px solid var(--danger-line, color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent))', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: RED, marginTop: 8 }} role="alert">{error}</p> : null}

      {data ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 10 }}>
          <div style={CARD}>
            <div style={CARD_HEAD}>发布核对 · 这个账号</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--ink2, var(--dsw-alias-label-secondary))' }}>
              <span>共 <b>{data.publish.total}</b></span>
              <span style={{ color: GREEN }}>已核实 <b>{data.publish.verified}</b></span>
              <span style={{ color: RED }}>没发出 <b>{data.publish.failed}</b></span>
              {data.publish.unknown ? <span style={{ color: AMBER }}>待核对 <b>{data.publish.unknown}</b></span> : null}
              {data.publish.running ? <span style={{ color: BLUE }}>进行中 <b>{data.publish.running}</b></span> : null}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink3, var(--dsw-alias-label-tertiary))', marginTop: 6 }}>发出率 {publishRate === null ? '—' : `${Math.round(publishRate * 100)}%`}（已核实 / 全部任务）</div>
            {data.recent.length ? (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.recent.slice(0, 3).map((t) => {
                  const s = stateLabel(t.state)
                  return (
                    <div key={t.id} style={{ fontSize: 12, color: 'var(--ink2, var(--dsw-alias-label-secondary))' }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                        <span style={{ color: s.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.text}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                      </div>
                      {t.reason ? <div style={{ fontSize: 11, color: 'var(--ink3, var(--dsw-alias-label-tertiary))', lineHeight: 1.5 }}>{t.reason}</div> : null}
                      <div style={{ fontSize: 11, color: 'var(--ink3, var(--dsw-alias-label-tertiary))' }}>{fmtTime(t.at)}</div>
                    </div>
                  )
                })}
              </div>
            ) : <div style={{ fontSize: 12, color: 'var(--ink3, var(--dsw-alias-label-tertiary))', marginTop: 8 }}>这个账号还没有发布任务。</div>}
          </div>

          <div style={CARD}>
            <div style={CARD_HEAD}>作品与互动 · MediaCrawler</div>
            <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12, color: 'var(--ink2, var(--dsw-alias-label-secondary))', flexWrap: 'wrap' }}>
              <span>作品 <b>{data.works.total}</b> 条</span>
              <span>总互动 <b>{fmtNum(data.works.totalEngagement)}</b></span>
            </div>
            {data.works.latestAt ? <div style={{ fontSize: 11, color: 'var(--ink3, var(--dsw-alias-label-tertiary))', marginTop: 6 }}>最近：{fmtTime(data.works.latestAt)} · {data.works.latestTitle}</div> : null}
            {data.works.top.length ? (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.works.top.map((w) => (
                  <div key={w.title} style={{ fontSize: 12, color: 'var(--ink2, var(--dsw-alias-label-secondary))', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
                    <span style={{ color: GREEN, whiteSpace: 'nowrap' }}>{fmtNum(w.engagement)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ fontSize: 11, color: 'var(--ink3, var(--dsw-alias-label-tertiary))', marginTop: 8, lineHeight: 1.5 }}>{data.works.note}</div>
          </div>
        </div>
      ) : busy ? <p style={{ fontSize: 12, color: 'var(--ink3, var(--dsw-alias-label-tertiary))', marginTop: 8 }}>正在读取账号监控…</p> : null}

      {data ? (
        <div style={{ fontSize: 11, color: 'var(--ink3, var(--dsw-alias-label-tertiary))', marginTop: 8, lineHeight: 1.5 }}>
          数据源：账号 accounts.json；发布任务 tasks.json；作品 {data.source.mcRoot}（{data.source.scannedWorks} 条作品 / {data.source.scannedComments} 条评论）。只读本机数据，不联网。
          {data.source.errors.length ? ` 注意：${data.source.errors[0]}` : ''}
        </div>
      ) : null}
    </section>
  )
}
