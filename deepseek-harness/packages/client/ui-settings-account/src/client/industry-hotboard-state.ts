/** Pure copy/helpers for the industry hotboard desk. */

export const HOTBOARD_TITLE = '热榜'
export const HOTBOARD_SUBTITLE = '按这家公司的行业词，搜最近最热的样本。'
export const HOTBOARD_DISCLAIMER = '用的是已经接上的爬虫搜索。小红书默认按最热排。'
export const HOTBOARD_EMPTY = '还没有行业热榜。点刷新，按档案里的行业词搜一次。'
export const HOTBOARD_FALLBACK_HINT = '档案还没写主营，先按建材家装常用词搜。补档案后会更准。'
export const HOTBOARD_REFRESH = '刷新热榜'
export const HOTBOARD_REFRESHING = '刷新中…'

export function formatHotboardTime(at?: number): string {
  const n = Number(at || 0)
  if (!n) return ''
  const date = new Date(n)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function hotboardRailEmpty(): string {
  return '还没有行业热榜。'
}
