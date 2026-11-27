/** Own editable styled-text engine + local raster preview/export.
 * Source params persist; PNG/MP4 are temporary renders — NOT Jianying native text_effect.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, readdirSync, statSync } from 'node:fs'
import { systemPythonNames, whichSync } from './platform.js'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { isSpaceId, spaceAssetRoot } from './spaces.js'

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RENDER_PY = join(PLUGIN_ROOT, 'tools', 'local-styled-text', 'render.py')

export const LOCAL_TEXT_STYLE_IDS = [
  'basic_stroke',
  'cream_brush_title',
  'cream_italic_subtitle',
  'cream_pop_italic',
  'tech_cyan_white',
  'warm_gold_solid',
  'energy_red_white',
  'mint_paper_tag',
  'gold_italic_subtitle',
  'gradient_gold',
  'emboss_3d',
  'multi_stroke',
  'glow_neon',
  'gradient_cyan',
] as const

export const LOCAL_TEXT_ENTRANCES = ['none', 'fade_in', 'slide_up', 'pop', 'pop_spring'] as const

export type LocalTextStyleId = (typeof LOCAL_TEXT_STYLE_IDS)[number]
export type LocalTextEntrance = (typeof LOCAL_TEXT_ENTRANCES)[number]

const MAX_TEXT_LEN = 40
const MAX_DURATION_SEC = 120
const MAX_EDGE = 1920
const MAX_LAYERS_PER_SPACE = 40
let exportActive = 0
const MAX_EXPORT_CONCURRENT = 1

const LAYER_ID_RE = /^otxt-[a-z0-9]+-[a-f0-9]+$/i
const STX_ID_RE = /^stx-[a-z0-9]+-[a-f0-9]+$/i

const HONESTY =
  '自有工具可编辑文字/样式参数（持久化后可改字再渲）。底层可临时栅格化为 PNG/叠层导出 MP4。这不是剪映原生 materials.texts / text_effect，也不等于剪映内可改字花字保真。'

export type OwnTextLayer = {
  id: string
  revision: number
  spaceId: string
  text: string
  style: LocalTextStyleId | string
  entrance: LocalTextEntrance | string
  fontSize: number
  transformX: number
  transformY: number
  startSec: number
  durationSec: number
  createdAt: number
  updatedAt: number
  kind: 'own-editable-text'
  nativeEffectId: false
  note: string
  /** last raster paths (ephemeral; always re-renderable from params) */
  lastPng?: string | null
  lastPreviewMp4?: string | null
}

function pickPython() {
  const override = process.env.LOCAL_STYLED_TEXT_PYTHON?.trim()
  const candidates = [
    override,
    ...systemPythonNames(),
    '/usr/bin/python3',
    join(homedir(), '.local/bin/python3.12'),
    join(homedir(), '.local/bin/python3.11'),
  ].filter(Boolean) as string[]
  const NAMES = systemPythonNames()
  for (const c of candidates) {
    if (!(NAMES.includes(c) || c === '/usr/bin/python3' || existsSync(c))) continue
    const probe = spawnSync(c, [RENDER_PY, '--check'], { encoding: 'utf8' })
    if (probe.status === 0) return c
  }
  for (const c of candidates) {
    if (NAMES.includes(c) || c === '/usr/bin/python3' || existsSync(c)) return c
  }
  return 'python3'
}

function resolveFfmpeg(): string {
  const env = process.env.LOCAL_STYLED_TEXT_FFMPEG?.trim()
  const candidates = [
    env,
    join(homedir(), '.local', 'bin', 'ffmpeg'),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ].filter(Boolean) as string[]
  for (const c of candidates) if (existsSync(c) || c === 'ffmpeg') {
    if (c === 'ffmpeg') {
      try {
        return whichSync('ffmpeg')
      } catch {
        continue
      }
    }
    if (existsSync(c)) return c
  }
  return ''
}

function resolveFfprobe(ffmpeg: string): string {
  const sibling = ffmpeg.replace(/ffmpeg$/, 'ffprobe')
  if (existsSync(sibling)) return sibling
  try {
    return whichSync('ffprobe')
  } catch {
    return ''
  }
}

export function localStyledTextRuntimeCheck() {
  if (!existsSync(RENDER_PY)) {
    return { ok: false, missing: ['render.py'], message: '缺少本地花字渲染脚本 tools/local-styled-text/render.py', python: '', font: '', ffmpeg: '' }
  }
  const py = pickPython()
  const r = spawnSync(py, [RENDER_PY, '--check'], { encoding: 'utf8' })
  let parsed: any = null
  try { parsed = JSON.parse((r.stdout || '').trim() || '{}') } catch { parsed = null }
  if (r.status !== 0 || !parsed?.ok) {
    return {
      ok: false,
      missing: [
        ...(parsed?.pillow ? [] : ['pillow']),
        ...(parsed?.font ? [] : ['font']),
        ...(parsed?.ffmpeg ? [] : ['ffmpeg']),
      ],
      message: String(parsed?.error || r.stderr || '本地花字运行时未就绪（需要 Pillow + 中文字体 + ffmpeg）'),
      python: py,
      font: String(parsed?.font || ''),
      ffmpeg: String(parsed?.ffmpeg || ''),
    }
  }
  return { ok: true, missing: [], python: py, font: String(parsed.font || ''), ffmpeg: String(parsed.ffmpeg || resolveFfmpeg()), message: '本地花字运行时就绪' }
}

export function listLocalTextStyles() {
  const runtime = localStyledTextRuntimeCheck()
  const py = pickPython()
  const r = spawnSync(py, [RENDER_PY, '--list-styles'], { encoding: 'utf8' })
  let catalog: any = { styles: {}, entrances: {} }
  try { catalog = JSON.parse(r.stdout || '{}') } catch {}
  return jsonSafe({
    success: true,
    runtime,
    styles: Object.entries(catalog.styles || {}).map(([id, meta]: any) => ({
      id,
      label: meta.label,
      features: meta.features,
      note: meta.note,
      kind: 'own-editable-text-style',
      nativeEffectId: false,
    })),
    entrances: Object.entries(catalog.entrances || {}).map(([id, label]) => ({ id, label })),
    honesty: HONESTY,
  })
}

function styledTextRoot(spaceId: string) {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  return join(spaceAssetRoot(spaceId), 'local-styled-text')
}

function layersDir(spaceId: string) {
  return join(styledTextRoot(spaceId), 'layers')
}

function exportsDir(spaceId: string) {
  return join(styledTextRoot(spaceId), 'exports')
}

function isUnderRoot(absPath: string, root: string): boolean {
  const a = resolve(absPath)
  const r = resolve(root)
  return a === r || a.startsWith(r.endsWith(sep) ? r : r + sep)
}

function assertInsideSpace(spaceId: string, file: string) {
  const root = resolve(styledTextRoot(spaceId))
  const target = resolve(file)
  if (!isUnderRoot(target, root)) {
    throw new Error('输出路径必须落在本公司 local-styled-text 目录内')
  }
  const banned = ['/Movies/', '/Containers/', 'JianyingPro/User Data', 'CapCut/User Data']
  for (const b of banned) {
    if (target.includes(b)) throw new Error('拒绝写入剪映/Movies/Containers')
  }
  return target
}

function clampNum(n: number, lo: number, hi: number, fallback: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(hi, Math.max(lo, v))
}

function validateStyle(style: string): string {
  const s = String(style || '').trim()
  if (!(LOCAL_TEXT_STYLE_IDS as readonly string[]).includes(s)) {
    throw new Error(`样式不在白名单: ${s}`)
  }
  return s
}

function validateEntrance(entrance: string): string {
  const e = String(entrance || 'fade_in').trim() || 'fade_in'
  if (!(LOCAL_TEXT_ENTRANCES as readonly string[]).includes(e)) {
    throw new Error(`入场动画不在白名单: ${e}`)
  }
  return e
}

function validateText(text: string): string {
  const t = String(text || '').trim()
  if (!t) throw new Error('请提供中文或文本内容')
  if (t.length > MAX_TEXT_LEN) throw new Error(`单次最多 ${MAX_TEXT_LEN} 字`)
  return t
}

function newLayerId(): string {
  return `otxt-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
}

function layerPath(spaceId: string, id: string) {
  return join(layersDir(spaceId), `${id}.json`)
}

function writeLayerAtomic(spaceId: string, layer: OwnTextLayer) {
  const dir = layersDir(spaceId)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const final = assertInsideSpace(spaceId, layerPath(spaceId, layer.id))
  const tmp = final + `.tmp-${randomBytes(4).toString('hex')}`
  writeFileSync(tmp, JSON.stringify(layer, null, 2), { mode: 0o600 })
  renameSync(tmp, final)
}

function readLayerFile(spaceId: string, id: string): OwnTextLayer {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  if (!LAYER_ID_RE.test(id)) throw new Error('无效自有文字层 id')
  const p = layerPath(spaceId, id)
  if (!existsSync(p)) throw new Error('找不到本公司自有文字层')
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  if (raw.spaceId !== spaceId) throw new Error('跨公司层拒绝')
  return raw as OwnTextLayer
}

/** One-shot raster (legacy stx-*). Still persists meta but not revisioned own-text layer. */
export function renderLocalStyledText(input: {
  spaceId: string
  text: string
  style: string
  entrance?: string
  withPreviewVideo?: boolean
  fontSize?: number
}) {
  const runtime = localStyledTextRuntimeCheck()
  if (!runtime.ok) {
    return jsonSafe({ success: false, error: runtime.message, missing: runtime.missing || [], runtime })
  }
  const spaceId = String(input.spaceId || '').trim()
  if (!isSpaceId(spaceId)) return jsonSafe({ success: false, error: '非法公司' })
  let style: string
  let entrance: string
  let text: string
  try {
    style = validateStyle(input.style)
    entrance = validateEntrance(input.entrance || 'fade_in')
    text = validateText(input.text)
  } catch (e: any) {
    return jsonSafe({ success: false, error: String(e?.message || e) })
  }

  const dir = styledTextRoot(spaceId)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const id = `stx-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  const png = join(dir, `${id}.png`)
  const mp4 = join(dir, `${id}-preview.mp4`)
  const meta = join(dir, `${id}.json`)
  assertInsideSpace(spaceId, png)
  assertInsideSpace(spaceId, mp4)

  const py = pickPython()
  const args = [
    RENDER_PY,
    '--text', text,
    '--style', style,
    '--entrance', entrance,
    '--out-png', png,
    '--font-size', String(Math.min(160, Math.max(36, Number(input.fontSize) || 96))),
  ]
  if (input.withPreviewVideo !== false) args.push('--out-mp4', mp4)
  const r = spawnSync(py, args, { encoding: 'utf8' })
  let parsed: any = null
  try { parsed = JSON.parse((r.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}') } catch { parsed = null }
  if (r.status !== 0 || !parsed?.success) {
    let err = parsed?.error
    if (!err) {
      try { err = JSON.parse((r.stderr || '').trim()).error } catch { err = r.stderr || '渲染失败' }
    }
    return jsonSafe({ success: false, error: String(err), runtime })
  }

  const record = {
    id,
    spaceId,
    text,
    style,
    entrance,
    png,
    previewMp4: existsSync(mp4) ? mp4 : null,
    createdAt: Date.now(),
    kind: 'local-raster-overlay',
    nativeEffectId: false as const,
    note: HONESTY,
  }
  writeFileSync(meta, JSON.stringify(record, null, 2), { mode: 0o600 })
  return jsonSafe({ success: true, item: record, honesty: HONESTY })
}

export function readLocalStyledTextMeta(spaceId: string, id: string) {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  if (LAYER_ID_RE.test(id)) return readLayerFile(spaceId, id)
  if (!STX_ID_RE.test(id)) throw new Error('无效样式成品 id')
  const meta = join(styledTextRoot(spaceId), `${id}.json`)
  if (!existsSync(meta)) throw new Error('找不到本公司本地花字成品')
  return JSON.parse(readFileSync(meta, 'utf8'))
}

function rasterizeLayerToPng(layer: OwnTextLayer, outPng: string, opts?: { maxOutWidth?: number; renderWidth?: number }): void {
  assertInsideSpace(layer.spaceId, outPng)
  const py = pickPython()
  const args = [
    RENDER_PY,
    '--text', layer.text,
    '--style', String(layer.style),
    '--entrance', 'none',
    '--out-png', outPng,
    '--font-size', String(layer.fontSize),
  ]
  const rw = Math.max(320, Math.round(Number(opts?.renderWidth) || 1080))
  args.push('--width', String(rw), '--height', String(Math.max(240, Math.round(rw * 0.45))))
  const maxW = Math.round(Number(opts?.maxOutWidth) || 0)
  if (maxW > 0) args.push('--max-out-width', String(maxW))
  const r = spawnSync(py, args, { encoding: 'utf8' })
  let parsed: any = null
  try { parsed = JSON.parse((r.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}') } catch { parsed = null }
  if (r.status !== 0 || !parsed?.success || !existsSync(outPng)) {
    let err = parsed?.error
    if (!err) {
      try { err = JSON.parse((r.stderr || '').trim()).error } catch { err = r.stderr || '栅格化失败' }
    }
    throw new Error(String(err))
  }
}

/** Add editable own-text layer (params persisted; raster optional). */
export function addOwnTextLayer(input: {
  spaceId: string
  text: string
  style: string
  entrance?: string
  fontSize?: number
  transformX?: number
  transformY?: number
  startSec?: number
  durationSec?: number
  renderPreview?: boolean
}) {
  const runtime = localStyledTextRuntimeCheck()
  if (!runtime.ok) {
    return jsonSafe({ success: false, error: runtime.message, missing: runtime.missing || [], runtime })
  }
  const spaceId = String(input.spaceId || '').trim()
  if (!isSpaceId(spaceId)) return jsonSafe({ success: false, error: '非法公司' })
  try {
    const existing = listOwnTextLayers(spaceId)
    if (existing.layers.length >= MAX_LAYERS_PER_SPACE) {
      return jsonSafe({ success: false, error: `本公司最多 ${MAX_LAYERS_PER_SPACE} 层自有文字` })
    }
    const now = Date.now()
    const layer: OwnTextLayer = {
      id: newLayerId(),
      revision: 1,
      spaceId,
      text: validateText(input.text),
      style: validateStyle(input.style),
      entrance: validateEntrance(input.entrance || 'fade_in'),
      fontSize: clampNum(input.fontSize ?? 96, 36, 160, 96),
      transformX: clampNum(input.transformX ?? 0, -1, 1, 0),
      transformY: clampNum(input.transformY ?? -0.55, -1, 1, -0.55),
      startSec: clampNum(input.startSec ?? 0, 0, MAX_DURATION_SEC - 0.2, 0),
      durationSec: clampNum(input.durationSec ?? 3, 0.3, MAX_DURATION_SEC, 3),
      createdAt: now,
      updatedAt: now,
      kind: 'own-editable-text',
      nativeEffectId: false,
      note: HONESTY,
      lastPng: null,
      lastPreviewMp4: null,
    }
    if (layer.startSec + layer.durationSec > MAX_DURATION_SEC) {
      layer.durationSec = MAX_DURATION_SEC - layer.startSec
    }
    writeLayerAtomic(spaceId, layer)

    if (input.renderPreview !== false) {
      const dir = styledTextRoot(spaceId)
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const png = join(dir, `${layer.id}.r${layer.revision}.png`)
      const mp4 = join(dir, `${layer.id}.r${layer.revision}-preview.mp4`)
      rasterizeLayerToPng(layer, png)
      // short preview video with entrance
      const py = pickPython()
      const pr = spawnSync(
        py,
        [RENDER_PY, '--text', layer.text, '--style', String(layer.style), '--entrance', String(layer.entrance), '--out-png', png, '--out-mp4', mp4, '--font-size', String(layer.fontSize)],
        { encoding: 'utf8' },
      )
      if (pr.status === 0 && existsSync(mp4)) layer.lastPreviewMp4 = mp4
      layer.lastPng = png
      writeLayerAtomic(spaceId, layer)
    }
    return jsonSafe({ success: true, layer, honesty: HONESTY })
  } catch (e: any) {
    return jsonSafe({ success: false, error: String(e?.message || e) })
  }
}

const PATCH_WHITELIST = new Set([
  'text', 'style', 'entrance', 'fontSize', 'transformX', 'transformY', 'startSec', 'durationSec',
])

/** Update own-text layer; requires expectedRevision for optimistic concurrency. */
export function updateOwnTextLayer(input: {
  spaceId: string
  id: string
  expectedRevision: number
  patch: Record<string, unknown>
  renderPreview?: boolean
}) {
  const spaceId = String(input.spaceId || '').trim()
  if (!isSpaceId(spaceId)) return jsonSafe({ success: false, error: '非法公司' })
  try {
    const layer = readLayerFile(spaceId, String(input.id || ''))
    if (Number(input.expectedRevision) !== Number(layer.revision)) {
      return jsonSafe({
        success: false,
        error: 'revision 冲突',
        currentRevision: layer.revision,
        expectedRevision: input.expectedRevision,
      })
    }
    const patch = input.patch || {}
    for (const k of Object.keys(patch)) {
      if (!PATCH_WHITELIST.has(k)) {
        return jsonSafe({ success: false, error: `字段不在白名单: ${k}` })
      }
    }
    if (patch.text != null) layer.text = validateText(String(patch.text))
    if (patch.style != null) layer.style = validateStyle(String(patch.style))
    if (patch.entrance != null) layer.entrance = validateEntrance(String(patch.entrance))
    if (patch.fontSize != null) layer.fontSize = clampNum(Number(patch.fontSize), 36, 160, layer.fontSize)
    if (patch.transformX != null) layer.transformX = clampNum(Number(patch.transformX), -1, 1, layer.transformX)
    if (patch.transformY != null) layer.transformY = clampNum(Number(patch.transformY), -1, 1, layer.transformY)
    if (patch.startSec != null) layer.startSec = clampNum(Number(patch.startSec), 0, MAX_DURATION_SEC - 0.2, layer.startSec)
    if (patch.durationSec != null) layer.durationSec = clampNum(Number(patch.durationSec), 0.3, MAX_DURATION_SEC, layer.durationSec)
    if (layer.startSec + layer.durationSec > MAX_DURATION_SEC) {
      layer.durationSec = Math.max(0.3, MAX_DURATION_SEC - layer.startSec)
    }
    layer.revision = Number(layer.revision) + 1
    layer.updatedAt = Date.now()

    if (input.renderPreview !== false) {
      const dir = styledTextRoot(spaceId)
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const png = join(dir, `${layer.id}.r${layer.revision}.png`)
      const mp4 = join(dir, `${layer.id}.r${layer.revision}-preview.mp4`)
      const py = pickPython()
      const pr = spawnSync(
        py,
        [RENDER_PY, '--text', layer.text, '--style', String(layer.style), '--entrance', String(layer.entrance), '--out-png', png, '--out-mp4', mp4, '--font-size', String(layer.fontSize)],
        { encoding: 'utf8' },
      )
      let parsed: any = null
      try { parsed = JSON.parse((pr.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}') } catch {}
      if (pr.status !== 0 || !parsed?.success) {
        // params already bumped in memory — persist params anyway but report preview fail
        writeLayerAtomic(spaceId, layer)
        return jsonSafe({
          success: true,
          layer,
          previewError: String(parsed?.error || pr.stderr || '预览渲染失败'),
          honesty: HONESTY,
        })
      }
      layer.lastPng = png
      layer.lastPreviewMp4 = existsSync(mp4) ? mp4 : null
    }
    writeLayerAtomic(spaceId, layer)
    return jsonSafe({ success: true, layer, honesty: HONESTY })
  } catch (e: any) {
    return jsonSafe({ success: false, error: String(e?.message || e) })
  }
}

export function listOwnTextLayers(spaceId: string, id?: string) {
  if (!isSpaceId(spaceId)) return jsonSafe({ success: false, error: '非法公司', layers: [] as OwnTextLayer[] })
  try {
    if (id) {
      const layer = readLayerFile(spaceId, id)
      return jsonSafe({ success: true, layers: [layer], honesty: HONESTY })
    }
    const dir = layersDir(spaceId)
    if (!existsSync(dir)) return jsonSafe({ success: true, layers: [], honesty: HONESTY })
    const layers: OwnTextLayer[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json') || name.includes('.tmp-')) continue
      const lid = name.replace(/\.json$/, '')
      if (!LAYER_ID_RE.test(lid)) continue
      try {
        const L = readLayerFile(spaceId, lid)
        layers.push(L)
      } catch { /* skip corrupt */ }
    }
    layers.sort((a, b) => a.createdAt - b.createdAt)
    return jsonSafe({ success: true, layers, honesty: HONESTY })
  } catch (e: any) {
    return jsonSafe({ success: false, error: String(e?.message || e), layers: [] })
  }
}

function ffEscapePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/** Compose final MP4 from own-text layer source params (re-rasterize; animations visible). */
export function exportOwnTextComposition(input: {
  spaceId: string
  layerIds?: string[]
  width?: number
  height?: number
  durationSec?: number
  bgColor?: string
  taskId?: string
}) {
  const runtime = localStyledTextRuntimeCheck()
  if (!runtime.ok) {
    return jsonSafe({ success: false, error: runtime.message, missing: runtime.missing || [], runtime })
  }
  const spaceId = String(input.spaceId || '').trim()
  if (!isSpaceId(spaceId)) return jsonSafe({ success: false, error: '非法公司' })
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) return jsonSafe({ success: false, error: 'ffmpeg not found' })

  if (exportActive >= MAX_EXPORT_CONCURRENT) {
    return jsonSafe({ success: false, error: 'another own-text export is running' })
  }

  const width = Math.min(MAX_EDGE, Math.max(320, Math.round(Number(input.width) || 720)))
  const height = Math.min(MAX_EDGE, Math.max(320, Math.round(Number(input.height) || 1280)))
  let durationSec = clampNum(input.durationSec ?? 8, 1, MAX_DURATION_SEC, 8)
  const bg = String(input.bgColor || '0x1a2030').replace(/[^0-9a-fxA-F]/g, '') || '0x1a2030'
  const taskId = input.taskId || `otexp_${Date.now().toString(36)}_${randomBytes(2).toString('hex')}`

  try {
    exportActive++
    const listed = listOwnTextLayers(spaceId)
    if (!listed.success) return listed
    let layers = listed.layers as OwnTextLayer[]
    if (input.layerIds?.length) {
      const want = new Set(input.layerIds.map(String))
      layers = layers.filter((L) => want.has(L.id))
      if (layers.length !== want.size) {
        return jsonSafe({ success: false, error: '部分 layerIds 不属于本公司或不存在' })
      }
    }
    if (!layers.length) return jsonSafe({ success: false, error: '无自有文字层可导出' })

    // auto-extend duration to cover layers
    const need = Math.max(...layers.map((L) => L.startSec + L.durationSec), durationSec)
    durationSec = Math.min(MAX_DURATION_SEC, Math.max(durationSec, need))

    const outRoot = exportsDir(spaceId)
    mkdirSync(outRoot, { recursive: true, mode: 0o700 })
    assertInsideSpace(spaceId, outRoot)
    const work = join(outRoot, `.work_${taskId}`)
    mkdirSync(work, { recursive: true, mode: 0o700 })
    const output_path = join(outRoot, `own_text_${taskId}.mp4`)
    // never overwrite: unique taskId
    if (existsSync(output_path)) {
      return jsonSafe({ success: false, error: 'output path collision' })
    }

    // raster each layer from current params
    const rasters: Array<{ layer: OwnTextLayer; png: string }> = []
    // Leave margin for pop_spring overshoot (~1.18) + side safe pad
    const springBudget = 1.2
    const maxOutWidth = Math.max(200, Math.floor((width / springBudget) * 0.96))
    for (const L of layers) {
      const png = join(work, `${L.id}.png`)
      rasterizeLayerToPng(L, png, { maxOutWidth, renderWidth: Math.max(width, maxOutWidth + 80) })
      rasters.push({ layer: L, png })
      // refresh lastPng pointer (params unchanged)
      L.lastPng = join(styledTextRoot(spaceId), `${L.id}.r${L.revision}.png`)
      try {
        // copy stable snapshot next to layer meta (optional)
        execFileSync('/bin/cp', ['-f', png, L.lastPng], { stdio: 'pipe' })
        writeLayerAtomic(spaceId, L)
      } catch { /* non-fatal */ }
    }

    // build ffmpeg filter: background + animated overlays
    const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error']
    args.push('-f', 'lavfi', '-i', `color=c=${bg}:s=${width}x${height}:d=${durationSec}:r=30`)
    for (const r of rasters) {
      args.push('-loop', '1', '-t', String(durationSec), '-i', r.png)
    }
    // silent audio
    args.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`)

    const filters: string[] = []
    let last = '[0:v]'
    rasters.forEach((r, i) => {
      const idx = i + 1
      const L = r.layer
      const st = L.startSec
      const en = L.startSec + L.durationSec
      const ox = `(W-w)/2+(${L.transformX})*(W/2)`
      // CapCut-like: +transformY moves up
      const baseY = `(H-h)/2-(${L.transformY})*(H/2)`
      let prep = `[${idx}:v]format=rgba`
      if (L.entrance === 'fade_in' || L.entrance === 'pop' || L.entrance === 'pop_spring') {
        prep += `,fade=t=in:st=${st}:d=0.12:alpha=1`
      }
      if (L.entrance === 'pop_spring') {
        const sx =
          `iw*if(lt(t-${st},0.10),0.70+4.8*(t-${st}),if(lt(t-${st},0.18),1.18,if(lt(t-${st},0.28),1.18-1.8*((t-${st})-0.18),1.0)))`.replace(
            /,/g,
            '\\,',
          )
        const sy =
          `ih*if(lt(t-${st},0.10),0.70+4.8*(t-${st}),if(lt(t-${st},0.18),1.18,if(lt(t-${st},0.28),1.18-1.8*((t-${st})-0.18),1.0)))`.replace(
            /,/g,
            '\\,',
          )
        prep += `,scale=${sx}:${sy}:eval=frame`
      }
      const lab = `[t${i}]`
      filters.push(`${prep}${lab}`)
      let yExpr = baseY
      if (L.entrance === 'slide_up') {
        yExpr = `${baseY}+if(lt(t-${st}\,0.45)\,(H*0.28)*(1-(t-${st})/0.45)\,0)`
      } else if (L.entrance === 'pop') {
        // slight drop-in
        yExpr = `${baseY}+if(lt(t-${st}\,0.3)\,(H*0.06)*(1-(t-${st})/0.3)\,0)`
      } else if (L.entrance === 'pop_spring') {
        // springy settle from below + slight overshoot in Y (scale spring via pre-rendered clip when available)
        yExpr = `${baseY}+if(lt(t-${st}\,0.12)\,(H*0.10)*(1-(t-${st})/0.12)\,if(lt(t-${st}\,0.22)\,-H*0.012\,0))`
      }
      const oLab = `[o${i}]`
      filters.push(
        `${last}${lab}overlay=x='${ox}':y='${yExpr}':enable='between(t\\,${st}\\,${en})':format=auto${oLab}`,
      )
      last = oLab
    })
    const audioIdx = rasters.length + 1
    const fc = filters.join(';')
    const tmpOut = join(work, 'out.mp4')
    execFileSync(
      ffmpeg,
      [
        ...args,
        '-filter_complex', fc,
        '-map', last,
        '-map', `${audioIdx}:a`,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-shortest',
        '-t', String(durationSec),
        tmpOut,
      ],
      { timeout: 180_000, stdio: 'pipe' },
    )
    if (!existsSync(tmpOut) || statSync(tmpOut).size < 500) {
      throw new Error('export mp4 missing or too small')
    }
    renameSync(tmpOut, output_path)

    // probe
    const ffprobe = resolveFfprobe(ffmpeg)
    let probe: any = null
    if (ffprobe) {
      try {
        const raw = execFileSync(
          ffprobe,
          ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', output_path],
          { encoding: 'utf8', timeout: 30_000 },
        )
        const j = JSON.parse(raw)
        const v = (j.streams || []).find((s: any) => s.codec_type === 'video')
        const a = (j.streams || []).find((s: any) => s.codec_type === 'audio')
        probe = {
          duration: Number(j.format?.duration || 0),
          size: Number(j.format?.size || 0),
          video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
          audio: a ? { codec: a.codec_name } : null,
        }
      } catch { /* ignore */ }
    }

    try { rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }

    return jsonSafe({
      success: true,
      task_id: taskId,
      output_path,
      probe,
      layers: layers.map((L) => ({
        id: L.id,
        revision: L.revision,
        text: L.text,
        style: L.style,
        entrance: L.entrance,
        startSec: L.startSec,
        durationSec: L.durationSec,
        transformX: L.transformX,
        transformY: L.transformY,
      })),
      canvas: { width, height, durationSec },
      honesty: HONESTY,
      engine: 'own_text_local_ffmpeg',
      note: '最终 MP4 动画由同一源参数驱动；非剪映原生 text_effect。',
    })
  } catch (e: any) {
    return jsonSafe({ success: false, error: String(e?.message || e), honesty: HONESTY })
  } finally {
    exportActive = Math.max(0, exportActive - 1)
  }
}


/** Native CapCut/Jianying text expressible via Xiaocongcut /add_text (solid+border+shadow+intro). No gradient/glow/multi-stroke engines. */
export type NativeFidelity = 'supported' | 'approx' | 'unsupported'

export type NativeStyleMapping = {
  style: string
  fidelity: NativeFidelity
  native: {
    font_color: string
    border_color: string
    border_width: number
    shadow_enabled: boolean
    font_size: number
    intro_animation?: string | null
  }
  gaps: string[]
  note: string
}

const NATIVE_ENTRANCE: Record<string, { intro: string | null; fidelity: NativeFidelity; gap?: string }> = {
  none: { intro: null, fidelity: 'supported' },
  fade_in: { intro: 'Fade_In', fidelity: 'supported' },
  slide_up: { intro: 'Slide_Up', fidelity: 'supported' },
  pop: { intro: 'Mini_Zoom', fidelity: 'approx', gap: 'pop→Mini_Zoom（非 Pop_Up；本机 CapCut 文本入场近似）' },
  pop_spring: { intro: 'Mini_Zoom', fidelity: 'approx', gap: 'pop_spring→Mini_Zoom（弹性过冲无法原生表达）' },
}

function mapFontSizeToNative(fontSize: number): number {
  return Math.max(5, Math.min(18, Math.round((Number(fontSize) || 96) / 10)))
}

/** Map own raster style → native /add_text params. Never claims gradient/glow/multi-stroke fidelity. */
export function mapOwnStyleToNative(layer: Pick<OwnTextLayer, 'style' | 'entrance' | 'fontSize'>): NativeStyleMapping {
  const style = String(layer.style)
  const font_size = mapFontSizeToNative(layer.fontSize)
  const ent = NATIVE_ENTRANCE[String(layer.entrance)] || NATIVE_ENTRANCE.fade_in
  const baseGaps: string[] = []
  if (ent.gap) baseGaps.push(ent.gap)

  const withEntrance = (m: Omit<NativeStyleMapping, 'native'> & { native: Omit<NativeStyleMapping['native'], 'intro_animation' | 'font_size'> }) => ({
    ...m,
    native: {
      ...m.native,
      font_size,
      intro_animation: ent.intro,
    },
    gaps: [...m.gaps, ...baseGaps],
    fidelity: m.fidelity === 'supported' && ent.fidelity === 'approx' ? 'approx' : m.fidelity,
  })

  if (style === 'basic_stroke') {
    return withEntrance({
      style,
      fidelity: 'supported',
      native: { font_color: '#FFFFFF', border_color: '#000000', border_width: 40, shadow_enabled: false },
      gaps: [],
      note: '基础描边：原生 solid 白字+黑描边，与本地样式意图一致。',
    })
  }
  if (style === 'multi_stroke') {
    return withEntrance({
      style,
      fidelity: 'approx',
      native: { font_color: '#FFFFFF', border_color: '#FF50A0', border_width: 55, shadow_enabled: false },
      gaps: ['多层彩色描边无法用单一 border 表达 → 单层粉色描边近似'],
      note: '近似：原生仅单描边。',
    })
  }
  if (['cream_pop_italic','tech_cyan_white','warm_gold_solid','energy_red_white','mint_paper_tag'].includes(style)) {
    return withEntrance({
      style,
      fidelity: 'approx',
      native: { font_color: '#FFFFFF', border_color: '#333333', border_width: 36, shadow_enabled: true },
      gaps: ['原创本地栅格花字 → 原生仅 solid+描边近似，不自动导出原生'],
      note: '原创自有引擎样式；对照交付走本地栅格。',
    })
  }
  if (style === 'cream_brush_title') {
    return withEntrance({
      style,
      fidelity: 'approx',
      native: { font_color: '#F5E6B8', border_color: '#5C3A1E', border_width: 28, shadow_enabled: true },
      gaps: ['毛笔字+奶白填充无法用原生花字保真 → 仅 solid 近似'],
      note: '近似：标题对照走本地栅格，不自动原生导出。',
    })
  }
  if (style === 'cream_italic_subtitle' || style === 'gold_italic_subtitle') {
    return withEntrance({
      style,
      fidelity: 'approx',
      native: { font_color: '#F0E0B0', border_color: '#5C371C', border_width: 36, shadow_enabled: true },
      gaps: ['奶白斜体+棕描边 → 原生仅 solid+描边+阴影；斜体/字形无法保真'],
      note: '近似：字幕对照走本地栅格；gold_italic_subtitle 已在本地改为奶白斜体实现。',
    })
  }
  if (style === 'gradient_gold') {
    return withEntrance({
      style,
      fidelity: 'approx',
      native: { font_color: '#E6B422', border_color: '#4A2800', border_width: 40, shadow_enabled: false },
      gaps: ['金色渐变填充 → 固态 #E6B422，无纵向渐变'],
      note: '近似：原生无渐变引擎。',
    })
  }
  if (style === 'gradient_cyan') {
    return withEntrance({
      style,
      fidelity: 'approx',
      native: { font_color: '#3EC8D0', border_color: '#003850', border_width: 40, shadow_enabled: false },
      gaps: ['青蓝渐变 → 固态 #3EC8D0'],
      note: '近似：原生无渐变引擎。',
    })
  }
  if (style === 'glow_neon') {
    return withEntrance({
      style,
      fidelity: 'approx',
      native: { font_color: '#96FFE8', border_color: '#00A090', border_width: 35, shadow_enabled: true },
      gaps: ['霓虹外发光/模糊光晕无法原生表达 → 亮色+阴影近似'],
      note: '近似：非真实 glow。',
    })
  }
  if (style === 'emboss_3d') {
    return withEntrance({
      style,
      fidelity: 'approx',
      native: { font_color: '#E8C878', border_color: '#402810', border_width: 40, shadow_enabled: true },
      gaps: ['多层浮雕偏移无法原生表达 → 描边+阴影近似'],
      note: '近似：非立体浮雕。',
    })
  }
  return {
    style,
    fidelity: 'unsupported',
    native: { font_color: '#FFFFFF', border_color: '#000000', border_width: 0, shadow_enabled: false, font_size, intro_animation: null },
    gaps: [`样式 ${style} 无原生映射`],
    note: '不支持：拒绝静默写入错误样式。',
  }
}

export function precheckOwnTextNativeExport(layers: OwnTextLayer[]) {
  const report = layers.map((L) => {
    const mapping = mapOwnStyleToNative(L)
    return {
      layer_id: L.id,
      revision: L.revision,
      text: L.text,
      style: L.style,
      entrance: L.entrance,
      fidelity: mapping.fidelity,
      gaps: mapping.gaps,
      note: mapping.note,
      native: mapping.native,
      transformX: L.transformX,
      transformY: L.transformY,
      startSec: L.startSec,
      durationSec: L.durationSec,
    }
  })
  const hasUnsupported = report.some((r) => r.fidelity === 'unsupported')
  const hasApprox = report.some((r) => r.fidelity === 'approx')
  let status: 'ok' | 'needs_confirmation' | 'blocked' = 'ok'
  if (hasApprox) status = 'needs_confirmation'
  if (hasUnsupported) status = 'blocked'
  return jsonSafe({
    success: true,
    status,
    hasApprox,
    hasUnsupported,
    layers: report,
    honesty:
      '原生路经 Xiaocongcut /add_text 写入 materials.texts 明文（可改字结构），不是 PNG。本地 MP4 仍是自有栅格引擎。渐变/霓虹/多层描边/浮雕在原生侧最多近似，需 accept_native_approx=true。UI 是否可编辑需真实剪映打开验收，结构检查≠UI完成。',
  })
}
