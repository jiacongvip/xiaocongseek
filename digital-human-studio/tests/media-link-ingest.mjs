import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const isolatedHome = mkdtempSync(join(tmpdir(), 'xdh-media-ingest-'))
process.env.HOME = isolatedHome
process.env.USERPROFILE = isolatedHome

const {
  classifyMediaLink,
  mediCrawlerCapabilityReport,
  runMediaLinkIngest,
  listIngestTasks,
  getIngestTask,
  withLoopbackFixtureServer,
  mediaIngestFixturesDir,
} = await import('../dist/media-link-ingest.js')
const materials = await import('../dist/studio-materials.js')

const cap = mediCrawlerCapabilityReport()
assert.equal(cap.integrated, false)
assert.match(cap.license, /NON-COMMERCIAL/i)
assert.equal(cap.commercialUse, false)

for (const u of [
  'https://www.xiaohongshu.com/explore/abc',
  'https://www.douyin.com/video/123',
  'https://www.bilibili.com/video/BV1xx',
  'https://weibo.com/ttarticle/p/show?id=1',
  'https://www.zhihu.com/question/1',
  'https://tieba.baidu.com/p/1',
]) {
  const c = classifyMediaLink(u)
  assert.equal(c.ok, false)
  assert.equal(c.code, 'platform_page_blocked')
}

assert.equal(classifyMediaLink('https://example.com/a.mp4').ok, false)
assert.equal(classifyMediaLink('http://192.168.1.1/a.mp4').ok, false)
assert.equal(classifyMediaLink('file:///tmp/x.mp4').ok, false)
assert.equal(classifyMediaLink('file:///tmp/x.mp4').code, 'file_blocked')

const a = 'co-ingesta01'
const b = 'co-ingestb02'

const ok = await runMediaLinkIngest({ spaceId: a, slot: 'product', source: 'fixture:sample.png' })
assert.equal(ok.success, true)
assert.equal(ok.mediCrawlerIntegrated, false)
assert.equal(ok.task.status, 'succeeded')
assert.ok(ok.task.material?.id)
assert.equal(materials.findStudioMaterial(a, ok.task.material.id)?.slot, 'product')

assert.equal(getIngestTask(b, ok.task.id), undefined)
assert.equal(listIngestTasks(b).some((t) => t.id === ok.task.id), false)
assert.ok(listIngestTasks(a).some((t) => t.id === ok.task.id))

const blocked = await runMediaLinkIngest({
  spaceId: a,
  slot: 'product',
  source: 'https://www.douyin.com/video/999',
})
assert.equal(blocked.success, false)
assert.equal(blocked.task.status, 'rejected')
assert.equal(blocked.task.code, 'platform_page_blocked')
assert.equal(blocked.mediCrawlerIntegrated, false)

const fixtureFile = join(mediaIngestFixturesDir(), 'sample.png')
await withLoopbackFixtureServer(fixtureFile, async (url) => {
  const loop = await runMediaLinkIngest({ spaceId: a, slot: 'logo', source: url, fileName: 'loopback.png' })
  assert.equal(loop.success, true)
  assert.equal(loop.task.status, 'succeeded')
  assert.equal(loop.task.material?.slot, 'logo')
})

await assert.rejects(
  () => runMediaLinkIngest({ spaceId: '../x', slot: 'product', source: 'fixture:sample.png' }),
  /非法空间/,
)

console.log('media-link-ingest tests ok')
rmSync(isolatedHome, { recursive: true, force: true })
