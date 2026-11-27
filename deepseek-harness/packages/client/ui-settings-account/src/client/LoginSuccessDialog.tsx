/** Confirmation after New API claim; OK returns focus to the harness workbench. */
import { useEffect, useRef } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountKey } from './locales.ts'
import css from './SignInDialog.module.css'

/**
 * Auto-dismiss delay: the dialog is informational, so it must never trap a user
 * whose window-level pointer routing is broken (onboarding drag band under a
 * freshly-focused window), while still showing the claim result once.
 */
const AUTO_DISMISS_MS = 8000

/** @param props - localized copy and dismiss action. @returns success dialog. */
export function LoginSuccessDialog({ confirm, t }: {
  confirm: () => void
  t: (key: AccountKey) => string
}) {
  const dismiss = useRef(confirm)
  dismiss.current = confirm
  useEffect(() => {
    const timer = window.setTimeout(() => { dismiss.current() }, AUTO_DISMISS_MS)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      dismiss.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  return <Modal open headless title={t('loginSuccessTitle')} onClose={confirm} className={css.dialog as string}>
    <div className={css.content}>
      <div className={css.header}>
        <h2 className={css.title}>{t('loginSuccessTitle')}</h2>
      </div>
      <p className={css.description}>{t('loginSuccessDescription')}</p>
    </div>
    <div className={css.actions}>
      <Button variant="primary" className={css.primaryButton} onClick={confirm}>{t('loginSuccessConfirm')}</Button>
    </div>
  </Modal>
}
