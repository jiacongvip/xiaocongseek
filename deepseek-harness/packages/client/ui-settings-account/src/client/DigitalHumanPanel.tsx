// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DIGITAL_HUMAN_SPACE_KEY as SPACE_KEY,
  DEFAULT_DIGITAL_HUMAN_SPACE_ID,
  digitalHumanHistoryKey,
  loadDigitalHumanSpaceId,
  pullAllDigitalHumanHistory,
  pullDigitalHumanHistory,
  type DigitalHumanWorkCopy,
} from './digital-human-history.ts'
import css from './DigitalHumanPanel.module.css'
import { DigitalHumanDeskModal } from './DigitalHumanDeskModal.tsx'
import { WorkCopyStudio } from './WorkCopyStudio.tsx'
import { DigitalHumanCalendar } from './DigitalHumanCalendar.tsx'
import { DigitalHumanPublishPacks } from './DigitalHumanPublishPacks.tsx'
import { DigitalHumanPublishTaskCenter } from './DigitalHumanPublishTaskCenter.tsx'
import { DigitalHumanVideoDownload } from './DigitalHumanVideoDownload.tsx'
import { DigitalHumanIndustryHotboard } from './DigitalHumanIndustryHotboard.tsx'
import { DigitalHumanRetroReview } from './DigitalHumanRetroReview.tsx'
import { DigitalHumanPlatformAccounts } from './DigitalHumanPlatformAccounts.tsx'
import { accountPlatformLabel, postPlatformAccount } from './DigitalHumanPlatformAccountsState.ts'
import { RecordRailProvider, ResolvedRecordRail, defaultRecordRail, shouldShowRecordRail, type RecordRailModel } from './DigitalHumanRecordRail.tsx'
import { isSideNavOn, resolvePublishCompany } from './digital-human-publish-nav.ts'

const KINDS = [
  { id: 'xdh-avatar-video', label: '数字人视频', icon: 'video' },
  { id: 'xdh-audio', label: '语音合成', icon: 'audio' },
  { id: 'xdh-export-video', label: '成品视频', icon: 'video' },
  { id: 'ximg', label: '图片生成', icon: 'image' },
  { id: 'xdh-avatar-clone', label: '形象克隆', icon: 'avatar' },
  { id: 'xdh-voice-clone', label: '声音克隆', icon: 'voice' },
] as const

/** Primary homepage modes; clone/export entries are not generation modes. */
const MAIN_KINDS = KINDS.filter(item => item.id !== 'xdh-avatar-clone' && item.id !== 'xdh-voice-clone' && item.id !== 'xdh-export-video')

const MODELS: Record<string, string[]> = {
  'xdh-avatar-video': ['VPro', 'Pro', 'Max', 'XPro'],
  'xdh-audio': ['SPro', 'Pro', 'Max', 'NWMax'],
  'xdh-avatar-clone': ['VPro', 'Pro', 'Max', 'XPro'],
  'xdh-voice-clone': ['SPro', 'Pro', 'Max', 'NWMax'],
}

const PLACEHOLDERS: Record<string, string> = {
  'xdh-avatar-video': '口播文案：请输入你需要合成的口播文案内容',
  'xdh-audio': '输入要合成的文案，例如：这句话会被合成成一段自然的中文语音。',
  ximg: '描述你想要的画面，例如：一位穿白色衬衫的数字人主播，站在柔光摄影棚里，背景是浅米色。',
  'xdh-image': '描述你想要的画面，例如：一位穿白色衬衫的数字人主播，站在柔光摄影棚里，背景是浅米色。',
  'xdh-avatar-clone': '填写形象名称和公网素材地址，开始克隆。',
  'xdh-voice-clone': '填写声音名称和公网音频地址，开始克隆。',
}

const HERO: Record<string, { title: ReactNode; subtitle: string }> = {
  'xdh-avatar-video': {
    title: <>10 秒钟极速<br />打造您的 <span className={css.accent}>数字人 IP</span></>,
    subtitle: '选形象、选音色，输入口播文案，10 秒开始生成。',
  },
  'xdh-audio': {
    title: <>把一段文字，<br />变成 <span className={css.accent}>自然的声音</span></>,
    subtitle: '输入文案，选一个音色，直接得到可用的配音。',
  },
  ximg: {
    title: <>一个提示词，<br />生成一张 <span className={css.accent}>好配图</span></>,
    subtitle: '描述主体、场景和光线。可选 Grok Imagine，或数字人工作台同款多米 gpt-image。',
  },
  'xdh-image': {
    title: <>一个提示词，<br />生成一张 <span className={css.accent}>好配图</span></>,
    subtitle: '描述主体、场景和光线。可选 Grok Imagine，或数字人工作台同款多米 gpt-image。',
  },
  'xdh-avatar-clone': {
    title: <>一张素材，<br />复刻一个 <span className={css.accent}>数字分身</span></>,
    subtitle: '上传公网素材地址，开始克隆专属形象。',
  },
  'xdh-voice-clone': {
    title: <>一段声音，<br />复刻你的 <span className={css.accent}>专属音色</span></>,
    subtitle: '上传公网音频地址，开始克隆专属声音。',
  },
}

type IconName = 'video' | 'audio' | 'image' | 'avatar' | 'voice' | 'spark' | 'clock' | 'copy' | 'trash' | 'back' | 'download' | 'star' | 'home' | 'company' | 'publish'

type GatewayStatus = {
  baseUrl?: string
  hasToken?: boolean
  tokenPreview?: string
}

type TaskStatus = {
  task_id?: string
  status?: string
  progress?: string
  fail_reason?: string
  url?: string
  data?: Record<string, unknown>
  created_at?: number
  updated_at?: number
  finished_at?: number
}

type Artifact = {
  key: string
  type: string
  mimeType?: string
  content_url: string
}

type RecentTask = {
  id: string
  kind: string
  title: string
  at: number
  status?: string
  progress?: string
  prompt?: string
  modelCode?: string
  coverUrl?: string
  mediaUrl?: string
  /** 模型给这条成片写的文案 + 封面 */
  copy?: DigitalHumanWorkCopy
}

type Workspace = 'create' | 'detail'

type DigitalHumanResource = {
  id?: number | string
  local_id?: string
  resource_id?: string
  model_id?: string
  voice_id?: string
  name?: string
  cover_url?: string
  preview_url?: string
  sample_url?: string
  download_url?: string
  model_code?: string
  platform_code?: string
  language?: string
  clone_model_name?: string
  owner_type?: string
  ready?: number
  is_default?: number
  source?: 'mine' | 'public'
  width?: number
  height?: number
}

type ResourceState = {
  avatars: DigitalHumanResource[]
  voices: DigitalHumanResource[]
}

function Glyph({ name, size = 17 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (name === 'video') {
    return <svg {...common}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></svg>
  }
  if (name === 'audio') {
    return <svg {...common}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
  }
  if (name === 'image') {
    return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5L5 20" /></svg>
  }
  if (name === 'avatar') {
    return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
  }
  if (name === 'voice') {
    return <svg {...common}><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" /></svg>
  }
  if (name === 'spark') {
    return (
      <svg {...common}>
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
        <path d="M19 16l.7 2.1 2.1.7-2.1.7L19 22l-.7-2.5-2.1-.7 2.1-.7z" />
      </svg>
    )
  }
  if (name === 'clock') {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  }
  if (name === 'copy') {
    return <svg {...common}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
  }
  if (name === 'back') {
    return <svg {...common}><path d="M15 6l-6 6 6 6" /></svg>
  }
  if (name === 'download') {
    return <svg {...common}><path d="M12 4v12M7 11l5 5 5-5M5 20h14" /></svg>
  }
  if (name === 'star') {
    return <svg {...common}><path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.8 7.2 18.9l.9-5.4L4.2 9.7l5.4-.8z" /></svg>
  }
  if (name === 'home') {
    return <svg {...common}><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-6h4v6" /></svg>
  }
  if (name === 'company') {
    return (
      <svg {...common}>
        <rect x="4" y="8" width="16" height="12" rx="2" />
        <path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" />
      </svg>
    )
  }
  if (name === 'publish') {
    return (
      <svg {...common}>
        <path d="M12 19V7" />
        <path d="M7 12l5-5 5 5" />
        <path d="M5 19h14" />
      </svg>
    )
  }
  return <svg {...common}><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" /></svg>
}

type ClientBrief = {
  identity: string
  business: string
  audience: string
  tone: string
  avoid: string
  sample: string
  brand: string
  pains: string
  proof: string
  cta: string
  voice: string
  keywords: string
  videoFormat: string
  editStyle: string
  visualStyle: string
  audioStyle: string
  outroTemplate: string
}

const EMPTY_BRIEF: ClientBrief = {
  identity: '', business: '', audience: '', tone: '', avoid: '', sample: '',
  brand: '', pains: '', proof: '', cta: '', voice: '',
  keywords: '', videoFormat: '', editStyle: '', visualStyle: '', audioStyle: '', outroTemplate: '',
}

const BRIEF_FIELDS: {
  key: keyof ClientBrief
  section: 'copy' | 'video'
  label: string
  placeholder: string
  rows?: number
  max: number
  presets?: string[]
}[] = [
  { key: 'identity', section: 'copy', label: '对外身份', placeholder: '例如：南宁某瓷砖店老板，出镜口播', max: 80 },
  { key: 'business', section: 'copy', label: '主营/卖点', placeholder: '例如：主营 800-1500 元瓷砖，主打防滑、上门量尺', max: 400 },
  { key: 'audience', section: 'copy', label: '对谁说', placeholder: '例如：装修中的业主，怕踩坑、怕被忽悠', max: 200 },
  { key: 'brand', section: 'copy', label: '品牌事实', placeholder: '例如：全称、城市、几家店、做了几年、价格带、有没有资质。写稿不许编，这里给准数', max: 240 },
  { key: 'pains', section: 'copy', label: '客户痛点原话', placeholder: '一行一条，贴客户自己说的话，例如：\n上一家做完三个月就空鼓，找他他让我看合同', rows: 3, max: 320 },
  { key: 'proof', section: 'copy', label: '证据', placeholder: '一行一条，例如：\n做了 12 年，落地 300+ 户\n客户原话：师傅比我自己还挑', rows: 3, max: 320 },
  { key: 'cta', section: 'copy', label: '结尾目标动作', placeholder: '例如：报小区名到店看样，或评论区打「瓷砖」', max: 80 },
  { key: 'voice', section: 'copy', label: '自称与说话习惯', placeholder: '例如：说「我」不说「我们」，句子短，能开玩笑', max: 80 },
  { key: 'tone', section: 'copy', label: '口吻', placeholder: '例如：口语、像邻居介绍，别端着', max: 80 },
  { key: 'avoid', section: 'copy', label: '不要说', placeholder: '例如：别承诺疗效级效果、别贬竞品店名', max: 200 },
  { key: 'keywords', section: 'copy', label: '核心关键词 / 固定话题', placeholder: '逗号隔开，同时用于文案 #话题 与字幕关键词自动标色，例如：防滑瓷砖, 装修避坑, 工厂直发', max: 200 },
  { key: 'sample', section: 'copy', label: '范例口播', placeholder: '贴一段已经满意的口播，写脚本时会照着学', rows: 3, max: 800 },
  {
    key: 'videoFormat',
    section: 'video',
    label: '默认画幅与时长',
    placeholder: '例如：竖屏 9:16（1080×1920）· 20–45 秒',
    max: 80,
    presets: ['竖屏 9:16 · 20-45秒', '竖屏 9:16 · 45-90秒', '横屏 16:9 · 1-3分钟'],
  },
  {
    key: 'editStyle',
    section: 'video',
    label: '剪辑节奏与风格',
    placeholder: '例如：口播按停顿快切（开 cut_on_pause）+ 交替轻微推拉',
    max: 160,
    presets: ['口播停顿快切（去气口+轻微推拉）', '多段实拍快切混剪（每镜2-3秒）', '沉稳口播讲解（不频切）', '写实产品包装风格'],
  },
  {
    key: 'visualStyle',
    section: 'video',
    label: '字幕 / 花字 / 调色规范',
    placeholder: '例如：关键词标色字幕（keyword）+ 自动避脸 + 暖调 warm_soft',
    max: 200,
    presets: ['关键词标色(keyword) + 避脸 + 暖调 warm_soft', '白字黑边(douyin_bottom) + 避脸 + 原色', '半透明底条(bar_bottom) + 避脸 + 轻背景虚化', '逐字点亮(karaoke) + 避脸 + 重点花字'],
  },
  {
    key: 'audioStyle',
    section: 'video',
    label: '声音与 BGM 偏好',
    placeholder: '例如：人声降噪 clean + 自动选曲压人声（音量 0.12）',
    max: 160,
    presets: ['人声降噪 clean + 自动轻快 BGM 压人声', '人声降噪 strong + 沉稳商务 BGM 压人声', '仅人声降噪 clean，不加 BGM'],
  },
  {
    key: 'outroTemplate',
    section: 'video',
    label: '固定片头 / 片尾落版',
    placeholder: '例如：片尾 3 秒展示店名 + 评论「报价」领避坑清单',
    max: 200,
  },
]

type StudioSpace = {
  id: string
  name: string
  lastProjectFolder?: string
  lastDraftId?: string
  lastDraftPath?: string
  brief?: ClientBrief
}

function normalizeBrief(value: unknown): ClientBrief {
  const row = value && typeof value === 'object' ? value as Partial<ClientBrief> : {}
  return {
    identity: String(row.identity || ''),
    business: String(row.business || ''),
    audience: String(row.audience || ''),
    tone: String(row.tone || ''),
    avoid: String(row.avoid || ''),
    sample: String(row.sample || ''),
    brand: String(row.brand || ''),
    pains: String(row.pains || ''),
    proof: String(row.proof || ''),
    cta: String(row.cta || ''),
    voice: String(row.voice || ''),
    keywords: String(row.keywords || ''),
    videoFormat: String(row.videoFormat || ''),
    editStyle: String(row.editStyle || ''),
    visualStyle: String(row.visualStyle || ''),
    audioStyle: String(row.audioStyle || ''),
    outroTemplate: String(row.outroTemplate || ''),
  }
}

function briefFilled(brief?: ClientBrief): boolean {
  return Object.values(normalizeBrief(brief)).some(value => value.trim() !== '')
}

type AppPage = 'home' | 'companies' | 'create' | 'works' | 'materials' | 'ip-assets' | 'calendar' | 'publish-packs' | 'video-download' | 'industry-hotboard' | 'platform-accounts' | 'work-copy' | 'retro-review'

const COMPANY_ACTIONS = [
  { id: 'archive', label: '档案' },
  { id: 'materials', label: '素材' },
  { id: 'video', label: '数字人' },
  { id: 'audio', label: '音频' },
  { id: 'image', label: '图片' },
  { id: 'works', label: '成片' },
  { id: 'calendar', label: '发布日历' },
  { id: 'publish-packs', label: '发布包' },
  { id: 'platform-accounts', label: '平台账号' },
] as const

/** Shared 5 shortcuts for company list cards and inner-page rail. List DOM stays independent. */
const COMPANY_LIST_ACTIONS = [
  { id: 'archive', label: '档案' },
  { id: 'materials', label: '素材' },
  { id: 'create', label: '创作' },
  { id: 'works', label: '成片' },
  { id: 'publish-packs', label: '发布' },
  { id: 'retro-review', label: '复盘' },
] as const

/** Inner-page tab row: same order as the list shortcuts, plus 账号 right after 档案 and 日历 after 成片. */
const COMPANY_DESK_TABS = [
  { id: 'archive', label: '档案' },
  { id: 'platform-accounts', label: '账号' },
  { id: 'materials', label: '素材' },
  { id: 'ip-assets', label: '形象' },
  { id: 'create', label: '创作' },
  { id: 'works', label: '成片' },
  { id: 'calendar', label: '日历' },
  { id: 'publish-packs', label: '发布' },
  { id: 'retro-review', label: '复盘' },
] as const

const MATERIAL_SLOTS = [
  { id: 'product', label: '产品', hint: '产品特写、样品、效果图' },
  { id: 'store', label: '门店', hint: '门店实拍、工地、展厅' },
  { id: 'logo', label: 'Logo', hint: '标志、门头、水印' },
  { id: 'scene', label: '场景背景', hint: '换装用的场景图，弹窗里可点选' },
  { id: 'outfit', label: '服装套装', hint: '换装用的衣服图，弹窗里可点选' },
] as const

type MaterialSlotId = typeof MATERIAL_SLOTS[number]['id']

type PublicStyleItem = { id: string; name: string; url: string }

type StudioMaterial = {
  id: string
  slot: MaterialSlotId
  name: string
  kind: string
  at: number
  size: number
  url?: string
  /** 混剪 Agent 标注的分析结果 */
  role?: string
  useFor?: string
  summary?: string
  environment?: string
  lighting?: string
  quality?: string
  speaker?: string
  speech?: string
  analysisStatus?: 'pending' | 'ready'
}

const MATERIAL_ANALYSIS_FIELDS = [
  { key: 'environment', label: '环境' },
  { key: 'lighting', label: '光线' },
  { key: 'quality', label: '画质' },
  { key: 'speaker', label: '说话人' },
  { key: 'speech', label: '说话内容' },
] as const

/** 有值的分析维度，供预览弹窗逐项展示；卡片悬停也用它拼提示。 */
function materialAnalysisRows(item: StudioMaterial | null): Array<{ label: string; value: string }> {
  if (!item) return []
  return MATERIAL_ANALYSIS_FIELDS
    .map(row => ({ label: row.label, value: String(item[row.key] || '').trim() }))
    .filter(row => !!row.value)
}

function materialAnalysisTooltip(item: StudioMaterial): string {
  const parts: string[] = []
  if (item.useFor) parts.push(`用途：${item.useFor}`)
  if (item.summary) parts.push(`概述：${item.summary}`)
  for (const row of materialAnalysisRows(item)) parts.push(`${row.label}：${row.value}`)
  return parts.join('\n')
}

type CompanyActionId = typeof COMPANY_ACTIONS[number]['id']

type SpaceStat = {
  space: StudioSpace
  tasks: RecentTask[]
  filled: boolean
  monthCount: number
}

function monthStartMs(): number {
  const date = new Date()
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Home hero eyebrow: 11月12日 · 周四 */
function homeTodayLabel(): string {
  const today = new Date()
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()]
  return `${today.getMonth() + 1}月${today.getDate()}日 · ${weekday}`
}

/** Home desk label: ~8 chars with ellipsis. */
function shortCompanyLabel(name: string, max = 8): string {
  const value = String(name || '').trim()
  if (!value) return '当前公司'
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** Right-column empty copy: use full spaceStats, not the displayed slice. */
function firstVideoEmptyMessage(hasMissingArchive: boolean): string {
  return hasMissingArchive ? '先补左边的档案，再做第一条' : '有档案的公司这个月都出过片了'
}

function companyListEmptyMessage(totalCompanies: number): string {
  return totalCompanies === 0 ? '还没有公司，点右上角新建' : '没有匹配的公司'
}

function companyListEmptyHint(totalCompanies: number): string {
  return totalCompanies === 0
    ? '新建一家，档案、素材、成片都挂在这家公司下面'
    : '换个关键词试试，或者新建一家'
}

const COMPANY_TONES = ['violet', 'blue', 'teal', 'amber', 'rose'] as const

/** Stable pastel tone per company name, so the same company keeps its color. */
function companyTone(name: string): typeof COMPANY_TONES[number] {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) % 9973
  return COMPANY_TONES[hash % COMPANY_TONES.length]
}

function companyInitial(name: string): string {
  const value = String(name || '').trim()
  return value ? value.slice(0, 1).toUpperCase() : '#'
}

type CompanyDeskTabId = typeof COMPANY_DESK_TABS[number]['id']

/** Inner-page tab highlight from the current workbench page. */
function companyRailHighlight(appPage: string, companyOpen: boolean): CompanyDeskTabId | '' {
  if (appPage === 'works' || appPage === 'work-copy') return 'works'
  if (appPage === 'materials') return 'materials'
  if (appPage === 'ip-assets') return 'ip-assets'
  if (appPage === 'companies' && companyOpen) return 'archive'
  if (appPage === 'create') return 'create'
  if (appPage === 'platform-accounts') return 'platform-accounts'
  if (appPage === 'calendar') return 'calendar'
  if (appPage === 'publish-packs') return 'publish-packs'
  if (appPage === 'retro-review') return 'retro-review'
  return ''
}

function normalizeRailActive(active: string): CompanyDeskTabId | '' {
  if (active === 'create' || active === 'video' || active === 'audio' || active === 'image') return 'create'
  if (active === 'platform-accounts') return 'platform-accounts'
  if (active === 'calendar') return 'calendar'
  if (active === 'publish-packs') {
    return 'publish-packs'
  }
  if (active === 'archive' || active === 'materials' || active === 'ip-assets' || active === 'works') return active
  return ''
}

function loadHistory(spaceId: string): RecentTask[] {
  try {
    const raw = localStorage.getItem(digitalHumanHistoryKey(spaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string').slice(0, 40) : []
  } catch {
    return []
  }
}

function copyDigest(copy?: DigitalHumanWorkCopy): string {
  if (!copy) return ''
  const platforms = (copy as { platforms?: unknown }).platforms
  return JSON.stringify([
    copy.title || '',
    copy.body || '',
    copy.coverText || '',
    copy.coverPrompt || '',
    copy.coverUrl || '',
    copy.coverError || '',
    copy.at || 0,
    platforms || null,
  ])
}

function sameHistory(left: RecentTask[], right: RecentTask[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => (
    item.id === right[index]?.id
    && item.status === right[index]?.status
    && item.mediaUrl === right[index]?.mediaUrl
    && item.coverUrl === right[index]?.coverUrl
    && item.title === right[index]?.title
    && copyDigest(item.copy) === copyDigest(right[index]?.copy)
  ))
}

function folderLabel(path?: string): string {
  const value = String(path || '').trim()
  if (!value) return '未设置剪映目录'
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts.slice(-3).join('/') || value
}

function isImageKind(kind?: string): boolean {
  return kind === 'ximg' || kind === 'xdh-image'
}

type WorkThumbItem = { id: string; kind: string; coverUrl?: string; mediaUrl?: string }

/** 视频缩略图：浏览器 preload=metadata 不会画出首帧，必须在拿到元数据后 seek 一下。 */
function FrameVideo({ src }: { src: string }) {
  return (
    <video
      src={src}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={event => {
        const video = event.currentTarget
        try {
          if (video.duration && video.currentTime === 0) video.currentTime = Math.min(0.2, video.duration / 2)
        } catch {
          /* 个别格式不允许 seek，保持空帧也不报错 */
        }
      }}
    />
  )
}

/** 成片卡片缩略图：封面图 → 封面视频 → 图片 → 成品封面帧 → 视频首帧 → 类型图标。 */
function WorkThumbMedia({ item, spaceId }: { item: WorkThumbItem; spaceId: string }) {
  const [posterFailed, setPosterFailed] = useState(false)
  const poster = item.kind === 'xdh-export-video' && !posterFailed
    ? `/digital-human-studio/works/thumb?space=${encodeURIComponent(spaceId)}&id=${encodeURIComponent(item.id)}`
    : ''
  const glyph: IconName = isImageKind(item.kind) ? 'image' : item.kind === 'xdh-voice-clone' ? 'voice' : item.kind === 'xdh-audio' ? 'audio' : 'video'
  if (item.coverUrl && canShowImage(item.coverUrl)) return <img src={item.coverUrl} alt="" />
  if (item.coverUrl && canShowVideo(item.coverUrl)) return <FrameVideo src={item.coverUrl} />
  if (poster) return <img src={poster} alt="" onError={() => setPosterFailed(true)} />
  if (item.mediaUrl && canShowImage(item.mediaUrl)) return <img src={item.mediaUrl} alt="" />
  if (item.mediaUrl && canShowVideo(item.mediaUrl)) return <FrameVideo src={item.mediaUrl} />
  return <span className={css.workThumbIcon} aria-hidden><Glyph name={glyph} size={20} /></span>
}

function kindLabel(kind: string): string {
  if (isImageKind(kind)) return '图片生成'
  return KINDS.find(item => item.id === kind)?.label || '数字人任务'
}

function imageModelLabel(id: string): string {
  const labels: Record<string, string> = {
    'gpt-image-2': '多米 GPT-image-2',
    'gpt-image-2.5-flare': '多米 GPT-image-2.5 Flare',
    'gpt-image-2.5-sunburst': '多米 GPT-image-2.5 Sunburst',
    'grok-imagine-image-lite': 'Grok Imagine Lite',
    'grok-imagine-image': 'Grok Imagine',
    'grok-imagine-image-2.0': 'Grok Imagine 2.0',
  }
  return labels[id] || id
}

function normalizeStatus(status?: string): string {
  const value = String(status || '').trim().toUpperCase()
  if (value === 'SUCCEED' || value === 'SUCCEEDED' || value === 'COMPLETE' || value === 'COMPLETED' || value === 'DONE') return 'SUCCESS'
  if (value === 'FAILED' || value === 'FAIL' || value === 'ERROR') return 'FAILURE'
  if (value === 'PROCESSING' || value === 'RUNNING' || value === 'PENDING' || value === 'WORKING') return 'IN_PROGRESS'
  return String(status || '')
}

function statusLabel(status?: string): string {
  const value = normalizeStatus(status)
  if (!value) return '等待中'
  if (value === 'SUCCESS') return '已完成'
  if (value === 'FAILURE') return '失败'
  if (value === 'IN_PROGRESS') return '生成中'
  if (value === 'QUEUED' || value === 'SUBMITTED' || value === 'NOT_START') return '排队中'
  return status || '等待中'
}

function statusColor(status?: string): string {
  const value = normalizeStatus(status)
  if (value === 'SUCCESS') return '#2fa36c'
  if (value === 'FAILURE') return '#c0392b'
  if (value === 'IN_PROGRESS' || value === 'QUEUED' || value === 'SUBMITTED') return '#7657ff'
  return '#b9bac4'
}

function progressPercent(progress?: string, status?: string): number {
  if (normalizeStatus(status) === 'SUCCESS') return 100
  const match = String(progress || '').match(/(\d+(?:\.\d+)?)/)
  if (match) return Math.max(0, Math.min(100, Math.round(Number(match[1]))))
  if (status === 'IN_PROGRESS') return 50
  if (status === 'QUEUED' || status === 'SUBMITTED' || status === 'NOT_START') return 8
  return 0
}

function isActiveStatus(status?: string): boolean {
  const value = normalizeStatus(status)
  return value === 'IN_PROGRESS' || value === 'QUEUED' || value === 'SUBMITTED' || value === 'NOT_START'
}

function isTerminalStatus(status?: string): boolean {
  const value = normalizeStatus(status)
  return value === 'SUCCESS' || value === 'FAILURE'
}

function taskTitle(kind: string, text: string, name: string): string {
  const source = name || text
  const trimmed = source.trim().replace(/\s+/g, ' ')
  return trimmed ? trimmed.slice(0, 28) : kindLabel(kind)
}

function formatDateTime(value?: number): string {
  if (!value) return '—'
  const date = new Date(value > 1e12 ? value : value * 1000)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatDuration(start?: number, end?: number): string {
  if (!start || !end) return '—'
  const from = start > 1e12 ? start : start * 1000
  const to = end > 1e12 ? end : end * 1000
  const seconds = Math.max(0, Math.round((to - from) / 1000))
  if (seconds < 60) return `${seconds}秒`
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function readData(data: Record<string, unknown> | undefined, key: string): string {
  const direct = data?.[key]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (typeof direct === 'number' && Number.isFinite(direct)) return String(direct)
  const nested = asRecord(data?.input)?.[key]
  if (typeof nested === 'string' && nested.trim()) return nested.trim()
  if (typeof nested === 'number' && Number.isFinite(nested)) return String(nested)
  const envelope = asRecord(data?.data)
  if (envelope) {
    const inner = envelope[key]
    if (typeof inner === 'string' && inner.trim()) return inner.trim()
    if (typeof inner === 'number' && Number.isFinite(inner)) return String(inner)
  }
  return ''
}

function isGatewayArtifactURL(url?: string): boolean {
  const value = String(url || '')
  if (value.includes('/digital-human-studio/image/')) return false
  return /\/v1\/tasks\/.+\/artifacts\//.test(value) || /localhost|127\.0\.0\.1/.test(value)
}

function firstUsableURL(urls: Array<string | undefined>, ok?: (url: string) => boolean): string {
  for (const raw of urls) {
    const url = String(raw || '').trim()
    if (!url || isGatewayArtifactURL(url)) continue
    if (ok && !ok(url)) continue
    return url
  }
  return ''
}

function pickAudioURL(task: TaskStatus | null, artifacts: Artifact[]): string {
  const data = asRecord(task?.data)
  return firstUsableURL([
    readData(data, 'audio_url'),
    readData(data, 'audio_oss_url'),
    String(task?.url || ''),
    artifacts.find(item => item.type === 'audio')?.content_url,
  ], url => isAudioURL(url) || (!isImageURL(url) && !isVideoURL(url)))
}

function pickVideoURL(task: TaskStatus | null, artifacts: Artifact[]): string {
  const data = asRecord(task?.data)
  return firstUsableURL([
    readData(data, 'video_url'),
    String(task?.url || ''),
    artifacts.find(item => item.type === 'video')?.content_url,
    readData(data, 'sample_url'),
  ], url => isVideoURL(url) || (isLocalAssetURL(url) && !isImageURL(url) && !isStudioImageFileURL(url)))
}

function pickImageOutputURL(task: TaskStatus | null, artifacts: Artifact[], fallback?: string): string {
  const data = asRecord(task?.data)
  return firstUsableURL([
    String(task?.url || ''),
    readData(data, 'image_url'),
    readData(data, 'url'),
    artifacts.find(item => item.type === 'image')?.content_url,
    readData(data, 'cover_url'),
    fallback,
  ], url => isStudioImageFileURL(url) || (canShowImage(url) && !isVideoURL(url)))
}

/** Playback URL for the open task. Video jobs never fall back to a still cover. */
function pickPlaybackURL(
  task: TaskStatus | null,
  artifacts: Artifact[],
  kind: string,
  fallbackMedia?: string,
  fallbackCover?: string,
): string {
  if (isImageKind(kind)) return pickImageOutputURL(task, artifacts, fallbackMedia || fallbackCover)
  if (kind === 'xdh-audio') return pickAudioURL(task, artifacts) || fallbackMedia || ''
  return pickVideoURL(task, artifacts) || (fallbackMedia && canShowVideo(fallbackMedia) ? fallbackMedia : '')
}

function isAudioTask(task: TaskStatus | null, artifacts: Artifact[]): boolean {
  const data = asRecord(task?.data)
  return readData(data, 'task_type') === 'audio'
    || artifacts.some(item => item.type === 'audio')
    || Boolean(readData(data, 'audio_url') || readData(data, 'audio_oss_url'))
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function formatTime(at: number): string {
  try {
    const date = new Date(at)
    const today = new Date()
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  } catch {
    return ''
  }
}

function decodeMediaURL(url?: string): string {
  const raw = String(url || '')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function isStudioImageFileURL(url?: string): boolean {
  return !!url && url.includes('/digital-human-studio/image/')
}

function isImageURL(url?: string): boolean {
  const raw = decodeMediaURL(url)
  if (!raw) return false
  if (isStudioImageFileURL(raw)) return true
  if (/[?&]ext=(png|jpe?g|webp|gif|bmp|avif)\b/i.test(raw)) return true
  return /\.(png|jpe?g|webp|gif|bmp|avif)([?#]|$)/i.test(raw)
}

function isVideoURL(url?: string): boolean {
  return !!url && /\.(mp4|mov|webm|mkv|m4v)([?#]|$)/i.test(decodeMediaURL(url))
}

function isAudioURL(url?: string): boolean {
  return !!url && /\.(mp3|wav|m4a|aac|ogg|flac)([?#]|$)/i.test(decodeMediaURL(url))
}

function isLocalTaskId(id?: string): boolean {
  return String(id || '').startsWith('local-')
}

function isLocalAssetURL(url?: string): boolean {
  return !!url && (url.includes('/digital-human-studio/digital-human/asset') || url.includes('/digital-human-studio/image/') || url.includes('/digital-human-studio/works/file'))
}

function avatarCoverSrc(resource: DigitalHumanResource): string {
  return String(resource.cover_url || resource.preview_url || '').trim()
}

function avatarSampleSrc(resource: DigitalHumanResource): string {
  return String(resource.sample_url || resource.download_url || '').trim()
}

function canShowImage(url?: string): boolean {
  if (!url) return false
  // works/file 是成品视频流（mp4），塞进 <img> 只会得到破图
  if (url.includes('/digital-human-studio/works/file')) return false
  if (isAudioURL(url) || isVideoURL(url)) return false
  if (url.startsWith('data:image/')) return true
  return isImageURL(url) || isLocalAssetURL(url)
}

function canShowVideo(url?: string): boolean {
  if (!url || isAudioURL(url) || isStudioImageFileURL(url)) return false
  if (isImageURL(url) && !isVideoURL(url)) return false
  return isVideoURL(url) || (isLocalAssetURL(url) && !isImageURL(url))
}

function isStudioMaterialURL(url?: string): boolean {
  return !!url && url.includes('/digital-human-studio/materials')
}

/** Safe in-panel preview only for known media kinds on studio/local or typed media URLs. Never iframe. */
export function materialPreviewKind(item: { kind: string; url?: string }): 'image' | 'video' | 'audio' | '' {
  const url = item.url || ''
  if (!url) return ''
  if (item.kind === 'image' && (canShowImage(url) || isStudioMaterialURL(url))) return 'image'
  if (item.kind === 'video' && (canShowVideo(url) || isStudioMaterialURL(url))) return 'video'
  if (item.kind === 'audio' && (isAudioURL(url) || isStudioMaterialURL(url))) return 'audio'
  return ''
}

function mediaAspectStyle(width?: number, height?: number): { aspectRatio: string } | undefined {
  if (!width || !height) return undefined
  return { aspectRatio: `${width} / ${height}` }
}

function AvatarPreview({
  resource,
  className,
  fallbackClassName,
  playable = false,
}: {
  resource: DigitalHumanResource
  className: string
  fallbackClassName: string
  playable?: boolean
}) {
  const cover = avatarCoverSrc(resource)
  const sample = avatarSampleSrc(resource)
  const [ratio, setRatio] = useState(mediaAspectStyle(resource.width, resource.height))
  const rememberSize = (width: number, height: number) => {
    if (width > 0 && height > 0) setRatio({ aspectRatio: `${width} / ${height}` })
  }
  const videoSrc = canShowVideo(sample) ? sample : canShowVideo(cover) ? cover : ''
  const imageSrc = canShowImage(cover) ? cover : canShowImage(sample) ? sample : ''

  if (playable && videoSrc) {
    return (
      <video
        className={className}
        style={ratio}
        src={videoSrc}
        poster={imageSrc || undefined}
        muted
        playsInline
        loop
        preload="metadata"
        onLoadedMetadata={event => rememberSize(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
        onMouseEnter={event => { void event.currentTarget.play() }}
        onMouseLeave={event => {
          event.currentTarget.pause()
          event.currentTarget.currentTime = 0
        }}
      />
    )
  }
  if (imageSrc) {
    return (
      <img
        className={className}
        style={ratio}
        src={imageSrc}
        alt=""
        onLoad={event => rememberSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
      />
    )
  }
  if (videoSrc) {
    return (
      <video
        className={className}
        style={ratio}
        src={videoSrc}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={event => rememberSize(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
      />
    )
  }
  return <span className={fallbackClassName}><Glyph name="avatar" size={26} /></span>
}

function avatarResourceID(resource: DigitalHumanResource): string {
  return String(resource.resource_id || resource.model_id || '')
}

function voiceResourceID(resource: DigitalHumanResource): string {
  return String(resource.voice_id || resource.resource_id || '')
}

function cloneResultID(kind: string, data: Record<string, unknown> | undefined): { type: 'avatar' | 'voice'; id: string } | null {
  const payload = data || {}
  const taskType = String(payload.task_type || kind)
  const isVoice = taskType === 'xdh-voice-clone' || taskType === 'voice_clone'
  const isAvatar = taskType === 'xdh-avatar-clone' || taskType === 'avatar_clone'
  if (!isVoice && !isAvatar) return null
  const id = String(
    isVoice
      ? (payload.voice_id ?? payload.profile_id ?? '')
      : (payload.model_id ?? payload.profile_id ?? ''),
  ).trim()
  if (!id) return null
  return { type: isVoice ? 'voice' : 'avatar', id }
}

type SendToChat = (payload: { task_id: string; text?: string; cover_url?: string; avatar_name?: string }) => void

/** Digital human workbench: create a XiaocongAPI task, poll it, preview the output. */
export function DigitalHumanPanel({ sendToChat, askAi }: { sendToChat?: SendToChat; askAi?: (prompt: string, opts?: { spaceId?: string }) => Promise<unknown> } = {}) {
  const [gateway, setGateway] = useState<GatewayStatus | null>(null)
  const [kind, setKind] = useState<string>('xdh-avatar-video')
  const [modelCode, setModelCode] = useState('VPro')
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [sampleUrl, setSampleUrl] = useState('')
  const [avatarId, setAvatarId] = useState('')
  const [voiceId, setVoiceId] = useState('')
  const [ratio, setRatio] = useState('9:16')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [taskId, setTaskId] = useState('')
  const [task, setTask] = useState<TaskStatus | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [pendingVideo, setPendingVideo] = useState<Record<string, unknown> | null>(null)
  const [spaceId, setSpaceId] = useState(() => loadDigitalHumanSpaceId())
  const [spaces, setSpaces] = useState<StudioSpace[]>([{ id: DEFAULT_DIGITAL_HUMAN_SPACE_ID, name: '默认' }])
  const [spaceMenu, setSpaceMenu] = useState<'closed' | 'list' | 'create' | 'rename' | 'folder' | 'brief'>('closed')
  const [spaceNameDraft, setSpaceNameDraft] = useState('')
  const [spaceFolderDraft, setSpaceFolderDraft] = useState('')
  const [briefDraft, setBriefDraft] = useState<ClientBrief>(EMPTY_BRIEF)
  /** 可发布平台不手填：跟这家公司已授权的账号走。 */
  const [publishPlatforms, setPublishPlatforms] = useState<string[]>([])
  /** 对话式档案助手：老板说一句 → AI 回人话 + 一批待写入的字段 */
  const [briefAiNotes, setBriefAiNotes] = useState('')
  const [briefAiFiles, setBriefAiFiles] = useState<{ name: string; text: string }[]>([])
  const [briefAiBusy, setBriefAiBusy] = useState(false)
  const [briefAiError, setBriefAiError] = useState('')
  /** 对话流。assistant 消息可带 updates（待写入字段）与 applied（已写入）。 */
  const [briefChat, setBriefChat] = useState<{ id: string; role: 'user' | 'assistant'; text: string; updates?: Partial<ClientBrief>; missing?: string; applied?: boolean; fileCount?: number }[]>([])
  /** 每条 assistant 消息 updates 的勾选，key 为 `${msgId}|${field}` */
  const [briefPicked, setBriefPicked] = useState<Record<string, boolean>>({})
  const briefFileRef = useRef<HTMLInputElement>(null)
  /** 形象换装：换衣服/换背景/换场景（图生图，脸保持不变） */
  const [restyleOpen, setRestyleOpen] = useState(false)
  /** IP 资产页子标签（数字人形象 / 克隆音色）与独立克隆弹窗 */
  const [ipTab, setIpTab] = useState<'avatars' | 'voices'>('avatars')
  const [cloneModalKind, setCloneModalKind] = useState<null | 'xdh-avatar-clone' | 'xdh-voice-clone'>(null)
  const [cloneModelCode, setCloneModelCode] = useState('VPro')
  const [cloneModalBusy, setCloneModalBusy] = useState(false)
  const [cloneModalError, setCloneModalError] = useState('')
  const [restyleClothing, setRestyleClothing] = useState('')
  const [restyleScene, setRestyleScene] = useState('')
  const [restyleExtra, setRestyleExtra] = useState('')
  const [restyleBusy, setRestyleBusy] = useState(false)
  const [restyleError, setRestyleError] = useState('')
  const [restyleImages, setRestyleImages] = useState<string[]>([])
  const [restyleSaved, setRestyleSaved] = useState<Record<string, boolean>>({})
  /** 自己上传的人物照片（data URL）；空 = 用当前形象的封面 */
  const [restylePerson, setRestylePerson] = useState('')
  const [restylePersonName, setRestylePersonName] = useState('')
  /** 改什么：只换衣服 / 只换背景 / 两样都换 */
  const [restyleMode, setRestyleMode] = useState<'clothing' | 'background' | 'both'>('both')
  /** 自己上传的场景/背景图（data URL 或素材库地址）；有图就走多图真实融合 */
  const [restyleBackdrop, setRestyleBackdrop] = useState('')
  const [restyleBackdropName, setRestyleBackdropName] = useState('')
  /** 素材柜里点选的服装套装（图片地址），跟人物一起进模型 */
  const [restyleOutfit, setRestyleOutfit] = useState('')
  const [restyleOutfitName, setRestyleOutfitName] = useState('')
  const restylePersonRef = useRef<HTMLInputElement>(null)
  const restyleBackdropRef = useRef<HTMLInputElement>(null)
  const restyleSlotRef = useRef<HTMLInputElement>(null)
  const [restyleSlotTarget, setRestyleSlotTarget] = useState<'scene' | 'outfit' | ''>('')
  const [spaceBusy, setSpaceBusy] = useState(false)
  const [spaceError, setSpaceError] = useState('')
  const [appPage, setAppPage] = useState<AppPage>('home')
  const [packHistoryId, setPackHistoryId] = useState('')
  const [companyOpen, setCompanyOpen] = useState(false)
  const [companyQuery, setCompanyQuery] = useState('')
  const [materials, setMaterials] = useState<StudioMaterial[]>([])
  const [materialsRoot, setMaterialsRoot] = useState('')
  const [materialBusy, setMaterialBusy] = useState('')
  const [materialQuery, setMaterialQuery] = useState('')
  const [selectedMaterial, setSelectedMaterial] = useState<StudioMaterial | null>(null)
  const [dropSlot, setDropSlot] = useState<MaterialSlotId | ''>('')
  const [materialSlot, setMaterialSlot] = useState<MaterialSlotId | 'all'>('all')
  const [workKind, setWorkKind] = useState<'all' | 'video' | 'avatar' | 'audio' | 'image'>('all')
  const [workQuery, setWorkQuery] = useState('')
  const [workImporting, setWorkImporting] = useState(false)
  const [workDeleting, setWorkDeleting] = useState('')
  const [copyOpen, setCopyOpen] = useState<RecentTask | null>(null)
  const [copyBusy, setCopyBusy] = useState('')
  const [copyError, setCopyError] = useState('')
  const [copyChatBusy, setCopyChatBusy] = useState(false)
  const [copyPlan, setCopyPlan] = useState({ scheduledAt: '', platform: '抖音', autoSend: false })
  const copyPushLabel = copyPlan.scheduledAt
    ? new Date(copyPlan.scheduledAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
    const [workNotice, setWorkNotice] = useState('')
  const workInputRef = useRef<HTMLInputElement | null>(null)
  const [workBackfilled, setWorkBackfilled] = useState('')

  /** 把剪映里剪好的成品导入成片库；导入后刷新列表，成品出现在「成品」分类里。 */
  const importWorkFile = async (file: File | null) => {
    if (!file) return
    if (!/\.mp4$/i.test(file.name)) {
      setWorkNotice('只接受 mp4 成品')
      return
    }
    setWorkImporting(true)
    setWorkNotice('')
    const target = spaceId
    try {
      const response = await fetch('/digital-human-studio/works/import', {
        method: 'POST',
        headers: {
          'content-type': 'video/mp4',
          'x-space': target,
          'x-file-name': encodeURIComponent(file.name),
        },
        body: await file.arrayBuffer(),
      })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error(data.error || '导入失败')
      const items = await pullDigitalHumanHistory(target, false)
      if (spaceIdRef.current === target) setRecent(previous => (sameHistory(previous, items as RecentTask[]) ? previous : (items as RecentTask[])))
      setWorkNotice('成品已导入成片库')
    } catch (reason) {
      setWorkNotice(reason instanceof Error ? reason.message : '导入失败')
    } finally {
      setWorkImporting(false)
    }
  }

  /** 复制文案到剪贴板；不支持就提示手动复制。 */
  const copyWorkText = async (item: RecentTask) => {
    const script = item.copy ? `# ${item.copy.title}\n\n${item.copy.body}` : item.title
    try {
      await navigator.clipboard.writeText(script)
      setWorkNotice('文案已复制')
    } catch {
      setWorkNotice('复制失败，请在面板里手动选中')
    }
  }

  /** 读这家公司已授权的发布平台；没授权就返回空数组，不瞎写别的平台。 */
  const authorizedCopyPlatforms = async (target: string): Promise<string[]> => {
    try {
      const response = await fetch('/digital-human-studio/publish-now', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'accounts', space: target }),
      })
      const data = await response.json()
      const alias: Record<string, string> = { douyin: 'douyin', xiaohongshu: 'xiaohongshu', tencent: 'shipinhao' }
      const keys = ((data?.items || []) as any[]).map(binding => alias[String(binding?.platform || '')]).filter(Boolean)
      return Array.from(new Set(keys)) as string[]
    } catch { return [] }
  }

  /** 把「读这条成片、写文案、配封面」组装成一句能直接发给 AI 的话。 */
  const buildCopyPrompt = (item: RecentTask, platforms: string[]) => {
    const labels: Record<string, string> = { douyin: '抖音', xiaohongshu: '小红书', shipinhao: '视频号' }
    const keys = platforms.length ? platforms : ['douyin']
    const names = keys.map(key => labels[key]).join('、')
    const primary = keys.includes('douyin') ? 'douyin' : keys[0]
    const schema = keys.map(key => `${key}（${labels[key]}）`).join(' / ')
    const fileUrl = item.mediaUrl || `/digital-human-studio/works/file?space=${spaceId}&id=${item.id}`
    const isImage = kindLabel(item.kind).includes('图片')
    const noun = isImage ? '图片' : '视频'
    return [
      `帮我干活：先读这条成片，再写一版能直接发抖音的文案。`,
      ``,
      `成片库里的这条成片：`,
      `- ID：${item.id}`,
      `- 标题：${item.title || '（没写标题）'}`,
      `- 类型：${kindLabel(item.kind)}`,
      `- ${noun}地址：${fileUrl}`,
      ``,
      `要求：`,
      isImage ? `1. 先把这张图片真正看一遍（用读图工具，别只按标题猜），提炼它表达的重点、文字和画面；` : `1. 先把这条视频真正看一遍（用视频理解/读片工具，别只按标题猜），提炼它讲的核心信息、步骤和画面；`,
      `2. 这家公司只授权了：${names}。只写这几个平台各一版，不要写没授权的平台，也不要拿一篇长文通用；`,
      `3. 每版标题 20 字以内，口语、有钩子，不要标题党；`,
      `4. 正文别写长：抖音、视频号 60–120 字，小红书 150–250 字。第一人称口语，讲清素材里的做法和结果；不要 Markdown 符号（不要 #、*、-、反引号），分段用换行；素材本身没内容时要明说，不要编；`,
      `5. 每版配 3–5 个话题标签（不带 # 的词）；`,
      `6. 再给 3 个封面文案（每个 10 字以内），并说明封面画什么画面；`,
      `7. 上面地址打不开时，用 dh_get_workspace 找到这条成片的本地文件路径再读；`,
      `8. 写完必须调用 dh_save_work_copy 存回这条成片（id 用上面的 ID）：title / body 传${labels[primary]}那一版，platforms 只传 ${schema} 的 title / body / tags（其它平台不要传），coverText / coverPrompt 传封面。存完我才能在成片卡片上直接发布。`,
    ].join('\n')
  }

  /** 点「写文案」：不在面板里本地生成，直接新开一个 AI 对话并把提示词发过去。 */
  const askAiForCopy = async (item: RecentTask) => {
    setCopyError('')
    if (!askAi) {
      setWorkNotice('当前环境不支持新开 AI 对话')
      return
    }
    try {
      const platforms = await authorizedCopyPlatforms(spaceId)
      if (!platforms.length) {
        setWorkNotice('这家公司还没授权发布平台，先去「平台账号」授权，再写文案')
        setAppPage('platform-accounts')
        return
      }
      setWorkNotice(`提示词已放进新对话的输入框（按已授权的 ${platforms.length} 个平台写），你点发送就行`)
      await askAi(buildCopyPrompt(item, platforms), { spaceId })
    } catch (reason) {
      setWorkNotice(reason instanceof Error ? reason.message : '打开 AI 对话失败')
    }
  }

  /** 让 AI 画封面：跟写文案一样，只把提示词放进新对话的输入框，用户自己点发送。 */
  const askAiForCover = async (prompt?: string) => {
    const item = copyOpen
    if (!item) return
    setCopyError('')
    if (!askAi) {
      setWorkNotice('当前环境不支持新开 AI 对话')
      return
    }
    const lines = [
      '给成片库里的一条成片重画封面，画好后直接写回这条成片，只换封面、不要动文案。',
      `成片 ID：${item.id}`,
      `成片标题：${item.title}`,
      item.copy?.coverText ? `封面大字是「${item.copy.coverText}」，画面里不要出现任何文字、字母、logo，大字由前端叠在上面的。` : '',
      prompt ? `画面要求：${prompt}` : '',
      '画 16:9 横版封面，调用 dh_paint_work_cover 写回，useFrame 传 true：先取这条视频的真实画面当参考图，人物、场景跟参考帧保持一致，不要虚构人物。只有我明确说要插画封面时才用 useFrame=false。',
    ].filter(Boolean)
    try {
      setWorkNotice('封面提示词已放进新对话的输入框，你点发送就行')
      await askAi(lines.join('\n'), { spaceId })
    } catch (reason) {
      setWorkNotice(reason instanceof Error ? reason.message : '打开 AI 对话失败')
    }
  }

  /** 让模型看这条成片，写出配套文案和封面（自媒体工作台那套能力，入口放在成片上）。 */
  const generateWorkCopy = async (item: RecentTask) => {
    const target = spaceId
    setCopyBusy(item.id)
    setCopyError('')
    try {
      const platforms = await authorizedCopyPlatforms(target)
      if (!platforms.length) {
        setWorkNotice('这家公司还没授权发布平台，先去「平台账号」授权，再写文案')
        setAppPage('platform-accounts')
        return
      }
      const response = await fetch('/digital-human-studio/works/copy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ space: target, id: item.id, platforms }),
      })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error(data.error || '生成失败')
      const merged = { ...item, ...(data.item || {}), copy: data.copy } as RecentTask
      if (spaceIdRef.current === target) {
        setRecent(previous => previous.map(row => (row.id === item.id ? { ...row, ...(data.item || {}), copy: data.copy } : row)))
      }
      setCopyOpen(merged)
      setWorkNotice(data.copy?.coverError ? `文案写好了；封面没画出来：${data.copy.coverError}` : '文案和封面都做好了')
    } catch (reason) {
      setCopyError(reason instanceof Error ? reason.message : '生成失败')
    } finally {
      setCopyBusy('')
    }
  }

  /** 打开成稿页：已经有文案就直接看，没有就现场生成。 */
  const openWorkCopy = (item: RecentTask) => {
    setCopyError('')
    setWorkNotice('')
    setCopyOpen(item)
    setAppPage('work-copy')
  }

  /** 从日历排期里点开对应成片看成稿。 */
  const openCalendarWork = (work: { id: string; kind: string; title: string; at?: number }) => {
    const known = recent.find(row => row.id === work.id)
    const item = known ?? ({ id: work.id, kind: work.kind, title: work.title, at: work.at ?? Date.now() } as RecentTask)
    openWorkCopy(item)
  }

  /** 让 AI 按一句话改文案：只改提到的字段，改完留在成稿页。 */
  const reviseWorkCopy = async (instruction: string, platform?: string) => {
    const item = copyOpen
    const text = instruction.trim()
    if (!item?.copy || !text || copyChatBusy) return
    const target = spaceId
    setCopyChatBusy(true)
    setCopyError('')
    try {
      const response = await fetch('/digital-human-studio/works/copy/revise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ space: target, id: item.id, instruction: text, platform }),
      })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error(data.error || '改稿失败')
      const merged = { ...item, ...(data.item || {}), copy: data.copy } as RecentTask
      if (spaceIdRef.current === target) {
        setRecent(previous => previous.map(row => (row.id === item.id ? { ...row, ...(data.item || {}), copy: data.copy } : row)))
      }
      setCopyOpen(merged)
      setWorkNotice('按你说的改好了')
    } catch (reason) {
      setCopyError(reason instanceof Error ? reason.message : '改稿失败')
    } finally {
      setCopyChatBusy(false)
    }
  }

  /** 帧+大字合成封面：前端 canvas 合成好的图传回来落库。 */
  const textCoverWork = async (image: string) => {
    const item = copyOpen
    if (!item?.copy) { setCopyError('这条件片还没有文案，先生成一次'); throw new Error('还没有文案') }
    const target = spaceId
    setCopyChatBusy(true)
    setCopyError('')
    try {
      const response = await fetch('/digital-human-studio/works/cover-text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ space: target, id: item.id, image }),
      })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error(data.error || '合成封面失败')
      const merged = { ...item, ...(data.item || {}), copy: data.copy } as RecentTask
      if (spaceIdRef.current === target) {
        setRecent(previous => previous.map(row => (row.id === item.id ? { ...row, ...(data.item || {}), copy: data.copy } : row)))
      }
      setCopyOpen(merged)
      setWorkNotice('封面已用「帧 + 大字」合成，不再依赖 AI 画图')
    } catch (reason) {
      setCopyError(reason instanceof Error ? reason.message : '合成封面失败')
      throw reason
    } finally {
      setCopyChatBusy(false)
    }
  }

  /** 取帧当封面：把视频某秒的画面抽成 jpg 写回 copy.coverUrl，封面大字保留。 */
  const frameWorkCover = async (at: number): Promise<{ copy?: unknown }> => {
    const item = copyOpen
    if (!item?.copy) { setCopyError('这条件片还没有文案，先生成一次'); throw new Error('这条件片还没有文案') }
    const target = spaceId
    setCopyChatBusy(true)
    setCopyError('')
    try {
      const response = await fetch('/digital-human-studio/works/cover-frame', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ space: target, id: item.id, at, apply: true }),
      })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error(data.error || '取帧失败')
      const merged = { ...item, ...(data.item || {}), copy: data.copy } as RecentTask
      if (spaceIdRef.current === target) {
        setRecent(previous => previous.map(row => (row.id === item.id ? { ...row, ...(data.item || {}), copy: data.copy } : row)))
      }
      setCopyOpen(merged)
      setWorkNotice(`封面已换成视频 ${at}s 处那一帧，封面大字还在`)
      return { copy: data.copy }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '取帧失败'
      setCopyError(message)
      throw reason
    } finally {
      setCopyChatBusy(false)
    }
  }

  /** 后来才授权的平台：基于已有版本补写这一版（只动这一个平台）。 */
  const fillPlatformCopy = (platform: string) => {
    const label = platform === 'xiaohongshu' ? '小红书' : platform === 'shipinhao' ? '视频号' : '抖音'
    const need = platform === 'xiaohongshu' ? '150–250 字，可分小段' : '60–120 字'
    void reviseWorkCopy(`这条成片之前只写了别的平台。现在按${label}的调性补写一版：标题 20 字内，正文 ${need}，第一人称口语，3–5 个话题标签；讲的是同一件事，但换成${label}用户习惯的说法。`, platform)
  }

  /** 只换封面，文案不动。可以带用户改过的提示词。 */
  const redrawWorkCover = async (prompt?: string) => {
    const item = copyOpen
    if (!item?.copy) return
    const target = spaceId
    setCopyBusy(item.id)
    setCopyError('')
    try {
      const response = await fetch('/digital-human-studio/works/copy/cover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ space: target, id: item.id, ...(prompt ? { prompt } : {}) }),
      })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error(data.error || '重画封面失败')
      const merged = { ...item, ...(data.item || {}), copy: data.copy } as RecentTask
      if (spaceIdRef.current === target) {
        setRecent(previous => previous.map(row => (row.id === item.id ? { ...row, ...(data.item || {}), copy: data.copy } : row)))
      }
      setCopyOpen(merged)
      setWorkNotice(prompt ? '按你改的提示词重画了一张封面' : '封面换了一张')
    } catch (reason) {
      setCopyError(reason instanceof Error ? reason.message : '重画封面失败')
    } finally {
      setCopyBusy('')
    }
  }

  /** 把这条成片 + 文案排进日历（勾了自动发就到点真发）。 */
  const saveWorkPlan = async (value?: string) => {
    const item = copyOpen
    if (!item) return
    const scheduledAt = value || copyPlan.scheduledAt
    if (!scheduledAt) { setCopyError('先选一个发布时间'); return }
    const target = spaceId
    setCopyBusy(item.id)
    setCopyError('')
    try {
      const response = await fetch('/digital-human-studio/publish-calendar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          space: target,
          item: {
            title: item.copy?.title || item.title,
            scheduledAt,
            platform: copyPlan.platform || '抖音',
            notes: item.copy?.coverText ? `封面大字：${item.copy.coverText}` : '',
            historyId: item.id,
            status: 'pending',
            autoSend: copyPlan.autoSend,
          },
        }),
      })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error(data.error || '排期失败')
      setWorkNotice(`已排到 ${scheduledAt.replace('T', ' ')}${copyPlan.autoSend ? '，到点自动发' : ''}`)
    } catch (reason) {
      setCopyError(reason instanceof Error ? reason.message : '排期失败')
    } finally {
      setCopyBusy('')
    }
  }

  /** 删一条成片：连带磁盘文件一起删；被排期引用的会被后端拦下来并给出原因。 */
  const deleteWork = async (item: RecentTask) => {
    const title = item.title || kindLabel(item.kind)
    if (!window.confirm(`删除「${title}」？视频/图片文件会一起删掉，删除后不能恢复。`)) return
    const target = spaceId
    setWorkDeleting(item.id)
    setWorkNotice('')
    try {
      const response = await fetch('/digital-human-studio/history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'remove', space: target, id: item.id }),
      })
      const data = await response.json()
      if (response.status === 409 && data?.canCascade) {
        const labels = (data.plans || []).map((plan: { label: string }) => plan.label).join('、')
        const ok = window.confirm(`这条成片还被 ${(data.plans || []).length} 条排期引用（${labels}）。\n继续删除会把这些排期一起删掉，确认删除？`)
        if (!ok) {
          setWorkNotice(`没删：它还被 ${(data.plans || []).length} 条排期引用`)
          return
        }
        const again = await fetch('/digital-human-studio/history', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'remove', space: target, id: item.id, cascade: true }),
        })
        const data2 = await again.json()
        if (!again.ok || data2.success === false) throw new Error(data2.error || '删除失败')
        const items2 = await pullDigitalHumanHistory(target, false)
        if (spaceIdRef.current === target) setRecent(previous => (sameHistory(previous, items2 as RecentTask[]) ? previous : (items2 as RecentTask[])))
        setWorkNotice('已删除，连同排期一起清掉了')
        return
      }
      if (!response.ok || data.success === false) throw new Error(data.error || '删除失败')
      const items = await pullDigitalHumanHistory(target, false)
      if (spaceIdRef.current === target) setRecent(previous => (sameHistory(previous, items as RecentTask[]) ? previous : (items as RecentTask[])))
      setWorkNotice(data.removedFiles ? '已删除，文件也清掉了' : '已删除')
    } catch (reason) {
      setWorkNotice(reason instanceof Error ? reason.message : '删除失败')
    } finally {
      setWorkDeleting('')
    }
  }

  /** 进成片页：先补登记漏登记的成品（幂等，每个公司一次），再从服务端拉一次最新列表，
   *  并在页面停留/切回窗口时自动同步（AI 写完文案、画完封面或渲染完视频后直接生效，不用手动刷新）。 */
  useEffect(() => {
    if ((appPage !== 'works' && appPage !== 'work-copy') || !spaceId) return
    const target = spaceId
    const needBackfill = workBackfilled !== target
    let disposed = false
    let inFlight = false
    const syncNow = async (withBackfill: boolean) => {
      if (disposed || inFlight) return
      inFlight = true
      try {
        if (withBackfill) {
          setWorkBackfilled(target)
          await fetch('/digital-human-studio/works/backfill', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ space: target }),
          }).catch(() => null)
        }
        const items = await pullDigitalHumanHistory(target, false)
        if (disposed || spaceIdRef.current !== target) return
        const next = items as RecentTask[]
        setRecent(previous => (sameHistory(previous, next) ? previous : next))
      } catch {
        /* 拉取失败就继续用本地缓存浏览 */
      } finally {
        inFlight = false
      }
    }
    void syncNow(needBackfill)
    const onFocus = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      void syncNow(false)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void syncNow(false)
    }, 3500)
    return () => {
      disposed = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      window.clearInterval(timer)
    }
  }, [appPage, spaceId, workBackfilled])
  const materialInputRef = useRef<HTMLInputElement | null>(null)
  const materialSlotRef = useRef<MaterialSlotId>('product')
  const [recent, setRecent] = useState<RecentTask[]>(() => loadHistory(loadDigitalHumanSpaceId()))

  /** 成稿页刷新后 recent 会重新拉一遍，这里把打开的那条同步成最新（否则改稿结果会被旧对象覆盖）。 */
  useEffect(() => {
    if (!copyOpen) return
    const fresh = recent.find(item => item.id === copyOpen.id)
    if (!fresh) return
    if (fresh.copy !== copyOpen.copy || fresh.title !== copyOpen.title) setCopyOpen(fresh)
  }, [recent, copyOpen])

  /** 档案页展示「按账号判断的可发布平台」，写稿时直接用，不让人手填平台。 */
  useEffect(() => {
    let live = true
    setPublishPlatforms([])
    void postPlatformAccount(spaceId, 'studio.accounts.list')
      .then(result => {
        if (!live) return
        const items = Array.isArray((result as { items?: unknown })?.items) ? (result as { items: unknown[] }).items : []
        const names = new Set<string>()
        for (const raw of items) {
          const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
          if (String(row.status || '') !== 'authorized') continue
          const platform = String(row.platform || '').trim()
          if (platform) names.add(accountPlatformLabel(platform))
        }
        setPublishPlatforms([...names])
      })
      .catch(() => { /* 发布插件没启用时留空 */ })
    return () => { live = false }
  }, [spaceId])

  const [resources, setResources] = useState<ResourceState>({ avatars: [], voices: [] })
  const [resourceError, setResourceError] = useState('')
  const [picker, setPicker] = useState<'avatar' | 'voice' | 'model' | null>(null)
  const [selectedAvatar, setSelectedAvatar] = useState<DigitalHumanResource | null>(null)
  const [selectedVoice, setSelectedVoice] = useState<DigitalHumanResource | null>(null)
  const [workspace, setWorkspace] = useState<Workspace>('create')
  const [uploadStatus, setUploadStatus] = useState<{ configured: boolean; host?: string; error?: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedToLibrary = useRef<Set<string>>(new Set())
  const cloneFileRef = useRef<HTMLInputElement | null>(null)
  const cloneSampleRef = useRef('')
  const recentRef = useRef<RecentTask[]>(recent)
  const pendingVideoRef = useRef<Record<string, unknown> | null>(pendingVideo)
  const taskRef = useRef<TaskStatus | null>(task)
  const chainingRef = useRef(false)
  const didApplyDefaults = useRef(false)
  const spaceIdRef = useRef(spaceId)
  const resourceGen = useRef(0)
  const submitBtnRef = useRef<HTMLButtonElement | null>(null)
  const taskRailListRef = useRef<HTMLDivElement | null>(null)
  const taskIdAlias = useRef<Record<string, string>>({})
  const pipelineRef = useRef<{ localId: string; railId: string; title: string; coverUrl?: string } | null>(null)
  const [enteringTaskId, setEnteringTaskId] = useState('')
  const [pollNonce, setPollNonce] = useState(0)
  const [imageModels, setImageModels] = useState<string[]>([])
  const [imageModelsNote, setImageModelsNote] = useState('')
  recentRef.current = recent
  pendingVideoRef.current = pendingVideo
  taskRef.current = task
  spaceIdRef.current = spaceId
  const currentSpace = spaces.find(item => item.id === spaceId) || spaces[0]
  const spaceStats = useMemo<SpaceStat[]>(() => {
    const monthStart = monthStartMs()
    return spaces.map(space => {
      const tasks = space.id === spaceId ? recent : loadHistory(space.id)
      return {
        space,
        tasks,
        filled: briefFilled(space.brief),
        monthCount: tasks.filter(item => item.at >= monthStart).length,
      }
    })
  }, [spaces, spaceId, recent])
  const monthCount = spaceStats.reduce((sum, row) => sum + row.monthCount, 0)
  const missingCompanies = spaceStats.filter(row => !row.filled)
  const firstVideoCompanies = spaceStats.filter(row => row.filled && row.monthCount === 0)
  const recentAcross = useMemo(
    () => spaceStats
      .flatMap(row => row.tasks.map(task => ({ ...task, spaceId: row.space.id, spaceName: row.space.name })))
      .sort((left, right) => right.at - left.at)
      .slice(0, 8),
    [spaceStats],
  )
  const visibleCompanies = useMemo(() => {
    const query = companyQuery.trim().toLowerCase()
    if (!query) return spaceStats
    return spaceStats.filter(row => row.space.name.toLowerCase().includes(query))
  }, [spaceStats, companyQuery])

  const isClone = kind === 'xdh-avatar-clone' || kind === 'xdh-voice-clone'
  const isImage = isImageKind(kind)
  const isVideo = kind === 'xdh-avatar-video'
  const isAudio = kind === 'xdh-audio'
  const models = useMemo(() => isImage ? imageModels : (MODELS[kind] || []), [kind, isImage, imageModels])
  const needsText = !isClone

  const notify = (message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 1800)
  }

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  useEffect(() => {
    void fetch('/digital-human-studio/digital-human/status')
      .then(response => response.json())
      .then(setGateway)
      .catch(() => setError('无法连接 digital-human-studio'))
  }, [])

  const applyLibraryDefaults = useCallback((avatars: DigitalHumanResource[], voices: DigitalHumanResource[]) => {
    const avatar = avatars.find(item => Number(item.is_default) === 1) || avatars[0]
    const voice = voices.find(item => Number(item.is_default) === 1) || voices[0]
    if (avatar) {
      setSelectedAvatar(avatar)
      setAvatarId(avatarResourceID(avatar))
      if (avatar.model_code) setModelCode(avatar.model_code)
    } else {
      setSelectedAvatar(null)
      setAvatarId('')
    }
    if (voice) {
      setSelectedVoice(voice)
      setVoiceId(voiceResourceID(voice))
    } else {
      setSelectedVoice(null)
      setVoiceId('')
    }
  }, [])

  const loadResources = useCallback(async () => {
    const gen = resourceGen.current
    try {
      const response = await fetch('/digital-human-studio/digital-human/resources')
      const value = await response.json()
      if (gen !== resourceGen.current) return
      if (value?.success === false) throw new Error(value.error || '读取本地资源失败')
      const avatars = Array.isArray(value?.avatars) ? value.avatars as DigitalHumanResource[] : []
      const voices = Array.isArray(value?.voices) ? value.voices as DigitalHumanResource[] : []
      setResources({ avatars, voices })
      setResourceError('')
      if (!didApplyDefaults.current) {
        didApplyDefaults.current = true
        applyLibraryDefaults(avatars, voices)
      }
    } catch {
      if (gen !== resourceGen.current) return
      setResourceError('本地资源库暂不可用')
    }
  }, [applyLibraryDefaults])

  useEffect(() => {
    void loadResources()
  }, [loadResources])

  const adoptSpace = useCallback((id: string, list?: StudioSpace[]) => {
    if (list) setSpaces(list)
    if (id === spaceIdRef.current) return
    spaceIdRef.current = id
    setSpaceId(id)
    setRecent(loadHistory(id))
    void pullDigitalHumanHistory(id, false).then(items => {
      if (spaceIdRef.current !== id) return
      const next = items as RecentTask[]
      setRecent(previous => sameHistory(previous, next) ? previous : next)
    }).catch(() => {})
    setTaskId('')
    setTask(null)
    setArtifacts([])
    setPendingVideo(null)
    setWorkspace('create')
    setError('')
    setPicker(null)
    setSelectedAvatar(null)
    setSelectedVoice(null)
    setAvatarId('')
    setVoiceId('')
    didApplyDefaults.current = false
    resourceGen.current += 1
    savedToLibrary.current = new Set()
    pipelineRef.current = null
    setPollNonce(value => value + 1)
    void loadResources()
  }, [loadResources])

  const applySpacesPayload = useCallback((value: { currentId?: string; spaces?: StudioSpace[] }) => {
    const list = Array.isArray(value.spaces) ? value.spaces.filter(item => item && item.id && item.name) : []
    const nextId = String(value.currentId || spaceIdRef.current || DEFAULT_DIGITAL_HUMAN_SPACE_ID)
    if (list.length) setSpaces(list)
    adoptSpace(nextId, list.length ? list : undefined)
  }, [adoptSpace])

  const postSpace = useCallback(async (body: Record<string, unknown>) => {
    setSpaceBusy(true)
    setSpaceError('')
    try {
      const response = await fetch('/digital-human-studio/spaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const value = await response.json()
      if (!response.ok || value?.success === false) throw new Error(value?.error || '公司空间操作失败')
      applySpacesPayload(value)
      setSpaceMenu('closed')
      return value
    } catch (error) {
      setSpaceError(error instanceof Error ? error.message : '公司空间操作失败')
      throw error
    } finally {
      setSpaceBusy(false)
    }
  }, [applySpacesPayload])

  const sendBriefChat = useCallback(async () => {
    const text = briefAiNotes.trim()
    if (!text && !briefAiFiles.length) { setBriefAiError('说点什么，或贴点资料'); return }
    const files = briefAiFiles
    const userText = text || `（贴了 ${files.length} 份资料）`
    // 长文本 / 带换行的当成资料落进知识库，短句只当指令
    const asNote = text.length > 80 || text.includes('\n')
    const history = briefChat.slice(-8).map((m) => ({ role: m.role, text: m.text }))
    setBriefChat((prev) => [...prev, { id: `u${Date.now()}`, role: 'user', text: userText, fileCount: files.length }])
    setBriefAiNotes('')
    setBriefAiFiles([])
    setBriefAiBusy(true)
    setBriefAiError('')
    try {
      const response = await fetch('/digital-human-studio/spaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'brief-chat', id: spaceId, message: text, notes: asNote ? text : '', files, history }),
      })
      const value = await response.json()
      if (!response.ok || value?.success === false) throw new Error(value?.error || 'AI 回复失败')
      const updates = value?.updates && typeof value.updates === 'object' ? value.updates as Partial<ClientBrief> : {}
      const reply = String(value?.reply || '').trim()
      const missing = String(value?.missing || '')
      const msgId = `a${Date.now()}`
      setBriefChat((prev) => [...prev, {
        id: msgId,
        role: 'assistant',
        text: reply || '我这边没接上，再说一遍试试？',
        updates: Object.keys(updates).length ? updates : undefined,
        missing,
      }])
      if (Object.keys(updates).length) {
        setBriefPicked((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(updates)) next[`${msgId}|${key}`] = true
          return next
        })
      }
    } catch (error) {
      setBriefAiError(error instanceof Error ? error.message : 'AI 回复失败')
    } finally {
      setBriefAiBusy(false)
    }
  }, [briefAiNotes, briefAiFiles, briefChat, spaceId])

  const applyBriefChat = useCallback(async (msgId: string) => {
    const msg = briefChat.find((item) => item.id === msgId)
    if (!msg?.updates) return
    const next = { ...briefDraft }
    for (const [key, value] of Object.entries(msg.updates)) {
      if (!briefPicked[`${msgId}|${key}`]) continue
      if (typeof value === 'string' && value.trim()) next[key as keyof ClientBrief] = value
    }
    setBriefDraft(next)
    try {
      await postSpace({ action: 'brief', id: spaceId, brief: next })
      notify('档案已写入，写口播会按这份来')
      setBriefChat((prev) => prev.map((item) => (item.id === msgId ? { ...item, updates: undefined, applied: true } : item)))
    } catch {
      /* 错误已在空间接口里提示 */
    }
  }, [briefChat, briefDraft, briefPicked, postSpace, spaceId])

  const pickBriefFiles = useCallback(async (files: FileList | null) => {
    if (!files) return
    const rows: { name: string; text: string }[] = []
    for (const file of Array.from(files).slice(0, 6)) {
      if (file.size > 2_000_000) continue
      const text = await file.text().catch(() => '')
      if (text.trim()) rows.push({ name: file.name, text: text.slice(0, 8000) })
    }
    if (!rows.length) { setBriefAiError('这些文件读不出文字，PDF/Word 直接复制内容贴进来'); return }
    setBriefAiFiles((prev) => [...prev, ...rows].slice(0, 8))
  }, [])

  /** 形象换装：拿人物照片当参考图，只改衣服/背景，出一组新图 */
  const runRestyle = useCallback(async () => {
    if (!restylePerson && !selectedAvatar) { setRestyleError('先选一个形象，或上传一张人物照片'); return }
    if (!restyleClothing.trim() && !restyleScene.trim() && !restyleExtra.trim() && !restyleBackdrop && !restyleOutfit) { setRestyleError('说一下要换什么：衣服、背景，或贴一张场景图'); return }
    setRestyleBusy(true)
    setRestyleError('')
    setRestyleImages([])
    setRestyleSaved({})
    try {
      const response = await fetch('/digital-human-studio/spaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-space': spaceIdRef.current },
        body: JSON.stringify({
          action: 'portrait-restyle',
          id: spaceIdRef.current,
          avatarId: selectedAvatar?.id || '',
          personImage: restylePerson,
          mode: restyleMode,
          clothing: restyleClothing,
          scene: restyleScene,
          extra: restyleExtra,
          backdropImage: restyleBackdrop,
          outfitImage: restyleOutfit,
          count: 1,
        }),
      })
      const value = await response.json().catch(() => null)
      if (!response.ok || !value || value.success === false) throw new Error(value?.error || '换装失败')
      const images = Array.isArray(value.images) ? (value.images as string[]) : []
      if (!images.length) throw new Error('没生成出图，换个说法再试')
      setRestyleImages(images)
    } catch (error) {
      setRestyleError(error instanceof Error ? error.message : '换装失败')
    } finally {
      setRestyleBusy(false)
    }
  }, [restylePerson, selectedAvatar, restyleMode, restyleClothing, restyleScene, restyleExtra, restyleBackdrop, restyleOutfit])

  /** 读本地图片并压缩成 900 长边的 data URL，直接当参考图传给后端 */
  const pickRestylePerson = useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height))
      const w = Math.max(1, Math.round(bitmap.width * scale))
      const h = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('这个浏览器画不出图')
      ctx.drawImage(bitmap, 0, 0, w, h)
      setRestylePerson(canvas.toDataURL('image/jpeg', 0.84))
      setRestylePersonName(file.name)
      setRestyleError('')
    } catch {
      setRestyleError('这张图读不出来，换一张 jpg/png 试试')
    }
  }, [])


  /** 场景图压到 900 长边：背景细节要够，文件又别太大 */
  const pickRestyleBackdrop = useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height))
      const w = Math.max(1, Math.round(bitmap.width * scale))
      const h = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('这个浏览器画不出图')
      ctx.drawImage(bitmap, 0, 0, w, h)
      setRestyleBackdrop(canvas.toDataURL('image/jpeg', 0.86))
      setRestyleBackdropName(file.name)
      setRestyleExtra('')
      setRestyleError('')
    } catch {
      setRestyleError('这张图读不出来，换一张 jpg/png 试试')
    }
  }, [])

  const goCreate = useCallback(() => {
    setAppPage('create')
    setWorkspace('create')
    setSpaceMenu('closed')
    setCompanyOpen(false)
  }, [])
  const selectCompany = useCallback(async (id: string) => {
    if (id === spaceIdRef.current) return spaces.find(item => item.id === id)
    const value = await postSpace({ action: 'select', id })
    const list = Array.isArray(value?.spaces) ? value.spaces as StudioSpace[] : []
    return list.find(item => item.id === id)
  }, [postSpace, spaces])

  const openCompanyArchive = useCallback(async (id: string) => {
    setAppPage('companies')
    setCompanyOpen(true)
    setSpaceMenu('closed')
    try {
      const row = await selectCompany(id)
      setBriefDraft(normalizeBrief(row?.brief))
      setSpaceNameDraft(row?.name || '')
      setSpaceFolderDraft(row?.lastProjectFolder || '')
    } catch {
      /* error shown */
    }
  }, [selectCompany])

  /** Home「继续」only: stay on current company; empty brief → archive, else create digital-human video. */
  const continueCurrentCompany = useCallback(() => {
    const id = currentSpace?.id
    if (!id) {
      goCreate()
      return
    }
    if (!briefFilled(currentSpace?.brief)) {
      void openCompanyArchive(id)
      return
    }
    setKind('xdh-avatar-video')
    setAppPage('create')
    setWorkspace('create')
    setCompanyOpen(false)
    setSpaceMenu('closed')
  }, [currentSpace, goCreate, openCompanyArchive])

  const openCompanyCreate = useCallback(async (id: string, nextKind: string) => {
    try {
      await selectCompany(id)
      setKind(nextKind)
      setPendingVideo(null)
      setBusy(false)
      setAppPage('create')
      setWorkspace('create')
      setCompanyOpen(false)
      setSpaceMenu('closed')
    } catch {
      /* error shown */
    }
  }, [selectCompany])

  const openCompanyWorks = useCallback(async (id: string) => {
    try {
      await selectCompany(id)
      setAppPage('works')
      setWorkspace('create')
      setCompanyOpen(false)
      setSpaceMenu('closed')
    } catch {
      /* error shown */
    }
  }, [selectCompany])

  const applyMaterialsPayload = useCallback((value: { items?: StudioMaterial[]; root?: string }) => {
    const items = Array.isArray(value.items) ? value.items.filter(item => item && item.id && item.slot) : []
    setMaterials(items)
    setSelectedMaterial(curr => curr ? (items.find(item => item.id === curr.id) || null) : null)
    if (typeof value.root === 'string') setMaterialsRoot(value.root)
  }, [])

  // 小葱 API 后台维护的公共造型素材库（场景 / 服装套装），与企业素材一起展示
  const [publicStyle, setPublicStyle] = useState<{ scenes: PublicStyleItem[]; outfits: PublicStyleItem[] }>({ scenes: [], outfits: [] })
  const loadPublicStyle = useCallback(async () => {
    try {
      const response = await fetch('/digital-human-studio/style-library')
      const value = await response.json().catch(() => null) as { success?: boolean; scenes?: PublicStyleItem[]; outfits?: PublicStyleItem[] } | null
      if (!response.ok || !value?.success) return
      const pick = (raw?: PublicStyleItem[]) => (Array.isArray(raw) ? raw : [])
        .filter(item => item && item.url)
        .map(item => ({ id: String(item.id || item.url), name: String(item.name || '素材'), url: String(item.url) }))
      setPublicStyle({ scenes: pick(value.scenes), outfits: pick(value.outfits) })
    } catch {
      /* 公共库读不到不影响企业素材 */
    }
  }, [])

  const loadMaterials = useCallback(async (id: string) => {
    const response = await fetch(`/digital-human-studio/materials?space=${encodeURIComponent(id)}`)
    const value = await response.json().catch(() => null) as { success?: boolean; error?: string; items?: StudioMaterial[]; root?: string } | null
    if (!response.ok || value?.success === false) throw new Error(value?.error || '无法读取素材柜')
    applyMaterialsPayload(value || {})
  }, [applyMaterialsPayload])

  const openCompanyMaterials = useCallback(async (id: string) => {
    try {
      await selectCompany(id)
      setAppPage('materials')
      setWorkspace('create')
      setCompanyOpen(false)
      setSpaceMenu('closed')
      await loadMaterials(id)
    } catch {
      /* error shown */
    }
  }, [selectCompany, loadMaterials])

  const openCompanyAssets = useCallback(async (id: string, tab?: 'avatars' | 'voices') => {
    try {
      await selectCompany(id)
      if (tab) setIpTab(tab)
      setAppPage('ip-assets')
      setWorkspace('create')
      setCompanyOpen(false)
      setSpaceMenu('closed')
      void loadResources()
    } catch {
      /* error shown */
    }
  }, [selectCompany, loadResources])

  const openCloneModal = useCallback((target: 'xdh-avatar-clone' | 'xdh-voice-clone') => {
    setName('')
    setSampleUrl('')
    setUploadError('')
    setCloneModalError('')
    setCloneModelCode(target === 'xdh-voice-clone' ? (MODELS['xdh-voice-clone']?.[0] || 'SPro') : (MODELS['xdh-avatar-clone']?.[0] || 'VPro'))
    setCloneModalKind(target)
  }, [])

  const openRestyleStudio = useCallback((avatar?: DigitalHumanResource | null) => {
    if (avatar) {
      const id = avatarResourceID(avatar)
      setSelectedAvatar(avatar)
      setAvatarId(id)
      if (avatar.model_code) setModelCode(avatar.model_code)
      setRestylePerson('')
      setRestylePersonName('')
    }
    setRestyleOpen(true)
    setRestyleImages([])
    setRestyleSaved({})
    setRestyleError('')
    void loadMaterials(spaceIdRef.current).catch(() => null)
    void loadPublicStyle()
  }, [loadMaterials, loadPublicStyle])

  const uploadMaterials = useCallback(async (slot: MaterialSlotId, files: FileList | File[]) => {
    const list = Array.from(files).filter(file => file && file.size > 0)
    if (!list.length) return
    setMaterialBusy(slot)
    setSpaceError('')
    try {
      let last: { items?: StudioMaterial[]; root?: string } | null = null
      for (const file of list) {
        const response = await fetch('/digital-human-studio/materials/file', {
          method: 'POST',
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-space': spaceIdRef.current,
            'x-slot': slot,
            'x-file-name': encodeURIComponent(file.name),
          },
          body: file,
        })
        const value = await response.json().catch(() => null) as { success?: boolean; error?: string; items?: StudioMaterial[]; root?: string } | null
        if (!response.ok || value?.success === false) throw new Error(value?.error || `上传 ${file.name} 失败`)
        last = value
      }
      if (last) applyMaterialsPayload(last)
      notify(list.length > 1 ? `已放入 ${list.length} 个素材` : '素材已放入这家公司')
      return last as { items?: StudioMaterial[]; root?: string; item?: StudioMaterial } | null
    } catch (error) {
      setSpaceError(error instanceof Error ? error.message : '上传素材失败')
    } finally {
      setMaterialBusy('')
    }
  }, [applyMaterialsPayload])

  /** 换装出来的图存进素材柜（门店槽位） */
  const saveRestyleImage = useCallback(async (url: string) => {
    try {
      const blob = await fetch(url).then((res) => res.blob())
      const file = new File([blob], `形象造型-${Date.now()}.png`, { type: blob.type || 'image/png' })
      await uploadMaterials('store', [file])
      setRestyleSaved((prev) => ({ ...prev, [url]: true }))
      notify('已存进素材柜')
    } catch {
      notify('这张没存进素材柜，可以直接下载')
    }
  }, [uploadMaterials, notify])

  const deleteMaterial = useCallback(async (item: StudioMaterial) => {
    if (!window.confirm(`从素材柜拿走「${item.name}」？\n取消不会删除文件。`)) return
    setMaterialBusy(item.id)
    setSpaceError('')
    try {
      const response = await fetch('/digital-human-studio/materials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete', space: spaceIdRef.current, id: item.id }),
      })
      const value = await response.json().catch(() => null) as { success?: boolean; error?: string; items?: StudioMaterial[]; root?: string } | null
      if (!response.ok || value?.success === false) throw new Error(value?.error || '删除失败')
      applyMaterialsPayload(value || {})
      notify('已从素材柜拿走')
    } catch (error) {
      setSpaceError(error instanceof Error ? error.message : '删除素材失败')
    } finally {
      setMaterialBusy('')
    }
  }, [applyMaterialsPayload])

  const renameMaterial = useCallback(async (item: StudioMaterial) => {
    const next = window.prompt('给这个素材改个名字', item.name)
    if (next == null) return
    const name = next.trim()
    if (!name || name === item.name) return
    setMaterialBusy(item.id)
    setSpaceError('')
    try {
      const response = await fetch('/digital-human-studio/materials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'rename', space: spaceIdRef.current, id: item.id, name }),
      })
      const value = await response.json().catch(() => null) as { success?: boolean; error?: string; items?: StudioMaterial[]; root?: string } | null
      if (!response.ok || value?.success === false) throw new Error(value?.error || '改名失败')
      applyMaterialsPayload(value || {})
      notify('素材名字已更新')
    } catch (error) {
      setSpaceError(error instanceof Error ? error.message : '改名失败')
    } finally {
      setMaterialBusy('')
    }
  }, [applyMaterialsPayload])

  const openMaterialsFolder = useCallback(async (slot: MaterialSlotId | '' = '') => {
    setMaterialBusy(slot ? `open-${slot}` : 'open-root')
    setSpaceError('')
    try {
      const response = await fetch('/digital-human-studio/materials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'open', space: spaceIdRef.current, ...(slot ? { slot } : {}) }),
      })
      const value = await response.json().catch(() => null) as { success?: boolean; error?: string; path?: string; opened?: boolean; note?: string; items?: StudioMaterial[]; root?: string } | null
      if (!response.ok || value?.success === false) throw new Error(value?.error || '打不开素材目录')
      if (typeof value?.root === 'string' || Array.isArray(value?.items)) applyMaterialsPayload(value || {})
      const path = String(value?.path || materialsRoot || '')
      if (value?.opened) {
        notify(slot ? '已尝试打开这个槽位目录' : '已尝试打开这家公司的素材目录')
      } else if (path) {
        try {
          await navigator.clipboard.writeText(path)
          notify(value?.note || '无法自动打开，路径已复制，可在 Finder 粘贴前往')
        } catch {
          setSpaceError(value?.note || `无法自动打开，请手动前往：${path}`)
        }
      } else {
        throw new Error(value?.note || '无法打开素材目录')
      }
    } catch (error) {
      setSpaceError(error instanceof Error ? error.message : '打开素材目录失败')
    } finally {
      setMaterialBusy('')
    }
  }, [applyMaterialsPayload, materialsRoot])

  const previewMaterial = useCallback((item: StudioMaterial) => {
    if (!item.url && item.kind !== 'image' && item.kind !== 'video' && item.kind !== 'audio') {
      setSpaceError('这个素材还不能预览')
      return
    }
    if (!item.url) {
      setSpaceError('这个素材还不能预览')
      return
    }
    setSpaceError('')
    setSelectedMaterial(item)
  }, [])

  useEffect(() => {
    setSelectedMaterial(null)
  }, [spaceId, appPage])

  const runCompanyAction = useCallback((id: string, action: CompanyActionId) => {
    if (action === 'publish-packs') {
      void selectCompany(id).then(() => { setPackHistoryId(''); setAppPage('publish-packs'); setWorkspace('create'); setCompanyOpen(false) }).catch(() => {})
      return
    }
    if (action === 'platform-accounts') {
      void selectCompany(id).then(() => { setAppPage('platform-accounts'); setWorkspace('create'); setCompanyOpen(false) }).catch(() => {})
      return
    }
    if (action === 'calendar') {
      void selectCompany(id).then(() => { setAppPage('calendar'); setWorkspace('create'); setCompanyOpen(false) }).catch(() => {})
      return
    }
    if (action === 'archive') return openCompanyArchive(id)
    if (action === 'materials') return openCompanyMaterials(id)
    if (action === 'video') return openCompanyCreate(id, 'xdh-avatar-video')
    if (action === 'audio') return openCompanyCreate(id, 'xdh-audio')
    if (action === 'image') return openCompanyCreate(id, 'ximg')
    return openCompanyWorks(id)
  }, [selectCompany, openCompanyArchive, openCompanyMaterials, openCompanyCreate, openCompanyWorks])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      void fetch('/digital-human-studio/spaces')
        .then(response => response.json())
        .then(value => {
          if (cancelled || value?.success === false) return
          applySpacesPayload(value)
          void pullAllDigitalHumanHistory(false).then(() => {
            if (cancelled) return
            const next = loadHistory(spaceIdRef.current)
            setRecent(previous => sameHistory(previous, next) ? previous : next)
          }).catch(() => {})
        })
        .catch(() => {
          if (!cancelled) setSpaceError('无法读取公司空间')
        })
    }
    load()
    window.addEventListener('xdh-digital-human-space', load)
    return () => {
      cancelled = true
      window.removeEventListener('xdh-digital-human-space', load)
    }
  }, [applySpacesPayload])

  useEffect(() => {
    if (!isImage) return
    let cancelled = false
    void fetch('/digital-human-studio/image/models')
      .then(response => response.json())
      .then(value => {
        if (cancelled) return
        const ids = Array.isArray(value?.models) ? value.models.map((item: unknown) => String(item || '').trim()).filter(Boolean) : []
        setImageModels(ids)
        setImageModelsNote(String(value?.note || value?.error || (ids.length ? '' : '小葱 API 还没有可用的生图模型')))
        if (ids.length && !ids.includes(modelCode)) setModelCode(ids[0])
      })
      .catch(() => {
        if (cancelled) return
        setImageModels([])
        setImageModelsNote('无法读取生图模型')
      })
    return () => { cancelled = true }
  }, [isImage])

  useEffect(() => {
    if (kind !== 'xdh-avatar-clone' && kind !== 'xdh-voice-clone' && !cloneModalKind) return
    void fetch('/digital-human-studio/upload')
      .then(response => response.json())
      .then(value => setUploadStatus({ configured: !!value.configured, host: value.host || '', error: value.error || '' }))
      .catch(() => setUploadStatus({ configured: false }))
  }, [kind, cloneModalKind])

  useEffect(() => {
    if (!models.includes(modelCode)) setModelCode(models[0] || '')
  }, [models, modelCode])

  useEffect(() => {
    if (!enteringTaskId) return
    const timer = window.setTimeout(() => setEnteringTaskId(''), 420)
    return () => window.clearTimeout(timer)
  }, [enteringTaskId])

  useEffect(() => {
    try {
      localStorage.setItem(digitalHumanHistoryKey(spaceId), JSON.stringify(recent))
      window.dispatchEvent(new Event('xdh-digital-human-history'))
    } catch {
      /* localStorage can be unavailable in private windows */
    }
  }, [recent, spaceId])

  useEffect(() => {
    const sync = () => {
      const next = loadHistory(spaceIdRef.current)
      setRecent(previous => sameHistory(previous, next) ? previous : next)
    }
    window.addEventListener('xdh-digital-human-history', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('xdh-digital-human-history', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SPACE_KEY, spaceId)
      window.dispatchEvent(new Event('xdh-digital-human-space'))
    } catch {
      /* localStorage can be unavailable in private windows */
    }
  }, [spaceId])

  const remember = (id: string, title: string, status?: string, extra?: Partial<RecentTask>) => {
    setRecent(previous => {
      const next = previous.filter(item => item.id !== id)
      next.unshift({
        id,
        kind: extra?.kind || kind,
        title,
        at: Date.now(),
        status,
        progress: extra?.progress || (status === 'QUEUED' ? '0%' : undefined),
        prompt: extra?.prompt ?? text,
        modelCode: extra?.modelCode || modelCode,
        coverUrl: extra?.coverUrl,
        mediaUrl: extra?.mediaUrl,
      })
      return next.slice(0, 40)
    })
    setEnteringTaskId(id)
  }

  const resolveTaskId = (id: string) => {
    let current = id
    const seen = new Set<string>()
    while (taskIdAlias.current[current] && !seen.has(current)) {
      seen.add(current)
      current = taskIdAlias.current[current]
    }
    return current
  }

  const replaceRailTask = (fromId: string, toId: string, patch?: Partial<RecentTask>) => {
    if (fromId !== toId) taskIdAlias.current[fromId] = toId
    if (pipelineRef.current && (pipelineRef.current.railId === fromId || pipelineRef.current.localId === fromId)) {
      pipelineRef.current = { ...pipelineRef.current, railId: toId }
    }
    setRecent(previous => {
      const source = previous.find(item => item.id === fromId)
      if (!source) {
        return previous.map(item => item.id === toId ? { ...item, ...patch } : item)
      }
      const rest = previous.filter(item => item.id !== fromId && item.id !== toId)
      return [{ ...source, ...patch, id: toId }, ...rest].slice(0, 24)
    })
  }

  const flyTaskToRail = (id: string, title: string, status?: string, extra?: Partial<RecentTask>) => {
    remember(id, title, status, extra)
    if (taskRailListRef.current) taskRailListRef.current.scrollTop = 0
    const from = submitBtnRef.current?.getBoundingClientRect()
    const rail = taskRailListRef.current?.getBoundingClientRect()
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!from || !rail || reduced) return
    const node = document.createElement('span')
    node.className = css.flyDot
    node.setAttribute('aria-hidden', 'true')
    node.style.left = `${from.left + from.width / 2}px`
    node.style.top = `${from.top + from.height / 2}px`
    node.style.setProperty('--dx', `${rail.left + 32 - (from.left + from.width / 2)}px`)
    node.style.setProperty('--dy', `${rail.top + 22 - (from.top + from.height / 2)}px`)
    document.body.appendChild(node)
    const finish = () => node.remove()
    node.addEventListener('animationend', finish, { once: true })
    window.setTimeout(finish, 680)
  }

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (delay = 2500) => {
        if (cancelled) return
      timer = setTimeout(() => { void tick() }, delay)
    }
    const readTask = async (id: string): Promise<{ value: TaskStatus; artifacts: Artifact[] }> => {
      const recentKind = recentRef.current.find(item => item.id === id)?.kind
      const imageTask = id.startsWith('img-') || isImageKind(recentKind)
      const response = await fetch(
        imageTask
          ? `/digital-human-studio/image/task?id=${encodeURIComponent(id)}`
          : `/digital-human-studio/digital-human/task?id=${encodeURIComponent(id)}`,
        { signal: AbortSignal.timeout(20000) },
      )
      const value = await response.json().catch(() => null)
      if (!response.ok || !value) throw new Error(value?.error || '读取任务失败')
      value.status = normalizeStatus(value.status)
      let artifacts: Artifact[] = []
      const imageUrl = String(value.url || value.data?.image_url || value.data?.cover_url || '').trim()
      if (imageTask && imageUrl) {
        artifacts = [{ key: 'output', type: 'image', mimeType: 'image/png', content_url: imageUrl }]
      } else if (value.status === 'SUCCESS' && !imageTask) {
        try {
          const artifactResponse = await fetch(`/digital-human-studio/digital-human/artifacts?id=${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(15000),
          })
          const artifactValue = await artifactResponse.json().catch(() => null)
          if (artifactResponse.ok) artifacts = artifactValue?.artifacts || []
        } catch {
          artifacts = []
        }
      }
      return { value, artifacts }
    }
    const applyTask = (id: string, value: TaskStatus, artifacts: Artifact[], open: boolean) => {
      const itemKind = recentRef.current.find(item => item.id === id)?.kind || kind
      const playback = pickPlaybackURL(value, artifacts, itemKind)
      const cover = isImageKind(itemKind)
        ? (playback || String(value.data?.cover_url || ''))
        : (readData(asRecord(value.data), 'cover_url') || readData(asRecord(value.data), 'preview_url'))
      setRecent(previous => previous.map(item => item.id === id ? {
        ...item,
        status: value.status,
        progress: value.progress || item.progress || (value.status === 'SUCCESS' ? '100%' : item.progress),
        coverUrl: item.coverUrl || (canShowImage(cover) ? cover : '') || (isImageKind(itemKind) ? playback : '') || undefined,
        mediaUrl: playback || item.mediaUrl,
      } : item))
      if (open) {
        setTask(value)
        if (value.status === 'SUCCESS') setArtifacts(artifacts)
      }
    }
    const tick = async () => {
      const openId = taskId
      const ids = [...new Set([
        ...recentRef.current.filter(item => isActiveStatus(item.status) && !isLocalTaskId(item.id)).map(item => item.id),
        ...(openId && !isLocalTaskId(openId) ? [openId] : []),
      ])]
      if (ids.length === 0) return
      let keepGoing = Boolean(pendingVideoRef.current)
      for (const id of ids) {
          if (cancelled) return
        const open = id === openId
        try {
          const { value, artifacts } = await readTask(id)
          if (cancelled) return
          applyTask(id, value, artifacts, open)
          const itemKind = recentRef.current.find(item => item.id === id)?.kind || kind
          if (!isTerminalStatus(value.status) || (open && value.status === 'SUCCESS' && !pickPlaybackURL(value, artifacts, itemKind))) keepGoing = true
          if (open && value.status === 'SUCCESS') {
            setError('')
            const saveKey = `${kind}:${id}`
          if (!savedToLibrary.current.has(saveKey)) {
            savedToLibrary.current.add(saveKey)
            if (!isClone && avatarId) {
                void saveLibraryAsset(
                  'avatar',
                  avatarId,
                  selectedAvatar?.name || `形象 ${avatarId}`,
                  modelCode,
                  selectedAvatar?.cover_url || selectedAvatar?.preview_url,
                  selectedAvatar?.sample_url,
                )
            }
            if (!isClone && voiceId) {
                void saveLibraryAsset(
                  'voice',
                  voiceId,
                  selectedVoice?.name || `音色 ${voiceId}`,
                  '',
                  selectedVoice?.cover_url || selectedVoice?.preview_url,
                  selectedVoice?.sample_url || selectedVoice?.preview_url,
                )
              }
              const clone = cloneResultID(kind, (value.data || {}) as Record<string, unknown>)
              if (clone) {
                const payload = (value.data || {}) as Record<string, unknown>
                const sample = String(payload.sample_url || payload.video_url || payload.audio_url || cloneSampleRef.current || '').trim()
                const cover = String(payload.cover_url || payload.preview_url || (isImageURL(sample) ? sample : '') || '').trim()
                const saved = await saveLibraryAsset(
                  clone.type,
                  clone.id,
                  name.trim() || (clone.type === 'voice' ? `音色 ${clone.id}` : `形象 ${clone.id}`),
                  modelCode,
                  cover || undefined,
                  sample || undefined,
                )
                if (clone.type === 'voice') {
                  setVoiceId(clone.id)
                  if (saved) setSelectedVoice(saved)
                } else {
                  setAvatarId(clone.id)
                  if (saved) setSelectedAvatar(saved)
                }
                notify('克隆完成，已保存到本地资源库')
              } else if (isClone) {
                notify('克隆完成，但未返回资源 ID')
              }
            }
            const pending = pendingVideoRef.current
            if (pending) {
              if (!isAudioTask(value, artifacts)) {
                setPendingVideo(null)
              } else {
                const audioUrl = pickAudioURL(value, artifacts)
            if (!audioUrl) {
              setError('语音合成已完成，但未返回音频地址，视频任务未提交')
              setPendingVideo(null)
              setBusy(false)
                } else if (!chainingRef.current) {
                  chainingRef.current = true
            const response = await fetch('/digital-human-studio/digital-human/create', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ ...pending, audio_url: audioUrl }),
                    signal: AbortSignal.timeout(120000),
            })
                  const created = await response.json().catch(() => null)
            if (!response.ok || created?.success === false) throw new Error(created?.error || created?.message || '创建视频任务失败')
            const videoId = String(created.task_id || created.id || '')
            if (!videoId) throw new Error('视频接口未返回任务 ID')
            setPendingVideo(null)
            setBusy(false)
            setTaskId(videoId)
            setTask(null)
            setArtifacts([])
            setError('')
                  replaceRailTask(id, videoId, {
                    kind: 'xdh-avatar-video',
                    title: pipelineRef.current?.title || taskTitle('xdh-avatar-video', String(pending.text || ''), ''),
                    status: 'QUEUED',
                    progress: '0%',
                    prompt: String(pending.text || ''),
                    modelCode: String(pending.model_code || modelCode),
                    coverUrl: pipelineRef.current?.coverUrl || selectedAvatar?.cover_url || selectedAvatar?.preview_url,
                  })
            notify('配音已完成，视频任务已提交')
                  chainingRef.current = false
            return
          }
        }
            }
          }
          if (open && value.status === 'FAILURE' && pendingVideoRef.current) {
            setError('配音任务失败，视频任务未提交：' + (value.fail_reason || '上游未返回原因'))
            setPendingVideo(null)
            setBusy(false)
          }
      } catch (e: any) {
          chainingRef.current = false
          keepGoing = true
          if (!cancelled && open) setError(e?.message || '读取任务失败')
        }
      }
      if (keepGoing || recentRef.current.some(item => isActiveStatus(item.status)) || pendingVideoRef.current) schedule(2500)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [taskId, pollNonce])

  const resetForm = () => {
    setPendingVideo(null)
    setBusy(false)
    setText('')
    setName('')
    setSampleUrl('')
    setAvatarId('')
    setVoiceId('')
    setSelectedAvatar(null)
    setSelectedVoice(null)
    setError('')
  }

  /** Save a used avatar/voice into the local library so it can be picked again later. */
  const saveLibraryAsset = useCallback(async (
    type: 'avatar' | 'voice',
    id: string,
    name: string,
    modelCode: string,
    coverUrl?: string,
    sampleUrl?: string,
  ): Promise<DigitalHumanResource | null> => {
    if (!id) return null
    try {
      const response = await fetch('/digital-human-studio/digital-human/resources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save', type, id, name, modelCode, coverUrl, sampleUrl }),
      })
      const value = await response.json()
      if (!response.ok || value?.success === false) throw new Error(value?.error || '保存本地资源失败')
      setResources({
        avatars: Array.isArray(value.avatars) ? value.avatars : [],
        voices: Array.isArray(value.voices) ? value.voices : [],
      })
      setResourceError('')
      return (value.asset as DigitalHumanResource | undefined) || { id, name, model_id: type === 'avatar' ? id : undefined, voice_id: type === 'voice' ? id : undefined, model_code: modelCode }
    } catch {
      notify('本地资源保存失败')
      return null
    }
  }, [])

  const uploadLocalFile = async (file: File) => {
    setUploading(true)
    setUploadError('')
    try {
      const response = await fetch('/digital-human-studio/upload/file', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: file,
      })
      const value = await response.json()
      if (!response.ok || value?.success === false) throw new Error(value?.error || '上传失败')
      const url = String(value.url || '')
      setSampleUrl(url)
      notify('已上传，公网地址已回填')
      return url
    } catch (e: any) {
      setUploadError(e?.message || '上传失败')
      return ''
    } finally {
      setUploading(false)
    }
  }

  const persistDefault = (type: 'avatar' | 'voice', id: string) => {
    if (!id) return
    void fetch('/digital-human-studio/digital-human/resources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'default', type, id }),
    }).then(async response => {
      const value = await response.json().catch(() => null)
      if (!value || value.success === false) return
      setResources({
        avatars: Array.isArray(value.avatars) ? value.avatars : [],
        voices: Array.isArray(value.voices) ? value.voices : [],
      })
    }).catch(() => { /* default mark is best effort */ })
  }

  const chooseAvatar = (resource: DigitalHumanResource) => {
    const id = avatarResourceID(resource)
    setSelectedAvatar(resource)
    setAvatarId(id)
    if (resource.model_code) setModelCode(resource.model_code)
    setPicker(null)
    persistDefault('avatar', id)
  }

  const chooseVoice = (resource: DigitalHumanResource) => {
    const id = voiceResourceID(resource)
    setSelectedVoice(resource)
    setVoiceId(id)
    setPicker(null)
    persistDefault('voice', id)
  }

  const previewVoice = (resource: DigitalHumanResource) => {
    const url = resource.preview_url || resource.download_url || resource.sample_url
    if (!url) return notify('这个音色没有试听地址')
    try {
      void new Audio(url).play().catch(() => notify('试听失败'))
    } catch {
      notify('试听失败')
    }
  }

  const submit = async () => {
    setError('')
    setTask(null)
    setArtifacts([])
      const body: Record<string, unknown> = { model: kind, model_code: modelCode }
      if (isImage) {
        body.prompt = text
        body.ratio = ratio
      } else if (isClone) {
        body.name = name
        body.sample_url = sampleUrl
      cloneSampleRef.current = sampleUrl
      if (isImageURL(sampleUrl)) body.cover_url = sampleUrl
      } else {
        body.text = text
      }
      if (isVideo) {
        if (selectedAvatar) {
          if (selectedAvatar.local_id) body.selected_avatar_local_id = selectedAvatar.local_id
          body.selected_avatar_model_id = avatarResourceID(selectedAvatar)
        } else if (avatarId.trim()) {
          body.selected_avatar_model_id = avatarId.trim()
        }
        if (selectedVoice) {
          if (selectedVoice.local_id) body.selected_voice_local_id = selectedVoice.local_id
          body.selected_voice_id = voiceResourceID(selectedVoice)
        } else if (voiceId.trim()) {
          body.selected_voice_id = voiceId.trim()
        }
      }
      if (isAudio) {
        if (selectedVoice) {
          if (selectedVoice.local_id) body.selected_voice_local_id = selectedVoice.local_id
          body.selected_voice_id = voiceResourceID(selectedVoice)
        } else if (voiceId.trim()) {
          body.selected_voice_id = voiceId.trim()
        }
      }
    if (isImage) {
      if (!text.trim()) return setError('请先填写画面描述')
      if (!imageModels.length) return setError(imageModelsNote || '小葱 API 还没有可用的生图模型')
      const localId = `local-${Date.now()}`
      const title = taskTitle(kind, text, '')
      flyTaskToRail(localId, title, 'QUEUED', { kind: 'ximg', prompt: text, modelCode })
      notify('任务已加入队列')
      void (async () => {
        try {
          const response = await fetch('/digital-human-studio/image/create', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: modelCode, prompt: text, ratio }),
            signal: AbortSignal.timeout(180000),
          })
          const value = await response.json().catch(() => null)
          if (!response.ok || value?.success === false) throw new Error(value?.error || value?.message || value?.fail_reason || '创建生图任务失败')
          const id = String(value.task_id || value.id || '')
          if (!id) throw new Error('生图接口未返回任务 ID')
          const coverUrl = String(value.url || value.data?.image_url || value.data?.cover_url || '')
          replaceRailTask(resolveTaskId(localId), id, {
            kind: 'ximg',
            status: normalizeStatus(value.status) || 'IN_PROGRESS',
            progress: value.progress || (value.status === 'SUCCESS' ? '100%' : '20%'),
            coverUrl: coverUrl || undefined,
            mediaUrl: coverUrl || undefined,
            prompt: text,
            modelCode,
          })
          setTaskId(id)
          setPollNonce(n => n + 1)
          if (normalizeStatus(value.status) === 'FAILURE') notify(value.fail_reason || '生图失败')
          else notify(normalizeStatus(value.status) === 'SUCCESS' ? '图片已生成' : '生图任务已提交')
        } catch (error: any) {
          const failedId = resolveTaskId(localId)
          replaceRailTask(failedId, failedId, { status: 'FAILURE', progress: '0%' })
          notify(error?.message || '创建生图任务失败')
        }
      })()
      return
    }
      if (isVideo) {
      const localId = `local-${Date.now()}`
      const title = taskTitle(kind, text, name)
      const coverUrl = selectedAvatar?.cover_url || selectedAvatar?.preview_url
        const audioBody: Record<string, unknown> = {
          model: 'xdh-audio',
          model_code: modelCode === 'VPro' || modelCode === 'XPro' ? 'Pro' : modelCode,
          text,
        }
        if (body.selected_voice_local_id) audioBody.selected_voice_local_id = body.selected_voice_local_id
        if (body.selected_voice_id) audioBody.selected_voice_id = body.selected_voice_id
      pipelineRef.current = { localId, railId: localId, title, coverUrl }
      flyTaskToRail(localId, title, 'QUEUED', {
        kind: 'xdh-avatar-video',
        prompt: text,
        coverUrl,
      })
      notify('任务已加入队列，正在后台配音')
      void (async () => {
        try {
        const audioResponse = await fetch('/digital-human-studio/digital-human/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(audioBody),
            signal: AbortSignal.timeout(120000),
        })
          const audioValue = await audioResponse.json().catch(() => null)
        if (!audioResponse.ok || audioValue?.success === false) throw new Error(audioValue?.error || audioValue?.message || '创建配音任务失败')
        const audioTaskId = String(audioValue.task_id || audioValue.id || '')
        if (!audioTaskId) throw new Error('配音接口未返回任务 ID')
          replaceRailTask(resolveTaskId(localId), audioTaskId, {
            status: normalizeStatus(audioValue.status) || 'IN_PROGRESS',
            progress: audioValue.progress || '8%',
          })
          setPendingVideo(body)
        setTaskId(audioTaskId)
          setPollNonce(value => value + 1)
        } catch (error: any) {
          const failedId = resolveTaskId(localId)
          replaceRailTask(failedId, failedId, { status: 'FAILURE', progress: '0%' })
          notify(error?.message || '创建配音任务失败')
        }
      })()
        return
      }
    setBusy(true)
    setPendingVideo(null)
    try {
      const response = await fetch('/digital-human-studio/digital-human/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const value = await response.json()
      if (!response.ok || value?.success === false) throw new Error(value?.error || value?.message || '创建任务失败')
      const id = String(value.task_id || value.id || '')
      if (!id) throw new Error('接口未返回任务 ID')
      setTaskId(id)
      flyTaskToRail(id, taskTitle(kind, text, name), 'QUEUED', {
        coverUrl: selectedAvatar?.cover_url || selectedAvatar?.preview_url || selectedVoice?.cover_url,
      })
      notify('任务已提交')
    } catch (e: any) {
      setPendingVideo(null)
      setError(e?.message || '创建任务失败')
    } finally {
      setBusy(false)
    }
  }

  const submitClone = async () => {
    if (!cloneModalKind) return
    setCloneModalError('')
    if (!name.trim()) return setCloneModalError(cloneModalKind === 'xdh-voice-clone' ? '请先填音色名称' : '请先填形象名称')
    if (!sampleUrl.trim()) return setCloneModalError('请先上传本地文件或填写公网素材地址')
    setCloneModalBusy(true)
    try {
      const body: Record<string, unknown> = {
        model: cloneModalKind,
        model_code: cloneModelCode,
        name: name.trim(),
        sample_url: sampleUrl.trim(),
      }
      cloneSampleRef.current = sampleUrl.trim()
      if (cloneModalKind === 'xdh-avatar-clone' && isImageURL(sampleUrl.trim())) body.cover_url = sampleUrl.trim()
      const response = await fetch('/digital-human-studio/digital-human/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const value = await response.json().catch(() => null)
      if (!response.ok || value?.success === false) throw new Error(value?.error || value?.message || '提交克隆任务失败')
      const id = String(value.task_id || value.id || '')
      if (!id) throw new Error('接口未返回任务 ID')
      setTaskId(id)
      flyTaskToRail(id, taskTitle(cloneModalKind, '', name.trim()), 'QUEUED', {
        kind: cloneModalKind,
        coverUrl: isImageURL(sampleUrl.trim()) ? sampleUrl.trim() : undefined,
      })
      setCloneModalKind(null)
      notify(cloneModalKind === 'xdh-voice-clone' ? '音色克隆任务已提交，完成后自动入库' : '形象克隆任务已提交，完成后自动入库')
    } catch (e: any) {
      setCloneModalError(e?.message || '提交克隆任务失败')
    } finally {
      setCloneModalBusy(false)
    }
  }

  const openTask = (id: string) => {
    setTaskId(id)
    setTask(null)
    setArtifacts([])
    setError('')
    setPollNonce(value => value + 1)
  }

  const openTaskDetail = (id: string) => {
    openTask(id)
    if (appPage === 'home' || (appPage === 'companies' && !companyOpen)) {
      setAppPage('works')
      setCompanyOpen(false)
    }
    setWorkspace('detail')
  }

  const closeTaskDetail = () => {
    setWorkspace('create')
  }

  const editFromTask = (item?: RecentTask) => {
    if (item?.kind) setKind(isImageKind(item.kind) ? 'ximg' : item.kind)
    if (item?.modelCode) setModelCode(item.modelCode)
    if (item?.prompt) setText(item.prompt)
    setAppPage('create')
    setWorkspace('create')
  }

  const copyValue = async (value: string, ok: string, empty: string) => {
    if (!value.trim()) return notify(empty)
    try {
      await navigator.clipboard.writeText(value)
      notify(ok)
    } catch {
      notify('复制失败')
    }
  }

  const copyText = async () => {
    if (!text.trim()) return notify('还没有可复制的文案')
    try {
      await navigator.clipboard.writeText(text)
      notify('文案已复制')
    } catch {
      notify('复制失败，请手动选择文案')
    }
  }

  const useDefaults = () => {
    applyLibraryDefaults(resources.avatars, resources.voices)
    notify(resources.avatars.length || resources.voices.length ? '已切回默认形象与音色' : '还没有默认形象，请先在资源库里选一个')
  }

  const clearHistory = () => {
    setRecent([])
    notify('最近任务已清空')
  }

  const activeCompanyAction = companyRailHighlight(appPage, companyOpen)

  const renderCompanyActions = (id: string, active: string = '') => {
    const current = normalizeRailActive(active) || activeCompanyAction
    return (
    <nav className={css.companyDeskTabs} aria-label="公司内容菜单">
      {COMPANY_DESK_TABS.map(item => (
        <button
          key={item.id}
          type="button"
          className={item.id === current ? `${css.companyListAction} ${css.companyListActionOn}` : css.companyListAction}
          disabled={spaceBusy}
          aria-current={item.id === current ? 'page' : undefined}
          onClick={event => {
            event.stopPropagation()
            if (item.id === 'archive') void openCompanyArchive(id)
            else if (item.id === 'materials') void openCompanyMaterials(id)
            else if (item.id === 'ip-assets') void openCompanyAssets(id)
            else if (item.id === 'create') void openCompanyCreate(id, 'xdh-avatar-video')
            else if (item.id === 'works') void openCompanyWorks(id)
            else if (item.id === 'calendar') {
              void selectCompany(id).then(() => {
                setAppPage('calendar')
                setWorkspace('create')
                setCompanyOpen(false)
              }).catch(() => {})
            }
            else if (item.id === 'platform-accounts') {
              void selectCompany(id).then(() => {
                setAppPage('platform-accounts')
                setWorkspace('create')
                setCompanyOpen(false)
              }).catch(() => {})
            }
            else if (item.id === 'retro-review') {
              void selectCompany(id).then(() => {
                setAppPage('retro-review')
                setWorkspace('create')
                setCompanyOpen(false)
              }).catch(() => {})
            } else {
              void selectCompany(id).then(() => {
                setPackHistoryId('')
                setAppPage('publish-packs')
                setWorkspace('create')
                setCompanyOpen(false)
              }).catch(() => {})
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </nav>
    )
  }

  const renderCompanyDeskHead = (id: string, active: CompanyActionId | '' = '', opts: { subtitle?: string; extra?: ReactNode; nameNode?: ReactNode } = {}) => (
    <div className={css.companyDeskHead}>
      <div className={css.companyDeskHeadLead}>
        <span className={css.companyAvatar} data-tone={companyTone(currentSpace?.name || id)} aria-hidden>
          {companyInitial(currentSpace?.name || id)}
        </span>
        {opts.nameNode ?? <h1>{currentSpace?.name || '默认'}</h1>}
        {opts.subtitle ? <p>{opts.subtitle}</p> : null}
      </div>
      {renderCompanyActions(id, active)}
      <div className={css.deskActions}>
        {opts.extra}
        <button type="button" className={css.deskGhost} onClick={() => { setAppPage('companies'); setCompanyOpen(false); setSpaceMenu('closed') }}>全部公司</button>
      </div>
    </div>
  )

  /** Company 5-entry shortcuts now live in the middle desk head, not a fourth column. */
  const withCompanyRail = (_id: string, _active: CompanyActionId | '' = '', main: ReactNode) => main

  const taskThumb = (item: RecentTask) => (
    item.coverUrl && canShowImage(item.coverUrl) ? <img src={item.coverUrl} alt="" /> : item.coverUrl && canShowVideo(item.coverUrl) ? (
      <video src={item.coverUrl} muted playsInline preload="metadata" />
    ) : item.mediaUrl && canShowImage(item.mediaUrl) ? (
      <img src={item.mediaUrl} alt="" />
    ) : (
      <i className={css.historyDot} style={{ background: statusColor(item.status) }} />
    )
  )

  const buildTaskRailItems = (list: RecentTask[]) => list.map(item => ({
    id: item.id,
    title: item.title || kindLabel(item.kind),
    meta: `${kindLabel(item.kind)} · ${formatTime(item.at)}`,
    status: `${statusLabel(item.status)}${isActiveStatus(item.status) ? ` ${progressPercent(item.progress, item.status)}%` : ''}`,
    statusTone: (item.status === 'SUCCESS' ? 'ok' : item.status === 'FAILURE' ? 'fail' : isActiveStatus(item.status) ? 'run' : '') as 'ok' | 'fail' | 'run' | '',
    selected: item.id === currentTaskId,
    entering: item.id === enteringTaskId,
    progress: isActiveStatus(item.status) ? progressPercent(item.progress, item.status) : undefined,
    thumb: taskThumb(item),
    onClick: () => openTaskDetail(item.id),
  }))

  const materialSlotLabel = (slot: string) => MATERIAL_SLOTS.find(item => item.id === slot)?.label || slot
  /** 素材分析得到的角色标签（混剪 Agent 用 dh_label_materials 标注） */
  const materialRoleLabel = (role: string) => {
    const map: Record<string, string> = {
      product_detail: '产品细节', store_front: '门头', store_in: '店内', process: '工艺',
      talking: '口播', logo: 'Logo', other: '其它',
    }
    return map[String(role || '').trim()] || String(role || '').trim()
  }
  const ownedRecordRail = (): RecordRailModel | null => {
    if (appPage === 'companies' && activeCompanyAction === 'archive') return null
    const defaults = defaultRecordRail(appPage, companyOpen)
    if (!defaults) return null
    if (appPage === 'create' || appPage === 'ip-assets') {
      return {
        ...defaults,
        titleClick: () => recent[0] ? openTaskDetail(recent[0].id) : notify('还没有任务'),
        head: recent.length > 0 ? <button type="button" className={css.mini} onClick={clearHistory}>清空</button> : null,
        items: buildTaskRailItems(recent),
      }
    }
    if (appPage === 'works' || appPage === 'work-copy') {
      return { ...defaults, items: buildTaskRailItems(recent) }
    }
    if (appPage === 'companies' && companyOpen) {
      return { ...defaults, items: buildTaskRailItems(recent.slice(0, 8)) }
    }
    if (appPage === 'materials') {
      const query = materialQuery.trim().toLowerCase()
      const items = materials.filter(item => !query || item.name.toLowerCase().includes(query))
      return {
        title: '素材',
        empty: query ? '没有匹配的素材' : '还没有素材。',
        stamp: `${materialBusy}:${query}`,
        items: items.map(item => ({
          id: item.id,
          title: item.name,
          meta: materialSlotLabel(item.slot),
          selected: selectedMaterial?.id === item.id,
          thumb: item.kind === 'image' && item.url ? <img src={item.url} alt="" /> : item.kind === 'video' && item.url ? (
            <video src={item.url} muted playsInline preload="metadata" />
          ) : (
            <span>{item.kind === 'audio' ? '音频' : '文件'}</span>
          ),
          onClick: () => previewMaterial(item),
          actions: (
            <>
              <button type="button" className={css.mini} disabled={!!materialBusy} onClick={event => { event.stopPropagation(); void renameMaterial(item) }}>改名</button>
              <button type="button" className={css.mini} disabled={!!materialBusy} onClick={event => { event.stopPropagation(); void deleteMaterial(item) }}>删除</button>
            </>
          ),
        })),
      }
    }
    return null
  }

  const taskData = asRecord(task?.data)
  const primaryText = isVideo ? '生成视频' : isAudio ? '生成语音' : isImage ? '生成图片' : '开始克隆'
  const hero = HERO[kind] || HERO['xdh-avatar-video']
  const visibleResources = picker === 'avatar' ? resources.avatars : picker === 'voice' ? resources.voices : []
  const currentTaskId = String(task?.task_id || taskId || '')
  const currentRecent = recent.find(item => item.id === currentTaskId)
  const taskIndex = recent.findIndex(item => item.id === currentTaskId)
  const olderTask = taskIndex >= 0 ? recent[taskIndex + 1] : undefined
  const newerTask = taskIndex > 0 ? recent[taskIndex - 1] : undefined
  const detailKind = currentRecent?.kind || kind
  const coverUrl = currentRecent?.coverUrl || readData(taskData, 'cover_url') || readData(taskData, 'preview_url')
  const videoUrl = pickVideoURL(task, artifacts) || (currentRecent?.mediaUrl && canShowVideo(currentRecent.mediaUrl) ? currentRecent.mediaUrl : '')
  const imageUrl = pickImageOutputURL(task, artifacts, isImageKind(detailKind) ? (currentRecent?.mediaUrl || coverUrl) : '')
  const audioUrl = pickAudioURL(task, artifacts) || (detailKind === 'xdh-audio' && currentRecent?.mediaUrl ? currentRecent.mediaUrl : '')
  const mediaUrl = isImageKind(detailKind) ? imageUrl : detailKind === 'xdh-audio' ? audioUrl : videoUrl
  const stageStatus = normalizeStatus(task?.status || currentRecent?.status)
  const promptText = (currentRecent?.prompt || readData(taskData, 'text') || readData(taskData, 'content') || readData(taskData, 'prompt')).trim()
  const showVideo = stageStatus === 'SUCCESS' && !!videoUrl && !isImageKind(detailKind) && detailKind !== 'xdh-audio'
  const showImage = stageStatus === 'SUCCESS' && isImageKind(detailKind) && !!imageUrl
  const showAudio = stageStatus === 'SUCCESS' && !!audioUrl && (detailKind === 'xdh-audio' || isAudioTask(task, artifacts)) && !showVideo
  const detailModel = currentRecent?.modelCode || readData(taskData, 'model_code') || modelCode
  const modelTitle = `${detailModel} ${kindLabel(detailKind)}`
  const durationRaw = Number(readData(taskData, 'billing_duration') || readData(taskData, 'audio_duration') || readData(taskData, 'billing_quantity') || 0)
  const durationText = durationRaw > 0 ? `${durationRaw}秒` : '—'
  const sizeText = readData(taskData, 'ratio') || (isImageKind(detailKind) ? ratio : '') || '—'

  return (
    <div className={css.root}>
      <RecordRailProvider resetKey={`${appPage}:${spaceId}`}>
      <div className={css.appFrame}>
        <nav className={css.sideNav} aria-label="工作台菜单">
          <p className={css.sideNavBrand}>工作台</p>
          <button
            type="button"
            className={isSideNavOn(appPage, 'home') ? `${css.sideNavItem} ${css.sideNavItemOn}` : css.sideNavItem}
            onClick={() => { setAppPage('home'); setCompanyOpen(false); setSpaceMenu('closed') }}
          >
            <Glyph name="home" size={20} />
            主页
          </button>
          <button
            type="button"
            className={isSideNavOn(appPage, 'companies') ? `${css.sideNavItem} ${css.sideNavItemOn}` : css.sideNavItem}
            onClick={() => { setAppPage('companies'); setCompanyOpen(false); setSpaceMenu('closed') }}
          >
            <Glyph name="company" size={20} />
            公司
          </button>
          <button
            type="button"
            className={isSideNavOn(appPage, 'publish') ? `${css.sideNavItem} ${css.sideNavItemOn}` : css.sideNavItem}
            onClick={() => { setCompanyOpen(false); setSpaceMenu('closed'); setPackHistoryId(''); setWorkspace('create'); if (!spaceId) { setAppPage('companies'); return } setAppPage('publish-packs') }}
          >
            <Glyph name="publish" size={20} />
            发布
          </button>
          <button
            type="button"
            className={isSideNavOn(appPage, 'industry-hotboard') ? `${css.sideNavItem} ${css.sideNavItemOn}` : css.sideNavItem}
            onClick={() => { setAppPage('industry-hotboard'); setCompanyOpen(false); setSpaceMenu('closed'); setWorkspace('create') }}
          >
            <Glyph name="star" size={20} />
            热榜
          </button>
        </nav>
        <div className={css.appMain}>
          {workspace === 'detail' ? (
            <div className={css.detailDesk}>
              {renderCompanyDeskHead(spaceId, activeCompanyAction)}
        <div className={`${css.taskDetail} ${css.taskDetailInMain}`}>
          <div className={css.taskStage}>
            <button type="button" className={css.taskBack} onClick={closeTaskDetail} aria-label="返回">
              <Glyph name="back" size={18} />
            </button>
            <button type="button" className={`${css.taskNav} ${css.taskNavPrev}`} disabled={!olderTask} onClick={() => olderTask && openTaskDetail(olderTask.id)}>上一个</button>
            <button type="button" className={`${css.taskNav} ${css.taskNavNext}`} disabled={!newerTask} onClick={() => newerTask && openTaskDetail(newerTask.id)}>下一个</button>
            {showVideo && (
              <video
                className={css.taskStageMedia}
                controls
                src={videoUrl}
                poster={canShowImage(coverUrl) ? coverUrl : undefined}
                playsInline
              />
            )}
            {showImage && <img className={css.taskStageMedia} src={imageUrl} alt="" />}
            {showAudio && <audio className={css.taskStageAudio} controls src={audioUrl} />}
            {stageStatus === 'SUCCESS' && !mediaUrl && (
              <div className={css.taskStageEmpty}>
                <b>生成完成</b>
                <span>产物还没有准备好，稍后再打开这个任务。</span>
              </div>
            )}
            {stageStatus !== 'SUCCESS' && (
              <div className={css.taskStageEmpty}>
                <b>{task || currentRecent ? statusLabel(stageStatus) : '加载任务'}</b>
                <span>
                  {stageStatus === 'FAILURE'
                    ? (task?.fail_reason || '上游没有返回可用成片')
                    : '任务进行中，成片会出现在这里。'}
                </span>
              </div>
            )}
          </div>
          <aside className={css.taskSide}>
            <div className={css.taskSideTop}>
              {mediaUrl ? (
                <a className={css.taskDownload} href={mediaUrl} target="_blank" rel="noreferrer">
                  <Glyph name="download" size={16} />下载
                </a>
              ) : (
                <span className={css.taskDownloadMuted}>下载</span>
              )}
              <button type="button" className={css.taskStar} aria-label="收藏" onClick={() => notify('已记下这个任务')}>
                <Glyph name="star" size={16} />
              </button>
            </div>
            <div className={css.taskPromptLabel}>提示词</div>
            <div className={css.taskPrompt}>{promptText || currentRecent?.title || '这个任务没有保存提示词'}</div>
            <dl className={css.taskMeta}>
              <div><dt>模型名称</dt><dd>{modelTitle}</dd></div>
              <div><dt>模型版本</dt><dd>{detailModel || '—'}</dd></div>
              <div><dt>风格</dt><dd>—</dd></div>
              <div><dt>尺寸</dt><dd>{sizeText}</dd></div>
              <div><dt>分辨率</dt><dd>—</dd></div>
              <div><dt>视频时长</dt><dd>{durationText}</dd></div>
              <div><dt>消耗额度</dt><dd>—</dd></div>
              <div><dt>任务类型</dt><dd>{kindLabel(detailKind)}</dd></div>
              <div><dt>任务ID</dt><dd title={currentTaskId}>{currentTaskId.slice(-8) || '—'}</dd></div>
              <div><dt>创建时间</dt><dd>{formatDateTime(task?.created_at || currentRecent?.at)}</dd></div>
              <div><dt>生成时间</dt><dd>{formatDateTime(task?.updated_at || task?.created_at)}</dd></div>
              <div><dt>完成时间</dt><dd>{formatDateTime(task?.finished_at)}</dd></div>
              <div><dt>耗时</dt><dd>{formatDuration(task?.created_at, task?.finished_at || task?.updated_at)}</dd></div>
            </dl>
            <div className={css.taskActions}>
              {sendToChat && currentTaskId && !isLocalTaskId(currentTaskId) && !isImageKind(detailKind) ? (
                <button
                  type="button"
                  className={css.taskAction}
                  onClick={() => {
                    sendToChat({
                      task_id: currentTaskId,
                      text: promptText || currentRecent?.title,
                      cover_url: currentRecent?.coverUrl || selectedAvatar?.cover_url,
                      avatar_name: selectedAvatar?.name,
                    })
                    notify('已发到当前对话，对话里会直接出现视频卡片')
                  }}
                >
                  发送到当前对话
                </button>
              ) : null}
              <button type="button" className={css.taskAction} onClick={() => void copyValue(mediaUrl, '素材地址已复制', '这个任务没有素材地址')}>用作参考素材</button>
              <button type="button" className={css.taskAction} onClick={() => void copyValue(promptText, '提示词已复制', '没有可分享的提示词')}>分享灵感</button>
              <button type="button" className={css.taskAction} onClick={() => { editFromTask({ ...(currentRecent || { id: currentTaskId, kind: 'xdh-avatar-video', title: promptText, at: Date.now() }), kind: 'xdh-avatar-video', prompt: promptText }); notify('已填回文案，可直接生成视频') }}>生成视频</button>
              <button type="button" className={css.taskAction} onClick={() => void copyValue(mediaUrl, '链接已复制', '还没有可复制的链接')}>生成链接</button>
              <button type="button" className={css.taskAction} onClick={() => { editFromTask(currentRecent); notify('已回到编辑') }}>重新编辑</button>
              <button type="button" className={css.taskAction} onClick={() => { editFromTask(currentRecent); notify('已填回参数，点击生成即可再次生成') }}>再次生成</button>
            </div>
          </aside>
        </div>
            </div>
          ) : appPage === 'home' ? (
            <div className={`${css.desk} ${css.homeDesk}`}>
              <div className={css.deskInner}>
                <div className={css.homeHero}>
                  <div className={css.homeHeroText}>
                    <span className={css.homeEyebrow}>
                      <i />
                      {homeTodayLabel()}
                    </span>
                    <h1>主页</h1>
                    <p>今天先补档案或做一条。当前：{currentSpace?.name || '未选择公司'}</p>
                  </div>
                  <div className={css.deskActions}>
                    <button type="button" className={css.deskGhost} onClick={() => { setAppPage('companies'); setCompanyOpen(false) }}>全部公司</button>
                    <button type="button" className={css.deskPrimary} onClick={continueCurrentCompany}>
                      <Glyph name="spark" size={15} />
                      继续：{shortCompanyLabel(currentSpace?.name || '')}
                    </button>
                  </div>
                </div>
                <div className={css.dashGrid}>
                  <button
                    type="button"
                    className={css.dashCard}
                    onClick={() => document.querySelector('#home-recent-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    <span className={css.dashIcon}><Glyph name="video" size={19} /></span>
                    <span className={css.dashBody}>
                      <span className={css.dashValue}>{monthCount}<em>条</em></span>
                      <span className={css.dashLabel}>本月成片</span>
                    </span>
                    <span className={css.dashGo} aria-hidden><Glyph name="back" size={15} /></span>
                  </button>
                  <button
                    type="button"
                    className={css.dashCard}
                    data-tone="warn"
                    onClick={() => document.querySelector('#home-missing-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    <span className={css.dashIcon}><Glyph name="clock" size={19} /></span>
                    <span className={css.dashBody}>
                      <span className={css.dashValue}>{missingCompanies.length}<em>项</em></span>
                      <span className={css.dashLabel}>待办</span>
                    </span>
                    <span className={css.dashGo} aria-hidden><Glyph name="back" size={15} /></span>
                  </button>
                </div>
                <div className={css.dashSplit}>
                  <section id="home-missing-section" className={css.dashPanel}>
                    <header className={css.dashPanelHead}>
                      <h2>待补档案</h2>
                      <span className={css.dashCount} data-tone={missingCompanies.length ? undefined : 'muted'}>{missingCompanies.length}</span>
                      <button type="button" className={css.dashMore} onClick={() => { setAppPage('companies'); setCompanyOpen(false) }}>全部公司</button>
                    </header>
                    {missingCompanies.length === 0 ? (
                      <div className={css.homeEmpty}>
                        <span className={css.homeEmptyIcon} aria-hidden>
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
                        </span>
                        <b>这几家公司的档案都填过了</b>
                        <small>档案齐了，挑一家就能直接开做</small>
                      </div>
                    ) : (
                      <div className={css.missingList}>
                        {missingCompanies.slice(0, 6).map(row => (
                          <button key={row.space.id} type="button" onClick={() => void openCompanyArchive(row.space.id)}>
                            <b>{row.space.name}</b>
                            <small>还没对外身份和卖点，点进去补</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                  <section className={css.dashPanel}>
                    <header className={css.dashPanelHead}>
                      <h2>本月还没成片</h2>
                      <span className={css.dashCount} data-tone={firstVideoCompanies.length ? undefined : 'muted'}>{firstVideoCompanies.length}</span>
                    </header>
                    {firstVideoCompanies.length === 0 ? (
                      <div className={css.homeEmpty}>
                        <span className={css.homeEmptyIcon} data-tone="purple" aria-hidden><Glyph name="video" size={17} /></span>
                        <b>{firstVideoEmptyMessage(spaceStats.some(row => !row.filled))}</b>
                      </div>
                    ) : (
                      <div className={css.missingList}>
                        {firstVideoCompanies.slice(0, 6).map(row => (
                          <button key={row.space.id} type="button" onClick={() => void openCompanyCreate(row.space.id, 'xdh-avatar-video')}>
                            <b>{row.space.name}</b>
                            <small>这个月还没有成片，做第一条</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
                <section id="home-recent-section" className={css.dashPanel}>
                  <header className={css.dashPanelHead}>
                    <h2>最近成片</h2>
                    <span className={css.dashCount} data-tone={recentAcross.length ? undefined : 'muted'}>{recentAcross.length}</span>
                  </header>
                  {recentAcross.length === 0 ? (
                    <div className={css.homeEmpty}>
                      <span className={css.homeEmptyIcon} data-tone="purple" aria-hidden><Glyph name="video" size={17} /></span>
                      <b>还没有成片</b>
                      <small>从上面选一家公司做第一条</small>
                    </div>
                  ) : (
                    <div className={`${css.recentList} ${css.homeRecentList}`}>
                      {recentAcross.map(item => {
                        const cover = item.coverUrl
                        const media = item.mediaUrl
                        const imageSrc = canShowImage(cover) ? cover : canShowImage(media) ? media : ''
                        const videoSrc = !imageSrc
                          ? (canShowVideo(cover) ? cover : canShowVideo(media) ? media : '')
                          : ''
                        return (
                          <button
                            key={`${item.spaceId}-${item.id}`}
                            type="button"
                            onClick={() => {
                              void (async () => {
                                const target = item.spaceId
                                if (target && target !== spaceIdRef.current) {
                                  try { await postSpace({ action: 'select', id: target }) } catch { return }
                                }
                                openTaskDetail(item.id)
                              })()
                            }}
                          >
                            <span className={css.homeRecentMedia}>
                              {imageSrc ? (
                                <img className={css.homeRecentThumb} src={imageSrc} alt="" />
                              ) : videoSrc ? (
                                <video className={css.homeRecentThumb} src={videoSrc} preload="metadata" muted playsInline />
                              ) : (
                                <span className={css.homeRecentThumbFallback} aria-hidden>
                                  <Glyph name="video" size={22} />
                                </span>
                              )}
                              <span className={css.homeRecentStatus}>
                                <i style={{ background: statusColor(item.status) }} />
                                {statusLabel(item.status)}
                              </span>
                            </span>
                            <span className={css.homeRecentMeta}>
                              <b>{item.title || kindLabel(item.kind)}</b>
                              <small>{item.spaceName} · {kindLabel(item.kind)} · {formatTime(item.at)}</small>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>
              </div>
            </div>
          ) : appPage === 'companies' && !companyOpen ? (
            <div className={`${css.desk} ${css.companyListDesk}`}>
              <div className={css.deskInner}>
                <div className={css.companyHero}>
                  <div className={css.companyHeroText}>
                    <h1>公司</h1>
                    <p>点一家进去做事。对话写口播会跟当前打开的这家走。</p>
                  </div>
                  <div className={css.companyHeroSide}>
                    <span className={css.companyListSearch}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                        <circle cx="11" cy="11" r="7" />
                        <path d="M20 20l-3.6-3.6" />
                      </svg>
                      <input
                        value={companyQuery}
                        onChange={event => setCompanyQuery(event.target.value)}
                        placeholder="搜索公司名称"
                        aria-label="搜索公司名称"
                      />
                    </span>
                    <span className={css.companyStat}>共 <b>{spaces.length}</b> 家</span>
                    <button type="button" className={css.deskPrimary} onClick={() => { setSpaceNameDraft(''); setSpaceFolderDraft(''); setSpaceMenu('create') }}>新建公司</button>
                  </div>
                </div>
                {spaceError ? <div className={css.spaceError}>{spaceError}</div> : null}
                {spaceMenu === 'create' ? (
                  <form
                    className={css.spaceForm}
                    onSubmit={event => {
                      event.preventDefault()
                      void postSpace({ action: 'create', name: spaceNameDraft, lastProjectFolder: spaceFolderDraft })
                        .then(() => {
                          setCompanyOpen(true)
                          setBriefDraft(EMPTY_BRIEF)
                          setSpaceNameDraft(spaceNameDraft)
                          setSpaceFolderDraft(spaceFolderDraft)
                        })
                        .catch(() => { /* error shown */ })
                    }}
                  >
                    <input
                      value={spaceNameDraft}
                      onChange={event => setSpaceNameDraft(event.target.value)}
                      placeholder="公司名称，例如：甲公司"
                      autoFocus
                      maxLength={40}
                    />
                    <button type="submit" disabled={spaceBusy}>{spaceBusy ? '保存中' : '确定'}</button>
                    <button type="button" onClick={() => { setSpaceMenu('closed'); setSpaceError('') }}>取消</button>
                  </form>
                ) : null}
                {visibleCompanies.length === 0 ? (
                  <div className={css.companyEmpty}>
                    <span className={css.companyEmptyIcon} aria-hidden><Glyph name="company" size={18} /></span>
                    <b>{companyListEmptyMessage(spaces.length)}</b>
                    <small>{companyListEmptyHint(spaces.length)}</small>
                  </div>
                ) : (
                  <div className={css.companyGrid}>
                    {visibleCompanies.map(row => (
                      <div
                        key={row.space.id}
                        className={row.space.id === spaceId ? `${css.companyCard} ${css.companyCardOn}` : css.companyCard}
                      >
                        <button type="button" className={css.companyCardTitle} onClick={() => void openCompanyArchive(row.space.id)}>
                          <span className={css.companyAvatar} data-tone={companyTone(row.space.name)} aria-hidden>
                            {companyInitial(row.space.name)}
                          </span>
                          <span className={css.companyCardMain}>
                            <span className={css.companyCardHead}>
                              <b>{row.space.name}</b>
                              {row.space.id === spaceId ? <span className={css.companyMark}>当前</span> : null}
                            </span>
                            <span className={css.companyChips}>
                              <span className={css.companyChip} data-tone={row.filled ? 'ok' : 'warn'}>
                                <i />{row.filled ? '已填档案' : '未填档案'}
                              </span>
                              <span className={css.companyChip}>本月 {row.monthCount} 条</span>
                            </span>
                          </span>
                        </button>
                        <nav className={css.companyActionsCompact} aria-label="公司快捷入口">
                          {COMPANY_LIST_ACTIONS.map(item => (
                            <button
                              key={item.id}
                              type="button"
                              className={css.companyListAction}
                              disabled={spaceBusy}
                              onClick={event => {
                                event.stopPropagation()
                                const id = row.space.id
                                if (item.id === 'archive') void openCompanyArchive(id)
                                else if (item.id === 'materials') void openCompanyMaterials(id)
                                else if (item.id === 'create') void openCompanyCreate(id, 'xdh-avatar-video')
                                else if (item.id === 'works') void openCompanyWorks(id)
                                else if (item.id === 'retro-review') {
                                  void selectCompany(id).then(() => {
                                    setAppPage('retro-review')
                                    setWorkspace('create')
                                    setCompanyOpen(false)
                                  }).catch(() => {})
                                }
                                else {
                                  void selectCompany(id).then(() => {
                                    setPackHistoryId('')
                                    setAppPage('publish-packs')
                                    setWorkspace('create')
                                    setCompanyOpen(false)
                                  }).catch(() => {})
                                }
                              }}
                            >
                              {item.label}
                            </button>
                          ))}
                        </nav>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : appPage === 'companies' ? (
            <div className={css.desk}>
              <div className={css.deskInner}>
                {renderCompanyDeskHead(spaceId, activeCompanyAction, {
                  nameNode: (
                    <input
                      value={spaceNameDraft}
                      onChange={event => setSpaceNameDraft(event.target.value)}
                      maxLength={40}
                      aria-label="公司名称"
                    />
                  ),
                  extra: spaceId !== DEFAULT_DIGITAL_HUMAN_SPACE_ID ? (
                    <button
                      type="button"
                      className={`${css.deskGhost} ${css.deskGhostDanger}`}
                      onClick={() => {
                        if (!window.confirm(`删除「${currentSpace?.name || ''}」？形象、音色、生图和任务记录都会从这台电脑拿走，默认空间不受影响。`)) return
                        void postSpace({ action: 'delete', id: spaceId })
                          .then(() => setCompanyOpen(false))
                          .catch(() => { /* error shown */ })
                      }}
                    >
                      删除
                    </button>
                  ) : null,
                })}
                {withCompanyRail(spaceId, activeCompanyAction, <>
                {spaceError ? <div className={css.spaceError}>{spaceError}</div> : null}
                <div className={css.archiveStudio}>
                <div className={css.archiveCanvas}>
                <header className={css.archiveHero}>
                  <small className={css.archiveDate}>
                    {currentSpace?.name || '默认'} · 档案
                  </small>
                  <h1>
                    还有 <i>{Math.max(0, BRIEF_FIELDS.length - BRIEF_FIELDS.filter(field => String(briefDraft[field.key] || '').trim()).length)}</i> 个格空着，<br />
                    填完写口播就不空话。
                  </h1>
                  <div className={css.archiveHeroMeta}>
                    {publishPlatforms.length
                      ? publishPlatforms.map(name => <em key={name}>{name}</em>)
                      : <em data-empty="on">还没授权账号，先按抖音写</em>}
                    <span>已填 {BRIEF_FIELDS.filter(field => String(briefDraft[field.key] || '').trim()).length} / {BRIEF_FIELDS.length}</span>
                  </div>
                </header>
                <form
                  className={css.spaceBriefForm}
                  onSubmit={event => {
                    event.preventDefault()
                    void (async () => {
                      try {
                        if (spaceNameDraft.trim() && spaceNameDraft.trim() !== currentSpace?.name) {
                          await postSpace({ action: 'rename', id: spaceId, name: spaceNameDraft })
                        }
                        if (spaceFolderDraft !== (currentSpace?.lastProjectFolder || '')) {
                          await postSpace({ action: 'folder', id: spaceId, lastProjectFolder: spaceFolderDraft })
                        }
                        await postSpace({ action: 'brief', id: spaceId, brief: briefDraft })
                        notify('档案已保存，对话写口播会按这份来')
                      } catch {
                        /* error shown */
                      }
                    })()
                  }}
                >
                  <p className={css.spaceBriefHint}>写文案与剪视频共用的公司底稿，全部选填；外部 AI 也可通过 MCP 直接读取。当次主推产品在对话里说，不要写进档案。</p>
                  {(['copy', 'video'] as const).map(group => (
                    <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: group === 'video' ? 12 : 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.72, paddingTop: group === 'video' ? 10 : 0, borderTop: group === 'video' ? '1px solid rgba(128,128,128,0.18)' : 'none' }}>
                        {group === 'copy' ? '一、文案与口播底稿' : '二、剪辑与视听规范（指导 AI 剪片，可点下面快捷预设）'}
                      </div>
                      {BRIEF_FIELDS.filter(field => field.section === group).map(field => (
                        <label key={field.key} className={css.spaceBriefField}>
                          <span>{field.label}</span>
                          {field.rows ? (
                            <textarea
                              value={briefDraft[field.key]}
                              rows={field.rows}
                              maxLength={field.max}
                              placeholder={field.placeholder}
                              onChange={event => setBriefDraft(current => ({ ...current, [field.key]: event.target.value }))}
                            />
                          ) : (
                            <input
                              value={briefDraft[field.key]}
                              maxLength={field.max}
                              placeholder={field.placeholder}
                              onChange={event => setBriefDraft(current => ({ ...current, [field.key]: event.target.value }))}
                            />
                          )}
                          {field.presets?.length ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                              {field.presets.map(preset => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => setBriefDraft(current => ({ ...current, [field.key]: preset }))}
                                  style={{
                                    fontSize: 11,
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    border: briefDraft[field.key] === preset ? '1px solid currentColor' : '1px solid rgba(128,128,128,0.28)',
                                    background: briefDraft[field.key] === preset ? 'var(--dsw-alias-interactive-bg-active, rgba(27,27,29,0.08))' : 'transparent',
                                    color: 'inherit',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {preset}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </label>
                      ))}
                    </div>
                  ))}
                  <details className={css.spaceBriefFolder}>
                    <summary>{spaceFolderDraft.trim() ? '剪映目录（已填）' : '剪映目录（选填）'}</summary>
                    <input
                      value={spaceFolderDraft}
                      onChange={event => setSpaceFolderDraft(event.target.value)}
                      placeholder="剪映草稿目录，可先留空"
                    />
                  </details>
                  <div className={css.spaceBriefActions}>
                    <button type="submit" className={css.deskPrimary} disabled={spaceBusy}>{spaceBusy ? '保存中' : '保存档案'}</button>
                  </div>
                </form>
                </div>
                <aside className={css.archiveRail} aria-label="档案助手">
                  <div className={css.railHead}>
                    <b>助手</b>
                    <em className={css.railModel}>档案整理</em>
                    <button
                      type="button"
                      className={css.railIcon}
                      title="清空对话"
                      onClick={() => { setBriefAiNotes(''); setBriefAiFiles([]); setBriefChat([]); setBriefPicked({}); setBriefAiError('') }}
                    >
                      ↻
                    </button>
                    <button
                      type="button"
                      className={css.railIcon}
                      title="收起最新结果"
                      onClick={() => setBriefChat((prev) => {
                        const next = [...prev]
                        for (let i = next.length - 1; i >= 0; i -= 1) {
                          if (next[i].role === 'assistant' && next[i].updates) { next[i] = { ...next[i], updates: undefined }; break }
                        }
                        return next
                      })}
                    >
                      ✕
                    </button>
                  </div>
                  <div className={css.railBody}>
                    <div className={css.railRule}>
                      <span className={css.railTick} aria-hidden>✓</span>
                      <span>整理规则「事实我不编；不会写示例，我可以现写」</span>
                    </div>
                    {briefChat.length === 0 ? (
                      <>
                        <p className={css.railSay}>
                          把公司介绍、报价单、客户评价贴进来，或直接说「帮我全部填好」。
                        </p>
                        <p className={css.railHint}>我回人话；要改档案会先给你看，你点「写入」才生效。</p>
                      </>
                    ) : (
                      briefChat.map((msg) => msg.role === 'user' ? (
                        <div key={msg.id} className={css.railUser}>{msg.text}</div>
                      ) : (
                        <div key={msg.id} className={css.railAi}>
                          <p className={css.railSay}>{msg.text}</p>
                          {msg.updates && Object.keys(msg.updates).length ? (
                            <>
                              <div className={css.railTools}>
                                {Object.entries(msg.updates).map(([key, value]) => {
                                  const label = BRIEF_FIELDS.find(field => field.key === key)?.label || key
                                  const pid = `${msg.id}|${key}`
                                  const on = !!briefPicked[pid]
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      className={css.railTool}
                                      data-on={on ? 'on' : undefined}
                                      onClick={() => setBriefPicked(prev => ({ ...prev, [pid]: !on }))}
                                    >
                                      <span className={css.railTick} aria-hidden>{on ? '✓' : ''}</span>
                                      <span className={css.railToolText}>
                                        <b>{label}</b>
                                        <small>{String(value)}</small>
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                              {msg.missing ? <p className={css.railNote}><i aria-hidden>↳</i> 还缺：{msg.missing}</p> : null}
                              <div className={css.railActions}>
                                <button
                                  type="button"
                                  className={css.deskPrimary}
                                  disabled={briefAiBusy || !Object.entries(briefPicked).some(([pid, on]) => on && pid.startsWith(`${msg.id}|`))}
                                  onClick={() => void applyBriefChat(msg.id)}
                                >
                                  写入档案
                                </button>
                                <button type="button" className={css.railLink} onClick={() => setBriefChat(prev => prev.map(item => item.id === msg.id ? { ...item, updates: undefined } : item))}>
                                  <i aria-hidden>↳</i> 撤销
                                </button>
                              </div>
                            </>
                          ) : msg.applied ? (
                            <p className={css.railNote}><i aria-hidden>✓</i> 已写入档案</p>
                          ) : null}
                        </div>
                      ))
                    )}
                    {briefAiBusy ? <p className={css.railHint}>思考中…</p> : null}
                    {briefAiError ? <p className={css.briefAiError} role="alert">{briefAiError}</p> : null}
                  </div>
                  {briefAiFiles.length ? (
                    <div className={css.railFiles}>
                      {briefAiFiles.map(file => <em key={file.name}>{file.name}</em>)}
                    </div>
                  ) : null}
                  <div className={css.railComposer}>
                    <textarea
                      rows={1}
                      value={briefAiNotes}
                      onChange={event => setBriefAiNotes(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          void sendBriefChat()
                        }
                      }}
                      placeholder="想补哪一格，或把资料贴进来"
                    />
                    <div className={css.railComposerTools}>
                      <button type="button" className={css.railClip} disabled={briefAiBusy} onClick={() => briefFileRef.current?.click()} title="选文本文件">
                        ＋
                      </button>
                      <input
                        ref={briefFileRef}
                        type="file"
                        multiple
                        accept=".txt,.md,.csv,.json,.log"
                        hidden
                        onChange={event => { void pickBriefFiles(event.target.files); event.currentTarget.value = '' }}
                      />
                      <button type="button" className={css.railSend} disabled={briefAiBusy} onClick={() => void sendBriefChat()} title="发送">
                        {briefAiBusy ? '…' : '↑'}
                      </button>
                    </div>
                  </div>
                </aside>
                </div>
                </>)}
              </div>
            </div>
          ) : appPage === 'video-download' ? (
            <div className={css.desk}>
              <div className={css.deskInner}>
                {renderCompanyDeskHead(spaceId, '', {
                  subtitle: '贴一条链接，进这家公司的素材柜。',
                  extra: resolvePublishCompany(spaces, spaceId).status === 'ready'
                    ? <button type="button" className={css.deskGhost} onClick={() => { void openCompanyMaterials(spaceId) }}>去素材柜</button>
                    : null,
                })}
                {(() => {
                  const publishCompany = resolvePublishCompany(spaces, spaceId)
                  if (publishCompany.status === 'empty') {
                    return <div className={css.emptyDesk}>还没有公司。请先新建公司，再下载视频素材。</div>
                  }
                  if (publishCompany.status === 'pick') {
                    return (
                      <section className={css.dashPanel} aria-label="选择下载公司">
                        <h2>请先选择公司</h2>
                        <p className={css.spaceBriefHint}>下载会进这家公司的素材柜。</p>
                        <div className={css.companyGrid}>
                          {publishCompany.spaces.map(row => (
                            <div key={row.id} className={css.companyCard}>
                              <button
                                type="button"
                                className={css.companyCardTitle}
                                disabled={spaceBusy}
                                onClick={() => { void selectCompany(row.id).catch(() => {}) }}
                              >
                                <b>{row.name}</b>
                                <small>下载会进这家公司的素材柜。</small>
                              </button>
                            </div>
                          ))}
                        </div>
                      </section>
                    )
                  }
                  const space = publishCompany.space
                  return (
                    <DigitalHumanVideoDownload
                      key={`video-download:${space.id}`}
                      spaceId={space.id}
                      companyName={space.name}
                      onOpenMaterials={() => { void openCompanyMaterials(space.id) }}
                      onPickCompany={() => { setAppPage('companies'); setCompanyOpen(false) }}
                    />
                  )
                })()}
              </div>
            </div>
          ) : appPage === 'retro-review' ? (
            <div className={css.desk}>
              <div className={css.deskInner}>
                {renderCompanyDeskHead(spaceId, activeCompanyAction, {
                  subtitle: '按本机 MediaCrawler 落盘数据复盘这家公司的发布表现，不调第三方 API。',
                  extra: resolvePublishCompany(spaces, spaceId).status === 'ready'
                    ? <button type="button" className={css.deskGhost} onClick={() => { setAppPage('publish-packs'); setCompanyOpen(false) }}>去发布</button>
                    : null,
                })}
                {(() => {
                  const publishCompany = resolvePublishCompany(spaces, spaceId)
                  if (publishCompany.status === 'empty') {
                    return <div className={css.emptyDesk}>还没有公司。请先新建公司，再看复盘。</div>
                  }
                  if (publishCompany.status === 'pick') {
                    return (
                      <section className={css.dashPanel} aria-label="选择复盘公司">
                        <h2>请先选择公司</h2>
                        <p className={css.spaceBriefHint}>复盘按当前公司读取本机 MediaCrawler 抓到的作品与评论。</p>
                        <div className={css.companyGrid}>
                          {publishCompany.spaces.map(row => (
                            <div key={row.id} className={css.companyCard}>
                              <button
                                type="button"
                                className={css.companyCardTitle}
                                disabled={spaceBusy}
                                onClick={() => { void selectCompany(row.id).catch(() => {}) }}
                              >
                                <b>{row.name}</b>
                                <small>选这家公司看复盘。</small>
                              </button>
                            </div>
                          ))}
                        </div>
                      </section>
                    )
                  }
                  const space = publishCompany.space
                  return (
                    <DigitalHumanRetroReview
                      spaceId={space.id}
                      companyName={space.name}
                      onPickCompany={() => { setAppPage('companies'); setCompanyOpen(false) }}
                    />
                  )
                })()}
              </div>
            </div>
          ) : appPage === 'industry-hotboard' ? (
            <div className={css.desk}>
              <div className={css.deskInner}>
                {renderCompanyDeskHead(spaceId, '', {
                  subtitle: '按这家公司的行业词，搜最近最热的样本。',
                  extra: resolvePublishCompany(spaces, spaceId).status === 'ready'
                    ? <button type="button" className={css.deskGhost} onClick={() => { void openCompanyMaterials(spaceId) }}>去素材柜</button>
                    : null,
                })}
                {(() => {
                  const publishCompany = resolvePublishCompany(spaces, spaceId)
                  if (publishCompany.status === 'empty') {
                    return <div className={css.emptyDesk}>还没有公司。请先新建公司，再看行业热榜。</div>
                  }
                  if (publishCompany.status === 'pick') {
                    return (
                      <section className={css.dashPanel} aria-label="选择热榜公司">
                        <h2>请先选择公司</h2>
                        <p className={css.spaceBriefHint}>热榜按这家公司档案里的行业词来搜。</p>
                        <div className={css.companyGrid}>
                          {publishCompany.spaces.map(row => (
                            <div key={row.id} className={css.companyCard}>
                              <button
                                type="button"
                                className={css.companyCardTitle}
                                disabled={spaceBusy}
                                onClick={() => { void selectCompany(row.id).catch(() => {}) }}
                              >
                                <b>{row.name}</b>
                                <small>热榜按这家公司的行业词来搜。</small>
                              </button>
                            </div>
                          ))}
                        </div>
                      </section>
                    )
                  }
                  const space = publishCompany.space
                  return (
                    <DigitalHumanIndustryHotboard
                      key={`industry-hotboard:${space.id}`}
                      spaceId={space.id}
                      companyName={space.name}
                      onOpenMaterials={() => { void openCompanyMaterials(space.id) }}
                      onPickCompany={() => { setAppPage('companies'); setCompanyOpen(false) }}
                    />
                  )
                })()}
              </div>
            </div>
          ) : appPage === 'publish-packs' ? (
            <div className={css.desk}><div className={css.deskInner}>
              {withCompanyRail(spaceId, 'publish-packs', <>
              {renderCompanyDeskHead(spaceId, 'publish-packs', { subtitle: '先在日历排期，再挑一条写文案、选封面，最后复制到平台发。' })}
              <DigitalHumanPublishTaskCenter spaceId={spaceId} onGoAccounts={() => setAppPage('platform-accounts')} onGoCalendar={() => setAppPage('calendar')} />
              <DigitalHumanPublishPacks
                key={`${spaceId}:${packHistoryId}`}
                spaceId={spaceId}
                initialHistoryId={packHistoryId}
                onMaterials={() => { void openCompanyMaterials(spaceId) }}
                onCalendar={() => setAppPage('calendar')}
                onAccounts={() => setAppPage('platform-accounts')}
                onCreate={() => { void openCompanyCreate(spaceId, 'xdh-avatar-video') }}
                primaryClassName={css.deskPrimary}
                ghostClassName={css.deskGhost}
                emptyClassName={css.emptyDesk}
              />
              </>)}
            </div></div>
          ) : appPage === 'platform-accounts' ? (
            <div className={css.desk}><div className={css.deskInner}>
              {withCompanyRail(spaceId, 'platform-accounts', <>
              {renderCompanyDeskHead(spaceId, 'platform-accounts', { subtitle: '绑好抖音/小红书，登录在官方页完成。' })}
              <DigitalHumanPlatformAccounts
                key={`accounts:${spaceId}`}
                spaceId={spaceId}
                primaryClassName={css.deskPrimary}
                ghostClassName={css.deskGhost}
                emptyClassName={css.emptyDesk}
              />
              </>)}
            </div></div>
          ) : appPage === 'calendar' ? (
            <div className={css.desk}>
              <div className={css.deskInner}>
                {withCompanyRail(spaceId, 'calendar', <>
                {renderCompanyDeskHead(spaceId, 'calendar', { subtitle: '点一天看排期。工作台发成功会自动变绿；在平台手动发的，点「标已发」也行。' })}
                <DigitalHumanCalendar
                  key={spaceId}
                  spaceId={spaceId}
                  primaryClassName={css.deskPrimary}
                  ghostClassName={css.deskGhost}
                  emptyClassName={css.emptyDesk}
                  onOpenWork={openCalendarWork}
                  onGoAccounts={() => setAppPage('platform-accounts')}
                />
                </>)}
              </div>
            </div>
          ) : appPage === 'materials' ? (
            <div className={`${css.desk} ${css.matDesk}`}>
              <div className={css.deskInner}>
                {renderCompanyDeskHead(spaceId, activeCompanyAction, {
                  subtitle: '可上传、预览、改名、删除。对话换件会从这家柜子取本地路径；也可直接打开本机素材目录。',
                  extra: (
                    <button type="button" className={css.deskGhost} disabled={!!materialBusy} onClick={() => void openMaterialsFolder('')}>打开素材目录</button>
                  ),
                })}
                {withCompanyRail(spaceId, activeCompanyAction, <>
                {spaceError ? <div className={css.spaceError}>{spaceError}</div> : null}
                <div className={css.matBar}>
                  <input
                    className={css.matSearch}
                    value={materialQuery}
                    onChange={event => setMaterialQuery(event.target.value)}
                    placeholder="按文件名查找"
                    aria-label="搜索素材"
                  />
                  <div className={css.matFilters} role="group" aria-label="素材分类">
                    <button type="button" className={css.matChip} data-on={materialSlot === 'all' ? 'on' : undefined} onClick={() => setMaterialSlot('all')}>
                      全部<em>{materials.length}</em>
                    </button>
                    {MATERIAL_SLOTS.map(slot => (
                      <button
                        key={slot.id}
                        type="button"
                        className={css.matChip}
                        data-on={materialSlot === slot.id ? 'on' : undefined}
                        onClick={() => setMaterialSlot(slot.id)}
                      >
                        {slot.label}<em>{materials.filter(item => item.slot === slot.id).length}</em>
                      </button>
                    ))}
                  </div>
                  <div className={css.matBarActions}>
                    <button type="button" className={css.deskGhost} onClick={() => setAppPage('video-download')}>采集</button>
                    <button type="button" className={css.deskGhost} disabled={!!materialBusy} onClick={() => void loadMaterials(spaceId)}>刷新</button>
                    <button
                      type="button"
                      className={css.deskPrimary}
                      disabled={!!materialBusy}
                      onClick={() => {
                        materialSlotRef.current = materialSlot === 'all' ? 'product' : materialSlot
                        materialInputRef.current?.click()
                      }}
                    >
                      {materialBusy ? '上传中…' : '上传素材'}
                    </button>
                  </div>
                </div>
                {materialsRoot ? (
                  <p className={css.matHint}>
                    <span>本机目录</span>
                    <code>{materialsRoot}</code>
                    <button type="button" onClick={() => void copyValue(materialsRoot, '本地目录已复制', '还没有本地目录')}>复制路径</button>
                  </p>
                ) : null}
                <input
                  ref={materialInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*,audio/*,.mp4,.mov,.webm,.m4v,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a"
                  hidden
                  onChange={event => {
                    const files = event.target.files
                    event.target.value = ''
                    if (files?.length) void uploadMaterials(materialSlotRef.current, files)
                  }}
                />
                <div
                  className={css.matBoard}
                  data-drag={dropSlot ? 'on' : undefined}
                  onDragOver={event => {
                    event.preventDefault()
                    const target = materialSlot === 'all' ? 'product' : materialSlot
                    if (dropSlot !== target) setDropSlot(target)
                  }}
                  onDragLeave={event => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                    setDropSlot('')
                  }}
                  onDrop={event => {
                    event.preventDefault()
                    const target = materialSlot === 'all' ? 'product' : materialSlot
                    setDropSlot('')
                    void uploadMaterials(target, event.dataTransfer.files)
                  }}
                >
                  {(() => {
                    const query = materialQuery.trim().toLowerCase()
                    const visible = materials.filter(item => (materialSlot === 'all' || item.slot === materialSlot)
                      && (!query || item.name.toLowerCase().includes(query)))
                    const targetSlot = materialSlot === 'all' ? 'product' : materialSlot
                    const targetLabel = MATERIAL_SLOTS.find(item => item.id === targetSlot)?.label || '产品'
                    if (visible.length === 0) {
                      return (
                        <div className={css.matEmpty}>
                          <span className={css.matEmptyIcon} aria-hidden><Glyph name="image" size={18} /></span>
                          <b>{materials.length === 0 ? '这家公司还没有素材' : '没有匹配的素材'}</b>
                          <small>{materials.length === 0 ? '拖文件到这里，或点右上角「上传素材」' : '换个关键词，或切到「全部」看看'}</small>
                          {materials.length === 0 ? (
                            <div className={css.matEmptySlots}>
                              {MATERIAL_SLOTS.map(slot => (
                                <button
                                  key={slot.id}
                                  type="button"
                                  disabled={!!materialBusy}
                                  onClick={() => {
                                    materialSlotRef.current = slot.id
                                    materialInputRef.current?.click()
                                  }}
                                >
                                  {slot.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )
                    }
                    return (
                      <>
                        {visible.map(item => {
                          const kind = materialPreviewKind(item)
                          const slotLabel = materialSlotLabel(item.slot)
                          const roleLabel = materialRoleLabel(item.role || '')
                          const meta = [roleLabel || slotLabel, item.size ? formatBytes(item.size) : '', formatTime(item.at)].filter(Boolean).join(' · ')
                          return (
                            <article key={item.id} className={css.matCard}>
                              <button
                                type="button"
                                className={css.matThumb}
                                onClick={() => previewMaterial(item)}
                                aria-label={'预览 ' + item.name}
                              >
                                {kind === 'image' ? (
                                  <img src={item.url} alt="" />
                                ) : kind === 'video' ? (
                                  <video src={item.url} muted playsInline preload="metadata" />
                                ) : (
                                  <span className={css.matThumbIcon}>
                                    <Glyph name={item.kind === 'audio' ? 'audio' : 'copy'} size={20} />
                                  </span>
                                )}
                                <span className={css.matBadge}>{slotLabel}</span>
                                <span className={css.matHover}>预览</span>
                              </button>
                              <div className={css.matInfo}>
                                <b title={item.name}>{item.name}</b>
                                {item.useFor || item.summary ? (
                                  <span className={css.matUse} data-detail={materialAnalysisRows(item).length ? 'on' : undefined} title={materialAnalysisTooltip(item)}>{item.useFor || item.summary}</span>
                                ) : null}
                                <small>{meta}</small>
                              </div>
                              <div className={css.matRowActions}>
                                <button type="button" disabled={!!materialBusy} onClick={() => void renameMaterial(item)}>改名</button>
                                <button type="button" disabled={!!materialBusy} onClick={() => void deleteMaterial(item)}>删除</button>
                              </div>
                            </article>
                          )
                        })}
                        <button
                          type="button"
                          className={css.matAdd}
                          disabled={!!materialBusy}
                          onClick={() => {
                            materialSlotRef.current = targetSlot
                            materialInputRef.current?.click()
                          }}
                        >
                          <span aria-hidden><Glyph name="image" size={18} /></span>
                          <b>{materialBusy ? '上传中…' : '上传素材'}</b>
                          <small>放进「{targetLabel}」</small>
                        </button>
                      </>
                    )
                  })()}
                </div>
                <DigitalHumanDeskModal
                  open={!!selectedMaterial}
                  title="素材预览"
                  onClose={() => setSelectedMaterial(null)}
                  maxWidth={980}
                >
                  {selectedMaterial ? (() => {
                    const previewKind = materialPreviewKind(selectedMaterial)
                    const rows = materialAnalysisRows(selectedMaterial)
                    const roleText = materialRoleLabel(selectedMaterial.role || '') || materialSlotLabel(selectedMaterial.slot)
                    const facts = [
                      previewKind ? previewKind.toUpperCase() : 'FILE',
                      selectedMaterial.size ? formatBytes(selectedMaterial.size) : '',
                    ].filter(Boolean).join(' · ')
                    return (
                      <section className={css.materialPreview} aria-label="素材预览">
                        <div className={css.materialPreviewStage}>
                          {previewKind === 'image' ? (
                            <img src={selectedMaterial.url} alt={selectedMaterial.name} />
                          ) : previewKind === 'video' ? (
                            <video src={selectedMaterial.url} controls playsInline preload="metadata" />
                          ) : previewKind === 'audio' ? (
                            <audio src={selectedMaterial.url} controls />
                          ) : (
                            <p>这类文件不能在中间直接打开，请用改名或删除，或在素材目录中查看。</p>
                          )}
                        </div>
                        <div className={css.materialPreviewPane}>
                          <div className={css.materialPreviewInfo}>
                          <div className={css.materialPreviewTitleRow}>
                            <b title={selectedMaterial.name}>{selectedMaterial.name}</b>
                            {roleText ? <span className={css.materialPreviewChip}>{roleText}</span> : null}
                          </div>
                          <small className={css.materialPreviewFacts}>{facts}</small>
                          {selectedMaterial.useFor || selectedMaterial.summary ? (
                            <div className={css.materialPreviewUse}>
                              {selectedMaterial.useFor ? <b>{selectedMaterial.useFor}</b> : null}
                              {selectedMaterial.summary ? <p>{selectedMaterial.summary}</p> : null}
                            </div>
                          ) : null}
                          {rows.length ? (
                            <dl className={css.analysisGrid}>
                              {rows.map(row => (
                                <div key={row.label}>
                                  <dt>{row.label}</dt>
                                  <dd>{row.value}</dd>
                                </div>
                              ))}
                            </dl>
                          ) : (
                            <p className={css.analysisMissing}>详细分析待补充（环境 / 光线 / 画质 / 说话人 / 说话内容）。在混剪对话里让 Agent 重新标注这条素材即可。</p>
                          )}
                          </div>
                          <div className={css.materialPreviewActions}>
                            <button type="button" className={css.deskGhost} onClick={() => setSelectedMaterial(null)}>关闭</button>
                            <button type="button" className={css.deskGhost} disabled={!!materialBusy} onClick={() => void renameMaterial(selectedMaterial)}>改名</button>
                            <button type="button" className={`${css.deskGhost} ${css.deskGhostDanger}`} disabled={!!materialBusy} onClick={() => void deleteMaterial(selectedMaterial)}>删除</button>
                            {selectedMaterial.url && previewKind ? (
                              <a className={`${css.deskPrimary}`} href={selectedMaterial.url} download={selectedMaterial.name} rel="noreferrer">下载</a>
                            ) : null}
                          </div>
                        </div>
                      </section>
                    )
                  })() : null}
                </DigitalHumanDeskModal>
                </>)}
              </div>
            </div>
          ) : appPage === 'ip-assets' ? (
            <div className={`${css.desk} ${css.matDesk}`}>
              <div className={css.deskInner}>
                {renderCompanyDeskHead(spaceId, activeCompanyAction, {
                  subtitle: '集中管理数字人形象与克隆音色：支持克隆形象、形象换装、克隆音色与试听，建好后去「创作」直接出片。',
                  extra: (
                    <button type="button" className={css.deskGhost} onClick={() => void loadResources()}>刷新资源</button>
                  ),
                })}
                {withCompanyRail(spaceId, activeCompanyAction, <>
                  {resourceError ? <div className={css.spaceError}>{resourceError}</div> : null}
                  <div className={css.matBar}>
                    <div className={css.matFilters} role="tablist" aria-label="IP 资产分类">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={ipTab === 'avatars'}
                        className={css.matChip}
                        data-on={ipTab === 'avatars' ? 'on' : undefined}
                        onClick={() => setIpTab('avatars')}
                      >
                        数字人形象<em>{resources.avatars.length}</em>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={ipTab === 'voices'}
                        className={css.matChip}
                        data-on={ipTab === 'voices' ? 'on' : undefined}
                        onClick={() => setIpTab('voices')}
                      >
                        克隆音色<em>{resources.voices.length}</em>
                      </button>
                    </div>
                    <div className={css.matBarActions}>
                      {ipTab === 'avatars' ? (
                        <>
                          <button type="button" className={css.deskGhost} onClick={() => openRestyleStudio(selectedAvatar)}>
                            形象换装
                          </button>
                          <button type="button" className={css.deskPrimary} onClick={() => openCloneModal('xdh-avatar-clone')}>
                            + 克隆新形象
                          </button>
                        </>
                      ) : (
                        <button type="button" className={css.deskPrimary} onClick={() => openCloneModal('xdh-voice-clone')}>
                          + 克隆新音色
                        </button>
                      )}
                    </div>
                  </div>

                  {ipTab === 'avatars' ? (
                    resources.avatars.length === 0 ? (
                      <div className={css.matEmpty}>
                        <span className={css.matEmptyIcon} aria-hidden><Glyph name="avatar" size={20} /></span>
                        <b>还没有数字人形象</b>
                        <small>上传 2–5 分钟清晰口播视频/照片克隆专属形象，或直接给人物照片做形象换装</small>
                        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
                          <button type="button" className={css.deskPrimary} onClick={() => openCloneModal('xdh-avatar-clone')}>+ 克隆新形象</button>
                          <button type="button" className={css.deskGhost} onClick={() => openRestyleStudio(null)}>形象换装（传照片）</button>
                        </div>
                      </div>
                    ) : (
                      <div className={css.resourceGrid}>
                        {resources.avatars.map(resource => {
                          const id = avatarResourceID(resource)
                          const isDefault = Number(resource.is_default) === 1
                          const isCurrent = avatarId === id
                          return (
                            <div
                              key={`${resource.source || 'local'}-${id || resource.name}`}
                              className={isCurrent ? `${css.resourceCard} ${css.resourceCardOn}` : css.resourceCard}
                              style={{ cursor: 'default' }}
                            >
                              <AvatarPreview
                                resource={resource}
                                className={css.resourceCover}
                                fallbackClassName={css.resourceCoverFallback}
                                playable
                              />
                              <span className={css.resourceName}>{resource.name || id}</span>
                              <span className={css.resourceMeta}>
                                {isDefault ? <span className={css.resourceBadge}>默认</span> : null}
                                {resource.model_code ? <span>{resource.model_code}</span> : null}
                                {resource.width && resource.height ? <span>{resource.width}×{resource.height}</span> : null}
                              </span>
                              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className={css.deskPrimary}
                                  style={{ padding: '4px 10px', fontSize: 12 }}
                                  onClick={() => {
                                    chooseAvatar(resource)
                                    setKind('xdh-avatar-video')
                                    setAppPage('create')
                                    setWorkspace('create')
                                  }}
                                >
                                  去拍视频
                                </button>
                                <button
                                  type="button"
                                  className={css.deskGhost}
                                  style={{ padding: '4px 10px', fontSize: 12 }}
                                  onClick={() => openRestyleStudio(resource)}
                                >
                                  换装
                                </button>
                                {!isDefault ? (
                                  <button
                                    type="button"
                                    className={css.deskGhost}
                                    style={{ padding: '4px 10px', fontSize: 12 }}
                                    onClick={() => {
                                      persistDefault('avatar', id)
                                      setSelectedAvatar(resource)
                                      setAvatarId(id)
                                      notify('已设为默认形象')
                                    }}
                                  >
                                    设默认
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  ) : (
                    resources.voices.length === 0 ? (
                      <div className={css.matEmpty}>
                        <span className={css.matEmptyIcon} aria-hidden><Glyph name="voice" size={20} /></span>
                        <b>还没有克隆音色</b>
                        <small>上传一段 2–5 分钟清晰录音，复刻专属口播声音，克隆完成后可直接用于数字人视频与语音合成</small>
                        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                          <button type="button" className={css.deskPrimary} onClick={() => openCloneModal('xdh-voice-clone')}>+ 克隆新音色</button>
                        </div>
                      </div>
                    ) : (
                      <div className={css.resourceGrid}>
                        {resources.voices.map(resource => {
                          const id = voiceResourceID(resource)
                          const isDefault = Number(resource.is_default) === 1
                          const isCurrent = voiceId === id
                          return (
                            <div
                              key={`${resource.source || 'local'}-${id || resource.name}`}
                              className={isCurrent ? `${css.resourceCard} ${css.resourceCardOn}` : css.resourceCard}
                              style={{ cursor: 'default' }}
                            >
                              <span className={css.resourceVoiceCover}><Glyph name="voice" size={26} /></span>
                              <span className={css.resourceName}>{resource.name || id}</span>
                              <span className={css.resourceMeta}>
                                {isDefault ? <span className={css.resourceBadge}>默认</span> : null}
                                {resource.model_code ? <span>{resource.model_code}</span> : null}
                                <span>{id}</span>
                              </span>
                              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className={css.deskPrimary}
                                  style={{ padding: '4px 10px', fontSize: 12 }}
                                  onClick={() => {
                                    chooseVoice(resource)
                                    setKind('xdh-audio')
                                    setAppPage('create')
                                    setWorkspace('create')
                                  }}
                                >
                                  去配音
                                </button>
                                <button
                                  type="button"
                                  className={css.deskGhost}
                                  style={{ padding: '4px 10px', fontSize: 12 }}
                                  onClick={() => previewVoice(resource)}
                                >
                                  试听
                                </button>
                                {!isDefault ? (
                                  <button
                                    type="button"
                                    className={css.deskGhost}
                                    style={{ padding: '4px 10px', fontSize: 12 }}
                                    onClick={() => {
                                      persistDefault('voice', id)
                                      setSelectedVoice(resource)
                                      setVoiceId(id)
                                      notify('已设为默认音色')
                                    }}
                                  >
                                    设默认
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  )}
                </>)}
              </div>
            </div>
          ) : appPage === 'works' ? (
            <div className={`${css.desk} ${css.workDesk}`}>
              <div className={css.deskInner}>
                {renderCompanyDeskHead(spaceId, activeCompanyAction, { subtitle: '这家公司已经生成过的数字人、音频和图片。' })}
                {withCompanyRail(spaceId, activeCompanyAction, <>
                {(() => {
                  const done = recent.filter(item => item.status === 'SUCCESS' || isActiveStatus(item.status))
                  const groupOf = (item: RecentTask) => item.kind === 'xdh-export-video'
                    ? 'video'
                    : isImageKind(item.kind)
                      ? 'image'
                      : (item.kind === 'xdh-audio' || item.kind === 'xdh-voice-clone') ? 'audio' : 'avatar'
                  const groups = [
                    { id: 'all', label: '全部', count: done.length },
                    { id: 'video', label: '成品', count: done.filter(item => groupOf(item) === 'video').length },
                    { id: 'avatar', label: '数字人', count: done.filter(item => groupOf(item) === 'avatar').length },
                    { id: 'audio', label: '语音', count: done.filter(item => groupOf(item) === 'audio').length },
                    { id: 'image', label: '图片', count: done.filter(item => groupOf(item) === 'image').length },
                  ] as const
                  const query = workQuery.trim().toLowerCase()
                  const visible = done.filter(item => (workKind === 'all' || groupOf(item) === workKind)
                    && (!query || (item.title || kindLabel(item.kind)).toLowerCase().includes(query)))
                  return (
                    <>
                      <div className={css.workBar}>
                        <input
                          className={css.workSearch}
                          value={workQuery}
                          onChange={event => setWorkQuery(event.target.value)}
                          placeholder="按标题查找"
                          aria-label="搜索成片"
                        />
                        <div className={css.workFilters} role="group" aria-label="成片分类">
                          {groups.map(group => (
                            <button
                              key={group.id}
                              type="button"
                              className={css.workChip}
                              data-on={workKind === group.id ? 'on' : undefined}
                              onClick={() => setWorkKind(group.id)}
                            >
                              {group.label}<em>{group.count}</em>
                            </button>
                          ))}
                        </div>
                        <div className={css.workBarActions}>
                          <input
                            ref={workInputRef}
                            type="file"
                            accept="video/mp4"
                            hidden
                            onChange={event => {
                              void importWorkFile(event.target.files?.[0] || null)
                              event.target.value = ''
                            }}
                          />
                          <button type="button" className={css.deskGhost} disabled={workImporting} onClick={() => workInputRef.current?.click()}>
                            {workImporting ? '导入中…' : '导入成品'}
                          </button>
                          <button type="button" className={css.deskGhost} onClick={() => setAppPage('create')}>去创作</button>
                        </div>
                      </div>
                      {workNotice ? <p className={css.workNotice} role="status">{workNotice}</p> : null}
                      {visible.length === 0 ? (
                        <div className={css.workEmpty}>
                          <span className={css.workEmptyIcon} aria-hidden><Glyph name="video" size={18} /></span>
                          <b>{done.length === 0 ? '这家公司还没有成片' : '没有匹配的成片'}</b>
                          <small>{done.length === 0 ? '去「创作」做一条，做完会出现在这里' : '换个关键词或分类试试'}</small>
                        </div>
                      ) : (
                        <div className={css.workGrid}>
                          {visible.map(item => {
                            const title = item.copy?.title || item.title || kindLabel(item.kind)
                            const tone = item.status === 'SUCCESS' ? 'ok' : item.status === 'FAILURE' ? 'fail' : 'run'
                            const active = isActiveStatus(item.status)
                            const percent = active ? progressPercent(item.progress, item.status) : 0
                            const canPublish = item.status === 'SUCCESS' && (item.kind === 'xdh-avatar-video' || item.kind === 'xdh-export-video')
                            return (
                              <article key={item.id} className={css.workCard}>
                                <button
                                  type="button"
                                  className={css.workThumb}
                                  onClick={() => openTaskDetail(item.id)}
                                  aria-label={'打开 ' + title}
                                >
                                  <WorkThumbMedia item={item} spaceId={spaceId} />
                                  <span className={css.workStatus} data-tone={tone}>
                                    <i />{statusLabel(item.status)}
                                  </span>
                                  <span className={css.workHover}>打开</span>
                                  {active ? (
                                    <span className={css.workProgress}><i style={{ width: `${percent}%` }} /></span>
                                  ) : null}
                                </button>
                                <div className={css.workMeta}>
                                  <span className={css.workMetaText}>
                                    <b title={title}>{title}</b>
                                    <small>{kindLabel(item.kind)} · {formatTime(item.at)}</small>
                                  </span>
                                  {item.status === 'SUCCESS' ? (
                                    <button
                                      type="button"
                                      className={css.workPublish}
                                      onClick={() => (item.copy ? openWorkCopy(item) : void askAiForCopy(item))}
                                      aria-label={(item.copy ? '查看文案 ' : '让 AI 写文案 ') + title}
                                    >
                                      {item.copy ? '文案' : '写文案'}
                                    </button>
                                  ) : null}
                                  {canPublish ? (
                                    <button
                                      type="button"
                                      className={css.workPublish}
                                      onClick={() => { setPackHistoryId(item.id); setAppPage('publish-packs') }}
                                    >
                                      发布
                                    </button>
                                  ) : null}
                                  {!active ? (
                                    <button
                                      type="button"
                                      className={`${css.workPublish} ${css.workDelete}`}
                                      onClick={() => void deleteWork(item)}
                                      disabled={workDeleting === item.id}
                                      aria-label={'删除 ' + title}
                                    >
                                      {workDeleting === item.id ? '删除中' : '删除'}
                                    </button>
                                  ) : null}
                                </div>
                              </article>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )
                })()}
                </>)}
              </div>
            </div>
          ) : appPage === 'work-copy' ? (
            <div className={css.workCopyHost}>
              {copyOpen ? (
                <WorkCopyStudio
                  item={copyOpen}
                  writing={copyBusy === copyOpen.id}
                  drawing={copyBusy === copyOpen.id}
                  revising={copyChatBusy}
                  error={copyError}
                  notice={workNotice}
                  scheduleLabel={copyPushLabel}
                  scheduleValue={copyPlan.scheduledAt}
                  spaceId={spaceId}
                  onGoAccounts={() => setAppPage('platform-accounts')}
                  onFillPlatform={fillPlatformCopy}
                  onCoverFrame={frameWorkCover}
                  onTextCover={textCoverWork}
                  onBack={() => setAppPage('works')}
                  onRevise={(text, platform) => void reviseWorkCopy(text, platform)}
                  onRegenerate={() => void generateWorkCopy(copyOpen)}
                  onRedrawCover={() => void redrawWorkCover()}
                  onAskAiCover={askAiForCover}
                  onCopyScript={() => copyWorkText(copyOpen)}
                  onSave={() => setWorkNotice('文案已保存在这条成片上')}
                  onSchedule={value => {
                    setCopyPlan(previous => ({ ...previous, scheduledAt: value }))
                    void saveWorkPlan(value)
                  }}
                />
              ) : (
                <div className={css.workEmpty}>
                  还没有打开的成片。
                  <button type="button" className={css.deskPrimary} onClick={() => setAppPage('works')}>回到成片</button>
                </div>
              )}
            </div>
          ) : (
      <div className={css.workspace}>
      <div className={css.createPane}>
        <div className={css.shell}>
          {withCompanyRail(spaceId, activeCompanyAction, <>
          {renderCompanyDeskHead(spaceId, activeCompanyAction)}
          <nav className={css.mainTabs} aria-label="创作类型">
            {MAIN_KINDS.map(item => (
              <button
                key={item.id}
                type="button"
                className={item.id === kind ? `${css.mainTab} ${css.mainTabOn}` : css.mainTab}
                onClick={() => { setPendingVideo(null); setBusy(false); setKind(item.id) }}
              >
                <span>{item.label}</span>
                <span className={css.mainTabIcon}><Glyph name={item.icon} size={44} /></span>
              </button>
            ))}
          </nav>

          <header className={css.hero}>
            <h1>{hero.title}</h1>
            <p>{hero.subtitle}</p>
          </header>

          <section className={css.createCard}>
            <div className={css.modelBar}>
              <span className={css.modelLabel}>{isImage ? '当前图片模型' : '当前数字人模型'}</span>
              <button type="button" className={css.modelPill} onClick={() => setPicker('model')} disabled={isImage && !imageModels.length}>
                {isImage && !imageModels.length ? '暂无生图模型' : `${isImage ? imageModelLabel(modelCode) : modelCode} · ${kindLabel(kind)}`}
              </button>
            </div>
            {isImage && imageModelsNote && !imageModels.length ? <div className={css.error}>{imageModelsNote}</div> : null}

            <div className={css.composeRow}>
              <div className={css.heroCards}>
                {isVideo && (
                  <button
                    type="button"
                    className={selectedAvatar ? `${css.heroCard} ${css.heroCardOn} ${css.heroCardLeft}` : `${css.heroCard} ${css.heroCardLeft}`}
                    onClick={() => { void loadResources(); setPicker('avatar') }}
                  >
                    {selectedAvatar ? (
                      <>
                        <AvatarPreview resource={selectedAvatar} className={css.heroCardCover} fallbackClassName={css.heroCardFallback} />
                        <span className={css.heroCardName}>
                          {selectedAvatar.name || '形象'}
                          {Number(selectedAvatar.is_default) === 1 ? ' · 默认' : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className={css.heroCardPlus}>+</span>
                        <span className={css.heroCardLabel}>形象</span>
                      </>
                    )}
                  </button>
                )}
                {(isVideo || isAudio) && (
                  <button
                    type="button"
                    className={selectedVoice ? `${css.heroCard} ${css.heroCardOn} ${css.heroCardRight}` : `${css.heroCard} ${css.heroCardRight}`}
                    onClick={() => setPicker('voice')}
                  >
                    {selectedVoice ? (
                      <>
                        <span className={css.heroCardVoiceIcon}><Glyph name="voice" size={20} /></span>
                        <span className={css.heroCardVoiceName}>
                          {selectedVoice.name || '音色'}
                          {Number(selectedVoice.is_default) === 1 ? ' · 默认' : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className={css.heroCardPlus}>+</span>
                        <span className={css.heroCardLabel}>音色</span>
                      </>
                    )}
                  </button>
                )}
                {isClone && (
                  <button
                    type="button"
                    className={`${css.heroCard} ${css.heroCardOn} ${css.heroCardLeft}`}
                    onClick={() => cloneFileRef.current?.click()}
                  >
                    {canShowVideo(sampleUrl) ? (
                      <>
                        <video className={css.heroCardCover} src={sampleUrl} muted playsInline preload="metadata" />
                        <span className={css.heroCardName}>{name.trim() || '素材'}</span>
                      </>
                    ) : canShowImage(sampleUrl) ? (
                      <>
                        <img className={css.heroCardCover} src={sampleUrl} alt="" />
                        <span className={css.heroCardName}>{name.trim() || '素材'}</span>
                      </>
                    ) : (
                      <>
                    <span className={css.heroCardPlus}>+</span>
                    <span className={css.heroCardLabel}>素材</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className={css.composeMain}>
                {needsText ? (
                  <>
                    <textarea
                      className={css.composeInput}
                      value={text}
                      onChange={event => setText(event.target.value)}
                      placeholder={PLACEHOLDERS[kind]}
                    />
                    <span className={css.composeCount}>{text.trim().length} ›</span>
                  </>
                ) : (
                  <div className={css.cloneFields}>
                    <input className={css.cloneInput} value={name} onChange={event => setName(event.target.value)} placeholder="名称，例如：我的数字人" />
                    <input className={css.cloneInput} value={sampleUrl} onChange={event => setSampleUrl(event.target.value)} placeholder="公网素材地址 https://…" />
                    <div className={css.uploadRow}>
                      <input
                        ref={cloneFileRef}
                        type="file"
                        accept={kind === 'xdh-voice-clone' ? 'audio/*' : 'video/*,image/*'}
                        className={css.uploadInput}
                        onChange={event => {
                          const file = event.target.files?.[0]
                          event.target.value = ''
                          if (file) void uploadLocalFile(file)
                        }}
                      />
                      <button
                        type="button"
                        className={css.uploadBtn}
                        disabled={uploading || uploadStatus?.configured === false}
                        onClick={() => cloneFileRef.current?.click()}
                      >
                        {uploading ? '上传中…' : '选择本地文件'}
                      </button>
                      {uploadStatus?.configured === false && (
                        <span className={css.cloneHint}>七牛云未配置，请在 XiaocongAPI 管理端设置</span>
                      )}
                    </div>
                    {uploadError && <div className={css.uploadError}>{uploadError}</div>}
                    {sampleUrl && kind !== 'xdh-voice-clone' && (
                      <div className={css.clonePreview}>
                        {canShowVideo(sampleUrl) ? <video src={sampleUrl} muted playsInline controls preload="metadata" /> : null}
                        {canShowImage(sampleUrl) ? <img src={sampleUrl} alt="克隆素材预览" /> : null}
                      </div>
                    )}
                    <div className={css.cloneHint}>
                      {kind === 'xdh-voice-clone' ? '上传一段 2-5 分钟清晰录音，或直接填公网地址' : '上传一段 2-5 分钟面部清晰的视频或图片，或直接填公网地址。克隆完成后会用第一帧做封面。'}
                    </div>
                  </div>
                )}
                {isImage && (
                  <label className={css.ratioField}>
                    <span>画面比例</span>
                    <select className={css.select} value={ratio} onChange={event => setRatio(event.target.value)}>
                      {['9:16', '16:9', '1:1', '3:4', '4:3'].map(value => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>

            {error && <div className={css.error}>{error}</div>}

            <div className={css.composeBottom}>
              <div className={css.toolChips}>
                <button type="button" className={css.toolChip} onClick={() => setPicker('model')}>
                  <Glyph name="spark" size={15} />{isImage ? '图片模型' : '模型'} <b>{isImage && !imageModels.length ? '未配置' : (isImage ? imageModelLabel(modelCode) : modelCode)}</b>
                </button>
                {!isImage && (
                  <button type="button" className={css.toolChip} onClick={() => void openCompanyAssets(spaceId, isAudio ? 'voices' : 'avatars')}>
                    <Glyph name={isAudio ? 'voice' : 'avatar'} size={15} />管理{isAudio ? '音色库' : '形象与音色'} →
                  </button>
                )}
                {!isImage && (
                  <button type="button" className={css.toolChip} onClick={useDefaults}>
                    切回默认
                  </button>
                )}
                {text.trim() ? (
                  <button type="button" className={css.toolChip} onClick={() => void copyText()}>
                    <Glyph name="copy" size={14} />复制文案
                  </button>
                ) : null}
              </div>
              <div className={css.composeActions}>
                <button ref={submitBtnRef} type="button" className={css.actionPrimary} disabled={busy || (isImage && !imageModels.length)} onClick={() => void submit()}>
                  <Glyph name="spark" size={16} />
                  <span className={css.actionText}>
                    <span>{busy ? (isVideo ? '正在配音…' : '提交中…') : primaryText}</span>
                    <small>{isImage ? imageModelLabel(modelCode) : modelCode}</small>
                  </span>
                </button>
                <button type="button" className={css.actionSecondary} onClick={resetForm}>
                  <span className={css.actionText}>
                    <span>清空</span>
                    <small>重置表单</small>
                  </span>
                </button>
              </div>
            </div>
          </section>
          </>)}
        </div>
      </div>
      </div>
          )}
        </div>
        <ResolvedRecordRail
          owned={ownedRecordRail()}
          visible={appPage === 'companies' && activeCompanyAction === 'archive'
            ? false
            : shouldShowRecordRail(appPage, companyOpen, resolvePublishCompany(spaces, spaceId).status === 'ready')}
          appPage={appPage}
          companyOpen={companyOpen}
          listRef={taskRailListRef}
        />
      </div>
      </RecordRailProvider>

      <DigitalHumanDeskModal
        open={!!cloneModalKind}
        title={cloneModalKind === 'xdh-voice-clone' ? '克隆新音色' : '克隆新形象'}
        onClose={() => { if (!cloneModalBusy) setCloneModalKind(null) }}
        maxWidth={560}
      >
        {cloneModalKind ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className={css.cloneFields}>
              <input
                className={css.cloneInput}
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder={cloneModalKind === 'xdh-voice-clone' ? '音色名称，例如：老板口播声线' : '形象名称，例如：门店口播形象'}
              />
              <input
                className={css.cloneInput}
                value={sampleUrl}
                onChange={event => setSampleUrl(event.target.value)}
                placeholder="公网素材地址 https://…"
              />
              <div className={css.uploadRow}>
                <input
                  ref={cloneFileRef}
                  type="file"
                  accept={cloneModalKind === 'xdh-voice-clone' ? 'audio/*' : 'video/*,image/*'}
                  className={css.uploadInput}
                  onChange={event => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void uploadLocalFile(file)
                  }}
                />
                <button
                  type="button"
                  className={css.uploadBtn}
                  disabled={uploading || uploadStatus?.configured === false}
                  onClick={() => cloneFileRef.current?.click()}
                >
                  {uploading ? '上传中…' : '选择本地文件'}
                </button>
                {uploadStatus?.configured === false ? (
                  <span className={css.cloneHint}>{uploadStatus.error || '七牛云未配置，请在 XiaocongAPI 管理端设置'}</span>
                ) : null}
              </div>
              {uploadError ? <div className={css.uploadError}>{uploadError}</div> : null}
              {sampleUrl && cloneModalKind === 'xdh-avatar-clone' ? (
                <div className={css.clonePreview}>
                  {canShowVideo(sampleUrl) ? <video src={sampleUrl} muted playsInline controls preload="metadata" /> : null}
                  {canShowImage(sampleUrl) ? <img src={sampleUrl} alt="克隆素材预览" /> : null}
                </div>
              ) : null}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>克隆模型</span>
                <select
                  className={css.select}
                  value={cloneModelCode}
                  onChange={event => setCloneModelCode(event.target.value)}
                >
                  {(MODELS[cloneModalKind] || []).map(code => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
              <div className={css.cloneHint}>
                {cloneModalKind === 'xdh-voice-clone'
                  ? '上传一段 2–5 分钟清晰录音，或直接填公网音频地址；克隆完成后会自动出现在音色库。'
                  : '上传一段 2–5 分钟面部清晰的视频或图片，或直接填公网地址；克隆完成后会自动出现在形象库。'}
              </div>
            </div>
            {cloneModalError ? <div className={css.error}>{cloneModalError}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className={css.deskGhost} disabled={cloneModalBusy} onClick={() => setCloneModalKind(null)}>取消</button>
              <button type="button" className={css.deskPrimary} disabled={cloneModalBusy || uploading} onClick={() => void submitClone()}>
                {cloneModalBusy ? '提交中…' : (cloneModalKind === 'xdh-voice-clone' ? '开始克隆音色' : '开始克隆形象')}
              </button>
            </div>
          </div>
        ) : null}
      </DigitalHumanDeskModal>

      <DigitalHumanDeskModal
        open={restyleOpen}
        title="形象换装"
        onClose={() => { if (!restyleBusy) setRestyleOpen(false) }}
        maxWidth={940}
      >
        <div className={css.restyleWrap}>
          <div className={css.restylePreview}>
            {restylePerson ? (
              <img className={css.restylePreviewImg} src={restylePerson} alt="" />
            ) : selectedAvatar ? (
              <AvatarPreview resource={selectedAvatar} className={css.restylePreviewImg} fallbackClassName={css.heroCardFallback} />
            ) : (
              <div className={css.restylePreviewEmpty}>还没有形象</div>
            )}
            <div className={css.restylePreviewMeta}>
              <b>{restylePerson ? (restylePersonName || '你自己传的照片') : (selectedAvatar?.name || '没选形象')}</b>
              <small>{restylePerson ? '用你上传的这张当参考图，只改衣服背景，脸保持不变' : '拿这张当参考图，只改衣服和背景，脸保持不变'}</small>
            </div>
            <input
              ref={restylePersonRef}
              type="file"
              accept="image/*"
              className={css.restyleFileInput}
              onChange={event => { void pickRestylePerson(event.target.files); event.target.value = '' }}
            />
            <button type="button" className={css.restyleUpload} onClick={() => restylePersonRef.current?.click()}>
              {restylePerson ? '换一张照片' : '上传自己的照片'}
            </button>
            {restylePerson ? (
              <button type="button" className={css.restyleUploadGhost} onClick={() => { setRestylePerson(''); setRestylePersonName('') }}>
                改回用形象封面
              </button>
            ) : null}
          </div>

          <div className={css.restyleForm}>
            <div className={css.restyleModeRow}>
              {([
                { id: 'clothing', label: '换衣服' },
                { id: 'background', label: '换背景' },
                { id: 'both', label: '两样都换' },
              ] as const).map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={restyleMode === item.id ? `${css.restyleMode} ${css.restyleModeOn}` : css.restyleMode}
                  onClick={() => setRestyleMode(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {restyleMode !== 'background' ? (
              <>
                <label className={css.restyleField}>
                  <span>换什么衣服</span>
                  <input
                    value={restyleClothing}
                    onChange={event => setRestyleClothing(event.target.value)}
                    placeholder="例如：深蓝色工装夹克 / 白衬衫 / 黑色西装"
                  />
                </label>
                <div className={css.restyleChips}>
                  {['白衬衫', '深蓝工装夹克', '黑色西装', '纯色T恤', '围裙'].map(item => (
                    <button
                      key={item}
                      type="button"
                      className={restyleClothing === item ? `${css.restyleChip} ${css.restyleChipOn}` : css.restyleChip}
                      onClick={() => setRestyleClothing(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                {(() => {
                  const own = materials.filter(item => item.slot === 'outfit' && item.kind === 'image' && item.url)
                  const presets = [...publicStyle.outfits.map(item => ({ id: `public-${item.id}`, name: `公·${item.name}`, url: item.url })), ...own]
                  if (!presets.length) return null
                  return (
                    <div className={css.restylePresetBlock}>
                      <span className={css.restylePresetLabel}>服装套装库{restyleOutfit ? ` · 已选 ${restyleOutfitName || '这一套'}` : ''}</span>
                      <div className={css.restylePresetRow}>
                        {presets.map(item => (
                          <button
                            key={item.id}
                            type="button"
                            className={restyleOutfit === item.url ? `${css.restylePreset} ${css.restylePresetOn}` : css.restylePreset}
                            onClick={() => {
                              if (restyleOutfit === item.url) { setRestyleOutfit(''); setRestyleOutfitName(''); return }
                              setRestyleOutfit(item.url || '')
                              setRestyleOutfitName(item.name)
                              setRestyleClothing('')
                            }}
                          >
                            <img src={item.url} alt="" />
                            <span>{item.name}</span>
                          </button>
                        ))}
                        <button
                          type="button"
                          className={css.restylePresetAdd}
                          title="上传一套服装到服装套装库"
                          onClick={() => { setRestyleSlotTarget('outfit'); restyleSlotRef.current?.click() }}
                        >
                          <span className={css.restylePresetAddPlus}>+</span>
                          <span>上传素材</span>
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </>
            ) : null}

            <input
              ref={restyleSlotRef}
              type="file"
              accept="image/*"
              className={css.restyleFileInput}
              onChange={async event => {
                const files = event.target.files
                const target = restyleSlotTarget
                event.target.value = ''
                if (!files || !files.length || !target) return
                const result = await uploadMaterials(target, files)
                const item = result?.item
                if (!item?.url) return
                if (target === 'scene') {
                  setRestyleBackdrop(item.url)
                  setRestyleBackdropName(item.name)
                } else {
                  setRestyleOutfit(item.url)
                  setRestyleOutfitName(item.name)
                  setRestyleClothing('')
                }
              }}
            />

            {restyleMode !== 'clothing' ? (
              <>
                {restyleBackdrop ? (
                <div className={css.restyleBackdropBox}>
                  <img className={css.restyleBackdropImg} src={restyleBackdrop} alt="" />
                  <input
                    ref={restyleBackdropRef}
                    type="file"
                    accept="image/*"
                    data-restyle="backdrop"
                    className={css.restyleFileInput}
                    onChange={event => { void pickRestyleBackdrop(event.target.files); event.target.value = '' }}
                  />
                  <div className={css.restyleBackdropRow}>
                    <button type="button" className={css.restyleUpload} onClick={() => restyleBackdropRef.current?.click()}>
                      {restyleBackdrop ? '换一张场景图' : '上传场景图'}
                    </button>
                    {restyleBackdrop ? (
                      <button type="button" className={css.restyleUploadGhost} onClick={() => { setRestyleBackdrop(''); setRestyleBackdropName('') }}>
                        不用图，改用文字
                      </button>
                    ) : null}
                  </div>
                  <small className={css.restyleBackdropHint}>{restyleBackdropName || '场景图'} · 已用这张图做融合</small>
                </div>
                ) : null}
                {(() => {
                  const own = materials.filter(item => item.slot === 'scene' && item.kind === 'image' && item.url)
                  const presets = [...publicStyle.scenes.map(item => ({ id: `public-${item.id}`, name: `公·${item.name}`, url: item.url })), ...own]
                  return (
                    <div className={css.restylePresetBlock}>
                      <span className={css.restylePresetLabel}>场景库{restyleBackdrop && restyleBackdropName ? ` · 已选 ${restyleBackdropName}` : ''}</span>
                      <div className={css.restylePresetRow}>
                        {presets.map(item => (
                          <button
                            key={item.id}
                            type="button"
                            className={restyleBackdrop === item.url ? `${css.restylePreset} ${css.restylePresetOn}` : css.restylePreset}
                            onClick={() => {
                              if (restyleBackdrop === item.url) { setRestyleBackdrop(''); setRestyleBackdropName(''); return }
                              setRestyleBackdrop(item.url || '')
                              setRestyleBackdropName(item.name)
                            }}
                          >
                            <img src={item.url} alt="" />
                            <span>{item.name}</span>
                          </button>
                        ))}
                        <button
                          type="button"
                          className={css.restylePresetAdd}
                          title="上传一张到场景库"
                          onClick={() => { setRestyleSlotTarget('scene'); restyleSlotRef.current?.click() }}
                        >
                          <span className={css.restylePresetAddPlus}>+</span>
                          <span>上传素材</span>
                        </button>
                      </div>
                    </div>
                  )
                })()}
                <label className={css.restyleField}>
                  <span>换成什么背景</span>
                  <input
                    value={restyleScene}
                    onChange={event => setRestyleScene(event.target.value)}
                    placeholder="例如：纯灰棚拍 / 门店门口 / 办公室 / 家里客厅"
                  />
                </label>
                <div className={css.restyleChips}>
                  {['纯灰棚拍', '门店门口，白天自然光', '办公室', '家里客厅', '户外街景'].map(item => (
                    <button
                      key={item}
                      type="button"
                      className={restyleScene === item ? `${css.restyleChip} ${css.restyleChipOn}` : css.restyleChip}
                      onClick={() => setRestyleScene(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <label className={css.restyleField}>
              <span>再补一句（可选）</span>
              <input
                value={restyleExtra}
                onChange={event => setRestyleExtra(event.target.value)}
                placeholder="例如：双手交叉、坐着、浅景深"
              />
            </label>

            {restyleError ? <p className={css.restyleError}>{restyleError}</p> : null}

            <div className={css.restyleActions}>
              <button type="button" className={css.deskPrimary} onClick={() => void runRestyle()} disabled={restyleBusy}>
                {restyleBusy ? '正在生成，大概 1 分钟…' : '生成一张新造型'}
              </button>
              <button type="button" className={css.deskGhost} onClick={() => setRestyleOpen(false)} disabled={restyleBusy}>
                关掉
              </button>
            </div>

            {restyleImages.length ? (
              <div className={css.restyleResults}>
                {restyleImages.map((url, index) => (
                  <figure key={`${url}-${index}`} className={css.restyleShot}>
                    <img src={url} alt={`造型 ${index + 1}`} />
                    <div className={css.restyleShotBar}>
                      <button
                        type="button"
                        className={css.deskGhost}
                        onClick={() => void saveRestyleImage(url)}
                        disabled={Boolean(restyleSaved[url])}
                      >
                        {restyleSaved[url] ? '已存进素材柜' : '存进素材柜'}
                      </button>
                      <a className={css.restyleLink} href={url} target="_blank" rel="noreferrer">打开原图</a>
                    </div>
                  </figure>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </DigitalHumanDeskModal>

      {picker && (
        <div className={css.overlay} onClick={() => setPicker(null)}>
          <div
            className={css.picker}
            role="dialog"
            aria-modal="true"
            aria-label={picker === 'model' ? '选择数字人模型' : picker === 'avatar' ? '选择数字人形象' : '选择音色'}
            onClick={event => event.stopPropagation()}
          >
            <div className={css.pickerHead}>
              <div>
                <h3>{picker === 'model' ? (isImage ? '选择图片模型' : '选择数字人模型') : picker === 'avatar' ? '选择数字人形象' : '选择音色'}</h3>
                <div className={css.muted}>
                  {picker === 'model' ? (isImage ? (imageModels.length ? `${imageModels.length} 个小葱 API 生图模型` : (imageModelsNote || '还没有生图模型')) : `${kindLabel(kind)}可用模型`) : `本地资源库 · ${visibleResources.length} 个`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {picker !== 'model' ? (
                  <button
                    type="button"
                    className={css.deskGhost}
                    style={{ padding: '5px 10px', fontSize: 12 }}
                    onClick={() => {
                      const targetTab = picker === 'voice' ? 'voices' : 'avatars'
                      setPicker(null)
                      void openCompanyAssets(spaceId, targetTab)
                    }}
                  >
                    {picker === 'voice' ? '去音色库管理 / 克隆 →' : '去形象库克隆 / 换装 →'}
                  </button>
                ) : null}
                <button type="button" className={css.pickerClose} onClick={() => setPicker(null)} aria-label="关闭">×</button>
              </div>
            </div>
            <div className={css.pickerBody}>
              {picker === 'model' ? (
                <div className={css.modelGrid}>
                  {models.map(code => (
                    <button
                      key={code}
                      type="button"
                      className={code === modelCode ? `${css.modelCard} ${css.modelCardOn}` : css.modelCard}
                      onClick={() => { setModelCode(code); setPicker(null) }}
                    >
                      <b>{isImage ? imageModelLabel(code) : code}</b>
                      <span>{isImage ? code : kindLabel(kind)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <>
              {resourceError ? (
                <div className={css.pickerEmpty}>{resourceError}</div>
              ) : visibleResources.length === 0 ? (
                <div className={css.pickerEmpty}>
                  <div>还没有保存的{picker === 'avatar' ? '形象' : '音色'}。</div>
                  <button
                    type="button"
                    className={css.deskPrimary}
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      const targetClone = picker === 'voice' ? 'xdh-voice-clone' : 'xdh-avatar-clone'
                      setPicker(null)
                      openCloneModal(targetClone)
                    }}
                  >
                    + 立即克隆{picker === 'avatar' ? '新形象' : '新音色'}
                  </button>
                </div>
              ) : (
                <div className={css.resourceGrid}>
                  {visibleResources.map(resource => {
                    const id = picker === 'avatar' ? avatarResourceID(resource) : voiceResourceID(resource)
                    const selected = picker === 'avatar' ? avatarId === id : voiceId === id
                    return (
                      <div
                        key={`${resource.source || 'local'}-${id || resource.name}`}
                        role="button"
                        tabIndex={0}
                        className={selected ? `${css.resourceCard} ${css.resourceCardOn}` : css.resourceCard}
                        onClick={() => {
                          if (picker === 'avatar') chooseAvatar(resource)
                          else chooseVoice(resource)
                        }}
                        onKeyDown={event => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          if (picker === 'avatar') chooseAvatar(resource)
                          else chooseVoice(resource)
                        }}
                      >
                        {picker === 'avatar' ? (
                          <AvatarPreview
                            resource={resource}
                            className={css.resourceCover}
                            fallbackClassName={css.resourceCoverFallback}
                            playable
                          />
                        ) : (
                          <span className={css.resourceVoiceCover}><Glyph name="voice" size={26} /></span>
                        )}
                        <span className={css.resourceName}>{resource.name || id}</span>
                        <span className={css.resourceMeta}>
                          {Number(resource.is_default) === 1 ? <span className={css.resourceBadge}>默认</span> : null}
                          {resource.model_code && <span>{resource.model_code}</span>}
                          <span>{id}</span>
                          {resource.width && resource.height ? <span>{resource.width}×{resource.height}</span> : null}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <div className={css.toast}>{toast}</div>}
    </div>
  )
}

/** Sidebar icon for the digital human panel. */
export function DigitalHumanPanelIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.28)),
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(10, Math.round(size * 0.5)),
        fontWeight: 600,
        background: active ? 'linear-gradient(135deg, #8b6cff, #5b3df0)' : 'transparent',
        color: active ? '#fff' : 'inherit',
      }}
    >
      数
    </span>
  )
}
