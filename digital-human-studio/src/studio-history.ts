import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spaceAssetRoot } from './spaces.js'

export type StudioHistoryItem = {
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
  /** 本地成品相对 spaceAssetRoot 的路径，导出/导入的视频用它定位文件 */
  localFile?: string
  /** 模型给这条成片配的文案 + 封面（work-copy.ts 生成，可反复重生成） */
  copy?: {
    title: string
    coverText: string
    coverPrompt: string
    body: string
    shots: { shot: string; visual: string; voice: string; seconds: number }[]
    model?: string
    at: number
    coverUrl?: string
    coverError?: string
    /** AI 聊天改稿的对话记录（用户说的 + 模型答的） */
    chat?: { role: 'user' | 'ai'; text: string; at: number }[]
  }
}

const LIMIT = 80

export function studioHistoryPath(spaceId: string): string {
  return join(spaceAssetRoot(spaceId), 'history.json')
}

function clipTitle(kind: string, text: string): string {
  const snippet = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 28)
  if (snippet) return snippet
  if (kind === 'xdh-export-video') return '成品视频'
  if (kind === 'xdh-avatar-video') return '数字人视频'
  if (kind === 'xdh-audio') return '语音合成'
  if (kind === 'xdh-image' || kind === 'ximg') return '图片生成'
  if (kind === 'xdh-avatar-clone') return '形象克隆'
  if (kind === 'xdh-voice-clone') return '声音克隆'
  return '数字人任务'
}

export function historyTitle(kind: string, text: string): string {
  return clipTitle(kind, text)
}

export function loadStudioHistory(spaceId: string): StudioHistoryItem[] {
  try {
    const file = studioHistoryPath(spaceId)
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : []
    return rows.filter((item: unknown) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
  } catch {
    return []
  }
}

export function saveStudioHistory(spaceId: string, items: StudioHistoryItem[]) {
  const file = studioHistoryPath(spaceId)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(items.slice(0, LIMIT), null, 2), { encoding: 'utf8' })
}

export function upsertStudioHistory(spaceId: string, item: StudioHistoryItem): StudioHistoryItem[] {
  const id = String(item.id || '').trim()
  if (!id) return loadStudioHistory(spaceId)
  const current = loadStudioHistory(spaceId)
  const previous = current.find(row => row.id === id)
  const next: StudioHistoryItem = {
    ...previous,
    ...item,
    id,
    kind: String(item.kind || previous?.kind || ''),
    title: String(item.title || previous?.title || clipTitle(item.kind || previous?.kind || '', item.prompt || previous?.prompt || '')),
    at: Number(item.at || previous?.at || Date.now()) || Date.now(),
  }
  const items = [next, ...current.filter(row => row.id !== id)].slice(0, LIMIT)
  saveStudioHistory(spaceId, items)
  return items
}

export function patchStudioHistory(spaceId: string, id: string, patch: Partial<StudioHistoryItem>): StudioHistoryItem[] {
  const current = loadStudioHistory(spaceId)
  const previous = current.find(row => row.id === id)
  if (!previous) return current
  return upsertStudioHistory(spaceId, { ...previous, ...patch, id })
}

export function findAndPatchStudioHistory(spaces: { id: string }[], id: string, patch: Partial<StudioHistoryItem>): string | undefined {
  for (const space of spaces) {
    if (!loadStudioHistory(space.id).some(item => item.id === id)) continue
    patchStudioHistory(space.id, id, patch)
    return space.id
  }
  return undefined
}

/** 删除一条成片记录；返回剩下的列表和被删的那条（供调用方清理本地文件）。 */
export function removeStudioHistory(spaceId: string, id: string): { items: StudioHistoryItem[]; removed?: StudioHistoryItem } {
  const key = String(id || '').trim()
  const current = loadStudioHistory(spaceId)
  const removed = current.find(row => row.id === key)
  if (!removed) return { items: current }
  const items = current.filter(row => row.id !== key)
  saveStudioHistory(spaceId, items)
  return { items, removed }
}

export function taskIdFromResult(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const row = value as Record<string, unknown>
  const nested = row.data && typeof row.data === 'object' && !Array.isArray(row.data)
    ? row.data as Record<string, unknown>
    : undefined
  return String(row.task_id || row.id || nested?.task_id || nested?.id || '').trim()
}
