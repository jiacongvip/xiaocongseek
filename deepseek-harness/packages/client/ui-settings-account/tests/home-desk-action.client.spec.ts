import { describe, expect, it } from 'vitest'

/** Mirrors DigitalHumanPanel home desk pure rules (keep in sync). */
function shortCompanyLabel(name: string, max = 8): string {
  const value = String(name || '').trim()
  if (!value) return '当前公司'
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function missingArchiveRows(rows: { filled: boolean; id: string }[]) {
  return rows.filter(row => !row.filled).slice(0, 6)
}

function firstVideoRows(rows: { filled: boolean; monthCount: number; id: string }[]) {
  return rows.filter(row => row.filled && row.monthCount === 0).slice(0, 6)
}


function firstVideoEmptyMessage(hasMissingArchive: boolean): string {
  return hasMissingArchive ? '先补左边的档案，再做第一条' : '有档案的公司这个月都出过片了'
}


function continueTarget(briefFilled: boolean): 'archive' | 'create' {
  return briefFilled ? 'create' : 'archive'
}

function shouldSelectBeforeOpen(itemSpaceId: string, currentSpaceId: string): boolean {
  return !!itemSpaceId && itemSpaceId !== currentSpaceId
}

describe('home desk action rules', () => {
  it('shortens company label ~8 chars', () => {
    expect(shortCompanyLabel('短名')).toBe('短名')
    expect(shortCompanyLabel('一二三四五六七八九')).toBe('一二三四五六七八…')
    expect(shortCompanyLabel('')).toBe('当前公司')
  })

  it('missing / first-video lists from spaceStats fields only', () => {
    const rows = [
      { id: 'a', filled: false, monthCount: 0 },
      { id: 'b', filled: true, monthCount: 0 },
      { id: 'c', filled: true, monthCount: 2 },
      { id: 'd', filled: false, monthCount: 3 },
    ]
    expect(missingArchiveRows(rows).map(r => r.id)).toEqual(['a', 'd'])
    expect(firstVideoRows(rows).map(r => r.id)).toEqual(['b'])
  })

  it('继续 routes empty brief to archive else create', () => {
    expect(continueTarget(false)).toBe('archive')
    expect(continueTarget(true)).toBe('create')
  })

  it('recent row selects other company before open', () => {
    expect(shouldSelectBeforeOpen('co-b', 'co-a')).toBe(true)
    expect(shouldSelectBeforeOpen('co-a', 'co-a')).toBe(false)
  })

  it('first-video empty copy uses full missing list, not slice', () => {
    const allUnfilled = [
      { id: 'a', filled: false, monthCount: 0 },
      { id: 'b', filled: false, monthCount: 0 },
    ]
    expect(firstVideoRows(allUnfilled)).toEqual([])
    expect(firstVideoEmptyMessage(allUnfilled.some(row => !row.filled))).toBe('先补左边的档案，再做第一条')

    const allFilledDone = [
      { id: 'a', filled: true, monthCount: 1 },
      { id: 'b', filled: true, monthCount: 3 },
    ]
    expect(firstVideoRows(allFilledDone)).toEqual([])
    expect(firstVideoEmptyMessage(allFilledDone.some(row => !row.filled))).toBe('有档案的公司这个月都出过片了')

    const mixedHasFirst = [
      { id: 'a', filled: false, monthCount: 0 },
      { id: 'b', filled: true, monthCount: 0 },
      { id: 'c', filled: true, monthCount: 2 },
    ]
    expect(firstVideoRows(mixedHasFirst).map(r => r.id)).toEqual(['b'])
    // list is non-empty, empty copy is not shown
    expect(firstVideoRows(mixedHasFirst).length > 0).toBe(true)
  })
})
