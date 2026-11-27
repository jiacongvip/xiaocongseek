// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRecordRail } from './DigitalHumanRecordRail.tsx'
import css from './DigitalHumanVideoDownload.module.css'
import { DigitalHumanDeskModal } from './DigitalHumanDeskModal.tsx'
import {
  partitionMediaTasks,
  hasActiveMediaTask,
  wordcloudResultHref,
  validateCommentImportFile,
  shouldApplyAsyncResult,
  filterTasksForSpace,
  defaultBrowserMode,
  classifyHintText,
  douyinCdpHint,
  pendingSetupBanner,
  collectStatusLabel,
  collectRailTitle,
  collectRailMeta,
  collectRailEmpty,
  downloadSuccessNotice,
  shouldApplyDownloadSuccess,
  nextSourceAfterSuccess,
  collectFailureKind,
  collectFailureClerkMessage,
  collectFailureDetails,
  collectVisibleSubmitError,
  collectRetryRequest,
  collectIngestedVideoNames,
  collectVideoOnlyNote,
  collectDialogTitle,
  shouldAutoOpenCollectDialog,
  COLLECT_KEYWORD_EMPTY,
  type DownloadSubmission,
  type DownloadTab,
} from './video-download-state.ts'

type SlotId = 'product' | 'store' | 'logo'

type Capability = {
  configured?: boolean
  productionDefaultRunner?: string
  mediaDownloadPlatforms?: string[]
  metadataOnlyPlatforms?: string[]
  loginHint?: string
  pendingSetup?: string[]
  mediaCrawlerRoot?: string | null
  configSource?: string
  acceptedLinkForms?: string[]
  knownSetupHints?: string[]
  sessionIsolation?: { note?: string; sharedOfficialOAuth?: boolean }
  keywordSearch?: {
    wiredInPlugin?: boolean
    note?: string
    maxNotesCap?: number
    browserModes?: string[]
    defaultBrowserMode?: string
    cdpPort?: number
  }
  hotBoard?: { availableInMediaCrawlerCli?: boolean; wiredInPlugin?: boolean; note?: string }
  pageMedia?: { adapter?: string }
  cdp?: { ok?: boolean; browser?: string }
}

type McTask = {
  id: string
  spaceId: string
  slot: string
  source: string
  platform?: string
  status: string
  loginPhase?: string
  error?: string
  code?: string
  detail?: string
  nextStep?: string
  note?: string
  loginHint?: string
  mock?: boolean
  materials?: { id: string; name: string; slot: string }[]
  updatedAt?: number
  mode?: string
  keywords?: string
  sourceKind?: string
  collectedAt?: number
  browserMode?: string
  pongSkippedLogin?: boolean
  searchHits?: {
    awemeId?: string
    title?: string
    url?: string
    likedCount?: string
    commentCount?: string
    shareCount?: string
    collectedCount?: string
    sourceKind?: string
  }[]
  searchSampleAnalysis?: {
    kind?: string
    implementation?: string
    reusedMediaCrawlerModule?: boolean
    sampleSize?: number
    totals?: { liked?: number; comment?: number; share?: number; collected?: number }
    topByEngagement?: Array<{
      rank?: number
      title?: string
      url?: string
      likedCount?: string
      commentCount?: string
      engagementScore?: number
    }>
    missingForMcWordcloud?: { reason?: string; wiredInPlugin?: boolean }
  } | null
}

function parseHitCount(v: unknown): number {
  if (v == null || v === '') return 0
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/** UI-local aggregate for keyword_search hits — not MC wordcloud, not a board feed. */
function buildSampleAnalysisFromHits(task: McTask) {
  const hits = task.searchHits || []
  if (!hits.length) return null
  if (task.searchSampleAnalysis?.topByEngagement?.length) return task.searchSampleAnalysis
  const totals = { liked: 0, comment: 0, share: 0, collected: 0 }
  const scored = hits.slice(0, 10).map((h) => {
    const liked = parseHitCount(h.likedCount)
    const comment = parseHitCount(h.commentCount)
    const share = parseHitCount(h.shareCount)
    const collected = parseHitCount(h.collectedCount)
    totals.liked += liked
    totals.comment += comment
    totals.share += share
    totals.collected += collected
    return {
      title: h.title,
      url: h.url,
      likedCount: h.likedCount,
      commentCount: h.commentCount,
      engagementScore: liked + comment + share + collected,
    }
  })
  scored.sort((a, b) => b.engagementScore - a.engagementScore)
  return {
    kind: 'keyword_search_sample_metrics',
    implementation: 'plugin_local_aggregate',
    reusedMediaCrawlerModule: false,
    sampleSize: hits.length,
    totals,
    topByEngagement: scored.slice(0, 5).map((row, i) => ({ rank: i + 1, ...row })),
    missingForMcWordcloud: {
      wiredInPlugin: false,
      reason:
        'MC 评论词云需评论数据与 ENABLE_GET_WORDCLOUD；当前关键词搜索未采评论，故不调用词云。',
    },
  }
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

export function DigitalHumanVideoDownload({ spaceId, companyName, onOpenMaterials, onPickCompany }: Props) {
  void companyName
  const [source, setSource] = useState('')
  const [slot, setSlot] = useState<SlotId>('product')
  const [platformHint, setPlatformHint] = useState('')
  const [classified, setClassified] = useState<{ platform?: string; mediaDownloadSupported?: boolean } | null>(null)
  const [capability, setCapability] = useState<Capability | null>(null)
  const [tasks, setTasks] = useState<McTask[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [keyword, setKeyword] = useState('')
  const [browserMode, setBrowserMode] = useState<'standard' | 'cdp_existing' | 'cdp_launch'>('standard')
  const [searchBusy, setSearchBusy] = useState(false)
  const [wcBusy, setWcBusy] = useState(false)
  const [wcText, setWcText] = useState('')
  const [wcFileName, setWcFileName] = useState('')
  const [wcFixture, setWcFixture] = useState(false)
  const [wcTasks, setWcTasks] = useState<any[]>([])
  const [wcNotice, setWcNotice] = useState('')
  const [wcError, setWcError] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [railMode, setRailMode] = useState<DownloadTab>('download')
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const live = useRef(true)
  const writing = useRef(false)
  const spaceRef = useRef(spaceId)
  const sourceRef = useRef(source)
  const browserModeSeeded = useRef(false)
  const browserModeRef = useRef(browserMode)
  const submissionRef = useRef<DownloadSubmission | null>(null)
  const dismissedRef = useRef<{ spaceId: string; taskId: string } | null>(null)
  const selectedTaskIdRef = useRef('')
  spaceRef.current = spaceId
  selectedTaskIdRef.current = selectedTaskId
  sourceRef.current = source
  browserModeRef.current = browserMode
  const activeMode: DownloadTab = toolsOpen ? railMode : 'download'

  const applyDownloadSuccess = useCallback((task?: McTask | null) => {
    const result = shouldApplyDownloadSuccess({
      submission: submissionRef.current,
      currentSpaceId: spaceRef.current,
      live: live.current,
      task,
    })
    if (!result.notice || !submissionRef.current) return
    const slotId = submissionRef.current.slot
    submissionRef.current.noticed = true
    setNotice(downloadSuccessNotice(slotId))
    const next = nextSourceAfterSuccess(sourceRef.current, result.sourceToClear)
    setSource(next)
    if (next === '') {
      setPlatformHint('')
      setClassified(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!spaceId) return
    const requestSpaceId = spaceId
    const { response, value } = await readJson(
      await fetch(`/digital-human-studio/platform-media?space=${encodeURIComponent(requestSpaceId)}`, { cache: 'no-store' }),
    )
    if (!response.ok || value?.success === false) throw new Error(value?.error || '无法读取下载任务')
    if (!shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) return
    setCapability(value.capability || null)
    const raw = Array.isArray(value.tasks) ? value.tasks : []
    const nextTasks = filterTasksForSpace(raw, requestSpaceId)
    setTasks(nextTasks)
    const submittedId = submissionRef.current?.taskId
    applyDownloadSuccess(nextTasks.find((item) => item.id === submittedId) || null)
    const next = defaultBrowserMode(
      value?.capability?.keywordSearch?.defaultBrowserMode,
      browserModeRef.current,
      browserModeSeeded.current,
    )
    browserModeSeeded.current = next.seeded
    if (next.mode !== browserModeRef.current) setBrowserMode(next.mode)
  }, [spaceId, applyDownloadSuccess])

  useEffect(() => {
    live.current = true
    browserModeSeeded.current = false
    submissionRef.current = null
    dismissedRef.current = null
    setTasks([])
    setWcTasks([])
    setError('')
    setNotice('')
    setPlatformHint('')
    setClassified(null)
    setSelectedTaskId('')
    setDialogOpen(false)
    setWcError('')
    setWcNotice('')
    void refresh().catch((reason) => {
      if (shouldApplyAsyncResult({ requestSpaceId: spaceId, currentSpaceId: spaceRef.current, live: live.current })) {
        setError(collectVisibleSubmitError(reason instanceof Error ? reason.message : '', '读取失败'))
      }
    })
    return () => {
      live.current = false
    }
  }, [spaceId, refresh])

  useEffect(() => {
    const active = hasActiveMediaTask(tasks)
    if (!active) return
    const timer = setInterval(() => {
      void refresh().catch(() => {})
    }, 2500)
    return () => clearInterval(timer)
  }, [tasks, refresh])

  const runKeywordSearch = async () => {
    const kw = keyword.trim()
    if (!kw) {
      setNotice('')
      setError(COLLECT_KEYWORD_EMPTY)
      return
    }
    if (writing.current || searchBusy) return
    const requestSpaceId = spaceId
    writing.current = true
    setSearchBusy(true)
    setError('')
    setNotice('')
    try {
      const { response, value } = await readJson(
        await fetch('/digital-human-studio/platform-media', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            action: 'keyword-search',
            space: requestSpaceId,
            platform: 'dy',
            keywords: kw,
            maxNotes: 10,
            browserMode,
            cdpPort: 9222,
          }),
        }),
      )
      if (!shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) return
      if (!response.ok || value?.success === false) {
        throw new Error(collectVisibleSubmitError(value?.error || value?.task?.error, '关键词搜索失败'))
      }
      const hits = value?.task?.searchHits || []
      setNotice(`选题完成，${hits.length} 条样本。选题不会下载视频。`)
      if (value?.task?.id) setSelectedTaskId(value.task.id)
      setRailMode('search')
      await refresh()
    } catch (reason) {
      if (shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) {
        setError(collectVisibleSubmitError(reason instanceof Error ? reason.message : '', '关键词搜索失败'))
      }
    } finally {
      writing.current = false
      setSearchBusy(false)
    }
  }

  const classify = async (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) {
      setPlatformHint('')
      setClassified(null)
      return
    }
    try {
      const { response, value } = await readJson(
        await fetch('/digital-human-studio/platform-media', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ space: spaceId, action: 'classify', source: trimmed }),
        }),
      )
      if (!response.ok || value?.success === false) {
        setClassified(null)
        setPlatformHint(value?.error || '无法识别链接')
        return
      }
      const parsed = value.parsed
      setClassified(parsed || null)
      setPlatformHint(classifyHintText(parsed))
    } catch (reason) {
      setClassified(null)
      setPlatformHint(reason instanceof Error ? reason.message : '识别失败')
    }
  }

  const startDownload = async (override?: { source?: string; slot?: string }) => {
    if (writing.current || busy) return
    const url = String(override?.source ?? source).trim()
    const useSlot = (override?.slot || slot) as SlotId
    if (!url) {
      setNotice('')
      setError('请粘贴平台帖子/视频链接')
      return
    }
    const requestSpaceId = spaceId
    writing.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { response, value } = await readJson(
        await fetch('/digital-human-studio/platform-media', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ space: requestSpaceId, action: 'download', source: url, slot: useSlot }),
        }),
      )
      if (!shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) return
      if (value?.task) {
        setTasks((prev) => {
          const rest = prev.filter((t) => t.id !== value.task.id)
          return [value.task, ...rest]
        })
        submissionRef.current = {
          spaceId: requestSpaceId,
          taskId: value.task.id,
          source: url,
          slot: useSlot,
          noticed: false,
        }
        setSelectedTaskId(value.task.id)
        setRailMode('download')
      }
      if (value?.capability) setCapability(value.capability)
      if (!response.ok || value?.success === false) {
        const task = value?.task
        if (task) setError('')
        else setError(collectVisibleSubmitError(value?.error, '下载未成功'))
        return
      }
      if (value?.task?.mock) {
        setError('服务返回了模拟结果，未计为真实平台成功')
        return
      }
      applyDownloadSuccess(value.task)
    } catch (reason) {
      if (shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) {
        setError(collectVisibleSubmitError(reason instanceof Error ? reason.message : '', '请求失败'))
      }
    } finally {
      writing.current = false
      setBusy(false)
      if (shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) {
        void refresh().catch(() => {})
      }
    }
  }

  const cancelTask = async (id: string) => {
    if (writing.current) return
    const requestSpaceId = spaceId
    writing.current = true
    setBusy(true)
    setError('')
    try {
      const { response, value } = await readJson(
        await fetch('/digital-human-studio/platform-media', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ space: requestSpaceId, action: 'cancel', id }),
        }),
      )
      if (!shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) return
      if (!response.ok || value?.success === false) throw new Error(value?.error || '取消失败')
      setNotice('已请求取消')
      await refresh()
    } catch (reason) {
      if (shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) {
        setError(collectVisibleSubmitError(reason instanceof Error ? reason.message : '', '取消失败'))
      }
    } finally {
      writing.current = false
      setBusy(false)
    }
  }

  /** Same-origin only — never fall back to local bridge / cross-origin bypass. */
  async function wcFetch(init: RequestInit & { query?: string }) {
    const q = init.query || ''
    return fetch(`/digital-human-studio/comment-wordcloud${q}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) },
      credentials: 'same-origin',
    })
  }

  const refreshWordcloudTasks = useCallback(async () => {
    if (!spaceId) {
      setWcTasks([])
      return
    }
    const requestSpaceId = spaceId
    try {
      const response = await wcFetch({ method: 'GET', query: `?space=${encodeURIComponent(requestSpaceId)}` })
      const { value } = await readJson(response)
      if (!shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) return
      if (response.ok && value?.success) setWcTasks(Array.isArray(value.tasks) ? value.tasks : [])
      else if (response.status === 401 || response.status === 403) setWcError(value?.error || '未授权，请从工作台同源打开')
    } catch {
      /* keep prior list only if still same space; otherwise already cleared */
    }
  }, [spaceId])

  useEffect(() => {
    void refreshWordcloudTasks()
  }, [refreshWordcloudTasks])

  async function onPickCommentFile(file: File | null) {
    setWcError('')
    const checked = validateCommentImportFile(file)
    if (!checked.ok) {
      setWcError(checked.error || '文件无效')
      return
    }
    const text = await file!.text()
    setWcText(text)
    setWcFileName(file!.name)
    if (checked.clearFixture) setWcFixture(false)
  }

  async function runCommentWordcloudAnalyze() {
    if (!wcText.trim()) {
      setWcNotice('')
      setWcError('评论内容为空')
      return
    }
    const requestSpaceId = spaceId
    setWcBusy(true)
    setWcError('')
    setWcNotice('')
    try {
      const response = await wcFetch({
        method: 'POST',
        body: JSON.stringify({
          action: 'analyze',
          space: requestSpaceId,
          text: wcText,
          filename: wcFileName || 'comments.txt',
          fixtureLabeled: wcFixture,
          sourceLabel: wcFixture ? '测试示例 fixture' : wcFileName || 'pasted',
        }),
      })
      const { value } = await readJson(response)
      if (!shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) return
      if (!response.ok || value?.success === false) {
        throw new Error(value?.error || value?.task?.error || '词云分析失败')
      }
      const task = value.task
      setWcNotice(`词云完成，${task?.commentCount || 0} 条正文。词云不会去平台爬评论。`)
      if (task?.id) setSelectedTaskId(task.id)
      setRailMode('wordcloud')
      await refreshWordcloudTasks()
    } catch (e) {
      if (shouldApplyAsyncResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })) {
        setWcError(collectVisibleSubmitError(e instanceof Error ? e.message : '', '词云分析失败'))
      }
    } finally {
      setWcBusy(false)
    }
  }

  const { download: downloadTasks, search: searchTasks } = partitionMediaTasks(tasks)
  const railTasks = activeMode === 'wordcloud' ? wcTasks : activeMode === 'search' ? searchTasks : downloadTasks
  const selectedTask = railTasks.find((task: { id: string }) => task.id === selectedTaskId) || null
  const railItems = useMemo(
    () =>
      railTasks.map((task: any) => ({
        id: task.id,
        title: collectRailTitle(task),
        meta: collectRailMeta(task),
        status: collectStatusLabel(task.status, activeMode),
        statusTone: (task.status === 'succeeded'
          ? 'ok'
          : task.status === 'failed' || task.status === 'rejected'
            ? 'fail'
            : task.status === 'running' || task.status === 'queued' || task.status === 'needs_login'
              ? 'run'
              : '') as 'ok' | 'fail' | 'run' | '',
        selected: selectedTaskId === task.id,
        onClick: () => {
          setSelectedTaskId(task.id)
          setDialogOpen(true)
        },
      })),
    [railTasks, activeMode, selectedTaskId],
  )
  useRecordRail({
    title: '采集',
    empty: collectRailEmpty(activeMode),
    stamp: `${activeMode}:${busy}:${searchBusy}:${wcBusy}:${selectedTaskId}:${railTasks.length}`,
    items: railItems,
  })

  const selectedFailure = collectFailureKind(selectedTask)
  const failureMessage = collectFailureClerkMessage(selectedFailure, selectedTask)
  const failureDetails = collectFailureDetails(selectedTask)
  const retryRequest = collectRetryRequest({ task: selectedTask, currentSpaceId: spaceId, fallbackSlot: slot })
  const setupPending = capability?.configured === false && !(dialogOpen && selectedFailure)
  const douyinHint = dialogOpen && selectedFailure
    ? ''
    : douyinCdpHint({
      platform: classified?.platform,
      source,
      cdpOk: capability?.cdp?.ok,
    })

  const retrySelectedDownload = () => {
    const request = collectRetryRequest({ task: selectedTask, currentSpaceId: spaceId, fallbackSlot: slot })
    if (!request) return
    dismissedRef.current = null
    setSource(request.source)
    setSlot(request.slot as SlotId)
    setError('')
    setDialogOpen(true)
    void startDownload({ source: request.source, slot: request.slot })
  }

  const closeCollectDialog = useCallback(() => {
    const taskId = selectedTaskIdRef.current
    if (taskId) dismissedRef.current = { spaceId: spaceRef.current, taskId }
    setDialogOpen(false)
  }, [])

  const openMaterialsFromDialog = () => {
    closeCollectDialog()
    onOpenMaterials()
  }

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

  if (!spaceId) {
    return (
      <section className={css.root} aria-label="采集">
        <div className={css.panel}>
          <h2>先选公司</h2>
          <p className={css.lead}>下载会进这家公司的素材柜。</p>
          {onPickCompany ? (
            <div className={css.actions}>
              <button type="button" className={css.ghost} onClick={onPickCompany}>
                选择公司
              </button>
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  return (
    <section className={css.root} aria-label="采集">
      {setupPending ? (
        <p className={`${css.banner} ${css.bannerError}`} role="alert">
          {pendingSetupBanner(capability?.pendingSetup)}
        </p>
      ) : null}
      {error ? <p className={css.error} role="alert">{error}</p> : null}
      {notice ? <p className={`${css.banner} ${css.bannerOk}`} role="status">{notice}</p> : null}

      <div className={css.panel}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void startDownload()
          }}
        >
          <div className={css.formGrid}>
            <label className={`${css.field} ${css.formWide}`}>
              视频/帖子链接
              <input
                value={source}
                disabled={busy}
                placeholder="抖音 / 小红书 / 快手 / B站 / 微博链接，或整段分享口令"
                onChange={(event) => {
                  setSource(event.target.value)
                  setError('')
                  setNotice('')
                }}
                onBlur={() => void classify(source)}
              />
            </label>
            {platformHint ? <p className={`${css.hint} ${css.formWide}`}>{platformHint}</p> : null}
            {douyinHint ? <p className={`${css.hint} ${css.formWide}`}>{douyinHint}</p> : null}
            <label className={css.field}>
              入库用途
              <select value={slot} disabled={busy} onChange={(event) => setSlot(event.target.value as SlotId)}>
                {SLOTS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={`${css.actions} ${css.formWide}`}>
              <span className={css.formNote}>下载会进这家公司的素材柜，之后可以在素材柜里改名、分类。</span>
              <button
                type="submit"
                className={css.primary}
                disabled={busy || !source.trim() || capability?.configured === false}
              >
                {busy ? '下载中…' : '下载到素材柜'}
              </button>
            </div>
          </div>
        </form>
      </div>

      <DigitalHumanDeskModal
        open={dialogOpen && !!selectedTask}
        title={selectedTask ? collectDialogTitle(selectedTask, activeMode === 'wordcloud' ? 'wordcloud' : activeMode === 'search' || selectedTask.sourceKind === 'keyword_search' || selectedTask.mode === 'search' ? 'search' : 'download') : '采集'}
        onClose={closeCollectDialog}
      >
        {selectedTask && activeMode === 'wordcloud' ? (
          <article className={css.task}>
            <b>
              {selectedTask.fixtureLabeled ? <span className={css.tagWarn}>测试示例</span> : null}
              {selectedTask.sourceLabel || selectedTask.id}
            </b>
            <small>{collectStatusLabel(selectedTask.status, 'wordcloud')}</small>
            {collectFailureKind(selectedTask) ? (
              <p className={css.lead} role="status">{collectFailureClerkMessage(collectFailureKind(selectedTask), selectedTask)}</p>
            ) : selectedTask.error ? (
              <p className={css.lead} role="status">{collectVisibleSubmitError(selectedTask.error)}</p>
            ) : null}
            {selectedTask.topWords?.length ? (
              <p className={css.hint}>
                词频 Top：{selectedTask.topWords.slice(0, 10).map((w: any) => `${w.word}(${w.count})`).join(' · ')}
              </p>
            ) : null}
            {selectedTask.status === 'succeeded' && selectedTask.id ? (
              <div className={css.actions} style={{ marginTop: 8 }}>
                <a className={css.ghost} href={wordcloudResultHref(spaceId, selectedTask.id, 'png')} target="_blank" rel="noreferrer">
                  打开词云图
                </a>
                <a className={css.ghost} href={wordcloudResultHref(spaceId, selectedTask.id, 'freq')} target="_blank" rel="noreferrer">
                  词频 JSON
                </a>
              </div>
            ) : null}
            {(selectedTask.status === 'running' || selectedTask.status === 'queued') && (
              <button
                type="button"
                className={css.ghost}
                disabled={wcBusy}
                onClick={() =>
                  void wcFetch({
                    method: 'POST',
                    body: JSON.stringify({ action: 'cancel', space: spaceId, id: selectedTask.id }),
                  }).then(() => refreshWordcloudTasks())
                }
              >
                取消
              </button>
            )}
            {selectedTask.detail ? (
              <details className={css.advanced}>
                <summary>详细信息</summary>
                <pre className={css.detail} aria-label="脱敏诊断摘录">
                  {selectedTask.detail}
                </pre>
              </details>
            ) : null}
          </article>
        ) : selectedTask ? (
          <article className={css.task}>
            <b>{collectRailTitle(selectedTask)}</b>
            <small>
              <span className={selectedTask.status === 'needs_login' ? css.tagWarn : css.tagMuted}>
                {collectStatusLabel(selectedTask.status, activeMode)}
              </span>
              {collectRailMeta(selectedTask) ? ` ${collectRailMeta(selectedTask)}` : ''}
            </small>
            {failureMessage ? (
              <p className={css.lead} role="status">{failureMessage}</p>
            ) : null}
            {activeMode === 'search' || selectedTask.sourceKind === 'keyword_search' || selectedTask.mode === 'search' ? (
              <p className={css.hint}>
                选题不会下载视频
                {selectedTask.keywords ? ` · 「${selectedTask.keywords}」` : ''}
                {selectedTask.searchHits?.length ? ` · ${selectedTask.searchHits.length} 条` : ''}
              </p>
            ) : null}
            {selectedTask.searchHits?.length ? (
              <div className={css.sampleBox}>
                {(() => {
                  const analysis = buildSampleAnalysisFromHits(selectedTask)
                  if (!analysis) return null
                  return (
                    <>
                      <p className={css.hint} style={{ marginBottom: 4 }}>
                        <span className={css.tag}>样本指标</span>
                        插件本地汇总 · 样本 {analysis.sampleSize} 条
                      </p>
                      <p className={css.hint}>
                        合计 赞 {analysis.totals?.liked ?? 0} · 评 {analysis.totals?.comment ?? 0} · 转 {analysis.totals?.share ?? 0} · 藏{' '}
                        {analysis.totals?.collected ?? 0}
                      </p>
                      <p className={css.hint}>样本内互动排行：</p>
                      <ol>
                        {(analysis.topByEngagement || []).map((row) => (
                          <li key={`${selectedTask.id}-rank-${row.rank}`}>
                            {(row.title || '条目').slice(0, 60)}
                            {` · 分 ${row.engagementScore ?? 0}`}
                            {row.likedCount != null ? ` · 赞 ${row.likedCount}` : ''}
                            {row.commentCount != null ? ` · 评 ${row.commentCount}` : ''}
                          </li>
                        ))}
                      </ol>
                    </>
                  )
                })()}
                <ul>
                  {selectedTask.searchHits.slice(0, 10).map((h: any, idx: number) => (
                    <li key={`${selectedTask.id}-hit-${idx}`}>
                      {(h.title || h.awemeId || '条目').slice(0, 80)}
                      {h.likedCount != null ? ` · 赞 ${h.likedCount}` : ''}
                      {h.commentCount != null ? ` · 评 ${h.commentCount}` : ''}
                      {h.url ? (
                        <>
                          {' · '}
                          <a href={h.url} target="_blank" rel="noreferrer">
                            打开
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {selectedTask.status === 'succeeded' && activeMode === 'download' ? (
              <>
                <p className={css.ok}>
                  {collectIngestedVideoNames(selectedTask.materials).join('、') || '一条视频'}
                </p>
                {collectVideoOnlyNote(selectedTask.code) ? <p className={css.hint}>{collectVideoOnlyNote(selectedTask.code)}</p> : null}
              </>
            ) : null}
            {failureDetails ? (
              <details className={css.advanced}>
                <summary>详细信息</summary>
                <pre className={css.detail} aria-label="脱敏诊断摘录">
                  {failureDetails}
                </pre>
              </details>
            ) : null}
            <div className={css.actions} style={{ marginTop: 8 }}>
              {selectedFailure === 'needs_login' ? (
                <>
                  <button type="button" className={css.ghost} disabled={busy} onClick={() => void cancelTask(selectedTask.id)}>取消</button>
                  {retryRequest ? (
                    <button type="button" className={css.primary} disabled={busy} onClick={retrySelectedDownload}>再试一次</button>
                  ) : null}
                </>
              ) : selectedFailure ? (
                <>
                  {retryRequest ? (
                    <button type="button" className={css.primary} disabled={busy} onClick={retrySelectedDownload}>再试一次</button>
                  ) : null}
                  <button type="button" className={css.ghost} disabled={busy} onClick={openMaterialsFromDialog}>去素材柜上传</button>
                </>
              ) : (
                <>
                  {(selectedTask.status === 'running' || selectedTask.status === 'queued') && (
                    <button type="button" className={css.ghost} disabled={busy} onClick={() => void cancelTask(selectedTask.id)}>
                      取消
                    </button>
                  )}
                  {selectedTask.status === 'succeeded' && activeMode === 'download' ? (
                    <button type="button" className={css.ghost} disabled={busy} onClick={openMaterialsFromDialog}>
                      去素材柜查看
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </article>
        ) : null}
      </DigitalHumanDeskModal>

      <details
        className={css.advanced}
        onToggle={(event) => {
          const open = event.currentTarget.open
          setToolsOpen(open)
          if (!open) setRailMode('download')
          else if (railMode === 'download') setRailMode('search')
        }}
      >
        <summary>选题和词云</summary>
        <div className={css.advancedBody}>
          <p className={css.lead}>选题不会下载视频。词云不会去平台爬评论，要自己导入文本。</p>
          <div className={css.toolTabs} role="group" aria-label="选题或词云">
            <button
              type="button"
              className={railMode === 'search' ? `${css.toolTab} ${css.toolTabOn}` : css.toolTab}
              onClick={() => setRailMode('search')}
            >
              关键词选题
            </button>
            <button
              type="button"
              className={railMode === 'wordcloud' ? `${css.toolTab} ${css.toolTabOn}` : css.toolTab}
              onClick={() => setRailMode('wordcloud')}
            >
              评论词云
            </button>
          </div>

          {railMode === 'search' ? (
            <>
              <label className={css.field}>
                关键词
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="例如：小程序开发"
                  aria-label="搜索关键词"
                />
              </label>
              <div className={css.actions}>
                <button type="button" className={css.ghost} disabled={searchBusy || !keyword.trim()} onClick={() => void runKeywordSearch()}>
                  {searchBusy ? '搜索中…' : '开始搜索'}
                </button>
              </div>
              <details className={css.advanced}>
                <summary>高级：浏览器模式</summary>
                <div className={css.advancedBody}>
                  <label className={css.field}>
                    浏览器模式
                    <select
                      aria-label="浏览器模式"
                      value={browserMode}
                      onChange={(e) => setBrowserMode(e.target.value as 'standard' | 'cdp_existing' | 'cdp_launch')}
                    >
                      <option value="standard">原版方式（登录弹窗，之后命令执行）</option>
                      <option value="cdp_existing">连接已有 Chrome（CDP 9222）</option>
                      <option value="cdp_launch">CDP 启动新浏览器</option>
                    </select>
                  </label>
                </div>
              </details>
            </>
          ) : railMode === 'wordcloud' ? (
            <>
              <label className={css.field}>
                评论内容
                <textarea
                  className={css.textarea}
                  value={wcText}
                  onChange={(e) => {
                    setWcText(e.target.value)
                    setWcFixture(false)
                  }}
                  placeholder="一行一条，或 JSON/JSONL（字段 content / comment_text / text）"
                  rows={6}
                  aria-label="评论导入文本"
                />
              </label>
              <div className={css.row}>
                <input
                  type="file"
                  accept=".txt,.json,.jsonl,text/plain,application/json"
                  aria-label="选择评论文件"
                  onChange={(e) => void onPickCommentFile(e.target.files?.[0] || null)}
                />
                <label className={css.check}>
                  <input type="checkbox" checked={wcFixture} onChange={(e) => setWcFixture(e.target.checked)} />
                  标记为测试示例（非真实采集）
                </label>
              </div>
              <div className={css.actions}>
                <button type="button" className={css.ghost} disabled={wcBusy || !wcText.trim()} onClick={() => void runCommentWordcloudAnalyze()}>
                  {wcBusy ? '生成中…' : '生成词云'}
                </button>
              </div>
              {wcError ? <p className={css.error} role="alert">{wcError}</p> : null}
              {wcNotice ? <p className={`${css.banner} ${css.bannerOk}`} role="status">{wcNotice}</p> : null}
            </>
          ) : null}
        </div>
      </details>
    </section>
  )
}
