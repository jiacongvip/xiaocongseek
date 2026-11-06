// digital-human-studio — HOST half: VectCut task-console + Agent tools (MVP).
// Browser half talks to HTTP routes; Agent chat uses ctx.tools (defineTool).
import type { Context } from '@deepseek-ai/cordis'
import { syncNewApiCredential } from './new-api-credential.js'
import { syncNewApiModels } from './new-api-models.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  openSync,
  closeSync,
  chmodSync,
} from 'node:fs'
import { dirname, join, basename, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { spawn, execFileSync } from 'node:child_process'

export const name = 'digital-human-studio'
export const inject = ['webServer', 'tools']

interface RouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: any, res: any) => void
}
type WebServer = { register: (spec: RouteSpec) => () => void }

const DEFAULT_BASE = 'http://127.0.0.1:9001'
const DEFAULT_VECTCUT_ROOT = join(homedir(), 'VectCutAPI')
const CONFIG_PATH = join(homedir(), '.dsh', 'digital-human-studio.json')
const VECTCUT_LOG = '/tmp/vectcut.log'
const PLUGIN_VERSION = '0.8.1'

/** Resolve Xiaocongseek static assets shipped beside the plugin (or fork ../assets). */
function resolveXiaocongAsset(filename: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const pluginRoot = resolve(here, '..')
  const candidates = [
    join(pluginRoot, 'assets', filename),
    join(pluginRoot, '..', 'assets', filename),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return candidates[0]
}

const XIAOCONG_ONLY_PNG = resolveXiaocongAsset('xiaocong-only.png')
const DEFAULT_NEW_API = 'http://127.0.0.1:3000'
const DEFAULT_FOLDER = join(
  homedir(),
  'Movies',
  'JianyingPro',
  'User Data',
  'Projects',
  'com.lveditor.draft',
)

type StudioConfig = {
  newApiBaseUrl: string
  newApiToken: string
  newApiEnabled: boolean
  newApiUsername: string
  newApiUserId: number | null
  newApiModels: string[]
  vectcutBaseUrl: string
  vectcutRoot: string
  lastProjectFolder: string
  lastDraftId: string
  lastDraftPath: string
  enginePid: number | null
}

type DraftEntry = {
  name: string
  path: string
  draft_id: string
  modified_time: string
  has_draft_content: boolean
  has_draft_info: boolean
  is_locked: boolean
  source: 'folder' | 'vectcut'
}

type OpResult = Record<string, any> & { success: boolean }

function loadConfig(): StudioConfig {
  const fallback: StudioConfig = {
    newApiBaseUrl: DEFAULT_NEW_API,
    newApiToken: '',
    newApiEnabled: false,
    newApiUsername: '',
    newApiUserId: null,
    newApiModels: [],
    vectcutBaseUrl: DEFAULT_BASE,
    vectcutRoot: existsSync(DEFAULT_VECTCUT_ROOT) ? DEFAULT_VECTCUT_ROOT : '',
    lastProjectFolder: existsSync(DEFAULT_FOLDER) ? DEFAULT_FOLDER : '',
    lastDraftId: '',
    lastDraftPath: '',
    enginePid: null,
  }
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<StudioConfig> & {
        enginePid?: number | null
      }
      const pidRaw = raw.enginePid
      const enginePid =
        typeof pidRaw === 'number' && Number.isFinite(pidRaw) && pidRaw > 0
          ? Math.floor(pidRaw)
          : null
      return {
        ...raw,
        newApiBaseUrl: String(raw.newApiBaseUrl || DEFAULT_NEW_API).replace(/\/+$/, ''),
        newApiToken: String(raw.newApiToken || ''),
        newApiEnabled: raw.newApiEnabled === true,
        newApiUsername: String(raw.newApiUsername || ''),
        newApiUserId: Number(raw.newApiUserId) || null,
        newApiModels: Array.isArray(raw.newApiModels)
          ? raw.newApiModels.map((id: unknown) => String(id)).filter(Boolean)
          : [],
        vectcutBaseUrl: String(raw.vectcutBaseUrl || DEFAULT_BASE).replace(/\/$/, ''),
        vectcutRoot: String(raw.vectcutRoot || fallback.vectcutRoot || ''),
        lastProjectFolder: String(raw.lastProjectFolder || fallback.lastProjectFolder || ''),
        lastDraftId: String(raw.lastDraftId || ''),
        lastDraftPath: String(raw.lastDraftPath || ''),
        enginePid,
      }
    }
  } catch (e) {
    console.warn('[digital-human-studio] config load failed:', e)
  }
  return fallback
}

function saveConfig(cfg: StudioConfig) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 })
  chmodSync(CONFIG_PATH, 0o600)
}

function sendJson(res: any, status: number, body: unknown) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
  })
  res.end(buf)
}

function sendHtml(res: any, status: number, html: string) {
  const buf = Buffer.from(html, 'utf8')
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
  })
  res.end(buf)
}

function sendBinary(res: any, status: number, buf: Buffer, contentType: string, cache = 'public, max-age=86400') {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': buf.length,
    'cache-control': cache,
  })
  res.end(buf)
}


function readJson(req: any): Promise<any> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 65536) { reject(new Error('请求内容过大')); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        resolvePromise(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('无效的 JSON 请求'))
      }
    })
    req.on('error', reject)
  })
}

function normalizeVideoUrl(input: string): string {
  const s = String(input || '').trim()
  if (!s) return s
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('file://')) {
    try {
      return decodeURIComponent(s.replace(/^file:\/\//, ''))
    } catch {
      return s.replace(/^file:\/\//, '')
    }
  }
  return s
}

function expandPath(input: string): string {
  const s = String(input || '').trim()
  if (!s) return ''
  if (s.startsWith('~/')) return join(homedir(), s.slice(2))
  if (s === '~') return homedir()
  return isAbsolute(s) ? s : resolve(s)
}

function looksLikeDraftDir(dir: string): {
  ok: boolean
  has_draft_content: boolean
  has_draft_info: boolean
} {
  const content = join(dir, 'draft_content.json')
  const info = join(dir, 'draft_info.json')
  const meta = join(dir, 'draft_meta_info.json')
  let hasContent = existsSync(content)
  const hasInfo = existsSync(info) || existsSync(meta)
  if (!hasContent) {
    const timelines = join(dir, 'Timelines')
    if (existsSync(timelines)) {
      try {
        for (const sub of readdirSync(timelines)) {
          const subPath = join(timelines, sub)
          try {
            if (!statSync(subPath).isDirectory()) continue
          } catch {
            continue
          }
          if (
            existsSync(join(subPath, 'draft_content.json')) ||
            existsSync(join(subPath, 'draft_info.json'))
          ) {
            hasContent = true
            break
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return {
    ok: hasContent || hasInfo,
    has_draft_content: hasContent,
    has_draft_info: hasInfo,
  }
}

function scanDraftFolder(folder: string): DraftEntry[] {
  const root = expandPath(folder)
  if (!root || !existsSync(root)) return []
  let st
  try {
    st = statSync(root)
  } catch {
    return []
  }

  const out: DraftEntry[] = []
  const pushDir = (dir: string, name: string) => {
    const mark = looksLikeDraftDir(dir)
    if (!mark.ok) return
    let mtime = 0
    try {
      mtime = statSync(dir).mtimeMs
    } catch {
      mtime = 0
    }
    out.push({
      name,
      path: dir,
      draft_id: name,
      modified_time: mtime ? new Date(mtime).toISOString() : '',
      has_draft_content: mark.has_draft_content,
      has_draft_info: mark.has_draft_info,
      is_locked: existsSync(join(dir, '.locked')),
      source: 'folder',
    })
  }

  if (st.isDirectory() && looksLikeDraftDir(root).ok) {
    pushDir(root, basename(root))
  }

  if (st.isDirectory()) {
    let names: string[] = []
    try {
      names = readdirSync(root)
    } catch {
      names = []
    }
    for (const name of names) {
      if (!name || name.startsWith('.')) continue
      const item = join(root, name)
      try {
        if (!statSync(item).isDirectory()) continue
      } catch {
        continue
      }
      pushDir(item, name)
    }
  }

  out.sort((a, b) => String(b.modified_time).localeCompare(String(a.modified_time)))
  const seen = new Set<string>()
  return out.filter((d) => {
    if (seen.has(d.path)) return false
    seen.add(d.path)
    return true
  })
}

function readLocalSummary(draftPath: string): Record<string, unknown> {
  const pickFile = (): string | null => {
    const rootContent = join(draftPath, 'draft_content.json')
    if (existsSync(rootContent)) return rootContent
    const rootInfo = join(draftPath, 'draft_info.json')
    if (existsSync(rootInfo)) return rootInfo
    const timelines = join(draftPath, 'Timelines')
    if (existsSync(timelines)) {
      try {
        for (const sub of readdirSync(timelines)) {
          const subPath = join(timelines, sub)
          try {
            if (!statSync(subPath).isDirectory()) continue
          } catch {
            continue
          }
          const c = join(subPath, 'draft_content.json')
          if (existsSync(c)) return c
          const i = join(subPath, 'draft_info.json')
          if (existsSync(i)) return i
        }
      } catch {
        /* ignore */
      }
    }
    return null
  }

  const file = pickFile()
  if (!file) {
    return {
      project_name: basename(draftPath),
      path: draftPath,
      duration_us: 0,
      fps: 30,
      canvas_config: {},
      tracks_count: 0,
      materials_summary: { videos: 0, audios: 0, texts: 0 },
      note: 'no draft_content/draft_info found',
    }
  }

  try {
    const draftData = JSON.parse(readFileSync(file, 'utf8'))
    const materials = draftData.materials || {}
    return {
      project_name: basename(draftPath),
      path: draftPath,
      duration_us: draftData.duration || 0,
      fps: draftData.fps || 30,
      canvas_config: draftData.canvas_config || {},
      tracks_count: Array.isArray(draftData.tracks) ? draftData.tracks.length : 0,
      materials_summary: {
        videos: Array.isArray(materials.videos) ? materials.videos.length : 0,
        audios: Array.isArray(materials.audios) ? materials.audios.length : 0,
        texts: Array.isArray(materials.texts) ? materials.texts.length : 0,
      },
      source_file: file,
    }
  } catch (e: any) {
    return {
      project_name: basename(draftPath),
      path: draftPath,
      error: e?.message || String(e),
    }
  }
}

async function vectcutFetch(
  baseUrl: string,
  path: string,
  body?: unknown,
  method?: string,
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const m = method || (body === undefined ? 'GET' : 'POST')
  try {
    const res = await fetch(url, {
      method: m,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text }
    }
    return { ok: res.ok, status: res.status, data }
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: e?.message || String(e),
    }
  }
}

function startGuidance(cfg: StudioConfig) {
  const root = cfg.vectcutRoot || DEFAULT_VECTCUT_ROOT
  const py = join(root, '.venv', 'bin', 'python')
  const hasVenv = existsSync(py)
  const script = join(root, 'capcut_server.py')
  const cmd = hasVenv
    ? `cd "${root}" && .venv/bin/python capcut_server.py`
    : `cd "${root}" && python3 capcut_server.py`
  return {
    vectcutRoot: root,
    script,
    has_venv: hasVenv,
    start_command: cmd,
    log: VECTCUT_LOG,
    note:
      'VectCut offline: use dh_engine_start / panel 「启动引擎」, or run start_command (default port 9001).',
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms))
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function processCommand(pid: number): string | null {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
    }).trim()
    return out || null
  } catch {
    return null
  }
}

function looksLikeVectCut(cmd: string | null): boolean {
  if (!cmd) return false
  return /capcut_server\.py/.test(cmd) || /VectCutAPI/.test(cmd)
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}



/** DeepSeek-style authorize confirm when New API session cookie still exists. */
function authorizePageHtml(returnUrl: string, loginUrl: string): string {
  const safeReturn = JSON.stringify(returnUrl)
  const safeLogin = JSON.stringify(loginUrl)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>授权登录 · Xiaocongseek</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; background: #f7f8fa; color: #1f1f1f; }
    body { display: flex; flex-direction: column; min-height: 100vh; }
    .banner { background: #eaf3ff; color: #3b6ea5; font-size: 13px; line-height: 1.55; padding: 10px 20px; text-align: center; border-bottom: 1px solid #d6e7ff; }
    .main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 20px 64px; }
    .brand { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 28px; }
    .brand img.mark { height: 56px; width: auto; display: block; object-fit: contain; }
    .brand .logo { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: #4d6bfe; }
    .brand .badge { background: #111; color: #fff; font-size: 11px; font-weight: 700; letter-spacing: .06em; padding: 4px 8px; border-radius: 4px; }
    .title { margin: 0 0 28px; font-size: 16px; color: #333; font-weight: 500; }
    .card { width: min(420px, 100%); background: #f0f1f3; border-radius: 14px; padding: 14px 14px 14px 16px; display: flex; align-items: center; gap: 12px; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg,#6b8cff,#4d6bfe); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 16px; flex-shrink: 0; overflow: hidden; }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .meta { flex: 1; min-width: 0; }
    .name { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { margin-top: 2px; font-size: 12px; color: #8a8a8a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .login-btn { appearance: none; border: 0; border-radius: 8px; background: #111; color: #fff; height: 36px; padding: 0 18px; font-size: 14px; font-weight: 600; cursor: pointer; flex-shrink: 0; }
    .login-btn:disabled { opacity: .55; cursor: default; }
    .login-btn:not(:disabled):hover { background: #2a2a2a; }
    .legal { margin-top: 18px; font-size: 12px; color: #9a9a9a; }
    .legal a { color: #333; text-decoration: underline; text-underline-offset: 2px; }
    .switch { margin-top: 28px; font-size: 14px; color: #4d6bfe; background: none; border: 0; cursor: pointer; padding: 0; }
    .switch:hover { text-decoration: underline; }
    .status { margin-top: 16px; font-size: 13px; color: #8a8a8a; min-height: 1.2em; }
    .status.error { color: #c0392b; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="banner">请确认你信任当前客户端。完成登录后，它将获得调用 XiaocongAPI 模型的账号授权，来源不明或经修改的客户端可能滥用授权凭证，产生未经授权的调用及费用。</div>
  <div class="main">
    <div class="brand"><img class="mark" src="/digital-human-studio/assets/xiaocong-only.png" alt="小葱" /><span class="logo">Xiaocongseek</span></div>
    <p class="title">使用 XiaocongAPI 账号登录 Xiaocongseek</p>
    <div id="card" class="card hidden">
      <div class="avatar" id="avatar">N</div>
      <div class="meta">
        <div class="name" id="name">—</div>
        <div class="sub" id="sub">XiaocongAPI 会话已就绪</div>
      </div>
      <button type="button" class="login-btn" id="login">登录</button>
    </div>
    <div class="legal">注册登录即代表已阅读并同意我们的 <a href="https://www.deepseek.com/zh/user-agreement" target="_blank" rel="noopener">用户协议</a> 与 <a href="https://www.deepseek.com/zh/privacy" target="_blank" rel="noopener">隐私政策</a></div>
    <button type="button" class="switch" id="switch">切换其他账号登录</button>
    <div class="status" id="status">正在检查登录状态…</div>
  </div>
  <script>
    (function () {
      var returnUrl = ${safeReturn};
      var loginUrl = ${safeLogin};
      var accessToken = null;
      var userId = null;
      var username = null;
      var statusEl = document.getElementById('status');
      var card = document.getElementById('card');
      var loginBtn = document.getElementById('login');
      var nameEl = document.getElementById('name');
      var subEl = document.getElementById('sub');
      var avatarEl = document.getElementById('avatar');

      function setStatus(text, isError) {
        statusEl.textContent = text || '';
        statusEl.className = 'status' + (isError ? ' error' : '');
      }

      function showUser(user) {
        username = (user && (user.username || user.display_name || user.name)) || 'XiaocongAPI';
        var display = username;
        var contact = (user && (user.email || user.phone || user.remark)) || '';
        nameEl.textContent = display;
        subEl.textContent = contact || ('用户 ID ' + (user && user.id != null ? user.id : '—'));
        var initial = String(display).trim().charAt(0) || 'N';
        avatarEl.textContent = initial.toUpperCase();
        card.classList.remove('hidden');
        setStatus('');
      }

      function authorizedHref() {
        var u = new URL('/digital-human-studio/auth/authorized', location.origin);
        u.searchParams.set('return', returnUrl);
        return u.toString();
      }

      function notifyClaimed() {
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'dsh-newapi-claimed', username: username || 'XiaocongAPI' }, returnUrl);
          }
        } catch (e) {}
      }

      async function loadSession() {
        setStatus('正在检查登录状态…');
        try {
          var refresh = await fetch('/api/user/auth/refresh', {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json' },
          });
          if (refresh.status === 429) {
            setStatus('请求过于频繁，请稍后再试（429）', true);
            return;
          }
          if (!refresh.ok) {
            setStatus('未检测到有效会话，请使用其他账号登录', true);
            return;
          }
          var payload = await refresh.json().catch(function () { return null; });
          var data = (payload && payload.data) || payload || {};
          accessToken = data.access_token || data.token || null;
          var user = data.user || data;
          userId = user && user.id;
          if (!accessToken || !userId) {
            setStatus('会话无效，请使用其他账号登录', true);
            return;
          }
          showUser(user);
        } catch (e) {
          setStatus('检查登录状态失败，请重试', true);
        }
      }

      loginBtn.addEventListener('click', async function () {
        if (!accessToken || !userId) return;
        loginBtn.disabled = true;
        setStatus('正在授权…');
        try {
          var claimRes = await fetch('/digital-human-studio/auth/claim', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              accessToken: accessToken,
              userId: userId,
              username: username,
            }),
          });
          var claimed = await claimRes.json().catch(function () { return null; });
          if (!(claimed && claimed.success && claimed.hasToken)) {
            setStatus((claimed && claimed.error) || '授权失败，请重试', true);
            loginBtn.disabled = false;
            return;
          }
          if (claimed.username) username = claimed.username;
          notifyClaimed();
          location.replace(authorizedHref());
        } catch (e) {
          setStatus('授权失败，请重试', true);
          loginBtn.disabled = false;
        }
      });

      document.getElementById('switch').addEventListener('click', async function () {
        setStatus('正在切换账号…');
        try {
          await fetch('/api/user/auth/logout', {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json' },
          });
        } catch (e) {}
        try { location.replace(loginUrl); } catch (e2) { location.href = loginUrl; }
      });

      loadSession();
    })();
  </script>
</body>
</html>`
}

/** DeepSeek-style post-login page served in the New API popup after claim. */
function authorizedPageHtml(returnUrl: string): string {
  const safeReturn = JSON.stringify(returnUrl)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>登录成功</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; background: #0f0f0f; color: #f5f5f5; }
    body { display: flex; min-height: 100%; }
    .panel { width: min(520px, 100%); padding: 48px 40px; display: flex; flex-direction: column; justify-content: center; background: #161616; }
    .hero { flex: 1; display: none; background: #0a0a0a; position: relative; overflow: hidden; }
    @media (min-width: 900px) { .hero { display: block; } }
    .hero::after { content: "欢迎使用数字人混剪工作台 / XiaocongAPI 已授权"; position: absolute; inset: auto 48px 64px 48px; color: rgba(255,255,255,.28); font-size: 22px; line-height: 1.5; }
    .brand { display: flex; align-items: center; gap: 12px; font-size: 14px; letter-spacing: .08em; color: rgba(255,255,255,.55); margin-bottom: 48px; text-transform: uppercase; }
    .brand img.mark { height: 48px; width: auto; object-fit: contain; display: block; }
    h1 { margin: 0 0 16px; font-size: 40px; font-weight: 600; }
    p { margin: 0 0 36px; color: rgba(255,255,255,.62); font-size: 16px; line-height: 1.6; }
    button { appearance: none; border: 0; border-radius: 10px; background: #111; color: #fff; border: 1px solid rgba(255,255,255,.14); width: 100%; height: 48px; font-size: 16px; cursor: pointer; }
    button:hover { background: #1c1c1c; }
    .hint { margin-top: 18px; font-size: 13px; color: rgba(255,255,255,.38); }
  </style>
</head>
<body>
  <section class="panel">
    <div class="brand"><img class="mark" src="/digital-human-studio/assets/xiaocong-only.png" alt="小葱" /><span>Xiaocongseek · XiaocongAPI</span></div>
    <h1>登录成功</h1>
    <p>你可以关闭此页面，返回工作台继续工作。</p>
    <button type="button" id="open-app">打开应用</button>
    <div class="hint">若未自动返回，请点击上方按钮，或直接回到工作台标签页。</div>
  </section>
  <aside class="hero" aria-hidden="true"></aside>
  <script>
    (function () {
      var returnUrl = ${safeReturn};
      function go() {
        try {
          if (window.opener && !window.opener.closed) {
            try { window.opener.focus(); } catch (e) {}
            try { window.opener.postMessage({ type: 'dsh-newapi-authorized' }, returnUrl); } catch (e) {}
          }
        } catch (e) {}
        try { location.href = 'dsh://open'; } catch (e) {}
        setTimeout(function () {
          try { window.close(); } catch (e) {}
          // Popup close blocked: navigate opener-less tab back to harness.
          try { location.replace(returnUrl); } catch (e2) {}
        }, 250);
      }
      document.getElementById('open-app').addEventListener('click', go);
    })();
  </script>
</body>
</html>`
}

export async function apply(ctx: Context) {
  const ws = (ctx as unknown as { webServer: WebServer }).webServer
  let config = loadConfig()
  // Cordis 4.1 has no required:false injection metadata. ctx.get is its
  // optional-service seam (also used by llm-pi-ai); do not require credentials.
  const syncCredential = () => syncNewApiCredential(ctx,
    config.newApiEnabled && config.newApiToken ? config.newApiToken : undefined)
  await syncCredential()

  // Never expose credentials through the older config endpoint either.
  const publicConfig = () => ({ ...config, newApiToken: undefined })
  const authStatus = (): OpResult => ({
    success: true, enabled: config.newApiEnabled, baseUrl: config.newApiBaseUrl,
    username: config.newApiUsername, userId: config.newApiUserId,
    hasToken: !!config.newApiToken,
    tokenPreview: config.newApiToken ? `sk-••••${config.newApiToken.length > 12 ? config.newApiToken.slice(-4) : ''}` : '',
    models: config.newApiModels,
    modelCount: config.newApiModels.length,
  })
  const normalizeToken = (value: string) => {
    const token = value.trim()
    return token && !token.startsWith('sk-') ? `sk-${token}` : token
  }
  const validateBase = (value: unknown) => {
    const url = new URL(String(value))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('服务地址必须是无凭据的 HTTP(S) URL')
    // Passwords must never traverse plain HTTP outside this machine.
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw new Error('非本机 XiaocongAPI 地址必须使用 HTTPS')
    return url.toString().replace(/\/+$/, '')
  }
  const newApiRequest = async (base: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const data: any = await response.json().catch(() => null)
    if (!response.ok || !data || data.success === false)
      throw new Error(`XiaocongAPI 请求失败 (${response.status})`)
    return data
  }
  const readCurrentDefaultModel = (): string | undefined => {
    try {
      const adm = ctx.get('agentDefaultModel') as { currentSelection?: () => { provider?: string; model?: string } } | undefined
      const sel = adm?.currentSelection?.()
      if (sel?.provider === 'newapi' && typeof sel.model === 'string' && sel.model) return sel.model
    } catch { /* optional service */ }
    return undefined
  }

  /** Pull /v1/models for the saved sk- and write into llm-pi-ai newapi (+ studio cache). */
  const syncModelsFromToken = async (): Promise<OpResult> => {
    if (!config.newApiToken) return { success: false, error: '尚未设置 XiaocongAPI 令牌' }
    try {
      const base = validateBase(config.newApiBaseUrl)
      const token = normalizeToken(config.newApiToken)
      const result = await syncNewApiModels(ctx, {
        baseUrl: base,
        token,
        currentDefault: readCurrentDefaultModel(),
        fetchModels: async () => newApiRequest(base, '/v1/models', undefined, {
          Authorization: `Bearer ${token}`,
        }),
      })
      if (result.models.length) {
        config = { ...config, newApiModels: result.models }
        saveConfig(config)
      }
      return {
        ...authStatus(),
        modelCount: result.models.length || config.newApiModels.length,
        models: result.models.length ? result.models : config.newApiModels,
        defaultModel: result.defaultModel,
        defaultChanged: result.defaultChanged,
        modelsSyncedLive: result.appliedLive,
        modelsPatchedFiles: result.patchedFiles,
        ...(result.warning ? { warning: result.warning, note: result.warning } : {
          note: result.models.length
            ? `已同步 ${result.models.length} 个模型到 XiaocongAPI 列表`
            : '鉴权成功；暂无可用模型，请在 XiaocongAPI 控制台配置渠道。',
        }),
      }
    } catch {
      return { success: false, error: '同步 XiaocongAPI 模型失败，请检查服务地址、令牌与渠道配置' }
    }
  }

  const authProbe = async (): Promise<OpResult> => {
    if (!config.newApiToken) return { success: false, error: '尚未设置 XiaocongAPI 令牌' }
    // Probe also refreshes the picker from the live key so channels added in console show up.
    const synced = await syncModelsFromToken()
    if (!synced.success) return synced
    return { ...synced, status: 200 }
  }

  if (config.newApiEnabled && config.newApiToken) {
    void syncModelsFromToken().catch(() => { /* boot soft-fail */ })
  }
  /** Stable studio model-token name; older claims used timestamped digital-human-studio-* names. */
  const STUDIO_TOKEN_NAME = 'digital-human-studio'
  const STUDIO_TOKEN_PREFIX = 'digital-human-studio'

  const probeInferenceKey = async (base: string, key: string): Promise<boolean> => {
    try {
      await newApiRequest(base, '/v1/models', undefined, {
        Authorization: `Bearer ${normalizeToken(key)}`,
      })
      return true
    } catch { return false }
  }

  const keyFromBatch = (keys: any, id: number): string => {
    const keyData = keys?.data?.keys || keys?.data
    const entry = Array.isArray(keyData)
      ? keyData.find((item: any) => Number(item.id) === Number(id))
      : keyData?.[String(id)]
    const key = typeof entry === 'string' ? entry : entry?.key
    return typeof key === 'string' ? key : ''
  }

  const persistStudioKey = async (
    base: string,
    key: string,
    userId: number,
    username: string,
    claimed: string,
  ): Promise<OpResult> => {
    config = {
      ...config,
      newApiBaseUrl: base,
      newApiToken: normalizeToken(key),
      newApiEnabled: true,
      newApiUsername: username,
      newApiUserId: userId,
    }
    saveConfig(config)
    await syncCredential()
    const synced = await syncModelsFromToken()
    return { ...authStatus(), claimed, ...(synced.success ? {
      models: synced.models,
      modelCount: synced.modelCount,
      defaultModel: synced.defaultModel,
      defaultChanged: synced.defaultChanged,
      modelsSyncedLive: synced.modelsSyncedLive,
      note: synced.note,
      warning: synced.warning,
    } : { warning: synced.error || '模型同步失败' }) }
  }

  /**
   * Exchange a transient New API access_token for a persisted sk- model token.
   * Reuse a still-valid local NEW_API_TOKEN or an existing studio token on New API;
   * create a new model key only when none are usable.
   */
  const claimFromAccess = async (opts: {
    baseUrl?: string
    accessToken: string
    userId: number | string
    username?: string
  }): Promise<OpResult> => {
    const base = validateBase(opts.baseUrl ?? config.newApiBaseUrl)
    const access = String(opts.accessToken || '').trim()
    const userId = Number(opts.userId)
    if (!access) throw new Error('缺少 access_token')
    if (!Number.isFinite(userId) || userId <= 0) throw new Error('缺少有效用户 id')
    const username = String(opts.username || config.newApiUsername || '')
    const headers = { Authorization: `Bearer ${access}`, 'New-Api-User': String(userId) }

    // 1) Local sk- still valid for this gateway → keep it.
    if (config.newApiToken && config.newApiBaseUrl === base) {
      if (await probeInferenceKey(base, config.newApiToken)) {
        return persistStudioKey(base, config.newApiToken, userId, username || config.newApiUsername, 'reused-local')
      }
    }

    // 2) Reuse an existing New API studio token (stable name or older timestamped names).
    try {
      const found = await newApiRequest(
        base,
        `/api/token/search?keyword=${encodeURIComponent(STUDIO_TOKEN_PREFIX)}`,
        undefined,
        headers,
      )
      const items = Array.isArray(found.data) ? found.data : found.data?.items || []
      const nowSec = Math.floor(Date.now() / 1000)
      const candidates = (items as any[])
        .filter((item) => typeof item?.name === 'string'
          && (item.name === STUDIO_TOKEN_NAME || item.name.startsWith(`${STUDIO_TOKEN_PREFIX}-`))
          && Number(item.id) > 0
          && !(Number(item.expired_time) > 0 && Number(item.expired_time) < nowSec)
          && item.status !== 0 && item.status !== false && item.status !== 'disabled')
        .sort((a, b) => {
          const aExact = a.name === STUDIO_TOKEN_NAME ? 1 : 0
          const bExact = b.name === STUDIO_TOKEN_NAME ? 1 : 0
          if (aExact !== bExact) return bExact - aExact
          return Number(b.id) - Number(a.id)
        })
      for (const item of candidates.slice(0, 8)) {
        const id = Number(item.id)
        try {
          const keys = await newApiRequest(base, '/api/token/batch/keys', { ids: [id] }, headers)
          const key = keyFromBatch(keys, id)
          if (!key) continue
          if (await probeInferenceKey(base, key)) {
            return persistStudioKey(base, key, userId, username, 'reused-remote')
          }
        } catch { /* try next candidate */ }
      }
    } catch { /* search unavailable; fall through to create */ }

    // 3) Create only when missing / invalid / revoked.
    const tokenName = STUDIO_TOKEN_NAME
    const created = await newApiRequest(base, '/api/token/', {
      name: tokenName, expired_time: -1, remain_quota: 500000, unlimited_quota: false,
      model_limits_enabled: false, group: 'default',
    }, headers)
    let id = created.data?.id
    if (!id) {
      const found = await newApiRequest(base, `/api/token/search?keyword=${encodeURIComponent(tokenName)}`, undefined, headers)
      const items = Array.isArray(found.data) ? found.data : found.data?.items || []
      id = items.find((item: any) => item.name === tokenName)?.id
    }
    if (!id) throw new Error('令牌已创建但无法定位，请在 XiaocongAPI 控制台查看并粘贴令牌')
    const keys = await newApiRequest(base, '/api/token/batch/keys', { ids: [Number(id)] }, headers)
    const key = keyFromBatch(keys, Number(id))
    if (!key) throw new Error('无法取得完整令牌，请在 XiaocongAPI 控制台查看并粘贴令牌')
    return persistStudioKey(base, key, userId, username, 'created')
  }

  const authLogin = async (body: any): Promise<OpResult> => {
    const base = validateBase(body.baseUrl ?? config.newApiBaseUrl)
    if (typeof body.username !== 'string' || !body.username.trim() || typeof body.password !== 'string' || !body.password)
      throw new Error('请输入用户名与密码')
    // Account access token and password are transient; only the inference key is persisted.
    const login = await newApiRequest(base, '/api/user/login', { username: body.username.trim(), password: body.password })
    const data = login.data || {}
    const access = data.access_token || data.token
    const user = data.user || data
    if (!access || !user.id) throw new Error('登录未完成（可能需要二次验证），请在控制台登录后粘贴令牌')
    return claimFromAccess({
      baseUrl: base,
      accessToken: access,
      userId: user.id,
      username: String(user.username || body.username.trim()),
    })
  }

  /**
   * Browser Sign-in auto-claim:
   * - empty body / no accessToken: if sk- already saved, re-sync and succeed
   * - {accessToken,userId}: exchange for sk- (from same-host /api/user/auth/refresh proxy)
   */
  const authClaim = async (body: any = {}): Promise<OpResult> => {
    const access = typeof body?.accessToken === 'string' ? body.accessToken.trim()
      : typeof body?.access_token === 'string' ? body.access_token.trim() : ''
    if (access) {
      const userId = body.userId ?? body.user_id ?? body.id
      const username = typeof body.username === 'string' ? body.username : undefined
      return claimFromAccess({
        baseUrl: body.baseUrl,
        accessToken: access,
        userId,
        username,
      })
    }
    if (config.newApiToken) {
      const base = validateBase(config.newApiBaseUrl)
      if (await probeInferenceKey(base, config.newApiToken)) {
        await syncCredential()
        const synced = await syncModelsFromToken()
        return { ...authStatus(), claimed: 'reused-local', ...(synced.success ? {
          models: synced.models, modelCount: synced.modelCount, defaultModel: synced.defaultModel,
          note: synced.note, warning: synced.warning, modelsSyncedLive: synced.modelsSyncedLive,
        } : { warning: synced.error || '模型同步失败' }) }
      }
      // Stored key is dead; require a session claim (or password login) to recover/create.
      return { success: false, error: '本地令牌已失效，请重新登录 XiaocongAPI', needsLogin: true, hasToken: true }
    }
    return { success: false, error: '尚未登录 XiaocongAPI，且本机无已保存令牌', needsLogin: true }
  }

  /** Same-host proxies for New API auth cookie paths (Path=/api/user/auth). */
  const proxyNewApiAuth = (upstreamPath: '/api/user/auth/refresh' | '/api/user/auth/logout') =>
    async (req: any, res: any) => {
      if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
      if (req.headers.origin) {
        try {
          if (new URL(req.headers.origin).host !== req.headers.host) {
            sendJson(res, 403, { success: false, error: 'origin not allowed' }); return
          }
        } catch { sendJson(res, 403, { success: false }); return }
      }
      const base = validateBase(config.newApiBaseUrl)
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (typeof req.headers.cookie === 'string' && req.headers.cookie) headers.cookie = req.headers.cookie
      if (typeof req.headers['x-auth-session'] === 'string' && req.headers['x-auth-session']) {
        headers['X-Auth-Session'] = req.headers['x-auth-session']
      }
      const upstream = await fetch(`${base}${upstreamPath}`, {
        method: 'POST',
        redirect: 'error',
        headers,
        body: undefined,
        signal: AbortSignal.timeout(15000),
      })
      const raw = Buffer.from(await upstream.arrayBuffer())
      const outHeaders: Record<string, string | string[]> = {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'content-length': String(raw.length),
        'cache-control': 'no-store',
      }
      const setCookies = typeof (upstream.headers as any).getSetCookie === 'function'
        ? (upstream.headers as any).getSetCookie() as string[]
        : []
      if (setCookies.length) outHeaders['set-cookie'] = setCookies
      else {
        const single = upstream.headers.get('set-cookie')
        if (single) outHeaders['set-cookie'] = single
      }
      res.writeHead(upstream.status, outHeaders)
      res.end(raw)
    }
  const proxyNewApiAuthRefresh = proxyNewApiAuth('/api/user/auth/refresh')
  const proxyNewApiAuthLogout = proxyNewApiAuth('/api/user/auth/logout')


  const getWorkspace = (): OpResult => ({
    success: true,
    workspace: {
      folder: config.lastProjectFolder,
      draft_id: config.lastDraftId,
      draft_path: config.lastDraftPath,
      vectcutBaseUrl: config.vectcutBaseUrl,
      vectcutRoot: config.vectcutRoot,
    },
  })

  const probeOnline = async (): Promise<{
    online: boolean
    reachable: boolean
    status: number
    lastProbe: Record<string, unknown>
  }> => {
    const probe = await vectcutFetch(config.vectcutBaseUrl, '/get_font_types')
    const reachable = probe.status !== 0
    // /get_font_types may 404 on some builds; any HTTP response means the server is up.
    const online = reachable && probe.status !== 0
    return {
      online,
      reachable,
      status: probe.status,
      lastProbe: probe.error
        ? { error: probe.error }
        : { ok: probe.ok, httpStatus: probe.status },
    }
  }

  const getStatus = async (): Promise<OpResult> => {
    const probe = await probeOnline()
    const guide = startGuidance(config)
    const pid = config.enginePid
    const pidAlive = pid != null ? isPidAlive(pid) : false
    const pidCmd = pidAlive && pid != null ? processCommand(pid) : null
    const managed = !!(pid && pidAlive && looksLikeVectCut(pidCmd))
    if (pid && !pidAlive) {
      config = { ...config, enginePid: null }
      saveConfig(config)
    }
    return {
      success: true,
      host: { ok: true, plugin: 'digital-human-studio', version: PLUGIN_VERSION },
      vectcut: {
        baseUrl: config.vectcutBaseUrl,
        online: probe.online,
        reachable: probe.reachable,
        status: probe.status,
        lastProbe: probe.lastProbe,
        enginePid: config.enginePid,
        managed,
        pidAlive,
        log: VECTCUT_LOG,
        start: probe.online ? null : guide,
      },
      workspace: {
        folder: config.lastProjectFolder,
        draft_id: config.lastDraftId,
        draft_path: config.lastDraftPath,
      },
    }
  }

  const waitUntilOnline = async (timeoutMs = 20000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const probe = await probeOnline()
      if (probe.online) return true
      await sleep(400)
    }
    return false
  }

  const engineStart = async (): Promise<OpResult> => {
    const before = await probeOnline()
    if (before.online) {
      return {
        success: true,
        already_running: true,
        online: true,
        enginePid: config.enginePid,
        managed: !!(config.enginePid && isPidAlive(config.enginePid)),
        baseUrl: config.vectcutBaseUrl,
        log: VECTCUT_LOG,
        note: 'VectCut already online; start is a no-op.',
      }
    }

    // Reuse tracked PID if it is still starting.
    if (config.enginePid && isPidAlive(config.enginePid)) {
      const cmd = processCommand(config.enginePid)
      if (looksLikeVectCut(cmd)) {
        const online = await waitUntilOnline(15000)
        if (online) {
          return {
            success: true,
            already_running: true,
            waited: true,
            online: true,
            enginePid: config.enginePid,
            managed: true,
            baseUrl: config.vectcutBaseUrl,
            log: VECTCUT_LOG,
          }
        }
      }
    }

    const root = expandPath(config.vectcutRoot || DEFAULT_VECTCUT_ROOT)
    if (!root || !existsSync(root)) {
      return {
        success: false,
        error: `vectcutRoot not found: ${root || '(empty)'}`,
        start: startGuidance(config),
      }
    }
    const script = join(root, 'capcut_server.py')
    if (!existsSync(script)) {
      return { success: false, error: `missing ${script}`, start: startGuidance(config) }
    }
    const venvPy = join(root, '.venv', 'bin', 'python')
    const py = existsSync(venvPy) ? venvPy : 'python3'

    let logFd: number
    try {
      logFd = openSync(VECTCUT_LOG, 'a')
    } catch (e: any) {
      return { success: false, error: `cannot open log ${VECTCUT_LOG}: ${e?.message || e}` }
    }

    let child
    try {
      child = spawn(py, ['capcut_server.py'], {
        cwd: root,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env },
      })
    } catch (e: any) {
      try {
        closeSync(logFd)
      } catch {
        /* ignore */
      }
      return { success: false, error: `spawn failed: ${e?.message || e}`, start: startGuidance(config) }
    }
    try {
      closeSync(logFd)
    } catch {
      /* ignore */
    }
    child.unref()

    const pid = child.pid
    if (!pid) {
      return { success: false, error: 'spawn returned no pid', start: startGuidance(config) }
    }

    config = { ...config, enginePid: pid, vectcutRoot: root }
    saveConfig(config)

    const online = await waitUntilOnline(20000)
    if (!online) {
      return {
        success: false,
        error: `VectCut spawned (pid ${pid}) but did not become online within 20s. Check ${VECTCUT_LOG}`,
        enginePid: pid,
        managed: true,
        online: false,
        log: VECTCUT_LOG,
        start: startGuidance(config),
      }
    }

    return {
      success: true,
      started: true,
      online: true,
      enginePid: pid,
      managed: true,
      baseUrl: config.vectcutBaseUrl,
      vectcutRoot: root,
      log: VECTCUT_LOG,
    }
  }

  const engineStop = async (): Promise<OpResult> => {
    const pid = config.enginePid
    if (!pid) {
      const probe = await probeOnline()
      if (probe.online) {
        return {
          success: false,
          error:
            'VectCut is online but not managed by this plugin (no tracked enginePid). Refusing to kill unrelated processes. Start via the plugin next time so stop can manage it.',
          online: true,
          managed: false,
          log: VECTCUT_LOG,
        }
      }
      return {
        success: true,
        already_stopped: true,
        online: false,
        managed: false,
        log: VECTCUT_LOG,
      }
    }

    if (!isPidAlive(pid)) {
      config = { ...config, enginePid: null }
      saveConfig(config)
      const probe = await probeOnline()
      return {
        success: true,
        already_stopped: true,
        cleared_stale_pid: pid,
        online: probe.online,
        managed: false,
        log: VECTCUT_LOG,
      }
    }

    const cmd = processCommand(pid)
    if (!looksLikeVectCut(cmd)) {
      return {
        success: false,
        error: `refusing to kill pid ${pid}: command does not look like VectCut (${cmd || 'unknown'})`,
        enginePid: pid,
        managed: false,
      }
    }

    try {
      process.kill(pid, 'SIGTERM')
    } catch (e: any) {
      return { success: false, error: `SIGTERM failed for pid ${pid}: ${e?.message || e}`, enginePid: pid }
    }

    const deadline = Date.now() + 8000
    while (Date.now() < deadline && isPidAlive(pid)) {
      await sleep(200)
    }
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* ignore */
      }
      await sleep(300)
    }

    const stillAlive = isPidAlive(pid)
    if (!stillAlive) {
      config = { ...config, enginePid: null }
      saveConfig(config)
    }

    const probe = await probeOnline()
    return {
      success: !stillAlive,
      stopped: !stillAlive,
      enginePid: stillAlive ? pid : null,
      online: probe.online,
      managed: stillAlive,
      log: VECTCUT_LOG,
      error: stillAlive ? `pid ${pid} still alive after SIGKILL` : undefined,
    }
  }

  const listDrafts = async (folderInput?: string): Promise<OpResult> => {
    let folder = expandPath(folderInput || config.lastProjectFolder)
    if (!folder) {
      return { success: false, error: 'folder required', hint: DEFAULT_FOLDER }
    }
    if (!existsSync(folder)) {
      return { success: false, error: `folder not found: ${folder}`, folder }
    }
    const drafts = scanDraftFolder(folder)
    config = { ...config, lastProjectFolder: folder }
    saveConfig(config)

    let vectcutProjects: any[] = []
    const vc = await vectcutFetch(config.vectcutBaseUrl, '/list_projects', {})
    if (vc.data?.success && Array.isArray(vc.data?.output?.projects)) {
      vectcutProjects = vc.data.output.projects
    }

    return {
      success: true,
      folder,
      count: drafts.length,
      drafts,
      vectcut_projects: vectcutProjects,
      workspace: {
        folder: config.lastProjectFolder,
        draft_id: config.lastDraftId,
        draft_path: config.lastDraftPath,
      },
    }
  }

  const loadDraft = async (args: {
    path?: string
    draft_path?: string
    name?: string
    project_name?: string
    draft_id?: string
    folder?: string
  }): Promise<OpResult> => {
    let draftPath = expandPath(String(args.path || args.draft_path || ''))
    const name = String(args.name || args.project_name || args.draft_id || '').trim()
    const folderHint = expandPath(String(args.folder || config.lastProjectFolder || ''))

    if (!draftPath && name && folderHint) {
      const candidate = join(folderHint, name)
      draftPath = existsSync(candidate) ? candidate : expandPath(name)
    }
    if (!draftPath && name) draftPath = expandPath(name)

    if (!draftPath || !existsSync(draftPath)) {
      return {
        success: false,
        error: `draft path not found: ${draftPath || name || '(empty)'}`,
      }
    }

    let st
    try {
      st = statSync(draftPath)
    } catch {
      return { success: false, error: `cannot stat: ${draftPath}` }
    }
    if (!st.isDirectory()) {
      return { success: false, error: 'draft path must be a directory' }
    }

    let summary: Record<string, unknown> | null = null
    let fromVectcut = false
    const vc = await vectcutFetch(config.vectcutBaseUrl, '/read_project', {
      project_name: draftPath,
    })
    if (vc.data?.success && vc.data?.output) {
      summary = vc.data.output
      fromVectcut = true
    } else {
      summary = readLocalSummary(draftPath)
    }

    const draftId = basename(draftPath)
    const parentFolder = dirname(draftPath)
    config = {
      ...config,
      lastProjectFolder: folderHint || parentFolder,
      lastDraftId: draftId,
      lastDraftPath: draftPath,
    }
    saveConfig(config)

    const canvas = (summary as any)?.canvas_config || {}
    return {
      success: true,
      draft_id: draftId,
      draft_path: draftPath,
      draft_folder: parentFolder,
      project_name: (summary as any)?.project_name || draftId,
      summary,
      from_vectcut: fromVectcut,
      width: Number(canvas.width) || undefined,
      height: Number(canvas.height) || undefined,
      workspace: {
        folder: config.lastProjectFolder,
        draft_id: config.lastDraftId,
        draft_path: config.lastDraftPath,
      },
    }
  }

  const createDraft = async (args: { width?: number; height?: number } = {}): Promise<OpResult> => {
    const width = Number(args.width) || 1080
    const height = Number(args.height) || 1920
    const result = await vectcutFetch(config.vectcutBaseUrl, '/create_draft', { width, height })
    if (result.error) {
      return {
        success: false,
        error: `VectCut unreachable at ${config.vectcutBaseUrl}: ${result.error}`,
        start: startGuidance(config),
      }
    }
    if (result.data?.success && result.data?.output?.draft_id) {
      config = {
        ...config,
        lastDraftId: String(result.data.output.draft_id),
        lastDraftPath: '',
      }
      saveConfig(config)
    }
    if (result.data && typeof result.data === 'object') {
      return { ...result.data, workspace: getWorkspace().workspace }
    }
    return { success: false, error: 'empty response from VectCut create_draft' }
  }

  const addVideo = async (args: {
    draft_id?: string
    paths?: string[]
    video_url?: string
    path?: string
    width?: number
    height?: number
    start?: number
    end?: number
    target_start?: number
    volume?: number
    track_name?: string
    duration?: number
    draft_folder?: string
  }): Promise<OpResult> => {
    const draft_id = args.draft_id || config.lastDraftId
    const paths: string[] = Array.isArray(args.paths)
      ? args.paths
      : args.video_url
        ? [args.video_url]
        : args.path
          ? [args.path]
          : []

    if (!paths.length) {
      return { success: false, error: 'paths / video_url / path required' }
    }
    if (!draft_id) {
      return { success: false, error: 'draft_id required (create or load a draft first)' }
    }

    const width = Number(args.width) || 1080
    const height = Number(args.height) || 1920
    const results: any[] = []
    let currentDraftId = draft_id

    for (const raw of paths) {
      const video_url = normalizeVideoUrl(raw)
      if (!video_url) continue
      const payload: Record<string, unknown> = {
        video_url,
        draft_id: currentDraftId,
        width,
        height,
        start: args.start ?? 0,
        end: args.end ?? 0,
        target_start: args.target_start ?? 0,
        volume: args.volume ?? 1.0,
        track_name: args.track_name || 'video_main',
      }
      if (args.duration != null) payload.duration = args.duration
      if (args.draft_folder) payload.draft_folder = args.draft_folder

      const result = await vectcutFetch(config.vectcutBaseUrl, '/add_video', payload)
      if (result.error) {
        return {
          success: false,
          error: `VectCut unreachable: ${result.error}`,
          results,
          start: startGuidance(config),
        }
      }
      results.push(result.data)
      if (!result.data?.success) {
        return {
          success: false,
          error: result.data?.error || 'add_video failed',
          results,
          draft_id: currentDraftId,
        }
      }
      const out = result.data.output || {}
      if (out.draft_id) currentDraftId = out.draft_id
    }

    const last = results[results.length - 1]
    if (currentDraftId) {
      config = { ...config, lastDraftId: String(currentDraftId) }
      saveConfig(config)
    }
    return {
      success: true,
      draft_id: currentDraftId || last?.output?.draft_id,
      draft_url: last?.output?.draft_url,
      added: results.length,
      results,
      workspace: getWorkspace().workspace,
    }
  }

  const saveDraft = async (args: {
    draft_id?: string
    draft_folder?: string
    project_name?: string
    auto_deploy?: boolean
    auto_reload?: boolean
  } = {}): Promise<OpResult> => {
    const draft_id = args.draft_id || config.lastDraftId
    if (!draft_id) {
      return { success: false, error: 'draft_id required' }
    }
    const draft_folder =
      args.draft_folder ||
      (config.lastDraftPath ? dirname(config.lastDraftPath) : config.lastProjectFolder) ||
      undefined
    const payload = {
      draft_id,
      draft_folder,
      project_name: args.project_name || draft_id,
      auto_deploy: args.auto_deploy ?? true,
      auto_reload: args.auto_reload ?? false,
    }
    const result = await vectcutFetch(config.vectcutBaseUrl, '/save_draft', payload)
    if (result.error) {
      return {
        success: false,
        error: `VectCut unreachable: ${result.error}`,
        start: startGuidance(config),
      }
    }
    if (result.data && typeof result.data === 'object') {
      return { ...result.data, workspace: getWorkspace().workspace }
    }
    return { success: false, error: 'empty response from VectCut save_draft' }
  }

  const exportDraft = async (args: {
    draft_id?: string
    output_path?: string
    draft_folder?: string
  } = {}): Promise<OpResult> => {
    const draft_id = args.draft_id || config.lastDraftId
    if (!draft_id) {
      return { success: false, error: 'draft_id required' }
    }
    const payload: Record<string, unknown> = { draft_id }
    if (args.output_path) payload.output_path = args.output_path
    if (args.draft_folder) payload.draft_folder = args.draft_folder

    const result = await vectcutFetch(config.vectcutBaseUrl, '/export_draft_to_video', payload)
    if (result.error) {
      return {
        success: false,
        error: `VectCut unreachable: ${result.error}`,
        start: startGuidance(config),
      }
    }
    if (result.status === 404) {
      // Fallback preview URL for builds without local export.
      const urlRes = await vectcutFetch(config.vectcutBaseUrl, '/generate_draft_url', { draft_id })
      return {
        success: false,
        error:
          'This VectCut build has no /export_draft_to_video. Use save_draft into Jianying, or open draft_url preview if available.',
        export_available: false,
        draft_id,
        draft_url: urlRes.data?.output?.draft_url,
        hint: 'Upgrade VectCut or export from Jianying after save_draft.',
      }
    }
    if (result.data && typeof result.data === 'object') {
      return { ...result.data, export_available: true, workspace: getWorkspace().workspace }
    }
    return { success: false, error: `export failed (HTTP ${result.status})`, raw: result.data }
  }

  const exportStatus = async (args: { task_id?: string; draft_id?: string } = {}): Promise<OpResult> => {
    const q = new URLSearchParams()
    if (args.task_id) q.set('task_id', args.task_id)
    if (args.draft_id) q.set('draft_id', args.draft_id)
    const path = `/export_status${q.toString() ? `?${q}` : ''}`
    const result = await vectcutFetch(config.vectcutBaseUrl, path)
    if (result.error) {
      return {
        success: false,
        error: `VectCut unreachable: ${result.error}`,
        start: startGuidance(config),
      }
    }
    if (result.status === 404) {
      return {
        success: false,
        error: 'This VectCut build has no /export_status endpoint.',
        export_available: false,
      }
    }
    if (result.data && typeof result.data === 'object') {
      return { ...result.data, export_available: true }
    }
    return { success: false, error: `export_status failed (HTTP ${result.status})`, raw: result.data }
  }

  const register = (path: string, handler: (req: any, res: any) => void | Promise<void>) =>
    ws.register({
      kind: 'exact',
      path,
      handler: (req, res) => {
        Promise.resolve(handler(req, res)).catch((e) => {
          console.error(`[digital-human-studio] ${path} error:`, e)
          if (!res.headersSent) sendJson(res, 500, { success: false, error: String(e?.message || e) })
        })
      },
    })

  const httpStatusFor = (body: OpResult): number => {
    if (body.success) return 200
    const err = String(body.error || '')
    if (err.includes('not found')) return 404
    if (err.includes('required') || err.includes('must be')) return 400
    if (err.includes('unreachable')) return 502
    return 200
  }

  ctx.effect(() => {
    const disposers = [
      register('/digital-human-studio/assets/xiaocong-only.png', async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { success: false, error: 'method not allowed' }); return
        }
        try {
          if (!existsSync(XIAOCONG_ONLY_PNG)) {
            sendJson(res, 404, { success: false, error: 'xiaocong-only.png missing' }); return
          }
          const buf = readFileSync(XIAOCONG_ONLY_PNG)
          if (req.method === 'HEAD') {
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length, 'cache-control': 'public, max-age=86400' })
            res.end(); return
          }
          sendBinary(res, 200, buf, 'image/png')
        } catch (e: any) {
          sendJson(res, 500, { success: false, error: e?.message || String(e) })
        }
      }),
      register('/digital-human-studio/auth/authorize', async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { success: false, error: 'method not allowed' }); return
        }
        let returnUrl = 'http://127.0.0.1:3080/'
        let loginUrl = 'http://127.0.0.1:3000/login'
        try {
          const host = String(req.headers.host || '127.0.0.1:3080')
          const proto = host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https'
          returnUrl = `${proto}://${host}/`
          const url = new URL(req.url || '/', returnUrl)
          const q = url.searchParams.get('return')
          if (q) {
            const parsed = new URL(q)
            if (['http:', 'https:'].includes(parsed.protocol)
              && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
              returnUrl = parsed.toString()
            }
          }
          loginUrl = `${validateBase(config.newApiBaseUrl)}/login`
        } catch { /* keep defaults */ }
        sendHtml(res, 200, authorizePageHtml(returnUrl, loginUrl))
      }),
      register('/digital-human-studio/auth/authorized', async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { success: false, error: 'method not allowed' }); return
        }
        let returnUrl = 'http://127.0.0.1:3080/'
        try {
          const host = String(req.headers.host || '127.0.0.1:3080')
          const proto = host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https'
          returnUrl = `${proto}://${host}/`
          const url = new URL(req.url || '/', returnUrl)
          const q = url.searchParams.get('return')
          if (q) {
            const parsed = new URL(q)
            if (['http:', 'https:'].includes(parsed.protocol)
              && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
              returnUrl = parsed.toString()
            }
          }
        } catch { /* keep default */ }
        sendHtml(res, 200, authorizedPageHtml(returnUrl))
      }),
      register('/api/user/auth/refresh', proxyNewApiAuthRefresh),
      register('/api/user/auth/logout', proxyNewApiAuthLogout),
      ...['status', 'login', 'logout', 'save', 'probe', 'claim'].map((action) =>
        register(`/digital-human-studio/auth/${action}`, async (req, res) => {
          const expected = action === 'status' ? 'GET' : 'POST'
          if (req.method !== expected) { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
          // Same-origin JSON requests only: prevent drive-by credential/config writes.
          if (req.headers.origin) {
            try {
              if (new URL(req.headers.origin).host !== req.headers.host) {
                sendJson(res, 403, { success: false, error: 'origin not allowed' }); return
              }
            } catch { sendJson(res, 403, { success: false }); return }
          }
          if (expected === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
            sendJson(res, 415, { success: false, error: 'application/json required' }); return
          }
          try {
            if (action === 'status') { sendJson(res, 200, authStatus()); return }
            if (action === 'probe') { sendJson(res, 200, await authProbe()); return }
            const body = await readJson(req)
            if (action === 'claim') { sendJson(res, 200, await authClaim(body)); return }
            if (action === 'login') { sendJson(res, 200, await authLogin(body)); return }
            if (action === 'logout') {
              config = { ...config, newApiToken: '', newApiEnabled: false, newApiUsername: '', newApiUserId: null, newApiModels: [] }
              saveConfig(config)
              await syncCredential()
              sendJson(res, 200, authStatus())
              return
            } else {
              const base = validateBase(body.baseUrl ?? config.newApiBaseUrl)
              if (body.token !== undefined && typeof body.token !== 'string') throw new Error('令牌必须是文本')
              if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new Error('enabled 必须为布尔值')
              const changedBase = base !== config.newApiBaseUrl
              const token = body.token !== undefined ? normalizeToken(body.token) : changedBase ? '' : config.newApiToken
              config = { ...config, newApiBaseUrl: base, newApiToken: token,
                newApiEnabled: !!token && (body.enabled ?? true),
                newApiUsername: changedBase || body.token !== undefined ? '' : config.newApiUsername,
                newApiUserId: changedBase || body.token !== undefined ? null : config.newApiUserId }
            }
            saveConfig(config)
            await syncCredential()
            if (config.newApiToken) {
              sendJson(res, 200, await syncModelsFromToken())
            } else {
              sendJson(res, 200, authStatus())
            }
          } catch (e: any) {
            // Do not return upstream payloads (which can contain keys or account tokens).
            sendJson(res, 400, { success: false, error: e instanceof TypeError ? 'XiaocongAPI 请求失败，请检查服务地址' : e.message || '授权失败' })
          }
        })),
      register('/digital-human-studio/ping' , (_req, res) => {
        sendJson(res, 200, {
          ok: true,
          plugin: 'digital-human-studio',
          version: PLUGIN_VERSION,
          time: new Date().toISOString(),
          vectcutBaseUrl: config.vectcutBaseUrl,
          lastProjectFolder: config.lastProjectFolder,
          lastDraftId: config.lastDraftId,
          enginePid: config.enginePid,
          tools: [
            'dh_auth_status', 'dh_auth_probe',
            'dh_get_workspace',
            'dh_list_drafts',
            'dh_load_draft',
            'dh_create_draft',
            'dh_add_video',
            'dh_save_draft',
            'dh_export_draft',
            'dh_export_status',
            'dh_engine_status',
            'dh_engine_start',
            'dh_engine_stop',
          ],
        })
      }),

      register('/digital-human-studio/config', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        if (method === 'GET') {
          sendJson(res, 200, { success: true, config: publicConfig() })
          return
        }
        if (method === 'POST') {
          const body = await readJson(req)
          const nextUrl = String(body.vectcutBaseUrl || config.vectcutBaseUrl).trim().replace(/\/$/, '')
          if (!/^https?:\/\//i.test(nextUrl)) {
            sendJson(res, 400, { success: false, error: 'vectcutBaseUrl must be http(s) URL' })
            return
          }
          const folder =
            body.lastProjectFolder != null
              ? expandPath(String(body.lastProjectFolder))
              : config.lastProjectFolder
          const root =
            body.vectcutRoot != null ? expandPath(String(body.vectcutRoot)) : config.vectcutRoot
          config = {
            ...config,
            vectcutBaseUrl: nextUrl,
            vectcutRoot: root,
            lastProjectFolder: folder,
            lastDraftId:
              body.lastDraftId != null ? String(body.lastDraftId) : config.lastDraftId,
            lastDraftPath:
              body.lastDraftPath != null
                ? expandPath(String(body.lastDraftPath))
                : config.lastDraftPath,
            enginePid: config.enginePid,
          }
          saveConfig(config)
          sendJson(res, 200, { success: true, config: publicConfig() })
          return
        }
        sendJson(res, 405, { success: false, error: 'method not allowed' })
      }),

      register('/digital-human-studio/workspace', (_req, res) => {
        sendJson(res, 200, getWorkspace())
      }),

      register('/digital-human-studio/status', async (_req, res) => {
        sendJson(res, 200, await getStatus())
      }),

      register('/digital-human-studio/engine_start', async (_req, res) => {
        const body = await engineStart()
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/engine_stop', async (_req, res) => {
        const body = await engineStop()
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/list_drafts', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        let folder = config.lastProjectFolder
        if (method === 'POST') {
          const body = await readJson(req)
          if (body.folder != null) folder = String(body.folder)
        } else if (req.url) {
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            if (u.searchParams.get('folder')) folder = u.searchParams.get('folder') || folder
          } catch {
            /* ignore */
          }
        }
        const body = await listDrafts(folder)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/load_draft', async (req, res) => {
        const bodyIn = await readJson(req)
        const body = await loadDraft(bodyIn)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/create_draft', async (req, res) => {
        const bodyIn = await readJson(req)
        const body = await createDraft(bodyIn)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/add_video', async (req, res) => {
        const bodyIn = await readJson(req)
        const body = await addVideo(bodyIn)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/save_draft', async (req, res) => {
        const bodyIn = await readJson(req)
        const body = await saveDraft(bodyIn)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/export', async (req, res) => {
        const bodyIn = await readJson(req)
        const body = await exportDraft(bodyIn)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/export_status', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        let args: any = {}
        if (method === 'POST') {
          args = await readJson(req)
        } else if (req.url) {
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            args = {
              task_id: u.searchParams.get('task_id') || undefined,
              draft_id: u.searchParams.get('draft_id') || undefined,
            }
          } catch {
            /* ignore */
          }
        }
        const body = await exportStatus(args)
        sendJson(res, httpStatusFor(body), body)
      }),
    ]

    console.log(
      `[digital-human-studio] routes+tools registered; VectCut → ${config.vectcutBaseUrl}; folder → ${config.lastProjectFolder || '(none)'}`,
    )
    return () => {
      for (const d of disposers) d()
    }
  }, 'digital-human-studio: routes')

  // Agent-facing tools (chat can call these by name).
  const renderJson = (_args: unknown, value: unknown) => [
    { type: 'text' as const, text: jsonText(value) },
  ]

  ctx.effect(() => {
    const tools = [
      ...(['dh_auth_status', 'dh_auth_probe'] as const).map((toolName) => ctx.tools.register(defineTool({
        name: toolName,
        description: toolName === 'dh_auth_status' ? '查看 XiaocongAPI 授权状态（仅脱敏信息）' : '使用已保存令牌探测 XiaocongAPI 模型接口；不接收密码或令牌',
        parameters: {}, output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
        async execute() { return toolName === 'dh_auth_status' ? authStatus() : authProbe() },
        presentCall: () => ({ card: 'generic', title: toolName, kind: 'other' }),
      }))),
      ctx.tools.register(
        defineTool({
          name: 'dh_get_workspace',
          description:
            'Digital Human Studio: return the selected project folder, draft_id, and draft_path currently bound in the mixcut console.',
          parameters: {},
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute() {
            return getWorkspace()
          },
          presentCall: () => ({ card: 'generic', title: 'dh_get_workspace', kind: 'other' }),
        }),
      ),
      ctx.tools.register(
        defineTool({
          name: 'dh_engine_status',
          description:
            'Digital Human Studio: check whether local VectCut (default http://127.0.0.1:9001) is online, and whether this plugin manages its PID. If offline, returns a start_command / use dh_engine_start.',
          parameters: {},
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute() {
            return getStatus()
          },
          presentCall: () => ({ card: 'generic', title: 'dh_engine_status', kind: 'other' }),
        }),
      ),
      ctx.tools.register(
        defineTool({
          name: 'dh_engine_start',
          description:
            'Digital Human Studio: start the local VectCut server (capcut_server.py) if it is down. No-op success when already online. Logs to /tmp/vectcut.log and tracks PID in ~/.dsh/digital-human-studio.json.',
          parameters: {},
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute() {
            return engineStart()
          },
          presentCall: () => ({ card: 'generic', title: 'dh_engine_start', kind: 'other' }),
        }),
      ),
      ctx.tools.register(
        defineTool({
          name: 'dh_engine_stop',
          description:
            'Digital Human Studio: stop the VectCut process previously started by this plugin (tracked enginePid only). Refuses to kill unrelated processes.',
          parameters: {},
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute() {
            return engineStop()
          },
          presentCall: () => ({ card: 'generic', title: 'dh_engine_stop', kind: 'other' }),
        }),
      ),
      ctx.tools.register(
        defineTool({
          name: 'dh_list_drafts',
          description:
            'Digital Human Studio: scan a local Jianying/VectCut project folder for drafts. Pass folder or omit to use the last selected folder. Remembers the folder for later chat/panel use.',
          parameters: {
            folder: {
              type: 'string',
              description:
                'Absolute path to the drafts parent folder (e.g. ~/Movies/JianyingPro/.../com.lveditor.draft). Optional if already selected.',
            },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args) {
            return listDrafts(args.folder)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_list_drafts',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      ctx.tools.register(
        defineTool({
          name: 'dh_load_draft',
          description:
            'Digital Human Studio: load a draft by absolute path or by name inside the selected folder. Sets it as the active draft for subsequent add/save/export tools.',
          parameters: {
            path: { type: 'string', description: 'Absolute draft directory path.' },
            name: {
              type: 'string',
              description: 'Draft folder name / draft_id inside the selected project folder.',
            },
            folder: {
              type: 'string',
              description: 'Optional project folder override when resolving name.',
            },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args) {
            return loadDraft(args)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_load_draft',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      ctx.tools.register(
        defineTool({
          name: 'dh_create_draft',
          description:
            'Digital Human Studio: create a new VectCut draft (default 1080x1920). Returns draft_id used by later tools.',
          parameters: {
            width: { type: 'integer', description: 'Canvas width, default 1080.' },
            height: { type: 'integer', description: 'Canvas height, default 1920.' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args) {
            return createDraft(args)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_create_draft',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      ctx.tools.register(
        defineTool({
          name: 'dh_add_video',
          description:
            'Digital Human Studio: add one or more local video files (or http URLs) into the active draft via VectCut /add_video.',
          parameters: {
            draft_id: {
              type: 'string',
              description: 'Draft id. Optional if a draft is already selected/created.',
            },
            path: { type: 'string', description: 'Single local video path or URL.' },
            paths: {
              type: 'array',
              description: 'Multiple local video paths or URLs.',
              items: { type: 'string' },
            },
            width: { type: 'integer', description: 'Canvas width override.' },
            height: { type: 'integer', description: 'Canvas height override.' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args) {
            return addVideo(args)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_add_video',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      ctx.tools.register(
        defineTool({
          name: 'dh_save_draft',
          description:
            'Digital Human Studio: save the active VectCut draft into a local Jianying/CapCut draft folder (auto_deploy).',
          parameters: {
            draft_id: { type: 'string', description: 'Draft id. Optional if already selected.' },
            draft_folder: {
              type: 'string',
              description: 'Parent folder to write the draft into. Defaults to selected project folder.',
            },
            project_name: { type: 'string', description: 'Saved project name. Defaults to draft_id.' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args) {
            return saveDraft(args)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_save_draft',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      ctx.tools.register(
        defineTool({
          name: 'dh_export_draft',
          description:
            'Digital Human Studio: best-effort export of the active draft to video via VectCut /export_draft_to_video. If the local VectCut build lacks export, returns a clear error and optional draft_url preview.',
          parameters: {
            draft_id: { type: 'string', description: 'Draft id. Optional if already selected.' },
            output_path: { type: 'string', description: 'Optional output mp4 path.' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args) {
            return exportDraft(args)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_export_draft',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      ctx.tools.register(
        defineTool({
          name: 'dh_export_status',
          description:
            'Digital Human Studio: poll VectCut /export_status for an export task. Returns a clear error if the endpoint is missing.',
          parameters: {
            task_id: { type: 'string', description: 'Export task id if known.' },
            draft_id: { type: 'string', description: 'Draft id to query.' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args) {
            return exportStatus(args)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_export_status',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
    ]

    console.log(`[digital-human-studio] registered ${tools.length} Agent tools (dh_*)`)
    return () => {
      for (const d of tools) d()
    }
  }, 'digital-human-studio: tools')
}
