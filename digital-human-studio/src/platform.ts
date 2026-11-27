/**
 * 跨平台小工具：同一套代码在 macOS / Windows 上找同一样东西。
 *
 * 产品平时只发 Mac 包，但客户机里有 Windows 时（打包给客户、或团队里有人用 PC），
 * 这里负责把「venv 解释器路径」「系统 Python 候选」「shell 差异」收口到一处，
 * 避免每个文件各写一份 `.venv/bin/python` 而漏掉 Windows 的 `.venv/Scripts/python.exe`。
 */
import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'

/** venv 里的 Python 解释器：Windows 是 .venv/Scripts/python.exe，其它平台是 .venv/bin/python。 */
export function venvPython(root: string): string {
  return IS_WIN ? join(root, '.venv', 'Scripts', 'python.exe') : join(root, '.venv', 'bin', 'python')
}

/** 一个根目录下可能存在的 venv 解释器（含同级 venv 目录），按优先级排列。 */
export function venvPythonCandidates(root: string): string[] {
  const names = IS_WIN
    ? [['.venv', 'Scripts', 'python.exe'], ['venv', 'Scripts', 'python.exe']]
    : [['.venv', 'bin', 'python'], ['venv', 'bin', 'python']]
  return names.map((seg) => join(root, ...seg))
}

/** 系统 Python 的可执行名（探测用；存在性由调用方判断）。 */
export function systemPythonNames(): string[] {
  return IS_WIN ? ['python', 'python3', 'py'] : ['python3', 'python']
}

/** 在提示文案里写解释器路径（给用户照着敲的那句）。 */
export function venvPythonHint(root: string): string {
  return IS_WIN ? join(root, '.venv', 'Scripts', 'python.exe') : '.venv/bin/python'
}

/** 启动引擎时给用户复制的那条命令（Windows 上不能用 `cd "x" && ...` 这种写法）。 */
export function engineStartCommand(root: string, hasVenv: boolean): string {
  if (IS_WIN) {
    return hasVenv
      ? `cd /d "${root}" && .venv\\Scripts\\python.exe capcut_server.py`
      : `cd /d "${root}" && python capcut_server.py`
  }
  return hasVenv
    ? `cd "${root}" && .venv/bin/python capcut_server.py`
    : `cd "${root}" && python3 capcut_server.py`
}

/**
 * 找可执行文件：Windows 用 where（可能返回多行，取第一行），其它平台用 which。
 * 找不到返回空串，调用方照旧走 try/catch。
 */
export function whichSync(name: string): string {
  try {
    const bin = IS_WIN ? 'where' : 'which'
    const out = String(execFileSync(bin, [name], { encoding: 'utf8' })).trim()
    return IS_WIN ? (out.split(/\r?\n/)[0] || '') : out
  } catch {
    return ''
  }
}

/** PATH separator for the current process. Windows uses `;`, other systems use `:`. */
export const PATH_DELIMITER = delimiter

/** ffmpeg / ffprobe shipped beside the plugin, before any machine-local install. */
export function runtimeBin(pluginRoot: string): string {
  return join(pluginRoot, 'vendor', 'runtime', 'bin')
}

/** Find ffmpeg or ffprobe: bundled runtime first, then the usual install locations. */
export function findMediaTool(pluginRoot: string, name: 'ffmpeg' | 'ffprobe'): string {
  const file = IS_WIN ? `${name}.exe` : name
  const candidates = [
    join(runtimeBin(pluginRoot), file),
    join(runtimeBin(pluginRoot), name),
    join(homedir(), '.local', 'bin', name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return whichSync(file) || whichSync(name)
}

/** 随包自带的独立 Python 解释器（vendor/runtime/cpython-*），按当前系统和架构优先匹配。 */
export function findBundledPython(pluginRoot: string): string {
  const runtimeDir = join(pluginRoot, 'vendor', 'runtime')
  let names: string[] = []
  try {
    names = readdirSync(runtimeDir).filter(name => name.startsWith('cpython-'))
  } catch {
    return ''
  }
  const osTag = IS_WIN ? 'windows' : IS_MAC ? 'macos' : 'linux'
  const archTag = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch
  const ranked = [...names].sort((left, right) => {
    const score = (name: string) =>
      (name.includes(osTag) ? 4 : 0)
      + (name.includes(archTag) ? 2 : 0)
      + (name.includes('3.12') ? 1 : 0)
    return score(right) - score(left)
  })
  for (const name of ranked) {
    const bins = IS_WIN
      ? [join(runtimeDir, name, 'python.exe')]
      : [
          join(runtimeDir, name, 'bin', 'python3.12'),
          join(runtimeDir, name, 'bin', 'python3'),
          join(runtimeDir, name, 'bin', 'python'),
        ]
    for (const bin of bins) {
      if (existsSync(bin)) return bin
    }
  }
  return ''
}

/** 指定虚拟环境目录内的 Python 解释器路径。 */
export function venvPythonIn(venvDir: string): string {
  return IS_WIN ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python')
}

/** 判断路径是否位于打包后的只读应用目录内（macOS .app/Contents/Resources 或 Windows Program Files）。 */
export function isPackagedBundlePath(targetPath: string): boolean {
  const p = String(targetPath || '')
  return /\.app[\\/]Contents[\\/]Resources/i.test(p)
    || /[\\/]resources[\\/]xiaocong-plugins/i.test(p)
    || /[\\/]Program Files(?: \(x86\))?[\\/]/i.test(p)
}

function isDirWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 解析剪辑引擎的虚拟环境目录：
 * 1. 若 engineRoot/.venv 已存在（本地开发或老装机），沿用它；
 * 2. 若 engineRoot 位于打包后的安装包目录内（或不可写），统一放到用户目录 ~/.xiaocongcut/venv，
 *    避免写入只读 App Bundle、破坏签名或在升级后被清空；
 * 3. 若 ~/.xiaocongcut/venv 已经装好，优先复用。
 */
export function resolveEngineVenvDir(engineRoot: string): string {
  const localVenv = join(engineRoot, '.venv')
  if (existsSync(venvPythonIn(localVenv))) return localVenv
  const localPlainVenv = join(engineRoot, 'venv')
  if (existsSync(venvPythonIn(localPlainVenv))) return localPlainVenv
  const userVenv = join(homedir(), '.xiaocongcut', 'venv')
  if (isPackagedBundlePath(engineRoot)) return userVenv
  if (existsSync(venvPythonIn(userVenv))) return userVenv
  if (existsSync(engineRoot) && !isDirWritable(engineRoot)) return userVenv
  return localVenv
}

/** 解析剪辑引擎实际要用的 venv Python 解释器路径。 */
export function resolveEngineVenvPython(engineRoot: string): string {
  return venvPythonIn(resolveEngineVenvDir(engineRoot))
}
