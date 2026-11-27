import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const oldHome = process.env.HOME
const home = mkdtempSync(join(tmpdir(), 'xdh-context-test-'))
process.env.HOME = home
try {
  const images = await import('../dist/image-jobs.js')
  const spaces = await import('../dist/spaces.js')
  const a = images.imageLayoutForSpace('co-test-a')
  const b = images.imageLayoutForSpace('co-test-b')
  const legacy = images.imageLayoutForSpace('default')
  assert.equal(legacy.store, spaces.LEGACY_IMAGE_STORE)
  images.setImageLayout(a)
  let releaseA, releaseB
  const waitA = new Promise(resolve => { releaseA = resolve })
  const waitB = new Promise(resolve => { releaseB = resolve })
  const run = (layout, gate, text) => images.withImageLayout(layout, async () => {
    const job = images.upsertImageJob(images.seedImageJob({ prompt: text, model: 'fixture-image', ratio: '1:1' }))
    await gate
    const url = images.writeImageBytes(job.task_id, Buffer.from(text), 'png')
    images.upsertImageJob({ ...job, status: 'SUCCESS', url })
    assert.equal(images.currentImageLayout().spaceId, layout.spaceId)
    assert.ok(url.includes(`space=${layout.spaceId}`))
    return job.task_id
  })
  const pendingA = run(a, waitA, 'company-a')
  images.setImageLayout(b)
  const pendingB = run(b, waitB, 'company-b')
  images.setImageLayout(legacy) // unrelated panel selection during upstream waits
  releaseB()
  const idB = await pendingB
  releaseA()
  const idA = await pendingA
  assert.deepEqual(JSON.parse(readFileSync(a.store)).jobs.map(job => job.task_id), [idA])
  assert.deepEqual(JSON.parse(readFileSync(b.store)).jobs.map(job => job.task_id), [idB])
  assert.equal(readFileSync(join(a.files, `${idA}.png`), 'utf8'), 'company-a')
  assert.equal(readFileSync(join(b.files, `${idB}.png`), 'utf8'), 'company-b')
  assert.equal(images.currentImageLayout().spaceId, 'default')

  let store = spaces.emptySpaceStore({ lastDraftId: 'draft-default', lastProjectFolder: '/fixture/default' })
  const created = spaces.createSpace(store, 'A', { lastDraftId: 'draft-a', lastProjectFolder: '/fixture/a' })
  store = spaces.selectSpace(created.store, created.space.id, 'session-a')
  const snapshot = spaces.spaceWorkspace(store, spaces.spaceForSession(store, 'session-a').id)
  store = spaces.selectSpace(store, 'default', 'session-b')
  assert.equal(snapshot.lastDraftId, 'draft-a')
  assert.equal(snapshot.lastProjectFolder, '/fixture/a')
  store = spaces.patchSpace(store, created.space.id, { lastDraftId: 'draft-a-finished' })
  assert.equal(spaces.spaceWorkspace(store, 'default').lastDraftId, 'draft-default')
  assert.equal(spaces.spaceWorkspace(store, created.space.id).lastDraftId, 'draft-a-finished')
  assert.equal(snapshot.lastDraftId, 'draft-a')
  assert.throws(() => spaces.spaceWorkspace(store, 'missing'), /找不到/)
  console.log('PASS: interleaved company image storage and workspace snapshots')
} finally {
  rmSync(home, { recursive: true, force: true })
  if (oldHome === undefined) delete process.env.HOME
  else process.env.HOME = oldHome
}
