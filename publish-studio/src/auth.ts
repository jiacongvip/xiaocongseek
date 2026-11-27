import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pluginRoot } from './paths.js'

/** Original GEO client_auth / client_permissions semantics, adapted for this plugin.
 * Does not read original conf.py / cookies / DB. Settings are plugin-local.
 * Missing capability defaults allow_when_missing=true (original). Explicit false denies.
 * Positive daily limit is checked against THIS plugin's ledger, never by inventing zero usage.
 */
export type AuthSettings = {
  version: 1
  authEnforced: boolean
  permissionsEnforced: boolean
  aid: number
  authBaseUrl: string
  productKey: string
  allowPublish: boolean | null
  dailyPublishLimit: number | null
  /** Required before first productive publish when permissionsEnforced and limit>0. */
  quotaBaseline?: { acknowledgedAt: number; priorUsed: number; note: string }
}

type Session = { accessToken: string; refreshToken: string; aid: number; at: number }

const settingsFile = () => join(pluginRoot(), 'auth-settings.json')
const installFile = () => join(pluginRoot(), 'client-install.json')

function atomicWrite(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 })
    renameSync(tmp, file)
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp)
  }
}

export function defaultAuthSettings(): AuthSettings {
  return {
    version: 1,
    authEnforced: true,
    permissionsEnforced: true,
    aid: 0,
    authBaseUrl: '',
    productKey: '',
    allowPublish: null,
    dailyPublishLimit: null,
  }
}

export function loadAuthSettings(): AuthSettings {
  if (!existsSync(settingsFile())) return defaultAuthSettings()
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8'))
    if (raw.version !== 1) throw new Error()
    return { ...defaultAuthSettings(), ...raw, version: 1 }
  } catch {
    throw new Error('发布插件授权设置损坏，已保留原文件')
  }
}

export function saveAuthSettings(patch: Partial<AuthSettings>) {
  const cur = loadAuthSettings()
  const next: AuthSettings = {
    ...cur,
    ...patch,
    version: 1,
    aid: Number(patch.aid ?? cur.aid),
    authBaseUrl: String((patch.authBaseUrl ?? cur.authBaseUrl) || ''),
    productKey: String((patch.productKey ?? cur.productKey) || ''),
  }
  if (next.aid < 0 || !Number.isSafeInteger(next.aid)) throw new Error('aid无效')
  if (next.authBaseUrl) {
    const u = new URL(next.authBaseUrl)
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('授权中心地址无效')
  }
  if (next.dailyPublishLimit != null && (!Number.isInteger(next.dailyPublishLimit) || next.dailyPublishLimit < 0)) throw new Error('日额度无效')
  atomicWrite(settingsFile(), next)
  return publicAuthSettings(next)
}

/**
 * Initialize local out-of-the-box publish settings when running as a Xiaocongseek host plugin.
 * Never overwrites an existing auth-settings.json (so explicit admin restrictions stay intact),
 * and stays inactive when PUBLISH_STUDIO_REQUIRE_LEGACY_AUTH=1 is set.
 */
export function ensureProductDefaultAuthSettings(): AuthSettings {
  if (process.env.PUBLISH_STUDIO_REQUIRE_LEGACY_AUTH === '1') return loadAuthSettings()
  const file = settingsFile()
  if (existsSync(file)) return loadAuthSettings()
  const next: AuthSettings = {
    version: 1,
    authEnforced: false,
    permissionsEnforced: false,
    aid: 0,
    authBaseUrl: '',
    productKey: '',
    allowPublish: true,
    dailyPublishLimit: null,
  }
  atomicWrite(file, next)
  return next
}

export function publicAuthSettings(s = loadAuthSettings()) {
  return {
    authEnforced: s.authEnforced,
    permissionsEnforced: s.permissionsEnforced,
    aidConfigured: s.aid > 0,
    authBaseConfigured: !!s.authBaseUrl,
    allowPublish: s.allowPublish,
    dailyPublishLimit: s.dailyPublishLimit,
    quotaBaselineAcked: !!s.quotaBaseline,
    quotaBaselinePriorUsed: s.quotaBaseline?.priorUsed ?? null,
  }
}

export function acknowledgeQuotaBaseline(priorUsed: number, note: string) {
  if (!Number.isInteger(priorUsed) || priorUsed < 0) throw new Error('历史已用次数必须是明确非负整数')
  if (!note.trim()) throw new Error('请写明额度基线来源（管理员核对说明），不能空白')
  return saveAuthSettings({ quotaBaseline: { acknowledgedAt: Date.now(), priorUsed, note: note.trim().slice(0, 500) } })
}

let memorySession: Session | undefined

export function authSessionPublic() {
  const s = loadAuthSettings()
  return {
    authenticated: !s.authEnforced || !!memorySession,
    authEnforced: s.authEnforced,
  }
}

export function clearAuthSession() { memorySession = undefined; return authSessionPublic() }

function devicePayload() {
  mkdirSync(pluginRoot(), { recursive: true, mode: 0o700 })
  let installId: string
  if (existsSync(installFile())) {
    const raw = JSON.parse(readFileSync(installFile(), 'utf8'))
    if (typeof raw.installId !== 'string') throw new Error('设备安装标识损坏')
    installId = raw.installId
  } else {
    installId = randomBytes(16).toString('hex')
    atomicWrite(installFile(), { installId })
  }
  return {
    install_id: installId,
    machine_hash: 'sha256_' + createHash('sha256').update(installId).digest('hex'),
    device_name: 'publish-studio',
    os_name: process.platform,
    os_version: process.version,
    client_version: '0.1.0',
  }
}

/** Login against configured original-compatible auth center. Tokens stay in memory only. */
export async function loginWithPassword(input: { username: string; password: string }, transport: typeof fetch = fetch) {
  const s = loadAuthSettings()
  if (!s.authEnforced) return authSessionPublic()
  if (!s.authBaseUrl || s.aid <= 0) throw new Error('请先在发布插件设置中配置授权中心与aid')
  const body = {
    aid: s.aid,
    product_key: s.productKey || '',
    username: input.username,
    password: input.password,
    ...devicePayload(),
  }
  const res = await transport(new URL('/login', s.authBaseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json() as { code: number; data?: { access_token?: string; refresh_token?: string } }
  if (!res.ok || json.code >= 400 || !json.data?.access_token) throw new Error('原协议授权登录失败')
  memorySession = { accessToken: json.data.access_token, refreshToken: String(json.data.refresh_token || ''), aid: s.aid, at: Date.now() }
  return authSessionPublic()
}

export async function activateWithCode(input: { authCode: string }, transport: typeof fetch = fetch) {
  const s = loadAuthSettings()
  if (!s.authEnforced) return authSessionPublic()
  if (!s.authBaseUrl || s.aid <= 0) throw new Error('请先在发布插件设置中配置授权中心与aid')
  const body = { aid: s.aid, product_key: s.productKey || '', auth_code: input.authCode, ...devicePayload() }
  const res = await transport(new URL('/activate', s.authBaseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json() as { code: number; data?: { access_token?: string; refresh_token?: string } }
  if (!res.ok || json.code >= 400 || !json.data?.access_token) throw new Error('原协议激活失败')
  memorySession = { accessToken: json.data.access_token, refreshToken: String(json.data.refresh_token || ''), aid: s.aid, at: Date.now() }
  return authSessionPublic()
}

export function assertPublishAllowed() {
  const s = loadAuthSettings()
  const reasons: string[] = []
  if (s.authEnforced && !memorySession) reasons.push('发布插件需要按原协议登录/激活（令牌仅内存，未完成则blocked）')
  if (s.permissionsEnforced) {
    if (s.allowPublish === false) reasons.push('套餐明确未开放发布能力（allow_publish=false）')
    if (s.dailyPublishLimit === 0) reasons.push('日发布额度为0，明确拒绝')
    if (s.dailyPublishLimit != null && s.dailyPublishLimit > 0 && !s.quotaBaseline) {
      reasons.push('独立账本启用前须确认历史已用次数基线，不能把原已用次数清零放大')
    }
  }
  return { ok: reasons.length === 0, reasons, settings: publicAuthSettings(s) }
}
