import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from './digital-human-user-text.ts'
import css from './DigitalHumanUserCite.module.css'

function isGatewayArtifactURL(url?: string): boolean {
  const value = String(url || '')
  return /\/v1\/tasks\/.+\/artifacts\//.test(value) || /localhost|127\.0\.0\.1/.test(value)
}

function pickMediaURL(task: Record<string, unknown> | null, fallback = ''): string {
  if (!task) return fallback
  const data = task.data && typeof task.data === 'object' && !Array.isArray(task.data)
    ? task.data as Record<string, unknown>
    : undefined
  const nested = data?.data && typeof data.data === 'object' && !Array.isArray(data.data)
    ? data.data as Record<string, unknown>
    : undefined
  const candidates = [
    data?.video_url, nested?.video_url, data?.audio_url, nested?.audio_url, task.url, fallback,
  ]
  return candidates.find((item): item is string => typeof item === 'string' && item.trim() !== '' && !isGatewayArtifactURL(item)) || ''
}

function BubbleChip({ video }: {
  video: UserTextNodeProps<'xdh'>['node']['data']['videos'][number]
}) {
  const chipRef = useRef<HTMLButtonElement>(null)
  const [hover, setHover] = useState(false)
  const [preview, setPreview] = useState<{ left: number; top: number } | null>(null)
  const [media, setMedia] = useState(video.video_url && !isGatewayArtifactURL(video.video_url) ? video.video_url : '')
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const title = video.avatar_name || video.text || '数字人视频'

  useEffect(() => {
    if (media || !video.task_id) return
    let cancelled = false
    void fetch(`/digital-human-studio/digital-human/task?id=${encodeURIComponent(video.task_id)}`, {
      signal: AbortSignal.timeout(20000),
    })
      .then(response => response.json())
      .then(value => {
        if (cancelled) return
        const url = pickMediaURL(value as Record<string, unknown> | null)
        if (url) setMedia(url)
      })
      .catch(() => { /* keep the cover */ })
    return () => { cancelled = true }
  }, [media, video.task_id])

  const open = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    const el = chipRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = 220
    const height = 300
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12))
    let top = rect.top - height - 10
    if (top < 12) top = Math.min(rect.bottom + 10, window.innerHeight - height - 12)
    setPreview({ left, top })
    setHover(true)
  }, [])

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      setHover(false)
      setPreview(null)
    }, 160)
  }, [])

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  return (
    <span className={css.chipWrap} onMouseEnter={open} onMouseLeave={scheduleClose}>
      <button
        ref={chipRef}
        type="button"
        className={css.chip}
        aria-label={`${title}，悬停预览`}
        onClick={open}
      >
        {video.cover_url
          ? <img src={video.cover_url} alt="" />
          : <span className={css.fallback} />}
        <i className={css.play} aria-hidden />
      </button>
      {hover && preview
        ? createPortal(
          <div
            className={css.preview}
            style={{ left: preview.left, top: preview.top }}
            onMouseEnter={open}
            onMouseLeave={scheduleClose}
          >
            {media
              ? (
                <video
                  className={css.previewMedia}
                  src={media}
                  poster={video.cover_url}
                  autoPlay
                  muted
                  loop
                  playsInline
                  controls
                />
              )
              : video.cover_url
                ? <img className={css.previewMedia} src={video.cover_url} alt="" />
                : <div className={css.previewMedia} />}
            <strong>{title}</strong>
          </div>,
          document.body,
        )
        : null}
    </span>
  )
}

/** Compact cited-video thumbs inside the user message bubble. */
export function DigitalHumanUserCite({ node }: UserTextNodeProps<'xdh'>) {
  return (
    <span className={css.row}>
      {node.data.videos.map(video => <BubbleChip key={video.task_id} video={video} />)}
    </span>
  )
}
