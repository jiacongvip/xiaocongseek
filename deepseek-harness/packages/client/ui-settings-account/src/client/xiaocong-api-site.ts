/** XiaocongAPI console origin used by settings account links. */
export const DEFAULT_XIAOCONG_API_ORIGIN = 'https://xiaocongapi.azheteng.cn'

export type XiaocongApiSiteLinks = {
  usageUrl: string
  topUpUrl: string
}

function isDeepSeekHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'deepseek.com' || host.endsWith('.deepseek.com')
}

/** Origin of the XiaocongAPI site; never includes credentials or DeepSeek Platform. */
export function xiaocongApiOrigin(baseUrl?: string | null): string {
  const raw = String(baseUrl || DEFAULT_XIAOCONG_API_ORIGIN).trim()
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_XIAOCONG_API_ORIGIN
    if (url.username || url.password) return DEFAULT_XIAOCONG_API_ORIGIN
    if (isDeepSeekHost(url.hostname)) return DEFAULT_XIAOCONG_API_ORIGIN
    return url.origin
  } catch {
    return DEFAULT_XIAOCONG_API_ORIGIN
  }
}

/** Settings destinations on the XiaocongAPI console. */
export function xiaocongApiSiteLinks(baseUrl?: string | null): XiaocongApiSiteLinks {
  const origin = xiaocongApiOrigin(baseUrl)
  return {
    usageUrl: `${origin}/usage-logs/common`,
    topUpUrl: `${origin}/wallet`,
  }
}

/** 「更多账号信息」always opens XiaocongAPI /profile. */
export function xiaocongApiAccountHref(baseUrl?: string | null): string {
  return `${xiaocongApiOrigin(baseUrl)}/profile`
}
