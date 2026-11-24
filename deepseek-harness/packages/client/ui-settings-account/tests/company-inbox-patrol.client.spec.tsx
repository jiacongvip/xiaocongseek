// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PATROL_LEAD, PATROL_SCHEDULE_OFF, PATROL_TITLE, PATROL_VERIFY, patrolChannelStatusLabel, patrolConnected, patrolHistoryLabel, patrolPlatformSummary, patrolStatusText } from '../src/client/DigitalHumanInboxPatrolState.ts'

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

const account = {
  id: 'a1', platform: 'douyin', label: '抖音A', revision: 1, enabled: true,
  status: 'authorized', hasCredentialFile: true, updatedAt: 1,
}

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: async () => data }) as Promise<Response>
}

describe('inbox patrol helpers', () => {
  it('does not treat a disconnected policy as ready, and never claims a failed read as success', () => {
    expect(patrolConnected({ policy: { enabled: false, intervalMinutes: 30 }, capabilities: [], history: [], drafts: [], connected: false })).toBe(false)
    expect(patrolConnected({ policy: { enabled: false, intervalMinutes: 30 }, capabilities: [], history: [], drafts: [], connected: true })).toBe(true)
    expect(patrolStatusText({ status: 'not_configured', claimedRead: false, reason: '尚未接入' })).toBe('尚未接入')
    expect(patrolStatusText({ status: 'pending_verification', claimedRead: false, reason: '待实页验证' })).toBe('待实页验证')
    expect(patrolChannelStatusLabel('pending_verification')).toBe('待验证')
    expect(patrolChannelStatusLabel('ready')).toBe('可巡查')
    expect(patrolChannelStatusLabel('not_configured')).toBe('还不能巡查')
    expect(patrolChannelStatusLabel('selector_mismatch')).toBe('页面结构对不上')
    expect(patrolPlatformSummary({ platform: 'douyin', messages: 'pending_verification', comments: 'pending_verification' })).toBe('抖音：私信待验证；评论待验证')
    expect(patrolPlatformSummary({ platform: 'xiaohongshu', messages: 'pending_verification', comments: 'not_configured' })).toBe('小红书：私信待验证；评论还不能巡查')
    expect(patrolHistoryLabel({ channel: 'comments', visibleText: '夹具评论用户甲：你好' })).toBe('评论 · 夹具评论用户甲：你好')
    expect(patrolHistoryLabel({ channel: 'messages', visibleText: '夹具用户乙：想了解套餐' })).toBe('私信 · 夹具用户乙：想了解套餐')
    expect(patrolStatusText({ status: 'ok', claimedRead: true, reason: '已收录' })).toBe('已收录')
    expect(patrolStatusText({ status: 'need_page', claimedRead: false, reason: '' })).toMatch(/没有当作已读/)
  })
})

describe('compact patrol section stays pending verification and does not claim ready', () => {
  const calls: Record<string, unknown>[] = []
  let runStatus = { success: true, spaceId: 'co-a', claimedRead: false, status: 'pending_verification', reason: '已按授权上游映射官方网页私信列表，状态为待页面验证。本轮不打开真实浏览器，不读取真实私信，也不发送。', items: [], lastRun: { status: 'pending_verification', claimedRead: false, reason: '已按授权上游映射官方网页私信列表，状态为待页面验证。本轮不打开真实浏览器，不读取真实私信，也不发送。', added: 0 } }

  beforeEach(() => {
    calls.length = 0
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      calls.push({ url, ...body })
      if (body.action === 'studio.accounts.platforms') {
        return json({ success: true, spaceId: body.space, items: [{ key: 'douyin', method: 'qr', loginUrlHost: 'creator.douyin.com', hasPersonalUrl: true, supportsQrProbe: true, note: '' }] })
      }
      if (body.action === 'studio.runtime.deps') {
        return json({ success: true, spaceId: body.space, deps: { ready: true } })
      }
      if (body.action === 'studio.accounts.list') {
        return json({ success: true, spaceId: body.space, items: body.space === 'co-a' ? [account] : [] })
      }
      if (body.action === 'studio.accounts.patrol.get' || body.action === 'studio.accounts.patrol.history') {
        return json({
          success: true,
          spaceId: body.space,
          connected: false,
          policy: { enabled: false, intervalMinutes: 30 },
          capabilities: [
            { platform: 'douyin', messages: 'pending_verification', comments: 'pending_verification', inboxPage: 'https://www.douyin.com/message', commentsPage: 'https://creator.douyin.com/creator-micro/interactive/comment', knownOfficialPages: [{ kind: 'home', url: 'https://creator.douyin.com/creator-micro/home', source: 'login-platforms.json' }, { kind: 'inbox-messages', url: 'https://www.douyin.com/message', source: 'BiliGo' }, { kind: 'inbox-comments', url: 'https://creator.douyin.com/creator-micro/interactive/comment', source: 'MediaMate MIT' }], missing: ['私信列表选择器已映射，仍待实际页面走查', '评论列表选择器已映射，仍待实际页面走查'], note: '已适配，待实页验证' },
            { platform: 'xiaohongshu', messages: 'pending_verification', comments: 'not_configured', inboxPage: 'https://www.xiaohongshu.com/chat', commentsPage: 'https://www.xiaohongshu.com/notification?type=comment', knownOfficialPages: [{ kind: 'home', url: 'https://creator.xiaohongshu.com/new/home', source: 'login-platforms.json' }, { kind: 'inbox-comments', url: 'https://www.xiaohongshu.com/notification?type=comment', source: 'official URL' }], missing: ['小红书通知页地址和分区标签已知，但通知列表条目选择器没有取得可独立编写的许可证据'], note: '通知评论列表还缺列表结构证据，不能当作已接入' },
          ],
          history: [],
          drafts: [],
          accounts: body.space === 'co-a' ? [{ id: 'a1', platform: 'douyin', label: '抖音A', status: 'authorized' }] : [],
          lastRun: runStatus.lastRun,
          note: '个人号页面巡查默认关闭。',
        })
      }
      if (body.action === 'studio.accounts.patrol.run') {
        return json({ ...runStatus, spaceId: body.space })
      }
      if (body.action === 'studio.accounts.patrol.verify_page') {
        return json({ success: true, spaceId: body.space, verificationRecorded: false, liveSamplingEnabled: false, verifyEntry: true, reason: '只读核对入口可用。本环境未做实页采样，不会记为已验证。', results: [] })
      }
      if (body.action === 'studio.accounts.patrol.stop') {
        return json({ success: true, spaceId: body.space, exitRequested: true, note: '已请求停止巡查，不会删除历史或账号。' })
      }
      return json({ success: true, spaceId: body.space })
    }))
  })

  it('patrol UI is currently toggled off, so the compact bind only shows accounts', async () => {
    render(<DigitalHumanPlatformAccounts variant="compact" spaceId="co-a" companyName="甲公司" primaryClassName="pri" ghostClassName="gh" />)
    await waitFor(() => expect(screen.getByRole('region', { name: '绑定账号' })).toBeTruthy())
    // SHOW_INBOX_PATROL = false：选择器还没在真实网页核验通过，不渲染巡查区。
    expect(screen.queryByRole('region', { name: PATROL_TITLE })).toBeNull()
    expect(screen.queryByText(PATROL_LEAD)).toBeNull()
    expect(screen.queryByRole('button', { name: PATROL_VERIFY })).toBeNull()
    // 巡查代码仍在（改回 true 即可恢复），本次不误判为「已可读」。
    expect(screen.queryByText(/已从可见页面文本收录。/)).toBeNull()
    expect(screen.queryByText(/私信已验证/)).toBeNull()
  })
})
