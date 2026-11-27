import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'xdh-autopub-'))
process.env.HOME = home
process.env.XCY_AUTO_PUBLISH = '1'

const bj = ms => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(ms)).replace(' ', 'T')

try {
  const spaces = await import('../dist/spaces.js')
  const history = await import('../dist/studio-history.js')
  const calendar = await import('../dist/publish-calendar.js')
  const auto = await import('../dist/auto-publish.js')

  // 1. 北京时间换算：09:00 北京 == 01:00 UTC，不能被主机时区带跑
  assert.equal(calendar.planDueAt({ scheduledAt: '2026-11-18T09:00+08:00' }), Date.UTC(2026, 10, 18, 1, 0))
  assert.equal(Number.isFinite(calendar.planDueAt({ scheduledAt: 'not-a-date' })), false)
  assert.throws(() => calendar.normalizePublishTime('2026-02-30T00:00'), /无效/)
  assert.throws(() => calendar.normalizePublishTime('2026-11-18T24:00'), /无效/)

  const created = spaces.createSpace(spaces.emptySpaceStore(), '公司A')
  const a = created.space.id
  spaces.saveSpaceStore(created.store)

  // 2. 自己剪的成品（xdh-export-video）必须出现在可排期成片里
  const media = 'http://127.0.0.1:3080/digital-human-studio/works/file?space=' + encodeURIComponent(a) + '&id=own-1'
  history.upsertStudioHistory(a, { id: 'own-1', kind: 'xdh-export-video', title: '自己剪的片子', at: 1, status: 'SUCCESS', mediaUrl: media })
  history.upsertStudioHistory(a, { id: 'voice-1', kind: 'xdh-audio', title: '配音', at: 1, status: 'SUCCESS', mediaUrl: 'x' })
  history.upsertStudioHistory(a, { id: 'failed-1', kind: 'xdh-export-video', title: '失败的', at: 1, status: 'FAILED', mediaUrl: media })
  const works = calendar.calendarWorks(a)
  assert.equal(works.some(w => w.id === 'own-1'), true)
  assert.equal(works.some(w => w.id === 'failed-1'), false)

  // 3. 勾了自动发 -> 落盘；保存一次（内容没变）不会把自动发结果冲掉
  const plan = calendar.upsertPublishPlan(a, {
    title: '明天发装修', scheduledAt: '2099-12-01T09:00', platform: '抖音', notes: '',
    status: 'pending', historyId: 'own-1', autoSend: true,
  })
  assert.equal(plan.autoSend, true)
  calendar.setPlanAuto(a, plan.id, { state: 'failed', at: 1, error: '夹具失败' })
  const saved = calendar.loadPublishCalendar(a).find(p => p.id === plan.id)
  assert.equal(saved.auto.state, 'failed')
  const again = calendar.upsertPublishPlan(a, { ...saved, autoSend: true })
  assert.equal(again.auto.state, 'failed', '同一条排期重复保存不能丢掉自动发结果')

  // 4. 关掉再打开 = 重新武装（清掉失败标记，允许在窗口内再试一次）
  calendar.upsertPublishPlan(a, { ...saved, autoSend: false })
  const rearmed = calendar.upsertPublishPlan(a, { ...saved, autoSend: true })
  assert.equal(rearmed.auto, undefined)

  // 5. 改时间 = 换了一次排期，旧的自动发结果不沿用
  calendar.setPlanAuto(a, plan.id, { state: 'done', at: 1 })
  const moved = calendar.upsertPublishPlan(a, { ...saved, scheduledAt: '2099-12-02T09:00', autoSend: true })
  assert.equal(moved.auto, undefined)

  // 6. 没有发布插件的 autoSend 时，定时器不炸也不发
  const report = await auto.autoPublishTick({ spaceId: a })
  assert.equal(report.fired.length, 0)
  assert.equal(report.skipped.length, 0)

  // 7. 过窗口的排期在总览里要标出来，别让人以为还会补发
  const past = calendar.upsertPublishPlan(a, {
    title: '昨天忘发的', scheduledAt: bj(Date.now() - 3 * 3600 * 1000), platform: '抖音', notes: '',
    status: 'pending', historyId: 'own-1', autoSend: true,
  })
  const overview = auto.autoPublishOverview(a).plans.find(p => p.id === past.id)
  assert.equal(overview.missedWindow, true)
  assert.equal(overview.overdue, true)

  // 8. 端到端：导入过的 mp4 能直接做发布包并通过检查（不是只有数字人视频能发）
  const exportHistory = await import('../dist/export-history.js')
  const materials = await import('../dist/studio-materials.js')
  const packs = await import('../dist/publish-packs.js')
  const { readFileSync } = await import('node:fs')
  const sample = readFileSync('/Users/jiacong/.dsh/digital-human-assets/exports/own_text_otexp_mw952wgr_039b.mp4')
  const imported = exportHistory.importExport(a, '自己剪的.mp4', sample)
  assert.equal(imported.kind, 'xdh-export-video')
  const cover = materials.addStudioMaterial(a, 'logo', '封面.png', Buffer.from('fixture-cover'))
  const plan2 = calendar.upsertPublishPlan(a, {
    title: '导入成品排期', scheduledAt: '2099-12-03T09:00', platform: '抖音', notes: '',
    status: 'pending', historyId: imported.id, autoSend: false,
  })
  const pack = packs.savePack(a, { planId: plan2.id, title: '导入成品排期', body: '正文', topics: '#装修', coverRef: `material:${cover.id}`, revision: 0 })
  const checked = packs.checkPack(a, pack.id, pack.revision)
  const view = packs.packView(a, checked)
  assert.equal(view.checked, true)
  assert.equal(view.missingVideo, false)
  assert.equal(view.videoDownload, true, 'works/file 必须能作为发布包视频下载')
  assert.equal(packs.packDownload(a, pack.id, 'video').path.endsWith('.mp4'), true)

  // 9. 调度器真跑一次：用假发布插件验证「到点才发、缺发布包不发、发过不再发」
  const bridge = await import('../dist/publish-studio-bridge.js')
  let autoSendCalls = 0
  const mockStudio = {
    id: 'publish-studio', independent: true, requiresOriginalGeoProcess: false,
    action: async (_space, _actor, input) => {
      if (input.action === 'accounts.list') return { success: true, items: [
        { id: 'binding-1', platform: 'douyin', enabled: true, status: 'authorized', hasCredentialFile: true, revision: 3 },
      ] }
      if (input.action === 'task.prepare') {
        if (!input.stageVideoPath || !input.stageCoverPath) throw new Error('素材缺失')
        return { success: true, item: { id: `task-${'a'.repeat(32)}`, state: 'unconfirmed' } }
      }
      throw new Error('unexpected action ' + input.action)
    },
    autoSend: async () => { autoSendCalls++; return { success: true, item: { state: 'unknown' } } },
    humanAction: async () => ({ success: false }),
    runtimeStatus: () => ({ enabled: true }),
    assertPublishAllowed: () => ({ ok: true }),
    platforms: [],
  }
  bridge.configurePublishStudio(mockStudio)

  const due = bj(Date.now() - 6 * 60 * 1000)
  const live = calendar.upsertPublishPlan(a, { ...plan2, scheduledAt: due, autoSend: true })
  // 改排期时间会让发布包指纹失效，必须重新点一次「检查」才允许自动发（这是故意设计的）
  const recheck = packs.getPack(a, pack.id)
  packs.checkPack(a, recheck.id, recheck.revision)
  const report2 = await auto.autoPublishTick({ spaceId: a })
  const fired = report2.fired.find(r => r.planId === live.id)
  assert.equal(!!fired, true, '到点且检查过的排期应该被发出去')
  assert.equal(fired.state, 'unknown')
  assert.equal(autoSendCalls, 1)
  const afterFire = calendar.loadPublishCalendar(a).find(p => p.id === live.id)
  assert.equal(afterFire.auto.state, 'unknown', '执行器返回后记为未核验，不直接算已发')

  const again2 = await auto.autoPublishTick({ spaceId: a })
  assert.equal(autoSendCalls, 1, '结果未知的任务不能被定时器重复发送')
  assert.equal(again2.skipped.some(r => r.planId === live.id && /不重复发送/.test(r.reason)), true)

  // 缺发布包：到点也不发，只落一条原因
  const noPack = calendar.upsertPublishPlan(a, { title: '没写文案的', scheduledAt: due, platform: '抖音', notes: '', status: 'pending', historyId: plan2.historyId, autoSend: true })
  await auto.autoPublishTick({ spaceId: a })
  const noPackAfter = calendar.loadPublishCalendar(a).find(p => p.id === noPack.id)
  assert.equal(noPackAfter.auto.state, 'failed')
  assert.match(noPackAfter.auto.error, /还没有发布包文案/)
  assert.equal(autoSendCalls, 1, '缺发布包不能触发发送')

  // 未来时间：不到点不发
  const later = calendar.upsertPublishPlan(a, { title: '后天发的', scheduledAt: '2099-12-05T09:00', platform: '抖音', notes: '', status: 'pending', historyId: plan2.historyId, autoSend: true })
  await auto.autoPublishTick({ spaceId: a })
  assert.equal(calendar.loadPublishCalendar(a).find(p => p.id === later.id).auto, undefined)
  assert.equal(autoSendCalls, 1)

  console.log('PASS: 自动发布 —— 北京时区换算、成品入库、自动发落盘/重新武装/改期重置、无插件空跑、过窗口标记、导入成品可做发布包、到点才发/缺包不发/不重复发')
} finally {
  rmSync(home, { recursive: true, force: true })
}
