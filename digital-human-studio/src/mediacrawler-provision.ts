/**
 * 采集（MediaCrawler）内置运行环境：探测 + 安装。
 *
 * 产品目标：插件（digital-human-studio）起起来，采集就能用，不让用户自己 clone 仓库、
 * 自己建 venv、自己 pip install。采集代码随插件走（vendor/media-crawler，约 4MB），
 * Python 环境放 vendor/venv（不进 git，首次安装时生成）。
 *
 * 原则：
 * - 只探测，不动手；真正安装必须调用方显式 confirm。
 * - 幂等：已装过的步骤跳过，重复点不会把环境搞坏。
 * - 装前先看磁盘：装到一半磁盘满，会把正在跑的渲染和发布一起带崩，必须提前拒绝。
 */
import { execFileSync, spawn } from 'node:child_process'
import { findBundledPython, findUsableSystemPython, whichSync } from './platform.js'
import { appendFileSync, existsSync, mkdirSync, statfsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PYPI_MIRROR = 'https://pypi.tuna.tsinghua.edu.cn/simple'
/** 依赖装完约 300MB；低于这个余量宁可不装，避免把用户的盘写满。 */
const MIN_FREE_MB = 1500
/** 首次创建 venv 时偏好 3.12（pandas/opencv 在 3.14 上还没有预编译包）。 */
const PREFERRED_PY = '3.12'

export type McEnvStep = {
  key: string
  label: string
  ok: boolean | null
  detail: string
}

export type McEnvStatus = {
  /** vendor/media-crawler 绝对路径；为空表示代码没随插件走 */
  root: string
  venvDir: string
  python: string
  codeReady: boolean
  venvReady: boolean
  depsReady: boolean
  diskFreeMb: number | null
  ready: boolean
  steps: McEnvStep[]
  hint?: string
}

function pluginRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // dist/ 或 src/ 的上一级都是插件根
  return resolve(here, '..')
}

/** 采集代码根：优先插件自带 vendor/media-crawler。 */
export function mcVendorRoot(): string {
  const base = pluginRoot()
  for (const c of [resolve(base, 'vendor/media-crawler'), resolve(base, '../vendor/media-crawler')]) {
    if (existsSync(join(c, 'main.py'))) return c
  }
  return ''
}

/** 插件内采集运行环境：<plugin>/vendor/venv（与 media-crawler 同级）。 */
export function mcVendorVenv(): string {
  return resolve(pluginRoot(), 'vendor', 'venv')
}

export function mcVendorPython(): string {
  return process.platform === 'win32'
    ? join(mcVendorVenv(), 'Scripts', 'python.exe')
    : join(mcVendorVenv(), 'bin', 'python')
}

function diskFreeMb(path: string): number | null {
  try {
    const st = statfsSync(path)
    return Math.floor((Number(st.bavail) * Number(st.bsize)) / 1e6)
  } catch {
    return null
  }
}

function hasBinary(cmd: string): string {
  try {
    const p = whichSync(cmd)
    if (p) return p
  } catch { /* fall through */ }
  for (const c of [join(process.env.HOME || '', '.local/bin', cmd), join('/opt/homebrew/bin', cmd), join('/usr/local/bin', cmd)]) {
    if (existsSync(c)) return c
  }
  return ''
}

/** 核心依赖是否都能 import（只查采集真要用的，不查词云那套可选的）。 */
export function mcDepsReady(python = mcVendorPython()): boolean {
  if (!existsSync(python)) return false
  try {
    execFileSync(
      python,
      ['-c', 'import httpx, playwright, pydantic, sqlalchemy, parsel, tenacity, typer'],
      { timeout: 20000 },
    )
    return true
  } catch {
    return false
  }
}

export function diagnoseMcEnv(): McEnvStatus {
  const root = mcVendorRoot()
  const venvDir = mcVendorVenv()
  const python = mcVendorPython()
  const codeReady = !!root
  const venvReady = existsSync(python)
  const depsReady = venvReady && mcDepsReady(python)
  const free = diskFreeMb(pluginRoot())

  const steps: McEnvStep[] = [
    { key: 'code', label: '采集代码', ok: codeReady, detail: codeReady ? root : '插件内缺 vendor/media-crawler（main.py 不在）' },
    { key: 'venv', label: 'Python 环境', ok: venvReady, detail: venvReady ? venvDir : '还没建，点一次安装即可生成' },
    { key: 'deps', label: '采集依赖', ok: depsReady, detail: depsReady ? 'httpx/playwright/pydantic 等齐' : '未安装或装的版本不对' },
    { key: 'disk', label: '磁盘余量', ok: free == null ? null : free >= MIN_FREE_MB, detail: free == null ? '读不到' : `${free}MB（安装需 ≥${MIN_FREE_MB}MB）` },
  ]

  const ready = codeReady && depsReady
  return {
    root,
    venvDir,
    python,
    codeReady,
    venvReady,
    depsReady,
    diskFreeMb: free,
    ready,
    steps,
    hint: ready
      ? undefined
      : !codeReady
        ? '插件包里没有采集代码，需要重新打包'
        : free != null && free < MIN_FREE_MB
          ? `磁盘只剩 ${free}MB，装采集依赖会占约 300MB，先把盘清到 ${MIN_FREE_MB}MB 以上`
          : '点「初始化采集环境」生成 vendor/venv 并安装依赖',
  }
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; logFile?: string },
): Promise<{ ok: boolean; output: string }> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: process.env, windowsHide: true })
    let buf = ''
    const cap = (chunk: Buffer) => {
      buf += chunk.toString()
      if (buf.length > 40000) buf = buf.slice(-40000)
      if (opts.logFile) {
        try { appendFileSync(opts.logFile, chunk) } catch { /* ignore */ }
      }
    }
    child.stdout.on('data', cap)
    child.stderr.on('data', cap)
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
    }, opts.timeoutMs || 900_000)
    child.on('error', (e) => { clearTimeout(timer); done({ ok: false, output: String(e?.message || e) }) })
    child.on('close', (code) => { clearTimeout(timer); done({ ok: code === 0, output: buf }) })
  })
}

/**
 * 建采集环境。confirm=false 时只返回诊断，不写盘。
 */
export async function provisionMcEnv(opts: {
  confirm?: boolean
  logFile?: string
}): Promise<{ success: boolean; steps: McEnvStep[]; status: McEnvStatus; hint?: string }> {
  const status = diagnoseMcEnv()
  const steps: McEnvStep[] = []

  if (!opts.confirm) {
    return { success: status.ready, steps: status.steps, status, hint: status.hint }
  }

  if (!status.codeReady) {
    return {
      success: false,
      steps: [{ key: 'code', label: '采集代码', ok: false, detail: '插件内缺 vendor/media-crawler' }],
      status,
      hint: '插件包里没有采集代码，需要重新打包（vendor/media-crawler 应含 main.py）',
    }
  }

  if (status.diskFreeMb != null && status.diskFreeMb < MIN_FREE_MB) {
    return {
      success: false,
      steps: [{ key: 'disk', label: '磁盘余量', ok: false, detail: `${status.diskFreeMb}MB` }],
      status,
      hint: `磁盘只剩 ${status.diskFreeMb}MB，装依赖约需 300MB，中途写满会连带渲染一起失败。先清盘再装。`,
    }
  }

  mkdirSync(status.venvDir, { recursive: true })

  if (!existsSync(status.python)) {
    const uv = hasBinary('uv')
    let r: { ok: boolean; output: string }
    if (uv) {
      r = await run(uv, ['venv', status.venvDir, '--python', PREFERRED_PY], { timeoutMs: 300_000, logFile: opts.logFile })
    } else {
      const py = findBundledPython(pluginRoot()) || findUsableSystemPython() || (process.platform === 'win32' ? 'python' : 'python3')
      r = await run(py, ['-m', 'venv', status.venvDir], { timeoutMs: 300_000, logFile: opts.logFile })
    }
    steps.push({
      key: 'venv',
      label: 'Python 环境',
      ok: r.ok,
      detail: r.ok ? `${status.venvDir}（${uv ? 'uv ' + PREFERRED_PY : 'python3 venv'}）` : r.output.slice(-800),
    })
    if (!r.ok) {
      return { success: false, steps, status: diagnoseMcEnv(), hint: '建 venv 失败：多半是机器上没有 python3/uv，或 python 缺 venv 模块。' }
    }
  } else {
    steps.push({ key: 'venv', label: 'Python 环境', ok: true, detail: '已存在，跳过' })
  }

  if (!mcDepsReady(status.python)) {
    const req = join(status.root, 'requirements.txt')
    if (!existsSync(req)) {
      return { success: false, steps, status: diagnoseMcEnv(), hint: '采集代码里缺 requirements.txt' }
    }
    let r: { ok: boolean; output: string }
    const uvBin = hasBinary('uv')
    if (uvBin) {
      // uv 建的 venv 默认不带 pip，直接让 uv 装，比 ensurepip 快且不污染 venv
      r = await run(uvBin, ['pip', 'install', '--python', status.python, '-r', req, '--index-url', PYPI_MIRROR], {
        cwd: status.root,
        timeoutMs: 1_500_000,
        logFile: opts.logFile,
      })
      if (!r.ok) {
        r = await run(uvBin, ['pip', 'install', '--python', status.python, '-r', req], {
          cwd: status.root,
          timeoutMs: 1_500_000,
          logFile: opts.logFile,
        })
      }
    } else {
      await run(status.python, ['-m', 'ensurepip', '--upgrade'], { timeoutMs: 180_000, logFile: opts.logFile })
      r = await run(status.python, ['-m', 'pip', 'install', '-r', req, '-i', PYPI_MIRROR], {
        cwd: status.root,
        timeoutMs: 1_500_000,
        logFile: opts.logFile,
      })
      if (!r.ok) {
        r = await run(status.python, ['-m', 'pip', 'install', '-r', req], { cwd: status.root, timeoutMs: 1_500_000, logFile: opts.logFile })
      }
    }
    steps.push({
      key: 'deps',
      label: '采集依赖',
      ok: r.ok,
      detail: r.ok ? '已安装' : r.output.slice(-1200),
    })
    if (!r.ok) {
      return { success: false, steps, status: diagnoseMcEnv(), hint: '依赖装不上，通常是网络问题；可在 vendor/media-crawler 里手动跑 pip install -r requirements.txt' }
    }
  } else {
    steps.push({ key: 'deps', label: '采集依赖', ok: true, detail: '已安装，跳过' })
  }

  const after = diagnoseMcEnv()
  return {
    success: after.ready,
    steps,
    status: after,
    hint: after.ready ? undefined : after.hint,
  }
}
