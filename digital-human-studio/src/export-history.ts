import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { findMediaTool } from './platform.js'
import { spaceAssetRoot } from './spaces.js'
import { loadStudioHistory, saveStudioHistory, upsertStudioHistory, type StudioHistoryItem } from './studio-history.js'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 成品视频：系统自己导出的 mp4（剪映草稿本地导出 / 花字导出 / 手动导入）
 * 统一落到 <space>/exports/ 并登记进成片库，这样成片页能看到、能播、能去发布。
 */
export const EXPORT_KIND = 'xdh-export-video'
const EXPORT_DIR = 'exports'
const STYLED_TEXT_EXPORT_DIR = join('local-styled-text', 'exports')
const MAX_IMPORT_BYTES = 500 * 1024 * 1024

export function exportRoot(spaceId: string): string {
  return join(spaceAssetRoot(spaceId), EXPORT_DIR)
}

function exportId(spaceId: string, name: string): string {
  return `exp-${createHash('sha256').update(`${spaceId}:${name}`).digest('hex').slice(0, 32)}`
}

export function exportMediaUrl(spaceId: string, id: string): string {
  return `/digital-human-studio/works/file?space=${encodeURIComponent(spaceId)}&id=${encodeURIComponent(id)}`
}

function statOf(file: string) {
  try {
    const info = statSync(file)
    return info.isFile() ? info : null
  } catch {
    return null
  }
}

function safeTitle(name: string): string {
  return basename(String(name || '')).replace(/\.mp4$/i, '').replace(/[_\s]+/g, ' ').trim().slice(0, 60) || '成品视频'
}

/**
 * 把一个 mp4 收进 <space>/exports 并登记成片库。幂等：同名文件重复调用不会新增记录。
 * 已经在该目录里的文件不会被重复复制。
 */
export function registerExport(spaceId: string, sourcePath: string, opts: { title?: string } = {}): StudioHistoryItem | null {
  const info = statOf(sourcePath)
  if (!info || info.size < 1024) return null
  if (!/\.mp4$/i.test(sourcePath)) return null
  // 花字样式预览（stx-*-preview.mp4）是给人挑样式用的，不是成品
  if (/-preview\.mp4$/i.test(sourcePath) || /\.work_/i.test(sourcePath)) return null
  const root = exportRoot(spaceId)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const name = basename(sourcePath)
  const dest = join(root, name)
  try {
    if (resolve(sourcePath) !== resolve(dest)) copyFileSync(sourcePath, dest)
  } catch {
    return null
  }
  const destInfo = statOf(dest)
  if (!destInfo) return null
  const id = exportId(spaceId, name)
  const item: StudioHistoryItem = {
    id,
    kind: EXPORT_KIND,
    status: 'SUCCESS',
    title: (opts.title || '').trim().slice(0, 60) || safeTitle(name),
    at: Math.round(destInfo.mtimeMs) || Date.now(),
    mediaUrl: exportMediaUrl(spaceId, id),
    localFile: `${EXPORT_DIR}/${name}`,
    source: 'export',
  }
  const current = loadStudioHistory(spaceId)
  const previous = current.find(row => row.id === id)
  if (previous && previous.localFile === item.localFile && previous.mediaUrl) return previous
  upsertStudioHistory(spaceId, item)
  return item
}

/** 扫描历史导出目录，把之前导出过但没登记的成品补进成片库。 */
export function backfillExports(spaceId: string): { added: number; scanned: number } {
  const before = loadStudioHistory(spaceId).filter(item => item.kind === EXPORT_KIND).length
  const sources: string[] = []
  const styledRoot = join(spaceAssetRoot(spaceId), STYLED_TEXT_EXPORT_DIR)
  try {
    for (const name of readdirSync(styledRoot)) if (/\.mp4$/i.test(name)) sources.push(join(styledRoot, name))
  } catch {
    /* no styled-text exports */
  }
  let rootNames: string[] = []
  try {
    rootNames = readdirSync(exportRoot(spaceId)).filter(name => /\.mp4$/i.test(name))
  } catch {
    rootNames = []
  }
  // 新文件优先，避免历史文件把 LIMIT 挤满
  for (const name of rootNames.sort()) sources.push(join(exportRoot(spaceId), name))
  const scanned = sources.length
  for (const file of sources) registerExport(spaceId, file)
  const after = loadStudioHistory(spaceId).filter(item => item.kind === EXPORT_KIND).length
  return { added: Math.max(0, after - before), scanned }
}

/** 媒体路由用：只允许读本空间 exports 目录下的已验证记录。 */
export function exportFilePath(spaceId: string, id: string): { path: string; mime: string } | null {
  const item = loadStudioHistory(spaceId).find(row => row.id === String(id || '') && row.kind === EXPORT_KIND)
  if (!item?.localFile) return null
  const root = resolve(exportRoot(spaceId))
  const abs = resolve(join(spaceAssetRoot(spaceId), item.localFile))
  if (!abs.startsWith(`${root}${sep}`)) return null
  if (!/\.mp4$/i.test(abs)) return null
  const info = statOf(abs)
  if (!info) return null
  return { path: abs, mime: 'video/mp4' }
}

/** 导入本地剪映成品：写进 <space>/exports 后登记成片库。 */
export function importExport(spaceId: string, fileName: string, bytes: Buffer): StudioHistoryItem {
  if (!bytes?.length) throw new Error('文件为空')
  if (bytes.length > MAX_IMPORT_BYTES) throw new Error('文件超过 500MB')
  const raw = basename(String(fileName || 'import.mp4'))
  const cleaned = raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\.{2,}/g, '.').slice(0, 80)
  if (!/\.mp4$/i.test(cleaned)) throw new Error('只接受 mp4 成品')
  const root = exportRoot(spaceId)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const name = `import_${stamp}_${cleaned}`
  const dest = join(root, name)
  writeFileSync(dest, bytes, { mode: 0o600 })
  const item = registerExport(spaceId, dest, { title: safeTitle(cleaned) })
  if (!item) throw new Error('成品登记失败')
  return item
}

/**
 * 删成片时清理磁盘：只动本空间 exports 目录下这条记录自己的 mp4 与缩略图，
 * 路径必须落在 exports 内，越界一律不删。
 */
export function deleteExportArtifacts(spaceId: string, id: string, localFile?: string): number {
  let removed = 0
  const root = resolve(exportRoot(spaceId))
  const drop = (file?: string | null) => {
    if (!file) return
    const abs = resolve(file)
    if (!abs.startsWith(`${root}${sep}`)) return
    try {
      if (existsSync(abs)) {
        unlinkSync(abs)
        removed += 1
      }
    } catch {
      /* 文件已不在或被占用：记录删掉就够了，不阻塞用户 */
    }
  }
  drop(exportThumbPath(spaceId, id))
  const found = exportFilePath(spaceId, id)
  if (found) drop(found.path)
  if (localFile) drop(join(spaceAssetRoot(spaceId), localFile))
  return removed
}

/** 相对路径展示用（调试/日志），不参与路由。 */
export function exportRelPath(spaceId: string, file: string): string {
  return relative(spaceAssetRoot(spaceId), file)
}

export function exportFileExists(spaceId: string, localFile: string): boolean {
  if (!localFile) return false
  return existsSync(join(spaceAssetRoot(spaceId), localFile))
}

/**
 * 成品缩略图：用 ffmpeg 抽一帧存到 exports/.thumbs/<id>.jpg。
 * 前端拿这个当 <video> 的 poster —— 不然浏览器 preload=metadata 不画首帧，
 * 成片卡片就是一片空白。没有 ffmpeg 时返回 null，前端退回视频渲染，不会报错。
 */
export function exportThumbPath(spaceId: string, id: string): string {
  return join(exportRoot(spaceId), '.thumbs', `${String(id).replace(/[^A-Za-z0-9-]/g, '')}.jpg`)
}

/** 取帧封面：covers/<id>-cover.jpg，同一个成片同一时刻只有一版（预览也写这里）。 */
export function exportCoverFramePath(spaceId: string, id: string): string {
  return join(exportRoot(spaceId), '.covers', `${String(id).replace(/[^A-Za-z0-9-]/g, '')}-cover.jpg`)
}

/** 在指定秒数抽一帧做封面（1080 宽）。预览和确认共用，确认时由上层落 copy。 */
export async function extractExportFrame(spaceId: string, id: string, atSeconds: number): Promise<{ path: string; mime: string } | null> {
  const file = exportFilePath(spaceId, id)
  if (!file) return null
  const bin = ffmpegBin()
  if (!bin) return null
  const out = exportCoverFramePath(spaceId, id)
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 })
  const temp = `${out}.${process.pid}.tmp.jpg`
  const at = Math.max(0, Math.min(Number(atSeconds) || 0, 6 * 3600))
  try {
    await runFfmpeg(bin, [
      '-y', '-v', 'error', '-ss', String(at), '-i', file.path,
      '-frames:v', '1', '-vf', 'scale=1080:-2', '-q:v', '3', temp,
    ])
    const info = statOf(temp)
    if (!info?.size) return null
    renameSync(temp, out)
    return { path: out, mime: 'image/jpeg' }
  } catch {
    try {
      await runFfmpeg(bin, [
        '-y', '-v', 'error', '-i', file.path,
        '-frames:v', '1', '-vf', 'scale=1080:-2', '-q:v', '3', temp,
      ])
      const info = statOf(temp)
      if (!info?.size) return null
      renameSync(temp, out)
      return { path: out, mime: 'image/jpeg' }
    } catch {
      return null
    }
  }
}

function ffmpegBin(): string | null {
  const candidates = [
    process.env.XCY_FFMPEG || '',
    findMediaTool(PLUGIN_ROOT, 'ffmpeg'),
    join(homedir(), '.local', 'bin', 'ffmpeg'),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(bin, args, { timeout: 20000 }, error => error ? reject(error) : resolvePromise())
  })
}

export async function ensureExportThumb(spaceId: string, id: string): Promise<{ path: string; mime: string } | null> {
  const file = exportFilePath(spaceId, id)
  if (!file) return null
  const out = exportThumbPath(spaceId, id)
  if ((statOf(out)?.size || 0) > 0) return { path: out, mime: 'image/jpeg' }
  const bin = ffmpegBin()
  if (!bin) return null
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 })
  const temp = `${out}.${process.pid}.tmp.jpg`
  try {
    await runFfmpeg(bin, [
      '-y', '-v', 'error', '-ss', '0.2', '-i', file.path,
      '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', temp,
    ])
    if (!(statOf(temp)?.size)) return null
    renameSync(temp, out)
    return { path: out, mime: 'image/jpeg' }
  } catch {
    try { if (existsSync(temp)) unlinkSync(temp) } catch { /* 临时文件清理失败不影响结果 */ }
    return null
  }
}
