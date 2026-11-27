import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const oldHome = process.env.HOME
const oldFetch = globalThis.fetch
const home = mkdtempSync(join(tmpdir(), 'xdh-tools-test-'))
process.env.HOME = home
const pending = []
const calls = []
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith('http://127.0.0.1:9001/'), 'no real network allowed')
  const body = JSON.parse(init.body)
  calls.push({ url: String(url), body })
  if (String(url).endsWith('/create_draft')) {
    return new Promise(resolve => pending.push(draft => resolve(new Response(JSON.stringify({ success: true, output: { draft_id: draft } })))))
  }
  return new Response(JSON.stringify({ success: true, output: { draft_id: body.draft_id } }))
}
try {
  const spaces = await import('../dist/spaces.js')
  let store = spaces.emptySpaceStore({ lastDraftId: 'default-old', lastProjectFolder: '/fixture/default' })
  const made = spaces.createSpace(store, 'A', { lastDraftId: 'a-old', lastProjectFolder: '/fixture/a' })
  store = spaces.selectSpace(made.store, made.space.id, 'session-a')
  store = spaces.selectSpace(store, 'default', 'session-b')
  spaces.saveSpaceStore(store)
  const tools = new Map()
  const disposers = []
  const ctx = {
    get(name) { return name === 'credentials' ? { async unset() {}, async set() {} } : undefined },
    effect(run) { const dispose = run(); if (typeof dispose === 'function') disposers.push(dispose) },
    webServer: { register() { return () => {} } },
    tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
  }
  const { apply } = await import('../dist/index.js')
  await apply(ctx)
  const execA = { agent: { session: { id: 'session-a' } } }
  const execB = { agent: { session: { id: 'session-b' } } }
  const a = tools.get('dh_create_draft').execute({}, execA)
  const b = tools.get('dh_create_draft').execute({}, execB)
  assert.equal(pending.length, 2)
  pending[1]('b-new')
  const resultB = await b
  pending[0]('a-new')
  const resultA = await a
  assert.equal(resultA.workspace.spaceId, made.space.id)
  assert.equal(resultB.workspace.spaceId, 'default')
  store = spaces.loadSpaceStore()
  assert.equal(spaces.spaceWorkspace(store, made.space.id).lastDraftId, 'a-new')
  assert.equal(spaces.spaceWorkspace(store, 'default').lastDraftId, 'b-new')
  await tools.get('dh_add_video').execute({ path: '/fixture/a.mp4' }, execA)
  await tools.get('dh_add_video').execute({ path: '/fixture/b.mp4' }, execB)
  const added = calls.filter(call => call.url.endsWith('/add_video'))
  assert.deepEqual(added.map(call => call.body.draft_id), ['a-new', 'b-new'])
  await tools.get('dh_save_draft').execute({}, execA)
  await tools.get('dh_save_draft').execute({}, execB)
  const saved = calls.filter(call => call.url.endsWith('/save_draft'))
  assert.deepEqual(saved.map(call => [call.body.draft_id, call.body.draft_folder]), [
    ['a-new', '/fixture/a'], ['b-new', '/fixture/default'],
  ])
  for (const dispose of disposers.reverse()) dispose()
  console.log('PASS: actual chat tools keep company drafts/folders across reversed completion')
} finally {
  globalThis.fetch = oldFetch
  rmSync(home, { recursive: true, force: true })
  if (oldHome === undefined) delete process.env.HOME
  else process.env.HOME = oldHome
}
