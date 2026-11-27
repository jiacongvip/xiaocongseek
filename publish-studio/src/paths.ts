import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'

/** Resolve on each call so tests can set process.env.HOME before exercising the API. */
export function pluginRoot() {
  return join(process.env.HOME || homedir(), '.dsh', 'publish-studio')
}

/** @deprecated Use pluginRoot(). Remains a function wrapper for gradual migration. */
export function PLUGIN_ROOT(): string { return pluginRoot() }

export function isSpaceId(id: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(String(id || '').trim())
}
export function spaceRoot(spaceId: string) {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  return join(pluginRoot(), 'spaces', spaceId)
}
export function assertInside(root: string, file: string) {
  const base = join(root)
  const target = join(file)
  if (!isAbsolute(target)) throw new Error('拒绝相对路径逃逸')
  if (!(target === base || target.startsWith(base.endsWith('/') ? base : base + '/'))) throw new Error('资源不属于当前插件隔离目录')
  return target
}
