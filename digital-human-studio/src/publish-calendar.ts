import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isSpaceId, spaceAssetRoot, type SpaceStore } from './spaces.js'
import { loadStudioHistory } from './studio-history.js'

export type AutoSendState = {
  /** 到点自动发的执行结果。`done` 只代表执行器返回，未核验平台是否真的发出。 */
  state: 'idle' | 'running' | 'done' | 'failed' | 'unknown'
  taskId?: string
  at?: number
  error?: string
}
export type PublishPlan = {
  id: string; title: string; scheduledAt: string; platform: string; notes: string
  status: 'pending' | 'published'; historyId: string; createdAt: number; updatedAt: number
  /** 用户在日历上勾选「到点自动发」 */
  autoSend?: boolean
  /** 调度器写回的执行状态，不参与人工状态 */
  auto?: AutoSendState
}
const idPattern = /^pub-[a-f0-9-]{36}$/
export function requireCalendarSpace(store: SpaceStore, value: unknown): string {
  if (typeof value !== 'string' || !isSpaceId(value) || !store.spaces.some(s => s.id === value)) throw new Error('请选择有效公司')
  return value
}
/** datetime-local is always Beijing time, not the browser or host timezone. */
export function normalizePublishTime(value: unknown): string {
  const raw = String(value || '')
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00)?(?:\+08:00)?$/.exec(raw)
  if (!match) throw new Error('日期格式无效，请使用北京时间 YYYY-MM-DDTHH:mm')
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute))
  if (year < 2000 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59) throw new Error('日期或时间无效')
  return `${raw.slice(0, 16)}+08:00`
}
export function publishDay(value: string): string { return normalizePublishTime(value).slice(0, 10) }
/** 排期时间（北京时间字符串）转毫秒；坏值返回 NaN。 */
export function planDueAt(plan: { scheduledAt: string }): number {
  try {
    const t = normalizePublishTime(plan.scheduledAt)
    const ms = Date.parse(`${t.slice(0, 16)}:00+08:00`)
    return Number.isFinite(ms) ? ms : Number.NaN
  } catch {
    return Number.NaN
  }
}
export function calendarPath(spaceId: string): string {
  if (!isSpaceId(spaceId)) throw new Error('非法公司ID')
  return join(spaceAssetRoot(spaceId), 'publish-calendar.json')
}
export function loadPublishCalendar(spaceId: string): PublishPlan[] {
  const file = calendarPath(spaceId)
  if (!existsSync(file)) return []
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (data.version !== 1 || !Array.isArray(data.items) || !data.items.every((p: PublishPlan) => p && idPattern.test(p.id) && typeof p.title === 'string' && normalizePublishTime(p.scheduledAt) === p.scheduledAt && ['pending', 'published'].includes(p.status))) throw new Error()
    return data.items
  } catch { throw new Error('发布日历文件格式损坏，已保留原文件，请先恢复备份') }
}
function saveCalendar(spaceId: string, items: PublishPlan[]) {
  const file = calendarPath(spaceId)
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, JSON.stringify({ version: 1, items }, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temp, file)
  } finally { if (existsSync(temp)) unlinkSync(temp) }
}
export function calendarWorks(spaceId: string) {
  // 自己剪的 mp4 走 /works/import 落成 xdh-export-video；数字人视频、语音、图片同样可排期。
  return loadStudioHistory(spaceId)
    .filter(row => row.status === 'SUCCESS' && ['xdh-avatar-video', 'xdh-export-video', 'xdh-audio', 'ximg', 'xdh-image'].includes(row.kind))
    .map(row => ({ id: row.id, title: row.title, kind: row.kind, at: row.at, copyTitle: (row as { copy?: { title?: string } }).copy?.title || '', coverUrl: (row as { copy?: { coverUrl?: string } }).copy?.coverUrl || '' }))
}
function text(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || value.trim().length > limit) throw new Error(`${label}格式无效或过长`)
  return value.trim()
}
export function upsertPublishPlan(spaceId: string, input: Record<string, unknown>, createId?: string): PublishPlan {
  const items = loadPublishCalendar(spaceId)
  const id = input.id == null || input.id === '' ? (createId || `pub-${randomUUID()}`) : String(input.id)
  if (!idPattern.test(id)) throw new Error('排期ID无效')
  const previous = items.find(row => row.id === id)
  if (input.id && !previous) throw new Error('找不到这家公司的排期，请刷新后重试')
  const title = text(input.title, '标题', 120)
  if (!title) throw new Error('标题不能为空')
  const scheduledAt = normalizePublishTime(input.scheduledAt)
  const platform = text(input.platform ?? '', '平台', 60)
  const notes = text(input.notes ?? '', '备注', 2000)
  const historyId = text(input.historyId ?? '', '成片ID', 200)
  // Existing missing links may be kept when editing; new links must belong to this company.
  if (historyId && !(previous && previous.historyId === historyId) && !calendarWorks(spaceId).some(row => row.id === historyId)) throw new Error('关联成片不属于当前公司或尚未完成')
  if (input.status !== 'pending' && input.status !== 'published') throw new Error('排期状态无效')
  const autoSend = input.autoSend === true
  // 时间/平台/成片变了就等于换了一次排期，旧的自动发结果不能沿用；
  // 从「不自动」改成「自动」也算重新武装，允许修好发布包后再试一次（仅在窗口内）。
  const changed = !previous || previous.scheduledAt !== scheduledAt || previous.platform !== platform || previous.historyId !== historyId
  const rearmed = autoSend && !previous?.autoSend
  const auto = changed || rearmed ? undefined : previous?.auto
  const plan: PublishPlan = {
    id, title, scheduledAt, platform, notes, historyId, status: input.status,
    createdAt: previous?.createdAt || Date.now(), updatedAt: Date.now(),
    autoSend,
    auto,
  }
  saveCalendar(spaceId, [plan, ...items.filter(row => row.id !== id)].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)))
  return plan
}
export function deletePublishPlan(spaceId: string, id: unknown): boolean {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new Error('排期ID无效')
  const items = loadPublishCalendar(spaceId)
  if (!items.some(row => row.id === id)) return false
  saveCalendar(spaceId, items.filter(row => row.id !== id))
  return true
}
/** 平台确认发出后，把排期自动标成已发，省得用户再手动点「标已发」。 */
export function markPlanPublished(spaceId: string, id: string): PublishPlan | null {
  const items = loadPublishCalendar(spaceId)
  const plan = items.find(row => row.id === id)
  if (!plan) return null
  if (plan.status === 'published') return plan
  const next: PublishPlan = { ...plan, status: 'published', updatedAt: Date.now() }
  saveCalendar(spaceId, items.map(row => row.id === id ? next : row))
  return next
}

/** 调度器写回自动发状态；只动 auto 字段，不改用户填的时间/文案/人工状态。 */
export function setPlanAuto(spaceId: string, id: string, auto: AutoSendState): PublishPlan | null {
  const items = loadPublishCalendar(spaceId)
  const plan = items.find(row => row.id === id)
  if (!plan) return null
  const next: PublishPlan = { ...plan, auto }
  saveCalendar(spaceId, items.map(row => row.id === id ? next : row))
  return next
}
