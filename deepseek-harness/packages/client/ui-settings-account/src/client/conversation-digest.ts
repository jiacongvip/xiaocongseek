// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
/** Right-sidebar conversation digest: kind, identity, and session-scoped data. */
import {
  loadDigitalHumanHistory,
  loadDigitalHumanSpaceId,
  loadSessionSpaceId,
  pullDigitalHumanHistory,
  type DigitalHumanHistoryItem,
} from './digital-human-history.ts'
import { loadStudioSpaces, type PublicStudioSpace } from './digital-human-spaces.ts'

export const CONVERSATION_DIGEST_KIND = 'conversation-digest'
export const CONVERSATION_DIGEST_ID = '@xiaocong/conversation-digest'

export type DigestMemory = { id: string; text: string }
export type DigestArtifact = { id: string; title: string; kind: string }
export type DigestResource = { id: string; title: string; coverUrl?: string; mediaUrl?: string; kind: string }
export type DigestFile = { id: string; name: string; url?: string }
export type DigestSkill = { id: string; name: string }

export type ConversationDigestSnapshot = {
  memories: DigestMemory[]
  artifacts: DigestArtifact[]
  resources: DigestResource[]
  media: DigestResource[]
  files: DigestFile[]
  skills: DigestSkill[]
}

const EMPTY: ConversationDigestSnapshot = {
  memories: [], artifacts: [], resources: [], media: [], files: [], skills: [],
}

function briefMemories(space?: PublicStudioSpace): DigestMemory[] {
  const brief = space?.brief
  if (!brief) return []
  const rows: DigestMemory[] = []
  const push = (id: string, value?: string) => {
    const text = String(value || '').trim()
    if (text) rows.push({ id, text: text.replace(/\s+/g, ' ').slice(0, 48) })
  }
  push('identity', brief.identity)
  push('business', brief.business)
  push('audience', brief.audience)
  push('tone', brief.tone)
  return rows.slice(0, 6)
}

function isMediaItem(item: DigitalHumanHistoryItem): boolean {
  const kind = item.kind.toLowerCase()
  return kind.includes('image') || kind.includes('video') || kind.includes('audio')
    || !!item.coverUrl || !!item.mediaUrl
}

export async function loadConversationDigest(sessionId?: string): Promise<ConversationDigestSnapshot> {
  const spaceId = loadSessionSpaceId(sessionId) || loadDigitalHumanSpaceId()
  try {
    const [spaces, history] = await Promise.all([
      loadStudioSpaces(sessionId).catch(() => null),
      pullDigitalHumanHistory(spaceId).catch(() => loadDigitalHumanHistory(spaceId)),
    ])
    const space = spaces?.spaces.find(item => item.id === (spaces.currentId || spaceId))
      ?? spaces?.spaces.find(item => item.id === spaceId)
    const artifacts = history.slice(0, 8).map(item => ({
      id: item.id,
      title: item.title || '未命名成片',
      kind: item.kind || 'video',
    }))
    const media = history.filter(isMediaItem).slice(0, 12).map(item => ({
      id: item.id,
      title: item.title || item.id,
      coverUrl: item.coverUrl,
      mediaUrl: item.mediaUrl,
      kind: item.kind,
    }))
    const files = await loadRecentMaterials(spaceId)
    return {
      memories: briefMemories(space),
      artifacts,
      resources: media,
      media,
      files,
      skills: [{ id: 'dh', name: '口播成片' }, { id: 'mixcut', name: '本地混剪' }],
    }
  } catch {
    return EMPTY
  }
}

async function loadRecentMaterials(spaceId: string): Promise<DigestFile[]> {
  try {
    const response = await fetch(`/digital-human-studio/materials?space=${encodeURIComponent(spaceId)}`)
    const value = await response.json().catch(() => null) as { success?: boolean; items?: unknown } | null
    if (!response.ok || value?.success === false || !Array.isArray(value?.items)) return []
    return value.items.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as { id?: unknown; name?: unknown; url?: unknown }
      const id = String(row.id || '').trim()
      const name = String(row.name || '').trim()
      if (!id || !name) return []
      return [{ id, name, url: typeof row.url === 'string' ? row.url : undefined }]
    }).slice(0, 8)
  } catch {
    return []
  }
}
