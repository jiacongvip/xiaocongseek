import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, createReadStream, copyFileSync, realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInsideDir, isSpaceId, spaceRoot } from './paths.js'
import { resolveRuntimePython, spawnRuntimeEnv } from './runtime.js'
import { assertPublishAllowed } from './auth.js'
import { assertQuotaAvailable, recordAttempt } from './quota.js'
import { resolveCredentialPath } from './accounts.js'

export type TaskState = 'unconfirmed' | 'queued' | 'running' | 'accepted' | 'unknown' | 'failed' | 'cancelled'
type Snapshot = {
  spaceId: string; packId: string; packRevision: number; bindingId: string; bindingRevision: number
  platform: string; title: string; body: string; topics: string
  videoPath: string; coverPath: string; videoHash: string; coverHash: string
}
type Task = {
  id: string; state: TaskState; snapshot: Snapshot; fingerprint: string
  createdAt: number; updatedAt: number; receipt?: Record<string, unknown>
  events: { at: number; code: string }[]
  dispatchStartedAt?: number
}

type Store = { version: 1; tasks: Task[] }
const grants = new Map<string, { space: string; id: string; session: string; csrf: string; expires: number; fingerprint: string }>()
const active = new Set<string>()

function storeFile(space: string) { return join(spaceRoot(space), 'tasks.json') }
function load(space: string): Store {
  if (!isSpaceId(space)) throw new Error('非法公司')
  const f = storeFile(space)
  if (!existsSync(f)) return { version: 1, tasks: [] }
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'))
    if (raw.version !== 1 || !Array.isArray(raw.tasks)) throw new Error()
    return raw
  } catch { throw new Error('任务索引损坏，已保留原文件') }
}
function save(space: string, store: Store) {
  const f = storeFile(space)
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
  const tmp = `${f}.${randomBytes(6).toString('hex')}.tmp`
  try { writeFileSync(tmp, JSON.stringify(store, null, 2), { flag: 'wx', mode: 0o600 }); renameSync(tmp, f) }
  finally { if (existsSync(tmp)) unlinkSync(tmp) }
}
async function sha256(path: string) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path)) h.update(chunk)
  return h.digest('hex')
}
function digest(v: string) { return createHash('sha256').update(v).digest('hex') }

export function listTasks(space: string) { return load(space).tasks }
export function getTask(space: string, id: string) {
  const t = load(space).tasks.find(x => x.id === id)
  if (!t) throw new Error('找不到当前公司任务')
  return t
}

export async function prepareTask(space: string, input: {
  packId: string; packRevision: number; bindingId: string
  platform: string; title: string; body: string; topics: string
  videoPath: string; coverPath: string
}) {
  if (!isSpaceId(space)) throw new Error('非法公司')
  const auth = assertPublishAllowed()
  const cred = resolveCredentialPath(space, input.bindingId)
  if (cred.binding.platform !== input.platform) throw new Error('账号平台与发布内容平台不一致')
  // Media must live under this company plugin space or be explicitly staged copies.
  const root = realpathSync(spaceRoot(space))
  const video = realpathSync(input.videoPath)
  const cover = realpathSync(input.coverPath)
  if (!isInsideDir(root, video, false) || !isInsideDir(root, cover, false)) throw new Error('媒体必须位于本公司发布插件隔离目录')
  const videoHash = await sha256(video)
  const coverHash = await sha256(cover)
  const snapshot: Snapshot = {
    spaceId: space, packId: input.packId, packRevision: input.packRevision,
    bindingId: input.bindingId, bindingRevision: cred.revision,
    platform: input.platform, title: input.title, body: input.body, topics: input.topics,
    videoPath: video, coverPath: cover, videoHash, coverHash,
  }
  const fingerprint = digest(JSON.stringify(snapshot))
  const id = `task-${fingerprint.slice(0, 32)}`
  const store = load(space)
  const old = store.tasks.find(t => t.id === id)
  // 同一指纹只在「还没执行」时复用，保证幂等；已取消/失败的可以重新发起，
  // 结果未知（unknown）绝不能复用重试，直接退回给调用方拒绝。
  if (old && old.state !== 'cancelled' && old.state !== 'failed') return { item: old, reused: true, blockers: auth.ok ? [] : auth.reasons }
  // 取消/失败过：换一个唯一 ID 建新任务，否则永远卡在旧状态上「假发」。
  const freshId = old ? `task-${digest(fingerprint + ':' + Date.now() + ':' + Math.random()).slice(0, 32)}` : id
  const now = Date.now()
  const next: Task = { id: freshId, state: 'unconfirmed', snapshot, fingerprint, createdAt: now, updatedAt: now, events: [{ at: now, code: 'prepared' }] }
  store.tasks = [next, ...store.tasks]
  save(space, store)
  return { item: next, reused: false, blockers: auth.ok ? [] : auth.reasons }
}

export function challenge(space: string, id: string, session: string) {
  if (!session) throw new Error('确认会话无效')
  const t = getTask(space, id)
  if (t.state !== 'unconfirmed') throw new Error('任务已执行/取消或结果未知，不能重复确认')
  const auth = assertPublishAllowed()
  if (!auth.ok) return { success: false, blocked: true, error: auth.reasons.join('；') }
  const quota = assertQuotaAvailable(1)
  if (!quota.ok) return { success: false, blocked: true, error: quota.reason }
  resolveCredentialPath(space, t.snapshot.bindingId)
  for (const [n, g] of grants) if (g.expires < Date.now() || (g.space === space && g.id === id && g.session === session)) grants.delete(n)
  const nonce = randomBytes(32).toString('base64url')
  const csrf = randomBytes(32).toString('base64url')
  grants.set(nonce, { space, id, session, csrf: digest(csrf), expires: Date.now() + 120000, fingerprint: t.fingerprint })
  return { success: true, spaceId: space, id, challenge: nonce, csrf, expiresAt: Date.now() + 120000 }
}

function pluginRoot() {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..')
}

/** Shared dispatch: every guard that used to sit in submit() stays here, so both the
 * interactive confirmation path and the pre-authorized scheduler path run the same checks. */
async function dispatch(space: string, taskIn: Task, opts?: { dryRun?: boolean; python?: string; source?: string }) {
  const auth = assertPublishAllowed(); if (!auth.ok) return { success: false, blocked: true, error: auth.reasons.join('；') }
  const quota = assertQuotaAvailable(1); if (!quota.ok) return { success: false, blocked: true, error: quota.reason }
  const cred = resolveCredentialPath(space, taskIn.snapshot.bindingId)
  if (cred.revision !== taskIn.snapshot.bindingRevision) throw new Error('账号已变化，请重新准备')
  const id = taskIn.id
  const key = space + ':' + id
  if (active.has(key)) return { success: false, blocked: true, error: '任务正在执行' }
  active.add(key)
  try {
    const store = load(space)
    const task = store.tasks.find(x => x.id === id)!
    task.state = 'queued'; task.updatedAt = Date.now()
    task.events.push({ at: task.updatedAt, code: opts?.source === 'auto-schedule' ? 'auto-schedule-fired' : 'human-confirmed' })
    save(space, store)
    const work = join(spaceRoot(space), 'work', id)
    mkdirSync(work, { recursive: true, mode: 0o700 })
    const video = join(work, 'video' + extname(task.snapshot.videoPath))
    const cover = join(work, 'cover' + extname(task.snapshot.coverPath))
    copyFileSync(task.snapshot.videoPath, video)
    copyFileSync(task.snapshot.coverPath, cover)
    if (await sha256(video) !== task.snapshot.videoHash || await sha256(cover) !== task.snapshot.coverHash) {
      task.state = 'unconfirmed'; task.events.push({ at: Date.now(), code: 'media-changed-before-send' }); save(space, store)
      return { success: false, blocked: true, error: '媒体在确认后变化，未发送' }
    }
    recordAttempt(space, id)
    task.state = 'running'; task.dispatchStartedAt = Date.now(); task.events.push({ at: task.dispatchStartedAt, code: 'executor-starting' }); save(space, store)
    const payload = {
      version: 1,
      mode: opts?.dryRun ? 'dry-run' : 'execute',
      contentMode: 'video',
      platform: task.snapshot.platform,
      title: task.snapshot.title,
      text: task.snapshot.body,
      tags: task.snapshot.topics,
      video,
      cover,
      accountFile: cred.path,
      runtimeRoot: work,
      headless: (opts as any)?.headless === true,
      pluginVendorRoot: join(pluginRoot(), 'publishing', 'vendor', 'geo'),
    }
    try {
      const result = await runExecutor(payload, opts?.python || resolveRuntimePython())
      const finished = Date.now()
      if (result.executed === false && result.blocked) {
        task.state = 'unconfirmed'; task.receipt = result; task.events.push({ at: finished, code: 'executor-blocked' })
      } else if (((result as any).verified && (result as any).verified.ok) || (result as any).adapterSuccess === true) {
        // 平台后台已核实或平台适配器明确确认发表成功：落 accepted
        task.state = 'accepted'; task.receipt = result; task.events.push({ at: finished, code: (result as any).verified?.ok ? 'platform-verified' : 'adapter-published' })
      } else if ((result as any).adapterFailed || (result.success === false && result.error)) {
        // 已确认没发出去：落 failed 并给出中文原因，绝不再报「待核对」
        task.state = 'failed'; task.receipt = result; task.events.push({ at: finished, code: 'executor-failed' })
      } else if (result.uncertain || result.executed) {
        task.state = 'unknown'; task.receipt = result; task.events.push({ at: finished, code: 'executor-finished-unverified' })
      } else if (result.success === false) {
        task.state = 'failed'; task.receipt = result; task.events.push({ at: finished, code: 'executor-failed' })
      } else {
        task.state = 'unknown'; task.receipt = result; task.events.push({ at: finished, code: 'executor-finished-unverified' })
      }
      task.updatedAt = finished; save(space, store)
      return { success: true, spaceId: space, item: task }
    } catch (e) {
      task.state = 'unknown'; task.updatedAt = Date.now(); task.events.push({ at: task.updatedAt, code: 'executor-interrupted-unknown' })
      task.receipt = { error: e instanceof Error ? e.message : 'interrupted' }
      save(space, store)
      return { success: false, spaceId: space, item: task, error: '执行结果未知，禁止盲目重试' }
    }
  } finally {
    active.delete(key)
  }
}

export async function submit(space: string, id: string, session: string, nonce: string, csrf: string, opts?: { dryRun?: boolean; python?: string }) {
  const g = grants.get(nonce)
  if (!g || g.space !== space || g.id !== id || g.session !== session || g.expires < Date.now() || digest(csrf) !== g.csrf) throw new Error('确认凭证无效、过期、跨会话或已使用')
  grants.delete(nonce)
  const t = getTask(space, id)
  if (t.state !== 'unconfirmed' || t.fingerprint !== g.fingerprint) throw new Error('任务内容已变化，请重新确认')
  return dispatch(space, t, { ...opts, source: 'human-confirm' })
}

/** Scheduler-only entry: the user already authorized this date when they ticked
 * "到点自动发" on that calendar plan. Not exposed over HTTP, never callable by AI. */
export async function submitGranted(space: string, id: string, opts?: { dryRun?: boolean; python?: string; headless?: boolean }) {
  if (!isSpaceId(space)) throw new Error('非法公司')
  const t = getTask(space, id)
  if (t.state !== 'unconfirmed') {
    return { success: false, blocked: true, error: '任务已执行/取消或结果未知，禁止重复发送', item: t }
  }
  return dispatch(space, t, { ...opts, source: 'auto-schedule' })
}


/** 把适配器/页面报错翻译成客户能看懂的原因 + 处理建议。 */
function explainAdapterFailure(log: string): string {
  // 适配器自己归纳的「最后错误」最准，优先采用
  const curated = /最后错误[:：]\s*([^\n]+)/.exec(log)
  if (curated && curated[1] && curated[1].trim().length > 4) return curated[1].trim()
  const rules: [RegExp, string][] = [
    [/为确保是本人操作|接收短信验证码|短信验证/, '平台要求本人短信验证：请先在浏览器里登录该平台完成一次短信验证，再重新发送'],
    [/扫码登录|登录已失效|登录状态|cookie.*(?:失效|过期)|未登录|需要登录/i, '账号登录状态已失效：请到「平台账号」重新授权该账号后再发'],
    [/实名认证/, '账号未完成实名认证：请先在平台完成实名认证'],
    [/账号异常|封禁|禁止发布|发布功能.*(?:限制|关闭)|限制发布/, '账号被平台限制发布：请到平台查看账号状态与处罚通知'],
    [/操作频繁|发布过于频繁|请求频繁|频率限制/, '平台限流：发布过于频繁，请间隔一段时间后再发'],
    [/内容违规|审核未通过|作品未通过|违反社区/, '内容未通过平台审核：请修改文案或视频后重试'],
    [/滑块|安全验证|拖动.*验证/, '平台触发了安全验证：请在浏览器里完成一次验证后再发'],
    [/标题和标签添加失败|未找到标题输入框/, '发布页标题输入框没找到：可能是平台改版或页面加载过慢，请重试；若持续出现需要更新平台适配'],
    [/未找到正文输入框/, '发布页正文输入框没找到：可能是平台改版或页面加载过慢，请重试'],
    [/不支持此视频格式|建议上传H\.264/, '当前浏览器缺少 H.264 视频解码器：请安装 Google Chrome 或 Microsoft Edge 后重新发送'],
    [/BrowserType\.launch|Executable doesn|spawn .*EACCES|浏览器.*(?:启动|实例).*失败/, '本机浏览器启动失败：请检查发布运行时（Chromium/Playwright）是否安装完整'],
    [/ETIMEDOUT|Timeout|超时/i, '平台页面响应超时：请检查网络后重试'],
    [/媒体.*(?:变化|不可用)|视频.*(?:不存在|缺失)/, '视频或封面文件不可用：请重新选择成片后再发'],
  ]
  for (const [re, text] of rules) if (re.test(log)) return text
  return ''
}

function runExecutor(payload: Record<string, unknown>, python: string) {
  return new Promise<any>((resolve, reject) => {
    const script = join(pluginRoot(), 'publishing', 'executor.py')
    const child = spawn(python, [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: spawnRuntimeEnv({ ...process.env, PYTHONPATH: '', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }),
    })
    let out = '', err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('executor timeout')) }, payload.mode === 'dry-run' ? 15000 : 15 * 60 * 1000)
    child.stdout.on('data', (d: Buffer) => { out += d; if (out.length > 1_000_000) child.kill('SIGKILL') })
    child.stderr.on('data', (d: Buffer) => { err += d; if (err.length > 200_000) child.kill('SIGKILL') })
    child.on('error', (e: Error) => { clearTimeout(timer); reject(e) })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      try {
        const lines = out.trim().split(/\n/).map(l => l.trim()).filter(Boolean)
        let parsed: any = null
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i]
          if (!line.startsWith('{')) continue
          try { parsed = JSON.parse(line); break } catch {}
        }
        const json = parsed || JSON.parse(out.trim() || '{}')
        // 适配器真实结果：它总是返回 success，但 stderr 里才有真相（发布失败原因）
        try {
          const published = /已发布\s*(\d+)\s*\/\s*(\d+)\s*条内容/.exec(err)
          const okCount = published ? Number(published[1]) : (/发布成功/.test(err) ? 1 : 0)
          const failLines = err.match(/[^\n]*发布失败[^\n]*/g) || []
          const verifiedOk = !!(json && json.verified && json.verified.ok)
          if (json && json.executed && okCount === 0 && !verifiedOk && (published || failLines.length)) {
            json.success = false
            json.uncertain = false
            json.adapterFailed = true
            json.error = explainAdapterFailure(err) || failLines[failLines.length - 1] || '平台发布失败'
          }
          if (published) json.adapterSummary = `已发布 ${published[1]}/${published[2]} 条`
        } catch {}
        // 留存执行器日志，方便排查
        try {
          const dir = String((payload as any).runtimeRoot || '')
          if (dir) writeFileSync(join(dir, 'executor.log'), `exit=${code}\n[stdout]\n${out.slice(-200000)}\n[stderr]\n${err.slice(-100000)}`)
        } catch {}
        resolve(json)
      } catch {
        reject(new Error(code === 127 ? '未找到Python解释器，请安装后设置 PUBLISH_STUDIO_PYTHON' : '执行器输出无效'))
      }
    })
    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })
}

export function cancelTask(space: string, id: string) {
  const store = load(space)
  const t = store.tasks.find(x => x.id === id)
  if (!t) throw new Error('找不到任务')
  if (!['unconfirmed', 'queued'].includes(t.state) || t.dispatchStartedAt) throw new Error('只能取消尚未执行任务，不代表撤回平台内容')
  for (const [n, g] of grants) if (g.space === space && g.id === id) grants.delete(n)
  t.state = 'cancelled'; t.updatedAt = Date.now(); t.events.push({ at: t.updatedAt, code: 'cancelled-before-execution' })
  save(space, store)
  return t
}

export function runtimeStatus() {
  const auth = assertPublishAllowed()
  return {
    enabled: auth.ok,
    mode: 'independent-publish-studio',
    reasons: auth.ok ? [] : auth.reasons,
    auth: auth.settings,
  }
}
