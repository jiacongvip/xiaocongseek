import { randomUUID, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isSpaceId, spaceRoot } from './paths.js'

export type AccountStatus =
  | 'unconfigured'
  | 'waiting_browser'
  | 'waiting_scan'
  | 'authorized'
  | 'expired'
  | 'failed'
  | 'cancelled'
  /** @deprecated mapped to waiting_browser for older rows */
  | 'waiting_human_login'
  /** @deprecated mapped to authorized */
  | 'ready'
  | 'invalid'

export type AccountBinding = {
  id: string
  spaceId: string
  platform: string
  label: string
  nickname?: string
  revision: number
  enabled: boolean
  status: AccountStatus
  hasCredentialFile: boolean
  lastCheckedAt?: number
  updatedAt: number
}

type Store = { version: 1; bindings: AccountBinding[]; secrets: Record<string, string> }

function file(spaceId: string) { return join(spaceRoot(spaceId), 'accounts.json') }
export function accountDir(spaceId: string) { return join(spaceRoot(spaceId), 'account-files') }

function normalizeStatus(status: AccountStatus): AccountStatus {
  if (status === 'waiting_human_login') return 'waiting_browser'
  if (status === 'ready') return 'authorized'
  return status
}

function load(spaceId: string): Store {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  const f = file(spaceId)
  if (!existsSync(f)) return { version: 1, bindings: [], secrets: {} }
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'))
    if (raw.version !== 1 || !Array.isArray(raw.bindings)) throw new Error()
    return { version: 1, bindings: raw.bindings, secrets: raw.secrets && typeof raw.secrets === 'object' ? raw.secrets : {} }
  } catch {
    throw new Error('账号索引损坏，已保留原文件')
  }
}

function save(spaceId: string, store: Store) {
  const f = file(spaceId)
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
  const tmp = `${f}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(store, null, 2), { flag: 'wx', mode: 0o600 })
    renameSync(tmp, f)
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp)
  }
}

export function listAccountSummaries(spaceId: string) {
  return load(spaceId).bindings.map((b) => ({
    id: b.id,
    spaceId: b.spaceId,
    platform: b.platform,
    label: b.label,
    nickname: b.nickname || '',
    revision: b.revision,
    enabled: b.enabled,
    status: normalizeStatus(b.status),
    hasCredentialFile: b.hasCredentialFile,
    lastCheckedAt: b.lastCheckedAt || null,
    updatedAt: b.updatedAt,
  }))
}

export function getAccountBinding(spaceId: string, id: string) {
  const b = load(spaceId).bindings.find(x => x.id === id)
  if (!b) throw new Error('找不到当前公司账号')
  return b
}

export function saveAccountBinding(spaceId: string, item: Record<string, unknown>) {
  const store = load(spaceId)
  const platform = String(item.platform || '').trim()
  const label = String(item.label || '').trim()
  if (!platform || !label) throw new Error('请明确平台与账号显示名')
  if (Object.keys(item).some(k => ['cookie', 'token', 'password', 'path', 'filePath', 'credential', 'storage'].includes(k))) {
    throw new Error('账号绑定只接受摘要，禁止传入Cookie/密钥/路径')
  }
  let old = item.id ? store.bindings.find(b => b.id === item.id) : undefined
  if (old && old.revision !== item.revision) throw new Error('版本已变化，请重新读取')
  const next: AccountBinding = {
    id: old?.id || `binding-${randomUUID()}`,
    spaceId,
    platform,
    label: label.slice(0, 80),
    nickname: old?.nickname,
    revision: (old?.revision || 0) + 1,
    enabled: item.enabled === false ? false : true,
    status: old?.status || 'unconfigured',
    hasCredentialFile: old?.hasCredentialFile || false,
    lastCheckedAt: old?.lastCheckedAt,
    updatedAt: Date.now(),
  }
  store.bindings = [next, ...store.bindings.filter(b => b.id !== next.id)]
  save(spaceId, store)
  return listAccountSummaries(spaceId).find(b => b.id === next.id)!
}

export function patchAccountBinding(spaceId: string, bindingId: string, patch: Partial<AccountBinding> & { expectedRevision?: number }) {
  const store = load(spaceId)
  const b = store.bindings.find(x => x.id === bindingId)
  if (!b) throw new Error('找不到当前公司账号')
  if (patch.expectedRevision != null && b.revision !== patch.expectedRevision) throw new Error('版本已变化')
  const { expectedRevision: _rev, id: _id, spaceId: _sid, platform: _plat, ...safe } = patch as any
  Object.assign(b, safe, { id: b.id, spaceId: b.spaceId, platform: b.platform })
  b.revision += 1
  b.updatedAt = Date.now()
  save(spaceId, store)
  return listAccountSummaries(spaceId).find(x => x.id === bindingId)!
}

/** Remove company binding and local credential file only. Does not revoke platform account or delete media. */
export function removeAccountBinding(spaceId: string, bindingId: string, revision: number, confirm: boolean) {
  if (!confirm) throw new Error('请确认移除本公司绑定（不会注销平台账号）')
  const store = load(spaceId)
  const b = store.bindings.find(x => x.id === bindingId)
  if (!b) throw new Error('找不到当前公司账号')
  if (b.revision !== revision) throw new Error('版本已变化')
  const secret = store.secrets[bindingId]
  store.bindings = store.bindings.filter(x => x.id !== bindingId)
  delete store.secrets[bindingId]
  save(spaceId, store)
  if (secret && !secret.includes('/') && !secret.includes('..')) {
    const path = join(accountDir(spaceId), secret)
    if (existsSync(path)) unlinkSync(path)
  }
  return { success: true, spaceId, removedId: bindingId, note: '已移除本公司绑定与本地授权文件；未注销平台账号，未删除媒体。' }
}

/** @deprecated use platform-login startLogin */
export function beginAccountLogin(spaceId: string, bindingId: string, revision: number) {
  const store = load(spaceId)
  const b = store.bindings.find(x => x.id === bindingId)
  if (!b || !b.enabled) throw new Error('找不到当前公司账号')
  if (b.revision !== revision) throw new Error('版本已变化')
  b.status = 'waiting_browser'
  b.revision += 1
  b.updatedAt = Date.now()
  save(spaceId, store)
  return {
    item: listAccountSummaries(spaceId).find(x => x.id === bindingId)!,
    notice: '请改用 accounts.login.start 发起受控浏览器登录。',
  }
}

export function attachCredentialFileForTests(spaceId: string, bindingId: string, bytes: Buffer) {
  const store = load(spaceId)
  const b = store.bindings.find(x => x.id === bindingId)
  if (!b) throw new Error('找不到账号')
  const dir = accountDir(spaceId)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const name = `${bindingId}.storage.json`
  const path = join(dir, name)
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
  store.secrets[bindingId] = name
  b.hasCredentialFile = true
  b.status = 'authorized'
  b.lastCheckedAt = Date.now()
  b.revision += 1
  b.updatedAt = Date.now()
  save(spaceId, store)
  return listAccountSummaries(spaceId).find(x => x.id === bindingId)!
}

export function markCredentialReady(spaceId: string, bindingId: string, storageFileName: string, nickname?: string) {
  if (storageFileName.includes('/') || storageFileName.includes('..') || storageFileName.includes('\\')) throw new Error('凭据文件名无效')
  const store = load(spaceId)
  const b = store.bindings.find(x => x.id === bindingId)
  if (!b) throw new Error('找不到账号')
  const path = join(accountDir(spaceId), storageFileName)
  if (!existsSync(path)) throw new Error('凭据文件缺失')
  store.secrets[bindingId] = storageFileName
  b.hasCredentialFile = true
  b.status = 'authorized'
  if (nickname) b.nickname = nickname.slice(0, 80)
  b.label = b.label || nickname || b.platform
  b.lastCheckedAt = Date.now()
  b.revision += 1
  b.updatedAt = Date.now()
  save(spaceId, store)
  return listAccountSummaries(spaceId).find(x => x.id === bindingId)!
}

export function resolveCredentialPath(spaceId: string, bindingId: string) {
  const store = load(spaceId)
  const b = store.bindings.find(x => x.id === bindingId && x.enabled)
  if (!b) throw new Error('找不到当前公司账号')
  const status = normalizeStatus(b.status)
  if ((status !== 'authorized' && status !== 'ready') || !b.hasCredentialFile) throw new Error('账号尚未完成登录授权')
  const name = store.secrets[bindingId]
  if (!name || name.includes('/') || name.includes('..') || name.includes('\\')) throw new Error('凭据引用无效')
  const path = join(accountDir(spaceId), name)
  if (!existsSync(path)) throw new Error('凭据文件缺失')
  return { binding: b, path, revision: b.revision }
}

export function publicBindingFingerprint(spaceId: string, bindingId: string) {
  const { binding } = resolveCredentialPath(spaceId, bindingId)
  return createHash('sha256').update(`${binding.id}:${binding.revision}:${binding.platform}`).digest('hex')
}
