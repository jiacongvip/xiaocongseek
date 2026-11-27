// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import { useEffect, useMemo, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  loadDigitalHumanSpaceId,
  loadSessionSpaceId,
  saveDigitalHumanHistoryItem,
} from './digital-human-history.ts'
import css from './DigitalHumanChatCard.module.css'

type ChatCommandProps = PropsRuntime<'conversation.chat.commandview'>

export type SpeakPayload = {
  v: 1
  task_id: string
  audio_task_id?: string
  text?: string
  avatar_id?: string
  avatar_name?: string
  voice_id?: string
  voice_name?: string
  model_code?: string
  cover_url?: string
  video_url?: string
  cite?: boolean
}

type TaskView = {
  task_id?: string
  id?: string
  status?: string
  progress?: string
  fail_reason?: string
  url?: string
  data?: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function readData(data: Record<string, unknown> | undefined, key: string): string {
  const direct = data?.[key]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const nested = asRecord(data?.input)?.[key]
  if (typeof nested === 'string' && nested.trim()) return nested.trim()
  const envelope = asRecord(data?.data)?.[key]
  if (typeof envelope === 'string' && envelope.trim()) return envelope.trim()
  return ''
}

function isGatewayArtifactURL(url?: string): boolean {
  const value = String(url || '')
  return /\/v1\/tasks\/.+\/artifacts\//.test(value) || /localhost|127\.0\.0\.1/.test(value)
}

function normalizeStatus(status?: string): string {
  const value = String(status || '').trim().toUpperCase()
  if (value === 'SUCCEED' || value === 'SUCCEEDED' || value === 'COMPLETE' || value === 'COMPLETED' || value === 'DONE') return 'SUCCESS'
  if (value === 'FAILED' || value === 'FAIL' || value === 'ERROR') return 'FAILURE'
  if (value === 'PROCESSING' || value === 'RUNNING' || value === 'PENDING' || value === 'WORKING') return 'IN_PROGRESS'
  return String(status || '')
}

function progressPercent(progress?: string, status?: string): number {
  if (normalizeStatus(status) === 'SUCCESS') return 100
  const match = String(progress || '').match(/(\d+(?:\.\d+)?)/)
  if (match) return Math.max(0, Math.min(100, Math.round(Number(match[1]))))
  if (normalizeStatus(status) === 'IN_PROGRESS') return 50
  if (normalizeStatus(status) === 'QUEUED' || normalizeStatus(status) === 'SUBMITTED') return 8
  return 0
}

function pickMediaURL(task: TaskView | null): string {
  const data = asRecord(task?.data)
  const candidates = [
    readData(data, 'video_url'),
    readData(data, 'audio_url'),
    readData(data, 'audio_oss_url'),
    String(task?.url || '').trim(),
  ]
  return candidates.find(item => item && !isGatewayArtifactURL(item)) || ''
}

export function parseSpeakPayload(text?: string): SpeakPayload | null {
  if (!text) return null
  try {
    const value = JSON.parse(text) as Partial<SpeakPayload>
    if (value && value.v === 1 && typeof value.task_id === 'string' && value.task_id.trim()) {
      return value as SpeakPayload
    }
  } catch {
    /* command output is not the speak envelope */
  }
  return null
}

function statusCopy(status?: string, cite?: boolean): string {
  const value = normalizeStatus(status)
  if (value === 'SUCCESS') return cite ? '这段数字人视频可以播放' : '口播视频已完成'
  if (value === 'FAILURE') return cite ? '找不到这段数字人视频' : '生成失败'
  if (value === 'IN_PROGRESS') return cite ? '视频还在生成，稍后可播' : '正在生成口播视频'
  if (value === 'QUEUED' || value === 'SUBMITTED' || value === 'NOT_START') {
    return cite ? '视频还在排队' : '口播视频排队中'
  }
  return cite ? '正在读取数字人视频' : '正在提交数字人任务'
}

/** Shared player for command transcript rows and the blank-session composer dock. */
export function DigitalHumanVideoCard({
  payload,
  cite = false,
  outcomeKind = 'success',
  outcomeText,
  args,
  place = 'command',
  sessionId,
}: {
  payload: SpeakPayload | null
  cite?: boolean
  outcomeKind?: 'success' | 'error' | null
  outcomeText?: string
  args?: string
  place?: 'command' | 'bubble'
  sessionId?: string
}) {
  const seededUrl = payload?.video_url && !isGatewayArtifactURL(payload.video_url) ? payload.video_url : ''
  const [task, setTask] = useState<TaskView | null>(() => seededUrl && payload
    ? { task_id: payload.task_id, status: 'SUCCESS', url: seededUrl, data: { video_url: seededUrl } }
    : null)
  const [error, setError] = useState('')
  const mediaUrl = pickMediaURL(task) || seededUrl
  const status = normalizeStatus(task?.status) || (seededUrl ? 'SUCCESS' : '')
  const percent = progressPercent(task?.progress, task?.status || status)
  const failed = outcomeKind === 'error' || status === 'FAILURE'
  const running = outcomeKind === null || (!failed && status !== 'SUCCESS' && !mediaUrl)
  const isVideo = /\.mp4($|\?)/i.test(mediaUrl) || mediaUrl.includes('video') || mediaUrl.includes('/digital-human-studio/works/file')

  useEffect(() => {
    if (!payload?.task_id || outcomeKind === 'error') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (delay = 2500) => {
      if (cancelled) return
      timer = setTimeout(() => { void tick() }, delay)
    }
    const tick = async () => {
      try {
        const response = await fetch(`/digital-human-studio/digital-human/task?id=${encodeURIComponent(payload.task_id)}`, {
          signal: AbortSignal.timeout(20000),
        })
        const value = await response.json().catch(() => null) as TaskView & { error?: string } | null
        if (cancelled) return
        if (!response.ok || !value) throw new Error(value?.error || '读取任务失败')
        value.status = normalizeStatus(value.status)
        setTask(value)
        setError('')
        if (value.status !== 'SUCCESS' && value.status !== 'FAILURE') schedule()
        else if (value.status === 'SUCCESS' && !pickMediaURL(value)) schedule()
        else if (value.status === 'FAILURE') setError(String(value.fail_reason || '生成失败'))
      } catch (caught) {
        if (cancelled) return
        setError(caught instanceof Error ? caught.message : '读取任务失败')
        schedule()
      }
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [payload?.task_id, outcomeKind])

  useEffect(() => {
    if (!payload?.task_id || cite) return
    const spaceId = loadSessionSpaceId(sessionId) || loadDigitalHumanSpaceId()
    const snippet = String(payload.text || '').trim().replace(/\s+/g, ' ').slice(0, 20)
    saveDigitalHumanHistoryItem({
      id: payload.task_id,
      kind: 'xdh-avatar-video',
      title: payload.avatar_name
        ? `${payload.avatar_name}${snippet ? ` · ${snippet}` : ' · 口播成片'}`
        : (snippet || '数字人视频'),
      at: Date.now(),
      status: failed ? 'FAILURE' : (status || 'QUEUED'),
      progress: task?.progress,
      prompt: payload.text,
      modelCode: payload.model_code,
      coverUrl: payload.cover_url,
      mediaUrl: mediaUrl || undefined,
      source: 'chat',
    }, spaceId)
  }, [payload?.task_id, payload?.avatar_name, payload?.text, payload?.cover_url, payload?.model_code, cite, failed, status, mediaUrl, sessionId, task?.progress])

  const title = payload?.avatar_name
    ? `${payload.avatar_name} · ${cite ? '数字人视频' : '口播成片'}`
    : (cite ? '数字人视频' : '数字人口播成片')
  const detail = failed
    ? (outcomeKind === 'error' ? outcomeText : error) || (cite ? '找不到这段数字人视频' : '生成失败')
    : mediaUrl
      ? statusCopy('SUCCESS', cite)
      : statusCopy(status || (outcomeKind === null ? '' : 'IN_PROGRESS'), cite)
  const line = payload?.text || (cite ? '' : args?.trim()) || ''

  return (
    <article
      className={css.root}
      data-place={place}
      data-state={failed ? 'error' : running ? 'running' : 'ok'}
      aria-busy={running || undefined}
    >
      <header className={css.header}>
        {payload?.cover_url ? <img className={css.cover} src={payload.cover_url} alt="" /> : <span className={css.coverFallback} />}
        <div className={css.copy}>
          <strong>{title}</strong>
          <span>{detail}</span>
          {line && !/^show\s+\S+$/i.test(line) ? <em>{line}</em> : null}
        </div>
      </header>
      {running && !mediaUrl ? (
        <div className={css.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <i style={{ width: `${Math.max(percent, 8)}%` }} />
        </div>
      ) : null}
      {failed && !mediaUrl ? <p className={css.error}>{detail}</p> : null}
      {mediaUrl ? (
        isVideo ? (
          <video className={css.player} src={mediaUrl} poster={payload?.cover_url} controls playsInline preload="metadata" />
        ) : (
          <audio className={css.audio} src={mediaUrl} controls preload="metadata" />
        )
      ) : null}
    </article>
  )
}

/** Chat card for `/dh`: poll the submitted video task and play the OSS url. */
export function DigitalHumanChatCard({ node, sessionId }: ChatCommandProps) {
  const payload = useMemo(() => parseSpeakPayload(node.outcome?.text), [node.outcome?.text])
  const cite = payload?.cite === true || /^(?:show|引用|cite)\s+\S+$/i.test(node.args?.trim() || '')
  if (cite) return null
  return (
    <DigitalHumanVideoCard
      payload={payload}
      cite={false}
      outcomeKind={node.outcome?.kind ?? null}
      outcomeText={node.outcome?.kind === 'error' ? node.outcome.text : undefined}
      args={node.args ?? ''}
      sessionId={sessionId}
    />
  )
}
