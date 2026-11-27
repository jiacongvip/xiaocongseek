#!/usr/bin/env node
/**
 * Temporary same-API bridge on 127.0.0.1:3099 so comment-wordcloud works
 * without restarting the already-running 3080 process. CORS for 3080 origin only.
 */
import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const pluginRoot = fileURLToPath(new URL('../..', import.meta.url))
const m = await import(pathToFileURL(join(pluginRoot, 'dist/comment-wordcloud.js')).href)
const PORT = Number(process.env.DH_WC_BRIDGE_PORT || 3099)
const ALLOW = new Set(['http://127.0.0.1:3080', 'http://localhost:3080'])

function sendJson(res, code, obj, origin) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': ALLOW.has(origin) ? origin : 'http://127.0.0.1:3080',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  })
  res.end(JSON.stringify(obj))
}

function readBody(req, limit = 2.5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > limit) {
        reject(Object.assign(new Error('body too large'), { code: 'too_large' }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const mcRootDefault = join(homedir(), 'Desktop', '开发文件', 'MediaCrawler')
const mcPython = join(mcRootDefault, '.venv/bin/python')

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || '')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': ALLOW.has(origin) ? origin : 'http://127.0.0.1:3080',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    })
    res.end()
    return
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (url.pathname !== '/digital-human-studio/comment-wordcloud') {
    sendJson(res, 404, { success: false, error: 'not found' }, origin)
    return
  }
  const spaceId = url.searchParams.get('space') || 'default'
  const id = url.searchParams.get('id') || ''
  const kind = url.searchParams.get('kind') || ''
  try {
    if (req.method === 'GET') {
      if (id && (kind === 'png' || kind === 'freq')) {
        const file = m.resolveWordcloudAsset(spaceId, id, kind)
        if (!file || !existsSync(file)) {
          sendJson(res, 404, { success: false, error: '结果文件不存在' }, origin)
          return
        }
        const buf = readFileSync(file)
        res.writeHead(200, {
          'content-type': kind === 'png' ? 'image/png' : 'application/json; charset=utf-8',
          'access-control-allow-origin': ALLOW.has(origin) ? origin : 'http://127.0.0.1:3080',
          'cache-control': 'private, max-age=60',
        })
        res.end(buf)
        return
      }
      if (id) {
        const task = m.getWordcloudTask(spaceId, id)
        if (!task) {
          sendJson(res, 404, { success: false, error: '任务不存在' }, origin)
          return
        }
        sendJson(res, 200, { success: true, task, capability: m.commentWordcloudCapability({ mediaCrawlerRoot: mcRootDefault }) }, origin)
        return
      }
      sendJson(
        res,
        200,
        {
          success: true,
          tasks: m.listWordcloudTasks(spaceId),
          capability: m.commentWordcloudCapability({ mediaCrawlerRoot: mcRootDefault }),
          bridge: true,
          note: 'local bridge — 3080 not restarted',
        },
        origin,
      )
      return
    }
    if (req.method === 'POST') {
      const raw = await readBody(req)
      const body = JSON.parse(raw.toString('utf8') || '{}')
      const target = body.space || spaceId
      const action = String(body.action || 'analyze')
      if (action === 'cancel') {
        const task = m.cancelWordcloudTask(target, String(body.id || ''))
        if (!task) {
          sendJson(res, 404, { success: false, error: '任务不存在' }, origin)
          return
        }
        sendJson(res, 200, { success: true, task }, origin)
        return
      }
      if (action === 'validate') {
        const parsed = m.parseCommentImport({
          text: String(body.text || body.content || ''),
          filename: String(body.filename || ''),
          fixtureLabeled: !!body.fixtureLabeled,
        })
        sendJson(res, parsed.ok ? 200 : 400, { success: parsed.ok, ...parsed }, origin)
        return
      }
      const result = await m.runCommentWordcloud({
        spaceId: target,
        text: String(body.text || body.content || ''),
        filename: String(body.filename || ''),
        fixtureLabeled: !!body.fixtureLabeled,
        sourceLabel: String(body.sourceLabel || body.filename || '').slice(0, 120),
        mediaCrawlerRoot: mcRootDefault,
        mediaCrawlerPython: mcPython,
      })
      sendJson(res, result.success ? 200 : 400, result, origin)
      return
    }
    sendJson(res, 405, { success: false, error: 'method not allowed' }, origin)
  } catch (e) {
    sendJson(res, 400, { success: false, error: e?.message || 'bridge error', code: e?.code }, origin)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dh-wc-bridge] http://127.0.0.1:${PORT}/digital-human-studio/comment-wordcloud`)
})
