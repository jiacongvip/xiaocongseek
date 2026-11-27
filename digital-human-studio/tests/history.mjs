import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import {
  findAndPatchStudioHistory,
  historyTitle,
  loadStudioHistory,
  patchStudioHistory,
  studioHistoryPath,
  taskIdFromResult,
  upsertStudioHistory,
} from '../dist/studio-history.js'

assert.equal(historyTitle('xdh-avatar-video', '  南京全屋定制第1条  '), '南京全屋定制第1条')
assert.equal(historyTitle('xdh-avatar-video', ''), '数字人视频')
assert.equal(taskIdFromResult({ task_id: 't-1' }), 't-1')
assert.equal(taskIdFromResult({ data: { id: 'nested' } }), 'nested')
assert.equal(taskIdFromResult(null), '')

const spaceId = 'co-histtest01'
const root = join(homedir(), '.dsh', 'spaces', spaceId)
try {
  rmSync(root, { recursive: true, force: true })
  const first = upsertStudioHistory(spaceId, {
    id: 'task-a',
    kind: 'xdh-avatar-video',
    title: '',
    at: 1,
    prompt: '对话里生成的口播',
    source: 'chat',
  })
  assert.equal(first.length, 1)
  assert.equal(first[0].title, '对话里生成的口播')
  assert.equal(studioHistoryPath(spaceId), join(root, 'history.json'))

  upsertStudioHistory(spaceId, {
    id: 'task-b',
    kind: 'xdh-audio',
    title: '配音',
    at: 2,
    source: 'chat',
  })
  patchStudioHistory(spaceId, 'task-a', { status: 'SUCCESS', mediaUrl: 'https://example.com/a.mp4' })
  const items = loadStudioHistory(spaceId)
  assert.equal(items[0].id, 'task-a')
  assert.equal(items[0].status, 'SUCCESS')
  assert.equal(items[1].id, 'task-b')

  const found = findAndPatchStudioHistory([{ id: spaceId }, { id: 'default' }], 'task-b', { status: 'FAILURE' })
  assert.equal(found, spaceId)
  assert.equal(loadStudioHistory(spaceId).find(item => item.id === 'task-b')?.status, 'FAILURE')
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('history tests ok')
