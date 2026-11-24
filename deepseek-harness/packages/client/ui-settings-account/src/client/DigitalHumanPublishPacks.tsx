import { useEffect, useMemo, useRef, useState } from 'react'
import css from './DigitalHumanPublishPacks.module.css'
import { DigitalHumanDeskModal } from './DigitalHumanDeskModal.tsx'

/**
 * 发布包只负责「这条排期发什么」：时间、平台、关联成片都以日历排期为准。
 * 数据流是单向的：日历排期 → 发布包 → 复制/导出文案，人工发到平台。
 */
type Pack = {
  id: string
  planId: string
  title: string
  body: string
  topics: string
  coverRef: string
  revision: number
  checked: boolean
  mediaUrl: string
  coverUrl: string
  missingVideo: boolean
  missingCover: boolean
  missingPlan: boolean
  planTitle: string
  planPlatform: string
  planScheduledAt: string
  planStatus: string
  planHistoryId: string
  videoDownload: boolean
  coverDownload: boolean
}
type Plan = { id: string; title: string; scheduledAt: string; platform: string; status: string; historyId: string }
type Cover = { id: string; title: string }
type Payload = { success: boolean; error?: string; spaceId: string; items: Pack[]; plans: Plan[]; covers: Cover[] }

export type Draft = { id: string; planId: string; title: string; body: string; topics: string; coverRef: string; revision: number }

export const planStatusLabel = (status: string): string => (status === 'published' ? '已发' : '待发')

export const planTimeLabel = (value: string): string => (value ? value.slice(0, 16).replace('T', ' ') : '未设时间')

export const publishPacksPrimaryLabel = (planCount: number): string => (planCount === 0 ? '先去日历排一条' : '写文案')

export const publishPacksEmptyMessage = (planCount: number, packCount: number): string => {
  if (packCount > 0) return '没有符合条件的发布包。'
  if (planCount === 0) return '这家还没有排期。先去日历挑一天，把成片拖上去。'
  return '还没有发布包。点上面「写文案」，挑一条排期。'
}

/** 新建草稿：标题沿用排期标题，其余留空。 */
export const blankPack = (plan: Plan): Draft => ({
  id: '',
  planId: plan.id,
  title: plan.title || '',
  body: '',
  topics: '',
  coverRef: '',
  revision: 0,
})

/** 同一条排期只对应一个发布包：已存在就复用，不重复建。 */
export const pickPackForPlan = (items: Pack[], plan: Plan): Draft => {
  const existing = items.find(item => item.planId === plan.id)
  if (existing) return { ...existing }
  return blankPack(plan)
}

export const publishPacksListMeta = (pack: { planPlatform?: string; checked?: boolean; planScheduledAt?: string }): string =>
  `${pack.planPlatform || '平台未填'} · ${planTimeLabel(pack.planScheduledAt || '')} · ${pack.checked ? '已检查' : '草稿'}`

type Props = {
  spaceId: string
  companyName?: string
  initialHistoryId?: string
  onMaterials: () => void
  onCalendar: () => void
  onAccounts: () => void
  onCreate: () => void
  primaryClassName?: string
  ghostClassName?: string
  emptyClassName?: string
}

export function DigitalHumanPublishPacks({
  spaceId,
  initialHistoryId = '',
  onMaterials,
  onCalendar,
  onAccounts,
  onCreate,
  primaryClassName = '',
  ghostClassName = '',
  emptyClassName = '',
}: Props) {
  const [data, setData] = useState<Payload | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'published'>('all')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  const writing = useRef(false)

  useEffect(() => {
    live.current = true
    setEditing(null)
    setDirty(false)
    setPickerOpen(!!initialHistoryId)
    setError('')
    setNotice('')
    const controller = new AbortController()
    void fetch(`/digital-human-studio/publish-packs?space=${encodeURIComponent(spaceId)}`, { signal: controller.signal })
      .then(async response => {
        const next = await response.json() as Payload
        if (!response.ok || !next.success) throw new Error(next.error || '读取发布包失败')
        return next
      })
      .then(next => {
        if (!live.current) return
        setData(next)
      })
      .catch(reason => {
        if (live.current && !controller.signal.aborted) setError(reason.message || '读取失败')
      })
    return () => {
      live.current = false
      controller.abort()
    }
  }, [spaceId, initialHistoryId])

  const mutate = async (action: string, item: Draft) => {
    if (writing.current) return
    writing.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/digital-human-studio/publish-packs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          space: spaceId,
          action,
          id: item.id,
          revision: item.id ? item.revision : 0,
          item: {
            id: item.id,
            planId: item.planId,
            title: item.title,
            body: item.body,
            topics: item.topics,
            coverRef: item.coverRef,
          },
        }),
      })
      const next = await response.json() as Payload
      if (!response.ok || !next.success) throw new Error(next.error || '发布包操作失败')
      if (live.current) {
        setData(next)
        setEditing(action === 'delete' ? null : next.items.find(row => row.planId === item.planId) || null)
        setDirty(false)
        setNotice(
          action === 'check'
            ? '已记录人工检查；文案或资源修改后需重新检查。'
            : action === 'delete'
              ? '发布包已删除，成片和日历排期都还在。'
              : '发布包已保存。',
        )
      }
    } catch (reason) {
      if (live.current) setError(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      writing.current = false
      if (live.current) setBusy(false)
    }
  }

  const abandon = () => !dirty || window.confirm('有未保存修改，确定放弃这些修改？')
  const edit = (patch: Partial<Draft>) => {
    if (editing) {
      setEditing({ ...editing, ...patch })
      setDirty(true)
    }
  }
  const download = (id: string, kind: string) =>
    `/digital-human-studio/publish-packs?space=${encodeURIComponent(spaceId)}&id=${encodeURIComponent(id)}&download=${kind}`
  const copy = async () => {
    if (!editing) return
    try {
      await navigator.clipboard.writeText(`${editing.title}\n\n${editing.body}\n\n${editing.topics}`)
      if (live.current) setNotice('文案已复制；未执行发布。')
    } catch {
      if (live.current) setError('复制失败，请手动选中文案复制，或保存后导出文案文件。')
    }
  }

  const plans = data?.plans || []
  const items = data?.items || []
  const covers = data?.covers || []
  const currentPlan = editing ? plans.find(plan => plan.id === editing.planId) : undefined
  const currentPack = editing?.id ? items.find(item => item.id === editing.id) : undefined

  /** 从成片页进来时，把关联该成片的排期排在最前面。 */
  const sortedPlans = useMemo(() => {
    if (!initialHistoryId) return plans
    return [...plans].sort((a, b) => (b.historyId === initialHistoryId ? 1 : 0) - (a.historyId === initialHistoryId ? 1 : 0))
  }, [plans, initialHistoryId])

  const visibleItems = filter === 'all' ? items : items.filter(item => (item.planStatus === 'published' ? 'published' : 'pending') === filter)

  const choosePlan = (plan: Plan) => {
    if (!data || !abandon()) return
    setEditing(pickPackForPlan(data.items, plan))
    setDirty(false)
    setPickerOpen(false)
  }

  const openPack = (pack: Pack) => {
    if (!abandon()) return
    setEditing({ ...pack })
    setDirty(false)
  }

  return (
    <section className={css.root} aria-label="公司发布包">
      {error ? <p className={css.error} role="alert">{error}</p> : null}
      {notice ? <p className={css.status} role="status">{notice}</p> : null}
      {!data ? (
        <p className={css.status}>正在读取当前公司的发布包…</p>
      ) : editing ? (
        <>
          <button type="button" className={css.back} onClick={() => { if (abandon()) { setEditing(null); setDirty(false) } }}>
            <span aria-hidden>‹</span> 全部发布包
          </button>
          <div className={css.detailHead}>
            <div className={css.detailTitle}>
              <b>{editing.title || currentPlan?.title || '未命名发布包'}</b>
              <small>{currentPlan ? `${currentPlan.platform || '平台未填'} · ${planTimeLabel(currentPlan.scheduledAt)}` : '排期已被删除'}</small>
            </div>
            <span className={css.state} data-tone={currentPlan?.status === 'published' ? 'done' : 'wait'}>
              <i aria-hidden />{planStatusLabel(currentPlan?.status || '')}
            </span>
          </div>
          {!currentPlan ? (
            <p className={css.warn}>这条排期在日历里已经没有了。请回到日历重新挑一条。</p>
          ) : null}
          <div className={css.planNote}>
            <span>平台和时间以日历排期为准</span>
            <button type="button" className={ghostClassName} onClick={() => { if (abandon()) onCalendar() }}>去日历改</button>
          </div>
          <form
            className={css.editor}
            onSubmit={event => {
              event.preventDefault()
              void mutate('save', editing)
            }}
          >
            <label className={css.field}>
              标题
              <input required maxLength={120} disabled={busy} value={editing.title} onChange={event => edit({ title: event.target.value })} />
            </label>
            <label className={css.field}>
              正文
              <textarea rows={7} maxLength={20000} disabled={busy} placeholder="这条视频要说什么" value={editing.body} onChange={event => edit({ body: event.target.value })} />
            </label>
            <label className={css.field}>
              话题
              <input maxLength={2000} disabled={busy} placeholder="#产品介绍 #门店日常" value={editing.topics} onChange={event => edit({ topics: event.target.value })} />
            </label>
            <div className={css.field}>
              <div className={css.fieldHead}>
                <label htmlFor="publish-pack-cover">封面</label>
                <button
                  type="button"
                  className={ghostClassName}
                  disabled={busy}
                  onClick={() => { if (abandon()) onMaterials() }}
                >
                  去素材柜
                </button>
              </div>
              <select id="publish-pack-cover" disabled={busy} value={editing.coverRef} onChange={event => edit({ coverRef: event.target.value })}>
                <option value="">暂不选择</option>
                {editing.coverRef && !covers.some(item => item.id === editing.coverRef) && <option value={editing.coverRef}>原封面已缺失</option>}
                {covers.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </div>
            {editing.id && currentPack ? (
              <>
                {currentPack.mediaUrl ? (
                  <video className={css.previewVideo} controls preload="none" src={currentPack.mediaUrl} onError={() => setError('视频链接已失效或浏览器无法播放，请检查原成片。')} />
                ) : (
                  <p className={css.warn}>这条排期没有关联成片，或成片还没做好。</p>
                )}
                {currentPack.coverUrl ? (
                  <img className={css.previewImage} alt="" src={currentPack.coverUrl} referrerPolicy="no-referrer" onError={() => setError('封面链接已失效，请重新选择封面。')} />
                ) : null}
                <div className={css.resources}>
                  {currentPack.videoDownload ? <a href={download(currentPack.id, 'video')} download>下载视频</a> : currentPack.mediaUrl ? <a href={currentPack.mediaUrl} target="_blank" rel="noopener noreferrer">打开视频</a> : null}
                  {currentPack.coverDownload ? <a href={download(currentPack.id, 'cover')} download>下载封面</a> : currentPack.coverUrl ? <a href={currentPack.coverUrl} target="_blank" rel="noopener noreferrer">打开封面</a> : null}
                  <a href={download(currentPack.id, 'text')} download>导出文案</a>
                </div>
              </>
            ) : null}
            <div className={css.actions}>
              <button type="submit" className={primaryClassName} disabled={busy || !currentPlan}>{busy ? '保存中' : '保存发布包'}</button>
              <button type="button" className={ghostClassName} disabled={busy} onClick={() => void copy()}>复制文案</button>
              <button type="button" className={ghostClassName} disabled={busy || dirty || !editing.id} onClick={() => void mutate('check', editing)}>标记已检查</button>
              <button type="button" className={ghostClassName} disabled={busy || !editing.id} onClick={() => { if (window.confirm(`删除发布包「${editing.title}」？成片和日历排期都保留。`)) void mutate('delete', editing) }}>删除</button>
            </div>
            <p className={css.disclaimer}>保存、复制、下载都不等于已经发到平台。</p>
          </form>
        </>
      ) : (
        <>
          <div className={css.toolbar}>
            <button
              type="button"
              className={primaryClassName}
              disabled={busy}
              onClick={() => {
                if (plans.length === 0) {
                  if (abandon()) onCreate()
                  return
                }
                setPickerOpen(open => !open)
              }}
            >
              {publishPacksPrimaryLabel(plans.length)}
            </button>
            <button
              type="button"
              className={ghostClassName}
              disabled={busy}
              onClick={() => { if (abandon()) onCalendar() }}
            >
              日历
            </button>
            <button
              type="button"
              className={ghostClassName}
              disabled={busy}
              onClick={() => { if (abandon()) onAccounts() }}
            >
              账号
            </button>
          </div>
          {plans.length === 0 ? (
            <p className={css.hint}>发布包跟着日历排期走。先去日历挑一天，把成片拖上去，再回来写文案。</p>
          ) : null}
          {items.length > 0 ? (
            <div className={css.filters} role="group" aria-label="按状态筛选">
              <button type="button" className={css.chip} data-on={filter === 'all' ? 'on' : undefined} onClick={() => setFilter('all')}>
                全部<em>{items.length}</em>
              </button>
              <button type="button" className={css.chip} data-on={filter === 'pending' ? 'on' : undefined} onClick={() => setFilter('pending')}>
                待发<em>{items.filter(item => item.planStatus !== 'published').length}</em>
              </button>
              <button type="button" className={css.chip} data-on={filter === 'published' ? 'on' : undefined} onClick={() => setFilter('published')}>
                已发<em>{items.filter(item => item.planStatus === 'published').length}</em>
              </button>
            </div>
          ) : null}
          {visibleItems.length === 0 ? (
            <div className={emptyClassName}>{publishPacksEmptyMessage(plans.length, items.length)}</div>
          ) : (
            <ul className={css.list}>
              {visibleItems.map(pack => (
                <li key={pack.id}>
                  <button type="button" className={css.row} onClick={() => openPack(pack)}>
                    <span className={css.rowText}>
                      <b>{pack.title || pack.planTitle || '未命名发布包'}</b>
                      <small>{publishPacksListMeta(pack)}</small>
                    </span>
                    <span className={css.state} data-tone={pack.planStatus === 'published' ? 'done' : 'wait'}>
                      <i aria-hidden />{planStatusLabel(pack.planStatus)}
                    </span>
                    <span className={css.chev} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <DigitalHumanDeskModal open={pickerOpen} title="挑一条排期" onClose={() => setPickerOpen(false)}>
        {sortedPlans.length === 0 ? (
          <p className={css.hint}>日历里还没有排期。先去日历把成片拖到某一天。</p>
        ) : (
          <ul className={css.planList}>
            {sortedPlans.map(plan => (
              <li key={plan.id}>
                <button type="button" className={css.planRow} onClick={() => choosePlan(plan)}>
                  <span className={css.rowText}>
                    <b>{plan.title || '未命名排期'}</b>
                    <small>{plan.platform || '平台未填'} · {planTimeLabel(plan.scheduledAt)}{plan.historyId ? '' : ' · 没有关联成片'}</small>
                  </span>
                  <span className={css.state} data-tone={plan.status === 'published' ? 'done' : 'wait'}>
                    <i aria-hidden />{planStatusLabel(plan.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DigitalHumanDeskModal>
    </section>
  )
}
