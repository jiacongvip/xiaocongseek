// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountBindSummary, shouldApplyAccountResult, ACCOUNT_BIND_EMPTY } from '../src/client/DigitalHumanPlatformAccountsState.ts'

vi.mock('../src/client/DigitalHumanPanel.module.css', () => {
  const classes = new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : 'css') })
  return { default: classes, __esModule: true }
})
vi.mock('../src/client/DigitalHumanPlatformAccounts.module.css', () => {
  const classes = new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : 'css') })
  return { default: classes, __esModule: true }
})
vi.mock('../src/client/DigitalHumanRecordRail.tsx', () => ({ useRecordRail: () => {} }))

import { DigitalHumanPlatformAccounts } from '../src/client/DigitalHumanPlatformAccounts.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const accountA = {
  id: 'a1', platform: 'douyin', label: '抖音A', revision: 1, enabled: true,
  status: 'authorized', hasCredentialFile: true, updatedAt: 1,
}
const accountB = {
  id: 'b1', platform: 'xiaohongshu', label: '小红书B', revision: 1, enabled: true,
  status: 'unconfigured', hasCredentialFile: false, updatedAt: 1,
}

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: async () => data }) as Promise<Response>
}

describe('account bind helpers', () => {
  it('summarizes only a compact page of bound accounts with Chinese platform and status', () => {
    const many = [accountA, accountB, ...Array.from({ length: 5 }, (_, i) => ({ ...accountA, id: `x${i}`, label: `号${i}` }))]
    const summary = accountBindSummary(many, 5)
    expect(summary.total).toBe(7)
    expect(summary.items).toHaveLength(5)
    expect(summary.hidden).toBe(2)
    expect(summary.items[0]).toMatchObject({ title: '抖音A', platform: '抖音', status: '已授权', statusTone: 'ok' })
    expect(summary.items[1]).toMatchObject({ title: '小红书B', platform: '小红书', status: '未登录' })
    expect(accountBindSummary([]).empty).toBe(true)
    expect(ACCOUNT_BIND_EMPTY).toBe('还没有为这家企业添加账号。')
  })

  it('applies results only for the live current company, not a late sibling response', () => {
    expect(shouldApplyAccountResult({ requestSpaceId: 'co-a', currentSpaceId: 'co-a', live: true })).toBe(true)
    expect(shouldApplyAccountResult({ requestSpaceId: 'co-a', currentSpaceId: 'co-b', live: true })).toBe(false)
    expect(shouldApplyAccountResult({ requestSpaceId: 'co-a', currentSpaceId: 'co-a', live: false })).toBe(false)
    expect(shouldApplyAccountResult({ requestSpaceId: '', currentSpaceId: 'co-a', live: true })).toBe(false)
  })
})

describe('archive compact account bind', () => {
  const calls: Record<string, unknown>[] = []
  let holdAList: ((value: Promise<Response>) => void) | null = null
  let holdA = false
  const db: Record<string, typeof accountA[]> = { 'co-a': [accountA], 'co-b': [accountB] }

  beforeEach(() => {
    calls.length = 0
    holdAList = null
    holdA = false
    db['co-a'] = [accountA]
    db['co-b'] = [accountB]
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      calls.push({ url, ...body })
      if (body.action === 'studio.accounts.platforms') {
        return json({ success: true, spaceId: body.space, items: [{ key: 'douyin', method: 'qr', loginUrlHost: 'example.com', hasPersonalUrl: false, supportsQrProbe: true, note: '' }] })
      }
      if (body.action === 'studio.runtime.deps') {
        return json({ success: true, spaceId: body.space, deps: { ready: true } })
      }
      if (String(body.action || '').startsWith('studio.accounts.patrol')) {
        return json({
          success: true,
          spaceId: body.space,
          claimedRead: false,
          status: 'not_configured',
          connected: false,
          policy: { enabled: false, intervalMinutes: 30 },
          capabilities: [
            { platform: 'douyin', messages: 'not_configured', comments: 'not_configured', knownOfficialPages: [{ kind: 'home', url: 'https://creator.douyin.com/creator-micro/home', source: 'login-platforms.json' }], missing: ['请提供私信页官方网址'], note: '未接入' },
            { platform: 'xiaohongshu', messages: 'not_configured', comments: 'not_configured', knownOfficialPages: [{ kind: 'home', url: 'https://creator.xiaohongshu.com/new/home', source: 'login-platforms.json' }], missing: ['请提供评论页官方网址'], note: '未接入' },
          ],
          history: [],
          drafts: [],
          accounts: (db[body.space] || []).map((row) => ({ id: row.id, platform: row.platform, label: row.label, status: row.status })),
          note: '个人号页面巡查默认关闭。未验证官方私信/评论页之前不会读取，也不会开启定时。',
        })
      }
      if (body.action === 'studio.accounts.list') {
        if (body.space === 'co-a' && holdA) {
          return new Promise((resolve) => { holdAList = resolve })
        }
        return json({ success: true, spaceId: body.space, items: db[body.space] || [] })
      }
      if (body.action === 'studio.accounts.create') {
        const item = { id: 'new-a', platform: body.platform, label: body.label, revision: 1, enabled: true, status: 'unconfigured', hasCredentialFile: false, updatedAt: 2 }
        db[body.space] = [item, ...(db[body.space] || [])]
        return json({ success: true, spaceId: body.space, item })
      }
      return json({ success: false, error: `unexpected ${body.action}` })
    }))
  })

  function Harness({ spaceId = 'co-a', name = '瓷砖店A' }: { spaceId?: string; name?: string }) {
    const [id, setId] = useState(spaceId)
    const managed: string[] = (Harness as any).managed
    const companyName = id === 'co-b' ? '花店B' : name
    return (
      <div>
        <button type="button" onClick={() => setId('co-b')}>切到B</button>
        <DigitalHumanPlatformAccounts
          variant="compact"
          spaceId={id}
          companyName={companyName}
          onManageAccounts={() => managed.push(id)}
        />
      </div>
    )
  }

  it('lists this company\'s bound accounts and keeps manage/create on the current space', async () => {
    const managed: string[] = []
    ;(Harness as any).managed = managed
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('抖音A')).toBeTruthy())
    expect(screen.getByText('这些是「瓷砖店A」已经绑定的平台账号。')).toBeTruthy()
    expect(screen.getByText('抖音')).toBeTruthy()
    expect(screen.getByText('已授权')).toBeTruthy()
    expect(screen.queryByText('小红书B')).toBeNull()
    expect(calls.some((c) => c.action === 'studio.accounts.list' && c.space === 'co-a')).toBe(true)
    expect(calls.some((c) => c.space === 'co-b')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '管理这家账号' }))
    expect(managed).toEqual(['co-a'])

    fireEvent.click(screen.getByRole('button', { name: '添加账号' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '添加账号' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.some((c) => c.action === 'studio.accounts.create')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '添加账号' }))
    fireEvent.submit(screen.getByLabelText('添加平台账号'))
    await waitFor(() => expect(calls.some((c) => c.action === 'studio.accounts.create' && c.space === 'co-a' && c.platform === 'douyin')).toBe(true))
    expect(calls.filter((c) => c.action === 'studio.accounts.create').every((c) => c.space === 'co-a')).toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('ignores a late list from the previous company after switching space', async () => {
    const managed: string[] = []
    ;(Harness as any).managed = managed
    holdA = true
    render(<Harness />)
    expect(screen.queryByText('抖音A')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '切到B' }))
    await waitFor(() => expect(screen.getByText('小红书B')).toBeTruthy())
    expect(screen.getByText('这些是「花店B」已经绑定的平台账号。')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('抖音A')).toBeNull()

    await waitFor(() => expect(holdAList).toBeTruthy())
    holdA = false
    holdAList!(json({ success: true, spaceId: 'co-a', items: [accountA] }))
    await waitFor(() => expect(screen.getByText('小红书B')).toBeTruthy())
    expect(screen.queryByText('抖音A')).toBeNull()
    expect(screen.getByText('这些是「花店B」已经绑定的平台账号。')).toBeTruthy()
  })

  it('shows the empty prompt for a company with no bindings', async () => {
    db['co-a'] = []
    ;(Harness as any).managed = []
    render(<Harness />)
    await waitFor(() => expect(screen.getByText(ACCOUNT_BIND_EMPTY)).toBeTruthy())
    expect(screen.getByText('这些是「瓷砖店A」已经绑定的平台账号。')).toBeTruthy()
  })
})
