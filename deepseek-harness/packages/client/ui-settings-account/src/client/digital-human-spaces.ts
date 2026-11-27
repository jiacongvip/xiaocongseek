import { DIGITAL_HUMAN_SPACE_KEY, DEFAULT_DIGITAL_HUMAN_SPACE_ID } from './digital-human-history.ts'

export type PublicStudioSpace = {
  id: string
  name: string
  lastProjectFolder?: string
  brief?: {
    identity?: string
    business?: string
    audience?: string
    tone?: string
    avoid?: string
    sample?: string
    brand?: string
    pains?: string
    proof?: string
    cta?: string
    voice?: string
    keywords?: string
    videoFormat?: string
    editStyle?: string
    visualStyle?: string
    audioStyle?: string
    outroTemplate?: string
  }
}

export type StudioSpacesPayload = {
  currentId: string
  spaces: PublicStudioSpace[]
}

function asSpaces(value: { currentId?: unknown; spaces?: unknown }): StudioSpacesPayload {
  const spaces = Array.isArray(value.spaces)
    ? value.spaces.filter((item): item is PublicStudioSpace => !!item && typeof item.id === 'string' && typeof item.name === 'string')
    : []
  return {
    currentId: String(value.currentId || spaces[0]?.id || DEFAULT_DIGITAL_HUMAN_SPACE_ID),
    spaces: spaces.length ? spaces : [{ id: DEFAULT_DIGITAL_HUMAN_SPACE_ID, name: '默认' }],
  }
}

export function rememberStudioSpace(id: string) {
  try {
    localStorage.setItem(DIGITAL_HUMAN_SPACE_KEY, id)
  } catch {
    /* private windows */
  }
  window.dispatchEvent(new Event('xdh-digital-human-space'))
}

export async function loadStudioSpaces(sessionId?: string): Promise<StudioSpacesPayload> {
  const suffix = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  const response = await fetch(`/digital-human-studio/spaces${suffix}`, { headers: { accept: 'application/json' } })
  const value = await response.json()
  if (!response.ok || value?.success === false) throw new Error(value?.error || '无法读取公司')
  return asSpaces(value)
}

export async function selectStudioSpace(id: string, sessionId?: string): Promise<StudioSpacesPayload> {
  const response = await fetch('/digital-human-studio/spaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'select', id, ...sessionId ? { sessionId } : {} }),
  })
  const value = await response.json()
  if (!response.ok || value?.success === false) throw new Error(value?.error || '切换公司失败')
  const payload = asSpaces(value)
  rememberStudioSpace(payload.currentId)
  return payload
}

export function spaceBriefFilled(space?: PublicStudioSpace): boolean {
  const brief = space?.brief
  if (!brief) return false
  return Object.values(brief).some(value => String(value || '').trim() !== '')
}
