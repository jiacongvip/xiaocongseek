import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { pluginRoot } from './paths.js'
import { loadAuthSettings } from './auth.js'

type DayLedger = { date: string; attempts: number; events: { at: number; spaceId: string; taskId: string }[] }

const file = () => join(pluginRoot(), 'quota-ledger.json')

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function load(): DayLedger {
  const date = today()
  if (!existsSync(file())) return { date, attempts: 0, events: [] }
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8'))
    if (raw.date !== date) return { date, attempts: 0, events: [] }
    return { date, attempts: Number(raw.attempts) || 0, events: Array.isArray(raw.events) ? raw.events.slice(-200) : [] }
  } catch {
    throw new Error('发布插件额度账本损坏，已保留原文件')
  }
}

function save(ledger: DayLedger) {
  mkdirSync(dirname(file()), { recursive: true, mode: 0o700 })
  const tmp = `${file()}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(ledger, null, 2), { flag: 'wx', mode: 0o600 })
    renameSync(tmp, file())
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp)
  }
}

/** Effective used = baseline.priorUsed (once/day semantics: baseline applies as floor for first day only is wrong).
 * Correct approach: baseline.priorUsed is the inherited used count for "today" when ledger is empty/new,
 * then ledger attempts accumulate on top for this plugin. Across days, baseline is historical note only and attempts reset by date.
 */
export function currentUsage() {
  const s = loadAuthSettings()
  const ledger = load()
  const baseline = s.quotaBaseline?.priorUsed || 0
  // Only on the Beijing day the baseline was acknowledged, inherit priorUsed so remaining quota is not amplified.
  const sameDay = !!s.quotaBaseline && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s.quotaBaseline.acknowledgedAt)) === ledger.date
  const attempts = ledger.attempts + (sameDay ? baseline : 0)
  return { date: ledger.date, attempts, rawAttempts: ledger.attempts, baselineApplied: sameDay ? baseline : 0, limit: s.dailyPublishLimit }
}

export function assertQuotaAvailable(increment = 1) {
  const s = loadAuthSettings()
  if (!s.permissionsEnforced) return { ok: true as const }
  if (s.dailyPublishLimit == null) return { ok: true as const } // allow_when_missing
  if (s.dailyPublishLimit <= 0) return { ok: false as const, reason: '日发布额度为0或无效，明确拒绝' }
  if (!s.quotaBaseline) return { ok: false as const, reason: '缺少可信额度基线确认' }
  const usage = currentUsage()
  if (usage.attempts + increment > s.dailyPublishLimit) return { ok: false as const, reason: `今日发布次数已达上限（已用${usage.attempts}/${s.dailyPublishLimit}，含基线）` }
  return { ok: true as const, usage }
}

export function recordAttempt(spaceId: string, taskId: string) {
  const ledger = load()
  ledger.attempts += 1
  ledger.events.push({ at: Date.now(), spaceId, taskId })
  save(ledger)
  return currentUsage()
}
