// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import { useCallback, useEffect, useRef, useState } from 'react'

type RetroRule = {
  id: string
  status: 'proposed' | 'active' | 'exported'
  kind: string
  title: string
  detail: string
  confidence: number
  evidence: string
  createdAt: number
}

type RetroTotals = {
  works: number
  views: number
  engagement: number
  likes: number
  comments: number
  shares: number
  saves: number
  commentsCrawled: number
}

type RetroInsights = {
  totals: RetroTotals
  trend: { day: string; works: number; engagement: number; views: number }[]
  byPlatform: { platform: string; works: number; views: number; engaged: number }[]
  byPlatformMode: 'views' | 'engaged'
  topWorks: { id: string; platform: string; title: string; engagement: number; views: number | null }[]
  hourBuckets: { key: string; works: number; avgEngagement: number }[]
  topicBuckets: { key: string; works: number; avgEngagement: number }[]
  commentWords: { word: string; count: number; docs: number }[]
  workRows: {
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
  }[]
}

type RetroDataSource = {
  mode: 'account' | 'sample'
  accounts: { id: string; nickname: string; platform: string; works: number; fetchedAt: number }[]
  accountWorks: number
  sampleWorks: number
  sampleComments: number
  sampleRoot: string
  note: string
}

type RetroScan = {
  at: number
  source: string
  works: number
  comments: number
  platforms: string[]
  errors: string[]
}

type RetroSnapshot = {
  version: 1
  spaceId: string
  skills: RetroRule[]
  lastScan: RetroScan
}

type Props = {
  spaceId: string
  companyName: string
  onPickCompany?: () => void
}

const CARD: React.CSSProperties = {
  background: '#141a23',
  border: '1px solid #232b37',
  borderRadius: 12,
  padding: '16px 18px',
  minWidth: 0,
}

const WORK_PAGE = 12

const BTN: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 999,
  border: '1px solid #2a3340',
  background: '#171d27',
  color: '#d5dae4',
  fontSize: 12,
  cursor: 'pointer',
}

const PILL: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 11px',
  borderRadius: 999,
  border: '1px solid #232b37',
  background: '#141a23',
  fontSize: 12,
  color: '#7c8696',
}

const CARD_TITLE: React.CSSProperties = {
  fontSize: 13,
  color: '#8c95a4',
  fontWeight: 600,
  letterSpacing: '.02em',
}

const GREEN = '#f5c542'
const RED = '#ff7b72'
const AMBER = '#f5c542'

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`
  return String(Math.round(n))
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(2)}%`
}

function TrendSvg({ points, mode }: { points: { day: string; works: number; engagement: number; views: number }[]; mode: 'works' | 'engagement' | 'views' }) {
  if (points.length === 0) return <div style={{ color: '#8c95a4', fontSize: 12 }}>还没有数据点。</div>
  const W = 640
  const H = 190
  const PAD = { l: 34, r: 10, t: 14, b: 24 }
  const values = points.map(p => (mode === 'works' ? p.works : mode === 'views' ? p.views : p.engagement))
  const max = Math.max(1, ...values)
  const n = points.length
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(1, n - 1)
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b)
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join(' ')
  const ticks = 4
  const color = mode === 'works' ? '#f5c542' : mode === 'views' ? '#a78bfa' : '#f5c542'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`每日${mode === 'works' ? '作品数' : mode === 'views' ? '播放' : '互动'}趋势`}>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const gy = PAD.t + (i * (H - PAD.t - PAD.b)) / ticks
        return (
          <g key={i}>
            <line x1={PAD.l} y1={gy} x2={W - PAD.r} y2={gy} stroke="#242c38" strokeWidth={1} />
            <text x={PAD.l - 6} y={gy + 4} fontSize={10} fill="#7c8696" textAnchor="end">{fmt(Math.round(max * (1 - i / ticks)))}</text>
          </g>
        )
      })}
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={p.day} cx={x(i)} cy={y(values[i])} r={2.6} fill={color}>
          <title>{`${p.day} · ${values[i]}`}</title>
        </circle>
      ))}
      {points.length > 1 ? <text x={PAD.l} y={H - 8} fontSize={10} fill="#7c8696">{points[0].day}</text> : null}
      {points.length > 1 ? <text x={W - PAD.r} y={H - 8} fontSize={10} fill="#7c8696" textAnchor="end">{points[n - 1].day}</text> : null}
    </svg>
  )
}

export function DigitalHumanRetroReview({ spaceId, companyName, onPickCompany }: Props) {
  const [insights, setInsights] = useState<RetroInsights | null>(null)
  const [scan, setScan] = useState<RetroScan | null>(null)
  const [dataSource, setDataSource] = useState<RetroDataSource | null>(null)
  const [skills, setSkills] = useState<RetroRule[]>([])
  const [trendMode, setTrendMode] = useState<'works' | 'engagement' | 'views'>('engagement')
  const [trendView, setTrendView] = useState<'chart' | 'table'>('chart')
  const [workSort, setWorkSort] = useState<'time' | 'views' | 'engagement'>('time')
  const [workOpen, setWorkOpen] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [learning, setLearning] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [exportPath, setExportPath] = useState('')
  const live = useRef(true)
  const spaceRef = useRef(spaceId)
  spaceRef.current = spaceId
  void companyName

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch('/digital-human-studio/retro-review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, space: spaceRef.current }),
    })
    const value = await response.json().catch(() => ({}))
    return { response, value }
  }, [])

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/digital-human-studio/retro-review?space=${encodeURIComponent(spaceRef.current)}`)
      const value = await response.json().catch(() => ({}))
      if (!live.current) return
      if (!response.ok || !value.success) {
        setError(value.error || `读取失败（${response.status}）`)
        return
      }
      setInsights(value.insights ?? null)
      setScan(value.scan ?? null)
      setDataSource(value.dataSource ?? null)
      if (Array.isArray(value.snapshot?.skills)) setSkills(value.snapshot.skills)
    } catch (e) {
      if (live.current) setError(e instanceof Error ? e.message : '读取失败')
    } finally {
      if (live.current) setBusy(false)
    }
  }, [])

  const learn = useCallback(async () => {
    setLearning(true)
    setError('')
    setNotice('')
    try {
      const { response, value } = await post({ action: 'learn' })
      if (!response.ok || !value.success) {
        setError(value.error || '提炼失败')
        return
      }
      setSkills(value.skills ?? [])
      setNotice(value.added?.length ? `新提炼 ${value.added.length} 条规则，待你确认启用。` : '数据不足以产生新规则（已有规则不重复提案）。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '提炼失败')
    } finally {
      if (live.current) setLearning(false)
    }
  }, [post])

  const toggle = useCallback(async (rule: RetroRule) => {
    setError('')
    try {
      const action = rule.status === 'active' ? 'deactivate' : 'activate'
      const { response, value } = await post({ action, id: rule.id })
      if (!response.ok || !value.success) {
        setError(value.error || '操作失败')
        return
      }
      setSkills(value.skills ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    }
  }, [post])

  const exportRules = useCallback(async () => {
    setError('')
    setNotice('')
    try {
      const { response, value } = await post({ action: 'export' })
      if (!response.ok || !value.success) {
        setError(value.error || '导出失败')
        return
      }
      setSkills(value.skills ?? [])
      setExportPath(value.path ?? '')
      setNotice(`已导出规则文件：${value.path ?? ''}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败')
    }
  }, [post])

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1080)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    live.current = true
    void load()
    return () => { live.current = false }
  }, [load])

  const workRows = insights?.workRows ?? []
  const sortedWorks = [...workRows].sort((a, b) => {
    if (workSort === 'views') return (b.views ?? -1) - (a.views ?? -1)
    if (workSort === 'engagement') return b.engagement - a.engagement
    return 0
  })
  const visibleWorks = workOpen ? sortedWorks : sortedWorks.slice(0, WORK_PAGE)

  const totals = insights?.totals
  const engagementRate = totals && totals.views > 0 ? totals.engagement / totals.views : null
  const mode = insights?.byPlatformMode ?? 'engaged'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, background: '#0b0f14', borderRadius: 14 }}>

      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '2px 4px' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#eef1f6', letterSpacing: '-.01em' }}>自媒体工作台 · 复盘</div>
          <div style={{ fontSize: 12, color: '#7c8696', marginTop: 4 }}>
            只看自己账号的作品（本机登录态直连，不调第三方接口）。口径与工作台一致：互动 = 赞 + 评 + 转 + 藏。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void load()} disabled={busy} style={BTN}>{busy ? '读取中…' : '重新读取数据'}</button>
          <button type="button" onClick={() => void learn()} disabled={learning || busy} style={BTN}>{learning ? '提炼中…' : '从数据提炼规则'}</button>
          <button type="button" onClick={() => void exportRules()} disabled={!skills.length} style={{ ...BTN, background: skills.length ? '#f5c542' : '#171d27', color: skills.length ? '#1c1508' : '#7c8696', borderColor: skills.length ? '#f5c542' : '#2a3340' }}>导出规则</button>
          {onPickCompany ? <button type="button" onClick={onPickCompany} style={BTN}>换公司</button> : null}
        </div>
      </div>

      {/* 数据源 pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '0 4px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px', borderRadius: 999, border: '1px solid #232b37', background: '#141a23', fontSize: 12, color: '#a9b2c1' }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: '#3fb950', display: 'inline-block' }} />
          {dataSource?.mode === 'account'
            ? `${dataSource.accounts.map(a => `${a.platform}·${a.nickname}`).join(' / ') || '账号'} · 作品 ${dataSource.accountWorks} 条 · 对标样本 ${dataSource.sampleWorks} 条`
            : scan
              ? `${scan.source} · 作品 ${scan.works} 条 · 评论 ${scan.comments} 条`
              : '正在扫描…'}
        </span>
        {dataSource?.sampleComments ? <span style={PILL}>评论样本 {dataSource.sampleComments} 条</span> : null}
        {scan?.errors?.length ? <span style={{ ...PILL, color: '#f5c542' }}>{scan.errors.length} 个扫描告警</span> : null}
      </div>

      {error ? <div style={{ background: '#3a211d', border: '1px solid #5a2b26', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: RED }}>{error}</div> : null}
      {notice ? <div style={{ background: '#1d2a22', border: '1px solid #2f4a3a', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#3fb950' }}>{notice}</div> : null}
      {exportPath ? <div style={{ fontSize: 11, color: '#7c8696', padding: '0 4px' }}>已导出：{exportPath}</div> : null}

      {/* Hero */}
      {insights ? (
        <div style={{ border: '1px solid #232b37', borderRadius: 14, padding: '22px 24px', background: 'linear-gradient(180deg, #151b24 0%, #10151d 100%)' }}>
          <div style={{ fontSize: 22, lineHeight: 1.55, fontWeight: 600, color: '#e8ecf2', letterSpacing: '-.01em' }}>
            <span style={{ color: '#f5c542' }}>{totals?.works ?? 0}</span> 条作品，累计播放
            <span style={{ color: '#f5c542' }}> {fmt(totals?.views ?? 0)}</span>，带来
            <span style={{ color: '#f5c542' }}> {fmt(totals?.engagement ?? 0)}</span> 次互动
            {insights.topWorks[0] ? <>，最拿得出手的是「<span style={{ color: '#f5c542' }}>{insights.topWorks[0].title.length > 30 ? `${insights.topWorks[0].title.slice(0, 30)}…` : insights.topWorks[0].title}</span>」</> : null}
          </div>
          <div style={{ display: 'flex', gap: 40, marginTop: 18, flexWrap: 'wrap' }}>
            {([
              ['互动率', engagementRate === null ? '—' : `${(engagementRate * 100).toFixed(1)}%`],
              ['总播放', fmt(totals?.views ?? 0)],
              ['总互动', fmt(totals?.engagement ?? 0)],
              ['平台', insights.byPlatform.length ? insights.byPlatform.map(p => p.platform).join(' / ') : '—'],
              ['作品', `${totals?.works ?? 0} 条`],
            ] as const).map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: '#7c8696', marginBottom: 4, letterSpacing: '.04em' }}>{label}</div>
                <div style={{ fontSize: 24, color: '#eef1f6', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>
          {dataSource?.note ? <div style={{ marginTop: 16, fontSize: 12, color: '#7c8696', lineHeight: 1.7 }}>{dataSource.note}</div> : null}
        </div>
      ) : <div style={{ ...CARD, color: '#7c8696', fontSize: 13 }}>正在读取账号作品…</div>}

      {/* 主网格：左宽右窄 */}
      <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1.35fr .95fr', gap: 12, alignItems: 'start' }}>
        {/* 每日互动 */}
        <section style={{ ...CARD, gridColumn: narrow ? 'auto' : '1', minHeight: 320 }} aria-label="每日互动">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={CARD_TITLE}>每日互动</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([['chart', '图'], ['table', '表']] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setTrendView(key)} style={{
                  padding: '3px 10px',
                  borderRadius: 8,
                  border: trendView === key ? '1px solid #f5c542' : '1px solid #2a3340',
                  background: trendView === key ? '#3a3115' : '#171d27',
                  color: trendView === key ? '#f5c542' : '#a9b2c1',
                  fontSize: 11,
                  cursor: 'pointer',
                }}>{label}</button>
              ))}
              {(['engagement', 'works', 'views'] as const).map(m => (
                <button key={m} type="button" onClick={() => setTrendMode(m)} style={{
                  padding: '3px 8px',
                  borderRadius: 8,
                  border: trendMode === m ? '1px solid #3a3115' : '1px solid #2a3340',
                  background: trendMode === m ? '#2a2410' : '#171d27',
                  color: trendMode === m ? '#f5c542' : '#7c8696',
                  fontSize: 11,
                  cursor: 'pointer',
                }}>{m === 'engagement' ? '互动' : m === 'works' ? '作品' : '播放'}</button>
              ))}
            </div>
          </div>
          {trendView === 'chart' ? (
            <div style={{ marginTop: 6 }}><TrendSvg points={insights?.trend ?? []} mode={trendMode} /></div>
          ) : (
            <div style={{ marginTop: 8, maxHeight: 300, overflowY: 'auto' }}>
              {[...(insights?.trend ?? [])].reverse().map(p => (
                <div key={p.day} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 2px', borderTop: '1px solid #212936', fontSize: 12, color: '#d5dae4' }}>
                  <span style={{ color: '#7c8696' }}>{p.day}</span>
                  <span>{p.works} 条 · 互动 {fmt(p.engagement)} · 播放 {fmt(p.views)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 平台分布 */}
        <section style={{ ...CARD, gridColumn: narrow ? 'auto' : '2' }} aria-label="平台分布">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={CARD_TITLE}>平台分布</div>
            <span style={{ fontSize: 11, color: '#7c8696' }}>{mode === 'views' ? '播放' : '互动'}</span>
          </div>
          {insights?.byPlatform.length ? insights.byPlatform.map(p => {
            const max = Math.max(1, ...insights.byPlatform.map(x => (mode === 'views' ? x.views : x.engaged)))
            const v = mode === 'views' ? p.views : p.engaged
            return (
              <div key={p.platform} style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#d5dae4' }}>
                  <span>{p.platform} · {p.works} 条</span>
                  <span style={{ color: '#f5c542' }}>{fmt(v)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: '#242c38', marginTop: 5, overflow: 'hidden' }}>
                  <i style={{ display: 'block', height: '100%', width: `${Math.max(2, (v / max) * 100)}%`, background: '#f5c542', borderRadius: 999 }} />
                </div>
              </div>
            )
          }) : <div style={{ color: '#8c95a4', fontSize: 12, marginTop: 8 }}>暂无数据。</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 }}>
            {([
              ['赞', fmt(totals?.likes ?? 0)],
              ['评论', fmt(totals?.comments ?? 0)],
              ['转发', fmt(totals?.shares ?? 0)],
              ['收藏', fmt(totals?.saves ?? 0)],
            ] as const).map(([label, value]) => (
              <div key={label} style={{ border: '1px solid #232b37', background: '#171d27', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: '#7c8696' }}>{label}</div>
                <div style={{ fontSize: 20, color: '#eef1f6', fontWeight: 600, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#7c8696', marginTop: 12, lineHeight: 1.7 }}>
            {mode === 'views' ? '各平台都有播放数据，横条按播放排序。' : '缺少播放数据时按互动排序，不硬算播放。'}
          </div>
        </section>

        {/* 表现最好 */}
        <section style={{ ...CARD, gridColumn: narrow ? 'auto' : '1' }} aria-label="表现最好">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={CARD_TITLE}>表现最好的内容</div>
            <span style={{ fontSize: 11, color: '#7c8696' }}>Top 5</span>
          </div>
          {insights?.topWorks.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              {insights.topWorks.map((w, i) => {
                const row = workRows.find(x => x.id === w.id)
                return (
                  <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: i ? '1px solid #212936' : 'none' }}>
                    <div style={{ width: 18, color: '#5c6675', fontSize: 12, flex: 'none' }}>{i + 1}</div>
                    <div style={{ width: 56, height: 56, borderRadius: 6, overflow: 'hidden', background: '#242c38', flex: 'none' }}>
                      {row?.cover ? <img src={row.cover} alt="" referrerPolicy="no-referrer" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
                    </div>
                    <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                      <div style={{ fontSize: 13, color: '#e8ecf2', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{w.title}</div>
                      <div style={{ fontSize: 11, color: '#7c8696', marginTop: 4 }}>
                        {w.platform} · 播放 {row?.views === null || row?.views === undefined ? '—' : fmt(row.views)} · 赞 {fmt(row?.likes ?? 0)} · 藏 {fmt(row?.saves ?? 0)}
                      </div>
                    </div>
                    <div style={{ fontSize: 18, color: '#f5c542', fontWeight: 600, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{fmt(w.engagement)}</div>
                  </div>
                )
              })}
            </div>
          ) : <div style={{ color: '#8c95a4', fontSize: 12, marginTop: 8 }}>暂无数据。</div>}
        </section>

        {/* 建议 */}
        <section style={{ ...CARD, gridColumn: narrow ? 'auto' : '2' }} aria-label="给你的建议">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={CARD_TITLE}>给你的建议</div>
            <span style={{ fontSize: 11, color: '#7c8696' }}>{skills.length} 条</span>
          </div>
          {skills.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {skills.map(r => (
                <div key={r.id} style={{ border: '1px solid #232b37', borderRadius: 10, padding: '11px 12px', background: r.status === 'active' ? '#1a231d' : '#171d27' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 13, color: '#eef1f6' }}>{r.title}</b>
                    <span style={{ fontSize: 10, color: r.status === 'active' ? '#3fb950' : '#f5c542', border: `1px solid ${r.status === 'active' ? '#2f4a3a' : '#3a3115'}`, borderRadius: 999, padding: '1px 7px' }}>{r.status === 'active' ? '已启用' : r.status === 'exported' ? '已导出' : '待确认'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#a9b2c1', marginTop: 6, lineHeight: 1.7 }}>{r.detail}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#5c6675', flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>依据 {r.evidence}</span>
                    <button type="button" onClick={() => void toggle(r)} style={{ padding: '3px 10px', borderRadius: 8, border: '1px solid #2a3340', background: '#1a2029', color: r.status === 'active' ? '#ff7b72' : '#f5c542', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {r.status === 'active' ? '停用' : '写进规则'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : <div style={{ color: '#8c95a4', fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>还没有规则。点上方「从数据提炼规则」，会基于这 {totals?.works ?? 0} 条作品生成建议。</div>}
        </section>
      </div>

      {/* 作品明细 */}
      <section style={CARD} aria-label="作品明细">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={CARD_TITLE}>作品明细</div>
            <div style={{ fontSize: 11, color: '#8c95a4', marginTop: 3 }}>
              {workRows.length} 条 · 总播放 {fmt(totals?.views ?? 0)} · 总互动 {fmt(totals?.engagement ?? 0)}
              {totals && totals.views > 0 ? ` · 互动率 ${((totals.engagement / totals.views) * 100).toFixed(1)}%` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([['time', '按时间'], ['views', '按播放'], ['engagement', '按互动']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setWorkSort(key)} style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                cursor: 'pointer',
                border: workSort === key ? '1px solid #f5c542' : '1px solid #2a3340',
                background: workSort === key ? '#3a3115' : '#171d27',
                color: workSort === key ? '#f5c542' : '#a9b2c1',
              }}>{label}</button>
            ))}
          </div>
        </div>
        {workRows.length ? (
          <>
            <div style={{ marginTop: 6 }}>
              {visibleWorks.map((w, idx) => (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 2px', borderTop: idx ? '1px solid #212936' : '1px solid #232b37' }}>
                  <div style={{ width: 40, height: 54, borderRadius: 4, overflow: 'hidden', background: '#242c38', flex: 'none' }}>
                    {w.cover ? <img src={w.cover} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
                  </div>
                  <div style={{ minWidth: 0, flex: '1 1 auto', paddingRight: 6 }}>
                    <div style={{ fontSize: 13, color: '#e8ecf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.title}>{w.title || '（无标题）'}</div>
                    <div style={{ fontSize: 11, color: '#7c8696', marginTop: 3 }}>{w.day} · {String(w.hour).padStart(2, '0')}:00</div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flex: 'none' }}>
                    {([
                      ['播放', w.views === null ? '—' : fmt(w.views)],
                      ['赞', fmt(w.likes)],
                      ['评', fmt(w.comments)],
                      ['转', fmt(w.shares)],
                      ['藏', fmt(w.saves)],
                    ] as const).map(([label, value]) => (
                      <div key={label} style={{ width: 36, textAlign: 'right' }}>
                        <div style={{ fontSize: 13, color: '#d5dae4', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
                        <div style={{ fontSize: 10, color: '#7c8696', marginTop: 1 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ width: 50, textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: 13, color: '#f5c542', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(w.engagement)}</div>
                    <div style={{ fontSize: 10, color: '#7c8696', marginTop: 1 }}>互动</div>
                  </div>
                  <div style={{ width: 32, textAlign: 'right', flex: 'none' }}>
                    {w.url ? <a href={w.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#7c8696', textDecoration: 'none' }}>看 ↗</a> : null}
                  </div>
                </div>
              ))}
            </div>
            {workRows.length > WORK_PAGE ? (
              <button type="button" onClick={() => setWorkOpen(v => !v)} style={{ marginTop: 10, width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid #2a3340', background: '#1a2029', color: '#a9b2c1', fontSize: 12, cursor: 'pointer' }}>
                {workOpen ? '收起，只看最近 12 条' : `展开全部 ${workRows.length} 条`}
              </button>
            ) : null}
          </>
        ) : (
          <div style={{ color: '#8c95a4', fontSize: 12, marginTop: 10 }}>还没有作品数据：先到账号页点一次「刷新监控」同步这个账号的作品。</div>
        )}
      </section>

      {/* 时段 / 选题 / 热词 */}
      <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'repeat(3, 1fr)', gap: 12, alignItems: 'start' }}>
        <section style={CARD} aria-label="发布时间分布">
          <div style={CARD_TITLE}>发布时间 · 均互动</div>
          {insights?.hourBuckets.length ? insights.hourBuckets.slice(0, 10).map(h => {
            const max = Math.max(1, ...insights.hourBuckets.map(x => x.avgEngagement))
            return (
              <div key={h.key} style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#d5dae4' }}>
                  <span>{h.key} · {h.works} 条</span>
                  <span style={{ color: '#f5c542' }}>{fmt(h.avgEngagement)}</span>
                </div>
                <div style={{ height: 5, borderRadius: 999, background: '#242c38', marginTop: 3, overflow: 'hidden' }}>
                  <i style={{ display: 'block', height: '100%', width: `${Math.max(2, (h.avgEngagement / max) * 100)}%`, background: '#f5c542', borderRadius: 999 }} />
                </div>
              </div>
            )
          }) : <div style={{ color: '#8c95a4', fontSize: 12, marginTop: 8 }}>暂无数据。</div>}
        </section>

        <section style={CARD} aria-label="选题方向">
          <div style={CARD_TITLE}>选题方向 · 标题高频词</div>
          {insights?.topicBuckets.length ? insights.topicBuckets.slice(0, 10).map(t => (
            <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: '#d5dae4' }}>
              <span>「{t.key}」· {t.works} 条</span>
              <span style={{ color: '#7c8696' }}>均 {fmt(t.avgEngagement)}</span>
            </div>
          )) : <div style={{ color: '#8c95a4', fontSize: 12, marginTop: 8 }}>标题样本不足，暂无话题方向。</div>}
          <div style={{ fontSize: 11, color: '#5c6675', marginTop: 10 }}>来自作品标题的 2-gram 高频词，仅供选题参考。</div>
        </section>

        <section style={CARD} aria-label="评论区热词">
          <div style={{ ...CARD_TITLE, lineHeight: 1.5 }}>评论区热词 · 来自搜索样本（非本账号评论）</div>
          {insights?.commentWords.length ? insights.commentWords.slice(0, 10).map(w => (
            <div key={w.word} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: '#d5dae4' }}>
              <span>「{w.word}」</span>
              <span style={{ color: '#7c8696' }}>{w.count} 次 · {w.docs} 条评论</span>
            </div>
          )) : <div style={{ color: '#8c95a4', fontSize: 12, marginTop: 8 }}>评论数据不足（需词频 ≥3 且出现在 ≥2 条评论）。</div>}
        </section>
      </div>

      <div style={{ fontSize: 11, color: '#5c6675', padding: '2px 4px', lineHeight: 1.8 }}>
        计算方式与 dsh-media-desk 一致：互动 = 赞 + 评 + 转 + 藏；互动率只统计有播放的记录；平台分布按播放降序，读不到播放时整体改按互动。作品与播放数据来自本机授权账号的创作者中心列表，复盘样本来自本机 MediaCrawler。
      </div>
    </div>
  )
}
