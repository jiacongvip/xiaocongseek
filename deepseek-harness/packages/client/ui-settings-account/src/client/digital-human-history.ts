// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
/** Shared local history for the workbench rail and the composer picker. */
export const DIGITAL_HUMAN_HISTORY_KEY = 'xdh.digital-human.recent'
export const DIGITAL_HUMAN_SPACE_KEY = 'xdh.digital-human.space'
export const DIGITAL_HUMAN_SPACE_SESSIONS_KEY = 'xdh.digital-human.space.sessions'
export const DEFAULT_DIGITAL_HUMAN_SPACE_ID = 'default'

export function digitalHumanHistoryKey(spaceId?: string): string {
  const id = String(spaceId || '').trim()
  if (!id || id === DEFAULT_DIGITAL_HUMAN_SPACE_ID) return DIGITAL_HUMAN_HISTORY_KEY
  return `${DIGITAL_HUMAN_HISTORY_KEY}.${id}`
}

export function loadDigitalHumanSpaceId(): string {
  try {
    return String(localStorage.getItem(DIGITAL_HUMAN_SPACE_KEY) || '').trim() || DEFAULT_DIGITAL_HUMAN_SPACE_ID
  } catch {
    return DEFAULT_DIGITAL_HUMAN_SPACE_ID
  }
}

function readSessionSpaceMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DIGITAL_HUMAN_SPACE_SESSIONS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [sessionId, spaceId] of Object.entries(parsed)) {
      const key = String(sessionId || '').trim()
      const id = String(spaceId || '').trim()
      if (key && id) out[key] = id
    }
    return out
  } catch {
    return {}
  }
}

export function loadSessionSpaceId(sessionId?: string): string | undefined {
  const key = String(sessionId || '').trim()
  if (!key) return undefined
  const id = readSessionSpaceMap()[key]
  return id || undefined
}

export function rememberSessionSpace(sessionId: string | undefined, spaceId: string) {
  const key = String(sessionId || '').trim()
  const id = String(spaceId || '').trim()
  if (!key || !id) return
  try {
    const map = readSessionSpaceMap()
    delete map[key]
    map[key] = id
    const keys = Object.keys(map)
    if (keys.length > 200) {
      for (const extra of keys.slice(0, keys.length - 200)) delete map[extra]
    }
    localStorage.setItem(DIGITAL_HUMAN_SPACE_SESSIONS_KEY, JSON.stringify(map))
  } catch {
    /* private windows */
  }
}

export type DigitalHumanWorkCopy = {
  title: string
  coverText: string
  coverPrompt: string
  body: string
  shots: { shot: string; visual: string; voice: string; seconds: number }[]
  model?: string
  at: number
  coverUrl?: string
  coverError?: string
  chat?: { role: 'user' | 'ai'; text: string; at: number }[]
}

export type DigitalHumanHistoryItem = {
  id: string
  kind: string
  title: string
  at: number
  status?: string
  progress?: string
  prompt?: string
  modelCode?: string
  coverUrl?: string
  mediaUrl?: string
  source?: string
  copy?: DigitalHumanWorkCopy
}

function asHistoryItem(value: unknown): DigitalHumanHistoryItem | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = String(row.id || '').trim()
  if (!id) return null
  return {
    id,
    kind: String(row.kind || ''),
    title: String(row.title || ''),
    at: Number(row.at) || Date.now(),
    status: row.status != null ? String(row.status) : undefined,
    progress: row.progress != null ? String(row.progress) : undefined,
    prompt: row.prompt != null ? String(row.prompt) : undefined,
    modelCode: row.modelCode != null ? String(row.modelCode) : undefined,
    coverUrl: row.coverUrl != null ? String(row.coverUrl) : undefined,
    mediaUrl: row.mediaUrl != null ? String(row.mediaUrl) : undefined,
    source: row.source != null ? String(row.source) : undefined,
    copy: row.copy && typeof row.copy === 'object' && typeof (row.copy as any).title === 'string'
      ? (row.copy as DigitalHumanWorkCopy)
      : undefined,
  }
}

/** Newest-first tasks saved by the digital-human workbench. */
export function loadDigitalHumanHistory(spaceId?: string): DigitalHumanHistoryItem[] {
  try {
    const raw = localStorage.getItem(digitalHumanHistoryKey(spaceId ?? loadDigitalHumanSpaceId()))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.map(asHistoryItem).filter((item): item is DigitalHumanHistoryItem => !!item).slice(0, 40)
      : []
  } catch {
    return []
  }
}

/** 用给定列表整体覆盖本地缓存（服务端列表是权威，删掉的条目要跟着消失）。 */
export function replaceDigitalHumanHistory(
  spaceId: string | undefined,
  items: DigitalHumanHistoryItem[],
  notify = false,
): DigitalHumanHistoryItem[] {
  const key = String(spaceId || '').trim() || loadDigitalHumanSpaceId()
  const map = new Map<string, DigitalHumanHistoryItem>()
  for (const item of items) {
    const next = asHistoryItem(item)
    if (next) map.set(next.id, next)
  }
  const next = [...map.values()].sort((left, right) => (right.at || 0) - (left.at || 0)).slice(0, 40)
  try {
    localStorage.setItem(digitalHumanHistoryKey(key), JSON.stringify(next))
    if (notify) window.dispatchEvent(new Event('xdh-digital-human-history'))
  } catch {
    /* private windows */
  }
  return next
}

export function mergeDigitalHumanHistory(
  spaceId: string | undefined,
  items: DigitalHumanHistoryItem[],
  notify = true,
): DigitalHumanHistoryItem[] {
  const key = String(spaceId || '').trim() || loadDigitalHumanSpaceId()
  const map = new Map<string, DigitalHumanHistoryItem>()
  for (const item of [...loadDigitalHumanHistory(key), ...items]) {
    const next = asHistoryItem(item)
    if (!next) continue
    const previous = map.get(next.id)
    map.set(next.id, previous ? { ...previous, ...next, id: next.id } : next)
  }
  const next = [...map.values()].sort((left, right) => (right.at || 0) - (left.at || 0)).slice(0, 40)
  try {
    localStorage.setItem(digitalHumanHistoryKey(key), JSON.stringify(next))
    if (notify) window.dispatchEvent(new Event('xdh-digital-human-history'))
  } catch {
    /* private windows */
  }
  return next
}

export function saveDigitalHumanHistoryItem(item: DigitalHumanHistoryItem, spaceId?: string) {
  const key = String(spaceId || '').trim() || loadDigitalHumanSpaceId()
  const next = mergeDigitalHumanHistory(key, [item], true)
  void fetch('/digital-human-studio/history', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'upsert', space: key, item: { ...item, source: item.source || 'chat' } }),
  }).catch(() => {})
  return next
}

export async function pullDigitalHumanHistory(spaceId?: string, notify = false): Promise<DigitalHumanHistoryItem[]> {
  const key = String(spaceId || '').trim() || loadDigitalHumanSpaceId()
  try {
    const response = await fetch(`/digital-human-studio/history?space=${encodeURIComponent(key)}`)
    const value = await response.json().catch(() => null) as { success?: boolean; items?: unknown } | null
    if (!response.ok || value?.success === false) return loadDigitalHumanHistory(key)
    const items = Array.isArray(value?.items)
      ? value.items.map(asHistoryItem).filter((item): item is DigitalHumanHistoryItem => !!item)
      : []
    // 服务端没列出来的本地记录：已经删掉的终态条目直接丢弃，只保留本地还在跑的任务。
    const serverIds = new Set(items.map(item => item.id))
    const localOnly = loadDigitalHumanHistory(key).filter(item => !serverIds.has(item.id) && isActiveStatusValue(item.status))
    return replaceDigitalHumanHistory(key, [...items, ...localOnly], notify)
  } catch {
    return loadDigitalHumanHistory(key)
  }
}

function isActiveStatusValue(status?: string): boolean {
  const value = String(status || '').trim().toUpperCase()
  return value === 'IN_PROGRESS' || value === 'PROCESSING' || value === 'RUNNING' || value === 'PENDING' || value === 'QUEUED' || value === 'WORKING' || value === 'WAITING'
}

export async function pullAllDigitalHumanHistory(notify = false): Promise<void> {
  try {
    const response = await fetch('/digital-human-studio/history?all=1')
    const value = await response.json().catch(() => null) as { spaces?: { spaceId?: string; items?: unknown }[] } | null
    if (!response.ok || !Array.isArray(value?.spaces)) return
    for (const row of value.spaces) {
      const id = String(row.spaceId || '').trim()
      if (!id) continue
      const items = Array.isArray(row.items)
        ? row.items.map(asHistoryItem).filter((item): item is DigitalHumanHistoryItem => !!item)
        : []
      mergeDigitalHumanHistory(id, items, false)
    }
    if (notify) window.dispatchEvent(new Event('xdh-digital-human-history'))
  } catch {
    /* host offline */
  }
}

export function digitalHumanKindLabel(kind: string): string {
  if (kind === 'xdh-avatar-video') return '数字人视频'
  if (kind === 'xdh-audio') return '语音合成'
  if (kind === 'xdh-image' || kind === 'ximg') return '图片生成'
  if (kind === 'xdh-avatar-clone') return '形象克隆'
  if (kind === 'xdh-voice-clone') return '声音克隆'
  return '数字人任务'
}

export function digitalHumanStatusLabel(status?: string): string {
  const value = String(status || '').trim().toUpperCase()
  if (value === 'SUCCESS' || value === 'SUCCEED' || value === 'SUCCEEDED' || value === 'COMPLETE' || value === 'COMPLETED' || value === 'DONE') return '已完成'
  if (value === 'FAILED' || value === 'FAIL' || value === 'ERROR' || value === 'FAILURE') return '失败'
  if (value === 'IN_PROGRESS' || value === 'PROCESSING' || value === 'RUNNING' || value === 'PENDING' || value === 'WORKING') return '生成中'
  if (value === 'QUEUED' || value === 'SUBMITTED' || value === 'NOT_START') return '排队中'
  return status || '等待中'
}

export function formatDigitalHumanTime(at: number): string {
  try {
    const date = new Date(at)
    const today = new Date()
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  } catch {
    return ''
  }
}
