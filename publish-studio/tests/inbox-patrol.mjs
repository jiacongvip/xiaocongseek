import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'ps-patrol-'))
const oldHome = process.env.HOME
process.env.HOME = home

try {
  const { createPublishStudio } = await import(pathToFileURL(join(root, 'dist/service.js')).href)
  const patrol = await import(pathToFileURL(join(root, 'dist/inbox-patrol.js')).href)

  const space = 'co_patrol_a'
  const other = 'co_patrol_b'
  const api = createPublishStudio()

  const caps = patrol.listInboxCapabilities()
  const douyin = caps.find((x) => x.platform === 'douyin')
  const xhs = caps.find((x) => x.platform === 'xiaohongshu')
  assert.equal(douyin.messages, 'pending_verification')
  assert.equal(douyin.comments, 'pending_verification')
  assert.equal(xhs.messages, 'pending_verification')
  assert.equal(xhs.comments, 'not_configured')
  assert.ok(douyin.knownOfficialPages.some((p) => p.url === 'https://creator.douyin.com/creator-micro/home'))
  assert.ok(xhs.knownOfficialPages.some((p) => p.url === 'https://creator.xiaohongshu.com/new/home'))
  assert.equal(douyin.inboxPage, 'https://www.douyin.com/message')
  assert.equal(xhs.inboxPage, 'https://www.xiaohongshu.com/chat')
  assert.equal(douyin.commentsPage, 'https://creator.douyin.com/creator-micro/interactive/comment')
  assert.equal(xhs.commentsPage, 'https://www.xiaohongshu.com/notification?type=comment')
  assert.ok(douyin.knownOfficialPages.some((p) => p.kind === 'inbox-comments'))
  assert.ok(xhs.knownOfficialPages.some((p) => p.kind === 'inbox-comments'))
  assert.equal(patrol.hasDomMapping(douyin, 'messages'), true)
  assert.equal(patrol.hasDomMapping(douyin, 'comments'), true)
  assert.equal(patrol.hasDomMapping(xhs, 'messages'), true)
  assert.equal(patrol.hasDomMapping(xhs, 'comments'), false)
  assert.equal(patrol.adapterReady(douyin, 'messages'), false)
  assert.equal(patrol.adapterReady(douyin, 'comments'), false)
  assert.equal(patrol.adapterReady(xhs, 'comments'), false)
  assert.equal(patrol.inboxCapability('weibo').messages, 'unsupported')
  assert.ok(!String(douyin.note || '').includes('仓库仅有登录'))
  assert.ok(!String(douyin.note || '').includes('评论未接入'))
  assert.ok(String(douyin.note || '').includes('待真实网页核对') || String(douyin.note || '').includes('待实页验证') || String(douyin.note || '').includes('待页面验证'))
  assert.ok(String(xhs.note || '').includes('还缺列表结构证据') || String(xhs.note || '').includes('不能当作已接入'))
  assert.ok(!String(xhs.note || '').includes('私信和评论都已按官方网页映射'))

  assert.equal(patrol.classifyVisibleObstacle('请先完成验证码'), 'captcha')
  assert.equal(patrol.classifyVisibleObstacle('请先登录后再查看私信'), 'login_wall')
  assert.equal(patrol.classifyVisibleObstacle('你好，想咨询套餐'), 'none')

  const a = patrol.inboundFingerprint('co1', 'b1', 'messages', '用户甲')
  const b = patrol.inboundFingerprint('co1', 'b1', 'messages', '用户甲')
  const c = patrol.inboundFingerprint('co2', 'b1', 'messages', '用户甲')
  const commentSame = patrol.inboundFingerprint('co1', 'b1', 'comments', '用户甲')
  const otherAccount = patrol.inboundFingerprint('co1', 'b2', 'messages', '用户甲')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.notEqual(a, commentSame)
  assert.notEqual(a, otherAccount)
  const merged = patrol.mergeInbound([], [
    { id: '1', spaceId: 'co1', bindingId: 'b1', platform: 'douyin', channel: 'messages', fingerprint: a, visibleKey: '用户甲', visibleText: '用户甲：你好', seenAt: 1 },
    { id: '2', spaceId: 'co1', bindingId: 'b1', platform: 'douyin', channel: 'messages', fingerprint: a, visibleKey: '用户甲', visibleText: '用户甲：你好', seenAt: 2 },
  ])
  assert.equal(merged.added, 1)
  assert.equal(merged.duplicates, 1)

  assert.equal(patrol.isTickDue({ enabled: false, intervalMinutes: 30 }, undefined, Date.now()), false)
  assert.equal(patrol.isTickDue({ enabled: true, intervalMinutes: 30 }, undefined, Date.now()), true)
  assert.equal(patrol.isTickDue({ enabled: true, intervalMinutes: 30 }, Date.now() - 1000, Date.now()), false)

  const created = await api.action(space, 'ui', { action: 'accounts.create', platform: 'douyin', label: '个人抖音' })
  const otherAcc = await api.action(other, 'ui', { action: 'accounts.create', platform: 'xiaohongshu', label: '个人小红书' })

  const got = await api.action(space, 'ui', { action: 'accounts.patrol.get' })
  assert.equal(got.success, true)
  assert.equal(got.claimedRead, undefined)
  assert.equal(got.policy.enabled, false)
  assert.equal(got.connected, false)
  assert.equal(got.history.length, 0)
  assert.ok(got.note.includes('默认关闭'))

  await assert.rejects(
    () => api.action(space, 'ui', { action: 'accounts.patrol.save', enabled: true }),
    /待验证|尚未接入|不能开启/,
  )
  const saved = await api.action(space, 'ui', { action: 'accounts.patrol.save', enabled: false, intervalMinutes: 45, accounts: [{ bindingId: created.item.id, channels: ['messages', 'comments'] }] })
  assert.equal(saved.policy.enabled, false)
  assert.equal(saved.policy.intervalMinutes, 45)

  await assert.rejects(() => api.action(space, 'ai', { action: 'accounts.patrol.save', enabled: false }), /仅用户/)
  await assert.rejects(() => api.action(space, 'ai', { action: 'accounts.patrol.run', bindingId: created.item.id }), /仅用户/)

  const ran = await api.action(space, 'ui', { action: 'accounts.patrol.run', bindingId: created.item.id })
  assert.equal(ran.success, true)
  assert.equal(ran.claimedRead, false)
  assert.equal(ran.status, 'pending_verification')
  assert.equal(ran.items.length, 0)
  assert.ok(ran.reason.includes('只读核对') || ran.reason.includes('未做实页采样') || ran.reason.includes('待页面验证') || ran.reason.includes('登录会话'))

  const leaked = await api.action(other, 'ui', { action: 'accounts.patrol.get' })
  assert.equal(leaked.history.length, 0)
  assert.equal(leaked.policy.enabled, false)
  await assert.rejects(() => api.action(other, 'ui', { action: 'accounts.patrol.run', bindingId: created.item.id }), /找不到当前公司账号/)
  await assert.rejects(() => api.action(space, 'ui', { action: 'accounts.patrol.run', bindingId: otherAcc.item.id }), /找不到当前公司账号/)

  await assert.rejects(() => api.action(space, 'ui', { action: 'accounts.patrol.send', itemId: 'x' }), /不执行真实回复|不会发送/)
  await assert.rejects(() => api.action(space, 'ui', { action: 'accounts.patrol.draft.send' }), /不执行真实回复|不会发送/)

  // Isolated mock adapter — not a real platform page
  patrol.setInboxAdapterForTests({
    async read({ spaceId, bindingId, channel }) {
      if (channel === 'comments') return { status: 'ready', claimedRead: true, obstacle: 'none', reason: 'mock', items: [{ visibleKey: '评1', visibleText: '这条看起来不错' }] }
      return { status: 'ready', claimedRead: true, obstacle: 'none', reason: 'mock', items: [{ visibleKey: '信1', visibleText: '你好，想咨询' }] }
    },
  })
  const first = await api.action(space, 'ui', { action: 'accounts.patrol.run', bindingId: created.item.id })
  assert.equal(first.claimedRead, true)
  assert.equal(first.status, 'ok')
  assert.equal(first.added, 2)
  const second = await api.action(space, 'ui', { action: 'accounts.patrol.run', bindingId: created.item.id })
  assert.equal(second.added, 0)
  assert.equal(second.duplicates, 2)
  const hist = await api.action(space, 'ui', { action: 'accounts.patrol.history' })
  assert.equal(hist.history.length, 2)
  const channels = hist.history.map((row) => row.channel).sort()
  assert.deepEqual(channels, ['comments', 'messages'])
  assert.equal('cookies' in hist, false)
  assert.equal('storage' in hist, false)
  const commentItem = hist.history.find((row) => row.channel === 'comments')
  const draft = await api.action(space, 'ui', { action: 'accounts.patrol.draft.save', itemId: commentItem.id, body: '谢谢评论，我们稍后再联系。' })
  assert.equal(draft.draft.status, 'pending_confirmation')

  patrol.setInboxAdapterForTests({
    async read() {
      return { status: 'stopped', claimedRead: false, obstacle: 'captcha', reason: 'captcha', items: [] }
    },
  })
  const stopped = await api.action(space, 'ui', { action: 'accounts.patrol.run', bindingId: created.item.id })
  assert.equal(stopped.claimedRead, false)
  assert.equal(stopped.status, 'stopped')
  assert.ok(stopped.reason.includes('验证码') || stopped.reason.includes('停止'))

  const stop = await api.action(space, 'ui', { action: 'accounts.patrol.stop' })
  assert.equal(stop.exitRequested, true)
  const halted = await api.action(space, 'ui', { action: 'accounts.patrol.run', bindingId: created.item.id })
  assert.equal(halted.status, 'stopped')
  assert.equal(halted.claimedRead, false)

  // Re-open after stop: saving policy (disabled) clears exit flag
  await api.action(space, 'ui', { action: 'accounts.patrol.save', enabled: false, accounts: [{ bindingId: created.item.id, channels: ['messages'] }] })
  patrol.setInboxAdapterForTests({
    async read() {
      return { status: 'stopped', claimedRead: false, obstacle: 'login_wall', reason: 'login', items: [] }
    },
  })
  const wall = await api.action(space, 'ui', { action: 'accounts.patrol.run', bindingId: created.item.id })
  assert.equal(wall.status, 'stopped')
  assert.ok(wall.reason.includes('登录'))

  const tick = await api.action(space, 'ui', { action: 'accounts.patrol.tick' })
  assert.equal(tick.due, false)
  assert.equal(tick.claimedRead, false)

  patrol.setInboxAdapterForTests(undefined)
  patrol.resetPatrolLocksForTests()

  // Timeout/lock: a second run on the same account is rejected as busy
  patrol.resetPatrolLocksForTests()
  await api.action(space, 'ui', { action: 'accounts.patrol.save', enabled: false, accounts: [{ bindingId: created.item.id, channels: ['messages'] }] })
  let release
  const hanging = new Promise((resolve) => { release = resolve })
  patrol.setInboxAdapterForTests({
    async read() {
      await hanging
      return { status: 'pending_verification', claimedRead: false, obstacle: 'none', reason: 'hang', items: [] }
    },
  })
  const firstHang = api.action(space, 'ui', { action: 'accounts.patrol.run', bindingId: created.item.id })
  await new Promise((r) => setTimeout(r, 50))
  const busy = await api.action(space, 'ui', { action: 'accounts.patrol.run', bindingId: created.item.id })
  assert.equal(busy.status, 'busy')
  assert.equal(busy.claimedRead, false)
  release({ status: 'pending_verification', claimedRead: false, obstacle: 'none', reason: 'hang', items: [] })
  await firstHang
  patrol.setInboxAdapterForTests(undefined)
  patrol.resetPatrolLocksForTests()

  const probe = spawnSync('python3', [join(root, 'publishing/inbox_ui_adapter.py'), '--platform', 'douyin', '--channel', 'messages', '--mode', 'probe'], { encoding: 'utf8' })
  assert.equal(probe.status, 0, probe.stderr)
  const probeBody = JSON.parse(probe.stdout)
  assert.equal(probeBody.claimedRead, false)
  assert.equal(probeBody.status, 'pending_verification')
  assert.equal(Array.isArray(probeBody.items) && probeBody.items.length === 0, true)

  const html = join(home, 'mock-inbox.html')
  writeFileSync(html, '<html><body><div data-inbox-item="1" data-visible-key="用户甲" aria-label="用户甲：你好">用户甲：你好</div></body></html>')
  const mock = spawnSync('python3', [join(root, 'publishing/inbox_ui_adapter.py'), '--platform', 'douyin', '--mode', 'mock', '--html-file', html], { encoding: 'utf8' })
  assert.equal(mock.status, 0, mock.stderr)
  const mockBody = JSON.parse(mock.stdout)
  assert.equal(mockBody.claimedRead, true)
  assert.equal(mockBody.items[0].visibleKey, '用户甲')

  const capHtml = join(home, 'mock-captcha.html')
  writeFileSync(capHtml, '<html><body><p>请先完成验证码</p></body></html>')
  const cap = spawnSync('python3', [join(root, 'publishing/inbox_ui_adapter.py'), '--platform', 'xiaohongshu', '--mode', 'mock', '--html-file', capHtml], { encoding: 'utf8' })
  const capBody = JSON.parse(cap.stdout)
  assert.equal(capBody.claimedRead, false)
  assert.equal(capBody.obstacle, 'captcha')

  const fixtureDir = join(root, 'tests/fixtures/inbox-dom')
  const dyFix = spawnSync('python3', [join(root, 'publishing/inbox_ui_adapter.py'), '--platform', 'douyin', '--mode', 'mock', '--html-file', join(fixtureDir, 'douyin-list.html')], { encoding: 'utf8' })
  assert.equal(dyFix.status, 0, dyFix.stderr)
  const dyBody = JSON.parse(dyFix.stdout)
  assert.equal(dyBody.claimedRead, true)
  assert.ok(dyBody.items.some((row) => String(row.visibleText).includes('夹具用户甲')))

  const xhsFix = spawnSync('python3', [join(root, 'publishing/inbox_ui_adapter.py'), '--platform', 'xiaohongshu', '--mode', 'mock', '--html-file', join(fixtureDir, 'xhs-list.html')], { encoding: 'utf8' })
  const xhsBody = JSON.parse(xhsFix.stdout)
  assert.equal(xhsBody.claimedRead, true)
  assert.ok(xhsBody.items.some((row) => String(row.visibleText).includes('夹具用户乙')))

  const emptyFix = spawnSync('python3', [join(root, 'publishing/inbox_ui_adapter.py'), '--platform', 'xiaohongshu', '--mode', 'mock', '--html-file', join(fixtureDir, 'xhs-empty.html')], { encoding: 'utf8' })
  const emptyBody = JSON.parse(emptyFix.stdout)
  assert.equal(emptyBody.claimedRead, true)
  assert.equal(emptyBody.items.length, 0)

  const dyCmt = spawnSync('python3', [join(root, 'publishing/inbox_ui_adapter.py'), '--platform', 'douyin', '--channel', 'comments', '--mode', 'mock', '--html-file', join(fixtureDir, 'douyin-comments-list.html'), '--page-url', 'https://creator.douyin.com/creator-micro/interactive/comment'], { encoding: 'utf8' })
  assert.equal(dyCmt.status, 0, dyCmt.stderr)
  const dyCmtBody = JSON.parse(dyCmt.stdout)
  assert.equal(dyCmtBody.claimedRead, true)
  assert.ok(dyCmtBody.items.some((row) => String(row.visibleText).includes('夹具评论用户甲')))
  assert.ok(dyCmtBody.items.every((row) => row.itemType === 'comment'))

  const missCmt = spawnSync('python3', [join(root, 'publishing/inbox_ui_adapter.py'), '--platform', 'xiaohongshu', '--channel', 'comments', '--mode', 'mock', '--html-file', join(fixtureDir, 'comments-selector-miss.html')], { encoding: 'utf8' })
  const missBody = JSON.parse(missCmt.stdout)
  assert.equal(missBody.claimedRead, false)
  assert.equal(missBody.status, 'selector_mismatch')

  const commentProbe = spawnSync('python3', [join(root, 'publishing/inbox_ui_adapter.py'), '--platform', 'xiaohongshu', '--channel', 'comments', '--mode', 'probe'], { encoding: 'utf8' })
  const commentProbeBody = JSON.parse(commentProbe.stdout)
  assert.equal(commentProbeBody.claimedRead, false)
  assert.equal(commentProbeBody.status, 'not_configured')

  const adapterSrc = spawnSync('python3', ['-c', 'from pathlib import Path; import sys; print(Path(sys.argv[1]).read_text())', join(root, 'publishing/inbox_ui_adapter.py')], { encoding: 'utf8' })
  assert.doesNotMatch(adapterSrc.stdout, /edith\.xiaohongshu\.com|aweme\/v1\/web\/im|you\/mentions|__INITIAL_STATE__/)

  await assert.rejects(() => api.action(space, 'ui', { action: 'accounts.patrol.mark_verified' }), /不能手动标记/)
  await assert.rejects(() => api.action(space, 'ai', { action: 'accounts.patrol.verify_page', bindingId: created.item.id }), /仅用户/)
  const verify = await api.action(space, 'ui', { action: 'accounts.patrol.verify_page', bindingId: created.item.id })
  assert.equal(verify.verificationRecorded, false)
  assert.equal(verify.liveSamplingEnabled, false)
  assert.equal(verify.verifyEntry, true)
  assert.ok(String(verify.reason || '').includes('未做实页采样') || String(verify.reason || '').includes('不会记为已验证'))
  const afterVerify = await api.action(space, 'ui', { action: 'accounts.patrol.get' })
  assert.equal(afterVerify.connected, false)

  await assert.rejects(
    async () => patrol.recordLiveVerification(space, {
      bindingId: created.item.id,
      platform: 'douyin',
      channel: 'messages',
      officialUrl: 'https://www.douyin.com/message',
      evidenceSource: 'fixture_sample',
      liveLaunched: false,
      outcome: 'matched_list',
      itemCount: 1,
      adapterStatus: 'ready',
    }),
    /只有真实网页|不能手动/,
  )
  const liveEntry = patrol.recordLiveVerification(space, {
    bindingId: created.item.id,
    platform: 'douyin',
    channel: 'messages',
    officialUrl: 'https://www.douyin.com/message',
    evidenceSource: 'live_page',
    liveLaunched: true,
    outcome: 'matched_list',
    itemCount: 1,
    adapterStatus: 'ready',
  })
  assert.equal(liveEntry.evidenceSource, 'live_page')
  assert.equal(patrol.spaceHasLiveVerification(space), true)
  const afterLedger = await api.action(space, 'ui', { action: 'accounts.patrol.get' })
  assert.equal(afterLedger.connected, true)
  assert.equal((afterLedger.pageEvidence || []).length >= 1, true)

  const runnerSrc = spawnSync('python3', ['-c', 'from pathlib import Path; import sys; print(Path(sys.argv[1]).read_text())', join(root, 'publishing/inbox_dom_runner.py')], { encoding: 'utf8' })
  assert.doesNotMatch(runnerSrc.stdout, /you\/mentions|__INITIAL_STATE__|edith\.xiaohongshu\.com/)

  console.log('PASS: inbox patrol capability/dedupe/isolation/pending_verification/comments fixture DOM/stop/draft/no-send/lock/verify-ledger')
} finally {
  process.env.HOME = oldHome
  try { rmSync(home, { recursive: true, force: true, maxRetries: 10 }) } catch {}
}
