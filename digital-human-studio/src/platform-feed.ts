import { getPublishStudio } from './publish-studio-bridge.js'

/**
 * 写文案时要知道「这家公司能发到哪些平台」——不靠人手填，靠账号页里已授权的账号。
 * 账号列表由 UI / 各接口顺路喂进来，这里只做一层记忆，避免每轮都去取。
 */
const PLATFORM_NAMES: Record<string, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  tencent: '视频号',
  kuaishou: '快手',
  bilibili: 'B站',
  weibo: '微博',
  xigua: '西瓜视频',
  toutiao: '今日头条',
  tiktok: 'TikTok',
  youtube: 'YouTube',
}

const cache = new Map<string, string[]>()

/** 从 accounts.list 的返回里记住「已授权」的平台，去重后按中文名存。 */
export function rememberPlatforms(space: string, items: unknown): void {
  const rows = Array.isArray(items) ? items : []
  const names = new Set<string>()
  for (const row of rows) {
    const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    if (String(record.status || '') !== 'authorized') continue
    const id = String(record.platform || '').trim()
    if (!id) continue
    names.add(PLATFORM_NAMES[id] || id)
  }
  cache.set(space, [...names])
}

export function platformsFor(space: string): string[] {
  return cache.get(space) || []
}

/** 尽力刷新一次；发布插件没启用或还没账号时保持上次结果。 */
export async function refreshPlatforms(space: string): Promise<void> {
  const studio = getPublishStudio()
  if (!studio) return
  try {
    const result = await studio.action(space, 'ui', { action: 'accounts.list' })
    rememberPlatforms(space, (result as { items?: unknown } | undefined)?.items)
  } catch {
    /* 账号暂时取不到，不影响写稿 */
  }
}

/** 拼给模型看的平台与时长约束。平台来自已授权账号，时长为各平台常见档位。 */
export function platformPromptLines(platforms: string[]): string[] {
  const list = platforms.filter(Boolean)
  const head = list.length
    ? `已授权平台：${list.join('、')}。口播就按这些平台写；没授权的平台不要提。`
    : '这家公司还没授权任何发布账号：先按抖音竖屏口播写；要发别的平台，让用户到「账号」里授权，不要自己假设平台。'
  return [
    head,
    '默认时长：抖音 30–45 秒、视频号 60–90 秒、快手 40–60 秒；小红书按图文 300–400 字写。用户这一轮说了时长或字数，就以这一轮为准。',
  ]
}
