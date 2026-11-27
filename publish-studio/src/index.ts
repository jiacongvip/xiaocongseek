import { createHmac, randomBytes } from 'node:crypto'
import { createPublishStudio } from './service.js'
import { ensureProductDefaultAuthSettings } from './auth.js'
import { readLoginQrFile } from './platform-login.js'
import { isSpaceId } from './paths.js'
import { readRuntimePublicStatus } from './runtime.js'

/** Cordis required services — accessing ctx.webServer without this fails activation. */
export const inject = ['webServer']

type Ctx = {
  get: (name: string) => unknown
  set?: (name: string, value: unknown) => void
  provide?: (name: string, value?: unknown) => unknown
  inject?: (deps: string[] | Record<string, unknown>, callback: (ctx: Ctx) => void | (() => void)) => unknown
  effect: (run: () => void | (() => void)) => void
  webServer?: { register: (def: { path: string; handler: Function }) => () => void }
  tools?: { register: (def: any) => () => void }
}

function sendJson(res: any, status: number, body: unknown) {
  const text = JSON.stringify(body)
  res.writeHead?.(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end?.(text)
}

async function readJson(req: any) {
  const chunks: Buffer[] = []
  for await (const c of req) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
    if (Buffer.concat(chunks).length > 1_000_000) throw new Error('body too large')
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

export async function apply(ctx: Ctx) {
  try {
    ensureProductDefaultAuthSettings()
  } catch (error) {
    console.warn('[publish-studio] default auth settings init skipped:', (error as Error)?.message || error)
  }
  const api = createPublishStudio()
  // Formal Cordis service: provide so digital-human-studio can inject when ready.
  try {
    ctx.provide?.('publishStudio', api)
  } catch (error) {
    console.warn('[publish-studio] publishStudio service already provided:', (error as Error)?.message || error)
  }
  const salt = randomBytes(32)
  const sameOrigin = (req: any) => {
    const origin = String(req.headers?.origin || '')
    const host = String(req.headers?.host || '')
    if (!origin || !host) return false
    try { return new URL(origin).host === host } catch { return false }
  }
  const requireSpace = (value: unknown) => {
    const space = String(value || '').trim()
    if (!isSpaceId(space)) throw new Error('请选择有效公司')
    return space
  }

  ctx.effect(() => {
    // Cordis can end up activating this bundle more than once (profile bundle entry
    // plus a legacy patch entry, or a reload where the previous disposal has not
    // finished). The web server refuses a second route with the same path, which
    // used to fail the whole plugin; keep the first registration and move on.
    const register = (path: string, handler: Function) => {
      try {
        return ctx.webServer?.register({ path, handler })
      } catch (error) {
        console.warn('[publish-studio] duplicate route skipped:', path, (error as Error)?.message || error)
        return undefined
      }
    }
    register?.('/publish-studio/management', async (req: any, res: any) => {
      const connection = ctx.get('connection') as { requestRejection?: (req: { headers: unknown }) => number | undefined } | undefined
      if (!connection?.requestRejection) { sendJson(res, 403, { success: false, error: '未授权' }); return }
      const denied = connection.requestRejection({ headers: req.headers })
      if (denied || !sameOrigin(req)) { sendJson(res, denied || 403, { success: false, error: '未授权或来源无效' }); return }
      try {
        const method = String(req.method || 'GET').toUpperCase()
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        let space: string
        let input: Record<string, unknown>
        if (method === 'GET') {
          space = requireSpace(url.searchParams.get('space'))
          input = { action: url.searchParams.get('action') || 'runtime', id: url.searchParams.get('id') }
        } else if (method === 'POST') {
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) { sendJson(res, 415, { success: false, error: 'application/json required' }); return }
          const body = await readJson(req)
          space = requireSpace(body.space)
          const { space: _s, ...rest } = body
          input = rest
        } else { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        const result = await api.action(space, 'ui', input)
        sendJson(res, result.success === false ? 409 : 200, result)
      } catch (e: any) {
        sendJson(res, 400, { success: false, error: e?.message || '发布管理失败' })
      }
    })
        register?.('/publish-studio/login-qr', async (req: any, res: any) => {
      const connection = ctx.get('connection') as { requestRejection?: (req: { headers: unknown }) => number | undefined } | undefined
      if (!connection?.requestRejection) { sendJson(res, 403, { success: false, error: '未授权' }); return }
      const denied = connection.requestRejection({ headers: req.headers })
      if (denied || !sameOrigin(req)) { sendJson(res, denied || 403, { success: false, error: '未授权或来源无效' }); return }
      try {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const space = requireSpace(url.searchParams.get('space'))
        const sessionId = String(url.searchParams.get('sessionId') || '')
        const { bytes } = readLoginQrFile(space, sessionId)
        res.writeHead?.(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
        res.end?.(bytes)
      } catch (e: any) {
        sendJson(res, 404, { success: false, error: e?.message || '无二维码' })
      }
    })
    register?.('/publish-studio/confirmation', async (req: any, res: any) => {
      const connection = ctx.get('connection') as { requestRejection?: (req: { headers: unknown }) => number | undefined } | undefined
      if (!connection?.requestRejection) { sendJson(res, 403, { success: false, error: '未授权' }); return }
      const denied = connection.requestRejection({ headers: req.headers })
      if (denied || !sameOrigin(req)) { sendJson(res, denied || 403, { success: false, error: '未授权或来源无效' }); return }
      if (String(req.method || '').toUpperCase() !== 'POST') { sendJson(res, 405, { success: false, error: 'POST required' }); return }
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) { sendJson(res, 415, { success: false, error: 'application/json required' }); return }
      try {
        const body = await readJson(req)
        const space = requireSpace(body.space)
        const { space: _s, ...input } = body
        const session = createHmac('sha256', salt).update(String(req.headers.authorization || '') + '\0' + String(req.headers.cookie || '')).digest('hex')
        const result = await api.humanAction(space, input, session)
        sendJson(res, result.success === false ? 409 : 200, result)
      } catch (e: any) {
        sendJson(res, 400, { success: false, error: e?.message || '用户确认失败' })
      }
    })
  })

  const deps = readRuntimePublicStatus()
  if (deps.ready) console.log('[publish-studio] independent publishing service registered; runtime deps ready')
  else console.log('[publish-studio] independent publishing service registered; runtime deps NOT ready:', deps.phase, deps.message)
  console.log('[publish-studio] independent publishing service registered (no original GEO process required)')
}

export { createPublishStudio }
