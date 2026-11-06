// Run with an isolated HOME; no real account credentials are read.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { EventEmitter } from 'node:events'
const home = mkdtempSync(join(tmpdir(), 'dh-auth-smoke-'))
process.env.HOME = home
mkdirSync(join(home, '.dsh'))
const cfgPath = join(home, '.dsh', 'digital-human-studio.json')
writeFileSync(cfgPath, JSON.stringify({ vectcutBaseUrl: 'http://127.0.0.1:9001', vectcutRoot: '/mock/vectcut', customField: 'preserve-me' }))
const routes = new Map(), tools = []
let tokenName, legacy = false, modelsFail = false, createCount = 0
const mockKey = 'sk-mock-inference-only-1234567890'
const remoteTokens = []
global.fetch = async (url, opts) => {
  const body = opts.body && JSON.parse(opts.body)
  let value
  if (url.endsWith('/api/user/login')) value = { success: true, data: { [legacy ? 'token' : 'access_token']: 'mock-account-access', user: { id: 7, username: 'test' } } }
  else if (url.endsWith('/api/token/')) {
    assert.equal(opts.headers['New-Api-User'], '7'); assert.equal(opts.headers.Authorization, 'Bearer mock-account-access')
    tokenName = body.name; createCount += 1
    remoteTokens.push({ id: 42, name: tokenName })
    value = { success: true }
  } else if (url.includes('/api/token/search?')) {
    const keyword = decodeURIComponent(String(url.split('keyword=')[1] || ''))
    const items = remoteTokens.filter(t => t.name === keyword || t.name.startsWith(keyword))
    value = { success: true, data: { items: items.length ? items : (tokenName ? [{ id: 42, name: tokenName }] : []) } }
  } else if (url.endsWith('/api/token/batch/keys')) {
    assert.deepEqual(body, { ids: [42] }); value = { success: true, data: { keys: { 42: mockKey } } }
  } else if (url.endsWith('/v1/models')) {
    assert.equal(opts.headers.Authorization, `Bearer ${mockKey}`)
    if (modelsFail) throw new Error('do not leak upstream errors')
    value = { data: [], object: 'list' }
  } else throw new Error('Unexpected URL')
  return { ok: true, status: 200, json: async () => value }
}
try {
  const { apply } = await import('../dist/index.js')
  await apply({ get: () => undefined, webServer: { register: spec => { routes.set(spec.path, spec.handler); return () => {} } },
    tools: { register: t => { tools.push(t); return () => {} } }, effect: fn => fn() })
  const call = (action, body, method = 'POST', extraHeaders = {}) => new Promise(resolve => {
    const req = new EventEmitter()
    req.method = method; req.headers = { host: '127.0.0.1:3080', 'content-type': 'application/json', ...extraHeaders }
    let status
    const res = { headersSent: false, writeHead(code) { status = code; this.headersSent = true }, end(text) { resolve({ status, data: JSON.parse(text) }) } }
    routes.get(`/digital-human-studio/${action}`)(req, res)
    queueMicrotask(() => { req.emit('data', Buffer.from(JSON.stringify(body || {}))); req.emit('end') })
  })
  assert.equal((await call('auth/status', null, 'GET')).data.hasToken, false)
  for (legacy of [false, true]) {
    const login = await call('auth/login', { username: 'test', password: 'mock-password' })
    assert.equal(login.status, 200); assert.equal(login.data.hasToken, true)
    assert(!JSON.stringify(login).includes(mockKey))
    const stored = JSON.parse(readFileSync(cfgPath))
    assert.equal(parse(readFileSync(join(home, '.dsh/.credentials.yaml'), 'utf8')).refs.NEW_API_TOKEN, mockKey)
    assert.equal(stored.newApiToken, mockKey); assert.equal(stored.vectcutRoot, '/mock/vectcut')
    assert.equal(stored.customField, 'preserve-me'); assert(!JSON.stringify(stored).includes('mock-password'))
  }
  assert.equal(createCount, 1, 'second login must reuse local sk-, not create another New API token')
  assert.equal((await call('auth/probe', {})).data.modelCount, 0)
  modelsFail = true; assert.equal((await call('auth/probe', {})).data.success, false); modelsFail = false
  assert.equal((await call('auth/logout', {})).data.hasToken, false)
  assert.equal(parse(readFileSync(join(home, '.dsh/.credentials.yaml'), 'utf8')).refs.NEW_API_TOKEN, undefined)
  const relogin = await call('auth/login', { username: 'test', password: 'mock-password' })
  assert.equal(relogin.status, 200)
  assert.equal(relogin.data.hasToken, true)
  assert.equal(createCount, 1, 'after logout, login must reuse remote studio token, not create a new key')
  assert.equal(JSON.parse(readFileSync(cfgPath)).newApiToken, mockKey)
  assert.equal((await call('auth/logout', {})).data.hasToken, false)
  assert.equal((await call('auth/save', { token: mockKey.slice(3) })).data.hasToken, true)
  assert.equal((await call('auth/probe', {})).data.success, true)
  assert.equal(parse(readFileSync(join(home, '.dsh/.credentials.yaml'), 'utf8')).refs.NEW_API_TOKEN, mockKey)
  assert.equal((await call('auth/save', { baseUrl: 'http://example.com' })).status, 400)
  assert.equal((await call('auth/logout', {}, 'GET')).status, 405)
  assert.equal((await call('auth/logout', {}, 'POST', { origin: 'http://evil.invalid' })).status, 403)
  const config = await call('config', null, 'GET')
  assert(!JSON.stringify(config).includes(mockKey))
  await call('config', { vectcutBaseUrl: 'http://127.0.0.1:9001' })
  assert.equal(JSON.parse(readFileSync(cfgPath)).newApiToken, mockKey)
  assert.equal((await call('auth/save', { baseUrl: 'https://example.com' })).data.hasToken, false)
  assert.equal(tools.length, 13)
  const startupCalls = []
  const startupCtx = {
    get: () => ({ set: async (ref, token) => startupCalls.push(['set', ref, token]), unset: async ref => startupCalls.push(['unset', ref]) }),
    webServer: { register: () => () => {} }, tools: { register: () => () => {} }, effect: fn => fn(),
  }
  const saved = JSON.parse(readFileSync(cfgPath, 'utf8'))
  writeFileSync(cfgPath, JSON.stringify({ ...saved, newApiEnabled: true, newApiToken: mockKey }))
  await apply(startupCtx)
  assert.deepEqual(startupCalls.pop(), ['set', 'NEW_API_TOKEN', mockKey])
  writeFileSync(cfgPath, JSON.stringify({ ...saved, newApiEnabled: false, newApiToken: mockKey }))
  await apply(startupCtx)
  assert.deepEqual(startupCalls.pop(), ['unset', 'NEW_API_TOKEN'])
  console.log('PASS: modern/legacy login, token reuse, search + batch keys, redaction, probe, logout, paste normalization, config preservation, methods/origin/base validation')
} finally { rmSync(home, { recursive: true, force: true }) }
