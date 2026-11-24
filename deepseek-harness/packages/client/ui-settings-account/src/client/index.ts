// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
/** Account settings registration and reconnecting Remote subscription. */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type { TranscriptViewMode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-api-job-controller/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { AccountView, AccountDetails, AccountWallet, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { OnboardingChange } from './onboarding-contract.ts'
import type { PlatformBridge } from './PlatformOverlay.tsx'
import { ContactConfig, CONTACT_CONFIG_GLOBAL } from '../contact-config.ts'
import { contactUrl } from './contact-url.ts'
import { authorizeUrlWithTheme } from './authorize-url.ts'
import { BrowserLogin } from './browser-login.ts'
import { AccountOnboarding } from './AccountOnboarding.tsx'
import { AccountPlatformHost, type AccountPlatformHostInjected } from './AccountPlatformHost.tsx'
import { AccountMenu } from './AccountMenu.tsx'
import { createPlatformPages, type PlatformPages } from './platform-pages.ts'
import { AccountSection, type AccountSnapshot, type AccountSectionInjected } from './AccountSection.tsx'
import { createBonusNoticeController } from './bonus-notices.ts'
import { accountClientMetadata } from './client-metadata.ts'
import { en, ja, es, fr, de, ru, pt, zh, type AccountKey } from './locales.ts'
import { AccountQuotaNotice, type AccountQuotaNoticeInjected } from './AccountQuotaNotice.tsx'
import { DESKTOP_ONBOARDING_NAMESPACE, type OnboardingSettings } from '../onboarding-settings.ts'
import { DesktopOnboardingController } from './onboarding-state.ts'
import { DesktopOnboardingEntry, type DesktopOnboardingInjected } from './DesktopOnboardingEntry.tsx'
import { readOnboardingApiKeyPresence } from './onboarding-credentials.ts'
import { refreshAfterReturn } from './account-refresh.ts'
import { AccountAvatarLoader } from './account-avatar.ts'
import { DigitalHumanPanel, DigitalHumanPanelIcon } from './DigitalHumanPanel.tsx'
import { DigitalHumanChatCard } from './DigitalHumanChatCard.tsx'
import { DigitalHumanCiteDock } from './DigitalHumanCiteDock.tsx'
import { DigitalHumanComposerButton } from './DigitalHumanComposerButton.tsx'
import { DigitalHumanCompanyPicker } from './DigitalHumanCompanyPicker.tsx'
import { DigitalHumanUserCite } from './DigitalHumanUserCite.tsx'
import { DEFAULT_XIAOCONG_API_ORIGIN, xiaocongApiOrigin, xiaocongApiSiteLinks } from './xiaocong-api-site.ts'
import { appendDigitalHumanCitesToDraft, bindDigitalHumanCommand, queueDigitalHumanShow } from './digital-human-chat-send.ts'
import { digitalHumanCiteRule } from './digital-human-user-text.ts'
import {
  ConversationDigest, ConversationDigestButton, ConversationDigestTitle, conversationDigestDefinition,
  CONVERSATION_DIGEST_ID, CONVERSATION_DIGEST_KIND, type ConversationDigestInjected,
} from './ConversationDigest.tsx'
export type { AccountSectionInjected, AccountSectionProps } from './AccountSection.tsx'
export type { AccountMenuProps } from './AccountMenu.tsx'
export type { AccountSnapshot } from './AccountSection.tsx'
export type { AccountKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.account': AccountKey }
}

/** Services required by account settings. */
export const inject = ['slots', 'locale', 'remote', 'remote.account', 'remote.session', 'remote.commands', 'theme', 'configForms', 'remoteAccess', 'layout', 'uiConversation', 'uiWorkspace', 'sessions', 'conversation', 'sidebarRight', 'sidebarRightTabs', 'jobs']
/** Register account UI in Desktop and plain Web clients. @param ctx - client plugin context. */
export function apply(ctx: Context): void {
  const desktop = 'dshDesktop' in globalThis
  ctx.effect(() => ctx.locale.register('settings.account', { en, zh, ja, es, fr, de, ru, pt }), 'account: dictionaries')
  bindDigitalHumanCommand(async (sessionId, line) => {
    const result = await ctx.remote.commands.execute(sessionId as never, line, [])
    if (!result.ok) return { ok: false, error: result.error.message }
    if (result.value === undefined) return { ok: false, error: '当前对话还不支持口播成片' }
    const outcome = result.value.result
    if (outcome?.kind === 'error') return { ok: false, error: outcome.text || '发送失败' }
    return { ok: true, ...(outcome?.text ? { text: outcome.text } : {}) }
  })
  // Fork: a global digital human panel that talks to XiaocongAPI through digital-human-studio.
  const DigitalHumanMainPanel = () => createElement(DigitalHumanPanel, {
    sendToChat: payload => {
      queueDigitalHumanShow(payload)
      ctx.layout.selectPanel(null)
    },
    // 成片页「写文案」：新开一个 AI 对话并把提示词直接发过去，不在面板里本地生成
    askAi: async (prompt: string) => {
      const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
      const nav = (ctx as any).get?.('uiWorkspace')
      const workspaces = (ctx as any).get?.('workspaces')
      if (!nav?.startSession) throw new Error('当前环境不支持新建对话')
      const visibleEditors = () => ([...document.querySelectorAll('[contenteditable="true"]')] as HTMLElement[])
        .filter(e => e.offsetParent !== null && e.getBoundingClientRect().height > 0)
      const items = workspaces?.list?.getSnapshot?.().items ?? []
      let currentId: string | undefined
      try { currentId = JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}').sessionId } catch {}
      const target = items.find((item: any) => currentId && item.sessionIds?.includes(currentId))?.workspaceId
        ?? items[0]?.workspaceId
      // 开新会话（不带 prompt，官方的草稿初始化在这里拿不到会话服务）
      const beforeId = (nav as any).mainReference?.sessionId ?? currentId
      ctx.layout.selectPanel(null)
      await wait(150)
      nav.startSession(target)
      // 必须等主会话真的切走（或已经停在空白新会话），否则提示词会写进旧对话
      let sessionId: string | undefined
      for (let i = 0; i < 90; i++) {
        const id = (nav as any).mainReference?.sessionId
        const blank = document.body.innerText.includes('探索未至之境')
        if (id && (id !== beforeId || blank)) { sessionId = id; break }
        await wait(150)
      }
      if (!sessionId) throw new Error('新对话没打开，请再点一次')
      await wait(500)
      const editor = visibleEditors()[0]
      if (!editor) throw new Error('新对话的输入框没出现，请再点一次')
      // 用会话作用域拿到输入台，整段替换草稿（不发送）
      const conversation = (ctx as any).get?.('conversation')
      let mode = 'none'
      try {
        const binding = (ctx as any).get?.('sessions')?.binding?.(sessionId)
        if (conversation?.input?.for && binding?.ctx) {
          const input = conversation.input.for(binding.ctx)
          input.setDraft(prompt)
          mode = 'setDraft'
        }
      } catch {
        mode = 'error'
      }
      if (mode !== 'setDraft') {
        editor.focus()
        const data = new DataTransfer()
        data.setData('text/plain', prompt)
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      }
      const marker = prompt.slice(0, 24)
      for (let i = 0; i < 20; i++) {
        if (editor.innerText.includes(marker)) return true
        await wait(150)
      }
      throw new Error('提示词没写进输入框，请再点一次')
    },
  })

  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'digital-human' }, DigitalHumanMainPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: 'digital-human', order: 30, label: '工作台' },
    DigitalHumanPanelIcon,
  ))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register(
    { name: 'conversation.chat.commandview', key: 'dh' },
    DigitalHumanChatCard,
  ))
  ctx.slots.inject('conversation.hero.options', () => ctx.slots.register(
    { name: 'conversation.hero.options', id: 'digital-human-company', order: 20, label: '公司' },
    (props) => createElement(DigitalHumanCompanyPicker, { ...props, tone: 'hero' }),
  ))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'digital-human-company', order: 30, label: '公司' },
    (props) => createElement(DigitalHumanCompanyPicker, { ...props, tone: 'composer' }),
  ))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'digital-human', order: 40, label: '口播成片' },
    DigitalHumanComposerButton,
  ))
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register(
    { name: 'conversation.input.overlay', id: 'digital-human-cite', order: 50 },
    DigitalHumanCiteDock,
  ))
  ctx.effect(() => ctx.uiConversation.userText.register(digitalHumanCiteRule), 'account: digital-human user-text')
  ctx.effect(() => ctx.uiConversation.registerSubmitHook((draft, sessionId) => (
    appendDigitalHumanCitesToDraft(draft, sessionId)
  )), 'account: digital-human submit hook')
  ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register(
    { name: 'conversation.user.text.node', key: 'xdh', priority: 100 },
    DigitalHumanUserCite,
  ))
  ctx.effect(() => ctx.sidebarRightTabs.register(conversationDigestDefinition()), 'account: conversation digest type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab', key: CONVERSATION_DIGEST_ID,
      inject: (sessionId): ConversationDigestInjected => ({
        hooks: { jobs: ctx.jobs.state },
        watchRows: id => ctx.jobs.watchRows(id),
        openDigitalHuman: () => { ctx.layout.selectPanel('digital-human' as never) },
        openFiles: () => {
          if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded()
          ctx.sidebarRight.openTabIn(sessionId, 'files')
        },
      }),
    },
    ConversationDigest,
  )), 'account: conversation digest body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: CONVERSATION_DIGEST_ID },
    ConversationDigestTitle,
  )), 'account: conversation digest title')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'conversation-digest',
    order: 12,
    inject: (sessionId) => ({
      openDigest: () => {
        ctx.sidebarRight.openTabIn(sessionId, CONVERSATION_DIGEST_KIND)
      },
    }),
  }, ConversationDigestButton))
  const t = ctx.locale.bind('settings.account')
  const page = globalThis as Partial<Record<typeof CONTACT_CONFIG_GLOBAL, unknown>>
  const config = ContactConfig(page[CONTACT_CONFIG_GLOBAL] ?? {})
  let snapshot: AccountSnapshot = {
    view: undefined, details: undefined, avatar: undefined, failed: false, loginVisible: false, desktopOnboardingVisible: desktop,
  }
  /** Fork: New API sk- claim overrides shell signed-in until DeepSeek account stream says otherwise. */
  let newApiSignedIn: { username: string } | null = null
  let xiaocongApiBase = DEFAULT_XIAOCONG_API_ORIGIN
  const siteLinks = () => xiaocongApiSiteLinks(xiaocongApiBase)
  const rememberXiaocongOrigin = (baseUrl: unknown) => {
    if (typeof baseUrl === 'string' && baseUrl.trim()) xiaocongApiBase = xiaocongApiOrigin(baseUrl)
  }

  // Desktop main opens the authorization page natively; a plain browser opens it in a tab it owns.
  const browser = new BrowserLogin(url => authorizeUrlWithTheme(url, ctx.theme.getTheme().active.colorScheme))
  ctx.effect(() => () => { browser.dispose() }, 'account: pending browser window')
  const listeners = new Set<() => void>()
  const publish = (value: AccountSnapshot) => { snapshot = value; for (const listener of listeners) listener() }
  /** Fork: the XiaocongAPI site balance for the stored sk- key; null keeps the previous read.
   * @returns the wallet the shell renders, or null when the studio route cannot answer.
   */
  const readNewApiBalance = async (): Promise<AccountWallet[] | null> => {
    try {
      const response = await fetch('/digital-human-studio/account/balance', { headers: { accept: 'application/json' } })
      if (!response.ok) return null
      const body = await response.json() as {
        success?: unknown
        account?: { currency?: unknown; available?: unknown }
      }
      const { currency, available } = body.account ?? {}
      if (body.success !== true || (currency !== 'CNY' && currency !== 'USD')) return null
      if (typeof available !== 'string' || available === '') return null
      return [{ currency, balance: available }]
    } catch { return null }
  }
  /** Fork: publish that balance once a XiaocongAPI session owns the account state. */
  const refreshNewApiBalance = async (): Promise<void> => {
    if (newApiSignedIn === null) return
    const wallets = await readNewApiBalance()
    if (newApiSignedIn === null || wallets === null || snapshot.view?.status !== 'credential-stored') return
    publish({
      ...snapshot,
      details: { ...snapshot.details, balance: { status: 'ready', value: wallets, bonusWallets: [] } },
    })
  }
  const avatar = new AccountAvatarLoader((value) => { publish({ ...snapshot, avatar: value }) })
  ctx.effect(() => () => { avatar.dispose() }, 'account: profile picture lifetime')
  /** @returns the client identity for one account call, read at call time so it carries the language and zone in effect then. */
  const client = () => accountClientMetadata(ctx.locale.getSnapshot().active, process.env.DSH_CLIENT_VERSION)
  // The browser half of the notice lifecycle: reads when the account becomes
  // active and on an explicit refresh, and acknowledges an order only after its
  // card reports a presented frame. The Host owns which bonus is unnotified and
  // the server owns the copy.
  const notices = createBonusNoticeController({
    ackRetryDelayMs: config.bonusAckRetryDelayMs,
    ackRetryMaxDelayMs: config.bonusAckRetryMaxDelayMs,
    read: async () => {
      const result = await ctx.remote.account.getUnnotifiedBonuses(client())
      if (!result.ok) throw new Error('account bonus read failed')
      return result.value
    },
    acknowledge: async (accountId, orderId) => {
      const result = await ctx.remote.account.ackBonusNotified(accountId, orderId, client())
      if (!result.ok) throw new Error('account bonus acknowledgement failed')
      return result.value
    },
    publish: (notices) => {
      const { notices: _replaced, ...withoutNotices } = snapshot
      publish(notices.length === 0 ? withoutNotices : { ...withoutNotices, notices })
    },
  })
  ctx.effect(() => () => { notices.end() }, 'account: bonus notice lifetime')
  let revision = 0
  let refreshing: Promise<void> | undefined
  const refresh = (): Promise<void> => {
    if (snapshot.view?.status !== 'credential-stored') return Promise.resolve()
    if (refreshing !== undefined) return refreshing
    const generation = revision
    const read = async <K extends keyof AccountDetails>(field: K,
      query: () => Promise<AccountDetails[K] | null>) => {
      let value: AccountDetails[K] | null
      try { value = await query() }
      catch { value = { status: 'failed' } }
      if (value?.status === 'failed') console.error('[deepseek-account] account read failed', { field })
      if (generation === revision && value !== null) publish({ ...snapshot, details: { ...snapshot.details, [field]: value } })
    }
    const request = Promise.all([
      read('profile', async () => {
        // The DeepSeek Platform never owns a XiaocongAPI session; keep its profile.
        if (newApiSignedIn !== null) return null
        const result = await ctx.remote.account.getProfile(client())
        if (!result.ok) throw new Error('account profile failed')
        if (generation === revision && result.value?.status === 'ready') avatar.setUrl(result.value.value.avatarUrl)
        return result.value
      }),
      read('balance', async () => {
        if (newApiSignedIn !== null) {
          const wallets = await readNewApiBalance()
          return wallets === null ? null : { status: 'ready' as const, value: wallets, bonusWallets: [] }
        }
        const result = await ctx.remote.account.getBalance(client())
        if (!result.ok) throw new Error('account balance failed')
        return result.value
      }),
    ]).then(() => undefined)
    refreshing = request
    void request.finally(() => { if (refreshing === request) refreshing = undefined })
    return request
  }
  ctx.effect(() => () => { revision++ }, 'account: details request lifetime')
  // The account stream, and the reads it starts, follow access to this host's account state.
  ctx.remoteAccess.whenAccess('account/watch', function* () {
    const stream = ctx.remote.$stream<AccountView>({
      name: 'account', open: signal => ctx.remote.account.watch(signal), ended: () => new Error('account stream ended'),
    })
    // Read across closures: the disposer ends this grant while the frame loop awaits.
    const grant = { ended: false }
    // Withdrawing access invalidates the reads this grant started, closes the
    // pending authorization tab, and clears the account view and the sign-in
    // dialog state, synchronously, so the next grant starts from no account
    // state. `notices.end()` disposes this generation's notice lifetime, which a
    // frame of this stream begins; the notice controller stays outside and
    // begins again under the next grant.
    yield () => {
      grant.ended = true
      revision++
      refreshing = undefined
      avatar.reset()
      browser.dispose()
      const { loginFailed: _loginFailed, ...current } = snapshot
      publish({ ...current, view: undefined, details: undefined, avatar: undefined, failed: false, loginVisible: false })
      notices.end()
      return stream.dispose()
    }
    void (async () => {
      for await (const frame of stream) {
        // A frame the stream delivered before the revocation is not this grant's to apply.
        if (grant.ended) return
        revision++
        refreshing = undefined
        avatar.reset()
        const initialize = frame.value.status === 'credential-stored' && frame.value.attempt?.phase === 'succeeded'
          && snapshot.view?.attempt?.phase !== 'succeeded'
        const { notices: previousNotices, ...previous } = snapshot
        if (newApiSignedIn) {
          publish({
            ...previous,
            view: {
              status: 'credential-stored',
              links: siteLinks(),
              attempt: { id: 'newapi-local-claim' as SignInAttemptId, phase: 'succeeded' },
            },
            details: {
              profile: {
                status: 'ready',
                value: { id: null, name: newApiSignedIn.username, contact: newApiSignedIn.username },
              },
              balance: previous.details?.balance?.status === 'ready'
                ? previous.details.balance
                : { status: 'failed' },
            },
            avatar: undefined,
            failed: false,
            ...(previousNotices ? { notices: previousNotices } : {}),
          })
          void refreshNewApiBalance()
        } else {
          publish({ ...previous, view: frame.value, details: undefined, avatar: undefined, failed: false,
            ...(frame.value.status === 'credential-stored' && previousNotices ? { notices: previousNotices } : {}) })
        }
        browser.update(frame.value)
        frame.accept()
        if (frame.value.status === 'credential-stored') notices.begin()
        else notices.end()
        if (initialize) void (async () => {
          try {
            const initialized = await ctx.remote.session.initializeDefaultModel()
            if (!initialized.ok) console.error('[deepseek-account] default model initialization failed', { reason: 'refused' })
          } catch (_error) {
            console.error('[deepseek-account] default model initialization failed', { reason: 'disconnected' })
          }
        })()
        void refresh()
      }
    })().catch(() => { if (!grant.ended) publish({ ...snapshot, failed: true }) })
  })
  const nativePlatform = (globalThis as typeof globalThis & { dshPlatform?: PlatformBridge }).dshPlatform
  // One request channel for the single native Platform view. It always exists
  // so every entry can observe whether a page is showing; only a native bridge
  // lets an entry request one.
  const platformPages = createPlatformPages()
  ctx.effect(() => () => { platformPages.dispose() }, 'account: platform page request')
  // One account refresh: the recharge/bonus wallet and the unnotified-bonus read,
  // whichever surface asks — a Settings entry, or returning from top-up. Both
  // reads are independent, and a concurrent refresh shares the in-flight request.
  const refreshAccount = async (): Promise<void> => {
    avatar.retry()
    await Promise.all([refresh(), notices.refresh()])
  }
  /**
   * Narrow the shared channel to one surface's post-return read: only a viewer
   * returning from top-up re-reads, so a superseded page or a plugin teardown
   * never triggers account work.
   * @param reRead - that surface's read after a returned top-up page.
   * @returns the opener that surface injects.
   */
  const platformPageOpener = (reRead: () => Promise<void>): PlatformPages['open'] =>
    (page, onClose) => platformPages.open(page, (reason) => {
      onClose(reason)
      if (reason === 'returned' && page === 'top-up') void refreshAfterReturn(refreshing, reRead)
    })
  const operations: AccountSectionInjected = {
    avatarFailed: (value) => { avatar.failed(value) },
    subscribeSessionExpired: listener => ctx.remote.$on('deepseek-account/session-expired', listener),
    subscribeModelSignInRequired: listener => ctx.remote.$on('deepseek-account/model-sign-in-required', listener),
    ...nativePlatform === undefined ? {} : { openPlatformPage: platformPageOpener(refreshAccount) },
    refreshAccount,
    contactUs() {
      // Sample the account, build and environment before awaiting native information, so
      // a profile the read outlasts cannot replace the UID this click reported.
      const profile = snapshot.details?.profile
      const context = {
        uid: profile?.status === 'ready' ? profile.value.id : null,
        version: process.env.DSH_CLIENT_VERSION,
        width: window.screen.width, height: window.screen.height, pixelRatio: window.devicePixelRatio,
      }
      const openForm = (deviceInfo: string): void => {
        window.open(contactUrl(config, { ...context, deviceInfo }), '_blank', 'noopener,noreferrer')
      }
      const readDeviceInfo = (globalThis as typeof globalThis & {
        dshDesktop?: { deviceInfo?: () => Promise<string> }
      }).dshDesktop?.deviceInfo
      if (readDeviceInfo === undefined) {
        // A plain browser, or a Desktop bridge without the optional reader, reports the renderer user agent.
        openForm(navigator.userAgent)
        return
      }
      void (async () => {
        let deviceInfo = ''
        try { deviceInfo = await readDeviceInfo() }
        catch (_error) {
          // Native information is optional; the questionnaire opens without it.
        }
        openForm(deviceInfo)
      })()
    },
    showLogin(visible) {
      publish({ ...snapshot, loginVisible: visible, ...(visible ? {} : { loginSuccessVisible: false }) })
    },
    setOnboarding(active) { publish({ ...snapshot, onboarding: active }) },
    bonusNoticeShown(orderId) { notices.shown(orderId) },
    bonusNoticeDismissed(orderId) { notices.dismiss(orderId) },
    hooks: {
      account: {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      theme: {
        getSnapshot: () => ctx.theme.getTheme(),
        subscribe: listener => ctx.on('theme/change', listener),
      },
    },
    async start() {
      // Fork: always open Honey /auth/authorize in the same browser.
      // No session → authorize page sends XiaocongAPI /login?redirect=... then auto-claims on return.
      // Session cookie present → user confirms 登录 → claim → /auth/authorized.
      const links = siteLinks()
      const attemptId = 'newapi-local-claim' as SignInAttemptId
      let newApiPopup: Window | null = null
      let authorizedShown = false
      let claimedFromPopup = false
      let claimedUsername: string | undefined
      const returnTarget = window.location.origin + '/'
      const authorizedHref = () => {
        const authorized = new URL('/auth/xiaocong/authorized', window.location.origin)
        authorized.searchParams.set('return', returnTarget)
        return authorized.toString()
      }
      const authorizeHref = () => {
        // The console only appends `dsh_access_token` to the legacy approve path,
        // so the shell serves that same path when the workspace plugin is absent.
        // No `auto` here: a first visit falls through to the console sign-in page.
        const authorize = new URL('/digital-human-studio/auth/authorize', window.location.origin)
        authorize.searchParams.set('return', returnTarget)
        return authorize.toString()
      }
      const openPopup = (href: string) => {
        try {
          if (newApiPopup && !newApiPopup.closed) newApiPopup.location.replace(href)
          else newApiPopup = window.open(href, 'dsh-newapi-login')
        } catch {
          try { newApiPopup = window.open(href, 'dsh-newapi-login') } catch { /* ignore */ }
        }
      }
      const showAuthorizedPage = () => {
        if (authorizedShown) return
        authorizedShown = true
        openPopup(authorizedHref())
      }
      const finishSuccess = (username?: string) => {
        newApiSignedIn = { username: username || 'XiaocongAPI' }
        showAuthorizedPage()
        try { window.focus() } catch { /* ignore */ }
        publish({
          ...snapshot,
          loginVisible: false,
          loginFailed: false,
          loginSuccessVisible: true,
          view: {
            status: 'credential-stored',
            links,
            attempt: { id: attemptId, phase: 'succeeded' },
          },
          details: {
            profile: {
              status: 'ready',
              value: { id: null, name: newApiSignedIn.username, contact: username || null },
            },
            balance: { status: 'failed' },
          },
        })
        void refreshNewApiBalance()
      }
      const hasSessionCookie = () => {
        try {
          return /(?:^|;\s*)new_api_has_session=/.test(document.cookie)
        } catch { return false }
      }
      const onClaimedMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return
        if (!event.data || event.data.type !== 'dsh-newapi-claimed') return
        claimedFromPopup = true
        if (typeof event.data.username === 'string' && event.data.username) {
          claimedUsername = event.data.username
        }
      }
      window.addEventListener('message', onClaimedMessage)
      try {
        // Local sk- already present (rare after logout) → reuse without New API round-trip.
        try {
          const statusRes = await fetch('/auth/xiaocong/status')
          const status = await statusRes.json().catch(() => null)
          rememberXiaocongOrigin(status?.baseUrl)
          if (status?.hasToken) {
            await fetch('/auth/xiaocong/claim', {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
            })
            finishSuccess(typeof status.username === 'string' ? status.username : undefined)
            return
          }
        } catch { /* continue */ }

        const hadSessionAtStart = hasSessionCookie()
        const expiresAt = Date.now() + 180_000
        const waitingUrl = authorizeHref()
        publish({
          ...snapshot,
          loginVisible: true,
          loginFailed: false,
          view: {
            status: snapshot.view?.status === 'credential-stored' ? 'credential-stored' : 'signed-out',
            links: snapshot.view?.links ?? links,
            attempt: { id: attemptId, phase: 'waiting-browser', authorizeUrl: waitingUrl, expiresAt },
          },
        })

        try {
          const open = (globalThis as typeof globalThis & { dshDesktop?: { openExternal?: (url: string) => Promise<void> } }).dshDesktop?.openExternal
          if (open) await open(waitingUrl)
          else openPopup(waitingUrl)
        } catch (error) {
          publish({ ...snapshot, loginVisible: true, loginFailed: true, loginSuccessVisible: false })
          throw error
        }

        if (hadSessionAtStart) {
          // Authorize page owns the single refresh + claim; harness only waits for result.
          while (Date.now() < expiresAt) {
            if (claimedFromPopup) {
              finishSuccess(claimedUsername)
              return
            }
            try {
              const statusRes = await fetch('/auth/xiaocong/status')
              const status = await statusRes.json().catch(() => null)
              rememberXiaocongOrigin(status?.baseUrl)
              if (status?.hasToken) {
                finishSuccess(typeof status.username === 'string' ? status.username : claimedUsername)
                return
              }
            } catch { /* continue */ }
            await new Promise(resolve => setTimeout(resolve, 400))
          }
        } else {
          // Fresh login path: cookie poll local; one refresh+claim when session appears.
          let refreshBackoffUntil = 0
          let nextRefreshAt = 0
          let sawSessionCookie = false
          const REFRESH_IDLE_MS = 12_000
          const tryClaimAfterLogin = async (forceRefresh: boolean): Promise<boolean> => {
            try {
              const statusRes = await fetch('/auth/xiaocong/status')
              const status = await statusRes.json().catch(() => null)
              rememberXiaocongOrigin(status?.baseUrl)
              if (status?.hasToken) {
                finishSuccess(typeof status.username === 'string' ? status.username : undefined)
                return true
              }
            } catch { /* continue */ }
            if (Date.now() < refreshBackoffUntil) return false
            if (!forceRefresh && Date.now() < nextRefreshAt) return false
            nextRefreshAt = Date.now() + REFRESH_IDLE_MS
            try {
              const refresh = await fetch('/auth/xiaocong/refresh', {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json' },
              })
              if (refresh.status === 429) {
                const retryAfter = Number(refresh.headers.get('retry-after') || 60)
                refreshBackoffUntil = Date.now() + Math.max(30, retryAfter) * 1000
                return false
              }
              if (!refresh.ok) return false
              const payload = await refresh.json().catch(() => null)
              const data = payload?.data || payload || {}
              const access = data.access_token || data.token
              const user = data.user || data
              if (!access || !user?.id) return false
              showAuthorizedPage()
              const claimRes = await fetch('/auth/xiaocong/claim', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  accessToken: access,
                  userId: user.id,
                  username: user.username,
                }),
              })
              const claimed = await claimRes.json().catch(() => null)
              if (claimed?.success && claimed?.hasToken) {
                finishSuccess(typeof claimed.username === 'string' ? claimed.username : user.username)
                return true
              }
            } catch { /* continue */ }
            return false
          }
          while (Date.now() < expiresAt) {
            if (claimedFromPopup) {
              finishSuccess(claimedUsername)
              return
            }
            const cookieReady = hasSessionCookie()
            const cookieEdge = cookieReady && !sawSessionCookie
            if (cookieReady) sawSessionCookie = true
            if (await tryClaimAfterLogin(cookieEdge)) return
            await new Promise(resolve => setTimeout(resolve, 400))
          }
        }

        publish({
          ...snapshot,
          loginVisible: true,
          loginFailed: false,
          view: {
            status: 'signed-out',
            links,
            attempt: { id: attemptId, phase: 'expired', authorizeUrl: waitingUrl, expiresAt },
          },
        })
      } finally {
        window.removeEventListener('message', onClaimedMessage)
      }
    },
    async cancel(id) { const result = await ctx.remote.account.cancelSignIn(id); if (!result.ok) throw new Error('account cancel failed') },
    async hasRunningAccountTasks() {
      const result = await ctx.remote.account.hasRunningAccountTasks()
      if (!result.ok) throw new Error('account task query failed')
      return result.value
    },
    async signOut() {
      // New API overlay owns shell signed-in; must clear token + publish signed-out even if DeepSeek has no grant.
      const links = siteLinks()
      newApiSignedIn = null
      let studioOk = false
      try {
        const res = await fetch('/auth/xiaocong/logout', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        })
        const body = await res.json().catch(() => null)
        studioOk = res.ok && body?.success !== false
      } catch { studioOk = false }
      // Keep New API session cookies so Sign-in can show /auth/authorize confirm
      // (DeepSeek-like). Use authorize page「切换其他账号」to clear New API session.
      publish({
        ...snapshot,
        loginVisible: false,
        loginFailed: false,
        view: { status: 'signed-out', links, attempt: null },
        details: undefined,
        avatar: undefined,
        failed: false,
      })
      try {
        const result = await ctx.remote.account.signOut(client())
        if (result.ok) {
          // Prefer Host signed-out; never keep credential-stored without newApiSignedIn.
          const view = result.value?.status === 'credential-stored'
            ? { status: 'signed-out' as const, links, attempt: null }
            : (result.value ?? { status: 'signed-out' as const, links, attempt: null })
          publish({ ...snapshot, view, details: undefined, avatar: undefined, failed: false, loginVisible: false })
          if (!studioOk) throw new Error('XiaocongAPI 本地令牌清除失败')
          return
        }
        if (!studioOk) throw result.error ?? new Error('account sign out failed')
        // Studio cleared and UI signed-out; ignore DeepSeek failure when only New API was active.
        return
      } catch (error) {
        if (studioOk) return
        throw error
      }
    },
  }
  // Authorized page (popup) can ask the workbench to focus / dismiss the success dialog.
  ctx.effect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (!event.data || typeof event.data.type !== 'string') return
      if (event.data.type === 'dsh-newapi-authorized') {
        try { window.focus() } catch { /* ignore */ }
        if (snapshot.loginSuccessVisible) publish({ ...snapshot, loginSuccessVisible: false })
        return
      }
      // Claimed from /auth/authorize; start() also listens while waiting.
      if (event.data.type === 'dsh-newapi-claimed') {
        try { window.focus() } catch { /* ignore */ }
      }
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, 'account: newapi authorized message')
  // If studio already has NEW_API_TOKEN, surface signed-in without waiting for Sign-in click.
  void (async () => {
    try {
      const status = await fetch('/auth/xiaocong/status').then(r => r.json())
      rememberXiaocongOrigin(status?.baseUrl)
      if (status?.hasToken) {
        newApiSignedIn = { username: typeof status.username === 'string' && status.username ? status.username : 'XiaocongAPI' }
        publish({
          ...snapshot,
          view: {
            status: 'credential-stored',
            links: siteLinks(),
            attempt: { id: 'newapi-local-claim' as SignInAttemptId, phase: 'succeeded' },
          },
          details: {
            profile: {
              status: 'ready',
              value: { id: null, name: newApiSignedIn.username, contact: status.username || null },
            },
            balance: { status: 'failed' },
          },
        })
        void refreshNewApiBalance()
      }
    } catch { /* studio may not be loaded yet */ }
  })()
  if (desktop) {
    const controller = new DesktopOnboardingController(
      ctx.configForms.get<OnboardingSettings>(DESKTOP_ONBOARDING_NAMESPACE),
      ctx.configForms.get<{ transcriptView?: TranscriptViewMode | null; performanceUsage: 'compact' | 'detailed' }>('ui-chat'),
      enabled => ctx.configForms.developerTools.setEnabled(enabled),
      operations.hooks.account,
      readOnboardingApiKeyPresence,
      ctx.configForms.describe(),
    )
    ctx.effect(() => () => { controller.dispose() }, 'account: desktop onboarding lifetime')
    ctx.effect(() => {
      const refreshCredentials = () => { controller.invalidateCredentials() }
      const disposers = [
        ctx.remote.$on('credentials/reference-updated', refreshCredentials),
        ctx.remote.$on('llm/adapters-updated', refreshCredentials),
        ctx.configForms.describe().subscribe(refreshCredentials),
      ]
      return () => { for (const dispose of disposers) dispose() }
    }, 'account: desktop credential readiness')
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'desktop-onboarding', locale: 'settings.account',
      inject: (): DesktopOnboardingInjected => ({
        hooks: { account: operations.hooks.account, onboarding: controller.state },
        setVisible: (visible: boolean) => {
          if (snapshot.desktopOnboardingVisible !== visible) publish({ ...snapshot, desktopOnboardingVisible: visible })
        },
        // Onboarding's recharge return re-reads profile and balance only.
        ...nativePlatform === undefined ? {} : { openPlatformPage: platformPageOpener(refresh) },
        update: (change: OnboardingChange) => controller.update(change),
        complete: (reason: 'completed' | 'skipped') => controller.complete(reason),
        retry: () => controller.retry(),
        track: (name, attributes) => ctx.get('productAnalytics')?.track(name, attributes),
      }),
    }, DesktopOnboardingEntry))
  }
  ctx.remoteAccess.whenAccess('account/watch', () => ctx.slots.inject('settings.models.sign-in', () => ctx.slots.register({
    name: 'settings.models.sign-in', locale: 'settings.account', inject: () => operations,
  }, AccountOnboarding)))
  ctx.remoteAccess.whenAccess('account/watch', () => ctx.slots.inject('shell.quota-notice', () => ctx.slots.register({
    name: 'shell.quota-notice', locale: 'settings.account',
    select: owner => owner.code === 'ACCOUNT_QUOTA' ? owner : null,
    inject: (): AccountQuotaNoticeInjected => ({
      hooks: { account: operations.hooks.account, platformPage: platformPages },
      ...nativePlatform === undefined ? {} : { openPlatformPage: platformPageOpener(refreshAccount) },
    }),
  }, AccountQuotaNotice)))
  if (nativePlatform !== undefined) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'account.platform-page', locale: 'settings.account',
      inject: (): AccountPlatformHostInjected => ({
        platform: nativePlatform, hooks: { page: platformPages },
        closePage: platformPages.close,
      }),
    }, AccountPlatformHost))
  }
  ctx.remoteAccess.whenAccess('account/watch', () => ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher', locale: 'settings.account', inject: () => operations,
  }, AccountMenu)))
  ctx.remoteAccess.whenAccess('account/watch', () => ctx.slots.inject('settings.section', () => {
    let unregister: (() => void) | undefined
    const update = () => {
      if (snapshot.view?.status === 'credential-stored') {
        unregister ??= ctx.slots.register({
          name: 'settings.section', id: 'account', order: -10, label: () => t('nav'),
          locale: 'settings.account', inject: () => operations,
        }, AccountSection)
      } else {
        unregister?.()
        unregister = undefined
      }
    }
    listeners.add(update)
    update()
    return () => { listeners.delete(update); unregister?.() }
  }))
}
