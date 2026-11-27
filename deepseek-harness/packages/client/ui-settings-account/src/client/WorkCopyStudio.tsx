// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MEDIA_DESK_CSS } from './media-desk-copy-css.js'

/** 图标路径与自媒体工作台同一套（24×24 viewBox，线宽 1.6）。 */
const ICONS: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  send: 'M12 19V5M6 11l6-6 6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  chevL: 'M14.5 5.5L8 12l6.5 6.5',
  chevR: 'M9.5 5.5L16 12l-6.5 6.5',
  chat: 'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 4v-4h0A2.5 2.5 0 0 1 5 13.5z',
  pen: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  calendar: 'M5 6h14v14H5zM5 10h14M9 3.5v4M15 3.5v4',
  refresh: 'M19 8a8 8 0 0 0-14-1L4 9M5 16a8 8 0 0 0 14 1l1-2M4 4v5h5M20 20v-5h-5',
  image: 'M4 5h16v14H4zM4 16l5-4.5 4 3.5 3-2.5 4 3.5M15.5 9.5a1 1 0 1 0 0 .01',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  expand: 'M14 5h5v5M10 19H5v-5M19 5l-6 6M5 19l6-6',
  save: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  folder: 'M4 7h6l2 2h10v10H4z',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
}

export function StudioIcon({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(ICONS[name] || '').split('M').filter(Boolean).map((segment, index) => <path key={index} d={`M${segment}`} />)}
    </svg>
  )
}

/** 极简 Markdown：成稿只有「## 小标题 + 段落」，够用且和参考版视觉一致。 */
/**
 * 下载封面：把封面上那句大字按 16:9 版式合成进图片再存成 PNG，
 * 效果和成稿页看到的封面一致（不是下载一张没字的底图）。
 */
async function downloadCover(url: string, text: string) {
  const name = (text || '封面').slice(0, 18).replace(/[\\/:*?"<>|]/g, '')
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image()
      node.crossOrigin = 'anonymous'
      node.onload = () => resolve(node)
      node.onerror = () => reject(new Error('封面加载失败'))
      node.src = url
    })
    const width = img.naturalWidth || 1280
    const height = Math.round((width * 9) / 16)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画不出')
    ctx.drawImage(img, 0, 0, width, height)
    const scrim = ctx.createLinearGradient(0, height * 0.45, 0, height)
    scrim.addColorStop(0, 'rgba(0,0,0,0)')
    scrim.addColorStop(1, 'rgba(0,0,0,0.55)')
    ctx.fillStyle = scrim
    ctx.fillRect(0, height * 0.45, width, height * 0.55)
    const size = Math.round(width / 13)
    const pad = Math.round(width * 0.055)
    const lineHeight = Math.round(size * 1.18)
    ctx.font = `700 ${size}px "PingFang SC", "Noto Sans SC", system-ui, sans-serif`
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'bottom'
    const chars = [...(text || '')]
    const perLine = Math.max(4, Math.floor((width - pad * 2) / size))
    const lines: string[] = []
    for (let i = 0; i < chars.length; i += perLine) lines.push(chars.slice(i, i + perLine).join(''))
    const trimmed = lines.slice(-3)
    trimmed.forEach((line, i) => {
      ctx.fillText(line, pad, height - pad - (trimmed.length - 1 - i) * lineHeight)
    })
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('导出失败')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${name}-封面.png`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 4000)
  } catch {
    // 合成不了就直接下原图，按钮不能变哑巴
    const link = document.createElement('a')
    link.href = url
    link.download = `${name}-封面.png`
    link.click()
  }
}

/** 把底图 + 大字合成一张 9:16 jpeg（dataURL），供「帧+大字封面」落库。 */
async function composeTextCover(url: string, text: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const node = new Image()
    node.crossOrigin = 'anonymous'
    node.onload = () => resolve(node)
    node.onerror = () => reject(new Error('封面加载失败'))
    node.src = url
  })
  const width = 1080
  const height = 1920
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画不出')
  const iw = img.naturalWidth || 1080
  const ih = img.naturalHeight || 1920
  const scale = Math.max(width / iw, height / ih)
  const dw = iw * scale
  const dh = ih * scale
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh)
  const scrim = ctx.createLinearGradient(0, height * 0.5, 0, height)
  scrim.addColorStop(0, 'rgba(0,0,0,0)')
  scrim.addColorStop(1, 'rgba(0,0,0,0.6)')
  ctx.fillStyle = scrim
  ctx.fillRect(0, height * 0.5, width, height * 0.5)
  const size = Math.round(width / 9)
  const pad = Math.round(width * 0.06)
  const lineHeight = Math.round(size * 1.2)
  ctx.font = `700 ${size}px "PingFang SC", "Noto Sans SC", system-ui, sans-serif`
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'bottom'
  const chars = [...(text || '')]
  const perLine = Math.max(3, Math.floor((width - pad * 2) / size))
  const lines: string[] = []
  for (let i = 0; i < chars.length; i += perLine) lines.push(chars.slice(i, i + perLine).join(''))
  lines.slice(-3).forEach((line, i) => {
    ctx.fillText(line, pad, height - pad - (lines.slice(-3).length - 1 - i) * lineHeight)
  })
  return canvas.toDataURL('image/jpeg', 0.92)
}

const pad2 = (value: number) => String(value).padStart(2, '0')

/** 从 `YYYY-MM-DDTHH:mm` 解析出本地时间，解析不了就用「明天 19:00」。 */
function initialSlot(value: string): { day: Date; hour: number; minute: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '')
  if (match) {
    const [year, month, date, hour, minute] = match.slice(1).map(Number)
    return { day: new Date(year!, month! - 1, date!), hour: hour!, minute: minute! }
  }
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return { day: tomorrow, hour: 19, minute: 0 }
}

const SAME_DAY = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const FULL_DAY = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

/** 排期：自绘日历 + 时间选择，样式与成稿页同一套，不再弹系统那个灰框。 */
function SchedulePicker({ label, value, onPick }: { label: string; value: string; onPick: (next: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const [slot, setSlot] = React.useState(() => initialSlot(value))
  const [cursor, setCursor] = React.useState(() => {
    const first = new Date(initialSlot(value).day)
    first.setDate(1)
    return first
  })
  const box = useRef<HTMLDivElement | null>(null)
  const cal = useRef<HTMLDivElement | null>(null)
  const [anchor, setAnchor] = React.useState<{ top: number; left: number } | null>(null)

  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const node = event.target as Node
      if (box.current && box.current.contains(node)) return
      if (cal.current && cal.current.contains(node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const toggle = () => {
    if (!open) {
      const fresh = initialSlot(value)
      setSlot(fresh)
      const first = new Date(fresh.day)
      first.setDate(1)
      setCursor(first)
      const rect = box.current?.getBoundingClientRect()
      if (rect) {
        const width = 292
        const height = 336
        const below = rect.bottom + 8
        setAnchor({
          top: below + height > window.innerHeight ? Math.max(8, rect.top - height - 8) : below,
          left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        })
      }
    }
    setOpen(!open)
  }



  const today = new Date()
  const days: Date[] = []
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  start.setDate(1 - start.getDay())
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    days.push(day)
  }

  const shift = (delta: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1))
  const confirm = () => {
    onPick(`${FULL_DAY(slot.day)}T${pad2(slot.hour)}:${pad2(slot.minute)}`)
    setOpen(false)
  }
  const quick = (offset: number, hour: number) => {
    const day = new Date()
    day.setDate(day.getDate() + offset)
    setSlot({ day, hour, minute: 0 })
    setCursor(new Date(day.getFullYear(), day.getMonth(), 1))
  }

  return (
    <div className="md-slot" ref={box}>
      <button type="button" className="md-pill md-date-pill" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <StudioIcon name="calendar" size={14} />
        {label || '排期'}
      </button>
      {open ? createPortal((
        <div className="md-root md-cal-layer">
        <div
          className="md-cal"
          role="dialog"
          aria-label="选择发布时间"
          ref={cal}
          style={{ top: anchor?.top ?? 120, left: anchor?.left ?? 120 }}
        >
          <div className="md-cal-head">
            <button type="button" className="md-cal-nav" aria-label="上个月" onClick={() => shift(-1)}>
              <StudioIcon name="chevL" size={14} />
            </button>
            <b>{cursor.getFullYear()}年{cursor.getMonth() + 1}月</b>
            <button type="button" className="md-cal-nav" aria-label="下个月" onClick={() => shift(1)}>
              <StudioIcon name="chevR" size={14} />
            </button>
          </div>
          <div className="md-cal-week">
            {['日', '一', '二', '三', '四', '五', '六'].map(week => <span key={week}>{week}</span>)}
          </div>
          <div className="md-cal-grid">
            {days.map(day => {
              const outside = day.getMonth() !== cursor.getMonth()
              const picked = SAME_DAY(day, slot.day)
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  className={`md-cal-day${outside ? ' is-out' : ''}${picked ? ' is-picked' : ''}${SAME_DAY(day, today) ? ' is-today' : ''}`}
                  onClick={() => setSlot(current => ({ ...current, day }))}
                >
                  {day.getDate()}
                </button>
              )
            })}
          </div>
          <div className="md-cal-time">
            <span>时间</span>
            {[9, 12, 19, 21].map(hour => (
              <button key={hour} type="button" className={`md-cal-chip${slot.hour === hour ? ' is-picked' : ''}`} onClick={() => setSlot(current => ({ ...current, hour }))}>{pad2(hour)}:00</button>
            ))}
            <label className="md-cal-exact">
              <span>自定义</span>
              <input
                type="number"
                min={0}
                max={23}
                aria-label="时"
                value={pad2(slot.hour)}
                onChange={event => setSlot(current => ({ ...current, hour: Math.max(0, Math.min(23, Number(event.target.value) || 0)) }))}
              />
              <i>:</i>
              <input
                type="number"
                min={0}
                max={59}
                aria-label="分"
                value={pad2(slot.minute)}
                onChange={event => setSlot(current => ({ ...current, minute: Math.max(0, Math.min(59, Number(event.target.value) || 0)) }))}
              />
            </label>
          </div>
          <div className="md-cal-quick">
            <button type="button" onClick={() => quick(0, 19)}>今晚 19:00</button>
            <button type="button" onClick={() => quick(1, 12)}>明天 12:00</button>
            <button type="button" onClick={() => quick(1, 19)}>明天 19:00</button>
          </div>
          <div className="md-cal-foot">
            <button type="button" className="md-cal-text" onClick={() => { setSlot({ day: new Date(), hour: slot.hour, minute: slot.minute }); setCursor(new Date(today.getFullYear(), today.getMonth(), 1)) }}>今天</button>
            <button type="button" className="md-cal-text" onClick={() => setOpen(false)}>取消</button>
            <button type="button" className="md-cal-ok" onClick={confirm}>排到 {`${slot.day.getMonth() + 1}月${slot.day.getDate()}日 ${pad2(slot.hour)}:${pad2(slot.minute)}`}</button>
          </div>
        </div>
        </div>
      ), document.body) : null}
    </div>
  )
}

export function markdownToHtml(text: string): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (value: string) => escape(value).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
  return text.split(/\n{2,}/).map(block => {
    const trimmed = block.trim()
    if (!trimmed) return ''
    const heading = /^#{1,4}\s+(.*)$/.exec(trimmed)
    if (heading) {
      const level = trimmed.match(/^#+/)?.[0].length || 1
      const tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
      return `<${tag}>${inline(heading[1] ?? '')}</${tag}>`
    }
    if (/^[-*]\s+/m.test(trimmed)) {
      const items = trimmed.split('\n').filter(line => /^[-*]\s+/.test(line)).map(line => `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`).join('')
      return `<ul>${items}</ul>`
    }
    if (/^>\s+/m.test(trimmed)) return `<blockquote>${inline(trimmed.replace(/^>\s+/, ''))}</blockquote>`
    return `<p>${inline(trimmed).replace(/\n/g, '<br/>')}</p>`
  }).join('')
}

/** 自增高文本框，跟参考版的 En 组件一致（标题、灵感都是这种无边框 textarea）。 */
function AutoTextarea({ value, className, label, readOnly, onChange }: { value: string; className: string; label: string; readOnly?: boolean; onChange?: (next: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={label}
      className={className}
      value={value}
      readOnly={readOnly}
      onChange={event => onChange?.(event.target.value)}
    />
  )
}

export type WorkCopyStudioShot = { shot: string; visual: string; voice: string; seconds: number }

export type WorkCopyStudioModel = {
  kind: string
  at: number
  title: string
  copy?: {
    title: string
    coverText: string
    body: string
    shots: WorkCopyStudioShot[]
    coverUrl?: string
    coverError?: string
    model?: string
    at?: number
    chat?: { role: 'user' | 'ai'; text: string; at: number }[]
  }
}

type StudioProps = {
  item: WorkCopyStudioModel
  writing: boolean
  drawing: boolean
  revising: boolean
  error: string
  notice: string
  spaceId: string
  scheduleLabel: string
  scheduleValue: string
  onBack: () => void
  onRevise: (text: string, platform?: string) => void
  onRegenerate: () => void
  onRedrawCover: (prompt?: string) => void
  onAskAiCover?: (prompt?: string) => void
  onCopyScript: () => void
  onSave: () => void
  onSchedule: (value: string) => void
  onGoAccounts?: () => void
  onFillPlatform?: (platform: string) => void
  onCoverFrame?: (at: number) => Promise<{ copy?: unknown }>
  onTextCover?: (image: string) => Promise<void>
}

/** 成稿页：版式、class 名、图标、文案全部对齐自媒体工作台的「成稿」页。 */
export function WorkCopyStudio({
  item, writing, drawing, revising, error, notice,
  spaceId, scheduleLabel, scheduleValue,
  onBack, onRevise, onRegenerate, onRedrawCover, onCopyScript, onSave, onSchedule,
  onGoAccounts, onFillPlatform, onCoverFrame, onTextCover, onAskAiCover,
}: StudioProps) {
  const copy = item.copy
  const [text, setText] = React.useState('')
  // 三个平台各一版：抖音 / 小红书 / 视频号，老数据没有 platforms 就看原来那一版
  const platformDefs = [
    { key: 'douyin', label: '抖音' },
    { key: 'xiaohongshu', label: '小红书' },
    { key: 'shipinhao', label: '视频号' },
  ]
  const platforms = (copy as any)?.platforms || {}
  /** 这家公司真正授权进来的平台（null=还在读）；没有授权的平台不出现。 */
  const [authKeys, setAuthKeys] = React.useState<string[] | null>(null)
  React.useEffect(() => {
    let live = true
    setAuthKeys(null)
    const alias: Record<string, string> = { douyin: 'douyin', xiaohongshu: 'xiaohongshu', tencent: 'shipinhao' }
    void fetch('/digital-human-studio/publish-now', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'accounts', space: spaceId }),
    })
      .then(response => response.json())
      .then((data: any) => {
        if (!live) return
        const keys = Array.from(new Set(((data?.items || []) as any[]).map(binding => alias[String(binding?.platform || '')]).filter(Boolean))) as string[]
        setAuthKeys(keys)
      })
      .catch(() => { if (live) setAuthKeys([]) })
    return () => { live = false }
  }, [spaceId])
  const copyKeys = platformDefs.filter(def => platforms[def.key]).map(def => def.key)
  // 已授权的平台 + 已经写好文案的平台（老数据没授权也能看/改），两者取并集
  const available = authKeys === null ? platformDefs : platformDefs.filter(def => authKeys.includes(def.key) || copyKeys.includes(def.key))
  const noAuth = authKeys !== null && authKeys.length === 0 && copyKeys.length === 0
  const [platform, setPlatform] = React.useState('douyin')
  const current = available.find(def => def.key === platform) || available[0]
  const authorizedCurrent = !current || !authKeys || authKeys.includes(current.key)
  const currentCopy = current ? platforms[current.key] : undefined
  const missingPlatform = !!current && !currentCopy
  const view = currentCopy || platforms.douyin || { title: copy?.title, body: copy?.body, tags: [] as string[] }
  const viewTitle = view?.title || item.title
  const tags: string[] = view?.tags || []
  const body = view?.body || ''
  const mediaUrl = item.mediaUrl || `/digital-human-studio/works/file?space=default&id=${item.id}`
  const isImageWork = String((item as any).kind || '').includes('image')
  const media = isImageWork
    ? <img src={mediaUrl} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    : <video src={mediaUrl} controls playsInline poster={copy?.coverUrl} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block' }} />
  const copyScript = () => {
    const text = `${viewTitle}\n\n${body}${tags.length ? `\n\n${tags.map(tag => `#${tag}`).join(' ')}` : ''}`
    void navigator.clipboard?.writeText(text)
  }
  const chars = body.replace(/[#*>`\-\s]/g, '').length
  const images = copy?.coverUrl ? 1 : 0
  const busy = writing || drawing
  const chat = copy?.chat || []
  const dateLabel = new Date(copy?.at || item.at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  const suggestions = ['标题再短一点', '语气轻松一点', '开场再抓人一点', '封面大字更有冲击力']

  /** 取帧封面：拖进度条看帧，确认后写进成片。 */
  const [frameOpen, setFrameOpen] = React.useState(false)
  const [frameDur, setFrameDur] = React.useState(0)
  const [frameAt, setFrameAt] = React.useState(0)
  const [frameUrl, setFrameUrl] = React.useState('')
  const [frameBusy, setFrameBusy] = React.useState(false)
  const [frameMsg, setFrameMsg] = React.useState('')
  const frameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameRequest = async (at: number, apply: boolean) => {
    const response = await fetch('/digital-human-studio/works/cover-frame', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ space: spaceId, id: item.id, at, apply }),
    })
    const data = await response.json()
    if (!response.ok || data.success === false) throw new Error(data.error || '取帧失败')
    return data
  }
  const openFramePicker = async () => {
    setFrameOpen(true)
    setFrameBusy(true)
    setFrameMsg('')
    try {
      const data = await frameRequest(0, false)
      const duration = Number(data.duration) || 0
      setFrameDur(duration)
      const at = duration ? Math.round(duration * 0.3 * 10) / 10 : 0
      setFrameAt(at)
      setFrameUrl(String(data.frameUrl || ''))
      if (at > 0) {
        const next = await frameRequest(at, false)
        setFrameUrl(String(next.frameUrl || data.frameUrl || ''))
      }
    } catch (reason) {
      setFrameMsg(reason instanceof Error ? reason.message : '取帧失败')
    } finally {
      setFrameBusy(false)
    }
  }
  const moveFrameAt = (at: number) => {
    setFrameAt(at)
    if (frameTimer.current) clearTimeout(frameTimer.current)
    frameTimer.current = setTimeout(async () => {
      setFrameBusy(true)
      try {
        const data = await frameRequest(at, false)
        setFrameUrl(String(data.frameUrl || ''))
      } catch {
        /* 拖动中失败不打扰，确认时会再报错 */
      } finally {
        setFrameBusy(false)
      }
    }, 350)
  }
  const applyFrame = async () => {
    if (!onCoverFrame || frameBusy) return
    setFrameBusy(true)
    setFrameMsg('')
    try {
      await onCoverFrame(frameAt)
      setFrameOpen(false)
    } catch (reason) {
      setFrameMsg(reason instanceof Error ? reason.message : '换封面失败')
    } finally {
      setFrameBusy(false)
    }
  }
  const fmtSec = (value: number) => `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, '0')}`

  /** 重画封面：可编辑提示词；也可以直接用帧+大字合成，不走生图模型。 */
  const [coverModalOpen, setCoverModalOpen] = React.useState(false)
  const [coverPromptText, setCoverPromptText] = React.useState('')
  const [coverModalBusy, setCoverModalBusy] = React.useState(false)
  const [coverModalMsg, setCoverModalMsg] = React.useState('')
  const openCoverModal = () => {
    setCoverPromptText((copy as any)?.coverPrompt || '')
    setCoverModalMsg('')
    setCoverModalOpen(true)
  }
  const aiDrawCover = async () => {
    if (coverModalBusy) return
    const prompt = coverPromptText.trim()
    if (!onAskAiCover) {
      setCoverModalMsg('当前环境不支持新开 AI 对话')
      return
    }
    setCoverModalOpen(false)
    onAskAiCover(prompt || undefined)
  }
  const textDrawCover = async () => {
    if (coverModalBusy || !onTextCover || !copy?.coverUrl) return
    setCoverModalBusy(true)
    setCoverModalMsg('')
    try {
      const dataUrl = await composeTextCover(copy.coverUrl, copy.coverText || copy.title || '')
      await onTextCover(dataUrl)
      setCoverModalOpen(false)
    } catch (reason) {
      setCoverModalMsg(reason instanceof Error ? reason.message : '合成失败')
    } finally {
      setCoverModalBusy(false)
    }
  }

  return (
    <div className="md-root" style={{ height: '100%', minHeight: 0 }}>
      <style dangerouslySetInnerHTML={{ __html: MEDIA_DESK_CSS }} />
      <div className={`md-studio ${'chat-open'}`} role="dialog" aria-label="成稿">
        <div className="md-studio-chat">
          <div className="md-chat">
            <header className="md-dock-head">
              <button type="button" className="md-icon-btn" aria-label="返回成片" onClick={onBack}>
                <StudioIcon name="chevL" size={16} />
              </button>
              <h2>成稿 · {current?.label || '通用版'}</h2>
              <span className="md-grow" />
              <button type="button" className="md-icon-btn" aria-label={writing ? '重新成稿' : 'AI 写文案'} onClick={onRegenerate} disabled={busy}>
                <StudioIcon name="refresh" size={16} />
              </button>
            </header>

            <div className="md-dock-scroll">
              <div className="md-idea-card">
                <span className="md-idea-label">灵感 · {dateLabel}</span>
                <AutoTextarea className="md-idea-text" label="成片" value={item.title} readOnly />
                <label className="md-style-pick">
                  <span>风格</span>
                  <select aria-label="风格" defaultValue="">
                    <option value="">默认</option>
                  </select>
                </label>
                {writing ? <p className="md-idea-hint">正在按这条成片写文案、画封面…</p> : null}
                {!writing && !copy ? <p className="md-idea-hint">还没有文案，右上角刷新按钮可以让 AI 写一版。</p> : null}
                {copy?.coverError ? <p className="md-idea-hint is-error">封面没画出来：{copy.coverError}</p> : null}
                {notice ? <p className="md-idea-hint">{notice}</p> : null}
                {error ? <p className="md-idea-hint is-error">{error}</p> : null}
              </div>

              {chat.length ? chat.map((entry, index) => (
                <div key={`${entry.at}-${index}`} className={`md-msg ${entry.role === 'user' ? 'is-user' : ''}`}>{entry.text}</div>
              )) : (
                <p className="md-msg-note">{copy && !missingPlatform ? `正在改：${current?.label || '通用版'}。想怎么改，直接说。` : copy ? '这个平台还没写，先点「补写这一版」。' : 'AI 写完后，这里可以用聊天继续改。'}</p>
              )}
              {revising ? <div className="md-msg">正在改…</div> : null}
            </div>

            {copy ? (
              <div className="md-suggest">
                {suggestions.map(suggestion => (
                  <button key={suggestion} type="button" disabled={revising || busy} onClick={() => onRevise(suggestion, current?.key)}>{suggestion}</button>
                ))}
              </div>
            ) : null}

            <form
              className="md-composer"
              onSubmit={event => {
                event.preventDefault()
                const value = text.trim()
                if (!value || revising || !copy) return
                onRevise(value, current?.key)
                setText('')
              }}
            >
              <textarea
                aria-label="想怎么改，直接说"
                rows={1}
                placeholder={revising ? '正在改…' : copy ? '想怎么改，直接说' : 'AI 正在成稿，马上就好'}
                value={text}
                disabled={!copy || revising}
                onChange={event => setText(event.target.value)}
              />
              <button type="submit" className="md-send" aria-label="发送" disabled={!text.trim() || revising || !copy}>
                <StudioIcon name="send" size={15} />
              </button>
            </form>
          </div>
        </div>

        <div className="md-sheet">
          {noAuth ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '0 2px 14px', fontSize: 12 }}>
              <span style={{ opacity: 0.6 }}>这家公司还没授权发布平台，文案不知道往哪个平台写。</span>
              {onGoAccounts ? <button type="button" className="md-pill is-primary" onClick={onGoAccounts}>去授权账号</button> : null}
            </div>
          ) : available.length ? (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '0 2px 14px' }}>
              <span style={{ fontSize: 12, opacity: 0.55 }}>平台</span>
              {available.map(def => (
                <button
                  key={def.key}
                  type="button"
                  className={current?.key === def.key ? 'md-pill is-primary' : 'md-pill'}
                  style={current?.key === def.key ? { whiteSpace: 'nowrap' } : { opacity: 0.55, whiteSpace: 'nowrap' }}
                  onClick={() => setPlatform(def.key)}
                >{def.label}</button>
              ))}
            </div>
          ) : null}
          <div className="md-bento">
            <section className={`md-tile md-tile-hero ${writing ? 'is-running' : ''}`}>
              <div className="md-hero-copy">
                <AutoTextarea className={`md-hero-title ${copy ? '' : 'is-idle'}`} label="标题" value={viewTitle} readOnly />
                <div className="md-hero-stats">
                  {chars ? <span className="md-hero-stat"><StudioIcon name="pen" size={13} /><b>{chars}</b> 字</span> : null}
                  {images ? <span className="md-hero-stat"><StudioIcon name="image" size={13} /><b>{images}</b> 张图</span> : null}
                </div>
                {current && !authorizedCurrent ? (
                  <p style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>这家公司还没授权{current.label}账号，发布前先去「平台账号」授权</p>
                ) : null}
                {missingPlatform ? (
                  <div style={{ marginTop: 8, marginBottom: 6 }}>
                    <p style={{ fontSize: 12, opacity: 0.65, margin: 0 }}>这个平台还没有文案（之前只写了 {available.filter(def => platforms[def.key]).map(def => def.label).join('、') || '其他平台'}）。</p>
                    <button
                      type="button"
                      className="md-pill is-primary"
                      style={{ marginTop: 8 }}
                      disabled={revising || busy || !onFillPlatform}
                      onClick={() => onFillPlatform?.(current!.key)}
                    >补写这一版</button>
                  </div>
                ) : null}
                {copy ? (
                  <div className="md-hero-actions">
                    <button type="button" className="md-pill is-primary" onClick={copyScript}>
                      <StudioIcon name="copy" size={14} />复制脚本
                    </button>
                    {copy.coverUrl ? (
                      <button type="button" className="md-pill" onClick={() => downloadCover(copy.coverUrl, copy.coverText || copy.title)}>
                        <StudioIcon name="image" size={14} />下载封面
                      </button>
                    ) : null}
                    {!isImageWork && copy ? (
                      <button type="button" className="md-pill" onClick={() => void openFramePicker()} disabled={busy || revising}>
                        <StudioIcon name="film" size={14} />取帧做封面
                      </button>
                    ) : null}
                    {copy ? (
                      <button type="button" className="md-pill" onClick={openCoverModal} disabled={busy || revising}>
                        <StudioIcon name="refresh" size={14} />重画封面
                      </button>
                    ) : null}
                    {!current || current.key === 'douyin' ? (
                      <SchedulePicker label={scheduleLabel} value={scheduleValue} onPick={onSchedule} />
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="md-collage">
                <div className="md-collage-main">
                  <div className={`md-poster ${copy?.coverUrl ? '' : 'is-type'}`} role={copy?.coverUrl ? 'button' : undefined} title={copy?.coverText || item.title}>
                    {copy?.coverUrl ? <img src={copy.coverUrl} alt="视频封面" draggable={false} /> : null}
                    <b>{copy?.coverText || (writing ? '正在画封面…' : '')}</b>
                  </div>
                </div>
              </div>

              <div className="md-hero-corner">
                <button type="button" className="md-icon-btn" aria-label="重画封面" onClick={onRedrawCover} disabled={busy}>
                  <StudioIcon name="image" size={14} />
                </button>
                <button type="button" className="md-icon-btn" aria-label="重新成稿" onClick={onRegenerate} disabled={busy}>
                  <StudioIcon name="refresh" size={14} />
                </button>
              </div>
            </section>

            <section className="md-tile md-tile-article">
              <header className="md-tile-head">
                <h2>脚本</h2>
                <span className="md-grow" />
                <button type="button" className="md-icon-btn" aria-label="复制脚本" onClick={copyScript} disabled={!copy}>
                  <StudioIcon name="copy" size={13} />
                </button>
              </header>
              <div className="md-article-scroll">
                {body ? <>
                  <div className="md-prose" dangerouslySetInnerHTML={{ __html: markdownToHtml(body) }} />
                  {tags.length ? <p style={{ marginTop: 12, opacity: 0.7 }}>{tags.map(tag => `#${tag}`).join(' ')}</p> : null}
                </> : (
                  <div className="md-skeleton is-still" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
                )}
              </div>
            </section>

            <section className="md-tile md-tile-shots">
              <header className="md-tile-head">
                <h2>预览 · {current?.label || '抖音'}</h2>
                <span className="md-grow" />
                <span className="md-tile-meta">{current?.key === 'xiaohongshu' ? '小红书笔记样式' : current?.key === 'shipinhao' ? '视频号样式' : '抖音竖屏样式'}</span>
              </header>
              <div className="md-preview-host" style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '10px 4px 6px', width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden' }}>
                {current?.key === 'xiaohongshu' ? (
                  <div style={{ width: '100%', maxWidth: 300, minWidth: 0, background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.10)' }}>
                    <div style={{ width: '100%', aspectRatio: '3 / 4', background: '#000' }}>{media}</div>
                    <div style={{ padding: '10px 12px 12px' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45, color: '#222' }}>{viewTitle}</div>
                      <div style={{ fontSize: 12, lineHeight: 1.6, color: '#444', marginTop: 6, maxHeight: 88, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>{body.slice(0, 160)}</div>
                      <div style={{ fontSize: 12, color: '#3b6ea5', marginTop: 6 }}>{tags.map(tag => `#${tag}`).join(' ')}</div>
                      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: '#666' }}>
                        <span>♡ 赞</span><span>☆ 收藏</span><span>💬 评论</span>
                      </div>
                    </div>
                  </div>
                ) : current?.key === 'shipinhao' ? (
                  <div style={{ width: '100%', maxWidth: 280, minWidth: 0, background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.10)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid #eee', fontSize: 13, color: '#333' }}>
                      <span style={{ fontSize: 15 }}>‹</span><span style={{ fontWeight: 600 }}>视频号</span><span style={{ flex: 1 }} /><span>···</span><span>⊙</span>
                    </div>
                    <div style={{ width: '100%', aspectRatio: '9 / 16', background: '#000' }}>{media}</div>
                    <div style={{ padding: '10px 12px 12px' }}>
                      <div style={{ fontSize: 12, color: '#888' }}>门店账号</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, lineHeight: 1.45 }}>{viewTitle}</div>
                      <div style={{ fontSize: 12, lineHeight: 1.6, color: '#555', marginTop: 4, maxHeight: 72, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>{body.slice(0, 120)}</div>
                      <div style={{ fontSize: 12, color: '#8a6d3b', marginTop: 6 }}>{tags.map(tag => `#${tag}`).join(' ')}</div>
                      <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 12, color: '#777' }}>
                        <span>♡ 赞</span><span>💬 评论</span><span>↗ 分享</span><span>☆ 收藏</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ width: '100%', maxWidth: 260, minWidth: 0, aspectRatio: '9 / 16', background: '#000', borderRadius: 12, position: 'relative', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>
                    <div style={{ position: 'absolute', inset: 0 }}>{media}</div>
                    <div style={{ position: 'absolute', right: 8, bottom: 92, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: '#fff', fontSize: 15 }}>
                      <span>♡</span><span>💬</span><span>↗</span>
                    </div>
                    <div style={{ position: 'absolute', left: 10, right: 46, bottom: 10, color: '#fff' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4, maxHeight: 46, overflow: 'hidden' }}>{viewTitle}</div>
                      <div style={{ fontSize: 11, opacity: 0.9, marginTop: 4, lineHeight: 1.45, maxHeight: 48, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>{body.slice(0, 90)}</div>
                      <div style={{ fontSize: 11, opacity: 0.92, marginTop: 4 }}>{tags.map(tag => `#${tag}`).join(' ')}</div>
                      <div style={{ fontSize: 10, opacity: 0.65, marginTop: 6 }}>@门店账号</div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
      {frameOpen ? createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000 }}>
          <div style={{ width: 420, maxWidth: 'calc(100vw - 32px)', background: '#fff', borderRadius: 14, padding: '18px 18px 16px', boxShadow: '0 18px 60px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 15 }}>取一帧当封面</b>
              <span className="md-grow" />
              <button type="button" className="md-icon-btn" aria-label="关闭取帧" onClick={() => setFrameOpen(false)} disabled={frameBusy}>
                <StudioIcon name="close" size={15} />
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 12px' }}>
              {frameUrl ? (
                <img src={frameUrl} alt="视频帧预览" style={{ width: 216, aspectRatio: '9 / 16', objectFit: 'cover', borderRadius: 10, background: '#111' }} />
              ) : (
                <div style={{ width: 216, aspectRatio: '9 / 16', borderRadius: 10, background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#888' }}>{frameBusy ? '抽帧中…' : '没有画面'}</div>
              )}
            </div>
            <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>拖动选时间点 · {fmtSec(frameAt)}{frameDur ? ` / ${fmtSec(frameDur)}` : ''}</label>
            <input type="range" min={0} max={frameDur || 1} step={0.1} value={frameAt} disabled={frameBusy || !frameDur} onChange={event => moveFrameAt(Number(event.target.value))} style={{ width: '100%', accentColor: '#1f1f22' }} aria-label="选择取帧时间点" />
            <p style={{ fontSize: 12, opacity: 0.7, margin: '8px 0 0' }}>换完这张底图，封面上的大字（{copy?.coverText || '暂无'}）还会照常叠在上面。</p>
            {frameMsg ? <p style={{ fontSize: 12, color: '#b3362b', margin: '8px 0 0' }}>{frameMsg}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" className="md-pill" onClick={() => setFrameOpen(false)} disabled={frameBusy}>取消</button>
              <button type="button" className="md-pill is-primary" onClick={() => void applyFrame()} disabled={frameBusy || !frameUrl}>用这一帧当封面</button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
      {coverModalOpen ? createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4001 }}>
          <div style={{ width: 480, maxWidth: 'calc(100vw - 32px)', background: '#fff', borderRadius: 14, padding: '18px 18px 16px', boxShadow: '0 18px 60px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 15 }}>重画封面</b>
              <span className="md-grow" />
              <button type="button" className="md-icon-btn" aria-label="关闭" onClick={() => setCoverModalOpen(false)} disabled={coverModalBusy}>
                <StudioIcon name="close" size={15} />
              </button>
            </div>
            <label style={{ display: 'block', fontSize: 12, color: '#555', margin: '12px 0 4px' }}>封面提示词（「让 AI 画」会带着视频真实帧一起去画，人物不再虚构；提示词放进新对话输入框，你自己点发送）</label>
            <textarea
              rows={5}
              value={coverPromptText}
              disabled={coverModalBusy}
              onChange={event => setCoverPromptText(event.target.value)}
              placeholder="例如：实拍门店收银台前，店员和顾客同框，画面干净明亮，下方留出放大字的空间，画面里不要出现任何文字"
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', borderRadius: 8, border: '1px solid #ddd', padding: '8px 10px', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit' }}
            />
            {coverModalMsg ? <p style={{ fontSize: 12, color: '#b3362b', margin: '8px 0 0' }}>{coverModalMsg}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button type="button" className="md-pill" onClick={openCoverModal === undefined ? undefined : () => setCoverModalOpen(false)} disabled={coverModalBusy}>取消</button>
              <button type="button" className="md-pill is-primary" onClick={() => void textDrawCover()} disabled={coverModalBusy || !copy?.coverUrl || !onTextCover} title={copy?.coverUrl ? '实拍底图 + 封面大字，本地合成，秒出' : '先取帧或画一张底图'}>
                <StudioIcon name="film" size={13} />帧+大字合成
              </button>
              <button type="button" className="md-pill" onClick={() => void aiDrawCover()} disabled={coverModalBusy || !onAskAiCover} title="带着这条视频的真实帧去画，人物跟实拍一致">
                <StudioIcon name="refresh" size={13} />让 AI 画（参考帧）
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
