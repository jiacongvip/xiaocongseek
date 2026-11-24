import { useEffect, useId, useRef, type ReactNode } from 'react'
import css from './DigitalHumanPanel.module.css'

export function DigitalHumanDeskModal({
  open,
  title,
  onClose,
  children,
  maxWidth,
}: {
  open: boolean
  title: string
  onClose: () => void
  children?: ReactNode
  /** 窄表单用，默认沿用 880 的宽弹窗。 */
  maxWidth?: number
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const closeButton = dialogRef.current?.querySelector('[data-desk-modal-close]') as HTMLElement | null
    closeButton?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const restore = restoreRef.current
      if (restore && document.contains(restore) && typeof restore.focus === 'function') restore.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className={css.overlay}
      data-desk-modal-overlay=""
      onClick={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current()
      }}
    >
      <div
        ref={dialogRef}
        className={`${css.picker} ${css.deskModal}`}
        style={maxWidth ? { maxWidth: `${maxWidth}px`, width: `min(${maxWidth}px, 100%)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={css.pickerHead}>
          <h3 id={titleId}>{title}</h3>
          <button
            type="button"
            className={css.pickerClose}
            data-desk-modal-close=""
            aria-label="关闭"
            onClick={() => onCloseRef.current()}
          >
            ×
          </button>
        </div>
        <div className={css.pickerBody}>{children}</div>
      </div>
    </div>
  )
}
