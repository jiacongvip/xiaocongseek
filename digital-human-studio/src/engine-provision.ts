/**
 * 本机剪辑引擎（Xiaocongcut）的探测与安装。
 *
 * 目标：客户装完插件，不用自己去 clone 仓库、装 Python 依赖，点一次就能剪片。
 *
 * 原则：
 * - 只探测，不动手。安装必须由调用方明确请求（HTTP 里要求 confirm:true）。
 * - 每一步都要能单独解释失败原因（缺 git / 缺 python / 缺 ffmpeg / 网络不通），
 *   不要抛一个笼统的 "install failed" 让用户猜。
 * - 幂等：已经装过的步骤跳过，重复点不会把环境搞乱。
 */
import { execFileSync, spawn } from 'node:child_process'
import {
  findBundledPython,
  findMediaTool,
  findUsableSystemPython,
  resolveEngineVenvDir,
  resolveEngineVenvPython,
  whichSync,
} from './platform.js'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** XiaocongcutAPI 官方仓库；剪辑草稿读写、导出都靠它。 */
export const XIAOCONGCUT_REPO = 'https://github.com/sun-guannan/VectCutAPI.git'
/** 国内装 Python 包走清华源，比默认快一个数量级；失败会自动回退官方源。 */
const PYPI_MIRROR = 'https://pypi.tuna.tsinghua.edu.cn/simple'

export type EngineStep = {
  key: string
  label: string
  /** null = 还没跑/未知（诊断阶段只给状态，不执行） */
  ok: boolean | null
  detail: string
}

export type EngineDiagnosis = {
  root: string
  /** 代码 + 依赖都齐了，理论上能直接启动 */
  ready: boolean
  /** 缺什么就装什么的前提是否满足（git / python3 / ffmpeg） */
  prerequisites: EngineStep[]
  steps: EngineStep[]
}

function which(cmd: string): string {
  try {
    return whichSync(cmd)
  } catch {
    return ''
  }
}

function version(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 8000 })
      .split('\n')[0]
      .trim()
      .slice(0, 80)
  } catch {
    return ''
  }
}

/** 跟随平台与打包位置选 venv 里的解释器路径（打包态落 ~/.xiaocongcut/venv，避免写只读 App 目录）。 */
function venvPython(root: string): string {
  return resolveEngineVenvPython(root)
}

/** 基础 Python：优先随包自带的 vendor/runtime/cpython-* 或宿主内置 Python，再兜底可用系统 python（跳过 Windows 商店假桩）。 */
function basePython(): string {
  return findBundledPython(PLUGIN_ROOT) || findUsableSystemPython() || ''
}

/** 仓库入口脚本。 */
export function engineEntry(root: string): string {
  return join(root, 'capcut_server.py')
}

/** 能用来跑 pip / venv 的 Python：优先引擎 venv，其次随包 Python / 系统 python3。 */
export function enginePython(root: string): string {
  const venv = venvPython(root)
  if (existsSync(venv)) return venv
  return basePython()
}

/** 只看不动：把"能不能剪"拆成可读的几条，缺哪条一眼看见。 */
export function diagnoseEngine(root: string): EngineDiagnosis {
  const git = which('git')
  const py = basePython()
  const ffmpeg = findMediaTool(PLUGIN_ROOT, 'ffmpeg') || which('ffmpeg')
  const hasRepo = existsSync(root)
  const hasEntry = existsSync(engineEntry(root))
  const harnessVenv = existsSync(venvPython(root))

  const prerequisites: EngineStep[] = [
    {
      key: 'git',
      label: 'git',
      ok: !!git || hasRepo,
      detail: git || (hasRepo ? '已随包内置，不再需要 git' : '缺少 git，无法下载引擎代码'),
    },
    {
      key: 'python',
      label: 'Python 3',
      ok: !!py,
      detail: py ? version(py, ['--version']) || py : '缺少 python3，装一个再继续',
    },
    {
      key: 'ffmpeg',
      label: 'ffmpeg',
      ok: !!ffmpeg,
      detail: ffmpeg || '缺少 ffmpeg，导不出视频',
    },
  ]

  const steps: EngineStep[] = [
    {
      key: 'repo',
      label: '引擎代码',
      ok: hasRepo && hasEntry,
      detail: !hasRepo ? `还没下载，将装到 ${root}` : !hasEntry ? `目录存在但缺 capcut_server.py：${root}` : root,
    },
    {
      key: 'venv',
      label: '运行环境',
      ok: harnessVenv,
      detail: harnessVenv ? venvPython(root) : '还没建虚拟环境',
    },
    {
      key: 'deps',
      label: '依赖包',
      ok: harnessVenv ? hasDeps(root) : false,
      detail: harnessVenv
        ? hasDeps(root)
          ? 'flask / imageio 等已安装'
          : '虚拟环境在，但依赖没装全'
        : '装完运行环境再检查',
    },
  ]

  const ready = !!(hasRepo && hasEntry && harnessVenv && hasDeps(root) && ffmpeg)
  return { root, ready, prerequisites, steps }
}

/** venv 里能不能 import 到核心依赖；不联网、不装包，只判存在。 */
function hasDeps(root: string): boolean {
  const py = venvPython(root)
  if (!existsSync(py)) return false
  try {
    execFileSync(py, ['-c', 'import flask, imageio, psutil, requests'], { timeout: 15000 })
    return true
  } catch {
    return false
  }
}

type RunResult = { ok: boolean; output: string }

/** 跑一条命令，把输出尾巴留下（日志里也写一份，方便事后排查）。 */
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number; logFile: string; stripProxy?: boolean },
): Promise<RunResult> {
  return new Promise(resolve => {
    const chunks: string[] = []
    let settled = false
    const finish = (ok: boolean, extra?: string) => {
      if (settled) return
      settled = true
      const output = [...chunks, extra || ''].filter(Boolean).join('\n').trim()
      resolve({ ok, output: output.slice(-4000) })
    }
    let child
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: '1' }
      if (opts.stripProxy) {
        for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
          delete env[k]
        }
      }
      child = spawn(cmd, args, { cwd: opts.cwd, env })
    } catch (e: any) {
      finish(false, `无法执行 ${cmd}: ${e?.message || e}`)
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      finish(false, `超时（${Math.round(opts.timeoutMs / 1000)}s）：${cmd} ${args.join(' ')}`)
    }, opts.timeoutMs)
    child.stdout?.on('data', d => chunks.push(String(d)))
    child.stderr?.on('data', d => chunks.push(String(d)))
    child.on('error', (e: any) => {
      clearTimeout(timer)
      finish(false, `启动失败：${e?.message || e}`)
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      try {
        appendFileSync(opts.logFile, `\n[provision] ${cmd} ${args.join(' ')} → exit ${code}\n`)
      } catch {
        /* ignore */
      }
      finish(code === 0, code === 0 ? '' : `退出码 ${code}`)
    })
  })
}

export type EngineInstallResult = {
  success: boolean
  /** 每一步做了什么、成没成 */
  steps: EngineStep[]
  /** 失败时给下一步动作，别只说"失败" */
  hint?: string
  diagnosis: EngineDiagnosis
}

/**
 * 装引擎：缺代码就 clone，缺环境就建 venv，缺依赖就 pip install。已装的部分跳过。
 * @param root 装到哪（默认 ~/XiaocongcutAPI，由调用方决定）
 * @param logFile 安装日志落盘位置
 */
export async function installEngine(root: string, logFile: string): Promise<EngineInstallResult> {
  const steps: EngineStep[] = []
  const push = (key: string, label: string, ok: boolean, detail: string) => {
    steps.push({ key, label, ok, detail })
    return ok
  }

  if (!existsSync(engineEntry(root))) {
    if (!which('git')) {
      push('repo', '引擎代码', false, '缺少 git，先装 git（macOS 可运行 xcode-select --install）')
      return { success: false, steps, hint: '装好 git 后重新点一次', diagnosis: diagnoseEngine(root) }
    }
    const r = await run('git', ['clone', '--depth', '1', XIAOCONGCUT_REPO, root], {
      timeoutMs: 300_000,
      logFile,
    })
    if (!push('repo', '引擎代码', r.ok, r.ok ? `已下载到 ${root}` : r.output)) {
      return { success: false, steps, hint: '检查网络后重试；公司网络可能需要代理', diagnosis: diagnoseEngine(root) }
    }
  } else {
    push('repo', '引擎代码', true, '已存在，跳过')
  }

  const sysPy = basePython()
  const venvDir = resolveEngineVenvDir(root)
  if (!existsSync(venvPython(root))) {
    if (!sysPy) {
      push('venv', '运行环境', false, '缺少 Python 3（未找到随包 Python 或系统 python3）')
      return { success: false, steps, hint: '重新安装完整包或安装 Python 3.10+ 后重试', diagnosis: diagnoseEngine(root) }
    }
    try {
      mkdirSync(dirname(venvDir), { recursive: true })
    } catch {
      /* ignore */
    }
    const r = await run(sysPy, ['-m', 'venv', venvDir], {
      cwd: root,
      timeoutMs: 180_000,
      logFile,
    })
    if (!push('venv', '运行环境', r.ok, r.ok ? `虚拟环境已创建（${venvDir}）` : r.output)) {
      return { success: false, steps, hint: '建虚拟环境失败，多半是 Python 装的方式不对（缺 venv 模块）', diagnosis: diagnoseEngine(root) }
    }
  } else {
    push('venv', '运行环境', true, `已存在（${venvDir}），跳过`)
  }

  if (!hasDeps(root)) {
    const py = venvPython(root)
    const base = ['-m', 'pip', 'install', '-r', join(root, 'requirements.txt')]
    let r = await run(py, [...base, '-i', PYPI_MIRROR], { cwd: root, timeoutMs: 900_000, logFile })
    if (!r.ok && ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'].some(k => process.env[k])) {
      // 机器开着代理导致 TLS 断流（SSLEOFError）时，去代理直连国内镜像重试
      r = await run(py, [...base, '-i', PYPI_MIRROR], { cwd: root, timeoutMs: 900_000, logFile, stripProxy: true })
    }
    if (!r.ok) {
      // 镜像挂了就回退官方源，别让用户卡在一个源上
      r = await run(py, base, { cwd: root, timeoutMs: 900_000, logFile })
    }
    if (!push('deps', '依赖包', r.ok, r.ok ? '依赖已安装' : r.output)) {
      return { success: false, steps, hint: '依赖装不上，通常是网络问题；可手动在引擎目录跑 pip install -r requirements.txt', diagnosis: diagnoseEngine(root) }
    }
  } else {
    push('deps', '依赖包', true, '已安装，跳过')
  }

  const ffmpeg = findMediaTool(PLUGIN_ROOT, 'ffmpeg') || which('ffmpeg')
  push('ffmpeg', 'ffmpeg', !!ffmpeg, ffmpeg || '缺少 ffmpeg，剪得动但导不出（重新安装完整包或安装 ffmpeg）')

  const diagnosis = diagnoseEngine(root)
  return {
    success: diagnosis.ready,
    steps,
    hint: diagnosis.ready ? undefined : '检查上面标红的项，补好后再点一次',
    diagnosis,
  }
}
