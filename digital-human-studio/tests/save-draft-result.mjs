import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dist = '/Users/jiacong/Desktop/开发文件/小葱/dsh-newapi-fork/digital-human-studio/dist'
const mod = await import(pathToFileURL(join(dist, 'save-draft-result.js')).href)
const { finalizeSavedDraftAssets } = await import(pathToFileURL(join(dist, 'draft-save-finalize.js')).href)

function assertLossless(obj) {
  const s = JSON.stringify(obj)
  assert.ok(!s.includes('undefined'))
  assert.equal(s, JSON.stringify(JSON.parse(s)))
  return JSON.parse(s)
}

const root = mkdtempSync(join(tmpdir(), 'dh-save-json-'))
const folder = join(root, 'out')
mkdirSync(folder, { recursive: true })

function seedDraft(name) {
  const d = join(folder, name)
  mkdirSync(join(d, 'assets', 'image'), { recursive: true })
  mkdirSync(join(d, 'assets', 'video'), { recursive: true })
  const content = {
    duration: 1_000_000,
    materials: {
      videos: [
        {
          type: 'photo',
          material_name: 'flower.png',
          path: join(d, 'assets', 'image', 'flower.png'),
          remote_url: '',
        },
      ],
    },
  }
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  writeFileSync(join(d, 'assets', 'image', 'flower.png'), png)
  writeFileSync(join(d, 'draft_info.json'), JSON.stringify(content, null, 2))
  writeFileSync(
    join(d, 'draft_meta_info.json'),
    JSON.stringify({
      draft_name: '0707',
      draft_fold_path: '/Users/sunguannan/Movies/CapCut/User Data/Projects/com.lveditor.draft/0707',
      draft_root_path: '/Users/sunguannan/Movies/CapCut/User Data/Projects/com.lveditor.draft',
      draft_cover: 'draft_cover.jpg',
      tm_duration: 0,
    }),
  )
  return d
}

const draftA = seedDraft('dfd_test_a')

{
  const res = await mod.processSaveDraftResponse({
    xiaocongcutData: { success: true, output: { draft_url: draftA, success: true, task_id: 't1' } },
    draftId: 'dfd_test_a',
    projectName: 'demo_named',
    draftFolder: folder,
    allowRoots: [folder],
    finalizeFn: finalizeSavedDraftAssets,
  })
  assertLossless(res)
  assert.equal(res.saved, true)
  assert.equal(res.finalize.ran, true)
  assert.equal(res.assetCheck.ok, true)
  assert.ok(existsSync(join(draftA, 'draft_content.json')))
  const meta = JSON.parse(readFileSync(join(draftA, 'draft_meta_info.json'), 'utf8'))
  assert.equal(meta.draft_name, 'demo_named')
  assert.ok(!String(meta.draft_fold_path).includes('sunguannan'))
  assert.ok(!meta.draft_cover || meta.draft_cover === '' || existsSync(join(draftA, 'draft_cover.jpg')))
  console.log('PASS object output + finalize')
}

{
  const d = seedDraft('dfd_test_str')
  const res = await mod.processSaveDraftResponse({
    xiaocongcutData: { success: true, output: d },
    draftId: 'dfd_test_str',
    projectName: 'str_named',
    draftFolder: folder,
    allowRoots: [folder],
    finalizeFn: finalizeSavedDraftAssets,
  })
  assertLossless(res)
  assert.equal(res.finalize.ran, true)
  console.log('PASS string output')
}

{
  const res = await mod.processSaveDraftResponse({
    xiaocongcutData: { success: false, error: 'boom', output: '' },
    draftId: 'x',
    draftFolder: folder,
    allowRoots: [folder],
    finalizeFn: finalizeSavedDraftAssets,
  })
  assertLossless(res)
  assert.equal(res.saved, false)
  assert.equal(res.success, false)
  console.log('PASS error field')
}

{
  const res = await mod.processSaveDraftResponse({
    xiaocongcutData: { success: true, output: { draft_url: '/tmp/not-under-controlled-root-xyz', success: true } },
    draftId: 'dfd_out',
    draftFolder: folder,
    allowRoots: [folder],
    finalizeFn: finalizeSavedDraftAssets,
  })
  assertLossless(res)
  assert.equal(res.saved, true)
  assert.ok(res.warning)
  assert.equal(res.finalize.ran, false)
  console.log('PASS saved+finalize blocked outside root')
}

{
  const extracted = mod.extractDraftPathFromSaveResponse({
    success: true,
    output: { draft_url: draftA, success: true, task_id: 't' },
  })
  assert.equal(extracted.path, draftA)
  console.log('PASS extract object')
}

{
  const res = await mod.processSaveDraftResponse({
    xiaocongcutData: { success: true, output: draftA },
    draftId: 'dfd_test_a',
    draftFolder: folder,
    allowRoots: [folder],
    finalizeFn: () => ({ ok: true, weird: undefined, nested: { a: undefined, b: 1 } }),
  })
  assertLossless(res)
  assert.equal('weird' in (res.assetCheck || {}), false)
  console.log('PASS strip undefined')
}

rmSync(root, { recursive: true, force: true })
console.log('ALL_PASS save-draft-result handler core')
