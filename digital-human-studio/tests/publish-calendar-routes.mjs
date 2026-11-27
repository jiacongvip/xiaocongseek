import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
const oldHome = process.env.HOME
const oldFetch = globalThis.fetch
const home = mkdtempSync(join(tmpdir(), 'xdh-calendar-route-'))
process.env.HOME = home
globalThis.fetch = () => { throw new Error('network forbidden in fixture') }
const disposers = []
try {
  const spaces = await import('../dist/spaces.js')
  const created = spaces.createSpace(spaces.emptySpaceStore(), '测试A')
  spaces.saveSpaceStore(created.store)
  const routes = new Map()
  let rejection, connectionAvailable = true
  const ctx = {
    get(name) { if (name === 'connection') return connectionAvailable ? { requestRejection() { return rejection } } : undefined; return name === 'credentials' ? { async unset() {}, async set() {} } : undefined },
    effect(run) { const dispose = run(); if (typeof dispose === 'function') disposers.push(dispose) },
    webServer: { register(definition) { routes.set(definition.path, definition.handler); return () => {} } },
    tools: { register() { return () => {} } },
  }
  const { apply } = await import('../dist/index.js')
  await apply(ctx)
  const handler = routes.get('/digital-human-studio/publish-calendar')
  assert.ok(handler)
  async function call(method, body, query = '', extraHeaders = {}) {
    const req = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body))])
    Object.assign(req, { method, url: `/digital-human-studio/publish-calendar${query}`, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': 'application/json', ...extraHeaders } })
    return await new Promise(resolve => {
      const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true }, end(value) { resolve({ status: this.status, body: JSON.parse(String(value)) }) } }
      handler(req, res)
    })
  }
  rejection = 401
  assert.equal((await call('GET', null, '?space=default')).status, 401)
  rejection = undefined; connectionAvailable = false
  assert.equal((await call('GET', null, '?space=default')).status, 403)
  connectionAvailable = true
  assert.equal((await call('POST', {}, '', { origin: 'https://evil.test' })).status, 403)
  assert.equal((await call('GET', null)).status, 400)
  assert.equal((await call('GET', null, '?space=../x')).status, 400)
  assert.equal((await call('POST', {}, '', { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await call('PUT', {})).status, 405)
  assert.equal((await call('POST', { action: 'upsert', item: {} })).status, 400)
  const a = created.space.id
  const input = { title: '测试排期', scheduledAt: '2026-11-30T23:59', platform: '视频号', notes: '', historyId: '', status: 'pending' }
  const saved = await call('POST', { space: a, action: 'upsert', item: input })
  assert.equal(saved.status, 200)
  const id = saved.body.items[0].id
  assert.equal(saved.body.spaceId, a)
  assert.equal((await call('GET', null, `?space=${a}`)).body.items.length, 1)
  assert.deepEqual((await call('GET', null, '?space=default')).body.items, [])
  assert.equal((await call('POST', { space: 'default', action: 'delete', id })).status, 404)
  assert.equal((await call('POST', { space: a, action: 'upsert', item: { ...input, id, status: 'published' } })).body.items[0].status, 'published')
  assert.equal((await call('POST', { space: a, action: 'delete', id })).body.items.length, 0)
  assert.equal((await call('POST', { space: a, action: 'delete', id })).status, 404)
  console.log('PASS: actual registered calendar route authentication, origin, explicit-space, method/media validation and CRUD')
} finally {
  for (const dispose of disposers.reverse()) dispose()
  globalThis.fetch = oldFetch
  rmSync(home, { recursive: true, force: true })
  if (oldHome === undefined) delete process.env.HOME
  else process.env.HOME = oldHome
}
