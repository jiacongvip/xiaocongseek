/** Update panel item for the General settings section.
 *  Talks to the shell-owned xiaocong-updater routes; polls the status
 *  endpoint while mounted so download progress stays live. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './UpdatePanel.module.css'

interface UpdateDownload {
  phase: 'idle' | 'downloading' | 'done' | 'failed'
  progress: number
  downloadedBytes: number
  totalBytes: number
  path: string | null
}

interface UpdateStatus {
  success: boolean
  currentVersion: string
  feedUrl: string
  /** Shell host platform; Windows opens the installer instead of mounting a DMG. */
  platform?: string
  checking: boolean
  lastCheckAt: string | null
  latest: { version: string; notes?: string; minVersion?: string } | null
  hasUpdate: boolean
  updateRequired: boolean
  download: UpdateDownload
  error?: string
  autoCheck: boolean
}

const POLL_MS = 5_000
/** Progress needs a much tighter loop than an idle status poll. */
const DOWNLOAD_POLL_MS = 400

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb >= 100 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`
}

export function UpdatePanel({ t }: PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>) {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/xiaocong/update/status', { headers: { accept: 'application/json' } })
      const body = await response.json() as UpdateStatus
      if (body?.success && mounted.current) setStatus(body)
    } catch {
      // Shell route missing on very old builds; stay quiet.
    }
  }, [])

  const downloadPhase = status?.download.phase

  useEffect(() => {
    mounted.current = true
    void refresh()
    // Poll fast while a download is running so the progress bar actually moves.
    const timer = setInterval(() => { void refresh() }, downloadPhase === 'downloading' ? DOWNLOAD_POLL_MS : POLL_MS)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [refresh, downloadPhase])

  const act = async (path: string) => {
    if (busy) return
    setBusy(true)
    try {
      const response = await fetch(path, { method: 'POST', headers: { accept: 'application/json' } })
      const body = await response.json() as UpdateStatus
      if (body?.success && mounted.current) setStatus(body)
    } catch {
      // Keep previous state; the next poll retries the read.
    } finally {
      setBusy(false)
    }
  }

  const percent = Math.round((status?.download.progress ?? 0) * 100)
  const downloading = status?.download.phase === 'downloading'
  const downloaded = status?.download.phase === 'done'
  const hasUpdate = status?.hasUpdate ?? false
  const isWindows = status?.platform === 'win32'
  const stateText = status === null
    ? '…'
    : status.checking
      ? t('general.update.checking')
      : hasUpdate
        ? t('general.update.available', { version: status.latest?.version ?? '' })
        : t('general.update.upToDate')
  const dotClass = status === null || status.checking ? css.dotNeutral : hasUpdate ? css.dotNew : css.dotOk

  return (
    <div className={css.panel}>
      <div className={css.header}>
        <p className={css.title}>{t('general.update.title')}</p>
        <span className={css.auto}>{t('general.update.auto')}</span>
      </div>

      <div className={css.statusRow}>
        <span className={dotClass} />
        <span className={css.state}>{stateText}</span>
        <span className={css.secondary}>
          {t('general.currentVersion', { version: status?.currentVersion ?? '' })}
        </span>
      </div>

      {status?.lastCheckAt !== null && status?.lastCheckAt !== undefined && (
        <p className={css.secondary}>
          {t('general.update.lastCheck', { time: new Date(status.lastCheckAt).toLocaleString() })}
        </p>
      )}

      {hasUpdate && status?.latest?.notes !== undefined && status.latest.notes !== '' && (
        <div className={css.notes}>
          <p className={css.notesTitle}>{t('general.update.notes')}</p>
          <p className={css.notesBody}>{status.latest.notes}</p>
          {status.updateRequired && <p className={css.required}>{t('general.update.required')}</p>}
        </div>
      )}

      {downloading && (
        <div className={css.progressBlock}>
          <div className={css.progressTrack}>
            <div className={css.progressFill} style={{ width: `${percent}%` }} />
          </div>
          <div className={css.progressMeta}>
            <span className={css.progressPercent}>{t('general.update.downloading', { percent })}</span>
            <span className={css.secondary}>
              {formatBytes(status?.download.downloadedBytes ?? 0)}
              {(status?.download.totalBytes ?? 0) > 0 ? ` / ${formatBytes(status?.download.totalBytes ?? 0)}` : ''}
            </span>
          </div>
        </div>
      )}

      {downloaded && status?.download.path !== null && (
        <p className={css.downloaded}>
          {isWindows
            ? t('general.update.downloadedWin', { path: status.download.path })
            : t('general.update.downloaded', { path: status.download.path })}
        </p>
      )}

      {status?.error !== undefined && status.error !== '' && (
        <p className={css.error}>
          {status.latest === null
            ? t('general.update.feedError', { error: status.error })
            : t('general.update.actionError', { error: status.error })}
        </p>
      )}

      <div className={css.actions}>
        <button
          type="button"
          className={css.buttonSecondary}
          disabled={busy || status?.checking === true}
          onClick={() => { void act('/xiaocong/update/check') }}
        >
          {t('general.update.check')}
        </button>
        {hasUpdate && (
          <button
            type="button"
            className={css.buttonPrimary}
            disabled={busy || downloading}
            onClick={() => { void act('/xiaocong/update/download') }}
          >
            {downloading ? t('general.update.downloading', { percent }) : t('general.update.download')}
          </button>
        )}
        {downloaded && (
          <button
            type="button"
            className={css.buttonPrimary}
            disabled={busy}
            onClick={() => { void act('/xiaocong/update/install') }}
          >
            {isWindows ? t('general.update.runInstaller') : t('general.update.install')}
          </button>
        )}
      </div>
    </div>
  )
}
