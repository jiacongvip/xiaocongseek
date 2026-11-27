import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** Mirrors DigitalHumanPanel company-list helpers (keep in sync). */
const COMPANY_LIST_ACTIONS = [
  { id: 'archive', label: '档案' },
  { id: 'materials', label: '素材' },
  { id: 'create', label: '创作' },
  { id: 'works', label: '成片' },
  { id: 'publish-packs', label: '发布' },
] as const

const COMPANY_ACTIONS = [
  { id: 'archive', label: '档案' },
  { id: 'materials', label: '素材' },
  { id: 'video', label: '数字人' },
  { id: 'audio', label: '音频' },
  { id: 'image', label: '图片' },
  { id: 'works', label: '成片' },
  { id: 'calendar', label: '发布日历' },
  { id: 'publish-packs', label: '发布包' },
  { id: 'platform-accounts', label: '平台账号' },
] as const

function companyListEmptyMessage(totalCompanies: number): string {
  return totalCompanies === 0 ? '还没有公司，点右上角新建' : '没有匹配的公司'
}

function companyListStatusLine(filled: boolean, monthCount: number): string {
  return `${filled ? '已填档案' : '未填档案'} · 本月 ${monthCount} 条`
}

function shouldShowCurrentMark(rowId: string, currentId: string): boolean {
  return rowId === currentId
}

function listActionHandler(action: (typeof COMPANY_LIST_ACTIONS)[number]['id']): 'archive' | 'materials' | 'create-avatar' | 'works' | 'select-then-publish-packs' {
  if (action === 'archive') return 'archive'
  if (action === 'materials') return 'materials'
  if (action === 'create') return 'create-avatar'
  if (action === 'works') return 'works'
  return 'select-then-publish-packs'
}

const srcPath = join(dirname(fileURLToPath(import.meta.url)), '../src/client/DigitalHumanPanel.tsx')

describe('company list actions / source scope', () => {
  it('list has five shortcuts; rail keeps nine', () => {
    expect(COMPANY_LIST_ACTIONS.map(item => item.label)).toEqual(['档案', '素材', '创作', '成片', '发布'])
    expect(COMPANY_ACTIONS).toHaveLength(9)
    expect(COMPANY_ACTIONS.map(item => item.label)).toEqual([
      '档案', '素材', '数字人', '音频', '图片', '成片', '发布日历', '发布包', '平台账号',
    ])
  })

  it('empty copy, status line, current mark, and action order', () => {
    expect(companyListEmptyMessage(0)).toBe('还没有公司，点右上角新建')
    expect(companyListEmptyMessage(3)).toBe('没有匹配的公司')
    expect(companyListStatusLine(false, 0)).toBe('未填档案 · 本月 0 条')
    expect(companyListStatusLine(true, 3)).toBe('已填档案 · 本月 3 条')
    expect(shouldShowCurrentMark('co-a', 'co-a')).toBe(true)
    expect(shouldShowCurrentMark('co-b', 'co-a')).toBe(false)
    expect(listActionHandler('archive')).toBe('archive')
    expect(listActionHandler('create')).toBe('create-avatar')
    expect(listActionHandler('publish-packs')).toBe('select-then-publish-packs')
  })

  it('source: list block drops path/9-actions; rail and home stay', () => {
    const src = readFileSync(srcPath, 'utf8')
    const start = src.indexOf("appPage === 'companies' && !companyOpen")
    const end = src.indexOf("appPage === 'companies' ?", start + 1)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const list = src.slice(start, end)
    expect(list).toContain('COMPANY_LIST_ACTIONS.map')
    expect(list).not.toContain('COMPANY_ACTIONS.map')
    expect(list).not.toContain('folderLabel')
    expect(list).not.toContain('剪映草稿目录')
    expect(list).toContain("openCompanyCreate(id, 'xdh-avatar-video')")
    expect(list).toContain("setAppPage('publish-packs')")
    expect(list).toContain('selectCompany(id)')
    expect(list).toContain('companyListEmptyMessage')
    expect(list).toContain('点一家进去做事')
    expect(list).toContain("setSpaceMenu('create')")

    const rail = src.slice(src.indexOf('const renderCompanyActions'), src.indexOf('const withCompanyRail'))
    expect(rail).toContain('COMPANY_DESK_TABS.map')
    expect(rail).not.toContain('COMPANY_ACTIONS.map')
    expect(rail).toContain("openCompanyCreate(id, 'xdh-avatar-video')")
    expect(src).toContain('withCompanyRail')
    expect(src).toContain('今天先补档案或做一条')
    expect(src).toContain('continueCurrentCompany')
    expect(src).toContain('firstVideoEmptyMessage')
    expect(src).toContain("const goCreate = useCallback(() => {\n    setAppPage('create')\n    setWorkspace('create')\n    setSpaceMenu('closed')\n    setCompanyOpen(false)\n  }, [])")
  })
})
