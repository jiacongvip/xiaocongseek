/** MCP service panel rendered inside the Account settings section. */

import { useCallback, useEffect, useState } from 'react'
import type { AccountKey } from './locales.ts'
import css from './McpPanel.module.css'

interface McpAgent {
  key: string
  label: string
  enabled: boolean
  present: boolean
  error?: string
}

interface McpStatus {
  success: boolean
  running: boolean
  port: number
  url: string
  serverName: string
  toolCount: number
  error?: string
  agents: McpAgent[]
}

interface McpPanelProps {
  t: (key: AccountKey) => string
}

export function McpPanel({ t }: McpPanelProps) {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/xiaocong/mcp/status', { headers: { accept: 'application/json' } })
      const body = await response.json() as McpStatus
      if (body?.success) setStatus(body)
    } catch {
      // The shell route may be unavailable on very old builds; keep the panel quiet.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = async (agent: string, enabled: boolean) => {
    setBusy(true)
    try {
      const response = await fetch('/xiaocong/mcp/bind', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent, enabled }),
      })
      const body = await response.json() as McpStatus
      if (body?.success) setStatus(body)
    } catch {
      // keep the previous state on failure
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!status) return
    try {
      await navigator.clipboard.writeText(JSON.stringify({ xiaocongseek: { url: status.url } }, null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be denied; the JSON stays visible for manual copy
    }
  }

  if (!status) return null

  return (
    <div className={css.panel}>
      <h3 className={css.title}>{t('mcpTitle')}</h3>
      <p className={css.intro}>{t('mcpIntro')}</p>

      <div className={css.statusRow}>
        <span className={status.running ? css.dotOn : css.dotOff} aria-hidden />
        <span className={status.running ? css.running : css.stopped}>{status.running ? t('mcpRunning') : t('mcpStopped')}</span>
        {status.running && (
          <>
            <span className={css.secondary}>{t('mcpAddress')}</span>
            <code className={css.url}>{status.url}</code>
            <span className={css.secondary}>{String(status.toolCount)}{t('mcpToolCount')}</span>
          </>
        )}
        {!status.running && status.error !== undefined && <span className={css.error}>{status.error}</span>}
      </div>

      <div className={css.agents}>
        {status.agents.map(agent => (
          <div key={agent.key} className={css.agentRow}>
            <span className={css.agentLabel}>{agent.label}</span>
            {agent.error !== undefined && <span className={css.error} title={agent.error}>{t('mcpWriteFailed')}</span>}
            <button
              type="button"
              className={agent.enabled ? css.toggleOn : css.toggleOff}
              disabled={busy}
              onClick={() => void toggle(agent.key, !agent.enabled)}
            >
              {agent.enabled ? 'ON' : 'OFF'}
            </button>
          </div>
        ))}
      </div>

      <div className={css.config}>
        <div className={css.configHeader}>
          <span className={css.configTitle}>{t('mcpCopyConfig')}</span>
          <button type="button" className={css.copyButton} onClick={() => void copy()}>{copied ? t('mcpCopied') : t('mcpCopy')}</button>
        </div>
        <p className={css.hint}>{t('mcpCopyHint')}</p>
        <pre className={css.json}>{JSON.stringify({ xiaocongseek: { url: status.url } }, null, 2)}</pre>
      </div>
    </div>
  )
}
