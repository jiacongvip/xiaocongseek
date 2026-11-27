import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'publish-studio-svc-'))
const oldHome = process.env.HOME
process.env.HOME = home
process.env.PUBLISH_STUDIO_ALLOW_LOGIN_MOCK = '1'
process.env.PUBLISH_STUDIO_LOGIN_MOCK = 'waiting'
let network = 0
globalThis.fetch = async () => { network++; throw new Error('network forbidden') }

try {
  const { createPublishStudio } = await import('../dist/service.js')
  const api = createPublishStudio()
  assert.equal(api.requiresOriginalGeoProcess, false)
  const space = 'co-fixture1'
  const runtime = await api.action(space, 'ui', { action: 'runtime' })
  assert.equal(runtime.runtime.mode, 'independent-publish-studio')
  assert.equal(runtime.runtime.enabled, false)

  await api.action(space, 'ui', { action: 'auth.settings.save', settings: { authEnforced: false, permissionsEnforced: true, aid: 1, allowPublish: true, dailyPublishLimit: 10 } })
  let prepBlock = await api.action(space, 'ui', { action: 'runtime' })
  assert.ok(prepBlock.runtime.reasons.some(r => r.includes('基线')))

  await api.action(space, 'ui', { action: 'auth.baseline', priorUsed: 7, note: '管理员按原工作台今日已用7次核对后的基线' })
  const usage = (await api.action(space, 'ui', { action: 'runtime' })).usage
  assert.equal(usage.attempts, 7)

  const binding = (await api.action(space, 'ui', { action: 'accounts.save', item: { platform: 'douyin', label: '夹具账号' } })).item
  await assert.rejects(api.action(space, 'ai', { action: 'accounts.save', item: { platform: 'douyin', label: 'x' } }), /仅用户/)
  const login = await api.action(space, 'ui', { action: 'accounts.beginLogin', id: binding.id, revision: binding.revision })
  assert.ok(login.sessionId)
  assert.ok(['starting', 'waiting_browser', 'waiting_scan'].includes(login.phase || login.status?.phase))

  // Attach fixture credential via test helper
  const { attachCredentialFileForTests } = await import('../dist/accounts.js')
  const ready = attachCredentialFileForTests(space, binding.id, Buffer.from('{"fixture":true}'))
  assert.equal(ready.status, 'authorized')

  // Stage media inside sandbox via prepare stage paths from temp files outside, copied in
  const mediaDir = join(home, 'outside-media'); mkdirSync(mediaDir)
  const video = join(mediaDir, 'a.mp4'); const cover = join(mediaDir, 'a.png')
  writeFileSync(video, 'fixture-video'); writeFileSync(cover, 'fixture-cover')

  const prepared = await api.action(space, 'ai', {
    action: 'task.prepare',
    packId: 'pack-' + 'a'.repeat(32),
    packRevision: 1,
    bindingId: binding.id,
    platform: 'douyin',
    title: '标题',
    body: '正文',
    topics: '#a',
    stageVideoPath: video,
    stageCoverPath: cover,
  })
  assert.equal(prepared.item.state, 'unconfirmed')
  await assert.rejects(api.action(space, 'ai', { action: 'confirmation.submit', id: prepared.item.id }), /仅用户|不能批准/)

  const session = 'fixture-session'
  const grant = await api.humanAction(space, { action: 'challenge', id: prepared.item.id }, session)
  assert.equal(grant.success, true)
  await assert.rejects(api.humanAction(space, { action: 'submit', id: prepared.item.id, challenge: grant.challenge, csrf: grant.csrf }, 'other'), /无效/)

  process.env.PUBLISH_STUDIO_ALLOW_EXECUTE = '1'
  process.env.PUBLISH_STUDIO_EXECUTOR_MOCK = '1'
  const submitted = await api.humanAction(space, { action: 'submit', id: prepared.item.id, challenge: grant.challenge, csrf: grant.csrf, dryRun: false }, session)
  assert.equal(submitted.item.state, 'unknown')
  assert.equal(submitted.item.receipt.usedPostVideo, false)
  assert.equal(submitted.item.receipt.requiresOriginalGeoProcess, false)
  assert.equal(submitted.item.receipt.mock, true)

  // Quota inherited baseline 7 + one attempt => 8
  const usage2 = (await api.action(space, 'ui', { action: 'runtime' })).usage
  assert.equal(usage2.attempts, 8)

  // Cross-company isolation
  assert.equal((await api.action('co-other', 'ui', { action: 'tasks.list' })).items.length, 0)
  assert.equal(network, 0)
  console.log('PASS service: independent auth/baseline/accounts/prepare/nonce/mock-execute/quota/company isolation; zero network')
} finally {
  process.env.HOME = oldHome
  delete process.env.PUBLISH_STUDIO_ALLOW_EXECUTE
  delete process.env.PUBLISH_STUDIO_EXECUTOR_MOCK
  rmSync(home, { recursive: true, force: true, maxRetries: 10 })
}
