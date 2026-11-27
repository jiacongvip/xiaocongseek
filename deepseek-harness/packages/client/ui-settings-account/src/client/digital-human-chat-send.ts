/** Payload for inserting an existing digital-human task into the current chat. */
export type DigitalHumanShowRequest = {
  task_id: string
  text?: string
  cover_url?: string
  avatar_name?: string
}

export type DigitalHumanCommandResult = {
  ok: boolean
  error?: string
  text?: string
}

export type DigitalHumanCard = DigitalHumanShowRequest & {
  sessionId: string
  cite?: boolean
  video_url?: string
}

type ExecuteFn = (sessionId: string, line: string) => Promise<DigitalHumanCommandResult>

let pending: DigitalHumanShowRequest | null = null
const listeners = new Set<(value: DigitalHumanShowRequest) => void>()
let executeCommand: ExecuteFn | null = null
const EMPTY_CARDS: DigitalHumanCard[] = []
const cardsBySession = new Map<string, DigitalHumanCard[]>()
const cardListeners = new Set<() => void>()

function emitCards(): void {
  for (const listener of cardListeners) listener()
}

/** Remember a video card so a blank (new) session can show it above the composer. */
export function pushDigitalHumanCard(card: DigitalHumanCard): void {
  const sessionId = String(card.sessionId || '').trim()
  const taskId = String(card.task_id || '').trim()
  if (!sessionId || !taskId || taskId.startsWith('local-')) return
  const prev = cardsBySession.get(sessionId) ?? []
  if (prev.some(item => item.task_id === taskId)) return
  cardsBySession.set(sessionId, [...prev, { ...card, sessionId, task_id: taskId }])
  emitCards()
}

/** @returns unsubscribe. */
export function subscribeDigitalHumanCards(listener: () => void): () => void {
  cardListeners.add(listener)
  return () => { cardListeners.delete(listener) }
}

/** Cards queued for one conversation. */
export function listDigitalHumanCards(sessionId: string): readonly DigitalHumanCard[] {
  return cardsBySession.get(sessionId) ?? EMPTY_CARDS
}

/** Drop one composer chip. */
export function removeDigitalHumanCard(sessionId: string, taskId: string): void {
  const prev = cardsBySession.get(sessionId)
  if (!prev) return
  const next = prev.filter(item => item.task_id !== taskId)
  if (next.length === prev.length) return
  if (next.length === 0) cardsBySession.delete(sessionId)
  else cardsBySession.set(sessionId, next)
  emitCards()
}

/** Merge fields onto an existing composer chip. */
export function patchDigitalHumanCard(sessionId: string, taskId: string, patch: Partial<DigitalHumanCard>): void {
  const prev = cardsBySession.get(sessionId)
  if (!prev) return
  let changed = false
  const next = prev.map(item => {
    if (item.task_id !== taskId) return item
    changed = true
    return { ...item, ...patch, sessionId, task_id: taskId }
  })
  if (!changed) return
  cardsBySession.set(sessionId, next)
  emitCards()
}

/** Bind the current client's command execute so the composer never has to dump `/dh` into the draft. */
export function bindDigitalHumanCommand(fn: ExecuteFn): void {
  executeCommand = fn
}

/** Run `/dh` against one session without touching the composer draft. */
export async function runDigitalHumanCommand(sessionId: string, line: string): Promise<DigitalHumanCommandResult> {
  if (!sessionId) return { ok: false, error: '当前没有打开的对话' }
  if (!executeCommand) return { ok: false, error: '当前对话还不能发送数字人' }
  try {
    return await executeCommand(sessionId, line)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '发送失败' }
  }
}

const CITE_FENCE_OPEN = '<<<xdh'
const CITE_FENCE_CLOSE = '>>>'

export type DigitalHumanCiteVideo = {
  task_id: string
  avatar_name: string
  video_url: string
  cover_url: string
  text: string
}

function citeVideoFromCard(card: DigitalHumanCard): DigitalHumanCiteVideo {
  return {
    task_id: card.task_id,
    avatar_name: card.avatar_name || '',
    video_url: card.video_url || '',
    cover_url: card.cover_url || '',
    text: card.text || '',
  }
}

/** Encode cited videos into the user message so they travel with that sentence. */
export function encodeDigitalHumanCiteFence(cards: readonly DigitalHumanCard[]): string {
  const videos = cards
    .filter(card => card.cite === true)
    .map(citeVideoFromCard)
    .filter(video => video.task_id)
  if (!videos.length) return ''
  return `${CITE_FENCE_OPEN}\n${JSON.stringify(videos)}\n${CITE_FENCE_CLOSE}`
}

/** Append cite fences to a composer draft if this session has chips. */
export function appendDigitalHumanCitesToDraft(draft: string, sessionId: string | undefined): string {
  if (!sessionId || draft.includes(CITE_FENCE_OPEN)) return draft
  const fence = encodeDigitalHumanCiteFence(listDigitalHumanCards(sessionId))
  if (!fence) return draft
  const trimmed = draft.trim()
  return trimmed ? `${trimmed}\n\n${fence}` : fence
}

/** Parse one original-text fence into cited videos. */
export function parseDigitalHumanCiteFence(text: string, from = 0): {
  start: number
  end: number
  videos: DigitalHumanCiteVideo[]
} | undefined {
  const start = text.indexOf(`${CITE_FENCE_OPEN}\n`, from)
  if (start < 0) return undefined
  const close = `\n${CITE_FENCE_CLOSE}`
  const end = text.indexOf(close, start)
  if (end < 0) return undefined
  const json = text.slice(start + CITE_FENCE_OPEN.length + 1, end)
  try {
    const parsed = JSON.parse(json) as unknown
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    const videos: DigitalHumanCiteVideo[] = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const item = row as Record<string, unknown>
      const taskId = String(item.task_id || '').trim()
      if (!taskId) continue
      videos.push({
        task_id: taskId,
        avatar_name: typeof item.avatar_name === 'string' ? item.avatar_name : '',
        video_url: typeof item.video_url === 'string' ? item.video_url : '',
        cover_url: typeof item.cover_url === 'string' ? item.cover_url : '',
        text: typeof item.text === 'string' ? item.text : '',
      })
    }
    if (!videos.length) return undefined
    return { start, end: end + close.length, videos }
  } catch {
    return undefined
  }
}

/** Queue a completed task so the conversation can insert a video card. */
export function queueDigitalHumanShow(value: DigitalHumanShowRequest) {
  const taskId = String(value.task_id || '').trim()
  if (!taskId || taskId.startsWith('local-')) return
  const next = { ...value, task_id: taskId }
  if (listeners.size === 0) {
    pending = next
    return
  }
  pending = null
  for (const listener of listeners) listener(next)
}

/** @returns unsubscribe. Delivers a queued request immediately if the composer was unmounted. */
export function subscribeDigitalHumanShow(listener: (value: DigitalHumanShowRequest) => void): () => void {
  listeners.add(listener)
  if (pending) {
    const value = pending
    pending = null
    listener(value)
  }
  return () => { listeners.delete(listener) }
}
