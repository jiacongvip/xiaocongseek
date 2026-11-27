/**
 * Comment import → MC wordcloud (reuses MediaCrawler tools/words.AsyncWordCloudGenerator).
 * Local-only; no platform crawl; strips author/PII from stored analysis inputs/outputs.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { venvPythonCandidates } from './platform.js'
import { defaultMcRoot } from './mediacrawler-adapter.js'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { isSpaceId, spaceAssetRoot } from './spaces.js'

export const WC_MAX_BYTES = 2 * 1024 * 1024
export const WC_MAX_COMMENTS = 5000
export const WC_MAX_CONTENT_LEN = 2000

export type CommentContentItem = { content: string }

export type WordcloudTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type WordcloudTask = {
  id: string
  spaceId: string
  status: WordcloudTaskStatus
  createdAt: number
  updatedAt: number
  sourceLabel: string
  fixtureLabeled?: boolean
  commentCount?: number
  error?: string
  code?: string
  reusedModule: 'MediaCrawler.tools.words.AsyncWordCloudGenerator'
  notAiSentiment: true
  notHotBoard: true
  freqFile?: string
  pngFile?: string
  freqBytes?: number
  pngBytes?: number
  topWords?: Array<{ word: string; count: number }>
  outDir?: string
}

const running = new Map<string, ChildProcess>()
const memoryTasks = new Map<string, WordcloudTask[]>()

function pluginRoot(): string {
  // dist/comment-wordcloud.js → ../ ; src during tsc emit same structure
  const here = dirname(fileURLToPath(import.meta.url))
  // dist/ → parent; src/ → parent
  return resolve(here, '..')
}

export function wordcloudJobsRoot(spaceId: string): string {
  return join(spaceAssetRoot(spaceId), 'comment-wordcloud-jobs')
}

function tasksPath(spaceId: string): string {
  return join(wordcloudJobsRoot(spaceId), 'tasks.json')
}

function loadTasks(spaceId: string): WordcloudTask[] {
  if (memoryTasks.has(spaceId)) return memoryTasks.get(spaceId)!
  const p = tasksPath(spaceId)
  if (!existsSync(p)) {
    memoryTasks.set(spaceId, [])
    return []
  }
  try {
    const rows = JSON.parse(readFileSync(p, 'utf8'))
    const list = Array.isArray(rows) ? (rows as WordcloudTask[]) : []
    memoryTasks.set(spaceId, list)
    return list
  } catch {
    memoryTasks.set(spaceId, [])
    return []
  }
}

function saveTasks(spaceId: string, list: WordcloudTask[]) {
  const root = wordcloudJobsRoot(spaceId)
  mkdirSync(root, { recursive: true })
  memoryTasks.set(spaceId, list)
  writeFileSync(tasksPath(spaceId), JSON.stringify(list.slice(0, 40), null, 2), 'utf8')
}

function upsert(spaceId: string, task: WordcloudTask) {
  const list = loadTasks(spaceId).filter((t) => t.id !== task.id)
  list.unshift(task)
  saveTasks(spaceId, list)
}

export function publicWordcloudTask(task: WordcloudTask | undefined | null): Omit<WordcloudTask, 'freqFile' | 'pngFile' | 'outDir'> | null {
  if (!task) return null
  const { freqFile: _f, pngFile: _p, outDir: _o, ...rest } = task
  return rest
}

export function listWordcloudTasks(spaceId: string): WordcloudTask[] {
  if (!isSpaceId(spaceId)) throw Object.assign(new Error('非法空间'), { code: 'bad_space' })
  return loadTasks(spaceId).slice(0, 20)
}

export function getWordcloudTask(spaceId: string, id: string): WordcloudTask | undefined {
  return loadTasks(spaceId).find((t) => t.id === id)
}

export function cancelWordcloudTask(spaceId: string, id: string): WordcloudTask | undefined {
  const child = running.get(id)
  if (child) {
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    running.delete(id)
  }
  const task = getWordcloudTask(spaceId, id)
  if (!task) return undefined
  if (task.status === 'running' || task.status === 'queued') {
    task.status = 'cancelled'
    task.updatedAt = Date.now()
    upsert(spaceId, task)
  }
  return task
}

/** Extract content-only items; drop nickname/user_id/author and other PII keys. */
export function extractCommentContents(raw: unknown): CommentContentItem[] {
  const out: CommentContentItem[] = []
  const push = (text: unknown) => {
    if (typeof text !== 'string') return
    const s = text.replace(/\u0000/g, '').trim()
    if (!s) return
    out.push({ content: s.slice(0, WC_MAX_CONTENT_LEN) })
  }
  const fromObj = (o: Record<string, unknown>) => {
    push(o.content ?? o.comment_text ?? o.text ?? o.desc)
  }
  if (typeof raw === 'string') {
    // plain text: one comment per non-empty line
    for (const line of raw.split(/\r?\n/)) push(line)
    return out
  }
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (typeof row === 'string') push(row)
      else if (row && typeof row === 'object') fromObj(row as Record<string, unknown>)
    }
    return out
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.comments)) return extractCommentContents(o.comments)
    if (Array.isArray(o.items)) return extractCommentContents(o.items)
    if (Array.isArray(o.data)) return extractCommentContents(o.data)
    fromObj(o)
  }
  return out
}

export type ParseImportResult =
  | { ok: true; items: CommentContentItem[]; format: 'txt' | 'json' | 'jsonl'; fixtureLabeled?: boolean }
  | { ok: false; code: string; error: string }

export function parseCommentImport(input: {
  text?: string
  encoding?: string
  filename?: string
  fixtureLabeled?: boolean
}): ParseImportResult {
  const enc = String(input.encoding || 'utf-8').toLowerCase()
  if (enc !== 'utf-8' && enc !== 'utf8') {
    return { ok: false, code: 'bad_encoding', error: '仅支持 UTF-8 文本' }
  }
  const text = String(input.text ?? '')
  if (!text.trim()) {
    return { ok: false, code: 'empty', error: '评论内容为空' }
  }
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > WC_MAX_BYTES) {
    return {
      ok: false,
      code: 'too_large',
      error: `超过体积上限 ${WC_MAX_BYTES} 字节（当前 ${bytes}）`,
    }
  }
  const name = String(input.filename || '').toLowerCase()
  const trimmed = text.trim()
  let format: 'txt' | 'json' | 'jsonl' = 'txt'
  let items: CommentContentItem[] = []

  const looksJsonl =
    name.endsWith('.jsonl') ||
    (trimmed.includes('\n') &&
      trimmed
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .every((l) => l.trim().startsWith('{')))
  const looksJson =
    name.endsWith('.json') ||
    ((trimmed.startsWith('{') || trimmed.startsWith('[')) && !looksJsonl)

  try {
    if (looksJsonl) {
      format = 'jsonl'
      const rows: unknown[] = []
      for (const line of text.split(/\r?\n/)) {
        const l = line.trim()
        if (!l) continue
        rows.push(JSON.parse(l))
      }
      items = extractCommentContents(rows)
    } else if (looksJson) {
      format = 'json'
      items = extractCommentContents(JSON.parse(trimmed))
    } else {
      format = 'txt'
      items = extractCommentContents(text)
    }
  } catch {
    return { ok: false, code: 'bad_schema', error: '无法解析为 UTF-8 文本 / JSON / JSONL' }
  }

  if (!items.length) {
    return {
      ok: false,
      code: 'no_content',
      error: '未解析到评论正文（需要 content / comment_text / text，或纯文本每行一条）',
    }
  }
  if (items.length > WC_MAX_COMMENTS) {
    return {
      ok: false,
      code: 'too_many',
      error: `超过条数上限 ${WC_MAX_COMMENTS}（当前 ${items.length}）`,
    }
  }
  return { ok: true, items, format, fixtureLabeled: !!input.fixtureLabeled }
}

export function assertSafeOutPath(spaceId: string, filePath: string): string {
  const root = resolve(wordcloudJobsRoot(spaceId))
  const real = resolve(filePath)
  if (real !== root && !real.startsWith(root + '/')) {
    throw Object.assign(new Error('路径越界：必须落在本公司 comment-wordcloud-jobs 下'), {
      code: 'path_escape',
    })
  }
  return real
}

function resolveMcPython(mcRoot: string, configured?: string): string {
  const c = String(configured || '').trim()
  if (c && existsSync(c)) return c
  for (const venv of venvPythonCandidates(mcRoot)) if (existsSync(venv)) return venv
  throw Object.assign(new Error(`未找到 MediaCrawler 的 Python（期望 ${venvPythonCandidates(mcRoot)[0]}）`), { code: 'needs_setup' })
}

export function commentWordcloudCapability(partial?: {
  mediaCrawlerRoot?: string
  mediaCrawlerPython?: string
}) {
  const mcRoot =
    String(partial?.mediaCrawlerRoot || '').trim() ||
    defaultMcRoot()
  const font = join(mcRoot, 'docs', 'STZHONGS.TTF')
  const stop = join(mcRoot, 'docs', 'hit_stopwords.txt')
  const wordsPy = join(mcRoot, 'tools', 'words.py')
  return {
    wiredInPlugin: true,
    reusedModule: 'MediaCrawler.tools.words.AsyncWordCloudGenerator',
    sourceFiles: ['MediaCrawler/tools/words.py', 'MediaCrawler/tools/async_file_writer.py (filter content fields)'],
    notAiSentiment: true,
    notHotBoard: true,
    downloadsComments: false,
    requiresPlatformLogin: false,
    maxBytes: WC_MAX_BYTES,
    maxComments: WC_MAX_COMMENTS,
    acceptedFormats: ['txt (一行一条)', 'json (数组/对象含 content|comment_text|text)', 'jsonl'],
    storesPii: false,
    mcRootExists: existsSync(mcRoot),
    fontExists: existsSync(font),
    stopwordsExists: existsSync(stop),
    wordsModuleExists: existsSync(wordsPy),
    fontPath: font,
    stopwordsPath: stop,
    note: '导入已有评论 → 复用 MC 词频/词云；不采新评论、非热榜、非 AI 情绪。输出仅词→次数与词云图。',
  }
}

export async function runCommentWordcloud(input: {
  spaceId: string
  text?: string
  filename?: string
  fixtureLabeled?: boolean
  sourceLabel?: string
  mediaCrawlerRoot?: string
  mediaCrawlerPython?: string
}): Promise<{ success: boolean; task: WordcloudTask; capability: ReturnType<typeof commentWordcloudCapability> }> {
  const spaceId = String(input.spaceId || '').trim()
  if (!isSpaceId(spaceId)) throw Object.assign(new Error('非法空间'), { code: 'bad_space' })
  const capability = commentWordcloudCapability({
    mediaCrawlerRoot: input.mediaCrawlerRoot,
    mediaCrawlerPython: input.mediaCrawlerPython,
  })
  const parsed = parseCommentImport({
    text: input.text,
    filename: input.filename,
    fixtureLabeled: input.fixtureLabeled,
  })
  const task: WordcloudTask = {
    id: `wc-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    spaceId,
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sourceLabel: String(input.sourceLabel || input.filename || (input.fixtureLabeled ? '测试示例 fixture' : 'imported')).slice(
      0,
      120,
    ),
    fixtureLabeled: !!input.fixtureLabeled,
    reusedModule: 'MediaCrawler.tools.words.AsyncWordCloudGenerator',
    notAiSentiment: true,
    notHotBoard: true,
  }
  upsert(spaceId, task)

  if (!parsed.ok) {
    task.status = 'failed'
    task.code = parsed.code
    task.error = parsed.error
    task.updatedAt = Date.now()
    upsert(spaceId, task)
    return { success: false, task, capability }
  }
  if (!capability.mcRootExists || !capability.fontExists || !capability.stopwordsExists || !capability.wordsModuleExists) {
    task.status = 'failed'
    task.code = 'needs_setup'
    task.error = 'MediaCrawler 词云依赖不完整（tools/words.py / docs/STZHONGS.TTF / hit_stopwords.txt）'
    task.updatedAt = Date.now()
    upsert(spaceId, task)
    return { success: false, task, capability }
  }

  const mcRoot = String(input.mediaCrawlerRoot || '').trim() || defaultMcRoot()
  let py: string
  try {
    py = resolveMcPython(mcRoot, input.mediaCrawlerPython)
  } catch (e: any) {
    task.status = 'failed'
    task.code = e?.code || 'needs_setup'
    task.error = e?.message || 'python 不可用'
    task.updatedAt = Date.now()
    upsert(spaceId, task)
    return { success: false, task, capability }
  }

  const outDir = join(wordcloudJobsRoot(spaceId), task.id, 'out')
  mkdirSync(outDir, { recursive: true })
  assertSafeOutPath(spaceId, outDir)
  const outPrefix = join(outDir, 'comments')
  const jobFile = join(wordcloudJobsRoot(spaceId), task.id, 'job.json')
  const sanitizedIn = join(wordcloudJobsRoot(spaceId), task.id, 'contents_only.json')
  // Persist only content — never nickname/user_id
  writeFileSync(sanitizedIn, JSON.stringify({ items: parsed.items }, null, 2), 'utf8')
  writeFileSync(
    jobFile,
    JSON.stringify(
      {
        mc_root: mcRoot,
        out_prefix: outPrefix,
        items: parsed.items,
        fixtureLabeled: !!input.fixtureLabeled,
      },
      null,
      2,
    ),
    'utf8',
  )

  const runner = join(pluginRoot(), 'tools', 'comment-wordcloud', 'run_mc_wordcloud.py')
  if (!existsSync(runner)) {
    task.status = 'failed'
    task.code = 'runner_missing'
    task.error = '词云 runner 脚本缺失'
    task.updatedAt = Date.now()
    upsert(spaceId, task)
    return { success: false, task, capability }
  }

  task.status = 'running'
  task.commentCount = parsed.items.length
  task.outDir = outDir
  task.updatedAt = Date.now()
  upsert(spaceId, task)

  const result = await new Promise<{
    exitCode: number
    stdout: string
    stderr: string
  }>((resolvePromise) => {
    const child = spawn(py, [runner, jobFile], {
      cwd: mcRoot,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG || 'en_US.UTF-8',
        DH_MC_ROOT: mcRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    running.set(task.id, child)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => {
      stdout += String(d)
      if (stdout.length > 100_000) stdout = stdout.slice(-100_000)
    })
    child.stderr?.on('data', (d) => {
      stderr += String(d)
      if (stderr.length > 100_000) stderr = stderr.slice(-100_000)
    })
    child.on('error', (e) => {
      running.delete(task.id)
      resolvePromise({ exitCode: 1, stdout, stderr: `${stderr}\n${e.message}` })
    })
    child.on('close', (code) => {
      running.delete(task.id)
      resolvePromise({ exitCode: code ?? 1, stdout, stderr })
    })
  })

  const latest = getWordcloudTask(spaceId, task.id) || task
  if (latest.status === 'cancelled') {
    return { success: false, task: latest, capability }
  }

  let parsedOut: any = null
  try {
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean)
    parsedOut = JSON.parse(lines[lines.length - 1] || '{}')
  } catch {
    parsedOut = null
  }

  const freqFile = join(outDir, 'comments_word_freq.json')
  const pngFile = join(outDir, 'comments_word_cloud.png')
  const freqOk = existsSync(freqFile) && statSync(freqFile).size > 2
  const pngOk = existsSync(pngFile) && statSync(pngFile).size > 100

  if (result.exitCode === 0 && parsedOut?.ok && freqOk && pngOk) {
    // Ensure freq JSON has no PII — rewrite as word→count only if needed
    try {
      const freqObj = JSON.parse(readFileSync(freqFile, 'utf8'))
      if (freqObj && typeof freqObj === 'object' && !Array.isArray(freqObj)) {
        const clean: Record<string, number> = {}
        for (const [k, v] of Object.entries(freqObj)) {
          if (typeof k === 'string' && k.trim() && typeof v === 'number') clean[k] = v
        }
        writeFileSync(freqFile, JSON.stringify(clean, null, 4), 'utf8')
      }
    } catch {
      /* keep original */
    }
    latest.status = 'succeeded'
    latest.freqFile = freqFile
    latest.pngFile = pngFile
    latest.freqBytes = statSync(freqFile).size
    latest.pngBytes = statSync(pngFile).size
    latest.topWords = Array.isArray(parsedOut.topWords) ? parsedOut.topWords.slice(0, 15) : []
    latest.commentCount = parsedOut.commentCount || parsed.items.length
    latest.updatedAt = Date.now()
    upsert(spaceId, latest)
    return { success: true, task: latest, capability }
  }

  latest.status = 'failed'
  latest.code = 'wordcloud_failed'
  latest.error =
    (parsedOut && parsedOut.error) ||
    `词云生成失败（exit ${result.exitCode}）` + (result.stderr ? `：${result.stderr.slice(-300)}` : '')
  latest.updatedAt = Date.now()
  upsert(spaceId, latest)
  return { success: false, task: latest, capability }
}

export function resolveWordcloudAsset(spaceId: string, taskId: string, kind: 'png' | 'freq'): string | null {
  const task = getWordcloudTask(spaceId, taskId)
  if (!task) return null
  const file = kind === 'png' ? task.pngFile : task.freqFile
  if (!file) return null
  try {
    return assertSafeOutPath(spaceId, file)
  } catch {
    return null
  }
}

export function listJobFilesSafe(spaceId: string, taskId: string): string[] {
  const dir = join(wordcloudJobsRoot(spaceId), taskId, 'out')
  try {
    assertSafeOutPath(spaceId, dir)
  } catch {
    return []
  }
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => {
    const base = basename(n)
    return base.endsWith('_word_cloud.png') || base.endsWith('_word_freq.json')
  })
}
