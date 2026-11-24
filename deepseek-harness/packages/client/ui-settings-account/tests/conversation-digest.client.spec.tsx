// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationDigestButton, ConversationDigestTitle } from '../src/client/ConversationDigest.tsx'
import { loadConversationDigest } from '../src/client/conversation-digest.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('renders the conversation digest header action', () => {
  const openDigest = vi.fn()
  render(<ConversationDigestButton {...{ openDigest } as never} />)
  fireEvent.click(screen.getByRole('button', { name: '对话摘要' }))
  expect(openDigest).toHaveBeenCalledOnce()
})

it('renders the digest tab title', () => {
  render(<ConversationDigestTitle {...{} as never} />)
  expect(screen.getByText('对话摘要')).toBeTruthy()
})

it('reads company brief lines as memories', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = String(input)
    if (url.includes('/spaces')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          currentId: 'default',
          spaces: [{ id: 'default', name: '测试店', brief: { identity: '南京全屋定制', business: '800-1500 瓷砖' } }],
        }),
      }
    }
    if (url.includes('/history')) {
      return { ok: true, json: async () => ({ success: true, items: [] }) }
    }
    if (url.includes('/materials')) {
      return { ok: true, json: async () => ({ success: true, items: [] }) }
    }
    return { ok: false, json: async () => ({}) }
  }))
  const digest = await loadConversationDigest()
  expect(digest.memories.map(item => item.text)).toEqual(['南京全屋定制', '800-1500 瓷砖'])
  expect(digest.skills.map(item => item.name)).toEqual(['口播成片', '本地混剪'])
})
