import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const oldHome = process.env.HOME
const home = mkdtempSync(join(tmpdir(), 'xdh-calendar-test-'))
process.env.HOME = home
try {
  const calendar = await import('../dist/publish-calendar.js')
  const spaces = await import('../dist/spaces.js')
  const history = await import('../dist/studio-history.js')
  let store = spaces.emptySpaceStore()
  const created = spaces.createSpace(store, '测试公司A')
  store = created.store
  const a = created.space.id, b = 'default'
  assert.equal(calendar.requireCalendarSpace(store, a), a)
  for (const invalid of [undefined, null, '', '../x', 'co-unknown', 'default/../x']) assert.throws(() => calendar.requireCalendarSpace(store, invalid))
  assert.throws(() => calendar.calendarPath('../x'))
  assert.deepEqual(calendar.loadPublishCalendar(a), [])
  history.upsertStudioHistory(a, { id: 'work-a', kind: 'xdh-avatar-video', title: 'A成片', status: 'SUCCESS', at: 1 })
  history.upsertStudioHistory(b, { id: 'work-b', kind: 'ximg', title: 'B图片', status: 'SUCCESS', at: 1 })
  const input = { title: '新品介绍', scheduledAt: '2026-12-01T00:05', platform: '自定义平台', notes: '测试备注', status: 'pending', historyId: 'work-a' }
  const first = calendar.upsertPublishPlan(a, input)
  assert.equal(first.scheduledAt, '2026-12-01T00:05+08:00')
  assert.equal(calendar.publishDay(first.scheduledAt), '2026-12-01')
  assert.equal(new Date(first.scheduledAt).toISOString(), '2026-11-30T16:05:00.000Z')
  assert.equal(calendar.normalizePublishTime('2026-01-01T00:00'), '2026-01-01T00:00+08:00')
  assert.equal(calendar.normalizePublishTime('2028-02-29T23:59'), '2028-02-29T23:59+08:00')
  for (const value of ['2026-02-29T12:00', '2026-02-30T12:00', '2026-13-01T00:00', '2026-01-01T24:00', '2026-01-01T00:60', '2026-12-01T00:05Z', '', 'invalid']) assert.throws(() => calendar.normalizePublishTime(value))
  assert.equal(calendar.loadPublishCalendar(a).length, 1)
  assert.deepEqual(calendar.loadPublishCalendar(b), [])
  assert.equal(calendar.calendarWorks(a)[0].id, 'work-a')
  assert.throws(() => calendar.upsertPublishPlan(a, { ...input, historyId: 'work-b' }), /不属于/)
  assert.throws(() => calendar.upsertPublishPlan(b, { ...input, historyId: 'work-a' }), /不属于/)
  assert.throws(() => calendar.upsertPublishPlan(b, { ...input, id: first.id, historyId: '' }), /找不到/)
  assert.throws(() => calendar.upsertPublishPlan(a, { ...input, title: '   ' }), /标题不能为空/)
  assert.throws(() => calendar.upsertPublishPlan(a, { ...input, id: '../oops' }), /ID无效/)
  assert.throws(() => calendar.upsertPublishPlan(a, { ...input, status: 'sent' }), /状态无效/)
  const changed = calendar.upsertPublishPlan(a, { ...input, id: first.id, title: '已编辑', status: 'published' })
  assert.equal(changed.id, first.id)
  assert.equal(calendar.loadPublishCalendar(a)[0].status, 'published')
  history.saveStudioHistory(a, []) // missing history must not erase or crash an existing plan
  calendar.upsertPublishPlan(a, { ...changed, notes: '成片缺失仍可编辑排期' })
  assert.equal(calendar.loadPublishCalendar(a)[0].historyId, 'work-a')
  assert.equal(calendar.deletePublishPlan(b, first.id), false)
  assert.equal(calendar.loadPublishCalendar(a).length, 1)
  assert.equal(calendar.deletePublishPlan(a, first.id), true)
  assert.equal(calendar.deletePublishPlan(a, first.id), false)
  assert.deepEqual(calendar.loadPublishCalendar(a), [])
  assert.throws(() => calendar.deletePublishPlan(a, '../x'))
  assert.ok(existsSync(calendar.calendarPath(a)))
  writeFileSync(calendar.calendarPath(a), '{broken fixture')
  assert.throws(() => calendar.upsertPublishPlan(a, { ...input, historyId: '' }), /已保留/)
  assert.equal(readFileSync(calendar.calendarPath(a), 'utf8'), '{broken fixture')
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const ts = require('typescript')
  const clientSource = readFileSync(new URL('../../deepseek-harness/packages/client/ui-settings-account/src/client/digital-human-calendar-actions.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(clientSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  const { confirmCalendarDelete } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  const calls = []
  confirmCalendarDelete('取消测试', 'fixture', () => false, id => calls.push(id))
  assert.deepEqual(calls, [], 'cancel must not invoke delete')
  confirmCalendarDelete('确认测试', 'fixture', () => true, id => calls.push(id))
  assert.deepEqual(calls, ['fixture'])
  console.log('PASS: UI delete confirmation cancel/confirm branches')
  console.log('PASS: calendar CRUD, persistence, company isolation, associations, Beijing boundaries and corrupt-file protection')
} finally {
  rmSync(home, { recursive: true, force: true })
  if (oldHome === undefined) delete process.env.HOME
  else process.env.HOME = oldHome
}
