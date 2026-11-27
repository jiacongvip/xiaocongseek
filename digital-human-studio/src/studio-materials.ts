import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { whichSync } from './platform.js'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { spaceAssetRoot } from './spaces.js'

export const MATERIAL_SLOTS = ['product', 'store', 'logo', 'scene', 'outfit'] as const
export type MaterialSlot = typeof MATERIAL_SLOTS[number]
export const MATERIAL_SLOT_LABELS: Record<MaterialSlot, string> = {
  product: '产品',
  store: '门店',
  logo: 'Logo',
  scene: '场景背景',
  outfit: '服装套装',
}

export type MaterialKind = 'image' | 'video' | 'audio' | 'file'

export type MaterialRole = 'product_detail' | 'store_front' | 'store_in' | 'process' | 'talking' | 'logo' | 'other'

export type StudioMaterial = {
  id: string
  slot: MaterialSlot
  name: string
  file: string
  kind: MaterialKind
  at: number
  size: number
  fingerprint?: string
  duration?: number
  width?: number
  height?: number
  cover?: string
  role?: MaterialRole | string
  useFor?: string
  summary?: string
  /** 详细分析维度：dh_label_materials 按这些字段逐项描述 */
  environment?: string
  lighting?: string
  quality?: string
  speaker?: string
  speech?: string
  analyzedAt?: number
  analysisStatus?: 'pending' | 'ready'
  sourcePath?: string
}

const LIMIT = 80
const MAX_BYTES = 200 * 1024 * 1024

export function isMaterialSlot(value: string): value is MaterialSlot {
  return (MATERIAL_SLOTS as readonly string[]).includes(String(value || '').trim())
}

export function spaceMaterialsRoot(spaceId: string): string {
  return join(spaceAssetRoot(spaceId), 'materials')
}

export function ensureMaterialsDisk(spaceId: string) {
  const root = spaceMaterialsRoot(spaceId)
  mkdirSync(root, { recursive: true })
  for (const slot of MATERIAL_SLOTS) mkdirSync(join(root, slot), { recursive: true })
}

/** Auto-extracted download covers (cover.jpg / dy-…-cover.jpg). Not shop product shots. */
export function isDownloadSidecarCover(name: string): boolean {
  const base = basename(String(name || '')).toLowerCase()
  return /^(cover|.*[-_]cover)\.(jpe?g|png|webp)$/.test(base)
}

export function pruneDownloadSidecarCovers(spaceId: string): StudioMaterial[] {
  const items = listStudioMaterials(spaceId)
  for (const item of items) {
    if (item.kind === 'image' && isDownloadSidecarCover(item.name)) removeStudioMaterial(spaceId, item.id)
  }
  return listStudioMaterials(spaceId)
}

export function materialKindFromName(name: string): MaterialKind {
  const ext = extname(String(name || '')).toLowerCase()
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(ext)) return 'image'
  if (/\.(mp4|mov|webm|mkv|m4v)$/.test(ext)) return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(ext)) return 'audio'
  return 'file'
}

export function materialMime(name: string): string {
  const ext = extname(String(name || '')).toLowerCase()
  const types: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.m4v': 'video/x-m4v',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
  }
  return types[ext] || 'application/octet-stream'
}

function catalogPath(spaceId: string): string {
  return join(spaceMaterialsRoot(spaceId), 'catalog.json')
}

/** Cordis tool results cannot contain undefined / NaN / Infinity. */
function losslessJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (typeof item === 'number' && !Number.isFinite(item)) return null
      return item
    }),
  ) as T
}

function safeFileName(name: string): string {
  const base = String(name || 'file').replace(/[/\\?%*:|"<>]/g, '_').replace(/\.\./g, '_').replace(/\s+/g, ' ').trim() || 'file'
  return base.slice(0, 80)
}

function loadCatalog(spaceId: string): StudioMaterial[] {
  try {
    const file = catalogPath(spaceId)
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : []
    return rows.filter((item: unknown) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
  } catch {
    return []
  }
}

function saveCatalog(spaceId: string, items: StudioMaterial[]) {
  ensureMaterialsDisk(spaceId)
  writeFileSync(catalogPath(spaceId), JSON.stringify(items, null, 2), { encoding: 'utf8' })
}

export function materialAbsolutePath(spaceId: string, item: StudioMaterial): string {
  const root = spaceMaterialsRoot(spaceId)
  const abs = join(root, item.file)
  if (abs !== root && !abs.startsWith(`${root}/`)) throw new Error('素材路径无效')
  return abs
}

export function materialPublicUrl(spaceId: string, item: StudioMaterial): string {
  const params = new URLSearchParams({ space: spaceId, id: item.id, name: item.name })
  return `/digital-human-studio/materials/file?${params.toString()}`
}

export function listStudioMaterials(spaceId: string): StudioMaterial[] {
  ensureMaterialsDisk(spaceId)
  const root = spaceMaterialsRoot(spaceId)
  const catalog = loadCatalog(spaceId)
  const byFile = new Map(catalog.map(item => [item.file, item]))
  const idCounts = new Map<string, number>()
  for (const item of catalog) idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1)
  // Keep unique legacy links; retire ALL ambiguous IDs so stale delete requests
  // cannot silently pick one of the formerly colliding files.
  const reserved = new Set(catalog.map(item => item.id))
  const assigned = new Set<string>()
  const items: StudioMaterial[] = []
  for (const slot of MATERIAL_SLOTS) {
    let names: string[] = []
    try {
      names = readdirSync(join(root, slot)).sort()
    } catch {
      names = []
    }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const rel = `${slot}/${name}`
      const abs = join(root, rel)
      let info
      try {
        info = statSync(abs)
      } catch {
        continue
      }
      if (!info.isFile()) continue
      const previous = byFile.get(rel)
      let id = previous?.id && idCounts.get(previous.id) === 1 ? previous.id : ''
      if (!id || assigned.has(id)) {
        const base = `file-${createHash('sha256').update(rel, 'utf8').digest('hex')}`
        id = base
        let suffix = 0
        while (reserved.has(id) || assigned.has(id)) id = `${base}-${++suffix}`
      }
      assigned.add(id)
      const fingerprint = `${info.size}:${Math.round(info.mtimeMs)}`
      const same = previous?.fingerprint === fingerprint
      items.push({
        id,
        slot,
        name: previous?.name || name,
        file: rel,
        kind: previous?.kind || materialKindFromName(name),
        at: previous?.at || Math.round(info.mtimeMs) || Date.now(),
        size: info.size,
        fingerprint,
        duration: same ? previous?.duration : undefined,
        width: same ? previous?.width : undefined,
        height: same ? previous?.height : undefined,
        cover: same ? previous?.cover : undefined,
        role: same ? previous?.role : undefined,
        useFor: same ? previous?.useFor : undefined,
        summary: same ? previous?.summary : undefined,
        environment: same ? previous?.environment : undefined,
        lighting: same ? previous?.lighting : undefined,
        quality: same ? previous?.quality : undefined,
        speaker: same ? previous?.speaker : undefined,
        speech: same ? previous?.speech : undefined,
        analyzedAt: same ? previous?.analyzedAt : undefined,
        analysisStatus: same && previous?.analysisStatus === 'ready' ? 'ready' : 'pending',
        sourcePath: previous?.sourcePath,
      })
    }
  }
  items.sort((left, right) => (right.at || 0) - (left.at || 0))
  saveCatalog(spaceId, items)
  return items
}


export function materialsOpenPath(spaceId: string, slot = ''): string {
  ensureMaterialsDisk(spaceId)
  const root = spaceMaterialsRoot(spaceId)
  const wanted = String(slot || '').trim()
  if (!wanted) return root
  if (!isMaterialSlot(wanted)) throw new Error('槽位只能是产品、门店、Logo、场景背景或服装套装')
  const abs = join(root, wanted)
  if (abs !== root && !abs.startsWith(`${root}/`)) throw new Error('素材路径无效')
  return abs
}

/** Open a company materials folder with fixed argv only; never pass client-supplied paths. */
export function openMaterialsDirectory(spaceId: string, slot = ''): { path: string; opened: boolean; note?: string } {
  const path = materialsOpenPath(spaceId, slot)
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  try {
    const child = spawn(command, [path], { detached: true, stdio: 'ignore' })
    child.unref()
    return { path, opened: true }
  } catch (error: any) {
    return {
      path,
      opened: false,
      note: String(error?.message || '无法自动打开文件夹，请复制路径后在 Finder 打开'),
    }
  }
}

export function renameStudioMaterial(spaceId: string, id: string, nextName: string): StudioMaterial {
  const key = String(id || '').trim()
  if (!key) throw new Error('找不到这个素材')
  const items = listStudioMaterials(spaceId)
  const item = items.find(row => row.id === key)
  if (!item) throw new Error('找不到这个素材')
  const currentExt = extname(item.file) || extname(item.name)
  let display = safeFileName(nextName)
  if (!display) throw new Error('名称不能为空')
  // Keep the physical extension unless the user typed another allowed media extension.
  const typedExt = extname(display)
  const keepExt = currentExt || typedExt || ''
  if (!typedExt) display = `${display}${keepExt}`
  else if (typedExt.toLowerCase() !== keepExt.toLowerCase()) {
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.mp4', '.mov', '.webm', '.mkv', '.m4v', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])
    if (!allowed.has(typedExt.toLowerCase())) {
      display = `${display.slice(0, Math.max(1, display.length - typedExt.length))}${keepExt}`
    }
  }
  const finalExt = extname(display) || keepExt
  const stem = basename(display, extname(display)).trim() || 'file'
  const safeStem = safeFileName(stem).replace(/\.[^.]+$/, '') || 'file'
  const fileName = `${safeStem}-${key.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'file'}${finalExt}`
  const nextRel = `${item.slot}/${fileName}`
  if (nextRel !== item.file && items.some(row => row.file === nextRel)) {
    throw new Error('已有同名文件，请换一个名字')
  }
  const from = materialAbsolutePath(spaceId, item)
  const to = join(spaceMaterialsRoot(spaceId), nextRel)
  if (to !== spaceMaterialsRoot(spaceId) && !to.startsWith(`${spaceMaterialsRoot(spaceId)}/`)) {
    throw new Error('素材路径无效')
  }
  if (nextRel !== item.file) {
    if (existsSync(to)) throw new Error('已有同名文件，请换一个名字')
    renameSync(from, to)
  }
  const next: StudioMaterial = {
    ...item,
    name: display,
    file: nextRel,
    kind: materialKindFromName(display),
    at: Date.now(),
    size: existsSync(to) ? statSync(to).size : item.size,
  }
  const catalog = [next, ...items.filter(row => row.id !== key)]
  saveCatalog(spaceId, catalog)
  return listStudioMaterials(spaceId).find(row => row.id === key) || next
}

export function addStudioMaterial(spaceId: string, slot: MaterialSlot, originalName: string, bytes: Buffer): StudioMaterial {
  if (!isMaterialSlot(slot)) throw new Error('槽位只能是产品、门店、Logo、场景背景或服装套装')
  if (!bytes.length) throw new Error('文件为空')
  if (bytes.length > MAX_BYTES) throw new Error('文件超过 200 MB')
  if (listStudioMaterials(spaceId).length >= LIMIT) throw new Error('每家公司最多上传 80 件素材；已有文件不会删除')
  ensureMaterialsDisk(spaceId)
  const name = safeFileName(originalName)
  const ext = extname(name)
  const stem = name.slice(0, Math.max(1, name.length - ext.length)) || 'file'
  const id = `mat-${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const fileName = `${stem}-${id.slice(-6)}${ext}`
  const rel = `${slot}/${fileName}`
  writeFileSync(join(spaceMaterialsRoot(spaceId), rel), bytes)
  const item: StudioMaterial = {
    id,
    slot,
    name,
    file: rel,
    kind: materialKindFromName(name),
    at: Date.now(),
    size: bytes.length,
    analysisStatus: 'pending',
  }
  const current = loadCatalog(spaceId).filter(row => row.file !== rel)
  saveCatalog(spaceId, [item, ...current])
  return listStudioMaterials(spaceId).find(row => row.id === id) || item
}

export function removeStudioMaterial(spaceId: string, id: string): StudioMaterial[] {
  const key = String(id || '').trim()
  const items = listStudioMaterials(spaceId)
  const item = items.find(row => row.id === key)
  if (!item) return items
  try {
    unlinkSync(materialAbsolutePath(spaceId, item))
  } catch {
    /* already gone */
  }
  const next = items.filter(row => row.id !== key)
  saveCatalog(spaceId, next)
  return next
}

export function findStudioMaterial(spaceId: string, id: string): StudioMaterial | undefined {
  return listStudioMaterials(spaceId).find(item => item.id === String(id || '').trim())
}

function resolveBin(name: 'ffmpeg' | 'ffprobe'): string {
  const home = homedir()
  const candidates = [
    join(home, '.local', 'bin', name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  try {
    return whichSync(name) || ''
  } catch {
    return ''
  }
}

function probeDuration(absolute: string): number {
  const ffprobe = resolveBin('ffprobe')
  if (!ffprobe || !existsSync(absolute)) return 0
  try {
    const out = execFileSync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      absolute,
    ], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const seconds = Number(out)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  } catch {
    return 0
  }
}

function probeSize(absolute: string): { width?: number; height?: number } {
  const ffprobe = resolveBin('ffprobe')
  if (!ffprobe || !existsSync(absolute)) return {}
  try {
    const out = execFileSync(ffprobe, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0:s=x',
      absolute,
    ], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const [width, height] = out.split(/[x,]/).map(Number)
    if (width > 0 && height > 0) return { width, height }
  } catch {
    /* ignore */
  }
  return {}
}

function extractCover(spaceId: string, item: StudioMaterial): string {
  if (item.kind === 'image') return item.file
  const ffmpeg = resolveBin('ffmpeg')
  if (!ffmpeg) return ''
  const thumbs = join(spaceMaterialsRoot(spaceId), '.thumbs')
  mkdirSync(thumbs, { recursive: true })
  const rel = `.thumbs/${item.id}.jpg`
  const abs = join(spaceMaterialsRoot(spaceId), rel)
  const src = materialAbsolutePath(spaceId, item)
  try {
    execFileSync(ffmpeg, ['-y', '-ss', '0.8', '-i', src, '-frames:v', '1', '-q:v', '3', abs], {
      timeout: 20_000,
      stdio: 'ignore',
    })
    if (existsSync(abs) && statSync(abs).size > 32) return rel
  } catch {
    try {
      execFileSync(ffmpeg, ['-y', '-i', src, '-frames:v', '1', '-q:v', '3', abs], {
        timeout: 20_000,
        stdio: 'ignore',
      })
      if (existsSync(abs) && statSync(abs).size > 32) return rel
    } catch {
      return ''
    }
  }
  return existsSync(abs) ? rel : ''
}

export function indexPendingMaterials(spaceId: string, limit = 8): StudioMaterial[] {
  const items = listStudioMaterials(spaceId)
  let budget = Math.max(1, Math.min(20, Number(limit) || 8))
  let changed = false
  for (const item of items) {
    if (item.analysisStatus === 'ready') continue
    const needsProbe = item.kind === 'video' && !(Number(item.duration) > 0 && item.cover)
    const needsImage = item.kind === 'image' && !item.cover
    if (!needsProbe && !needsImage) continue
    if (budget <= 0) break
    budget -= 1
    const abs = materialAbsolutePath(spaceId, item)
    if (item.kind === 'video') {
      if (!(Number(item.duration) > 0)) item.duration = probeDuration(abs) || undefined
      const size = probeSize(abs)
      if (size.width) item.width = size.width
      if (size.height) item.height = size.height
      if (!item.cover) item.cover = extractCover(spaceId, item) || undefined
    } else if (item.kind === 'image') {
      item.cover = item.file
      const size = probeSize(abs)
      if (size.width) item.width = size.width
      if (size.height) item.height = size.height
    }
    item.analysisStatus = 'pending'
    changed = true
  }
  if (changed) saveCatalog(spaceId, items)
  return items
}

function guessMaterialSlot(filePath: string): MaterialSlot {
  const blob = filePath.toLowerCase()
  if (/logo|品牌|vi/.test(blob)) return 'logo'
  if (/店|门头|门店|店内|展厅|铺面|外立面/.test(blob)) return 'store'
  return 'product'
}

function expandUserPath(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (raw.startsWith('~/')) return join(homedir(), raw.slice(2))
  if (raw === '~') return homedir()
  return isAbsolute(raw) ? resolve(raw) : resolve(raw)
}

function collectMediaFiles(dir: string, depth = 0): string[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of names) {
    if (!name || name.startsWith('.')) continue
    const abs = join(dir, name)
    let info
    try {
      info = statSync(abs)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      if (depth < 1) out.push(...collectMediaFiles(abs, depth + 1))
      continue
    }
    if (!info.isFile()) continue
    const kind = materialKindFromName(name)
    if (kind === 'video' || kind === 'image') out.push(abs)
  }
  return out
}

function alreadyHaveMaterial(items: StudioMaterial[], abs: string): boolean {
  let info
  try {
    info = statSync(abs)
  } catch {
    return false
  }
  const name = basename(abs)
  return items.some(item => item.sourcePath === abs || (item.size === info.size && item.name === name))
}

export function addStudioMaterialFromFile(spaceId: string, slot: MaterialSlot, abs: string): StudioMaterial {
  if (!isMaterialSlot(slot)) throw new Error('槽位只能是产品、门店、Logo、场景背景或服装套装')
  if (!existsSync(abs)) throw new Error(`找不到文件：${abs}`)
  const info = statSync(abs)
  if (!info.isFile()) throw new Error('只能入库文件')
  if (info.size > MAX_BYTES) throw new Error('文件超过 200 MB')
  if (listStudioMaterials(spaceId).length >= LIMIT) throw new Error('每家公司最多上传 80 件素材；已有文件不会删除')
  ensureMaterialsDisk(spaceId)
  const original = safeFileName(basename(abs))
  const ext = extname(original)
  const stem = original.slice(0, Math.max(1, original.length - ext.length)) || 'file'
  const id = `mat-${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const fileName = `${stem}-${id.slice(-6)}${ext}`
  const rel = `${slot}/${fileName}`
  const dest = join(spaceMaterialsRoot(spaceId), rel)
  copyFileSync(abs, dest)
  const destInfo = statSync(dest)
  const item: StudioMaterial = {
    id,
    slot,
    name: original,
    file: rel,
    kind: materialKindFromName(original),
    at: Date.now(),
    size: destInfo.size,
    fingerprint: `${destInfo.size}:${Math.round(destInfo.mtimeMs)}`,
    analysisStatus: 'pending',
    sourcePath: abs,
  }
  const current = loadCatalog(spaceId).filter(row => row.file !== rel)
  saveCatalog(spaceId, [item, ...current])
  return listStudioMaterials(spaceId).find(row => row.id === id) || item
}

export function ingestLocalFolder(spaceId: string, folder: string, slot = ''): {
  folder: string
  imported: StudioMaterial[]
  skipped: Array<{ path: string; reason: string }>
  pending: StudioMaterial[]
} {
  const dir = expandUserPath(folder)
  if (!dir) throw new Error('请给本地文件夹路径')
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`找不到这个文件夹：${dir}`)
  const wanted = String(slot || '').trim()
  if (wanted && !isMaterialSlot(wanted)) throw new Error('槽位只能是产品、门店、Logo、场景背景或服装套装')
  const files = collectMediaFiles(dir)
  if (!files.length) {
    return losslessJson({ folder: dir, imported: [], skipped: [], pending: listStudioMaterials(spaceId).filter(item => item.analysisStatus !== 'ready') })
  }
  const imported: StudioMaterial[] = []
  const skipped: Array<{ path: string; reason: string }> = []
  for (const abs of files) {
    const existing = listStudioMaterials(spaceId)
    if (alreadyHaveMaterial(existing, abs)) {
      skipped.push({ path: abs, reason: '已经在素材库里' })
      continue
    }
    if (existing.length >= LIMIT) {
      skipped.push({ path: abs, reason: '超过 80 件上限' })
      continue
    }
    try {
      imported.push(addStudioMaterialFromFile(spaceId, wanted ? wanted as MaterialSlot : guessMaterialSlot(abs), abs))
    } catch (error: any) {
      skipped.push({ path: abs, reason: String(error?.message || error) })
    }
  }
  indexPendingMaterials(spaceId, Math.min(12, imported.length || 8))
  const pending = listStudioMaterials(spaceId).filter(item => item.analysisStatus !== 'ready')
  return losslessJson({ folder: dir, imported, skipped, pending })
}

export type MaterialAnalysisPatch = {
  slot?: string
  role?: string
  useFor?: string
  summary?: string
  environment?: string
  lighting?: string
  quality?: string
  speaker?: string
  speech?: string
}

/** 详细维度各自限长；不传的字段保留原值，便于分批补充而不丢旧内容。 */
const ANALYSIS_LIMITS = {
  useFor: 200,
  summary: 600,
  environment: 300,
  lighting: 300,
  quality: 300,
  speaker: 300,
  speech: 2000,
} as const

function analysisField(value: unknown, previous: string | undefined, limit: number): string | undefined {
  return value != null ? String(value).trim().slice(0, limit) : previous
}

export function updateStudioMaterialMeta(
  spaceId: string,
  id: string,
  patch: MaterialAnalysisPatch,
): StudioMaterial {
  const key = String(id || '').trim()
  const items = listStudioMaterials(spaceId)
  const item = items.find(row => row.id === key)
  if (!item) throw new Error('找不到这个素材')
  let slot = item.slot
  let file = item.file
  const nextSlot = String(patch.slot || '').trim()
  if (nextSlot && isMaterialSlot(nextSlot) && nextSlot !== item.slot) {
    const name = basename(item.file)
    const nextRel = `${nextSlot}/${name}`
    const from = materialAbsolutePath(spaceId, item)
    const to = join(spaceMaterialsRoot(spaceId), nextRel)
    if (existsSync(to)) throw new Error('目标槽位已有同名文件')
    renameSync(from, to)
    slot = nextSlot
    file = nextRel
  }
  const next: StudioMaterial = {
    ...item,
    slot,
    file,
    role: patch.role != null ? String(patch.role).trim() : item.role,
    useFor: analysisField(patch.useFor, item.useFor, ANALYSIS_LIMITS.useFor),
    summary: analysisField(patch.summary, item.summary, ANALYSIS_LIMITS.summary),
    environment: analysisField(patch.environment, item.environment, ANALYSIS_LIMITS.environment),
    lighting: analysisField(patch.lighting, item.lighting, ANALYSIS_LIMITS.lighting),
    quality: analysisField(patch.quality, item.quality, ANALYSIS_LIMITS.quality),
    speaker: analysisField(patch.speaker, item.speaker, ANALYSIS_LIMITS.speaker),
    speech: analysisField(patch.speech, item.speech, ANALYSIS_LIMITS.speech),
    analyzedAt: Date.now(),
    analysisStatus: 'ready',
  }
  saveCatalog(spaceId, [next, ...items.filter(row => row.id !== key)])
  return losslessJson(listStudioMaterials(spaceId).find(row => row.id === key) || next)
}

export function publicStudioMaterials(spaceId: string) {
  pruneDownloadSidecarCovers(spaceId)
  indexPendingMaterials(spaceId, 8)
  const items = listStudioMaterials(spaceId)
  const counts: Record<string, number> = { product: 0, store: 0, logo: 0, scene: 0, outfit: 0 }
  let pendingCount = 0
  let readyCount = 0
  for (const item of items) {
    counts[item.slot] += 1
    if (item.analysisStatus === 'ready') readyCount += 1
    else pendingCount += 1
  }
  const mapped = items.map(item => losslessJson({
    ...item,
    slotLabel: MATERIAL_SLOT_LABELS[item.slot],
    path: materialAbsolutePath(spaceId, item),
    coverPath: item.cover ? join(spaceMaterialsRoot(spaceId), item.cover) : '',
    url: materialPublicUrl(spaceId, item),
  }))
  return losslessJson({
    spaceId,
    root: spaceMaterialsRoot(spaceId),
    counts,
    pendingCount,
    readyCount,
    hint: '混剪只读这份目录卡，不要通读全部原片。视频素材的环境/光线/画质/说话人/说话内容只从卡上读：environment、lighting、quality、speaker、speech。pending 先看 coverPath 再用 dh_label_materials 逐项详细标注。',
    items: mapped,
    pending: mapped.filter(item => item.analysisStatus !== 'ready'),
  })
}
