import { useCallback, useEffect, useRef, useState } from 'react'
import { IconChevronDownOutlineRegular, IconUsersOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  loadStudioSpaces,
  selectStudioSpace,
  spaceBriefFilled,
  type PublicStudioSpace,
} from './digital-human-spaces.ts'
import {
  DEFAULT_DIGITAL_HUMAN_SPACE_ID,
  loadSessionSpaceId,
  rememberSessionSpace,
} from './digital-human-history.ts'
import css from './DigitalHumanCompanyPicker.module.css'

function sessionKeyOf(sessionId: string | undefined, node: HTMLElement | null): string {
  const fromProp = String(sessionId || '').trim()
  if (fromProp) return fromProp
  return String(node?.closest('[data-conversation-content]')?.getAttribute('data-conversation-session') || '').trim()
}

export function DigitalHumanCompanyPicker({
  tone = 'hero',
  sessionId,
}: {
  tone?: 'hero' | 'composer'
  sessionId?: string
}) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const lastBound = useRef('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [currentId, setCurrentId] = useState(
    () => loadSessionSpaceId(sessionId) || DEFAULT_DIGITAL_HUMAN_SPACE_ID,
  )
  const [spaces, setSpaces] = useState<PublicStudioSpace[]>([])

  const refreshList = useCallback((sessionKey?: string) => {
    void loadStudioSpaces(sessionKey || undefined)
      .then(payload => setSpaces(payload.spaces))
      .catch(() => { /* keep last list */ })
  }, [])

  const bindThisChat = useCallback((sessionKey: string, spaceId: string) => {
    const id = String(spaceId || '').trim()
    if (!sessionKey || !id) return
    rememberSessionSpace(sessionKey, id)
    setCurrentId(id)
    const stamp = `${sessionKey}:${id}`
    if (lastBound.current === stamp) return
    lastBound.current = stamp
    void selectStudioSpace(id, sessionKey)
      .then(payload => setSpaces(payload.spaces))
      .catch(() => { /* keep current */ })
  }, [])

  useEffect(() => {
    const sessionKey = sessionKeyOf(sessionId, rootRef.current)
    const wanted = loadSessionSpaceId(sessionKey) || DEFAULT_DIGITAL_HUMAN_SPACE_ID
    setCurrentId(wanted)
    refreshList(sessionKey)
    if (sessionKey) bindThisChat(sessionKey, wanted)
    const onSpace = (event?: Event) => {
      const key = sessionKeyOf(sessionId, rootRef.current)
      const detail = (event as CustomEvent<{ sessionId?: string; spaceId?: string }> | undefined)?.detail
      const next = (detail?.sessionId && key && detail.sessionId === key && detail.spaceId)
        ? detail.spaceId
        : loadSessionSpaceId(key)
      if (next) {
        setCurrentId(next)
        if (key) lastBound.current = `${key}:${next}`
      }
      refreshList(key)
    }
    window.addEventListener('xdh-digital-human-space', onSpace)
    return () => window.removeEventListener('xdh-digital-human-space', onSpace)
  }, [bindThisChat, refreshList, sessionId])

  useEffect(() => {
    if (tone !== 'composer') return
    let observer: MutationObserver | undefined
    let timer: number | undefined
    const attach = () => {
      const root = rootRef.current?.closest('[data-conversation-content]') || document.querySelector('[data-conversation-content]')
      if (!root) return false
      const sync = () => setHidden(root.getAttribute('data-content-phase') === 'hero')
      sync()
      observer = new MutationObserver(sync)
      observer.observe(root, { attributes: true, attributeFilter: ['data-content-phase'] })
      return true
    }
    if (!attach()) {
      timer = window.setInterval(() => {
        if (attach()) window.clearInterval(timer)
      }, 200)
    }
    return () => {
      if (timer !== undefined) window.clearInterval(timer)
      observer?.disconnect()
    }
  }, [tone])

  const current = spaces.find(item => item.id === currentId) || spaces.find(item => item.id === DEFAULT_DIGITAL_HUMAN_SPACE_ID) || spaces[0]
  const pick = useCallback((id: string) => {
    setOpen(false)
    if (busy) return
    const sessionKey = sessionKeyOf(sessionId, rootRef.current)
    lastBound.current = ''
    setBusy(true)
    rememberSessionSpace(sessionKey, id)
    setCurrentId(id)
    void selectStudioSpace(id, sessionKey || undefined)
      .then(payload => {
        lastBound.current = sessionKey ? `${sessionKey}:${id}` : ''
        setSpaces(payload.spaces)
        setCurrentId(id)
      })
      .catch(() => { /* keep current */ })
      .finally(() => setBusy(false))
  }, [busy, sessionId])

  if (hidden) return <span ref={rootRef} hidden />

  return (
    <span ref={rootRef} className={css.menuAnchor}>
      <Menu
        open={open && spaces.length > 0}
        onClose={() => setOpen(false)}
        align="start"
        side={tone === 'composer' ? 'top' : 'bottom'}
        portal
        minWidthFromAnchor
        selectedId={currentId}
        onSelect={pick}
        items={spaces.map(item => ({
          id: item.id,
          label: (
            <span className={css.item}>
              <span className={css.itemName}>{item.name}</span>
              <span className={css.itemDesc}>{spaceBriefFilled(item) ? '已填档案' : '未填档案'}</span>
            </span>
          ),
        }))}
        anchor={(
          <button
            type="button"
            className={css.seat}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="选择公司"
            title={spaceBriefFilled(current)
              ? '这条对话会按这家公司的档案写口播和文案'
              : '这家还没档案。发第一条消息后，我会先问身份、卖点和口吻，再帮你记下'}
            disabled={busy}
            onClick={() => setOpen(value => !value)}
          >
            <IconUsersOutlineRegular className={css.seatIcon} />
            <span className={css.seatLabel}>{current?.name || (currentId === DEFAULT_DIGITAL_HUMAN_SPACE_ID ? '默认' : '公司')}</span>
            {current && !spaceBriefFilled(current) ? <span className={css.seatHint}>未填</span> : null}
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
    </span>
  )
}
