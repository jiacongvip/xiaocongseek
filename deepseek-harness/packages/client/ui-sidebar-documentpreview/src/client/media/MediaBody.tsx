/** Native video and audio playback from the authenticated file route. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { fileMediaUrl, pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentPreviewProps } from '../document/contract.ts'
import { LoadingIndicator } from '../LoadingIndicator.tsx'
import { hostFileOf } from '../rpc.ts'
import type {} from './locales.ts'
import css from './MediaBody.module.css'

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v'] as const
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'flac'] as const

/** File suffixes rendered by the builtin media body. */
export const MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] as const

/** Kind of native player used for a recognized suffix. */
export type MediaKind = 'video' | 'audio'

/**
 * Resolve a supported filename to video or audio playback.
 * @param path - decoded workspace file path.
 * @returns the player kind, or undefined for an unregistered suffix.
 */
export function mediaKind(path: string): MediaKind | undefined {
  const normalized = path.replaceAll('\\', '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase()
  const extension = name.slice(name.lastIndexOf('.') + 1)
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(extension)) return 'video'
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(extension)) return 'audio'
  return undefined
}

/** Standard document props plus the media renderer's dictionary. */
export type MediaBodyProps = DocumentPreviewProps & PropsLocale<'sidebarMedia'>

/**
 * Present a workspace media file with the browser's native controls.
 * @param props - renderer request, resource identity, and locale.
 * @returns a video or audio player, or a loading/failure line.
 */
export function MediaBody(props: MediaBodyProps): ReactNode {
  const { content, resourceAddress, t, useResource } = props
  const request = content.kind === 'renderer' ? content : undefined
  const path = useMemo(() => hostFileOf(resourceAddress).path, [resourceAddress])
  const kind = mediaKind(path)
  const meta = useResource<'file'>(resourceAddress)
  const absolutePath = meta.value?.absolutePath
  const url = absolutePath === undefined ? undefined : fileMediaUrl(document.baseURI, absolutePath)
  const [failed, setFailed] = useState(false)
  const { name } = pathPartsOf(absolutePath ?? path)

  useEffect(() => {
    setFailed(false)
  }, [url, request?.revision])

  useEffect(() => {
    const version = meta.value?.version
    if (request === undefined || version === undefined) return
    request.loaded(version)
  }, [request, meta.value?.version])

  if (kind === undefined || request === undefined) {
    return <p className={css.status} role="alert">{t('unsupported')}</p>
  }
  if (url === undefined) {
    return meta.status === 'none'
      ? <p className={css.status} role="alert">{t('unsupported')}</p>
      : <LoadingIndicator label={t('loading')} />
  }
  if (failed) return <p className={css.status} role="alert">{t('failed')}</p>
  const label = t('preview', { name })
  return (
    <div className={css.frame} data-media-preview={kind}>
      {kind === 'video' ? (
        <video
          className={css.player}
          data-kind="video"
          src={url}
          controls
          playsInline
          preload="metadata"
          aria-label={label}
          onError={() => { setFailed(true) }}
        />
      ) : (
        <audio
          className={css.player}
          data-kind="audio"
          src={url}
          controls
          preload="metadata"
          aria-label={label}
          onError={() => { setFailed(true) }}
        />
      )}
    </div>
  )
}
