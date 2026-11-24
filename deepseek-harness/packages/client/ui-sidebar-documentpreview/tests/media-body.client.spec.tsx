// @vitest-environment jsdom
/** Native media player wiring, file URLs, and failure states. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { MediaBody, mediaKind, type MediaBodyProps } from '../src/client/media/MediaBody.tsx'
import { en } from '../src/client/media/locales.ts'

const translations: ReadonlyMap<string, string> = new Map(Object.entries(en))

beforeEach(() => {
  Object.defineProperty(document, 'baseURI', { configurable: true, get: () => 'https://preview.invalid/' })
})

afterEach(() => { cleanup() })

function props(file = 'clip.mp4', absolutePath = '/work/clip.mp4', overrides: Partial<MediaBodyProps> = {}): MediaBodyProps {
  const loaded = vi.fn()
  return {
    resourceAddress: `dsh-resource://file/session/media/${file}`,
    content: { kind: 'renderer', revision: 1, loaded, failed: vi.fn(), reload: vi.fn() },
    wrap: false,
    sessionId: 'media' as SessionId,
    useTabInfo: () => ({ tab: { id: 'media-tab' as TabId, signal: new AbortController().signal } }),
    useResource: () => ({ status: 'live', value: { absolutePath, version: 'v1' }, failure: undefined }),
    scrollportRef: vi.fn(),
    addResource: vi.fn(),
    setResources: vi.fn(),
    t: (key, params) => {
      const value = translations.get(key) ?? key
      return params === undefined ? value : Object.entries(params)
        .reduce((text, [name, replacement]) => text.replace(`{${name}}`, String(replacement)), value)
    },
    ...overrides,
  } as MediaBodyProps
}

describe('mediaKind', () => {
  it.each([
    ['clip.mp4', 'video'],
    ['CLIP.MOV', 'video'],
    ['talk.webm', 'video'],
    ['voice.mp3', 'audio'],
    ['voice.WAV', 'audio'],
    ['notes.txt', undefined],
  ] as const)('classifies %s as %s', (name, kind) => {
    expect(mediaKind(`/work/${name}`)).toBe(kind)
  })
})

describe('MediaBody', () => {
  it('plays an mp4 through the authenticated file route', () => {
    const path = '/Users/work/南京全屋定制.mp4'
    render(<MediaBody {...props('clip.mp4', path)} />)
    const player = document.querySelector('video')
    expect(player).not.toBeNull()
    const src = new URL(player!.getAttribute('src') ?? '', 'https://preview.invalid/')
    expect(src.pathname.endsWith('/api/file')).toBe(true)
    expect(src.searchParams.get('path')).toBe(path)
    expect(screen.getByLabelText('Media preview: 南京全屋定制.mp4')).toBe(player)
  })

  it('plays audio files with an audio element', () => {
    render(<MediaBody {...props('voice.mp3', '/work/voice.mp3')} />)
    expect(document.querySelector('video')).toBeNull()
    expect(document.querySelector('audio')?.getAttribute('data-kind')).toBe('audio')
  })

  it('reports the displayed source version to the document owner', () => {
    const input = props()
    render(<MediaBody {...input} />)
    expect(input.content.kind === 'renderer' && input.content.loaded).toHaveBeenCalledWith('v1')
  })

  it('shows a failure line when the player cannot decode the file', () => {
    render(<MediaBody {...props()} />)
    fireEvent.error(document.querySelector('video')!)
    expect(screen.getByRole('alert').textContent).toBe(en.failed)
  })

  it('waits for the Host path before mounting a player', () => {
    render(<MediaBody {...props('clip.mp4', '/work/clip.mp4', {
      useResource: () => ({ status: 'loading', value: undefined, failure: undefined }),
    })} />)
    expect(document.querySelector('video')).toBeNull()
    expect(screen.getByText(en.loading)).toBeDefined()
  })
})
