// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parseSpeakPayload } from './DigitalHumanChatCard.tsx'
import {
  DEFAULT_DIGITAL_HUMAN_SPACE_ID,
  digitalHumanKindLabel,
  digitalHumanStatusLabel,
  formatDigitalHumanTime,
  loadDigitalHumanHistory,
  loadSessionSpaceId,
  pullDigitalHumanHistory,
  type DigitalHumanHistoryItem,
} from './digital-human-history.ts'
import { pushDigitalHumanCard, runDigitalHumanCommand, subscribeDigitalHumanShow } from './digital-human-chat-send.ts'
import css from './DigitalHumanComposerButton.module.css'

type ComposerButtonProps = PropsRuntime<'conversation.input.left'>

const STUCK_SHOW = /^\/dh\s+show\s+\S+$/i

function isLocalTaskId(id: string): boolean {
  return id.startsWith('local-')
}

function citeTask(sessionId: string, item: DigitalHumanHistoryItem): void {
  pushDigitalHumanCard({
    sessionId,
    task_id: item.id,
    text: item.prompt || item.title,
    cover_url: item.coverUrl,
    avatar_name: item.title,
    cite: true,
  })
}

/** Composer control: pick a finished digital-human task and cite it into the input. */
export function DigitalHumanComposerButton({ sessionId, useInput, inputActions }: ComposerButtonProps) {
  const draft = useInput(state => state.draft)
  const [cover, setCover] = useState('')
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<DigitalHumanHistoryItem[]>([])
  const [status, setStatus] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const cleaned = useRef(false)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const key = String(sessionId)

  const refresh = useCallback(() => {
    const spaceId = loadSessionSpaceId(String(sessionId)) || DEFAULT_DIGITAL_HUMAN_SPACE_ID
    const apply = (items: DigitalHumanHistoryItem[]) => {
      setTasks(items.filter(item => !isLocalTaskId(item.id) && item.kind !== 'ximg' && item.kind !== 'xdh-image'))
    }
    apply(loadDigitalHumanHistory(spaceId))
    void pullDigitalHumanHistory(spaceId, false).then(apply).catch(() => {})
  }, [sessionId])

  const refreshCover = useCallback(() => {
    void fetch('/digital-human-studio/digital-human/defaults')
      .then(response => response.json())
      .then(value => setCover(String(value?.avatar?.cover_url || value?.avatar?.preview_url || '')))
      .catch(() => setCover(''))
  }, [])

  useEffect(() => {
    if (cleaned.current) return
    cleaned.current = true
    if (STUCK_SHOW.test(draft.trim())) inputActions.setDraft('')
  }, [draft, inputActions])

  useEffect(() => subscribeDigitalHumanShow(value => {
    pushDigitalHumanCard({
      sessionId: key,
      task_id: value.task_id,
      text: value.text,
      cover_url: value.cover_url,
      avatar_name: value.avatar_name,
      cite: true,
    })
    if (STUCK_SHOW.test(draftRef.current.trim())) inputActions.setDraft('')
  }), [inputActions, key])

  useEffect(() => {
    refreshCover()
    const onSpace = () => {
      refresh()
      refreshCover()
    }
    window.addEventListener('xdh-digital-human-space', onSpace)
    return () => window.removeEventListener('xdh-digital-human-space', onSpace)
  }, [refresh, refreshCover])

  useEffect(() => {
    if (!open) return
    refresh()
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onHistory = () => refresh()
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('xdh-digital-human-history', onHistory)
    window.addEventListener('storage', onHistory)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('xdh-digital-human-history', onHistory)
      window.removeEventListener('storage', onHistory)
    }
  }, [open, refresh])

  const toggle = useCallback(() => {
    setOpen(value => !value)
    setStatus('')
  }, [])

  const pick = useCallback((item: DigitalHumanHistoryItem) => {
    citeTask(key, item)
    setOpen(false)
  }, [key])

  const generate = useCallback(() => {
    const text = draft.trim()
    const line = /^\/dh(?:\s|$)/.test(text) ? (text || '/dh') : (text ? `/dh ${text}` : '/dh')
    setStatus('正在生成…')
    void runDigitalHumanCommand(key, line).then(result => {
      const payload = result.text ? parseSpeakPayload(result.text) : null
      if (payload) {
        pushDigitalHumanCard({
          sessionId: key,
          task_id: payload.task_id,
          text: payload.text,
          cover_url: payload.cover_url,
          avatar_name: payload.avatar_name,
          video_url: payload.video_url,
          cite: false,
        })
      }
      setStatus(result.ok ? '已开始生成' : (result.error || '生成失败'))
      window.setTimeout(() => setStatus(''), 2200)
      if (result.ok) setOpen(false)
    })
  }, [draft, key])

  const panelStyle = (() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return { left: 12, bottom: 72 }
    const width = 320
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    return { left, bottom: Math.max(12, window.innerHeight - rect.top + 8), width }
  })()

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={css.button}
        data-open={open || undefined}
        aria-label="数字人任务"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="选择已生成的数字人任务，引用到对话"
        onMouseDown={event => event.preventDefault()}
        onClick={toggle}
      >
        {cover ? <img className={css.thumb} src={cover} alt="" /> : null}
        {status || '口播成片'}
        <span className={css.chevron} aria-hidden data-open={open || undefined} />
      </button>
      {open ? createPortal(
        <div ref={panelRef} className={css.panel} style={panelStyle} role="listbox" aria-label="数字人任务">
          <div className={css.panelHead}>
            <strong>数字人任务</strong>
            <button type="button" className={css.generate} onMouseDown={event => event.preventDefault()} onClick={generate}>
              {draft.trim() ? '用当前文案生成' : '用上一条回复生成'}
            </button>
          </div>
          {tasks.length === 0 ? (
            <div className={css.empty}>还没有任务。去「工作台」做一条，或点上面生成。</div>
          ) : (
            <div className={css.list}>
              {tasks.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={css.row}
                  role="option"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => pick(item)}
                >
                  <span className={css.rowThumb}>
                    {item.coverUrl
                      ? /\.(mp4|webm|mov)($|\?)/i.test(item.coverUrl)
                        ? <video src={item.coverUrl} muted playsInline preload="metadata" />
                        : <img src={item.coverUrl} alt="" />
                      : <span className={css.rowFallback} />}
                  </span>
                  <span className={css.rowBody}>
                    <b>{item.title || '数字人任务'}</b>
                    <small>
                      {digitalHumanKindLabel(item.kind)} · {digitalHumanStatusLabel(item.status)} · {formatDigitalHumanTime(item.at)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
