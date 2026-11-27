import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'ps-login-'))
const oldHome = process.env.HOME
process.env.HOME = home
process.env.PUBLISH_STUDIO_ALLOW_LOGIN_MOCK = '1'

try {
  const { createPublishStudio } = await import(pathToFileURL(join(root, 'dist/service.js')).href)
  const login = await import(pathToFileURL(join(root, 'dist/platform-login.js')).href)

  const space = 'co_login_1'
  const other = 'co_login_2'

  function mockFactory(scenario) {
    return (args) => {
      const py = process.env.PUBLISH_STUDIO_PYTHON || 'python3'
      const script = join(root, 'publishing/login_runner.py')
      return spawn(py, [
        script,
        '--platform', args.platform,
        '--binding-id', args.bindingId,
        '--login-url', args.loginUrl,
        '--personal-url', args.personalUrl || '',
        '--status-file', args.statusFile,
        '--storage-file', args.storageFile,
        '--qr-file', args.qrFile,
        '--cancel-file', args.cancelFile,
        '--timeout-sec', String(args.timeoutSec || 30),
        '--mock-scenario', scenario,
        '--mock-nickname', '测试昵称',
      ], { stdio: ['ignore', 'ignore', 'pipe'] })
    }
  }

  async function waitPhase(api, spaceId, sessionId, want, tries = 40) {
    for (let i = 0; i < tries; i++) {
      const st = await api.action(spaceId, 'ui', { action: 'accounts.login.poll', sessionId })
      if (st.phase === want) return st
      await new Promise(r => setTimeout(r, 50))
    }
    const last = await api.action(spaceId, 'ui', { action: 'accounts.login.poll', sessionId })
    throw new Error(`timeout waiting ${want}, last=${last.phase} ${last.message}`)
  }

  login.setLoginRunnerFactoryForTests(mockFactory('success'))
  const api = createPublishStudio()

  const plats = await api.action(space, 'ui', { action: 'accounts.platforms' })
  assert.ok(plats.items.length >= 5)
  assert.ok(plats.items.every(p => p.loginUrlHost && !String(p.loginUrlHost).includes('cookie')))
  assert.ok(plats.items.some(p => p.key === 'douyin'))

  const listed = await api.action(space, 'ai', { action: 'accounts.list' })
  assert.equal(listed.items.length, 0)
  await assert.rejects(() => api.action(space, 'ai', { action: 'accounts.login.start', id: 'x', revision: 0 }), /仅用户/)

  const created = await api.action(space, 'ui', { action: 'accounts.create', platform: 'douyin', label: '品牌抖音' })
  assert.equal(created.item.platform, 'douyin')
  assert.equal(created.item.status, 'unconfigured')
  const started = await api.action(space, 'ui', { action: 'accounts.login.start', id: created.item.id, revision: created.item.revision })
  assert.ok(started.sessionId)
  assert.ok(['starting', 'waiting_browser', 'waiting_scan', 'authorized'].includes(started.phase))
  const done = await waitPhase(api, space, started.sessionId, 'authorized')
  assert.equal(done.phase, 'authorized')
  assert.equal(done.item.status, 'authorized')
  assert.equal(done.item.nickname, '测试昵称')
  assert.equal(done.item.hasCredentialFile, true)
  assert.equal('storage' in done, false)
  assert.equal('cookies' in done, false)

  const otherList = await api.action(other, 'ui', { action: 'accounts.list' })
  assert.equal(otherList.items.length, 0)
  await assert.rejects(
    () => api.action(other, 'ui', { action: 'accounts.login.poll', sessionId: started.sessionId }),
    /不属于当前公司/,
  )
  await assert.rejects(
    () => api.action(other, 'ui', { action: 'accounts.login.cancel', sessionId: started.sessionId }),
    /不属于当前公司/,
  )

  login.setLoginRunnerFactoryForTests(mockFactory('fail'))
  const c2 = await api.action(space, 'ui', { action: 'accounts.create', platform: 'xiaohongshu', label: '小红书号' })
  const s2 = await api.action(space, 'ui', { action: 'accounts.login.start', id: c2.item.id, revision: c2.item.revision })
  const failed = await waitPhase(api, space, s2.sessionId, 'failed')
  assert.equal(failed.phase, 'failed')

  await assert.rejects(() => api.action(space, 'ui', { action: 'accounts.remove', id: created.item.id, revision: done.item.revision, confirm: false }), /确认/)
  const removed = await api.action(space, 'ui', { action: 'accounts.remove', id: created.item.id, revision: done.item.revision, confirm: true })
  assert.equal(removed.removedId, created.item.id)
  const after = await api.action(space, 'ui', { action: 'accounts.list' })
  assert.equal(after.items.some(x => x.id === created.item.id), false)

  await assert.rejects(() => api.action(space, 'ui', { action: 'accounts.create', platform: 'not-a-platform' }), /白名单|接入|官方/)

  console.log('PASS: platform login create/start/poll/authorize/fail/remove + AI deny + company isolation + mock runner')
} finally {
  process.env.HOME = oldHome
  try { rmSync(home, { recursive: true, force: true, maxRetries: 10 }) } catch {}
}
