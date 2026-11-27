import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  listDigitalHumanCards,
  patchDigitalHumanCard,
  removeDigitalHumanCard,
  subscribeDigitalHumanCards,
  type DigitalHumanCard,
} from './digital-human-chat-send.ts'
import css from './DigitalHumanCiteDock.module.css'

type OverlayProps = PropsRuntime<'conversation.input.overlay'>

const EMPTY: ReturnType<typeof listDigitalHumanCards> = []

function isGatewayArtifactURL(url?: string): boolean {
  const value = String(url || '')
  return /\/v1\/tasks\/.+\/artifacts\//.test(value) || /localhost|127\.0\.0\.1/.test(value)
}

function readUrl(data: Record<string, unknown> | undefined, key: string): string {
  const direct = data?.[key]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const nested = data?.data && typeof data.data === 'object' && !Array.isArray(data.data)
    ? (data.data as Record<string, unknown>)[key]
    : undefined
  if (typeof nested === 'string' && nested.trim()) return nested.trim()
  return ''
}

function pickMediaURL(task: Record<string, unknown> | null): string {
  if (!task) return ''
  const data = task.data && typeof task.data === 'object' && !Array.isArray(task.data)
    ? task.data as Record<string, unknown>
    : undefined
  return [readUrl(data, 'video_url'), readUrl(data, 'audio_url'), String(task.url || '').trim()]
    .find(item => item && !isGatewayArtifactURL(item)) || ''
}

function ComposerChip({ card, sessionId }: { card: DigitalHumanCard; sessionId: string }) {
  const chipRef = useRef<HTMLButtonElement>(null)
  const [hover, setHover] = useState(false)
  const [preview, setPreview] = useState<{ left: number; top: number } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const media = card.video_url && !isGatewayArtifactURL(card.video_url) ? card.video_url : ''
  const title = card.avatar_name || '数字人视频'

  useEffect(() => {
    if (media || !card.task_id) return
    let cancelled = false
    const tick = async () => {
      try {
        const response = await fetch(`/digital-human-studio/digital-human/task?id=${encodeURIComponent(card.task_id)}`, {
          signal: AbortSignal.timeout(20000),
        })
        const value = await response.json().catch(() => null) as Record<string, unknown> | null
        if (cancelled || !value) return
        const url = pickMediaURL(value)
        if (url) patchDigitalHumanCard(sessionId, card.task_id, { video_url: url })
      } catch {
        /* keep the cover until the next hover fetch */
      }
    }
    void tick()
    return () => { cancelled = true }
  }, [card.task_id, media, sessionId])

  const open = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    const el = chipRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = 280
    const height = 360
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
    <div
      className={css.chipWrap}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={chipRef}
        type="button"
        className={css.chip}
        aria-label={`${title}，悬停预览`}
      >
        {card.cover_url
          ? <img src={card.cover_url} alt="" />
          : <span className={css.chipFallback} />}
        <i className={css.play} aria-hidden />
      </button>
      <button
        type="button"
        className={css.remove}
        aria-label="从输入框移除"
        onClick={event => {
          event.stopPropagation()
          removeDigitalHumanCard(sessionId, card.task_id)
        }}
      >
        <IconCloseOutlineRegular size={12} />
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
                  poster={card.cover_url}
                  autoPlay
                  muted
                  loop
                  playsInline
                  controls
                />
              )
              : card.cover_url
                ? <img className={css.previewMedia} src={card.cover_url} alt="" />
                : <div className={css.previewMedia} />}
            <div className={css.previewCopy}>
              <strong>{title}</strong>
              {card.text ? <span>{card.text}</span> : null}
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}

/** Compact chips inside the composer card; hover enlarges a video preview. */
export function DigitalHumanCiteDock({ sessionId, useInput }: OverlayProps) {
  const key = String(sessionId)
  const phase = useInput(state => state.phase)
  const cards = useSyncExternalStore(
    subscribeDigitalHumanCards,
    () => listDigitalHumanCards(key),
    () => EMPTY,
  )
  const markerRef = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (phase !== 'sending') return
    for (const card of listDigitalHumanCards(key)) removeDigitalHumanCard(key, card.task_id)
  }, [key, phase])

  useLayoutEffect(() => {
    const card = markerRef.current?.closest('[data-composer-card]')
    if (!(card instanceof HTMLElement)) return
    let mount = card.querySelector('[data-dh-composer-chips]') as HTMLElement | null
    if (!mount) {
      mount = document.createElement('div')
      mount.setAttribute('data-dh-composer-chips', '')
      const scroll = card.querySelector('[data-input-scroll]')
      if (scroll) card.insertBefore(mount, scroll)
      else card.appendChild(mount)
    }
    setHost(mount)
    return () => {
      if (mount && !mount.hasChildNodes()) mount.remove()
    }
  }, [])

  const rail = cards.length === 0 ? null : (
    <div className={css.rail} role="group" aria-label="数字人视频">
      {cards.map(card => (
        <ComposerChip key={card.task_id} card={card} sessionId={key} />
      ))}
    </div>
  )

  return (
    <>
      <span ref={markerRef} hidden />
      {host ? createPortal(rail, host) : null}
    </>
  )
}
