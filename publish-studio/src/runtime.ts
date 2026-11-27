import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type RuntimePublicStatus = {
  ready: boolean
  phase: string
  message: string
  missing: string[]
  pinnedPlaywright?: string
  pythonExists?: boolean
  browsersReady?: boolean
  probeOk?: boolean
  updatedAt?: number
}

function runtimeRoot() {
  const override = process.env.PUBLISH_STUDIO_RUNTIME_ROOT
  if (override && override.trim()) return override.trim()
  return join(homedir(), '.dsh', 'publish-studio', 'runtime')
}

export function runtimeStatusPath() {
  return join(runtimeRoot(), 'status.json')
}

export function resolveRuntimePython(): string {
  if (process.env.PUBLISH_STUDIO_PYTHON && process.env.PUBLISH_STUDIO_PYTHON.trim()) {
    return process.env.PUBLISH_STUDIO_PYTHON.trim()
  }
  const root = runtimeRoot()
  const candidates = [
    join(root, 'venv', 'bin', 'python'),
    join(root, 'venv', 'Scripts', 'python.exe'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return 'python3'
}

export function resolveBrowsersPath(): string | undefined {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH
  const p = join(runtimeRoot(), 'ms-playwright')
  return existsSync(p) ? p : undefined
}

export function readRuntimePublicStatus(): RuntimePublicStatus {
  const file = runtimeStatusPath()
  if (!existsSync(file)) {
    return {
      ready: false,
      phase: 'missing',
      message: '发布插件隔离运行时未安装（Playwright/Chromium）。安装插件时应执行 ensure-runtime；也可手动 node scripts/ensure-runtime.mjs。',
      missing: ['runtime'],
    }
  }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return {
      ready: !!raw.ready,
      phase: String(raw.phase || (raw.ready ? 'ready' : 'missing')),
      message: String(raw.message || ''),
      missing: Array.isArray(raw.missing) ? raw.missing.map(String) : [],
      pinnedPlaywright: raw.pinnedPlaywright ? String(raw.pinnedPlaywright) : undefined,
      pythonExists: !!raw.pythonExists || !!(raw.python && existsSync(String(raw.python))),
      browsersReady: !!raw.browsersReady,
      probeOk: !!raw.probeOk,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
    }
  } catch {
    return { ready: false, phase: 'corrupt', message: '运行时状态文件损坏', missing: ['status'] }
  }
}

export function spawnRuntimeEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base }
  const browsers = resolveBrowsersPath()
  if (browsers) env.PLAYWRIGHT_BROWSERS_PATH = browsers
  // Keep executor/login from picking up unrelated site-packages accidentally when using venv.
  if (resolveRuntimePython() !== 'python3') env.PYTHONPATH = ''
  // Playwright ships its own node for the python driver, and that node refuses several
  // NODE_OPTIONS entries (e.g. --use-system-ca). It then dies silently and the python side
  // only surfaces "'PlaywrightContextManager' object has no attribute '_playwright'".
  // Python children never need node flags, so drop them instead of leaking them.
  delete env.NODE_OPTIONS
  delete env.NODE_EXTRA_CA_CERTS
  return env
}
