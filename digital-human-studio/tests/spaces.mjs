import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SPACE_ID,
  LEGACY_ASSET_ROOT,
  LEGACY_IMAGE_STORE,
  SPACES_ROOT,
  briefHasContent,
  createSpace,
  currentSpace,
  deleteSpace,
  emptySpaceStore,
  formatBriefForPrompt,
  formatEmptyBriefForPrompt,
  loadViralRule,
  pickViralRecipe,
  isSpaceId,
  loadSpaceStore,
  patchSpace,
  publicSpaces,
  saveSpaceStore,
  selectSpace,
  spaceForSession,
  spaceAssetRoot,
  spaceImageFileRoot,
  spaceImageStorePath,
} from '../dist/spaces.js'

assert.equal(isSpaceId('default'), true)
assert.equal(isSpaceId('co-abc123'), true)
assert.equal(isSpaceId('../etc'), false)
assert.equal(spaceAssetRoot('default'), LEGACY_ASSET_ROOT)
assert.equal(spaceImageStorePath('default'), LEGACY_IMAGE_STORE)
assert.equal(spaceImageFileRoot('default'), join(LEGACY_ASSET_ROOT, 'images'))
assert.equal(spaceAssetRoot('co-abc123'), join(SPACES_ROOT, 'co-abc123'))
assert.equal(spaceImageStorePath('co-abc123'), join(SPACES_ROOT, 'co-abc123', 'images.json'))

const seed = emptySpaceStore({ lastProjectFolder: '/tmp/jianying-a' })
assert.equal(seed.currentId, DEFAULT_SPACE_ID)
assert.equal(currentSpace(seed).lastProjectFolder, '/tmp/jianying-a')

const created = createSpace(seed, '甲公司', { lastProjectFolder: '/tmp/jianying-b' })
assert.equal(created.space.name, '甲公司')
assert.equal(created.store.currentId, created.space.id)
assert.equal(created.store.spaces.length, 2)
assert.equal(spaceAssetRoot(created.space.id).includes(created.space.id), true)
assert.equal(created.space.brief.identity, '')
assert.equal(briefHasContent(created.space.brief), false)

const selected = selectSpace(created.store, DEFAULT_SPACE_ID)
assert.equal(selected.currentId, DEFAULT_SPACE_ID)
assert.equal(currentSpace(selected).name, '默认')

const renamed = patchSpace(selected, DEFAULT_SPACE_ID, { name: '自己的号' })
assert.equal(currentSpace(renamed).name, '自己的号')

const withBrief = patchSpace(renamed, DEFAULT_SPACE_ID, { brief: { identity: '瓷砖店老板', business: '卖防滑瓷砖' } })
assert.equal(currentSpace(withBrief).brief.identity, '瓷砖店老板')
assert.equal(currentSpace(withBrief).brief.business, '卖防滑瓷砖')
assert.equal(currentSpace(withBrief).brief.audience, '')
assert.equal(briefHasContent(currentSpace(withBrief).brief), true)
assert.match(formatBriefForPrompt('自己的号', DEFAULT_SPACE_ID, currentSpace(withBrief).brief), /对外身份：瓷砖店老板/)
assert.match(formatBriefForPrompt('自己的号', DEFAULT_SPACE_ID, currentSpace(withBrief).brief), /大白话/)
assert.match(formatBriefForPrompt('自己的号', DEFAULT_SPACE_ID, currentSpace(withBrief).brief), /内部成片路线/)
assert.match(formatBriefForPrompt('自己的号', DEFAULT_SPACE_ID, currentSpace(withBrief).brief), /jiancai-viral/)
assert.match(formatBriefForPrompt('自己的号', DEFAULT_SPACE_ID, currentSpace(withBrief).brief), /dh_ingest_local_folder/)
assert.match(formatBriefForPrompt('自己的号', DEFAULT_SPACE_ID, currentSpace(withBrief).brief), /禁止用 read/)
assert.match(formatBriefForPrompt('自己的号', DEFAULT_SPACE_ID, currentSpace(withBrief).brief), /dh_add_narration/)
assert.match(formatBriefForPrompt('自己的号', DEFAULT_SPACE_ID, currentSpace(withBrief).brief), /用我的声音/)
assert.match(formatBriefForPrompt('自己的号', DEFAULT_SPACE_ID, currentSpace(withBrief).brief), /垫一段音乐/)
assert.equal(currentSpace(withBrief).preferredVoiceId, '')
assert.equal(currentSpace(withBrief).preferredMusic, '')
assert.match(loadViralRule('talk'), /老板出镜/)
assert.match(formatBriefForPrompt('自己的号', DEFAULT_SPACE_ID, currentSpace(withBrief).brief), /成片/)
assert.notEqual(pickViralRecipe({ lastId: 'pitfall', seed: 'co-a' }).id, 'pitfall')
const firstEmpty = formatEmptyBriefForPrompt('甲公司', created.space.id, { firstTurn: true })
assert.match(firstEmpty, /还没有客户档案/)
assert.match(firstEmpty, /客户不专业/)
assert.match(firstEmpty, /dh_update_brief/)
assert.match(firstEmpty, /对外身份/)
assert.match(firstEmpty, /想来店看看/)
assert.match(formatEmptyBriefForPrompt('甲公司', created.space.id, { firstTurn: false }), /仍没有客户档案/)
const merged = patchSpace(withBrief, DEFAULT_SPACE_ID, { brief: { tone: '口语像邻居' } })
assert.equal(currentSpace(merged).brief.identity, '瓷砖店老板')
assert.equal(currentSpace(merged).brief.tone, '口语像邻居')
const clipped = patchSpace(merged, DEFAULT_SPACE_ID, { brief: { identity: 'x'.repeat(200) } })
assert.equal(currentSpace(clipped).brief.identity.length, 80)

const sticky = selectSpace(withBrief, created.space.id, 'sess-a')
assert.equal(sticky.currentId, created.space.id)
assert.equal(sticky.sessionSpaces?.['sess-a'], created.space.id)
const other = selectSpace(sticky, DEFAULT_SPACE_ID, 'sess-b')
assert.equal(other.currentId, DEFAULT_SPACE_ID)
assert.equal(spaceForSession(other, 'sess-a').id, created.space.id)
assert.equal(spaceForSession(other, 'sess-b').id, DEFAULT_SPACE_ID)
assert.equal(spaceForSession(other, 'sess-a').name, '甲公司')

assert.throws(() => deleteSpace(renamed, DEFAULT_SPACE_ID), /默认空间不能删除/)
const removed = deleteSpace(created.store, created.space.id)
assert.equal(removed.spaces.length, 1)
assert.equal(removed.currentId, DEFAULT_SPACE_ID)

const dir = mkdtempSync(join(tmpdir(), 'xdh-spaces-'))
const file = join(dir, 'digital-human-spaces.json')
saveSpaceStore(created.store, file)
const loaded = loadSpaceStore(file)
assert.equal(loaded.spaces.length, 2)
assert.equal(publicSpaces(loaded).spaces[1].name, '甲公司')
assert.equal(publicSpaces(loaded).spaces[1].brief.identity, '')
saveSpaceStore(other, file)
const loadedSessions = loadSpaceStore(file)
assert.equal(spaceForSession(loadedSessions, 'sess-a').id, created.space.id)
assert.equal(spaceForSession(loadedSessions, 'sess-b').id, DEFAULT_SPACE_ID)
writeFileSync(file, JSON.stringify({
  version: 1,
  currentId: 'default',
  spaces: [{ id: 'default', name: '默认', createdAt: 1, updatedAt: 1, lastProjectFolder: '', lastDraftId: '', lastDraftPath: '' }],
}), 'utf8')
const migrated = loadSpaceStore(file)
assert.equal(migrated.spaces[0].brief.identity, '')
assert.equal(briefHasContent(migrated.spaces[0].brief), false)
writeFileSync(file, '{not json', 'utf8')
const fallback = loadSpaceStore(file, { lastProjectFolder: '/tmp/recovered' })
assert.equal(fallback.currentId, DEFAULT_SPACE_ID)
assert.equal(currentSpace(fallback).lastProjectFolder, '/tmp/recovered')
rmSync(dir, { recursive: true, force: true })

console.log('PASS: company spaces')
