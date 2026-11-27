import { AsyncLocalStorage } from 'node:async_hooks'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ratioToImageSize } from './image-models.js'
import { DEFAULT_SPACE_ID, spaceImageFileRoot, spaceImageStorePath } from './spaces.js'

export const IMAGE_KIND = 'ximg'
export const IMAGE_STORE_PATH = join(homedir(), '.dsh', 'digital-human-images.json')
export const IMAGE_FILE_ROOT = join(homedir(), '.dsh', 'digital-human-assets', 'images')
export const IMAGE_FILE_ROUTE = '/digital-human-studio/image/file'

export type ImageLayout = {
  spaceId: string
  store: string
  files: string
}

let layout: ImageLayout = {
  spaceId: DEFAULT_SPACE_ID,
  store: IMAGE_STORE_PATH,
  files: IMAGE_FILE_ROOT,
}

export function imageLayoutForSpace(spaceId: string): ImageLayout {
  const id = String(spaceId || '').trim() || DEFAULT_SPACE_ID
  return { spaceId: id, store: spaceImageStorePath(id), files: spaceImageFileRoot(id) }
}

export function setImageLayout(next: ImageLayout) {
  layout = next
}

const operationLayouts = new AsyncLocalStorage<ImageLayout>()

/** Keep the initiating company across awaits, independent of panel selection. */
export function withImageLayout<T>(next: ImageLayout, run: () => T): T {
  return operationLayouts.run({ ...next }, run)
}

export function currentImageLayout(): ImageLayout {
  return operationLayouts.getStore() || layout
}

export type ImageJob = {
  task_id: string
  status: string
  progress: string
  prompt: string
  model: string
  ratio: string
  size: string
  url: string
  fail_reason?: string
  created_at: number
  updated_at: number
  finished_at?: number
  upstream_task_id?: string
  data: Record<string, unknown>
}

type ImageStore = { version: 1; jobs: ImageJob[] }

const MAX_JOBS = 80

export function newImageTaskId(): string {
  return `img-${randomUUID()}`
}

export function isImageTaskId(id: string): boolean {
  return /^img-[A-Za-z0-9_-]{8,80}$/.test(String(id || '').trim())
}

export function publicImageFileUrl(id: string, ext: string, spaceId = currentImageLayout().spaceId): string {
  const suffix = ext.replace(/^\./, '')
  const space = encodeURIComponent(spaceId || DEFAULT_SPACE_ID)
  return `${IMAGE_FILE_ROUTE}?id=${encodeURIComponent(id)}${suffix ? `&ext=${encodeURIComponent(suffix)}` : ''}&space=${space}`
}

function emptyStore(): ImageStore {
  return { version: 1, jobs: [] }
}

export function loadImageStore(): ImageStore {
  try {
    if (!existsSync(currentImageLayout().store)) return emptyStore()
    const raw = JSON.parse(readFileSync(currentImageLayout().store, 'utf8')) as Partial<ImageStore>
    const jobs = Array.isArray(raw.jobs) ? raw.jobs.filter(isImageJob) : []
    return { version: 1, jobs }
  } catch {
    return emptyStore()
  }
}

function isImageJob(value: unknown): value is ImageJob {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<ImageJob>
  return typeof row.task_id === 'string' && isImageTaskId(row.task_id)
}

export function saveImageStore(store: ImageStore) {
  mkdirSync(dirname(currentImageLayout().store), { recursive: true })
  writeFileSync(currentImageLayout().store, JSON.stringify({ version: 1, jobs: store.jobs.slice(0, MAX_JOBS) }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  chmodSync(currentImageLayout().store, 0o600)
}

export function getImageJob(id: string): ImageJob | undefined {
  return loadImageStore().jobs.find(job => job.task_id === id)
}

export function upsertImageJob(job: ImageJob): ImageJob {
  const store = loadImageStore()
  const next = { ...job, updated_at: Date.now() }
  const jobs = [next, ...store.jobs.filter(item => item.task_id !== job.task_id)].slice(0, MAX_JOBS)
  saveImageStore({ version: 1, jobs })
  return next
}

export function extensionForImage(contentType: string, url = ''): string {
  const type = contentType.split(';')[0].trim().toLowerCase()
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/gif') return 'gif'
  if (type === 'image/bmp') return 'bmp'
  if (type === 'image/avif') return 'avif'
  if (type === 'image/png') return 'png'
  const match = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url)
  if (match) return match[1].toLowerCase()
  return 'png'
}

export function writeImageBytes(id: string, bytes: Buffer, ext: string): string {
  mkdirSync(currentImageLayout().files, { recursive: true })
  const suffix = ext.replace(/^\./, '') || 'png'
  const file = join(currentImageLayout().files, `${id}.${suffix}`)
  writeFileSync(file, bytes)
  return publicImageFileUrl(id, suffix, currentImageLayout().spaceId)
}

export function readImageFile(id: string, ext = '', spaceId = ''): { path: string; contentType: string } | undefined {
  if (!isImageTaskId(id)) return undefined
  const files = spaceId ? spaceImageFileRoot(spaceId) : currentImageLayout().files
  const wanted = ext.replace(/^\./, '')
  const candidates = wanted
    ? [wanted]
    : ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']
  for (const suffix of candidates) {
    const path = join(files, `${id}.${suffix}`)
    if (!existsSync(path)) continue
    const type = suffix === 'jpg' || suffix === 'jpeg' ? 'image/jpeg'
      : suffix === 'webp' ? 'image/webp'
        : suffix === 'gif' ? 'image/gif'
          : suffix === 'bmp' ? 'image/bmp'
            : suffix === 'avif' ? 'image/avif'
              : 'image/png'
    return { path, contentType: type }
  }
  return undefined
}

type ParsedImage = { url?: string; b64?: string; mime?: string }

export function parseImageGenerationResult(payload: unknown):
  | { kind: 'sync'; images: ParsedImage[] }
  | { kind: 'async'; taskId: string } {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  if (!root) throw new Error('生图接口没有返回内容')
  const nested = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : null
  const asyncId = String(root.task_id || nested?.task_id || '').trim()
    || (typeof root.status === 'string' && String(root.id || '').trim())
    || ''
  const rows = Array.isArray(root.data) ? root.data
    : Array.isArray(nested?.data) ? nested.data
      : []
  const images: ParsedImage[] = []
  for (const item of rows) {
    if (typeof item === 'string' && item.trim()) {
      images.push({ url: item.trim() })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const url = String(row.url || row.image_url || '').trim()
    const b64 = String(row.b64_json || row.b64 || '').trim()
    const mime = String(row.mime_type || row.mimeType || '').trim()
    if (url || b64) images.push({ url: url || undefined, b64: b64 || undefined, mime: mime || undefined })
  }
  if (images.length) return { kind: 'sync', images }
  const directUrl = String(root.url || nested?.url || nested?.image_url || '').trim()
  const directB64 = String(root.b64_json || nested?.b64_json || '').trim()
  if (directUrl || directB64) return { kind: 'sync', images: [{ url: directUrl || undefined, b64: directB64 || undefined }] }
  if (asyncId) return { kind: 'async', taskId: asyncId }
  throw new Error('生图接口没有返回图片地址')
}

export function decodeImageDataUrl(value: string): { bytes: Buffer; mime: string } | undefined {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value.trim())
  if (!match) return undefined
  return { bytes: Buffer.from(match[2], 'base64'), mime: match[1].toLowerCase() }
}

export function publicImageJob(job: ImageJob) {
  return {
    success: true,
    task_id: job.task_id,
    status: job.status,
    progress: job.progress,
    url: job.url,
    fail_reason: job.fail_reason || '',
    created_at: job.created_at,
    updated_at: job.updated_at,
    finished_at: job.finished_at,
    data: {
      task_type: IMAGE_KIND,
      prompt: job.prompt,
      model: job.model,
      ratio: job.ratio,
      size: job.size,
      image_url: job.url,
      cover_url: job.url,
      url: job.url,
      ...job.data,
    },
  }
}

export function seedImageJob(input: { prompt: string; model: string; ratio: string }): ImageJob {
  const now = Date.now()
  const size = ratioToImageSize(input.ratio, input.model)
  return {
    task_id: newImageTaskId(),
    status: 'IN_PROGRESS',
    progress: '8%',
    prompt: input.prompt,
    model: input.model,
    ratio: input.ratio,
    size,
    url: '',
    created_at: now,
    updated_at: now,
    data: { task_type: IMAGE_KIND, prompt: input.prompt, model: input.model, ratio: input.ratio, size },
  }
}

export { ratioToImageSize }
