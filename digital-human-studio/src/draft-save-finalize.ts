/** Post-save hardening: rebase/verify all local media under the draft dir; content mirrors; cover. */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { findMediaTool } from './platform.js'

function looksForeignTemplatePath(p: string) {
  return /\/Users\/sunguannan\//.test(p) || /\/0707$/.test(p)
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const c = resolve(candidate)
  const r = resolve(root)
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep)
}

function asFilePath(urlOrPath: string): string | null {
  if (!urlOrPath) return null
  const raw = String(urlOrPath).trim()
  if (/^https?:\/\//i.test(raw)) return null
  let path = raw
  if (/^file:\/\//i.test(raw)) {
    let rest = raw.slice('file://'.length)
    if (rest.startsWith('localhost/')) rest = rest.slice('localhost'.length)
    else if (rest.startsWith('localhost')) rest = rest.slice('localhost'.length)
    path = rest.startsWith('/') ? rest : `/${rest}`
  }
  path = resolve(path)
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null
    // Reject unbound symlinks that escape when possible
    const real = realpathSync(path)
    return real
  } catch {
    return null
  }
}

function ensureContentMirrors(draftDir: string, contentFile: string, contentBody: string) {
  const written: string[] = []
  const mirrors =
    contentFile === 'draft_content.json'
      ? ['draft_content.json.bak', 'template-2.tmp', 'template.tmp']
      : ['draft_info.json.bak', 'template-2.tmp', 'template.tmp', 'draft_content.json']
  for (const name of mirrors) {
    if (name === contentFile) continue
    const dest = join(draftDir, name)
    writeFileSync(dest, contentBody, 'utf8')
    written.push(dest)
  }
  return written
}

function findFfmpeg(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const fromPlatform = findMediaTool(resolve(here, '..'), 'ffmpeg')
  if (fromPlatform) {
    const r = spawnSync(fromPlatform, ['-version'], { encoding: 'utf8' })
    if (r.status === 0) return fromPlatform
  }
  const candidates = [
    resolve(here, '../vendor/runtime/bin/ffmpeg'),
    resolve(here, '../../vendor/runtime/bin/ffmpeg'),
    resolve(here, '../runtime/bin/ffmpeg'),
    resolve(here, '../../runtime/bin/ffmpeg'),
    'ffmpeg',
    '/Users/jiacong/.local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ]
  for (const c of candidates) {
    const r = spawnSync(c, ['-version'], { encoding: 'utf8' })
    if (r.status === 0) return c
  }
  return null
}

function tryExtractCoverFromVideo(draftDir: string): { cover: string; fromVideo: string } | null {
  const videoDir = join(draftDir, 'assets', 'video')
  if (!existsSync(videoDir)) return null
  const videos = readdirSync(videoDir)
    .filter((n) => /\.(mp4|mov|mkv|webm)$/i.test(n))
    .map((n) => join(videoDir, n))
    .filter((p) => existsSync(p) && statSync(p).size > 0)
  if (!videos.length) return null
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) return null
  const cover = join(draftDir, 'draft_cover.jpg')
  const src = videos[0]
  const r = spawnSync(
    ffmpeg,
    ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0.1', '-i', src, '-frames:v', '1', '-q:v', '4', cover],
    { encoding: 'utf8' },
  )
  if (r.status !== 0 || !existsSync(cover) || statSync(cover).size < 32) {
    try {
      if (existsSync(cover)) unlinkSync(cover)
    } catch {
      /* ignore */
    }
    return null
  }
  return { cover, fromVideo: src }
}

function assetKind(mat: any): 'video' | 'audio' | 'image' | 'unknown' {
  const type = String(mat?.type || mat?.material_type || '').toLowerCase()
  if (type === 'photo' || type === 'image') return 'image'
  if (type === 'video') return 'video'
  if (type === 'audio' || type === 'music') return 'audio'
  const name = String(mat?.material_name || mat?.path || '')
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) return 'image'
  if (/\.(mp4|mov|mkv|webm|avi)$/i.test(name)) return 'video'
  if (/\.(mp3|wav|m4a|aac|flac)$/i.test(name)) return 'audio'
  return 'unknown'
}

function fileSha256(p: string): string {
  const h = createHash('sha256')
  h.update(readFileSync(p))
  return h.digest('hex')
}

/**
 * Resolve a material onto a file that truly lives under this draft's assets/.
 * Never binds by basename to a file outside the draft root.
 */
function resolveMaterialOnDisk(
  root: string,
  mat: any,
): { ok: true; absPath: string; kind: 'video' | 'audio' | 'image'; rewritten: boolean } | { ok: false; missing: string; kind: string } {
  const kind = assetKind(mat)
  if (kind === 'unknown') {
    return { ok: false, missing: String(mat?.material_name || mat?.path || 'unknown'), kind }
  }
  const sub = kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'audio'
  const assetsDir = join(root, 'assets', sub)
  mkdirSync(assetsDir, { recursive: true })

  const pathField = String(mat.path || '')
  const remote = String(mat.remote_url || '')
  const base = basename(pathField || mat.material_name || '')
  if (!base) return { ok: false, missing: '(empty name)', kind }

  const expected = join(assetsDir, base)

  // 1) If current path already a real file under this draft root, keep it (and normalize to assets/).
  const fromPath = asFilePath(pathField)
  if (fromPath && isPathInsideRoot(fromPath, root)) {
    if (resolve(fromPath) === resolve(expected) || basename(fromPath) === base) {
      if (resolve(fromPath) !== resolve(expected)) {
        if (!existsSync(expected)) copyFileSync(fromPath, expected)
        return { ok: true, absPath: expected, kind, rewritten: true }
      }
      return { ok: true, absPath: expected, kind, rewritten: false }
    }
  }

  // 2) Expected assets path already present
  if (existsSync(expected) && statSync(expected).isFile() && statSync(expected).size > 0) {
    return { ok: true, absPath: expected, kind, rewritten: resolve(pathField) !== resolve(expected) }
  }

  // 3) remote/local source — only accept if source is under draft root OR was the previous absolute path
  //    that still exists AND we copy into draft assets (ownership transfer into draft).
  const src = asFilePath(remote) || (fromPath && existsSync(fromPath) ? fromPath : null)
  if (src) {
    // If source is outside draft, still allow copy INTO draft assets (save pipeline case),
    // but final path must be expected under assets/.
    if (existsSync(expected) && statSync(expected).size > 0 && fileSha256(expected) !== fileSha256(src)) {
      return { ok: false, missing: `conflict:${base}`, kind }
    }
    if (!existsSync(expected)) copyFileSync(src, expected)
    return { ok: true, absPath: expected, kind, rewritten: true }
  }

  return { ok: false, missing: base, kind }
}

export function finalizeSavedDraftAssets(
  draftDir: string,
  opts: { draftId: string; draftName?: string },
) {
  const root = resolve(draftDir)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { ok: false, error: `draft dir missing: ${root}` }
  }

  const contentCandidates = ['draft_info.json', 'draft_content.json']
  let contentFile = ''
  for (const c of contentCandidates) {
    if (existsSync(join(root, c))) {
      contentFile = c
      break
    }
  }
  if (!contentFile) return { ok: false, error: 'draft content json missing' }

  const contentPath = join(root, contentFile)
  const content = JSON.parse(readFileSync(contentPath, 'utf8'))
  const videos = content?.materials?.videos || []
  const audios = content?.materials?.audios || []
  const copied: string[] = []
  const rewritten: string[] = []
  const missing: string[] = []
  let requiredAv = 0

  const handleList = (list: any[]) => {
    for (const mat of list) {
      if (!mat) continue
      const kind = assetKind(mat)
      if (kind === 'video' || kind === 'audio') requiredAv += 1
      const resolved = resolveMaterialOnDisk(root, mat)
      if (!resolved.ok) {
        missing.push(`${resolved.kind}:${resolved.missing}`)
        continue
      }
      if (String(mat.path || '') !== resolved.absPath) {
        mat.path = resolved.absPath
        rewritten.push(resolved.absPath)
      }
      if (resolved.rewritten) copied.push(resolved.absPath)
    }
  }

  handleList(Array.isArray(videos) ? videos : [])
  handleList(Array.isArray(audios) ? audios : [])

  const contentBody = JSON.stringify(content, null, 2)
  writeFileSync(contentPath, contentBody, 'utf8')
  const mirrors = ensureContentMirrors(root, contentFile, contentBody)

  // Cover
  const coverPath = join(root, 'draft_cover.jpg')
  let coverInfo: Record<string, unknown> = { present: existsSync(coverPath) && statSync(coverPath).size > 0 }
  if (!coverInfo.present) {
    const extracted = tryExtractCoverFromVideo(root)
    if (extracted) {
      coverInfo = {
        present: true,
        extracted: true,
        fromVideo: extracted.fromVideo,
        note: '封面来自草稿内视频真实抽帧，非占位图',
      }
    } else {
      coverInfo = {
        present: false,
        extracted: false,
        note: '无法抽帧生成封面；将清除 meta 中对不存在 draft_cover.jpg 的引用',
      }
    }
  }

  const metaPath = join(root, 'draft_meta_info.json')
  let meta: any = {}
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    } catch {
      meta = {}
    }
  }
  const now = Date.now() * 1000
  meta.draft_id = opts.draftId || meta.draft_id || basename(root)
  meta.draft_name = opts.draftName || meta.draft_name || basename(root)
  meta.draft_fold_path = root
  meta.draft_root_path = dirname(root)
  meta.tm_draft_modified = now
  if (!meta.tm_draft_create) meta.tm_draft_create = now
  if (typeof content.duration === 'number') meta.tm_duration = content.duration
  if (coverInfo.present) meta.draft_cover = 'draft_cover.jpg'
  else meta.draft_cover = ''

  writeFileSync(metaPath, JSON.stringify(meta), 'utf8')

  const foreignLeft =
    looksForeignTemplatePath(String(meta.draft_fold_path || '')) ||
    looksForeignTemplatePath(String(meta.draft_root_path || '')) ||
    String(meta.draft_name || '') === '0707'

  const hasMissingRequired = missing.some((m) => m.startsWith('video:') || m.startsWith('audio:') || m.startsWith('image:'))
  const ok = !hasMissingRequired && !foreignLeft

  return {
    ok,
    copied,
    rewritten,
    missing,
    requiredAv,
    mirrors,
    metaPath,
    draft_fold_path: meta.draft_fold_path,
    draft_name: meta.draft_name,
    foreignTemplateCleared: !foreignLeft,
    cover: coverInfo,
    contentFile,
    has_draft_content_json: existsSync(join(root, 'draft_content.json')),
    error: ok ? undefined : `missing or invalid media: ${missing.join(', ') || 'foreign meta'}`,
  }
}
