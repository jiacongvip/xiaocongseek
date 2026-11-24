/**
 * Shell-owned XiaocongAPI sign-in.
 *
 * Sign-in used to be a route family owned by the digital-human-studio plugin
 * (`/digital-human-studio/auth/*`). When that plugin was missing, not activated
 * or failed to boot, every one of those URLs 404'd and pressing 登录 opened a
 * dead page. This package owns the same flow on the shell itself, so sign-in
 * works with no workspace plugin installed.
 *
 * It persists exactly one secret — the inference key — into the shared
 * credential store's `refs.NEW_API_TOKEN`, which is the ref the plugin and the
 * LLM layer already read. Passwords and access tokens are transient: they live
 * in one request and never reach a log, a page body or a response field.
 *
 * The old plugin routes are intentionally left in place for compatibility; see
 * the migration note in the plugin. Nothing here reads the plugin.
 */

import type { Context } from '@deepseek-ai/cordis'
// Empty type import: merges `webServer` into the Context interface.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ROUTE, type XcyAuthStatus, type XcyClaimBody } from './shared.js'
import { authorizePageHtml, authorizedPageHtml, bootstrapPageHtml } from './pages.js'

/** Gateway the shell signs in against unless the install says otherwise. */
const DEFAULT_BASE = (process.env.XIAOCONG_NEW_API_BASE || '').trim() || 'https://xiaocongapi.azheteng.cn'

/** Name of the model key this shell claims; shared with the plugin's naming scheme. */
const TOKEN_NAME = 'digital-human-studio'

/** Shared credential store: `refs.NEW_API_TOKEN` is the one ref this writes. */
const CREDENTIALS_PATH = join(homedir(), '.dsh', '.credentials.yaml')

/** Shell-owned sign-in state (base address, display name). Holds no secret. */
const SHELL_STATE_PATH = join(homedir(), '.dsh', 'xiaocong-auth.json')

/** Legacy plugin config; read for compatibility, written only when it already exists. */
const STUDIO_CONFIG_PATH = join(homedir(), '.dsh', 'digital-human-studio.json')

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

interface ShellState {
  baseUrl?: string
  username?: string
  userId?: number | null
}

interface StudioConfig extends ShellState {
  newApiToken?: string
  newApiEnabled?: boolean
  [key: string]: unknown
}

function baseUrl(value: unknown): string {
  const candidate = String(value ?? '').trim() || DEFAULT_BASE
  const url = new URL(candidate)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('服务地址必须是无凭据的 HTTP(S) URL')
  }
  // A password must never travel over plain HTTP off this machine.
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.includes(url.hostname)) {
    throw new Error('非本机 XiaocongAPI 地址必须使用 HTTPS')
  }
  return url.toString().replace(/\/+$/, '')
}

/** Read the `refs.NEW_API_TOKEN` line without parsing the rest of the YAML. */
function readCredentialToken(): string {
  try {
    const lines = readFileSync(CREDENTIALS_PATH, 'utf8').split(/\r?\n/)
    let inRefs = false
    for (const line of lines) {
      if (/^refs\s*:/.test(line)) { inRefs = true; continue }
      if (!inRefs) continue
      if (/^[^\s#]/.test(line) && line.trim() !== '') { inRefs = false; continue }
      const match = /^\s+NEW_API_TOKEN\s*:\s*(.+)$/.exec(line)
      if (match) return unquote(match[1] ?? '')
    }
    return ''
  } catch {
    return ''
  }
}

function unquote(raw: string): string {
  const value = raw.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try { return String(JSON.parse(value.startsWith("'") ? JSON.stringify(value.slice(1, -1)) : value)) }
    catch { return value.slice(1, -1) }
  }
  return value
}

/**
 * Rewrite `refs.NEW_API_TOKEN` in place, preserving every other ref and record.
 * A token of `''` removes the line so sign-out leaves no dangling ref.
 */
function writeCredentialToken(token: string): void {
  const original = existsSync(CREDENTIALS_PATH) ? readFileSync(CREDENTIALS_PATH, 'utf8') : 'version: 1\nrefs: {}\n'
  const lines = original.split(/\r?\n/)
  // `refs: {}` is the empty form the writer in the wild emits; expand it first.
  const inline = lines.findIndex(line => /^refs\s*:\s*\{\s*\}\s*$/.test(line))
  if (inline >= 0) lines.splice(inline, 1, 'refs:')
  const header = lines.findIndex(line => /^refs\s*:/.test(line))
  const nextLine = `${token ? `  NEW_API_TOKEN: ${JSON.stringify(token)}` : ''}`

  let replaced = false
  if (header >= 0) {
    let end = header + 1
    while (end < lines.length && (/^\s/.test(lines[end] ?? '') || (lines[end] ?? '').trim() === '')) end += 1
    let hit = -1
    for (let index = header + 1; index < end; index += 1) {
      if (/^\s+NEW_API_TOKEN\s*:/.test(lines[index] ?? '')) { hit = index; break }
    }
    if (hit >= 0) {
      if (token) { lines[hit] = nextLine; replaced = true }
      else lines.splice(hit, 1)
    } else if (token) {
      lines.splice(end, 0, nextLine)
      replaced = true
    }
  } else if (token) {
    lines.push('refs:', nextLine)
    replaced = true
  }
  void replaced

  mkdirSync(dirname(CREDENTIALS_PATH), { recursive: true })
  const temp = join(dirname(CREDENTIALS_PATH), `.newapi-credential-${randomUUID()}.tmp`)
  writeFileSync(temp, lines.join('\n'), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  renameSync(temp, CREDENTIALS_PATH)
  chmodSync(CREDENTIALS_PATH, 0o600)
}

function readJson<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T }
  catch { return undefined }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  renameSync(temp, path)
  chmodSync(path, 0o600)
}

/** Shell state wins; the legacy plugin config supplies a fallback for older installs. */
function readState(): ShellState {
  const shell = readJson<ShellState>(SHELL_STATE_PATH) ?? {}
  const studio = readJson<StudioConfig>(STUDIO_CONFIG_PATH) ?? {}
  return {
    baseUrl: baseUrl(shell.baseUrl || studio.baseUrl || studio.newApiBaseUrl || DEFAULT_BASE),
    username: String(shell.username || studio.username || studio.newApiUsername || ''),
    userId: Number(shell.userId ?? studio.userId ?? studio.newApiUserId ?? 0) || null,
  }
}

/**
 * Persist the claimed key. The credential ref is authoritative; the legacy
 * plugin config is updated only when it already exists, so an install without
 * the plugin never grows a plugin config file.
 */
function persist(token: string, state: ShellState): void {
  writeCredentialToken(token)
  writeJson(SHELL_STATE_PATH, { baseUrl: state.baseUrl, username: state.username, userId: state.userId })
  const studio = readJson<StudioConfig>(STUDIO_CONFIG_PATH)
  if (!studio) return
  writeJson(STUDIO_CONFIG_PATH, {
    ...studio,
    newApiBaseUrl: state.baseUrl,
    newApiToken: token,
    newApiEnabled: true,
    newApiUsername: state.username,
    newApiUserId: state.userId,
  })
}

function status(): XcyAuthStatus {
  const state = readState()
  const token = readCredentialToken()
  return {
    success: true,
    enabled: !!token,
    baseUrl: state.baseUrl || DEFAULT_BASE,
    username: state.username || '',
    userId: state.userId ?? null,
    hasToken: !!token,
    tokenPreview: token ? `sk-••••${token.length > 12 ? token.slice(-4) : ''}` : '',
  }
}

/**
 * Account and key balance for the signed-in XiaocongAPI user.
 * Quota → money follows the gateway's own display rule (`quota_display_type`,
 * `quota_per_unit`, `usd_exchange_rate`), so the shell shows the number the
 * site itself renders. Only derived amounts leave this route; the key never does.
 */
const BALANCE_TTL_MS = 15_000
let balanceCache: { key: string; at: number; body: unknown } | undefined

async function readAccountBalance(): Promise<Record<string, unknown>> {
  const token = readCredentialToken()
  if (!token) return { success: false, error: '尚未设置 XiaocongAPI 令牌' }
  const state = readState()
  const base = baseUrl(state.baseUrl)
  const cacheKey = `${base}\u0000${token}`
  if (balanceCache && balanceCache.key === cacheKey && Date.now() - balanceCache.at < BALANCE_TTL_MS) {
    return balanceCache.body as Record<string, unknown>
  }
  // /api/usage/token/ is the one balance read a plain sk- key is allowed to make;
  // it carries both the key quota and the owning account's quota. The trailing
  // slash is required: New API answers the bare path with a 301 redirect, and
  // gateway() rejects redirects.
  const usage = await gateway(base, '/api/usage/token/', { headers: { Authorization: `Bearer ${token}` } })
  const statusPayload = await gateway(base, '/api/status').catch(() => null)
  const data = (usage?.data ?? {}) as Record<string, unknown>
  const meta = ((statusPayload as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>
  const num = (value: unknown, fallback: number): number => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  const quotaPerUnit = num(meta.quota_per_unit, 500000)
  const displayType = String(meta.quota_display_type || 'USD').toUpperCase()
  const customSymbol = String(meta.custom_currency_symbol || '').trim()
  const money = displayType === 'CNY'
    ? { symbol: '¥', currency: 'CNY', rate: num(meta.usd_exchange_rate, 1) }
    : displayType === 'CUSTOM' && customSymbol
      ? { symbol: customSymbol, currency: 'USD', rate: num(meta.custom_currency_exchange_rate, 1) }
      : { symbol: '$', currency: 'USD', rate: 1 }
  const toMoney = (quota: unknown): number | null => {
    const value = Number(quota)
    if (!Number.isFinite(value)) return null
    return Math.max(0, (value / quotaPerUnit) * money.rate)
  }
  const amount = (value: number | null): string | null => (value === null ? null : value.toFixed(2))
  const userQuota = (data.user_quota ?? {}) as Record<string, unknown>
  const account = toMoney(userQuota.total_available)
  const body = {
    success: true,
    baseUrl: base,
    displayType,
    quotaPerUnit,
    account: {
      currency: money.currency,
      symbol: money.symbol,
      available: amount(account),
      used: amount(toMoney(userQuota.total_used)),
      display: account === null ? null : `${money.symbol}${account.toFixed(2)}`,
    },
    token: {
      name: typeof data.name === 'string' ? data.name : '',
      unlimited: Boolean(data.unlimited_quota),
      available: amount(toMoney(data.total_available)),
      granted: amount(toMoney(data.total_granted)),
      used: amount(toMoney(data.total_used)),
    },
  }
  balanceCache = { at: Date.now(), key: cacheKey, body }
  return body
}

async function gateway(
  base: string,
  path: string,
  init: { body?: unknown, headers?: Record<string, string>, method?: 'GET' | 'POST' | 'PUT' } = {},
): Promise<any> {
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    redirect: 'error',
    headers: { 'content-type': 'application/json', ...init.headers },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(15000),
  })
  const data: any = await response.json().catch(() => null)
  if (!response.ok || !data || data.success === false) {
    // Upstream payloads can carry keys; only the status code leaves this function.
    throw new Error(`XiaocongAPI 请求失败 (${response.status})`)
  }
  return data
}

async function keyWorks(base: string, key: string): Promise<boolean> {
  try {
    await gateway(base, '/v1/models', { headers: { Authorization: `Bearer ${key}` } })
    return true
  } catch { return false }
}

function keyFromBatch(payload: any, id: number): string {
  const keys = payload?.data?.keys || payload?.data
  const entry = Array.isArray(keys) ? keys.find((item: any) => Number(item.id) === Number(id)) : keys?.[String(id)]
  const key = typeof entry === 'string' ? entry : entry?.key
  return typeof key === 'string' ? key : ''
}

/**
 * Exchange a transient access token for the persisted inference key:
 * reuse the local key, then any live named key on the gateway, then create one.
 */
async function claim(body: XcyClaimBody): Promise<XcyAuthStatus> {
  const state = readState()
  const base = baseUrl(body.baseUrl || state.baseUrl)
  const access = String(body.accessToken ?? body.access_token ?? '').trim()

  if (access) {
    const userId = Number(body.userId ?? body.user_id ?? body.id)
    if (!Number.isFinite(userId) || userId <= 0) throw new Error('缺少有效用户 id')
    const username = String(body.username || state.username || '')
    const headers = { Authorization: `Bearer ${access}`, 'New-Api-User': String(userId) }
    const next = { baseUrl: base, username, userId }

    const stored = readCredentialToken()
    if (stored && base === state.baseUrl && await keyWorks(base, stored)) {
      persist(stored, next)
      return status()
    }

    try {
      const found = await gateway(base, `/api/token/search?keyword=${encodeURIComponent(TOKEN_NAME)}`, { headers })
      const items = Array.isArray(found.data) ? found.data : found.data?.items || []
      const now = Math.floor(Date.now() / 1000)
      const candidates = (items as any[])
        .filter(item => typeof item?.name === 'string'
          && item.name.startsWith(TOKEN_NAME)
          && Number(item.id) > 0
          && !(Number(item.expired_time) > 0 && Number(item.expired_time) < now)
          && item.status !== 0 && item.status !== false && item.status !== 'disabled')
        .sort((left, right) => {
          const exact = (Number(right.name === TOKEN_NAME) - Number(left.name === TOKEN_NAME))
          return exact !== 0 ? exact : Number(right.id) - Number(left.id)
        })
      for (const item of candidates.slice(0, 8)) {
        const id = Number(item.id)
        try {
          const keys = await gateway(base, '/api/token/batch/keys', { body: { ids: [id] }, headers })
          const key = keyFromBatch(keys, id)
          if (!key) continue
          if (!await keyWorks(base, key)) continue
          persist(key, next)
          return status()
        } catch { /* try the next candidate */ }
      }
    } catch { /* search unavailable: fall through to create */ }

    const created = await gateway(base, '/api/token/', {
      headers,
      body: { name: TOKEN_NAME, expired_time: -1, remain_quota: 0, unlimited_quota: true, model_limits_enabled: false, group: 'default' },
    })
    let id = Number(created.data?.id)
    if (!id) {
      const found = await gateway(base, `/api/token/search?keyword=${encodeURIComponent(TOKEN_NAME)}`, { headers })
      const items = Array.isArray(found.data) ? found.data : found.data?.items || []
      id = Number((items as any[]).find(item => item.name === TOKEN_NAME)?.id)
    }
    if (!id) throw new Error('令牌已创建但无法定位，请在控制台查看并粘贴令牌')
    const keys = await gateway(base, '/api/token/batch/keys', { body: { ids: [id] }, headers })
    const key = keyFromBatch(keys, id)
    if (!key) throw new Error('无法取得完整令牌，请在控制台查看并粘贴令牌')
    persist(key, next)
    return status()
  }

  // No access token: keep the stored key when it still works.
  const stored = readCredentialToken()
  if (stored && await keyWorks(base, stored)) {
    persist(stored, { ...state, baseUrl: base })
    return status()
  }
  throw Object.assign(new Error(stored ? '本地令牌已失效，请重新登录 XiaocongAPI' : '尚未登录 XiaocongAPI，且本机无已保存令牌'), { needsLogin: true })
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(text)), 'cache-control': 'no-store' })
  res.end(text)
}

function sendHtml(res: ServerResponse, code: number, html: string): void {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(Buffer.byteLength(html)), 'cache-control': 'no-store' })
  res.end(html)
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('请求体过大')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('请求体不是合法 JSON') }
}

/** Same-origin fence for state-changing calls: another site must not write credentials. */
function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return false
  try { return new URL(origin).host !== req.headers.host } catch { return true }
}

/** Authorization pages only ever return to this machine. */
function localReturn(value: string | null, origin: string): string {
  if (!value) return `${origin}/`
  try {
    const parsed = new URL(value)
    if (['http:', 'https:'].includes(parsed.protocol) && LOOPBACK_HOSTS.includes(parsed.hostname)) return parsed.toString()
  } catch { /* fall through */ }
  return `${origin}/`
}

function originOf(req: IncomingMessage): string {
  const host = String(req.headers.host || '127.0.0.1:3080')
  const local = host.startsWith('127.') || host.startsWith('localhost') || host.startsWith('[::1]') || host.startsWith('::1')
  return `${local ? 'http' : 'https'}://${host}`
}

export const name = 'xiaocong-auth'

/** Only the web server is required; no workspace plugin and no credentials service. */
export const inject = ['webServer']

export function apply(ctx: Context): void {
  const register = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) => {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), `xiaocong-auth: ${path}`)
  }
  /**
   * The XiaocongAPI console only appends `dsh_access_token` to a redirect whose pathname
   * matches `/digital-human-studio/auth/(authorize|authorized)`. Serve those two paths
   * from the shell whenever the workspace plugin is absent, activated late or broken;
   * when the plugin does own them, its page keeps the old behaviour untouched.
   */
  const registerLegacy = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) => {
    try {
      ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), `xiaocong-auth: legacy ${path}`)
    } catch {
      // Duplicate (kind, path) means the workspace plugin already serves it; nothing to do.
    }
  }

  const authorizeHandler = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    const origin = originOf(req)
    const state = readState()
    const parsed = new URL(req.url || '/', origin)
    const returnUrl = localReturn(parsed.searchParams.get('return'), origin)
    // Redirect target must stay on the console-approved legacy path, otherwise the
    // console never hands the transient access token back to this page.
    const authorizeHere = new URL(ROUTE.legacyAuthorize, origin)
    authorizeHere.searchParams.set('return', returnUrl)
    authorizeHere.searchParams.set('auto', '1')
    const login = new URL('/login', `${baseUrl(state.baseUrl)}/`)
    login.searchParams.set('redirect', authorizeHere.toString())
    sendHtml(res, 200, authorizePageHtml(returnUrl, login.toString()))
  }

  const authorizedHandler = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    const origin = originOf(req)
    const parsed = new URL(req.url || '/', origin)
    sendHtml(res, 200, authorizedPageHtml(localReturn(parsed.searchParams.get('return'), origin)))
  }

  register(ROUTE.authorize, authorizeHandler)
  register(ROUTE.authorized, authorizedHandler)
  registerLegacy(ROUTE.legacyAuthorize, authorizeHandler)
  registerLegacy(ROUTE.legacyAuthorized, authorizedHandler)

  /**
   * Settings-page balance read. The digital-human-studio plugin served this
   * path historically; the shell keeps answering it so the 账号与余额 balance
   * row never dies with the plugin. Same-origin reads only.
   */
  registerLegacy('/digital-human-studio/account/balance', async (req, res) => {
    if (req.method !== 'GET') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    if (crossOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
    try { sendJson(res, 200, await readAccountBalance()) }
    catch { sendJson(res, 200, { success: false, error: '读取 XiaocongAPI 余额失败，请检查服务地址与令牌' }) }
  })

  register(ROUTE.status, (req, res) => {
    if (req.method !== 'GET') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    if (crossOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
    sendJson(res, 200, status())
  })

  /**
   * Desktop entry point: name the browser window before the console sees it, so the
   * console appends `dsh_access_token` to its redirect the same way it does for the
   * in-app popup. The hop carries no credential and lands on the console `/login`.
   */
  register(ROUTE.bootstrap, (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    const origin = originOf(req)
    const state = readState()
    const parsed = new URL(req.url || '/', origin)
    const returnUrl = localReturn(parsed.searchParams.get('return'), origin)
    const authorizeHere = new URL(ROUTE.legacyAuthorize, origin)
    authorizeHere.searchParams.set('return', returnUrl)
    authorizeHere.searchParams.set('auto', '1')
    const login = new URL('/login', `${baseUrl(state.baseUrl)}/`)
    login.searchParams.set('redirect', authorizeHere.toString())
    sendHtml(res, 200, bootstrapPageHtml(login.toString()))
  })

  register(ROUTE.claim, async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    if (crossOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      sendJson(res, 415, { success: false, error: 'application/json required' }); return
    }
    try { sendJson(res, 200, await claim(await readJsonBody(req) as XcyClaimBody)) }
    catch (error: any) { sendJson(res, 400, { success: false, error: error?.message || '授权失败', needsLogin: !!error?.needsLogin }) }
  })

  register(ROUTE.logout, (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    if (crossOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
    // Drop the shell key only. The XiaocongAPI session cookie survives so Sign-in
    // still shows the confirm page; use clear-session to switch accounts.
    writeCredentialToken('')
    const studio = readJson<StudioConfig>(STUDIO_CONFIG_PATH)
    if (studio) writeJson(STUDIO_CONFIG_PATH, { ...studio, newApiToken: '', newApiEnabled: false, newApiUsername: '', newApiUserId: null })
    const shell = readJson<ShellState>(SHELL_STATE_PATH)
    if (shell) writeJson(SHELL_STATE_PATH, { ...shell, username: '', userId: null })
    sendJson(res, 200, status())
  })

  const proxy = (upstreamPath: string) => async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
    if (crossOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
    const state = readState()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (typeof req.headers.cookie === 'string' && req.headers.cookie) headers.cookie = req.headers.cookie
    if (typeof req.headers['x-auth-session'] === 'string' && req.headers['x-auth-session']) headers['X-Auth-Session'] = req.headers['x-auth-session']
    try {
      const upstream = await fetch(`${baseUrl(state.baseUrl)}${upstreamPath}`, {
        method: 'POST', redirect: 'error', headers, signal: AbortSignal.timeout(15000),
      })
      const raw = Buffer.from(await upstream.arrayBuffer())
      const outgoing: Record<string, string | string[]> = {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'content-length': String(raw.length),
        'cache-control': 'no-store',
      }
      const cookies = typeof (upstream.headers as any).getSetCookie === 'function' ? (upstream.headers as any).getSetCookie() as string[] : []
      const single = upstream.headers.get('set-cookie')
      if (cookies.length) outgoing['set-cookie'] = cookies
      else if (single) outgoing['set-cookie'] = single
      res.writeHead(upstream.status, outgoing)
      res.end(raw)
    } catch {
      sendJson(res, 502, { success: false, error: 'XiaocongAPI 请求失败，请检查服务地址' })
    }
  }

  register(ROUTE.refresh, proxy('/api/user/auth/refresh'))
  register(ROUTE.clearSession, proxy('/api/user/auth/logout'))
}
