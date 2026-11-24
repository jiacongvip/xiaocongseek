import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

type CompanyListActionId = 'archive' | 'materials' | 'create' | 'works' | 'publish-packs'

function companyRailHighlight(appPage: string, companyOpen: boolean): CompanyListActionId | '' {
  if (appPage === 'works') return 'works'
  if (appPage === 'materials') return 'materials'
  if (appPage === 'companies' && companyOpen) return 'archive'
  if (appPage === 'create') return 'create'
  if (
    appPage === 'publish-packs'
    || appPage === 'publish'
    || appPage === 'calendar'
    || appPage === 'platform-accounts'
  ) return 'publish-packs'
  return ''
}

function normalizeRailActive(active: string): CompanyListActionId | '' {
  if (active === 'create' || active === 'video' || active === 'audio' || active === 'image') return 'create'
  if (active === 'publish-packs' || active === 'publish' || active === 'calendar' || active === 'platform-accounts') {
    return 'publish-packs'
  }
  if (active === 'archive' || active === 'materials' || active === 'works') return active
  return ''
}

const srcPath = join(dirname(fileURLToPath(import.meta.url)), '../src/client/DigitalHumanPanel.tsx')
const railStatePath = join(dirname(fileURLToPath(import.meta.url)), '../src/client/DigitalHumanRecordRailState.tsx')

const BRIEF_FIELDS = [
  { key: 'identity', label: '对外身份', placeholder: '例如：南宁某瓷砖店老板，出镜口播' },
  { key: 'business', label: '主营/卖点', placeholder: '例如：主营 800-1500 元瓷砖，主打防滑、上门量尺' },
  { key: 'audience', label: '对谁说', placeholder: '例如：装修中的业主，怕踩坑、怕被忽悠' },
  { key: 'tone', label: '口吻', placeholder: '例如：口语、像邻居介绍，别端着' },
  { key: 'avoid', label: '不要说', placeholder: '例如：别承诺疗效级效果、别贬竞品店名' },
  { key: 'sample', label: '范例口播', placeholder: '贴一段已经满意的口播，写脚本时会照着学', rows: 3 },
] as const

describe('company archive and inner rail', () => {
  it('highlights archive/create/publish from real app pages', () => {
    expect(companyRailHighlight('companies', true)).toBe('archive')
    expect(companyRailHighlight('companies', false)).toBe('')
    expect(companyRailHighlight('materials', false)).toBe('materials')
    expect(companyRailHighlight('create', false)).toBe('create')
    expect(companyRailHighlight('works', false)).toBe('works')
    expect(companyRailHighlight('publish-packs', false)).toBe('publish-packs')
    expect(companyRailHighlight('publish', false)).toBe('publish-packs')
    expect(companyRailHighlight('calendar', false)).toBe('publish-packs')
    expect(companyRailHighlight('platform-accounts', false)).toBe('publish-packs')
    expect(normalizeRailActive('audio')).toBe('create')
    expect(normalizeRailActive('image')).toBe('create')
    expect(normalizeRailActive('video')).toBe('create')
    expect(normalizeRailActive('calendar')).toBe('publish-packs')
  })

  it('source keeps six brief fields, rename/folder save, closed details, default undeletable', () => {
    const src = readFileSync(srcPath, 'utf8')
    const start = src.indexOf(") : appPage === 'companies' ? (")
    const end = src.indexOf(") : appPage === 'publish-packs' ? (", start)
    const archive = src.slice(start, end)
    for (const field of BRIEF_FIELDS) {
      expect(src).toContain(`key: '${field.key}', label: '${field.label}', placeholder: '${field.placeholder}'`)
    }
    expect(src).toContain("rows: 3")
    expect(archive).toContain("maxLength={field.key === 'sample' ? 800 : 400}")
    expect(archive).toContain("maxLength={field.key === 'identity' || field.key === 'tone' ? 80 : field.key === 'audience' || field.key === 'avoid' ? 200 : 400}")
    expect(archive).toContain("action: 'rename'")
    expect(archive).toContain("action: 'folder'")
    expect(archive).toContain('<details className={css.spaceBriefFolder}>')
    expect(archive).not.toContain('<details open')
    expect(archive).toContain('剪映目录（选填）')
    expect(archive).toContain('剪映目录（已填）')
    expect(archive).toContain('剪映草稿目录，可先留空')
    expect(archive).toContain('spaceId !== DEFAULT_DIGITAL_HUMAN_SPACE_ID')
    expect(archive).toContain('形象、音色、生图和任务记录都会从这台电脑拿走，默认空间不受影响。')
    expect(archive).toContain('css.deskPrimary')
    expect(archive).not.toContain('variant="compact"')
    expect(archive).not.toContain('DigitalHumanPlatformAccounts')
    expect(archive).not.toContain('onManageAccounts')
    expect(archive).not.toContain('这家最近成片')
    expect(archive).not.toContain('homeRecentList')
    expect(archive).not.toContain('准备发布')
    expect(src).toContain('defaultRecordRail(appPage, companyOpen)')
    expect(readFileSync(railStatePath, 'utf8')).toContain('这家还没有成片。')
    expect(src).toContain('buildTaskRailItems(recent.slice(0, 8))')

    const rail = src.slice(src.indexOf('const renderCompanyActions'), src.indexOf('const withCompanyRail'))
    expect(rail).toContain('COMPANY_DESK_TABS.map')
    expect(rail).not.toContain('COMPANY_ACTIONS.map')
    expect(rail).toContain("openCompanyCreate(id, 'xdh-avatar-video')")
    expect(rail).toContain('selectCompany(id)')
    expect(rail).toContain("setAppPage('publish-packs')")
  })

  it('does not change home, list card DOM, hero, or publish/collection markers', () => {
    const src = readFileSync(srcPath, 'utf8')
    const list = src.slice(src.indexOf("appPage === 'companies' && !companyOpen"), src.indexOf(") : appPage === 'companies' ? ("))
    expect(list).toContain('COMPANY_LIST_ACTIONS.map')
    expect(list).toContain('点一家进去做事')
    expect(src).toContain('今天先补档案或做一条')
    expect(src).toContain('continueCurrentCompany')
    expect(src).toContain('const HERO')
    expect(src).not.toContain("appPage === 'publish' ?")
    expect(src).toContain("appPage === 'publish-packs' ? (")
    expect(src).toContain("appPage === 'video-download'")
    expect(src).toContain('DigitalHumanPublishPacks')
    expect(src).toContain('DigitalHumanVideoDownload')
  })
})
