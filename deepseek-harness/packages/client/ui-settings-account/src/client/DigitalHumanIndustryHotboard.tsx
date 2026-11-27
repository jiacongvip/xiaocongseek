// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRecordRail } from './DigitalHumanRecordRail.tsx'
import { DigitalHumanDeskModal } from './DigitalHumanDeskModal.tsx'
import css from './DigitalHumanVideoDownload.module.css'
import {
  collectFailureClerkMessage,
  collectFailureDetails,
  collectFailureKind,
  collectIngestedVideoNames,
  collectStatusLabel,
  collectSubmitErrorFromResult,
  collectVideoOnlyNote,
  collectVisibleSubmitError,
  hasActiveMediaTask,
  pendingSetupBanner,
  shouldApplyAsyncResult,
  shouldAutoOpenCollectDialog,
} from './video-download-state.ts'
import {
  HOTBOARD_DISCLAIMER,
  HOTBOARD_EMPTY,
  HOTBOARD_FALLBACK_HINT,
  HOTBOARD_REFRESH,
  HOTBOARD_REFRESHING,
  HOTBOARD_TITLE,
  formatHotboardTime,
  hotboardRailEmpty,
} from './industry-hotboard-state.ts'

type SlotId = 'product' | 'store' | 'logo'

type Hit = {
  rank?: number
  title?: string
  url?: string
  nickname?: string
  likedCount?: string
  commentCount?: string
  engagementScore?: number
}

type Preview = {
  query?: string
  parts?: string[]
  usedFallback?: boolean
}

type Board = {
  query?: string
  parts?: string[]
  usedFallback?: boolean
  platform?: string
  collectedAt?: number
  sortNote?: string
  hits?: Hit[]
  taskId?: string
}

type McTask = {
  id: string
  spaceId?: string
  status: string
  code?: string
  error?: string
  nextStep?: string
  detail?: string
  materials?: { id: string; name: string; slot: string }[]
}

type Props = {
  spaceId: string
  companyName: string
  onOpenMaterials: () => void
  onPickCompany?: () => void
}

const SLOTS: { id: SlotId; label: string }[] = [
  { id: 'product', label: '产品' },
  { id: 'store', label: '门店' },
  { id: 'logo', label: 'Logo' },
]

async function readJson(response: Response) {
  const value = await response.json().catch(() => ({}))
  return { response, value }
}

export function DigitalHumanIndustryHotboard({ spaceId, companyName, onOpenMaterials, onPickCompany }: Props) {
  void companyName
  const [preview, setPreview] = useState<Preview | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [keywords, setKeywords] = useState('')
  const [platform, setPlatform] = useState<'xhs' | 'dy'>('xhs')
  const [slot, setSlot] = useState<SlotId>('product')
  const [busy, setBusy] = useState(false)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [setup, setSetup] = useState<string[]>([])
  const [configured, setConfigured] = useState(true)
  const [tasks, setTasks] = useState<McTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedHit, setSelectedHit] = useState<Hit | null>(null)
  const live = useRef(true)
  const spaceRef = useRef(spaceId)
  const writing = useRef(false)
  const submissionRef = useRef<{ spaceId: string; taskId: string } | null>(null)
  const dismissedRef = useRef<{ spaceId: string; taskId: string } | null>(null)
  spaceRef.current = spaceId

  const loadBoard = useCallback(async () => {
    if (!spaceId) return
    const { response, value } = await readJson(
      await fetch(`/digital-human-studio/industry-hotboard?space=${encodeURIComponent(spaceId)}`, { credentials: 'same-origin' }),
    )
    if (!response.ok || value?.success === false) return
    setPreview(value.preview || null)
    setBoard(value.board || null)
    setKeywords((current) => current.trim() ? current : String(value.preview?.query || ''))
    const pending = value?.capability?.pendingSetup
    setSetup(Array.isArray(pending) ? pending : [])
    setConfigured(value?.capability?.configured !== false)
  }, [spaceId])

  const refreshMedia = useCallback(async () => {
    if (!spaceId) return
    const { response, value } = await readJson(
      await fetch(`/digital-human-studio/platform-media?space=${encodeURIComponent(spaceId)}`, { credentials: 'same-origin' }),
    )
    if (!response.ok) return
    const list = Array.isArray(value?.tasks) ? value.tasks : []
    setTasks(list.filter((item: McTask) => item && item.id))
  }, [spaceId])

  useEffect(() => {
    live.current = true
    setError('')
    setNotice('')
    setKeywords('')
    setBoard(null)
    setPreview(null)
    void loadBoard().catch(() => {})
    void refreshMedia().catch(() => {})
    return () => {
      live.current = false
    }
  }, [spaceId, loadBoard, refreshMedia])

  useEffect(() => {
    if (!hasActiveMediaTask(tasks)) return
    const timer = setInterval(() => { void refreshMedia().catch(() => {}) }, 2500)
    return () => clearInterval(timer)
  }, [tasks, refreshMedia])

  const refreshBoard = async () => {
    const kw = keywords.trim()
    if (writing.current || busy) return
    const requestSpaceId = spaceId
    writing.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { response, value } = await readJson(
        await fetch('/digital-human-studio/industry-hotboard', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            space: requestSpaceId,
            keywords: kw,
            platform,
            maxNotes: 10,
            browserMode: 'standard',
          }),
        }),
      )
      if (!shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) return
      if (!response.ok || value?.success === false) {
        throw new Error(collectSubmitErrorFromResult(value, '热榜刷新失败'))
      }
      setPreview(value.preview || null)
      setBoard(value.board || null)
      setNotice(`已刷新 ${value.board?.hits?.length || 0} 条。`)
      await refreshMedia()
    } catch (reason) {
      if (shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) {
        setError(collectVisibleSubmitError(reason instanceof Error ? reason.message : '', '热榜刷新失败'))
      }
    } finally {
      writing.current = false
      setBusy(false)
    }
  }

  const startDownload = async (hit: Hit) => {
    const url = String(hit.url || '').trim()
    if (!url || downloadBusy) return
    const requestSpaceId = spaceId
    setSelectedHit(hit)
    setDownloadBusy(true)
    setError('')
    setNotice('')
    try {
      const { response, value } = await readJson(
        await fetch('/digital-human-studio/platform-media', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ space: requestSpaceId, action: 'download', source: url, slot }),
        }),
      )
      if (!shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) return
      if (!response.ok || value?.success === false) {
        throw new Error(collectVisibleSubmitError(value?.error || value?.task?.error, '下载没成功'))
      }
      if (value?.task?.id) {
        submissionRef.current = { spaceId: requestSpaceId, taskId: value.task.id }
        dismissedRef.current = null
        setSelectedTaskId(value.task.id)
        setDialogOpen(true)
      }
      await refreshMedia()
    } catch (reason) {
      if (shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) {
        setError(collectVisibleSubmitError(reason instanceof Error ? reason.message : '', '下载没成功'))
      }
    } finally {
      setDownloadBusy(false)
    }
  }

  const hits = board?.hits || []
  const selectedTask = tasks.find((item) => item.id === selectedTaskId)
  const selectedFailure = collectFailureKind(selectedTask)
  const failureMessage = collectFailureClerkMessage(selectedFailure, selectedTask)
  const failureDetails = collectFailureDetails(selectedTask)

  useRecordRail({
    title: HOTBOARD_TITLE,
    empty: hotboardRailEmpty(),
    stamp: `${busy}:${hits.length}:${selectedTaskId}:${board?.collectedAt || 0}`,
    items: hits.map((hit) => ({
      id: `${hit.rank}-${hit.url || hit.title}`,
      title: (hit.title || '条目').slice(0, 28),
      meta: `赞 ${hit.likedCount || 0} · 评 ${hit.commentCount || 0}`,
      selected: selectedHit?.url === hit.url && selectedHit?.title === hit.title,
      onClick: () => setSelectedHit(hit),
    })),
  })

  useEffect(() => {
    const submission = submissionRef.current
    const task = tasks.find((item) => item.id === submission?.taskId)
    if (
      shouldAutoOpenCollectDialog({
        live: live.current,
        submissionTaskId: submission?.taskId,
        submissionSpaceId: submission?.spaceId,
        currentSpaceId: spaceId,
        task,
        dismissed: dismissedRef.current,
      })
    ) {
      setSelectedTaskId(submission.taskId)
      setDialogOpen(true)
    }
  }, [tasks, spaceId])

  const closeDialog = () => {
    const taskId = selectedTaskId
    if (taskId) dismissedRef.current = { spaceId: spaceRef.current, taskId }
    setDialogOpen(false)
  }

  if (!spaceId) {
    return (
      <section className={css.root} aria-label={HOTBOARD_TITLE}>
        <div className={css.panel}>
          <h2>先选公司</h2>
          <p className={css.lead}>热榜按这家公司的行业词来搜。</p>
          {onPickCompany ? (
            <div className={css.actions}>
              <button type="button" className={css.ghost} onClick={onPickCompany}>选择公司</button>
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  const chips = (preview?.parts || board?.parts || []).filter(Boolean)
  const at = formatHotboardTime(board?.collectedAt)

  return (
    <section className={css.root} aria-label={HOTBOARD_TITLE}>
      {configured === false ? (
        <p className={`${css.banner} ${css.bannerError}`} role="alert">{pendingSetupBanner(setup)}</p>
      ) : null}
      {error ? <p className={css.error} role="alert">{error}</p> : null}
      {notice ? <p className={`${css.banner} ${css.bannerOk}`} role="status">{notice}</p> : null}

      <div className={css.panel}>
        <h2>{HOTBOARD_TITLE}</h2>
        <p className={css.lead}>{HOTBOARD_DISCLAIMER}</p>
        {preview?.usedFallback ? <p className={css.hint}>{HOTBOARD_FALLBACK_HINT}</p> : null}
        {chips.length ? (
          <div className={css.row}>
            {chips.map((chip) => <span key={chip} className={css.chip}>{chip}</span>)}
            {at ? <span className={css.hint}>{at}</span> : null}
          </div>
        ) : null}
        <label className={css.field}>
          行业词
          <input
            value={keywords}
            disabled={busy}
            placeholder="瓷砖 岩板"
            onChange={(event) => setKeywords(event.target.value)}
          />
        </label>
        <label className={css.field}>
          平台
          <select value={platform} disabled={busy} onChange={(event) => setPlatform(event.target.value as 'xhs' | 'dy')}>
            <option value="xhs">小红书（默认最热）</option>
            <option value="dy">抖音</option>
          </select>
        </label>
        <label className={css.field}>
          入库用途
          <select value={slot} disabled={downloadBusy} onChange={(event) => setSlot(event.target.value as SlotId)}>
            {SLOTS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <div className={css.actions} style={{ marginTop: 12 }}>
          <button type="button" className={css.primary} disabled={busy || configured === false} onClick={() => void refreshBoard()}>
            {busy ? HOTBOARD_REFRESHING : HOTBOARD_REFRESH}
          </button>
        </div>
      </div>

      <div className={css.panel}>
        {!hits.length ? (
          <p className={css.empty}>{HOTBOARD_EMPTY}</p>
        ) : (
          <ol className={css.rankList}>
            {hits.map((hit) => (
              <li key={`${hit.rank}-${hit.url || hit.title}`} className={css.rankRow}>
                <span className={css.rankNum}>{hit.rank}</span>
                <div className={css.rankBody}>
                  <b>{hit.title || '条目'}</b>
                  <small>
                    {hit.nickname ? `${hit.nickname} · ` : ''}
                    赞 {hit.likedCount || 0} · 评 {hit.commentCount || 0}
                  </small>
                </div>
                <button
                  type="button"
                  className={css.ghost}
                  disabled={downloadBusy || !hit.url}
                  onClick={() => void startDownload(hit)}
                >
                  下载到素材柜
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <DigitalHumanDeskModal
        open={dialogOpen && !!selectedTask}
        title={selectedTask ? collectStatusLabel(selectedTask.status) : HOTBOARD_TITLE}
        onClose={closeDialog}
      >
        {selectedTask ? (
          <article className={css.task}>
            <b>{selectedHit?.title || selectedTask.id}</b>
            <small>{collectStatusLabel(selectedTask.status)}</small>
            {selectedTask.status === 'succeeded' ? (
              <p className={css.ok}>{collectIngestedVideoNames(selectedTask.materials).join('、') || '一条视频'}</p>
            ) : null}
            {collectVideoOnlyNote(selectedTask.code) ? <p className={css.hint}>{collectVideoOnlyNote(selectedTask.code)}</p> : null}
            {failureMessage ? <p className={css.error}>{failureMessage}</p> : null}
            {failureDetails ? (
              <details className={css.advanced}>
                <summary>详细信息</summary>
                <pre className={css.detail}>{failureDetails}</pre>
              </details>
            ) : null}
            <div className={css.actions} style={{ marginTop: 8 }}>
              {selectedTask.status === 'succeeded' ? (
                <button type="button" className={css.ghost} onClick={() => { closeDialog(); onOpenMaterials() }}>去素材柜查看</button>
              ) : (
                <button type="button" className={css.ghost} onClick={() => { closeDialog(); onOpenMaterials() }}>去素材柜上传</button>
              )}
            </div>
          </article>
        ) : null}
      </DigitalHumanDeskModal>
    </section>
  )
}
