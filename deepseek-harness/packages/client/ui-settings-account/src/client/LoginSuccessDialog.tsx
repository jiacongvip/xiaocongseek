/** Confirmation after New API claim; OK returns focus to the harness workbench. */
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountKey } from './locales.ts'
import css from './SignInDialog.module.css'

/** @param props - localized copy and dismiss action. @returns success dialog. */
export function LoginSuccessDialog({ confirm, t }: {
  confirm: () => void
  t: (key: AccountKey) => string
}) {
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
