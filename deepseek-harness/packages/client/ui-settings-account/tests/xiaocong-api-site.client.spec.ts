import { describe, expect, it } from 'vitest'
import {
  DEFAULT_XIAOCONG_API_ORIGIN,
  xiaocongApiAccountHref,
  xiaocongApiOrigin,
  xiaocongApiSiteLinks,
} from '../src/client/xiaocong-api-site.ts'

describe('xiaocong API site links', () => {
  it('maps settings actions to XiaocongAPI console pages', () => {
    expect(xiaocongApiSiteLinks()).toEqual({
      usageUrl: `${DEFAULT_XIAOCONG_API_ORIGIN}/usage-logs/common`,
      topUpUrl: `${DEFAULT_XIAOCONG_API_ORIGIN}/wallet`,
    })
    expect(xiaocongApiAccountHref()).toBe(`${DEFAULT_XIAOCONG_API_ORIGIN}/profile`)
    expect(xiaocongApiAccountHref('http://127.0.0.1:3000/console/log')).toBe('http://127.0.0.1:3000/profile')
  })

  it('rewrites DeepSeek Platform URLs onto the XiaocongAPI console', () => {
    expect(xiaocongApiOrigin('https://platform.deepseek.com/usage')).toBe(DEFAULT_XIAOCONG_API_ORIGIN)
    expect(xiaocongApiAccountHref('https://platform.deepseek.com/usage')).toBe(`${DEFAULT_XIAOCONG_API_ORIGIN}/profile`)
    expect(xiaocongApiSiteLinks('https://platform.deepseek.com/top_up')).toEqual({
      usageUrl: `${DEFAULT_XIAOCONG_API_ORIGIN}/usage-logs/common`,
      topUpUrl: `${DEFAULT_XIAOCONG_API_ORIGIN}/wallet`,
    })
  })

  it('keeps a non-DeepSeek origin and still uses console paths', () => {
    expect(xiaocongApiAccountHref('http://localhost:8081/usage')).toBe('http://localhost:8081/profile')
    expect(xiaocongApiSiteLinks('http://localhost:8081/usage')).toEqual({
      usageUrl: 'http://localhost:8081/usage-logs/common',
      topUpUrl: 'http://localhost:8081/wallet',
    })
  })

  it('rejects credentialed origins', () => {
    expect(xiaocongApiOrigin('http://user:pass@127.0.0.1:3000')).toBe(DEFAULT_XIAOCONG_API_ORIGIN)
    expect(xiaocongApiOrigin('ftp://127.0.0.1:3000')).toBe(DEFAULT_XIAOCONG_API_ORIGIN)
  })
})
