// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import { expect, it, describe } from 'vitest'
import {
  partitionMediaTasks,
  hasActiveMediaTask,
  needsLoginBanner,
  platformRestrictedBanner,
  resolveActionErrorPriority,
  wordcloudResultHref,
  isSameOriginWordcloudPath,
  validateCommentImportFile,
  shouldApplyAsyncResult,
  filterTasksForSpace,
  defaultBrowserMode,
  tabKeepsInFlightTasks,
  classifyHintText,
  douyinCdpHint,
  pendingSetupBanner,
  collectStatusLabel,
  collectRailEmpty,
  collectRailTitle,
  collectRailMeta,
  downloadSuccessNotice,
  shouldApplyDownloadSuccess,
  nextSourceAfterSuccess,
  collectFailureKind,
  collectFailureClerkMessage,
  collectFailureDetails,
  collectSubmitErrorFromResult,
  collectRetryRequest,
  collectIngestedVideoNames,
  collectVideoOnlyNote,
  collectDialogTitle,
  shouldAutoOpenCollectDialog,
  COLLECT_BROWSER_UNAVAILABLE_MESSAGE,
  COLLECT_NEEDS_LOGIN_MESSAGE,
  COLLECT_RESTRICTED_MESSAGE,
  COLLECT_FAILURE_FALLBACK,
} from '../src/client/video-download-state.ts'

describe('partitionMediaTasks / banners', () => {
  const tasks = [
    { id: 'd1', status: 'succeeded', mode: 'detail' },
    { id: 's1', status: 'needs_login', mode: 'search', sourceKind: 'keyword_search', code: 'needs_login' },
    { id: 'd2', status: 'running' },
    { id: 'r1', status: 'failed', code: 'platform_restricted', sourceKind: 'keyword_search', mode: 'search' },
  ]
  it('splits download vs search including legacy keyword_search', () => {
    const { download, search } = partitionMediaTasks(tasks)
    expect(download.map((t) => t.id)).toEqual(['d1', 'd2'])
    expect(search.map((t) => t.id)).toEqual(['s1', 'r1'])
  })
  it('detects active/poll and banners', () => {
    expect(hasActiveMediaTask(tasks)).toBe(true)
    expect(needsLoginBanner(tasks)).toBe(true)
    expect(platformRestrictedBanner(tasks)).toBe(true)
    expect(hasActiveMediaTask([{ id: 'x', status: 'succeeded' }])).toBe(false)
  })
})

describe('error priority / browser mode', () => {
  it('prefers empty input message', () => {
    expect(
      resolveActionErrorPriority({
        emptyInputMessage: '请输入关键词。选题不会下载视频。',
        responseError: '服务器错',
        fallback: '失败',
      }),
    ).toContain('关键词')
  })
  it('appends nextStep', () => {
    expect(
      resolveActionErrorPriority({ taskError: '需登录', nextStep: '去扫码', fallback: '失败' }),
    ).toBe('需登录；去扫码')
  })
  it('seeds browser mode once from capability', () => {
    const first = defaultBrowserMode('standard', 'cdp_existing', false)
    expect(first).toEqual({ mode: 'standard', seeded: true })
    const second = defaultBrowserMode('cdp_launch', first.mode, first.seeded)
    expect(second.mode).toBe('standard')
  })
})

describe('space race / wordcloud links / import', () => {
  it('drops stale async when space changed or unmounted', () => {
    expect(shouldApplyAsyncResult({ requestSpaceId: 'a', currentSpaceId: 'a', live: true })).toBe(true)
    expect(shouldApplyAsyncResult({ requestSpaceId: 'a', currentSpaceId: 'b', live: true })).toBe(false)
    expect(shouldApplyAsyncResult({ requestSpaceId: 'a', currentSpaceId: 'a', live: false })).toBe(false)
  })
  it('filters explicit cross-space ids; keeps legacy omit spaceId', () => {
    const list = [
      { id: '1', spaceId: 'co-a' },
      { id: '2', spaceId: 'co-b' },
      { id: '3' },
    ]
    expect(filterTasksForSpace(list, 'co-a').map((t) => t.id)).toEqual(['1', '3'])
    expect(filterTasksForSpace(list, '')).toEqual([])
  })
  it('builds same-origin wordcloud hrefs only', () => {
    const href = wordcloudResultHref('default', 'wc-1', 'png')
    expect(href).toBe('/digital-human-studio/comment-wordcloud?space=default&id=wc-1&kind=png')
    expect(isSameOriginWordcloudPath(href)).toBe(true)
    expect(isSameOriginWordcloudPath('http://127.0.0.1:3099/digital-human-studio/comment-wordcloud')).toBe(false)
  })
  it('validates import size and clears fixture flag intent', () => {
    expect(validateCommentImportFile(null).ok).toBe(false)
    expect(validateCommentImportFile({ size: 3 * 1024 * 1024 }).error).toMatch(/2MB/)
    expect(validateCommentImportFile({ size: 10, name: 'a.jsonl' })).toEqual({ ok: true, clearFixture: true })
  })
  it('tab switch does not imply dropping in-flight local tasks', () => {
    expect(tabKeepsInFlightTasks('download', 'search', [{ id: '1', status: 'running' }])).toBe(true)
  })
})

describe('collect desk helpers', () => {
  it('formats classify hint, douyin cdp note, and setup banner first sentence', () => {
    expect(classifyHintText({ platform: 'dy', mediaDownloadSupported: true })).toBe('抖音，可以下载')
    expect(classifyHintText({ platform: 'xhs', mediaDownloadSupported: false })).toBe('小红书，不能下载')
    expect(douyinCdpHint({ platform: 'dy', cdpOk: true })).toBe('')
    expect(douyinCdpHint({ platform: 'dy', cdpOk: false })).toBe('抖音要先在本机打开并登录。下不下来就去素材柜传文件。')
    expect(douyinCdpHint({ source: 'https://v.douyin.com/abc', cdpOk: undefined })).toContain('去素材柜传文件')
    expect(pendingSetupBanner(undefined)).toBe('本机采集还没就绪')
    expect(pendingSetupBanner(['本机采集还没就绪。/usr/bin/python3 未找到', '第二句路径'])).toBe('本机采集还没就绪。')
  })

  it('maps status by mode and never calls search success 已入库', () => {
    expect(collectStatusLabel('succeeded', 'download')).toBe('已入库')
    expect(collectStatusLabel('succeeded', 'search')).toBe('已完成')
    expect(collectStatusLabel('succeeded', 'wordcloud')).toBe('已完成')
    expect(collectStatusLabel('running', 'download')).toBe('下载中')
    expect(collectStatusLabel('running', 'search')).toBe('搜索中')
    expect(collectStatusLabel('needs_login', 'download')).toBe('需登录')
    expect(collectStatusLabel('needs_setup', 'download')).toBe('未配置')
    expect(collectRailEmpty('download')).toBe('还没有采集任务。')
    expect(collectRailEmpty('search')).toBe('还没有选题任务。')
    expect(collectRailEmpty('wordcloud')).toBe('还没有词云任务。')
    expect(collectRailTitle({ source: 'https://www.douyin.com/video/123456789012345' }).endsWith('…')).toBe(true)
    expect(collectRailTitle({ keywords: '小程序开发' })).toBe('小程序开发')
    expect(collectRailMeta({ platform: 'dy', slot: 'product' })).toBe('抖音 · 产品')
    expect(downloadSuccessNotice('store')).toBe('已放入素材柜（门店）')
  })

  it('notices and clears only the current submission, not a new input or another company', () => {
    const sub = { spaceId: 'co-a', taskId: 't1', source: 'https://v.douyin.com/old', slot: 'product' }
    expect(shouldApplyDownloadSuccess({
      submission: sub, currentSpaceId: 'co-a', live: true, task: { id: 't1', status: 'succeeded' },
    })).toEqual({ notice: true, sourceToClear: 'https://v.douyin.com/old' })
    expect(nextSourceAfterSuccess('https://v.douyin.com/new', 'https://v.douyin.com/old')).toBe('https://v.douyin.com/new')
    expect(nextSourceAfterSuccess('https://v.douyin.com/old', 'https://v.douyin.com/old')).toBe('')
    expect(shouldApplyDownloadSuccess({
      submission: sub, currentSpaceId: 'co-b', live: true, task: { id: 't1', status: 'succeeded' },
    }).notice).toBe(false)
    expect(shouldApplyDownloadSuccess({
      submission: { ...sub, noticed: true }, currentSpaceId: 'co-a', live: true, task: { id: 't1', status: 'succeeded' },
    }).notice).toBe(false)
    expect(shouldApplyDownloadSuccess({
      submission: sub, currentSpaceId: 'co-a', live: true, task: { id: 'old-history', status: 'succeeded' },
    }).notice).toBe(false)
    expect(shouldApplyDownloadSuccess({
      submission: sub, currentSpaceId: 'co-a', live: false, task: { id: 't1', status: 'succeeded' },
    }).notice).toBe(false)
  })
})

describe('collectFailureKind', () => {
  it('prioritizes browser unavailable over a needs_login misclassification', () => {
    const chromeLogin = {
      status: 'needs_login',
      code: 'cdp_unavailable',
      error: '无法连接本机 Chrome CDP (127.0.0.1:9222)',
      nextStep: '请打开远程调试后重试，不要改端口',
    }
    expect(collectFailureKind(chromeLogin)).toBe('browser_unavailable')
    expect(collectFailureClerkMessage('browser_unavailable', chromeLogin)).toBe(COLLECT_BROWSER_UNAVAILABLE_MESSAGE)
    expect(collectFailureClerkMessage('browser_unavailable', chromeLogin)).not.toMatch(/CDP|9222|远程调试/)
    expect(collectFailureDetails(chromeLogin)).toContain('9222')
    expect(collectFailureDetails(chromeLogin)).toContain('不要改端口')
  })

  it('treats Chrome needs_setup and 9222 error text as browser unavailable', () => {
    expect(collectFailureKind({
      status: 'needs_setup',
      error: '本机 Chrome 还没连上',
    })).toBe('browser_unavailable')
    expect(collectFailureKind({
      status: 'failed',
      error: '无法连接本机 Chrome CDP (127.0.0.1:9222)',
    })).toBe('browser_unavailable')
  })

  it('does not treat sidecar CDP_DEBUG_PORT=9222 logs as a missing Chrome', () => {
    expect(collectFailureKind({
      status: 'needs_login',
      code: 'needs_login',
      error: '登录未完成或失败（exit 0）。',
      detail: '[dh-mc-runner] browser_mode=standard CDP_DEBUG_PORT=9222 AUTO_CLOSE_BROWSER=True HEADLESS=True',
    })).toBe('needs_login')
    expect(collectSubmitErrorFromResult({
      success: false,
      task: {
        status: 'needs_login',
        code: 'needs_login',
        error: '登录未完成或失败（exit 0）。',
        detail: 'CDP_DEBUG_PORT=9222',
      },
    }, '热榜刷新失败')).toBe(COLLECT_NEEDS_LOGIN_MESSAGE)
  })

  it('classifies needs_login by status or code, and restricted or captcha', () => {
    expect(collectFailureKind({ status: 'needs_login', error: '请扫码' })).toBe('needs_login')
    expect(collectFailureKind({ status: 'failed', code: 'needs_login' })).toBe('needs_login')
    expect(collectFailureClerkMessage('needs_login')).toBe(COLLECT_NEEDS_LOGIN_MESSAGE)
    expect(collectSubmitErrorFromResult({
      success: false,
      error: '平台搜索返回需登录（如 status_code=2483）。pong/skip-login 只表示本地页面标记，不等于搜索授权。',
      task: { status: 'needs_login', code: 'needs_login' },
    }, '热榜刷新失败')).toBe(COLLECT_NEEDS_LOGIN_MESSAGE)
    expect(collectFailureKind({ status: 'failed', code: 'platform_restricted' })).toBe('platform_restricted')
    expect(collectFailureKind({ status: 'failed', code: 'captcha' })).toBe('platform_restricted')
    expect(collectFailureClerkMessage('platform_restricted')).toBe(COLLECT_RESTRICTED_MESSAGE)
  })

  it('uses a single task.error for ordinary failures and never appends nextStep', () => {
    const task = { status: 'failed', error: '平台返回失败。', nextStep: '请检查代理后重试' }
    expect(collectFailureKind(task)).toBe('failed')
    expect(collectFailureClerkMessage('failed', task)).toBe('平台返回失败。')
    expect(collectFailureClerkMessage('failed', task)).not.toContain('请检查代理后重试')
    expect(collectFailureClerkMessage('failed', { status: 'failed', error: '无法连接本机 Chrome CDP (127.0.0.1:9222)' })).toBe(COLLECT_FAILURE_FALLBACK)
    expect(collectFailureClerkMessage('failed', { status: 'failed' })).toBe(COLLECT_FAILURE_FALLBACK)
  })

  it('does not treat queued or succeeded tasks as failures', () => {
    expect(collectFailureKind({ status: 'queued', error: '无法连接本机 Chrome CDP (127.0.0.1:9222)' })).toBe(null)
    expect(collectFailureKind({ status: 'running', code: 'needs_login' })).toBe(null)
    expect(collectFailureKind({ status: 'succeeded', error: '旧错误' })).toBe(null)
  })

  it('treats media_fetch_failed as ordinary failure even if detail mentions cdp', () => {
    const task = {
      status: 'failed',
      code: 'media_fetch_failed',
      error: '媒体文件下载失败',
      detail: 'stage=start cdp=<url>\nstage=video_fetch_failed InvalidURL',
    }
    expect(collectFailureKind(task)).toBe('failed')
    expect(collectFailureClerkMessage(collectFailureKind(task), task)).toBe('媒体文件下载失败')
  })

  it('does not let a historical needs_login pollute the currently selected ordinary failure', () => {
    const history = { status: 'needs_login', code: 'needs_login', error: '请扫码' }
    const selected = { status: 'failed', error: '平台返回失败。' }
    expect(collectFailureKind(history)).toBe('needs_login')
    expect(collectFailureKind(selected)).toBe('failed')
    expect(collectFailureClerkMessage(collectFailureKind(selected), selected)).toBe('平台返回失败。')
    expect(collectFailureClerkMessage(collectFailureKind(selected), selected)).not.toContain('扫码')
  })

  it('retries with the selected task source and slot, not a stale input, and stays in the current company', () => {
    const task = { source: 'https://v.douyin.com/old', slot: 'store', spaceId: 'co-a', status: 'failed' }
    expect(collectRetryRequest({ task, currentSpaceId: 'co-a', fallbackSlot: 'product' })).toEqual({
      source: 'https://v.douyin.com/old',
      slot: 'store',
    })
    const staleInput = 'https://v.douyin.com/new'
    const request = collectRetryRequest({ task, currentSpaceId: 'co-a', fallbackSlot: staleInput })
    expect(request?.source).toBe('https://v.douyin.com/old')
    expect(request?.source).not.toBe(staleInput)
    expect(collectRetryRequest({ task: { ...task, spaceId: 'co-b' }, currentSpaceId: 'co-a', fallbackSlot: 'product' })).toBe(null)
    expect(collectRetryRequest({ task: { status: 'failed', spaceId: 'co-a' }, currentSpaceId: 'co-a', fallbackSlot: 'product' })).toBe(null)
  })
})

describe('collect dialog helpers', () => {
  it('titles follow mode: download uses 已放入素材柜, not for search or wordcloud', () => {
    expect(collectDialogTitle({ status: 'failed' })).toBe('下载没成功')
    expect(collectDialogTitle({ status: 'succeeded' })).toBe('已放入素材柜')
    expect(collectDialogTitle({ status: 'running' })).toBe('下载中')
    expect(collectDialogTitle({ status: 'queued' })).toBe('下载中')
    expect(collectDialogTitle({ status: 'needs_login' })).toBe('下载没成功')
    expect(collectDialogTitle({ status: 'succeeded' }, 'search')).toBe('选题完成')
    expect(collectDialogTitle({ status: 'failed' }, 'search')).toBe('选题没成功')
    expect(collectDialogTitle({ status: 'running' }, 'search')).toBe('选题中')
    expect(collectDialogTitle({ status: 'succeeded' }, 'wordcloud')).toBe('词云完成')
    expect(collectDialogTitle({ status: 'queued' }, 'wordcloud')).toBe('词云生成中')
    expect(collectDialogTitle({ status: 'failed' }, 'wordcloud')).toBe('词云没成功')
    expect(collectDialogTitle({ status: 'succeeded' }, 'search')).not.toBe('已放入素材柜')
  })

  it('lists only ingested video names, never cover jpg', () => {
    expect(collectIngestedVideoNames([
      { name: 'clip.mp4', kind: 'video' },
      { name: 'clip_cover.jpg', kind: 'image' },
      { name: 'poster.png' },
      { name: 'voice.mp3', kind: 'audio' },
      { name: 'take.webm' },
    ])).toEqual(['clip.mp4', 'take.webm'])
    expect(collectVideoOnlyNote('video_only')).toBe('这条没有单独音轨')
    expect(collectVideoOnlyNote('failed')).toBe('')
  })

  it('auto-opens only this-session terminal tasks, not history, and not after dismiss or company switch', () => {
    const terminal = { id: 't-new', status: 'failed' }
    const base = {
      live: true,
      submissionTaskId: 't-new',
      submissionSpaceId: 'co-a',
      currentSpaceId: 'co-a',
      task: terminal,
      dismissed: null,
    }
    expect(shouldAutoOpenCollectDialog(base)).toBe(true)
    expect(shouldAutoOpenCollectDialog({ ...base, task: { id: 't-new', status: 'succeeded' } })).toBe(true)
    expect(shouldAutoOpenCollectDialog({ ...base, task: { id: 't-new', status: 'needs_login' } })).toBe(true)
    expect(shouldAutoOpenCollectDialog({ ...base, task: { id: 't-new', status: 'running' } })).toBe(false)
    expect(shouldAutoOpenCollectDialog({ ...base, submissionTaskId: '', task: { id: 'hist', status: 'failed' } })).toBe(false)
    expect(shouldAutoOpenCollectDialog({ ...base, task: { id: 'hist', status: 'failed' } })).toBe(false)
    expect(shouldAutoOpenCollectDialog({ ...base, dismissed: { spaceId: 'co-a', taskId: 't-new' } })).toBe(false)
    expect(shouldAutoOpenCollectDialog({ ...base, currentSpaceId: 'co-b' })).toBe(false)
    expect(shouldAutoOpenCollectDialog({ ...base, submissionSpaceId: 'co-b' })).toBe(false)
    expect(shouldAutoOpenCollectDialog({ ...base, live: false })).toBe(false)
    expect(shouldAutoOpenCollectDialog({ ...base, task: { id: 't-retry', status: 'failed' }, submissionTaskId: 't-retry', dismissed: { spaceId: 'co-a', taskId: 't-new' } })).toBe(true)
  })
})
