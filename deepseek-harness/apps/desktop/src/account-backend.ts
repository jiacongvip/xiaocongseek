/** Native account commands and Gateway state stream; no renderer receives credentials. */
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { parseRemoteStreamServerMessage, REMOTE_STREAM_MUX_PATH } from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import type { AccountClientMetadata, AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'

/** Authenticated unary caller shared with native onboarding. */
export type AccountInvoke = (request: { namespace: string; method: string; args: Record<string, unknown> }) => Promise<unknown>

/** Decode the UI-safe state received across HTTP or WebSocket. @param value - wire value. @returns account projection. */
export function accountView(value: unknown): AccountView {
  if (typeof value !== 'object' || value === null || !('status' in value)
    || !['signed-out', 'credential-stored'].includes(String(value.status)) || !('attempt' in value)) {
    throw new Error('desktop account: invalid state')
  }
  if (!('links' in value) || typeof value.links !== 'object' || value.links === null
    || !('usageUrl' in value.links) || typeof value.links.usageUrl !== 'string'
    || !('topUpUrl' in value.links) || typeof value.links.topUpUrl !== 'string') {
    throw new Error('desktop account: invalid platform links')
  }
  validateBrowserDestination(value.links.usageUrl)
  validateBrowserDestination(value.links.topUpUrl)
  const attempt = value.attempt
  if (attempt !== null && (typeof attempt !== 'object' || !('id' in attempt) || typeof attempt.id !== 'string'
    || !('phase' in attempt) || !['initializing', 'waiting-browser', 'exchanging', 'committing', 'succeeded', 'cancelled', 'expired', 'failed'].includes(String(attempt.phase))
    || ('authorizeUrl' in attempt && typeof attempt.authorizeUrl !== 'string')
    || ('expiresAt' in attempt && (typeof attempt.expiresAt !== 'number' || !Number.isFinite(attempt.expiresAt)))
    || ('errorCode' in attempt && !['no-response', 'network', 'protocol', 'expired', 'storage'].includes(String(attempt.errorCode))))) {
    throw new Error('desktop account: invalid attempt')
  }
  if (attempt !== null && 'authorizeUrl' in attempt) {
    validateBrowserDestination(String(attempt.authorizeUrl))
  }
  const parsed = value as AccountView
  return {
    status: parsed.status,
    links: { usageUrl: parsed.links.usageUrl, topUpUrl: parsed.links.topUpUrl },
    attempt: parsed.attempt === null ? null : {
      id: parsed.attempt.id, phase: parsed.attempt.phase,
      ...parsed.attempt.authorizeUrl === undefined ? {} : { authorizeUrl: parsed.attempt.authorizeUrl },
      ...parsed.attempt.expiresAt === undefined ? {} : { expiresAt: parsed.attempt.expiresAt },
      ...parsed.attempt.errorCode === undefined ? {} : { errorCode: parsed.attempt.errorCode },
    },
  }
}

/** Only HTTP loopback or HTTPS destinations can leave the native app. */
function validateBrowserDestination(value: string): void {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || !(url.protocol === 'https:' || (loopback && url.protocol === 'http:'))) {
    throw new Error('desktop account: invalid browser destination')
  }
}

/** Native account operations and explicitly owned stream lifetime. */
export interface DesktopAccountBackend {
  /** @returns current account snapshot. */
  state(): Promise<AccountView>
  /** @param client - this window's identity and current language. @returns new or already-running login attempt. */
  start(client: AccountClientMetadata): Promise<AccountView>
  /** @param id - attempt to cancel. @returns cancellation or completed commit state. */
  cancel(id: SignInAttemptId): Promise<AccountView>
  /** @param client - this window's identity. @returns state after local sign-out. */
  signOut(client: AccountClientMetadata): Promise<AccountView>
  /**
   * @param listener - state recipient.
   * @param failed - stream failure recipient.
   * @param expired - live credential-expiry recipient.
   * @param onAnalyticsEnabledChanged - optional Desktop collection-policy recipient; disconnected streams publish false.
   * @returns stream disposer.
   */
  watch(
    listener: (state: AccountView) => void, failed: () => void, expired: () => void,
    onAnalyticsEnabledChanged?: (enabled: boolean) => void,
  ): () => void
}

/**
 * Connect native account operations to the standard authenticated Web backend.
 * @param origin - Host Web origin.
 * @param invoke - validated unary RPC caller.
 * @param cookie - Host authentication Cookie header for the account WebSocket.
 * @returns account operations; watch callers own their subscriptions.
 */
export function desktopAccountBackend(origin: string, invoke: AccountInvoke, cookie: string): DesktopAccountBackend {
  const call = async (method: string, args: Record<string, unknown> = {}): Promise<AccountView> =>
    accountView(await invoke({ namespace: 'account', method, args }))
  // Shell-owned Xiaocong sign-in. The desktop welcome page speaks to the harness' own
  // /auth/xiaocong routes, so a missing, inactive or crashing digital-human-studio plugin
  // can never break the login path. Platform links stay on the loopback Host.
  const links = { usageUrl: `${origin}/`, topUpUrl: `${origin}/` }
  const accountListeners = new Set<(state: AccountView) => void>()
  let xiaocongPoll: ReturnType<typeof setInterval> | undefined
  let xiaocongAttemptId: SignInAttemptId | undefined
  const stopXiaocongPoll = (): void => {
    if (xiaocongPoll !== undefined) clearInterval(xiaocongPoll)
    xiaocongPoll = undefined
  }
  const xiaocongTokenStored = async (): Promise<boolean> => {
    try {
      const response = await fetch(new URL('/auth/xiaocong/status', origin).href, { headers: { cookie } })
      if (!response.ok) return false
      const status: unknown = await response.json()
      return typeof status === 'object' && status !== null
        && (status as { success?: unknown }).success === true
        && (status as { hasToken?: unknown }).hasToken === true
    } catch {
      return false
    }
  }
  const startXiaocongPoll = (id: SignInAttemptId): void => {
    stopXiaocongPoll()
    xiaocongAttemptId = id
    const deadline = Date.now() + 10 * 60 * 1000
    xiaocongPoll = setInterval(() => {
      void xiaocongTokenStored().then((stored) => {
        if (xiaocongAttemptId !== id) return
        if (!stored) {
          if (Date.now() > deadline) stopXiaocongPoll()
          return
        }
        stopXiaocongPoll()
        const settled: AccountView = { status: 'credential-stored', links, attempt: { id, phase: 'succeeded' } }
        for (const listener of accountListeners) listener(settled)
      }).catch(() => undefined)
    }, 2000)
  }
  const xiaocongAuthorizeUrl = (): string => {
    // The shell names the window first: the console only returns its token to a
    // window called `dsh-newapi-login`, which an external browser cannot be given directly.
    const url = new URL('/auth/xiaocong/bootstrap', origin)
    url.searchParams.set('return', `${origin}/`)
    return url.href
  }
  return {
    state: async () => {
      const base = await call('getState')
      if (xiaocongAttemptId === undefined) return base
      return {
        ...base,
        attempt: { id: xiaocongAttemptId, phase: 'waiting-browser', authorizeUrl: xiaocongAuthorizeUrl(), expiresAt: Date.now() + 10 * 60 * 1000 },
      }
    },
    start: async () => {
      const id = randomUUID() as SignInAttemptId
      startXiaocongPoll(id)
      const view = {
        status: 'signed-out',
        links,
        attempt: { id, phase: 'waiting-browser', authorizeUrl: xiaocongAuthorizeUrl(), expiresAt: Date.now() + 10 * 60 * 1000 },
      } as AccountView
      // Local starts never surface on the remote account stream, so notify the
      // watchers here: the desktop shell listens for `waiting-browser` to open
      // the login page in the system browser.
      for (const listener of accountListeners) listener(view)
      return view
    },
    cancel: async () => {
      stopXiaocongPoll()
      xiaocongAttemptId = undefined
      return { status: 'signed-out', links, attempt: null }
    }, signOut: client => call('signOut', { client }),
    watch(listener, failed, expired, onAnalyticsEnabledChanged) {
      accountListeners.add(listener)
      let closed = false
      let socket: WebSocket | undefined
      let retry: ReturnType<typeof setTimeout> | undefined
      const connect = (): void => {
        const streamId = randomUUID()
        const expiryStreamId = randomUUID()
        const analyticsPolicyStreamId = randomUUID()
        const url = new URL(REMOTE_STREAM_MUX_PATH, origin)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        socket = new WebSocket(url, { headers: { cookie, origin }, maxPayload: 65_536 })
        socket.on('open', () => {
          if (onAnalyticsEnabledChanged !== undefined) socket?.send(JSON.stringify({ type: 'open', streamId: analyticsPolicyStreamId, endpoint: 'productAnalytics/watchPolicy', payload: { args: {} } }))
          socket?.send(JSON.stringify({ type: 'open', streamId: expiryStreamId, endpoint: 'account/watchExpiry', payload: { args: {} } }))
          socket?.send(JSON.stringify({ type: 'open', streamId, endpoint: 'account/watch', payload: { args: {} } }))
        })
        socket.on('message', (data) => {
          try {
            const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
            const frame = parseRemoteStreamServerMessage(bytes.toString('utf8'))
            if (frame.streamId === analyticsPolicyStreamId) {
              if (frame.type === 'item' && typeof frame.value === 'boolean') onAnalyticsEnabledChanged?.(frame.value)
              else onAnalyticsEnabledChanged?.(false)
              return
            }
            if (frame.streamId === expiryStreamId && frame.type === 'item' && frame.value === 'session-expired') { expired(); return }
            if (frame.streamId !== streamId) throw new Error('desktop account: unexpected stream')
            if (frame.type === 'item') listener(accountView(frame.value))
            else socket?.close()
          } catch { socket?.close() }
        })
        socket.on('error', () => { socket?.close() })
        socket.on('close', () => { if (!closed) { onAnalyticsEnabledChanged?.(false); failed(); retry = setTimeout(connect, 1000) } })
      }
      connect()
      return () => {
        closed = true
        accountListeners.delete(listener)
        onAnalyticsEnabledChanged?.(false)
        clearTimeout(retry)
        socket?.close()
      }
    },
  }
}
