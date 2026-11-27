import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { shouldShowRecordRail } from '../src/client/DigitalHumanRecordRail.tsx'
import { HOTBOARD_DISCLAIMER, HOTBOARD_TITLE } from '../src/client/industry-hotboard-state.ts'

const root = dirname(fileURLToPath(import.meta.url))
const panel = readFileSync(join(root, '../src/client/DigitalHumanPanel.tsx'), 'utf8')
const board = readFileSync(join(root, '../src/client/DigitalHumanIndustryHotboard.tsx'), 'utf8')
const branch = panel.slice(
  panel.indexOf(") : appPage === 'industry-hotboard' ? ("),
  panel.indexOf(") : appPage === 'publish-packs' ? ("),
)

describe('industry hotboard desk', () => {
  it('adds a left-nav 热榜 entry next to 采集', () => {
    expect(panel).toContain("isSideNavOn(appPage, 'industry-hotboard')")
    expect(panel).toContain('热榜')
    expect(branch).toContain('DigitalHumanIndustryHotboard')
    expect(branch).toContain("subtitle: '按这家公司的行业词，搜最近最热的样本。'")
    expect(HOTBOARD_TITLE).toBe('热榜')
    expect(HOTBOARD_DISCLAIMER).toContain('已经接上的爬虫搜索')
    expect(shouldShowRecordRail('industry-hotboard', false, true)).toBe(true)
  })

  it('reuses crawler keyword search and does not claim a national hot-search type', () => {
    expect(board).toContain('/digital-human-studio/industry-hotboard')
    expect(board).toContain("platform")
    expect(board).toContain("'xhs'")
    expect(board).toContain('HOTBOARD_TITLE')
    expect(board).toContain('HOTBOARD_DISCLAIMER')
    expect(board).toContain('HOTBOARD_REFRESH')
    expect(board).toContain('下载到素材柜')
    expect(board).toContain("browserMode: 'standard'")
    expect(board).toContain('collectSubmitErrorFromResult')
    expect(board).not.toContain("browserMode: 'cdp_existing'")
    expect(board).not.toContain('官方热搜榜')
    expect(board).not.toContain('--type hot')
  })
})
