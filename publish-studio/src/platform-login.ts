import { randomUUID, randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSpaceId, spaceRoot } from './paths.js'
import { readRuntimePublicStatus, resolveRuntimePython, spawnRuntimeEnv } from './runtime.js'
import {
  accountDir,
  getAccountBinding,
  listAccountSummaries,
  markCredentialReady,
  patchAccountBinding,
  removeAccountBinding,
  saveAccountBinding,
} from './accounts.js'

export type LoginPlatform = {
  key: string
  loginUrl: string
  personalUrl: string
  method: string
  supportsQrProbe: boolean
  note: string
}

type LoginPhase = 'starting' | 'waiting_browser' | 'waiting_scan' | 'authorized' | 'failed' | 'expired' | 'cancelled'

type Session = {
  id: string
  spaceId: string
  bindingId: string
  platform: string
  createdAt: number
  child?: ChildProcess
  cancelFile: string
  statusFile: string
  storageFile: string
  qrFile: string
}

const root = dirname(fileURLToPath(import.meta.url))
const sessions = new Map<string, Session>()

export type LoginRunnerFactory = (args: {
  platform: string
  bindingId: string
  loginUrl: string
  personalUrl: string
  statusFile: string
  storageFile: string
  qrFile: string
  cancelFile: string
  timeoutSec: number
  mockScenario?: string
}) => ChildProcess

function loadPlatforms(): LoginPlatform[] {
  const file = join(root, '..', 'publishing', 'login-platforms.json')
  const rows = JSON.parse(readFileSync(file, 'utf8')) as LoginPlatform[]
  return rows.filter(r => r && r.key && r.loginUrl && /^https:\/\//.test(r.loginUrl))
}

export function listLoginPlatforms() {
  return loadPlatforms().map(p => ({
    key: p.key,
    method: p.method,
    loginUrlHost: safeHost(p.loginUrl),
    hasPersonalUrl: !!p.personalUrl,
    supportsQrProbe: !!p.supportsQrProbe,
    note: p.note,
  }))
}

function safeHost(url: string) {
  try { return new URL(url).host } catch { return '' }
}

function platformOf(key: string) {
  const p = loadPlatforms().find(x => x.key === key)
  if (!p) throw new Error('该平台尚未接入官方登录页（或不在白名单）')
  return p
}

function sessionDir(spaceId: string) {
  return join(spaceRoot(spaceId), 'login-sessions')
}

function readStatus(file: string) {
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return { phase: 'failed', message: '状态文件损坏' } }
}

const defaultRunner: LoginRunnerFactory = (args) => {
  const script = join(root, '..', 'publishing', 'login_runner.py')
  const py = resolveRuntimePython()
  const mock = args.mockScenario || process.env.PUBLISH_STUDIO_LOGIN_MOCK || ''
  const argv = [
    script,
    '--platform', args.platform,
    '--binding-id', args.bindingId,
    '--login-url', args.loginUrl,
    '--personal-url', args.personalUrl || '',
    '--status-file', args.statusFile,
    '--storage-file', args.storageFile,
    '--qr-file', args.qrFile,
    '--cancel-file', args.cancelFile,
    '--timeout-sec', String(args.timeoutSec),
  ]
  if (mock) argv.push('--mock-scenario', mock)
  return spawn(py, argv, { stdio: ['ignore', 'ignore', 'pipe'], env: spawnRuntimeEnv(), cwd: join(root, '..', 'publishing') })
}

let runnerFactory: LoginRunnerFactory = defaultRunner

/** Tests inject a fake runner; production uses Python Playwright runner. */
export function setLoginRunnerFactoryForTests(factory?: LoginRunnerFactory) {
  runnerFactory = factory || defaultRunner
}

export function createPlatformAccount(spaceId: string, platform: string, label?: string) {
  platformOf(platform)
  const item = saveAccountBinding(spaceId, {
    platform,
    label: (label || platform).slice(0, 80),
    revision: 0,
  })
  return item
}

export function startPlatformLogin(spaceId: string, bindingId: string, revision: number, opts?: { timeoutSec?: number; mockScenario?: string }) {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  const mock = opts?.mockScenario || process.env.PUBLISH_STUDIO_LOGIN_MOCK || ''
  const allowMock = process.env.PUBLISH_STUDIO_ALLOW_LOGIN_MOCK === '1'
  if (!mock && !allowMock) {
    const rt = readRuntimePublicStatus()
    if (!rt.ready) {
      throw new Error(rt.message || '发布插件运行时未就绪（Playwright/Chromium）。请先安装插件依赖，不会假装已打开浏览器。')
    }
  }
  const binding = getAccountBinding(spaceId, bindingId)
  if (binding.revision !== revision) throw new Error('版本已变化，请重新读取')
  if (!binding.enabled) throw new Error('账号已停用')
  const platform = platformOf(binding.platform)

  // cancel any previous session for same binding
  for (const [id, s] of sessions) {
    if (s.spaceId === spaceId && s.bindingId === bindingId) {
      try { writeFileSync(s.cancelFile, '1') } catch {}
      try { s.child?.kill('SIGTERM') } catch {}
      sessions.delete(id)
    }
  }

  const dir = sessionDir(spaceId)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  mkdirSync(accountDir(spaceId), { recursive: true, mode: 0o700 })
  const sessionId = `login-${randomUUID()}`
  const statusFile = join(dir, `${sessionId}.status.json`)
  const cancelFile = join(dir, `${sessionId}.cancel`)
  const qrFile = join(dir, `${sessionId}.qr.png`)
  const storageName = `${bindingId}.storage.json`
  const storageFile = join(accountDir(spaceId), storageName)
  if (existsSync(storageFile)) unlinkSync(storageFile)

  patchAccountBinding(spaceId, bindingId, { status: 'waiting_browser', expectedRevision: revision })

  const child = runnerFactory({
    platform: platform.key,
    bindingId,
    loginUrl: platform.loginUrl,
    personalUrl: platform.personalUrl,
    statusFile,
    storageFile,
    qrFile,
    cancelFile,
    timeoutSec: opts?.timeoutSec || 300,
    mockScenario: opts?.mockScenario,
  })
  const session: Session = {
    id: sessionId,
    spaceId,
    bindingId,
    platform: platform.key,
    createdAt: Date.now(),
    child,
    cancelFile,
    statusFile,
    storageFile,
    qrFile,
  }
  sessions.set(sessionId, session)
  child.on('exit', () => {
    // final poll will reconcile
  })
  child.stderr?.on('data', () => { /* keep secrets out of logs */ })

  const status = pollPlatformLogin(spaceId, sessionId)
  return {
    ...status,
    sessionId,
    bindingId,
    platform: platform.key,
    method: platform.method,
    loginUrlHost: safeHost(platform.loginUrl),
    notice: '已启动受控浏览器登录会话。请在官方页面完成登录/扫码；关闭窗口不等于成功。',
  }
}


function sessionForSpace(spaceId: string, sessionId: string) {
  const session = sessions.get(sessionId)
  if (session && session.spaceId !== spaceId) throw new Error('登录会话不属于当前公司')
  return session
}

export function pollPlatformLogin(spaceId: string, sessionId: string) {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  if (!/^login-[0-9a-f-]{36}$/.test(sessionId)) throw new Error('登录会话无效')
  const session = sessionForSpace(spaceId, sessionId)
  const statusFile = session?.statusFile || join(sessionDir(spaceId), `${sessionId}.status.json`)
  const raw = readStatus(statusFile) || { phase: 'starting', message: '等待登录进程…' }
  const phase = String(raw.phase || 'starting') as LoginPhase
  const bindingId = String(raw.bindingId || session?.bindingId || '')
  let item = null as ReturnType<typeof listAccountSummaries>[number] | null

  if (bindingId) {
    try {
      const current = listAccountSummaries(spaceId).find(x => x.id === bindingId) || null
      if (phase === 'authorized' && ((session && existsSync(session.storageFile)) || current?.hasCredentialFile)) {
        if (current?.status === 'authorized' && current.hasCredentialFile) {
          item = current
        } else if (session && existsSync(session.storageFile)) {
          const name = `${bindingId}.storage.json`
          item = markCredentialReady(spaceId, bindingId, name, raw.nickname ? String(raw.nickname) : undefined)
        } else {
          item = current
        }
      } else {
        const mapped =
          phase === 'waiting_scan' ? 'waiting_scan'
          : phase === 'waiting_browser' || phase === 'starting' ? 'waiting_browser'
          : phase === 'failed' ? 'failed'
          : phase === 'expired' ? 'expired'
          : phase === 'cancelled' ? 'cancelled'
          : null
        if (mapped && current && current.status !== mapped) {
          item = patchAccountBinding(spaceId, bindingId, { status: mapped as any })
        } else {
          item = current
        }
      }
    } catch {
      item = listAccountSummaries(spaceId).find(x => x.id === bindingId) || null
    }
  }

  const hasQr = raw.hasQr === true && session && existsSync(session.qrFile)
  return {
    sessionId,
    spaceId,
    phase,
    message: String(raw.message || ''),
    hasQr: !!hasQr,
    qrAvailable: !!hasQr,
    platform: String(raw.platform || session?.platform || ''),
    bindingId,
    item,
    // Never return cookie/storage contents
  }
}

export function cancelPlatformLogin(spaceId: string, sessionId: string) {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  const session = sessionForSpace(spaceId, sessionId)
  const cancelFile = session?.cancelFile || join(sessionDir(spaceId), `${sessionId}.cancel`)
  mkdirSync(dirname(cancelFile), { recursive: true, mode: 0o700 })
  writeFileSync(cancelFile, '1', { mode: 0o600 })
  try { session?.child?.kill('SIGTERM') } catch {}
  const status = pollPlatformLogin(spaceId, sessionId)
  return { ...status, phase: status.phase === 'authorized' ? status.phase : 'cancelled', message: status.message || '已请求取消登录' }
}

export function readLoginQrFile(spaceId: string, sessionId: string) {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  if (!/^login-[0-9a-f-]{36}$/.test(sessionId)) throw new Error('登录会话无效')
  const session = sessionForSpace(spaceId, sessionId)
  const qrFile = session?.qrFile || join(sessionDir(spaceId), `${sessionId}.qr.png`)
  if (!existsSync(qrFile)) throw new Error('当前没有可展示的真实二维码')
  return { path: qrFile, bytes: readFileSync(qrFile) }
}

export function removePlatformAccount(spaceId: string, bindingId: string, revision: number, confirm: boolean) {
  return removeAccountBinding(spaceId, bindingId, revision, confirm)
}
