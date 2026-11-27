import assert from 'node:assert/strict'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const m = await import(pathToFileURL(join(pluginRoot, 'dist/comment-wordcloud.js')).href)

{
  const r = m.parseCommentImport({ text: '  \n' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'empty')
}
{
  assert.throws(
    () => m.assertSafeOutPath('default', '/tmp/evil.png'),
    (e) => e && e.code === 'path_escape',
  )
}
{
  const raw = readFileSync(join(pluginRoot, 'tests/fixtures/comment-wordcloud/sample_comments.jsonl'), 'utf8')
  const r = m.parseCommentImport({ text: raw, filename: 'sample_comments.jsonl', fixtureLabeled: true })
  assert.equal(r.ok, true)
  assert.ok(r.items.length >= 10)
  assert.ok(r.items.every((x) => Object.keys(x).length === 1 && 'content' in x))
  assert.ok(!JSON.stringify(r.items).includes('应被剥离'))
  assert.ok(!JSON.stringify(r.items).includes('secret-should-strip'))
}
{
  assert.notEqual(m.wordcloudJobsRoot('default'), m.wordcloudJobsRoot('co-testdemo01'))
}
{
  const raw = readFileSync(join(pluginRoot, 'tests/fixtures/comment-wordcloud/sample_comments.jsonl'), 'utf8')
  const mcRoot = join(homedir(), 'Desktop', '开发文件', 'MediaCrawler')
  const result = await m.runCommentWordcloud({
    spaceId: 'default',
    text: raw,
    filename: 'sample_comments.jsonl',
    fixtureLabeled: true,
    sourceLabel: '测试示例 fixture',
    mediaCrawlerRoot: mcRoot,
    mediaCrawlerPython: join(mcRoot, '.venv/bin/python'),
  })
  assert.equal(result.success, true, result.task?.error)
  assert.equal(result.task.status, 'succeeded')
  assert.equal(result.task.fixtureLabeled, true)
  assert.ok(result.task.pngBytes > 1000)
  assert.ok(existsSync(result.task.pngFile))
  const freq = JSON.parse(readFileSync(result.task.freqFile, 'utf8'))
  assert.ok(!JSON.stringify(freq).includes('nickname'))
  const blob = Object.keys(freq).join(',')
  assert.ok(/小程序|开发|AI|审核|支付/.test(blob), blob.slice(0, 200))
  writeFileSync('/tmp/wc_last_task.json', JSON.stringify(result.task, null, 2))
  console.log('PASS generate', result.task.id, 'png', result.task.pngBytes, 'top', (result.task.topWords || []).slice(0, 5))
}
console.log('ALL_COMMENT_WORDCLOUD_TESTS_OK')
