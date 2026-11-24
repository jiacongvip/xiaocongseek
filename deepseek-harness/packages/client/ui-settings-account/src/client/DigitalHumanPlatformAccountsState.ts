import { useEffect, useRef, useState } from 'react'

export type Platform = { key: string; method: string; loginUrlHost: string; hasPersonalUrl: boolean; supportsQrProbe: boolean; note: string }
export type Account = {
  id: string
  platform: string
  label: string
  nickname?: string
  revision: number
  enabled: boolean
  status: string
  hasCredentialFile: boolean
  lastCheckedAt?: number | null
  updatedAt: number
  reason?: string
  message?: string
  spaceId?: string
}
export type LoginStatus = {
  sessionId: string
  phase: string
  message: string
  hasQr?: boolean
  qrAvailable?: boolean
  platform?: string
  bindingId?: string
  item?: Account | null
  spaceId?: string
}

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  unconfigured: '未登录',
  starting: '正在准备',
  waiting_browser: '等待登录',
  waiting_human_login: '等待登录',
  waiting_scan: '等待扫码',
  authorized: '已授权',
  ready: '已授权',
  expired: '已过期',
  failed: '失败',
  cancelled: '已取消',
  invalid: '无效',
}

export const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: '小红书', tencent: '视频号', douyin: '抖音', kuaishou: '快手', bilibili: 'B站',
  baijiahao: '百家号', sohu: '搜狐号', toutiao_mp: '头条号', wechat_official: '微信公众号',
  csdn: 'CSDN', jianshu: '简书', zhihu: '知乎', x: 'X', weibo: '微博', douban: '豆瓣',
  tieba: '贴吧', omqq: '企鹅号', wangyi_mp: '网易号', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook',
}

export const LOGIN_POLL_INTERVAL_MS = 1500
export const LOGIN_TERMINAL_PHASES = ['authorized', 'failed', 'expired', 'cancelled'] as const
export const ACCOUNT_BIND_EMPTY = '还没有为这家企业添加账号。'
export const ACCOUNT_BIND_LIMIT = 5

export function accountPlatformLabel(key: string): string {
  return PLATFORM_LABEL[key] || key
}

export function accountStatusLabel(status: string): string {
  return ACCOUNT_STATUS_LABEL[status] || status
}

export function accountListMeta(account: { platform: string; status: string; reason?: string; message?: string }): string {
  const base = `${accountPlatformLabel(account.platform)} · ${accountStatusLabel(account.status)}`
  if (account.status !== 'expired' && account.status !== 'failed') return base
  const extra = (account.reason || account.message || '').trim()
  return extra ? `${base} · ${extra}` : base
}

export function accountStatusTone(status: string): 'ok' | 'fail' | 'run' | '' {
  if (status === 'authorized' || status === 'ready') return 'ok'
  if (status === 'failed' || status === 'expired') return 'fail'
  if (status === 'waiting_scan' || status === 'waiting_browser' || status === 'starting' || status === 'waiting_human_login') return 'run'
  return ''
}

export function accountDepsError(deps: { ready?: boolean; phase?: string; message?: string } | null | undefined): string {
  if (!deps || deps.ready !== false) return ''
  return deps.message ? `运行依赖未就绪：${deps.message}` : `运行依赖未就绪（${deps.phase || 'missing'}）`
}

export function isLoginTerminalPhase(phase: string): boolean {
  return (LOGIN_TERMINAL_PHASES as readonly string[]).includes(phase)
}

export function loginQrSrc(spaceId: string, sessionId: string): string {
  return `/publish-studio/login-qr?space=${encodeURIComponent(spaceId)}&sessionId=${encodeURIComponent(sessionId)}`
}

/** Cancel is a no-op unless the user confirms. Message must stay unchanged. */
export function confirmPlatformAccountRemove(label: string, confirm: (message: string) => boolean, remove: () => void): void {
  if (!confirm(`从本公司移除「${label}」绑定？\n不会注销平台账号，也不会删除媒体素材。`)) return
  remove()
}

export function shouldApplyAccountResult(args: { requestSpaceId: string; currentSpaceId: string; live: boolean }): boolean {
  return args.live && !!args.requestSpaceId && args.requestSpaceId === args.currentSpaceId
}

export function accountBindSummary(accounts: Account[], limit = ACCOUNT_BIND_LIMIT) {
  const items = (accounts || []).slice(0, Math.max(0, limit)).map((account) => ({
    id: account.id,
    title: account.label,
    platform: accountPlatformLabel(account.platform),
    status: accountStatusLabel(account.status),
    statusTone: accountStatusTone(account.status),
    meta: accountListMeta(account),
    account,
  }))
  return {
    items,
    hidden: Math.max(0, (accounts || []).length - items.length),
    empty: (accounts || []).length === 0,
    total: (accounts || []).length,
  }
}

export async function postPlatformAccount(spaceId: string, action: string, extra: Record<string, unknown> = {}) {
  const response = await fetch('/digital-human-studio/publication-management', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ space: spaceId, action, ...extra }),
  })
  const raw = await response.json()
  if (!response.ok || raw?.success === false) throw new Error(raw?.error || `请求失败（HTTP ${response.status}）`)
  if (raw.spaceId && raw.spaceId !== spaceId) throw new Error('公司响应不匹配')
  return raw
}

export function usePlatformAccountsController(spaceId: string) {
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [platform, setPlatform] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [login, setLogin] = useState<LoginStatus | null>(null)
  const [confirming, setConfirming] = useState<Account | null>(null)
  const [deps, setDeps] = useState<{ ready?: boolean; phase?: string; message?: string; missing?: string[] } | null>(null)
  const live = useRef(true)
  const spaceRef = useRef(spaceId)
  const loginRef = useRef<LoginStatus | null>(null)
  const pollTimer = useRef<number | null>(null)
  const depsError = accountDepsError(deps)
  spaceRef.current = spaceId
  loginRef.current = login

  const applyGuard = (requestSpaceId: string) =>
    shouldApplyAccountResult({ requestSpaceId, currentSpaceId: spaceRef.current, live: live.current })

  const refresh = async (requestSpaceId = spaceId) => {
    const [p, a, d] = await Promise.all([
      postPlatformAccount(requestSpaceId, 'studio.accounts.platforms'),
      postPlatformAccount(requestSpaceId, 'studio.accounts.list'),
      postPlatformAccount(requestSpaceId, 'studio.runtime.deps').catch(() => null),
    ])
    if (!applyGuard(requestSpaceId)) return
    setPlatforms(p.items || [])
    setAccounts(a.items || [])
    if (d?.deps) setDeps(d.deps)
    else if (d) setDeps(d)
    setPlatform((current) => current || p.items?.[0]?.key || '')
  }

  const stopPoll = () => {
    if (pollTimer.current) { window.clearInterval(pollTimer.current); pollTimer.current = null }
  }

  const startPoll = (sessionId: string, requestSpaceId = spaceId) => {
    stopPoll()
    pollTimer.current = window.setInterval(() => {
      void postPlatformAccount(requestSpaceId, 'studio.accounts.login.poll', { sessionId })
        .then((v) => {
          if (!applyGuard(requestSpaceId)) return
          setLogin(v)
          if (v.item) setAccounts((prev) => {
            const others = prev.filter((x) => x.id !== v.item.id)
            return [v.item, ...others]
          })
          if (isLoginTerminalPhase(v.phase)) {
            stopPoll()
            void refresh(requestSpaceId).catch(() => {})
            if (v.phase === 'authorized') {
              // 已确认登录并保存授权：提示一下就自动收起，别让用户对着一扇不会自己走的窗。
              setNotice('已授权，登录态已保存到本机')
              window.setTimeout(() => {
                if (!applyGuard(requestSpaceId)) return
                setLogin(null)
                setAdding(false)
                setLabel('')
              }, 1600)
            }
          }
        })
        .catch((e) => { if (applyGuard(requestSpaceId)) setError(e instanceof Error ? e.message : '轮询失败') })
    }, LOGIN_POLL_INTERVAL_MS)
  }

  useEffect(() => {
    const requestSpaceId = spaceId
    live.current = true
    setError('')
    setNotice('')
    setLogin(null)
    setAdding(false)
    setLabel('')
    setPlatform('')
    setAccounts([])
    setBusy(true)
    void refresh(requestSpaceId)
      .catch((e) => { if (applyGuard(requestSpaceId)) setError(e instanceof Error ? e.message : '读取平台账号失败') })
      .finally(() => { if (applyGuard(requestSpaceId)) setBusy(false) })
    return () => {
      live.current = false
      stopPoll()
      const session = loginRef.current
      if (session && !isLoginTerminalPhase(session.phase) && session.sessionId) {
        void postPlatformAccount(requestSpaceId, 'studio.accounts.login.cancel', { sessionId: session.sessionId }).catch(() => {})
      }
    }
  }, [spaceId])

  const addAccount = async () => {
    if (!platform) { setError('请选择平台'); return null }
    const requestSpaceId = spaceId
    setBusy(true); setError(''); setNotice('')
    try {
      const v = await postPlatformAccount(requestSpaceId, 'studio.accounts.create', { platform, label: label || PLATFORM_LABEL[platform] || platform })
      if (!applyGuard(requestSpaceId)) return null
      setNotice('已添加账号。')
      setLabel('')
      setAdding(false)
      await refresh(requestSpaceId)
      return v.item as Account
    } catch (e) {
      if (applyGuard(requestSpaceId)) setError(e instanceof Error ? e.message : '添加失败')
      return null
    } finally {
      if (applyGuard(requestSpaceId)) setBusy(false)
    }
  }

  const loginAccount = async (account: Account) => {
    const requestSpaceId = spaceId
    setBusy(true); setError(''); setNotice(''); setAdding(false)
    try {
      const v = await postPlatformAccount(requestSpaceId, 'studio.accounts.login.start', { id: account.id, revision: account.revision })
      if (!applyGuard(requestSpaceId)) return
      setLogin({ ...v, ...(v.status || {}), sessionId: v.sessionId || v.status?.sessionId })
      setNotice(v.notice || '已启动登录会话')
      if (v.sessionId) startPoll(v.sessionId, requestSpaceId)
      await refresh(requestSpaceId)
    } catch (e) {
      if (applyGuard(requestSpaceId)) setError(e instanceof Error ? e.message : '无法启动登录')
    } finally {
      if (applyGuard(requestSpaceId)) setBusy(false)
    }
  }

  const cancelLogin = async (sessionId = login?.sessionId, requestSpaceId = spaceId) => {
    if (!sessionId) return
    setBusy(true)
    try {
      const v = await postPlatformAccount(requestSpaceId, 'studio.accounts.login.cancel', { sessionId })
      if (!applyGuard(requestSpaceId)) return
      setLogin(v)
      stopPoll()
      setNotice('已取消登录会话')
      await refresh(requestSpaceId)
    } catch (e) {
      if (applyGuard(requestSpaceId)) setError(e instanceof Error ? e.message : '取消失败')
    } finally {
      if (applyGuard(requestSpaceId)) setBusy(false)
    }
  }

  const closeAccountModal = () => {
    const requestSpaceId = spaceId
    const session = login
    setAdding(false)
    setLabel('')
    if (session && !isLoginTerminalPhase(session.phase) && session.sessionId) {
      setLogin(null)
      void cancelLogin(session.sessionId, requestSpaceId)
      return
    }
    if (session) setLogin(null)
  }

  const openAdd = () => {
    if (login && !isLoginTerminalPhase(login.phase)) return
    setLogin(null)
    setError('')
    setAdding(true)
  }

  /** 打开确认框；真正的移除走 confirmRemove。 */
  const removeAccount = (account: Account) => {
    if (busy) return
    setConfirming(account)
  }

  const cancelRemove = () => {
    if (busy) return
    setConfirming(null)
  }

  const confirmRemove = async () => {
    const account = confirming
    if (!account) return
    const requestSpaceId = spaceId
    setBusy(true); setError('')
    try {
      await postPlatformAccount(requestSpaceId, 'studio.accounts.remove', { id: account.id, revision: account.revision, confirm: true })
      if (!applyGuard(requestSpaceId)) return
      setConfirming(null)
      setNotice('已移除账号。')
      await refresh(requestSpaceId)
    } catch (e) {
      if (applyGuard(requestSpaceId)) setError(e instanceof Error ? e.message : '移除失败')
    } finally {
      if (applyGuard(requestSpaceId)) setBusy(false)
    }
  }

  const modalOpen = adding || !!login
  const modalTitle = login ? `登录 · ${accountStatusLabel(login.phase)}` : '添加账号'
  const bindSummary = accountBindSummary(accounts)

  return {
    platforms,
    accounts,
    platform,
    setPlatform,
    label,
    setLabel,
    adding,
    error,
    notice,
    busy,
    login,
    confirming,
    cancelRemove,
    confirmRemove,
    deps,
    depsError,
    modalOpen,
    modalTitle,
    bindSummary,
    setError,
    refresh,
    addAccount,
    loginAccount,
    cancelLogin,
    closeAccountModal,
    openAdd,
    removeAccount,
  }
}
