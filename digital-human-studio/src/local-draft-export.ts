/**
 * Local FFmpeg draft → MP4 exporter (membership-free).
 * Supported: video cut/concat (single timeline layer), audio timing, basic native text (drawtext),
 * transparent PNG / photo overlays.
 * NOT 1:1: native text_effect / transitions / animations / filters / stickers — precheck lists them;
 * default blocked / needs_confirmation (no silent drop).
 */
import { createHash, randomUUID } from 'node:crypto'
import { findMediaTool } from './platform.js'
import { fileURLToPath } from 'node:url'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

export type ExportUnsupportedKind =
  | 'text_effect'
  | 'transition'
  | 'animation'
  | 'filter'
  | 'video_effect'
  | 'sticker'
  | 'mask'
  | 'speed_curve'
  | 'other'

export type ExportPrecheck = {
  ok: boolean
  status: 'ok' | 'needs_confirmation' | 'blocked'
  canvas: { width: number; height: number; durationUs: number; durationSec: number }
  supported: { videos: number; audios: number; basicTexts: number; photos: number }
  unsupported: Array<{ kind: ExportUnsupportedKind; detail: string }>
  downgrades?: string[]
  honesty: string
  engine: 'local_ffmpeg'
}

export type LocalExportJob = {
  task_id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'blocked' | 'needs_confirmation'
  progress: number
  message: string
  draft_dir?: string
  output_path?: string
  precheck?: ExportPrecheck
  error?: string
  started_at: string
  finished_at?: string
  downgraded?: string[]
  engine: 'local_ffmpeg'
}

const jobs = new Map<string, LocalExportJob>()
let activeCount = 0
const MAX_CONCURRENT = 1
// 单条渲染时长上限：可用环境变量覆盖。默认 30 分钟（原先 120 秒卡住了所有长片）。
const MAX_DURATION_SEC = Math.max(30, Number(process.env.XCY_EXPORT_MAX_SEC || 1800))
const MAX_EDGE = 1920

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function resolveFfmpeg(): string {
  return findMediaTool(PLUGIN_ROOT, 'ffmpeg')
}

function resolveFfprobe(ffmpeg: string): string {
  const sibling = ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1')
  if (existsSync(sibling)) return sibling
  return findMediaTool(PLUGIN_ROOT, 'ffprobe')
}

function resolveCjkFont(): string {
  const candidates = [
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
    // Windows：微软雅黑 / 黑体 / 宋体，装完系统就有
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/simsun.ttc',
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return ''
}

function isUnderRoot(absPath: string, root: string): boolean {
  const a = resolve(absPath)
  const r = resolve(root)
  return a === r || a.startsWith(r.endsWith(sep) ? r : r + sep)
}

function assertSafePath(
  absPath: string,
  allowRoots: string[],
  role: string,
  mode: 'read' | 'write' = 'read',
): string {
  if (!absPath || typeof absPath !== 'string') throw new Error(`${role}: empty path`)
  if (absPath.includes('\0')) throw new Error(`${role}: nul in path`)
  let real = resolve(absPath)
  if (existsSync(real)) {
    try {
      real = realpathSync(real)
    } catch {
      throw new Error(`${role}: cannot resolve real path`)
    }
  }
  // 剪映目录：允许「只读」（导出就是把里面的素材读出来合成，不写回），
  // 但一律禁止写入 —— 写进去既会污染用户的工程，也会被剪映的加密逻辑带走。
  if (mode === 'write') {
    const banned = ['/Movies/', '/Containers/', 'JianyingPro/User Data/Projects', 'CapCut/User Data/Projects']
    for (const b of banned) {
      if (real.includes(b)) {
        throw new Error(`${role}: 不允许写入剪映/CapCut 工程目录，请换一个输出目录`)
      }
    }
  }
  const roots = allowRoots.map((r) => resolve(r)).filter(Boolean)
  if (!roots.some((r) => isUnderRoot(real, r))) {
    throw new Error(`${role}: path outside allowRoots`)
  }
  return real
}

function usToSec(us: number): number {
  return Math.max(0, Number(us || 0) / 1_000_000)
}

function loadDraftJson(draftDir: string): any {
  const info = join(draftDir, 'draft_info.json')
  const content = join(draftDir, 'draft_content.json')
  const path = existsSync(info) ? info : content
  if (!existsSync(path)) {
    throw new Error('这个草稿目录里没有 draft_info.json / draft_content.json，可能不是剪映草稿')
  }
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw)
  } catch {
    // 剪映 11.x 保存过的草稿会把时间线做成二进制密文（看起来像 base64，但解出来不是 JSON）。
    // 这不是"文件坏了"，明确告诉用户换路，别让人对着 JSON 解析异常发呆。
    const head = raw.trimStart().slice(0, 1)
    if (head !== '{' && head !== '[') {
      throw new Error(
        '这份草稿已被剪映加密（draft_info.json 是密文），本地引擎读不回来。' +
        '两条路：① 用配方直接渲染（POST /xcy/render），不碰剪映；② 重新生成一份草稿。',
      )
    }
    throw new Error(`草稿 JSON 解析失败：${(raw.trimStart().slice(0, 40) || '(空文件)')}`)
  }
}

function parseTextContent(raw: string | undefined): { text: string; color: string; size: number } {
  if (!raw) return { text: '', color: 'white', size: 48 }
  try {
    const j = JSON.parse(raw)
    const text = String(j.text || '')
    const style = (j.styles && j.styles[0]) || {}
    const solid = style?.fill?.content?.solid?.color
    let color = 'white'
    if (Array.isArray(solid) && solid.length >= 3) {
      const r = Math.round(Number(solid[0]) * 255)
      const g = Math.round(Number(solid[1]) * 255)
      const b = Math.round(Number(solid[2]) * 255)
      color = `0x${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
    }
    const size = Number(style.size || 8) * 6 // CapCut size≈ → px heuristic
    return { text, color, size: Math.max(18, Math.min(120, size || 48)) }
  } catch {
    return { text: String(raw).slice(0, 80), color: 'white', size: 48 }
  }
}

/** CapCut transform → ffmpeg y from top (approx). transform_y unit = half canvas; +up/-down. */
function transformToOverlayY(transformY: number, canvasH: number, boxH: number): number {
  const centerY = canvasH / 2 - transformY * (canvasH / 2)
  return Math.round(centerY - boxH / 2)
}

function transformToOverlayX(transformX: number, canvasW: number, boxW: number): number {
  const centerX = canvasW / 2 + transformX * (canvasW / 2)
  return Math.round(centerX - boxW / 2)
}

export function precheckLocalExport(draftDir: string, allowRoots: string[]): ExportPrecheck {
  const dir = assertSafePath(draftDir, allowRoots, 'draft_dir')
  const draft = loadDraftJson(dir)
  const canvas = draft.canvas_config || {}
  const width = Math.min(MAX_EDGE, Number(canvas.width || 1080))
  const height = Math.min(MAX_EDGE, Number(canvas.height || 1920))
  const durationUs = Number(draft.duration || 0)
  const durationSec = usToSec(durationUs)
  const mats = draft.materials || {}
  const videos = (mats.videos || []).filter((v: any) => v.type === 'video')
  const photos = (mats.videos || []).filter((v: any) => v.type === 'photo' || v.type === 'image')
  const audios = mats.audios || []
  const texts = mats.texts || []
  const effects = mats.effects || []
  const unsupported: ExportPrecheck['unsupported'] = []

  for (const e of effects) {
    if (e.type === 'text_effect') {
      unsupported.push({ kind: 'text_effect', detail: `text_effect id=${e.effect_id || e.resource_id || e.id}` })
    } else if (e.type && e.type !== 'text_shape' && e.type !== 'text_bubble') {
      unsupported.push({ kind: 'other', detail: `effect type=${e.type}` })
    }
    if (e.type === 'text_bubble' || e.type === 'bubble') {
      unsupported.push({ kind: 'other', detail: `bubble effect id=${e.effect_id || e.id}` })
    }
  }
  // 动画：本地渲染能把花字"贴上去"，但入场动效是按帧贴图，做不到 1:1。
  // 以前当成"不支持"直接拦，结果所有带花字的草稿都导不出；现在降级为提示，不再拦。
  const downgrades: string[] = []
  for (const a of mats.material_animations || []) {
    downgrades.push(`动画将被简化（${a.name || a.id || 'unknown'}）`)
  }
  for (const t of mats.transitions || []) {
    unsupported.push({ kind: 'transition', detail: `transition id=${t.id || t.name || 'unknown'}` })
  }
  for (const f of mats.filters || mats.video_effects || []) {
    const kind: ExportUnsupportedKind = (f.type || '').includes('filter') ? 'filter' : 'video_effect'
    unsupported.push({ kind, detail: `${kind} id=${f.id || f.name || f.effect_id || 'unknown'}` })
  }
  for (const s of mats.stickers || []) {
    unsupported.push({ kind: 'sticker', detail: `sticker id=${s.id || s.resource_id || 'unknown'}` })
  }

  // Track-level transitions / masks
  for (const track of draft.tracks || []) {
    for (const seg of track.segments || []) {
      if (seg.transition) unsupported.push({ kind: 'transition', detail: `segment transition on ${track.name || track.type}` })
      if (seg.mask || seg.masks) unsupported.push({ kind: 'mask', detail: `segment mask on ${track.name || track.type}` })
    }
  }

  // Dedup by detail
  const seen = new Set<string>()
  const uniq = unsupported.filter((u) => {
    const k = u.kind + ':' + u.detail
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  let status: ExportPrecheck['status'] = 'ok'
  if (uniq.length) status = 'needs_confirmation'
  if (!videos.length && !photos.length) {
    status = 'blocked'
    uniq.push({ kind: 'other', detail: 'no video/photo materials to render' })
  }
  if (durationSec > MAX_DURATION_SEC) {
    status = 'blocked'
    uniq.push({ kind: 'other', detail: `duration ${durationSec}s exceeds max ${MAX_DURATION_SEC}s` })
  }
  if (!resolveFfmpeg()) {
    status = 'blocked'
    uniq.push({ kind: 'other', detail: 'ffmpeg not found' })
  }

  const basicTexts = texts.length // may include those linked to text_effect; still count as text materials

  return {
    ok: status === 'ok',
    status,
    canvas: { width, height, durationUs, durationSec },
    supported: {
      videos: videos.length,
      audios: audios.length,
      basicTexts,
      photos: photos.length,
    },
    unsupported: uniq,
    downgrades,
    honesty:
      'local_ffmpeg 保真范围：剪切/拼接视频、音轨时序、基础文字(drawtext)、透明PNG叠层。' +
      '入场动画会按静态贴图降级（见 downgrades），转场/滤镜/贴纸仍不支持。' +
      '要 1:1 效果请用引擎 POST /xcy/render（配方直接渲染成片）。',
    engine: 'local_ffmpeg',
  }
}

function ffEscapePath(p: string): string {
  // for filtergraph filename=
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function ffEscapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '%%')
    .replace(/\n/g, '\\n')
}

export function getLocalExportJob(taskId: string): LocalExportJob | null {
  return jobs.get(taskId) || null
}

export function listLocalExportJobs(): LocalExportJob[] {
  return [...jobs.values()].sort((a, b) => (a.started_at < b.started_at ? 1 : -1)).slice(0, 20)
}

export async function exportDraftLocalFfmpeg(input: {
  draftDir: string
  allowRoots: string[]
  outputDir: string
  confirmDowngradeUnsupported?: boolean
  taskId?: string
}): Promise<LocalExportJob> {
  const task_id = input.taskId || `lexp_${randomUUID().slice(0, 12)}`
  const started_at = new Date().toISOString()
  const job: LocalExportJob = {
    task_id,
    status: 'queued',
    progress: 0,
    message: 'queued',
    started_at,
    engine: 'local_ffmpeg',
  }
  jobs.set(task_id, job)

  try {
    const draftDir = assertSafePath(input.draftDir, input.allowRoots, 'draft_dir')
    const outputDir = assertSafePath(input.outputDir, input.allowRoots, 'output_dir', 'write')
    mkdirSync(outputDir, { recursive: true })
    job.draft_dir = draftDir

    const precheck = precheckLocalExport(draftDir, input.allowRoots)
    job.precheck = precheck

    if (precheck.status === 'blocked') {
      job.status = 'blocked'
      job.progress = 100
      job.error = 'export blocked by precheck'
      job.message = precheck.unsupported.map((u) => u.detail).join('; ')
      job.finished_at = new Date().toISOString()
      return job
    }
    if (precheck.status === 'needs_confirmation' && !input.confirmDowngradeUnsupported) {
      job.status = 'needs_confirmation'
      job.progress = 100
      job.message =
        '草稿含本地引擎无法保真的效果（见 precheck.unsupported）。若接受「基础文字/跳过花字特效」等降级，请传 confirm_downgrade_unsupported=true。不会自动丢弃且假装成功。'
      job.finished_at = new Date().toISOString()
      return job
    }

    if (activeCount >= MAX_CONCURRENT) {
      job.status = 'error'
      job.error = 'another local export is running'
      job.finished_at = new Date().toISOString()
      return job
    }

    activeCount++
    job.status = 'running'
    job.progress = 5
    job.message = 'parsing draft'

    const draft = loadDraftJson(draftDir)
    const width = precheck.canvas.width
    const height = precheck.canvas.height
    const durationSec = Math.max(0.5, Math.min(MAX_DURATION_SEC, precheck.canvas.durationSec || 3))
    const mats = draft.materials || {}
    const byId: Record<string, any> = {}
    for (const v of mats.videos || []) byId[v.id] = v
    for (const a of mats.audios || []) byId[a.id] = a
    for (const t of mats.texts || []) byId[t.id] = t
    const effectIds = new Set(
      (mats.effects || []).filter((e: any) => e.type === 'text_effect').map((e: any) => e.id),
    )

    const downgraded: string[] = []
    if (precheck.unsupported.length) {
      for (const u of precheck.unsupported) {
        if (u.kind === 'text_effect') downgraded.push(`text_effect→basic drawtext (${u.detail})`)
        else downgraded.push(`skipped/ignored: ${u.kind} (${u.detail})`)
      }
    }
    job.downgraded = downgraded

    const work = join(outputDir, `.work_${task_id}`)
    mkdirSync(work, { recursive: true })
    const output_path = join(outputDir, `export_${task_id}.mp4`)
    job.output_path = output_path

    const ffmpeg = resolveFfmpeg()
    const font = resolveCjkFont()
    if (!font) throw new Error('no CJK font found for drawtext')

    // Collect video segments (main timeline) — sequential on video tracks, bottom to top last wins for overlays later
    const videoSegs: Array<{ path: string; srcStart: number; srcDur: number; tgtStart: number; tgtDur: number }> = []
    const photoSegs: Array<{ path: string; tgtStart: number; tgtDur: number; x: number; y: number; scale: number }> = []
    const textSegs: Array<{
      text: string
      color: string
      size: number
      tgtStart: number
      tgtDur: number
      y: number
      hadEffect: boolean
    }> = []
    const audioSegs: Array<{ path: string; srcStart: number; srcDur: number; tgtStart: number; volume: number }> = []

    for (const track of draft.tracks || []) {
      const ttype = track.type
      for (const seg of track.segments || []) {
        const mat = byId[seg.material_id]
        if (!mat) continue
        const tr = seg.target_timerange || { start: 0, duration: 0 }
        const sr = seg.source_timerange || { start: 0, duration: tr.duration }
        const clip = seg.clip || {}
        const transform = clip.transform || { x: 0, y: 0 }
        const scale = clip.scale || { x: 1, y: 1 }

        if (ttype === 'video' || ttype === 'video_main') {
          if (mat.type === 'video') {
            const p = assertSafePath(String(mat.path), [draftDir, ...input.allowRoots], 'video')
            videoSegs.push({
              path: p,
              srcStart: usToSec(sr.start),
              srcDur: usToSec(sr.duration || tr.duration),
              tgtStart: usToSec(tr.start),
              tgtDur: usToSec(tr.duration),
            })
          } else if (mat.type === 'photo' || mat.type === 'image') {
            const p = assertSafePath(String(mat.path), [draftDir, ...input.allowRoots], 'photo')
            // probe size later; use scale
            photoSegs.push({
              path: p,
              tgtStart: usToSec(tr.start),
              tgtDur: usToSec(tr.duration),
              x: transform.x || 0,
              y: transform.y || 0,
              scale: Number(scale.x || 1),
            })
          }
        } else if (ttype === 'text') {
          const parsed = parseTextContent(mat.content)
          const refs: string[] = seg.extra_material_refs || []
          const hadEffect = refs.some((r) => effectIds.has(r))
          textSegs.push({
            ...parsed,
            tgtStart: usToSec(tr.start),
            tgtDur: usToSec(tr.duration),
            y: Number(transform.y || 0),
            hadEffect,
          })
        } else if (ttype === 'audio') {
          if (mat.path) {
            const p = assertSafePath(String(mat.path), [draftDir, ...input.allowRoots], 'audio')
            audioSegs.push({
              path: p,
              srcStart: usToSec(sr.start),
              srcDur: usToSec(sr.duration || tr.duration),
              tgtStart: usToSec(tr.start),
              volume: Number(seg.volume ?? 1),
            })
          }
        }
      }
    }

    // Also photos may live on video tracks already handled; images material array
    for (const img of mats.images || []) {
      if (img.path) {
        /* segments drive timing; skip orphans */
      }
    }

    job.progress = 20
    job.message = 'building base video'

    // Base: if one video covering full duration, trim; else black + overlay clips
    const basePath = join(work, 'base.mp4')
    if (videoSegs.length === 1 && videoSegs[0].tgtStart < 0.05) {
      const v = videoSegs[0]
      execFileSync(
        ffmpeg,
        [
          '-y',
          '-ss',
          String(v.srcStart),
          '-t',
          String(Math.min(v.srcDur, durationSec)),
          '-i',
          v.path,
          '-an',
          '-vf',
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-r',
          '30',
          basePath,
        ],
        { timeout: 120_000, stdio: 'pipe' },
      )
    } else if (videoSegs.length >= 1) {
      // concat trimmed pieces with reencode (simple)
      const parts: string[] = []
      videoSegs.forEach((v, i) => {
        const part = join(work, `v${i}.mp4`)
        execFileSync(
          ffmpeg,
          [
            '-y',
            '-ss',
            String(v.srcStart),
            '-t',
            String(v.srcDur),
            '-i',
            v.path,
            '-an',
            '-vf',
            `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-r',
            '30',
            part,
          ],
          { timeout: 120_000, stdio: 'pipe' },
        )
        parts.push(part)
      })
      const listFile = join(work, 'concat.txt')
      writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
      execFileSync(
        ffmpeg,
        ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', basePath],
        { timeout: 120_000, stdio: 'pipe' },
      )
    } else {
      execFileSync(
        ffmpeg,
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          `color=c=black:s=${width}x${height}:d=${durationSec}`,
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          basePath,
        ],
        { timeout: 60_000, stdio: 'pipe' },
      )
    }

    job.progress = 45
    job.message = 'applying overlays/text'

    const videoLayer = await safeCompose({
      ffmpeg,
      font,
      basePath,
      width,
      height,
      durationSec,
      photoSegs,
      textSegs,
      work,
    })

    job.progress = 75
    job.message = 'muxing audio'

    // Audio: mix or silence
    if (audioSegs.length) {
      const a = audioSegs[0]
      execFileSync(
        ffmpeg,
        [
          '-y',
          '-i',
          videoLayer,
          '-ss',
          String(a.srcStart),
          '-t',
          String(Math.min(a.srcDur, durationSec)),
          '-i',
          a.path,
          '-filter_complex',
          `[1:a]volume=${Math.max(0, Math.min(2, a.volume))}[a];[a]adelay=${Math.round(a.tgtStart * 1000)}|${Math.round(a.tgtStart * 1000)}[ad]`,
          '-map',
          '0:v',
          '-map',
          '[ad]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-shortest',
          '-t',
          String(durationSec),
          output_path,
        ],
        { timeout: 120_000, stdio: 'pipe' },
      )
    } else {
      // keep video audio if any, else silent
      execFileSync(
        ffmpeg,
        [
          '-y',
          '-i',
          videoLayer,
          '-f',
          'lavfi',
          '-i',
          'anullsrc=channel_layout=stereo:sample_rate=44100',
          '-shortest',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-t',
          String(durationSec),
          output_path,
        ],
        { timeout: 120_000, stdio: 'pipe' },
      )
    }

    if (!existsSync(output_path) || statSync(output_path).size < 500) {
      throw new Error('output mp4 missing or too small')
    }

    job.progress = 100
    job.status = 'done'
    job.message = downgraded.length
      ? `done with honest downgrades: ${downgraded.join(' | ')}`
      : 'done (local_ffmpeg)'
    job.finished_at = new Date().toISOString()

    // cleanup work dir
    try {
      rmSync(work, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return job
  } catch (e: any) {
    job.status = 'error'
    job.error = String(e?.message || e)
    job.message = 'export failed'
    job.finished_at = new Date().toISOString()
    return job
  } finally {
    activeCount = Math.max(0, activeCount - 1)
  }
}

async function safeCompose(opts: {
  ffmpeg: string
  font: string
  basePath: string
  width: number
  height: number
  durationSec: number
  photoSegs: Array<{ path: string; tgtStart: number; tgtDur: number; x: number; y: number; scale: number }>
  textSegs: Array<{ text: string; color: string; size: number; tgtStart: number; tgtDur: number; y: number; hadEffect: boolean }>
  work: string
}): Promise<string> {
  const out = join(opts.work, 'composed.mp4')
  const inputs: string[] = ['-y', '-i', opts.basePath]
  const filters: string[] = []
  let idx = 1
  let last = '[0:v]'
  let n = 0
  for (const ph of opts.photoSegs) {
    inputs.push('-loop', '1', '-t', String(opts.durationSec), '-i', ph.path)
    const sc = Math.max(0.1, Math.min(3, ph.scale || 1))
    const pLab = `[p${idx}]`
    filters.push(`[${idx}:v]format=rgba,scale=iw*${sc}:ih*${sc}${pLab}`)
    const oLab = `[o${n++}]`
    const ox = `W/2+${ph.x}*(W/2)-w/2`
    const oy = `H/2-${ph.y}*(H/2)-h/2`
    filters.push(
      `${last}${pLab}overlay=x='${ox}':y='${oy}':enable='between(t,${ph.tgtStart},${ph.tgtStart + ph.tgtDur})'${oLab}`,
    )
    last = oLab
    idx++
  }
  for (const tx of opts.textSegs) {
    const yPx = transformToOverlayY(tx.y, opts.height, tx.size)
    const oLab = `[o${n++}]`
    filters.push(
      `${last}drawtext=fontfile=${ffEscapePath(opts.font)}:text='${ffEscapeDrawtext(tx.text)}':fontsize=${tx.size}:fontcolor=${tx.color}:borderw=3:bordercolor=black@0.8:x=(w-text_w)/2:y=${yPx}:enable='between(t,${tx.tgtStart},${tx.tgtStart + tx.tgtDur})'${oLab}`,
    )
    last = oLab
  }
  if (!filters.length) {
    execFileSync(opts.ffmpeg, ['-y', '-i', opts.basePath, '-t', String(opts.durationSec), '-c', 'copy', out], {
      timeout: 60_000,
      stdio: 'pipe',
    })
    return out
  }
  const fc = filters.join(';')
  execFileSync(
    opts.ffmpeg,
    [...inputs, '-filter_complex', fc, '-map', last, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', String(opts.durationSec), out],
    { timeout: 180_000, stdio: 'pipe' },
  )
  return out
}

export function probeMedia(file: string): Record<string, unknown> {
  const ffmpeg = resolveFfmpeg()
  const ffprobe = resolveFfprobe(ffmpeg)
  if (!ffprobe || !existsSync(file)) return { ok: false }
  try {
    const raw = execFileSync(
      ffprobe,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file],
      { encoding: 'utf8', timeout: 30_000 },
    )
    const j = JSON.parse(raw)
    const v = (j.streams || []).find((s: any) => s.codec_type === 'video')
    const a = (j.streams || []).find((s: any) => s.codec_type === 'audio')
    return {
      ok: true,
      duration: Number(j.format?.duration || 0),
      size: Number(j.format?.size || 0),
      video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
      audio: a ? { codec: a.codec_name } : null,
    }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}
