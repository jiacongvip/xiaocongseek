// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RecordRailProvider,
  defaultRecordRail,
  useRecordRail,
  useRecordRailViewRef,
  useRegisteredRecordRail,
  type RecordRailModel,
} from '../src/client/DigitalHumanRecordRailState.tsx'

afterEach(() => cleanup())

function RailChild({ model }: { model: RecordRailModel | null }) {
  useRecordRail(model)
  return <div data-testid="page">{model?.title || 'none'}</div>
}

function TestResolvedRail({
  owned = null,
  visible = true,
  appPage,
  companyOpen = false,
}: {
  owned?: RecordRailModel | null
  visible?: boolean
  appPage: string
  companyOpen?: boolean
}) {
  const registered = useRegisteredRecordRail()
  const viewRef = useRecordRailViewRef()
  if (!visible) return null
  const fallback = defaultRecordRail(appPage, companyOpen)
  const model = owned || registered || (fallback ? { ...fallback, items: [] } : null)
  if (!model) return null
  const live = () => viewRef?.current || model
  return (
    <aside aria-label={model.title}>
      <div>{model.title}</div>
      {model.items.length === 0 ? <div>{model.empty}</div> : model.items.map(item => (
        <article key={item.id} className={item.selected ? 'taskRailRowOn' : ''}>
          <button type="button" disabled={!item.onClick} onClick={() => live().items.find(row => row.id === item.id)?.onClick?.()}>
            {item.title}
          </button>
        </article>
      ))}
    </aside>
  )
}

function Shell({
  resetKey,
  owned = null,
  visible = true,
  appPage,
  companyOpen = false,
  child = null,
}: {
  resetKey: string
  owned?: RecordRailModel | null
  visible?: boolean
  appPage: string
  companyOpen?: boolean
  child?: ReactNode
}) {
  return (
    <RecordRailProvider resetKey={resetKey}>
      <div>
        {child}
        <TestResolvedRail owned={owned} visible={visible} appPage={appPage} companyOpen={companyOpen} />
      </div>
    </RecordRailProvider>
  )
}

const packA: RecordRailModel = {
  title: '发布包',
  empty: '还没有发布包',
  items: [{ id: 'p1', title: '旧包', meta: '草稿', onClick: () => undefined }],
}

const packB: RecordRailModel = {
  title: '发布包',
  empty: '还没有发布包',
  items: [{ id: 'p2', title: '新包', meta: '已发布', selected: true, onClick: () => undefined }],
}

const calendarEmpty: RecordRailModel = {
  title: '这天排期',
  empty: '这一天没有排期',
  items: [],
}

describe('RecordRail DOM registry', () => {
  it('registers, updates, and cleans up rail items', () => {
    const { rerender } = render(
      <Shell resetKey="publish-packs:c1" appPage="publish-packs" child={<RailChild model={packA} />} />,
    )
    expect(screen.getByRole('complementary', { name: '发布包' })).toBeTruthy()
    expect(screen.getByText('旧包')).toBeTruthy()
    expect(screen.queryByText('新包')).toBeNull()

    rerender(<Shell resetKey="publish-packs:c1" appPage="publish-packs" child={<RailChild model={packB} />} />)
    expect(screen.getByText('新包')).toBeTruthy()
    expect(screen.queryByText('旧包')).toBeNull()
    const selected = screen.getByText('新包').closest('article')
    expect(selected?.className).toMatch(/taskRailRowOn/)

    rerender(<Shell resetKey="publish-packs:c1" appPage="publish-packs" child={<RailChild model={null} />} />)
    expect(screen.getByText('还没有发布包')).toBeTruthy()
    expect(screen.queryByText('新包')).toBeNull()
  })

  it('drops stale rows when the page+space resetKey changes', () => {
    const { rerender } = render(
      <Shell resetKey="publish-packs:c1" appPage="publish-packs" child={<RailChild model={packA} />} />,
    )
    expect(screen.getByText('旧包')).toBeTruthy()

    rerender(
      <Shell resetKey="calendar:c2" appPage="calendar" child={<RailChild model={calendarEmpty} />} />,
    )
    expect(screen.queryByText('旧包')).toBeNull()
    expect(screen.getByRole('complementary', { name: '这天排期' })).toBeTruthy()
    expect(screen.getByText('这一天没有排期')).toBeTruthy()
    expect(document.querySelectorAll('aside')).toHaveLength(1)
  })

  it('clicks the latest callback even when the signature is unchanged', () => {
    const hits: number[] = []
    function ClickPage({ n }: { n: number }) {
      useRecordRail({
        title: '发布包',
        empty: '还没有发布包',
        items: [{ id: 'p1', title: '点我', onClick: () => hits.push(n) }],
      })
      return <div>n={n}</div>
    }
    const { rerender } = render(<Shell resetKey="publish-packs:c1" appPage="publish-packs" child={<ClickPage n={1} />} />)
    fireEvent.click(screen.getByRole('button', { name: /点我/ }))
    expect(hits).toEqual([1])
    rerender(<Shell resetKey="publish-packs:c1" appPage="publish-packs" child={<ClickPage n={2} />} />)
    fireEvent.click(screen.getByRole('button', { name: /点我/ }))
    expect(hits).toEqual([1, 2])
  })

  it('does not loop when a child publishes a new model object every render', () => {
    const ticks = { n: 0 }
    function LoopChild() {
      ticks.n += 1
      if (ticks.n > 25) throw new Error('infinite render')
      useRecordRail({
        title: '任务',
        empty: '还没有任务。',
        items: [{ id: '1', title: 'A', onClick: () => undefined }],
      })
      return <span data-testid="ticks">{ticks.n}</span>
    }
    render(<Shell resetKey="create:c1" appPage="create" child={<LoopChild />} />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(ticks.n).toBeGreaterThan(0)
    expect(ticks.n).toBeLessThan(8)
  })

  it('keeps a single aside when switching registered child pages', () => {
    function Switcher() {
      const [page, setPage] = useState<'publish-packs' | 'calendar' | 'platform-accounts'>('publish-packs')
      const models: Record<string, RecordRailModel> = {
        'publish-packs': packA,
        calendar: calendarEmpty,
        'platform-accounts': { title: '账号', empty: '还没有账号', items: [{ id: 'a1', title: '店账号', onClick: () => undefined }] },
      }
      return (
        <RecordRailProvider resetKey={`${page}:c1`}>
          <RailChild model={models[page]} />
          <TestResolvedRail owned={null} visible appPage={page} companyOpen={false} />
          <button type="button" onClick={() => setPage('calendar')}>去日历</button>
          <button type="button" onClick={() => setPage('platform-accounts')}>去账号</button>
        </RecordRailProvider>
      )
    }
    render(<Switcher />)
    expect(document.querySelectorAll('aside')).toHaveLength(1)
    expect(screen.getByText('旧包')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '去日历' }))
    expect(document.querySelectorAll('aside')).toHaveLength(1)
    expect(screen.queryByText('旧包')).toBeNull()
    expect(screen.getByText('这一天没有排期')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '去账号' }))
    expect(document.querySelectorAll('aside')).toHaveLength(1)
    expect(screen.getByText('店账号')).toBeTruthy()
  })
})
