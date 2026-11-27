import assert from 'node:assert/strict'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
const previousHome = process.env.HOME
const isolatedHome = mkdtempSync(join(tmpdir(), 'xdh-materials-test-'))
process.env.HOME = isolatedHome
const {
  addStudioMaterial,
  ingestLocalFolder,
  updateStudioMaterialMeta,
  isDownloadSidecarCover,
  pruneDownloadSidecarCovers,
  findStudioMaterial,
  isMaterialSlot,
  listStudioMaterials,
  materialAbsolutePath,
  materialsOpenPath,
  publicStudioMaterials,
  removeStudioMaterial,
  renameStudioMaterial,
  spaceMaterialsRoot,
} = await import('../dist/studio-materials.js')

assert.equal(isDownloadSidecarCover('dy-cdp-763112b72559-cover.jpg'), true)
assert.equal(isDownloadSidecarCover('cover.jpg'), true)
assert.equal(isDownloadSidecarCover('产品特写.jpg'), false)
assert.equal(isDownloadSidecarCover('dy-cdp-763112b72559.mp4'), false)
assert.equal(isMaterialSlot('product'), true)
assert.equal(isMaterialSlot('store'), true)
assert.equal(isMaterialSlot('logo'), true)
assert.equal(isMaterialSlot('other'), false)

const spaceId = 'co-mattest01'
const root = join(homedir(), '.dsh', 'spaces', spaceId)
try {
  rmSync(root, { recursive: true, force: true })
  const added = addStudioMaterial(spaceId, 'product', '样品特写.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3]))
  const sidecar = addStudioMaterial(spaceId, 'product', 'dy-cdp-test-cover.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9, 4, 5, 6]))
  const afterPrune = pruneDownloadSidecarCovers(spaceId)
  assert.equal(afterPrune.some(item => item.id === sidecar.id), false)
  assert.equal(afterPrune.some(item => item.id === added.id), true)
  assert.equal(added.slot, 'product')
  assert.equal(added.kind, 'image')
  assert.equal(added.name, '样品特写.jpg')
  assert.ok(existsSync(materialAbsolutePath(spaceId, added)))

  const listed = listStudioMaterials(spaceId)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, added.id)

  const droppedDir = join(spaceMaterialsRoot(spaceId), 'store')
  mkdirSync(droppedDir, { recursive: true })
  writeFileSync(join(droppedDir, '门店实拍.mp4'), Buffer.from('fake-mp4'))
  const afterDrop = listStudioMaterials(spaceId)
  assert.equal(afterDrop.length, 2)
  assert.ok(afterDrop.some(item => item.slot === 'store' && item.kind === 'video'))

  const publicData = publicStudioMaterials(spaceId)
  assert.equal(publicData.counts.product, 1)
  assert.equal(publicData.counts.store, 1)
  assert.equal(publicData.counts.logo, 0)
  assert.ok(publicData.root.endsWith(join('spaces', spaceId, 'materials')))
  assert.ok(publicData.items[0].url.includes('/digital-human-studio/materials/file'))
  assert.ok(publicData.items[0].path.startsWith(publicData.root))
  assert.ok(findStudioMaterial(spaceId, added.id))

  const leftover = removeStudioMaterial(spaceId, added.id)
  assert.equal(leftover.length, 1)
  assert.equal(findStudioMaterial(spaceId, added.id), undefined)
  assert.equal(existsSync(materialAbsolutePath(spaceId, leftover[0])), true)

  // Finder Chinese names that previously collapsed to the same ASCII ID.
  const firstName = '产品甲.mp4'
  const secondName = '产品乙.mp4'
  const productDir = join(spaceMaterialsRoot(spaceId), 'product')
  writeFileSync(join(productDir, firstName), 'fixture-a')
  writeFileSync(join(productDir, secondName), 'fixture-b')
  const oldId = 'file-product-___.mp4'
  writeFileSync(join(spaceMaterialsRoot(spaceId), 'catalog.json'), JSON.stringify([
    { id: oldId, slot: 'product', name: firstName, file: `product/${firstName}` },
    { id: oldId, slot: 'product', name: secondName, file: `product/${secondName}` },
    ...leftover,
  ]))
  const migrated = listStudioMaterials(spaceId)
  const first = migrated.find(item => item.name === firstName)
  const second = migrated.find(item => item.name === secondName)
  assert.ok(first && second)
  assert.notEqual(first.id, second.id)
  assert.notEqual(first.id, oldId)
  assert.notEqual(second.id, oldId)
  assert.equal(findStudioMaterial(spaceId, oldId), undefined)
  removeStudioMaterial(spaceId, oldId) // ambiguous stale request must be a no-op
  assert.ok(existsSync(join(productDir, firstName)))
  assert.ok(existsSync(join(productDir, secondName)))
  assert.equal(findStudioMaterial(spaceId, first.id)?.name, firstName)
  assert.equal(listStudioMaterials(spaceId).find(item => item.name === secondName)?.id, second.id)
  assert.equal(listStudioMaterials(spaceId).find(item => item.file === leftover[0].file)?.id, leftover[0].id)
  removeStudioMaterial(spaceId, first.id)
  assert.ok(!existsSync(join(productDir, firstName)))
  assert.ok(existsSync(join(productDir, secondName)))

  const keep = listStudioMaterials(spaceId).find(item => item.slot === 'store') || leftover[0]
  const renamed = renameStudioMaterial(spaceId, keep.id, '门店外立面.jpg')
  assert.equal(renamed.id, keep.id)
  assert.match(renamed.name, /门店外立面/)
  assert.equal(findStudioMaterial(spaceId, keep.id)?.id, keep.id)
  assert.ok(existsSync(materialAbsolutePath(spaceId, renamed)))
  const escaped = renameStudioMaterial(spaceId, keep.id, '../etc/passwd')
  assert.equal(escaped.id, keep.id)
  assert.ok(!escaped.file.includes('..'))
  assert.ok(!escaped.name.includes('..'))
  const other = addStudioMaterial(spaceId, 'logo', 'logo-a.png', Buffer.from([1, 2, 3, 4]))
  const again = renameStudioMaterial(spaceId, other.id, '品牌Logo.png')
  assert.equal(again.id, other.id)
  assert.match(again.name, /品牌Logo/)
  const beforeDelete = listStudioMaterials(spaceId).length
  removeStudioMaterial(spaceId, again.id)
  assert.equal(findStudioMaterial(spaceId, again.id), undefined)
  assert.equal(listStudioMaterials(spaceId).length, beforeDelete - 1)
  assert.equal(materialsOpenPath(spaceId), spaceMaterialsRoot(spaceId))
  assert.ok(materialsOpenPath(spaceId, 'product').endsWith(join('materials', 'product')))
  assert.throws(() => materialsOpenPath(spaceId, '../product'), /槽位/)
  assert.throws(() => materialsOpenPath(spaceId, 'other'), /槽位/)
  const otherSpace = 'co-mattest02'
  const otherRoot = join(homedir(), '.dsh', 'spaces', otherSpace)
  try {
    const foreign = addStudioMaterial(otherSpace, 'product', '外司样品.jpg', Buffer.from([9, 8, 7]))
    const touched = renameStudioMaterial(spaceId, keep.id, '仅本公司.jpg')
    assert.equal(touched.id, keep.id)
    assert.equal(findStudioMaterial(otherSpace, foreign.id)?.name, '外司样品.jpg')
    assert.ok(existsSync(materialAbsolutePath(otherSpace, foreign)))
  } finally {
    rmSync(otherRoot, { recursive: true, force: true })
  }

  const ingestDir = join(isolatedHome, 'incoming-clips')
  mkdirSync(ingestDir, { recursive: true })
  writeFileSync(join(ingestDir, '门店门口.mp4'), 'clip-store')
  writeFileSync(join(ingestDir, '产品特写.mp4'), 'clip-product')
  const ingested = ingestLocalFolder(spaceId, ingestDir)
  assert.equal(ingested.imported.length, 2)
  assert.ok(ingested.imported.some(item => item.slot === 'store'))
  assert.ok(ingested.imported.every(item => item.analysisStatus === 'pending'))
  const labeled = updateStudioMaterialMeta(spaceId, ingested.imported[0].id, {
    role: 'store_front',
    useFor: '进门',
    summary: '门头实拍',
    environment: '门店外街边，背景是玻璃门、招牌和路边停的车，画面右侧有路过行人',
    lighting: '白天自然光，顺光，招牌略反光，整体明亮无阴影',
    quality: '竖屏 1080P，画面清晰，手持轻微抖动，顶部有平台水印，可用',
    speaker: '一位戴眼镜的中年男性，穿深灰 Polo，半身出镜正对镜头，普通话',
    speech: '「很多人以为 AI 漫剧随便做做就能火，其实真正难的是……」语气偏科普，语速中等',
  })
  assert.equal(labeled.analysisStatus, 'ready')
  assert.equal(labeled.useFor, '进门')
  assert.equal(labeled.environment.startsWith('门店外街边'), true)
  assert.equal(labeled.lighting.includes('自然光'), true)
  assert.equal(labeled.quality.includes('1080P'), true)
  assert.equal(labeled.speaker.includes('中年男性'), true)
  assert.equal(labeled.speech.includes('AI 漫剧'), true)
  // 只补一个维度时，其余四维度与旧的 useFor/summary 不能丢
  const patched = updateStudioMaterialMeta(spaceId, ingested.imported[0].id, { speech: '重新整理的逐字稿' })
  assert.equal(patched.useFor, '进门')
  assert.equal(patched.summary, '门头实拍')
  assert.equal(patched.environment.startsWith('门店外街边'), true)
  assert.equal(patched.lighting.includes('自然光'), true)
  assert.equal(patched.speech, '重新整理的逐字稿')
  const ingestedAgain = ingestLocalFolder(spaceId, ingestDir)
  assert.equal(ingestedAgain.imported.length, 0)
  assert.equal(ingestedAgain.skipped.length, 2)
  const catalog = publicStudioMaterials(spaceId)
  assert.ok(catalog.pendingCount >= 1)
  assert.ok(catalog.readyCount >= 1)
  assert.ok(catalog.items.some(item => item.useFor === '进门'))
  assert.ok(catalog.items.some(item => item.speech === '重新整理的逐字稿'))
  assert.ok(catalog.items.some(item => item.environment?.includes('门店外街边')))
  const assertLossless = (value, label) => {
    const walk = (node, path) => {
      if (node === undefined) throw new Error(`${label} has undefined at ${path}`)
      if (typeof node === 'number' && !Number.isFinite(node)) throw new Error(`${label} has ${node} at ${path}`)
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          assert.equal(Object.prototype.hasOwnProperty.call(node, i), true, `${label} sparse array at ${path}[${i}]`)
          walk(node[i], `${path}[${i}]`)
        }
        return
      }
      for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`)
    }
    walk(value, '$')
    JSON.parse(JSON.stringify(value))
  }
  assertLossless(ingested, 'ingestLocalFolder')
  assertLossless(catalog, 'publicStudioMaterials')

  // Legacy/Finder libraries beyond 80 remain readable and indexed in full.
  for (let i = 0; i < 82; i++) writeFileSync(join(productDir, `样品-${i}.mp4`), 'fixture')
  const large = listStudioMaterials(spaceId)
  assert.ok(large.length > 80)
  assert.equal(new Set(large.map(item => item.id)).size, large.length)
  const ids = new Map(large.map(item => [item.file, item.id]))
  assert.ok(listStudioMaterials(spaceId).every(item => ids.get(item.file) === item.id))
  assert.throws(() => addStudioMaterial(spaceId, 'logo', 'extra.png', Buffer.from('fixture')), /80/)
  assert.equal(listStudioMaterials(spaceId).length, large.length)


} finally {
  rmSync(isolatedHome, { recursive: true, force: true })
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
}

console.log('materials tests ok')
