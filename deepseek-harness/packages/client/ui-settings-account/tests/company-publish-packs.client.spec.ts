import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  blankPack,
  pickPackForPlan,
  publishPacksEmptyMessage,
  publishPacksListMeta,
  publishPacksPrimaryLabel,
} from '../src/client/DigitalHumanPublishPacks.tsx'

const root = dirname(fileURLToPath(import.meta.url))
const packSrc = readFileSync(join(root, '../src/client/DigitalHumanPublishPacks.tsx'), 'utf8')
const panelSrc = readFileSync(join(root, '../src/client/DigitalHumanPanel.tsx'), 'utf8')

describe('publish packs follow the calendar plan', () => {
  it('primary CTA and empty copy depend on whether the company has plans', () => {
    expect(publishPacksPrimaryLabel(0)).toBe('先去日历排一条')
    expect(publishPacksPrimaryLabel(2)).toBe('写文案')
    expect(publishPacksEmptyMessage(0, 0)).toBe('这家还没有排期。先去日历挑一天，把成片拖上去。')
    expect(publishPacksEmptyMessage(3, 0)).toBe('还没有发布包。点上面「写文案」，挑一条排期。')
    expect(publishPacksEmptyMessage(3, 2)).toBe('没有符合条件的发布包。')
  })

  it('one plan maps to one pack, reused when it already exists', () => {
    const plan = { id: 'pub-1', title: '瓷砖防滑实测', scheduledAt: '2026-11-10T09:00', platform: '抖音', status: 'pending', historyId: 'vid-1' }
    const existing = { ...blankPack(plan), id: 'pack-1', title: '已有发布包', planPlatform: '抖音', planScheduledAt: '2026-11-10T09:00', checked: true } as never
    expect(pickPackForPlan([existing], plan)).toEqual(existing)
    const created = pickPackForPlan([existing], { ...plan, id: 'pub-2', title: '新排期' })
    expect(created.id).toBe('')
    expect(created.planId).toBe('pub-2')
    expect(created.title).toBe('新排期')
    expect(publishPacksListMeta(existing as never)).toBe('抖音 · 2026-11-10 09:00 · 已检查')
    expect(publishPacksListMeta({ planPlatform: '', checked: false, planScheduledAt: '' } as never)).toBe('平台未填 · 未设时间 · 草稿')
  })
})

describe('publish packs source scope', () => {
  it('time, platform and video come from the plan, not from the pack form', () => {
    expect(packSrc).not.toContain('value={editing.platform}')
    expect(packSrc).not.toContain('value={editing.scheduledAt}')
    expect(packSrc).not.toContain('value={editing.historyId}')
    expect(packSrc).not.toContain("mutate('calendar'")
    expect(packSrc).not.toContain('关联日历')
    expect(packSrc).toContain('去日历改')
    expect(packSrc).toContain('挑一条排期')
    expect(packSrc).toContain('planId: item.planId')
  })

  it('keeps the human publish workflow: check, copy, downloads, export', () => {
    expect(packSrc).toContain("from './DigitalHumanPublishPacks.module.css'")
    expect(packSrc).not.toContain('DigitalHumanCalendar.module.css')
    expect(packSrc).toContain("mutate('check'")
    expect(packSrc).toContain("download(currentPack.id, 'video')")
    expect(packSrc).toContain("download(currentPack.id, 'cover')")
    expect(packSrc).toContain("download(currentPack.id, 'text')")
    expect(packSrc).toContain('保存、复制、下载都不等于已经发到平台。')
    expect(packSrc).toContain('if (abandon()) onAccounts()')
    expect(packSrc).toContain('去素材柜')
    // 素材柜按钮只出现在封面字段头，不在顶部动作条
    const toolbar = packSrc.slice(packSrc.indexOf('className={css.toolbar}'), packSrc.indexOf('{plans.length === 0'))
    expect(toolbar).not.toContain('去素材柜')
    expect(toolbar).toContain('日历')
    expect(toolbar).toContain('账号')
    expect(packSrc.indexOf('去素材柜')).toBeGreaterThan(packSrc.indexOf('publish-pack-cover'))
  })
})

describe('publish entry points', () => {
  it('publish overview page is gone, only the company-scoped pack page stays', () => {
    expect(panelSrc).not.toContain("appPage === 'publish' ? (")
    expect(panelSrc).toContain("appPage === 'publish-packs' ? (")
    const packs = panelSrc.slice(panelSrc.indexOf(") : appPage === 'publish-packs' ? ("), panelSrc.indexOf(") : appPage === 'platform-accounts' ? ("))
    expect(packs).toContain('renderCompanyDeskHead(spaceId, \'publish-packs\'')
    expect(packs).toContain('先在日历排期，再挑一条写文案、选封面，最后复制到平台发。')
    expect(packs).toContain("onAccounts={() => setAppPage('platform-accounts')}")
    expect(packs).toContain("onCalendar={() => setAppPage('calendar')}")
    expect(packs).toContain("openCompanyCreate(spaceId, 'xdh-avatar-video')")
    expect(panelSrc).toContain('COMPANY_LIST_ACTIONS')
  })
})
