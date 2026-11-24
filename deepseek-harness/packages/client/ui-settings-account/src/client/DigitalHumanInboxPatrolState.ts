import { useEffect, useRef, useState } from 'react'
import { postPlatformAccount, shouldApplyAccountResult } from './DigitalHumanPlatformAccountsState.ts'

export const PATROL_TITLE = '个人号页面巡查'
export const PATROL_LEAD = '只看官方网页上能看见的私信和评论。抖音私信、抖音评论和小红书私信已按官方页映射，仍待真实网页核对。小红书通知评论列表还缺列表结构证据，不能当作已接入。定时默认关闭，回复只保存待确认草稿，不会自动发送。'
export const PATROL_SCHEDULE_OFF = '定时巡查默认关闭。还没有真实网页核验记录前不能打开。'
export const PATROL_EMPTY_HISTORY = '还没有收录到可见的私信或评论。'
export const PATROL_VERIFY = '只读核对该页'

export type PatrolCapability = {
  platform: string
  messages: string
  comments: string
  inboxPage?: string | null
  commentsPage?: string | null
  knownOfficialPages?: { kind: string; url: string; source: string; note?: string }[]
  missing?: string[]
  note?: string
}

export type PatrolState = {
  policy: { enabled: boolean; intervalMinutes: number }
  capabilities: PatrolCapability[]
  history: { id: string; platform: string; channel: string; visibleText: string; seenAt: number; bindingId: string; authorName?: string; workUrl?: string; visibleTime?: string; commentId?: string }[]
  drafts: { id: string; itemId: string; body: string; status: string }[]
  lastRun?: { status: string; claimedRead: boolean; reason: string; added: number } | null
  connected?: boolean
  note?: string
  accounts?: { id: string; platform: string; label: string; status: string }[]
}

export function patrolConnected(state: PatrolState | null | undefined) {
  return state?.connected === true
}

export function patrolStatusText(run?: { status?: string; claimedRead?: boolean; reason?: string } | null) {
  if (!run) return ''
  if (run.claimedRead) return run.reason || '已从可见页面文本收录。'
  if (run.status === 'pending_verification') return run.reason || '页面已映射，仍待真实网页核对，没有读取真实私信或评论。'
  if (run.status === 'need_page') return run.reason || '对应官方页还没有出现可读取的列表，没有当作已读。'
  if (run.status === 'not_configured') return run.reason || '这一项还不能巡查，没有读取。'
  if (run.status === 'selector_mismatch') return run.reason || '页面结构对不上，没有当作已读或空成功。'
  if (run.status === 'unsupported') return run.reason || '这个平台还没有可接入的页面契约。'
  if (run.status === 'stopped') return run.reason || '巡查已停止，需要你在官方页面处理。'
  if (run.status === 'busy') return run.reason || '这次巡查还在进行。'
  return run.reason || ''
}

export function patrolChannelStatusLabel(status?: string) {
  if (status === 'pending_verification') return '待验证'
  if (status === 'need_page') return '待打开对应页面'
  if (status === 'selector_mismatch') return '页面结构对不上'
  if (status === 'ready') return '可巡查'
  if (status === 'unsupported') return '不支持'
  if (status === 'not_configured') return '还不能巡查'
  return '还不能巡查'
}

export function patrolPlatformSummary(cap: PatrolCapability) {
  const name = cap.platform === 'douyin' ? '抖音' : cap.platform === 'xiaohongshu' ? '小红书' : cap.platform
  return `${name}：私信${patrolChannelStatusLabel(cap.messages)}；评论${patrolChannelStatusLabel(cap.comments)}`
}

export function patrolHistoryLabel(row: { channel?: string; visibleText?: string }) {
  const kind = row.channel === 'comments' ? '评论' : '私信'
  return `${kind} · ${row.visibleText || ''}`
}

export function useInboxPatrol(spaceId: string) {
  const [state, setState] = useState<PatrolState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftItemId, setDraftItemId] = useState('')
  const live = useRef(true)
  const spaceRef = useRef(spaceId)
  spaceRef.current = spaceId

  const applyGuard = (requestSpaceId: string) =>
    shouldApplyAccountResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })

  const refresh = async (requestSpaceId = spaceId) => {
    const raw = await postPlatformAccount(requestSpaceId, 'studio.accounts.patrol.get')
    if (!applyGuard(requestSpaceId)) return
    setState({
      policy: raw.policy || { enabled: false, intervalMinutes: 30 },
      capabilities: raw.capabilities || [],
      history: raw.history || [],
      drafts: raw.drafts || [],
      lastRun: raw.lastRun || null,
      connected: raw.connected === true,
      note: raw.note || '',
      accounts: raw.accounts || [],
    })
  }

  useEffect(() => {
    const requestSpaceId = spaceId
    live.current = true
    setError('')
    setNotice('')
    setState(null)
    setDraftBody('')
    setDraftItemId('')
    setBusy(true)
    void refresh(requestSpaceId)
      .catch((e) => { if (applyGuard(requestSpaceId)) setError(e instanceof Error ? e.message : '读取巡查设置失败') })
      .finally(() => { if (applyGuard(requestSpaceId)) setBusy(false) })
    return () => { live.current = false }
  }, [spaceId])

  const run = async (bindingId: string) => {
    if (!bindingId) { setError('请选择要巡查的账号'); return }
    const requestSpaceId = spaceId
    setBusy(true); setError(''); setNotice('')
    try {
      const raw = await postPlatformAccount(requestSpaceId, 'studio.accounts.patrol.run', { bindingId })
      if (!applyGuard(requestSpaceId)) return
      const text = patrolStatusText(raw)
      if (raw.claimedRead === true) setNotice(text)
      else setNotice(text || '没有读取到真实消息。未做实页采样时这是预期结果，不会记为已验证。')
      await refresh(requestSpaceId)
    } catch (e) {
      if (applyGuard(requestSpaceId)) setError(e instanceof Error ? e.message : '巡查失败')
    } finally {
      if (applyGuard(requestSpaceId)) setBusy(false)
    }
  }

  const verifyPage = async (bindingId: string) => {
    if (!bindingId) { setError('请选择要核对的账号'); return }
    const requestSpaceId = spaceId
    setBusy(true); setError(''); setNotice('')
    try {
      const raw = await postPlatformAccount(requestSpaceId, 'studio.accounts.patrol.verify_page', { bindingId })
      if (!applyGuard(requestSpaceId)) return
      setNotice(raw.reason || (raw.verificationRecorded ? '已记入真实网页核验记录。' : '只读核对入口可用。本环境未做实页采样，不会记为已验证。'))
      await refresh(requestSpaceId)
    } catch (e) {
      if (applyGuard(requestSpaceId)) setError(e instanceof Error ? e.message : '核对失败')
    } finally {
      if (applyGuard(requestSpaceId)) setBusy(false)
    }
  }

  const stop = async () => {
    const requestSpaceId = spaceId
    setBusy(true)
    try {
      await postPlatformAccount(requestSpaceId, 'studio.accounts.patrol.stop')
      if (!applyGuard(requestSpaceId)) return
      setNotice('已请求停止巡查。')
      await refresh(requestSpaceId)
    } catch (e) {
      if (applyGuard(requestSpaceId)) setError(e instanceof Error ? e.message : '停止失败')
    } finally {
      if (applyGuard(requestSpaceId)) setBusy(false)
    }
  }

  const saveDraft = async () => {
    if (!draftItemId || !draftBody.trim()) { setError('请选择一条记录并填写草稿'); return }
    const requestSpaceId = spaceId
    setBusy(true); setError('')
    try {
      const raw = await postPlatformAccount(requestSpaceId, 'studio.accounts.patrol.draft.save', { itemId: draftItemId, body: draftBody.trim() })
      if (!applyGuard(requestSpaceId)) return
      setNotice(raw.note || '草稿已保存，等待确认，不会发送。')
      setDraftBody('')
      await refresh(requestSpaceId)
    } catch (e) {
      if (applyGuard(requestSpaceId)) setError(e instanceof Error ? e.message : '保存草稿失败')
    } finally {
      if (applyGuard(requestSpaceId)) setBusy(false)
    }
  }

  return { state, busy, error, notice, draftBody, setDraftBody, draftItemId, setDraftItemId, refresh, run, verifyPage, stop, saveDraft }
}
