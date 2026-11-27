import assert from 'node:assert/strict'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
const previousHome = process.env.HOME
const isolatedHome = mkdtempSync(join(tmpdir(), 'xdh-export-history-'))
process.env.HOME = isolatedHome
// 隔离 HOME 必须在 import 前生效（modules 读 homedir() 决定数据根）
const { registerExport, backfillExports, exportFilePath, importExport, EXPORT_KIND, exportRoot } = await import('../dist/export-history.js')
const { loadStudioHistory, upsertStudioHistory } = await import('../dist/studio-history.js')

const spaceId = 'co-export-test'
const assetRoot = join(isolatedHome, '.dsh', 'spaces', spaceId)
mkdirSync(join(assetRoot, 'exports'), { recursive: true })
mkdirSync(join(assetRoot, 'local-styled-text', 'exports'), { recursive: true })

// 一个假的 mp4（只要超过 1KB 就会被收）
const fakeMp4 = Buffer.alloc(4096, 1)

// 1. 导出成功 → 收进 exports 并登记
const exported = join(assetRoot, 'exports', 'export_lexp_demo.mp4')
writeFileSync(exported, fakeMp4)
const item = registerExport(spaceId, exported)
assert.ok(item, '导出应被登记')
assert.equal(item.kind, EXPORT_KIND)
assert.equal(item.localFile, 'exports/export_lexp_demo.mp4')
assert.ok(item.mediaUrl.includes('/digital-human-studio/works/file?space='))
assert.ok(loadStudioHistory(spaceId).some(row => row.id === item.id), '成片库应包含成品')

// 2. 幂等：重复登记不新增
const again = registerExport(spaceId, exported)
assert.equal(again.id, item.id)
assert.equal(loadStudioHistory(spaceId).filter(row => row.id === item.id).length, 1)

// 3. 花字导出目录的成品能被回填
writeFileSync(join(assetRoot, 'local-styled-text', 'exports', 'own_text_demo.mp4'), fakeMp4)
const backfilled = backfillExports(spaceId)
assert.equal(backfilled.added, 1, '回填应新增 1 条')
assert.ok(loadStudioHistory(spaceId).some(row => row.localFile === 'exports/own_text_demo.mp4'))
// 再回填一次不应重复
assert.equal(backfillExports(spaceId).added, 0)

// 4. 读取路径只认已登记记录，且不能越出 exports
assert.ok(exportFilePath(spaceId, item.id))
assert.equal(exportFilePath(spaceId, 'exp-not-exists'), null)
upsertStudioHistory(spaceId, {
  id: 'exp-traversal',
  kind: EXPORT_KIND,
  title: '越权',
  at: Date.now(),
  localFile: '../../outside.mp4',
})
assert.equal(exportFilePath(spaceId, 'exp-traversal'), null, '路径穿越必须被拒绝')

// 5. 导入只接受 mp4
const imported = importExport(spaceId, '剪好的成品.mp4', fakeMp4)
assert.equal(imported.kind, EXPORT_KIND)
assert.ok(imported.localFile.startsWith('exports/import_'))
assert.ok(existsSync(join(assetRoot, imported.localFile)))
assert.throws(() => importExport(spaceId, 'not-a-video.mov', fakeMp4), /只接受 mp4/)
assert.throws(() => importExport(spaceId, 'tiny.mp4', Buffer.alloc(10)), /文件为空|太小|成品登记失败/)

// 文件确实落在本空间 exports 下
assert.ok(existsSync(join(exportRoot(spaceId), 'export_lexp_demo.mp4')))

process.env.HOME = previousHome
console.log('export-history tests ok')
