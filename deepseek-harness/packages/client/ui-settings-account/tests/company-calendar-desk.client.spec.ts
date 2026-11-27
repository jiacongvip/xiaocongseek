import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  blank,
  calendarDayHeading,
  calendarMonthMeta,
  calendarMonthShift,
  calendarOverflowLabel,
  calendarStatusLabel,
  calendarWorkLabel,
  todayBJ,
} from '../src/client/DigitalHumanCalendar.tsx'
import { confirmCalendarDelete } from '../src/client/digital-human-calendar-actions.ts'

const root = dirname(fileURLToPath(import.meta.url))
const calendarSrc = readFileSync(join(root, '../src/client/DigitalHumanCalendar.tsx'), 'utf8')
const panelSrc = readFileSync(join(root, '../src/client/DigitalHumanPanel.tsx'), 'utf8')
const deskCss = readFileSync(join(root, '../src/client/DigitalHumanCalendarDesk.module.css'), 'utf8')
const sharedCss = readFileSync(join(root, '../src/client/DigitalHumanCalendar.module.css'), 'utf8')
const actionsSrc = readFileSync(join(root, '../src/client/digital-human-calendar-actions.ts'), 'utf8')
const calendarBranch = panelSrc.slice(
  panelSrc.indexOf(") : appPage === 'calendar' ? ("),
  panelSrc.indexOf(") : appPage === 'materials' ? ("),
)

describe('calendar month and Beijing-time helpers', () => {
  it('todayBJ stays Asia/Shanghai YYYY-MM-DD and blank keeps 09:00 / 抖音 / pending', () => {
    const expected = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    expect(todayBJ()).toBe(expected)
    expect(todayBJ()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(blank('2026-11-10')).toEqual({ title: '', scheduledAt: '2026-11-10T09:00', platform: '抖音', notes: '', status: 'pending', historyId: '' })
  })

  it('month meta and shift use Date.UTC first weekday and day counts', () => {
    expect(calendarMonthMeta('2026-11')).toEqual({ year: 2026, monthNumber: 11, firstWeekday: 0, days: 30 })
    expect(calendarMonthMeta('2026-02')).toEqual({ year: 2026, monthNumber: 2, firstWeekday: 0, days: 28 })
    expect(calendarMonthShift('2026-11', -1)).toBe('2026-10')
    expect(calendarMonthShift('2026-11', 1)).toBe('2026-12')
    expect(calendarMonthShift('2026-01', -1)).toBe('2025-12')
    expect(calendarMonthShift('2026-12', 1)).toBe('2027-01')
  })

  it('day heading, overflow, status and missing work labels match the desk copy', () => {
    expect(calendarDayHeading('2026-11-10', 2)).toBe('11月10日 · 2 条')
    expect(calendarDayHeading('2026-01-01', 0)).toBe('1月1日 · 0 条')
    expect(calendarOverflowLabel(2)).toBe('')
    expect(calendarOverflowLabel(3)).toBe('还有 1 条')
    expect(calendarOverflowLabel(5)).toBe('还有 3 条')
    expect(calendarStatusLabel('pending')).toBe('待发布')
    expect(calendarStatusLabel('published')).toBe('已发')
    expect(calendarWorkLabel([], '')).toBe('')
    expect(calendarWorkLabel([], 'gone')).toBe('成片已不在')
    expect(calendarWorkLabel([{ id: 'w1', title: '成片一', kind: 'video' }], 'w1')).toBe('成片一')
  })
})

describe('calendar delete confirm and source API contract', () => {
  it('keeps the original confirm text and only deletes after yes', () => {
    const calls: string[] = []
    confirmCalendarDelete('标题一', 'id-1', message => {
      expect(message).toBe('删除发布计划「标题一」？取消不会删除，关联成片也不会被删除。')
      return false
    }, id => calls.push(id))
    expect(calls).toEqual([])
    confirmCalendarDelete('标题一', 'id-1', () => true, id => calls.push(id))
    expect(calls).toEqual(['id-1'])
    confirmCalendarDelete('无 id', undefined, () => true, id => calls.push(id))
    expect(calls).toEqual(['id-1'])
    expect(actionsSrc).toContain('删除发布计划「${title}」？取消不会删除，关联成片也不会被删除。')
  })

  it('source keeps publish-calendar GET/POST, UTC month math, upsert/delete payloads and datetime bounds', () => {
    expect(calendarSrc).toContain("new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })")
    expect(calendarSrc).toContain('`/digital-human-studio/publish-calendar?space=${encodeURIComponent(spaceId)}`')
    expect(calendarSrc).toContain("fetch('/digital-human-studio/publish-calendar', { method: 'POST'")
    expect(calendarSrc).toContain('JSON.stringify({ ...body, space: spaceId })')
    expect(calendarSrc).toContain('if (!live.current || data.spaceId !== spaceId) return')
    expect(calendarSrc).toContain('new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()')
    expect(calendarSrc).toContain('new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()')
    expect(calendarSrc).toContain('setSelected(`${next}-01`)')
    expect(calendarSrc).toContain("void mutate({ action: 'upsert', item: { ...editing, auto: undefined } })")
    expect(calendarSrc).toContain("void mutate({ action: 'upsert', item: { ...plan, status: plan.status === 'published' ? 'pending' : 'published' } })")
    expect(calendarSrc).toContain("id => { void mutate({ action: 'delete', id }) }")
    expect(calendarSrc).toContain('type="datetime-local"')
    expect(calendarSrc).toContain('min="2000-01-01T00:00"')
    expect(calendarSrc).toContain('max="2100-12-31T23:59"')
    expect(calendarSrc).toContain('value={editing.scheduledAt.slice(0, 16)}')
    expect(calendarSrc).toContain('setEditing(blank(selected))')
    expect(calendarSrc).toContain('confirmCalendarDelete')
  })
})

describe('calendar desk UI source scope', () => {
  it('uses the exclusive desk CSS and drops the old title, UTC disclaimer and grey-button skin', () => {
    expect(calendarSrc).toContain("from './DigitalHumanCalendarDesk.module.css'")
    expect(calendarSrc).not.toContain('DigitalHumanCalendar.module.css')
    expect(calendarSrc).not.toContain('<h1>')
    expect(calendarSrc).not.toContain(' · 发布日历')
    expect(calendarSrc).toContain('aria-label="公司日历"')
    expect(calendarSrc).not.toContain('UTC+8')
    expect(calendarSrc).not.toContain('不会自动发布或提醒')
    expect(calendarSrc).toContain('新增排期')
    expect(calendarSrc).toContain('今天')
    expect(calendarSrc).toContain("['周日', '周一', '周二', '周三', '周四', '周五', '周六']")
    expect(calendarSrc).not.toContain('周{day}')
    expect(calendarSrc).not.toContain('· 今天')
    expect(calendarSrc).not.toContain('○')
    expect(calendarSrc).not.toContain('✓')
    expect(calendarSrc).toContain('data-today')
    expect(calendarSrc).toContain("{plan.status === 'published' ? '标未发' : '标已发'}")
    expect(calendarSrc).not.toContain('标记已发布')
    expect(calendarSrc).not.toContain('改为待发布')
    expect(calendarSrc).not.toContain('关联成片已移除或不再保留')
    expect(calendarSrc).toContain('成片：${calendarWorkLabel')
    expect(calendarSrc).toContain('这个月还没有排期。选一天，点「新增排期」。')
    expect(calendarSrc).toContain('这一天没有排期')
    expect(calendarSrc).toContain("{editing?.id ? '改排期' : '新建排期'}")
    expect(calendarSrc).not.toContain('修改排期')
    expect(calendarSrc).toContain('<option value="pending">待发布</option>')
    expect(calendarSrc).toContain('<option value="published">已发</option>')
    expect(calendarSrc).not.toContain('已发布（仅手动记录，不会实际发布）')
    expect(calendarSrc).toContain('勾了自动发：到点小葱会直接发到平台，发完回来点「标已发」核对。')
    expect(calendarSrc).toContain('没勾自动发：到点不会发，标已发只是记一笔。')
    expect(calendarSrc).toContain('到点自动发')
    expect(calendarSrc).toContain('autoSend: event.target.checked')
    expect(calendarSrc).toContain('className={css.pad}')
    expect(calendarSrc).toContain("{busy ? '保存中' : editing.id ? '保存修改' : '添加排期'}")
    expect(calendarBranch).toContain("renderCompanyDeskHead(spaceId, 'calendar'")
    expect(calendarBranch).toContain('点一天看排期，发完自己标已发。')
    expect(calendarBranch).toContain("subtitle: '点一天看排期，发完自己标已发。'")
    expect(calendarBranch).toContain('css.deskPrimary')
    expect(calendarBranch).toContain('css.deskGhost')
    expect(calendarBranch).toContain('css.emptyDesk')
    expect(calendarBranch).not.toContain('全部公司')
    expect(calendarBranch).not.toContain('companyName=')
  })

  it('isolates shared calendar CSS for other screens and keeps workbench tokens only on the desk module', () => {
    expect(deskCss).toContain('--purple: #1b1b1d')
    expect(deskCss).toContain('--purple-soft:')
    expect(deskCss).toContain('--purple-line:')
    expect(deskCss).toContain('min-height: 96px')
    expect(deskCss).toContain('grid-template-columns: repeat(7, minmax(0, 1fr))')
    expect(deskCss).toContain('gap: 8px')
    expect(deskCss).not.toMatch(/\.root\s+button/)
    expect(deskCss).not.toContain('#8a59d6')
    expect(deskCss).not.toContain('#cdb4ee')
    expect(sharedCss).toContain('.root button')
    expect(sharedCss).toContain('border-radius: 9px')
    const accounts = readFileSync(join(root, '../src/client/DigitalHumanPlatformAccounts.tsx'), 'utf8')
    expect(accounts).toContain("from './DigitalHumanPlatformAccounts.module.css'")
    expect(accounts).not.toContain('DigitalHumanCalendar.module.css')
    expect(panelSrc).toContain('今天先补档案或做一条')
    expect(panelSrc).toContain('COMPANY_LIST_ACTIONS')
    expect(panelSrc).toContain('先在日历排期，再挑一条写文案、选封面，最后复制到平台发。')
  })
})
