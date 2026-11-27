import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_DIGITAL_HUMAN_SPACE_ID, loadSessionSpaceId } from './digital-human-history.ts'
import css from './DigitalHumanComposerButton.module.css'

type ComposerButtonProps = PropsRuntime<'conversation.input.left'> & {
  onOpenEditor?: () => void
}

type MaterialItem = {
  id: string
  fileName?: string
  name?: string
  kind?: string
  path?: string
  durationSec?: number
  slotLabel?: string
}

type OutputMode = 'both' | 'mp4' | 'draft'

const OUTPUT_MODE_KEY = 'xiaocong.quickEdit.outputMode'
const OUTPUT_MODES: { id: OutputMode; label: string; hint: string }[] = [
  { id: 'both', label: '成片 + 草稿', hint: '直出 mp4 并同步导出剪映多轨草稿' },
  { id: 'mp4', label: '仅直出 mp4', hint: '只渲染成片进成片库，不导出剪映草稿' },
  { id: 'draft', label: '仅剪映草稿', hint: '跳过视频编码，1–2 秒秒出剪映草稿' },
]

function loadOutputMode(): OutputMode {
  try {
    const raw = localStorage.getItem(OUTPUT_MODE_KEY)
    if (raw === 'both' || raw === 'mp4' || raw === 'draft') return raw
  } catch { /* ignore */ }
  return 'both'
}

type QuickPreset = {
  id: string
  title: string
  desc: string
  buildPrompt: (paths: string[], outputMode: OutputMode) => string
}

const QUICK_PRESETS: QuickPreset[] = [
  {
    id: 'trendy-koubo-red',
    title: '网感口播 · 高级红（推荐）',
    desc: '双行反色大标题 + 思源粗宋中英双语错落字幕 + 关键词高级红放大弹出 + 去气口 + 金句缩放 + BGM',
    buildPrompt: (paths, outputMode) => {
      const modeClause = outputMode === 'draft'
        ? '输出模式：仅出剪映草稿（render_mp4=false, export_jianying_draft=true），跳过 mp4 编码秒出完整多轨剪映草稿。'
        : outputMode === 'mp4'
          ? '输出模式：仅本机直出 mp4（render_mp4=true, export_jianying_draft=false），出片后自动登记到成片库。'
          : '输出模式：成片 + 剪映草稿同步输出（render_mp4=true, export_jianying_draft=true），直出 mp4 入成片库并导出可编辑剪映多轨草稿。'
      return [
        '请按内置 trendy-koubo（网感口播）技能，用 dh_trendy_koubo 帮我处理下面这段口播视频：',
        paths.length
          ? paths.map((p, i) => `${i + 1}. ${p}`).join('\n')
          : '（请把本地视频拖进输入框，或直接贴上视频绝对路径）',
        `要求：先用 dh_transcribe(words=true) 读口播原声，一次性规划前 5 秒双行反色大标题（每行 ≤8 字）、≤12 字中英双语错落字幕、每条 1 个核心关键词高亮放大弹出、1 处金句 1.18x 缩放、去气口、开头/结尾克制提示音与自动配乐；默认配色 theme="trendy_red"（也可改用 trendy_gold 黑金杂志 / trendy_cyan 极简白青）。${modeClause}`,
      ].join('\n')
    },
  },
  {
    id: 'talking-subtitles',
    title: '口播精剪 · 字幕 + BGM',
    desc: '自动识别语音加关键词字幕（避脸）、人声降噪、自动配 BGM 直出 mp4',
    buildPrompt: (paths) => [
      '请直接用 dh_quick_edit 帮我快速剪辑下面这段视频并直出 mp4：',
      paths.length
        ? paths.map((p, i) => `${i + 1}. ${p}`).join('\n')
        : '（请把本地视频拖进输入框，或直接贴上视频绝对路径）',
      '要求：自动判横竖屏，开启关键词标色字幕（keyword，自动避脸），人声降噪 clean，自动配 BGM 压人声，出片后告诉我路径并登记到成片库。',
    ].join('\n'),
  },
  {
    id: 'cut-on-pause',
    title: '口播去气口 · 按停顿切镜',
    desc: '按句子停顿自动切镜 + 交替轻微推拉 + 避脸字幕 + 配乐',
    buildPrompt: (paths) => [
      '请用 dh_quick_edit 帮我给下面口播视频按停顿切镜去闷感，并直出 mp4：',
      paths.length
        ? paths.map((p, i) => `${i + 1}. ${p}`).join('\n')
        : '（请把本地视频拖进输入框，或直接贴上视频绝对路径）',
      '要求：开启 cut_on_pause=true、白字黑边字幕（douyin_bottom，避脸）、人声降噪 clean、自动配 BGM。',
    ].join('\n'),
  },
  {
    id: 'multi-mixcut',
    title: '多段素材快速混剪',
    desc: '多段视频/图片按顺序拼接 + 字幕 + 花字音效 + 自动配乐直出',
    buildPrompt: (paths) => [
      '请先用 dh_probe_video 看下这些素材时长，再用 dh_quick_edit 帮我快速混剪成一条成片（直出 mp4）：',
      paths.length
        ? paths.map((p, i) => `${i + 1}. ${p}`).join('\n')
        : '（请把多段本地视频/图片拖进输入框，或贴上文件夹路径）',
      '要求：节奏紧凑，自动加避脸字幕、2-3 处重点花字与对应音效、自动配 BGM，出完后顺手跑一次 dh_qc_video 质检。',
    ].join('\n'),
  },
  {
    id: 'look-packaging',
    title: '质感包装 · 调色 / 虚化 / 片头片尾',
    desc: '暖色调色（warm_soft）+ 字幕 + 片头片尾卡，让画面更有质感',
    buildPrompt: (paths) => [
      '请用 dh_quick_edit 帮我给下面视频做一层质感包装并直出 mp4：',
      paths.length
        ? paths.map((p, i) => `${i + 1}. ${p}`).join('\n')
        : '（请把本地视频拖进输入框，或直接贴上视频绝对路径）',
      '要求：开启暖色调色 lut="warm_soft"、半透明底条字幕（bar_bottom，避脸）、人声降噪 clean、自动配 BGM，并根据内容自动配一句简短片头和片尾。',
    ].join('\n'),
  },
]

function formatDuration(sec?: number): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return ''
  const s = Math.round(sec)
  return s >= 60 ? `${Math.floor(s / 60)}分${s % 60}秒` : `${s}秒`
}

/** Composer control: one-click quick video editing presets that prefill a dh_quick_edit prompt. */
export function QuickEditComposerButton({ sessionId, useInput, inputActions, onOpenEditor }: ComposerButtonProps) {
  const draft = useInput(state => state.draft)
  const [open, setOpen] = useState(false)
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [outputMode, setOutputMode] = useState<OutputMode>(() => loadOutputMode())
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const chooseOutputMode = useCallback((mode: OutputMode) => {
    setOutputMode(mode)
    try { localStorage.setItem(OUTPUT_MODE_KEY, mode) } catch { /* ignore */ }
  }, [])

  const refreshMaterials = useCallback(() => {
    const spaceId = loadSessionSpaceId(String(sessionId)) || DEFAULT_DIGITAL_HUMAN_SPACE_ID
    void fetch(`/digital-human-studio/materials?space=${encodeURIComponent(spaceId)}`)
      .then(res => res.json())
      .then((data: { items?: MaterialItem[] }) => {
        const list = Array.isArray(data?.items) ? data.items : []
        const videos = list.filter(item => item?.path && (item.kind === 'video' || /\.(mp4|mov|m4v|mkv|webm)$/i.test(item.path)))
        setMaterials(videos.slice(0, 6))
      })
      .catch(() => setMaterials([]))
  }, [sessionId])

  useEffect(() => {
    if (!open) return
    refreshMaterials()
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, refreshMaterials])

  const togglePath = useCallback((path: string) => {
    setSelectedPaths(prev => prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path])
  }, [])

  const applyPreset = useCallback((preset: QuickPreset) => {
    const base = preset.buildPrompt(selectedPaths, outputMode)
    const existing = draft.trim()
    const next = existing && !existing.startsWith('请') ? `${base}\n\n补充要求：${existing}` : base
    inputActions.setDraft(next)
    setOpen(false)
  }, [draft, inputActions, selectedPaths, outputMode])

  const panelStyle = (() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return { left: 12, bottom: 72, width: 340 }
    const width = 340
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    return { left, bottom: Math.max(12, window.innerHeight - rect.top + 8), width }
  })()

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={css.button}
        data-open={open || undefined}
        aria-label="快速剪辑"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="一键选择剪辑方案，让 AI 直接调用工具出片"
        onMouseDown={event => event.preventDefault()}
        onClick={() => setOpen(v => !v)}
      >
        快速剪辑
        <span className={css.chevron} aria-hidden data-open={open || undefined} />
      </button>
      {open ? createPortal(
        <div ref={panelRef} className={css.panel} style={panelStyle} role="listbox" aria-label="快速剪辑">
          <div className={css.panelHead}>
            <strong>快速剪辑</strong>
            {onOpenEditor ? (
              <button
                type="button"
                className={css.generate}
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  setOpen(false)
                  onOpenEditor()
                }}
              >
                打开剪辑台
              </button>
            ) : null}
          </div>
          <div style={{ padding: '7px 10px', borderBottom: '1px solid rgba(128,128,128,0.14)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {OUTPUT_MODES.map(item => {
                const active = outputMode === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => chooseOutputMode(item.id)}
                    title={item.hint}
                    style={{
                      flex: 1,
                      fontSize: 11,
                      fontWeight: active ? 600 : 400,
                      padding: '4px 6px',
                      borderRadius: 8,
                      border: active ? '1px solid rgba(122,90,245,0.55)' : '1px solid rgba(128,128,128,0.25)',
                      background: active ? 'rgba(122,90,245,0.14)' : 'transparent',
                      color: 'inherit',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 11, opacity: 0.65 }}>
              {OUTPUT_MODES.find(m => m.id === outputMode)?.hint}
            </div>
          </div>
          {materials.length > 0 ? (
            <div style={{ padding: '6px 10px', borderBottom: '1px solid rgba(128,128,128,0.16)', fontSize: 12 }}>
              <div style={{ opacity: 0.72, marginBottom: 4 }}>
                可选素材库视频（已选 {selectedPaths.length} 个）：
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {materials.map(item => {
                  const p = item.path || ''
                  const checked = selectedPaths.includes(p)
                  const label = item.name || item.fileName || '视频'
                  const dur = formatDuration(item.durationSec)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => togglePath(p)}
                      style={{
                        fontSize: 11,
                        padding: '2px 7px',
                        borderRadius: 999,
                        border: checked ? '1px solid currentColor' : '1px solid rgba(128,128,128,0.35)',
                        background: checked ? 'rgba(59,130,246,0.15)' : 'transparent',
                        cursor: 'pointer',
                        maxWidth: 150,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={p}
                    >
                      {checked ? '✓ ' : ''}{label}{dur ? ` (${dur})` : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
          <div className={css.list}>
            {QUICK_PRESETS.map(preset => (
              <button
                key={preset.id}
                type="button"
                className={css.row}
                role="option"
                onMouseDown={event => event.preventDefault()}
                onClick={() => applyPreset(preset)}
              >
                <span className={css.rowBody}>
                  <b>{preset.title}</b>
                  <small>{preset.desc}</small>
                </span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
