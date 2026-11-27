import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { platformPromptLines } from './platform-feed.js'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const DEFAULT_SPACE_ID = 'default'
export const SPACE_STORE_PATH = join(homedir(), '.dsh', 'digital-human-spaces.json')
export const LEGACY_ASSET_ROOT = join(homedir(), '.dsh', 'digital-human-assets')
export const LEGACY_IMAGE_STORE = join(homedir(), '.dsh', 'digital-human-images.json')
export const SPACES_ROOT = join(homedir(), '.dsh', 'spaces')

export type ClientBrief = {
  identity: string
  business: string
  audience: string
  tone: string
  avoid: string
  sample: string
  /** 品牌事实：店名/城市/门店数/做几年/价格带/资质，防编造 */
  brand: string
  /** 客户痛点原话，钩子从这里来 */
  pains: string
  /** 证据：案例、数据、客户评价 */
  proof: string
  /** 结尾目标动作：到店/私信/评论关键词/领券 */
  cta: string
  /** 自称与说话习惯：我/我们、方言、句长 */
  voice: string
  /** 核心关键词与常带话题：用于三平台 #话题 与字幕关键词自动标色 */
  keywords: string
  /** 默认画幅与目标时长：竖屏 9:16 / 横屏 16:9，映射 size */
  videoFormat: string
  /** 剪辑节奏与类型：口播停顿快切 / 多段混剪 / 沉稳讲解 / 写实包装，映射 cut_on_pause 等 */
  editStyle: string
  /** 字幕、花字与调色规范：映射 subtitles.style / look.lut / bg_blur / texts[].style */
  visualStyle: string
  /** 声音降噪、配音与 BGM 气氛偏好：映射 audio.voice_fx / audio.bgm */
  audioStyle: string
  /** 固定片头/片尾落版文案：映射 intro / outro */
  outroTemplate: string
}

const BRIEF_LIMITS: Record<keyof ClientBrief, number> = {
  identity: 80,
  business: 400,
  audience: 200,
  tone: 80,
  avoid: 200,
  sample: 800,
  brand: 240,
  pains: 320,
  proof: 320,
  cta: 80,
  voice: 80,
  keywords: 200,
  videoFormat: 80,
  editStyle: 160,
  visualStyle: 200,
  audioStyle: 160,
  outroTemplate: 200,
}

/** 多行字段：保留换行，适合列清单 */
const BRIEF_MULTILINE = new Set<keyof ClientBrief>(['sample', 'pains', 'proof'])

export const BRIEF_KEYS = [
  'identity', 'business', 'audience', 'brand', 'pains', 'proof', 'cta',
  'voice', 'tone', 'avoid', 'keywords', 'sample',
  'videoFormat', 'editStyle', 'visualStyle', 'audioStyle', 'outroTemplate',
] as const

export type StudioSpace = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  lastProjectFolder: string
  lastDraftId: string
  lastDraftPath: string
  lastViralRecipe: string
  /** Customer-picked mixcut voice: warm_boss / warn_friend / steady_pro / show_result, or a cloned voice id. */
  preferredVoiceId: string
  /** lively / steady / none. Empty means the customer has not been asked. */
  preferredMusic: string
  brief: ClientBrief
}

export type SpaceStore = {
  version: 1
  currentId: string
  spaces: StudioSpace[]
  /** Conversation id → company space id. Each chat keeps the company it picked. */
  sessionSpaces?: Record<string, string>
}

export type SpaceSeed = {
  lastProjectFolder?: string
  lastDraftId?: string
  lastDraftPath?: string
}

export function isSpaceId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(String(id || '').trim())
}

export function newSpaceId(): string {
  return `co-${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function spaceAssetRoot(spaceId: string): string {
  const id = String(spaceId || '').trim() || DEFAULT_SPACE_ID
  if (id === DEFAULT_SPACE_ID) return LEGACY_ASSET_ROOT
  return join(SPACES_ROOT, id)
}

export function spaceImageStorePath(spaceId: string): string {
  const id = String(spaceId || '').trim() || DEFAULT_SPACE_ID
  if (id === DEFAULT_SPACE_ID) return LEGACY_IMAGE_STORE
  return join(SPACES_ROOT, id, 'images.json')
}

export function spaceImageFileRoot(spaceId: string): string {
  return join(spaceAssetRoot(spaceId), 'images')
}

export function emptyClientBrief(): ClientBrief {
  return {
    identity: '', business: '', audience: '', tone: '', avoid: '', sample: '',
    brand: '', pains: '', proof: '', cta: '', voice: '',
    keywords: '', videoFormat: '', editStyle: '', visualStyle: '', audioStyle: '', outroTemplate: '',
  }
}

function clipBriefField(value: unknown, max: number, multiline = false): string {
  const raw = String(value ?? '')
  const text = multiline ? raw.replace(/\r\n/g, '\n').trim() : raw.trim().replace(/\s+/g, ' ')
  return text.length > max ? text.slice(0, max) : text
}

export function normalizeClientBrief(value: unknown): ClientBrief {
  const row = value && typeof value === 'object' ? value as Partial<Record<keyof ClientBrief, unknown>> : {}
  return {
    identity: clipBriefField(row.identity, BRIEF_LIMITS.identity),
    business: clipBriefField(row.business, BRIEF_LIMITS.business),
    audience: clipBriefField(row.audience, BRIEF_LIMITS.audience),
    tone: clipBriefField(row.tone, BRIEF_LIMITS.tone),
    avoid: clipBriefField(row.avoid, BRIEF_LIMITS.avoid),
    sample: clipBriefField(row.sample, BRIEF_LIMITS.sample, true),
    brand: clipBriefField(row.brand, BRIEF_LIMITS.brand),
    pains: clipBriefField(row.pains, BRIEF_LIMITS.pains, true),
    proof: clipBriefField(row.proof, BRIEF_LIMITS.proof, true),
    cta: clipBriefField(row.cta, BRIEF_LIMITS.cta),
    voice: clipBriefField(row.voice, BRIEF_LIMITS.voice),
    keywords: clipBriefField(row.keywords, BRIEF_LIMITS.keywords),
    videoFormat: clipBriefField(row.videoFormat, BRIEF_LIMITS.videoFormat),
    editStyle: clipBriefField(row.editStyle, BRIEF_LIMITS.editStyle),
    visualStyle: clipBriefField(row.visualStyle, BRIEF_LIMITS.visualStyle),
    audioStyle: clipBriefField(row.audioStyle, BRIEF_LIMITS.audioStyle),
    outroTemplate: clipBriefField(row.outroTemplate, BRIEF_LIMITS.outroTemplate),
  }
}

export function mergeClientBrief(current: ClientBrief, patch: unknown): ClientBrief {
  const row = patch && typeof patch === 'object' ? patch as Partial<Record<keyof ClientBrief, unknown>> : {}
  const next = { ...normalizeClientBrief(current) }
  for (const key of BRIEF_KEYS) {
    if (row[key] == null) continue
    next[key] = clipBriefField(row[key], BRIEF_LIMITS[key], BRIEF_MULTILINE.has(key))
  }
  return next
}

export function briefHasContent(brief: ClientBrief): boolean {
  return BRIEF_KEYS.some(key => String(brief[key] || '').trim())
}

export const BRIEF_FIELD_LABELS: Record<keyof ClientBrief, string> = {
  identity: '对外身份',
  business: '主营/卖点',
  audience: '对谁说',
  tone: '口吻',
  avoid: '不要说',
  sample: '范例口播',
  brand: '品牌事实',
  pains: '客户痛点原话',
  proof: '证据',
  cta: '结尾目标动作',
  voice: '自称与说话习惯',
  keywords: '核心关键词/固定话题',
  videoFormat: '默认画幅与时长',
  editStyle: '剪辑节奏与风格',
  visualStyle: '字幕/花字/调色规范',
  audioStyle: '人声/配音/BGM偏好',
  outroTemplate: '固定片头/片尾落版',
}

export type ViralRecipe = {
  id: string
  name: string
  when: string
  hook: string
  body: string
  end: string
}

/** Internal craft only. Never ask the customer to name these. */
export const VIRAL_RECIPES: ViralRecipe[] = [
  { id: 'pitfall', name: '避坑快切', when: '怕买错', hook: '开口先说最容易踩的坑', body: '产品特写砸卖点', end: '让人私信问一句' },
  { id: 'result', name: '结果先行', when: '想先看到效果', hook: '先甩做好的样子', body: '倒叙过程配产品', end: '说来店里看样' },
  { id: 'contrast', name: '新旧对比', when: '想看出差别', hook: '旧的和新的并在一起', body: '快切对比加一句为什么', end: '同款来问我' },
  { id: 'walk', name: '带进店', when: '想来店看看', hook: '带你进门转一圈', body: '门店环境快切', end: '顺口报位置' },
  { id: 'hands', name: '干活现场', when: '想看真功夫', hook: '正在铺正在装', body: '手部和产品特写', end: '问一句价格' },
  { id: 'talk', name: '老板出镜', when: '想记住这家店', hook: '老板用一句人话开场', body: '口播盖店里画面', end: '让人关注下次还讲' },
]

export function pickViralRecipe(opts: { lastId?: string; seed?: string; intent?: string } = {}): ViralRecipe {
  const intent = String(opts.intent || '')
  let pool = VIRAL_RECIPES
  if (/来店|到店|地址|看看店/.test(intent)) pool = VIRAL_RECIPES.filter(item => ['walk', 'contrast', 'result'].includes(item.id))
  else if (/私信|问价|询|买/.test(intent)) pool = VIRAL_RECIPES.filter(item => ['pitfall', 'hands', 'talk'].includes(item.id))
  else if (/记住|人设|品牌|认识/.test(intent)) pool = VIRAL_RECIPES.filter(item => ['talk', 'walk'].includes(item.id))
  if (!pool.length) pool = VIRAL_RECIPES
  const seed = String(opts.seed || 'x')
  let n = 0
  for (let i = 0; i < seed.length; i += 1) n = (n + seed.charCodeAt(i) * (i + 1)) % 2147483647
  const start = n % pool.length
  for (let i = 0; i < pool.length; i += 1) {
    const recipe = pool[(start + i) % pool.length]
    if (recipe.id !== opts.lastId) return recipe
  }
  return pool[start]
}

export function loadViralRule(id: string): string {
  const safe = VIRAL_RECIPES.some(item => item.id === id) ? id : 'pitfall'
  const files = [
    join(PLUGIN_ROOT, 'skills', 'jiancai-viral', 'rules', `${safe}.md`),
    join(homedir(), '.dsh', 'skills', 'jiancai-viral', 'rules', `${safe}.md`),
  ]
  for (const file of files) {
    if (!existsSync(file)) continue
    try {
      const text = readFileSync(file, 'utf8').trim()
      if (text) return text
    } catch {
      /* next */
    }
  }
  return ''
}

function viralRecipePromptLine(recipe: ViralRecipe): string {
  const rule = loadViralRule(recipe.id)
  return [
    `这次内部成片路线（对客户只说人话，不要甩术语）：${recipe.name}。开头${recipe.hook}；中间${recipe.body}；结尾${recipe.end}。`,
    '完整剪法已经写在下面，直接按做。禁止用 read/cat/shell 再去打开 talk.md 或其他 rules 文件。',
    '配音默认用热心老板：dh_set_voice 后 dh_add_narration，交付时说一句「配音是热心老板，要换跟我说」（避坑提醒 / 稳重师傅 / 带看效果 / 用我的声音）。他明确说想用自己的声音，再让他丢一段说话录音 dh_clone_voice。禁止本机 say。不要先问。',
    '垫乐自己找，不要把选歌丢给客户。直出成片优先用 dh_quick_edit 的 bgm="auto"（自动选曲并压人声）；草稿模式走 dh_find_music + dh_add_music。客户说先不要就跳过；客户丢了自己的曲子就用那首 path。禁止去网上搜商用受限歌曲，禁止测分贝、禁止改音乐文件、禁止自己抬音量重渲。',
    '花字别只用一种黄底大字：按场合挑 style——开场钩子「手写笔刷」、卖点数字「数字放大」或「渐变金」、替代裸字「深色卡片」、结论「印章」、清单「对勾」、店名收尾「店招红金」或「银灰金属字」、整句字幕「白字黑边」。一条片子 3–5 个花字、2–3 种样式，文字不超过 8 个字。用 dh_add_local_styled_text，不要改用 dh_add_text。不要先问。',
    '音效默认就要有：先 dh_list_sfx 拿清单（33 个，按用途挑，不要凭名字猜），一条 15–20 秒铺 3–5 个点，只落在动作和重点上——开场 riser、转场或卡片 whoosh、数字 count、落定 stamp、收尾 ding。dh_add_sfx 一次传数组，gain 用默认值。不要铺满，不要每个镜头都配。',
    rule ? `---\n${rule}\n---` : `（未找到 rules/${recipe.id}.md，按上面三句人话剪）`,
    '连续两条不要重复同一路线。',
  ].join('\n')
}

/** Always-on: 目的不问，直接剪一版给他看；专业事先我们做。 */
export const VIDEO_REQUEST_GUIDE = [
  '客户不专业：不要让他们说转化、CTA、分镜、入点出点、画幅、完播率，也不要说私信、留资、引流这些行话。',
  '用户要的是数字人出镜（做数字人视频、让数字人讲一段、用我的形象出个口播）就走 digital-human-video 技能：用资源库里现成的形象音色，提交任务后自己轮询到成片再交付。不要按混剪路线剪，也不要扫剪映草稿。',
  '用户只说「做个视频 / 混剪」时，先静默 dh_get_brief + dh_list_materials，然后直接按默认路线剪。不要开口问目的，不要让他从几个选项里挑。默认当作「有人看完会来问你价」；他自己说了想让人来店里、想让人记住这家店，再换路线。',
  '不用等他确认方案再动手：开头/中间/结尾三句话和成片一起给，要改再改。钩子、节奏、选用哪条素材、入点出点全部由我们定，不要反问客户。没素材时只说「把店里或产品视频丢进对话就行」，不要让他们去左侧填表。',
  '快剪成片优先走 dh_quick_edit（直出 mp4 并自动入成片库，BGM 传 "auto" 自动选曲压人声）；仅在客户要求去剪映二次精剪时走草稿流（dh_add_video 按镜传 path + start + end，配音默认热心老板 dh_set_voice + dh_add_narration，垫乐用 dh_find_music + dh_add_music）。同一家店连续做，换路线避免千篇一律。系统提示里已经带上剪法正文，不要再 read rules 文件。',
  '用户指出本地目录有视频时：必须先 dh_ingest_local_folder 拷进当前公司素材库，再 dh_list_materials。pending 看封面/首帧后，用 dh_label_materials 逐项写清 environment（在哪拍、背景）、lighting（自然光/灯光、明暗、色温）、quality（清晰度、抖动、构图、能否用）、speaker（谁出镜、穿着、是否露脸）、speech（尽量逐字写清说了什么，无对白就写无对白），不知道的维度写「未识别」，不要只写一句用途，也不要编造。禁止直接读原目录里的全部成片，禁止每次混剪都把素材夹通看一遍。',
].join('\n')

export function formatBriefForPrompt(
  spaceName: string,
  spaceId: string,
  brief: ClientBrief,
  opts: { lastViralRecipe?: string; intent?: string; platforms?: string[] } = {},
): string {
  const recipe = pickViralRecipe({ lastId: opts.lastViralRecipe, seed: spaceId, intent: opts.intent })
  const lines = [
    `当前数字人公司空间：${spaceName}（${spaceId}）。`,
    '写口播、配图文案、数字人脚本，以及调 dh_quick_edit / dh_render_recipe 剪辑视频时，必须严格遵守这份公司档案（不编造品牌/价格/承诺；画幅、节奏、字幕花字调色、声音BGM、片头片尾与关键词标色均按档案里的剪辑规范映射）。当次主推由用户这一轮说明，不要把旧主推硬套进去。',
    '客户混剪素材在这家公司本地柜（产品/门店/Logo）。换件前先 dh_list_materials 取本地路径，再 dh_add_video。',
    ...platformPromptLines(opts.platforms || []),
    VIDEO_REQUEST_GUIDE,
    viralRecipePromptLine(recipe),
  ]
  for (const key of BRIEF_KEYS) {
    const raw = String(brief[key] || '').trim()
    if (!raw) continue
    // 多行清单压成一行，避免提示词里标签只挂在第一行、后面几条成了游离文本
    const value = key === 'sample'
      ? raw.replace(/\s*\n+\s*/g, ' ')
      : raw.replace(/\s*\n+\s*/g, '；')
    lines.push(`${BRIEF_FIELD_LABELS[key]}：${value}`)
  }
  return lines.join('\n')
}

/** Injected when the current company space has no client brief yet. */
export function formatEmptyBriefForPrompt(
  spaceName: string,
  spaceId: string,
  opts: { firstTurn?: boolean; lastViralRecipe?: string; intent?: string; platforms?: string[] } = {},
): string {
  const header = `当前数字人公司空间：${spaceName}（${spaceId}）。`
  const fields = BRIEF_KEYS.map(key => BRIEF_FIELD_LABELS[key]).join('、')
  const recipe = pickViralRecipe({ lastId: opts.lastViralRecipe, seed: spaceId, intent: opts.intent })
  if (opts.firstTurn) {
    return [
      header,
      '这家公司还没有客户档案。客户不专业：不要让他们去左侧工作台填表，不要用行话问他们。聊天里够用的店名/卖点立刻 dh_update_brief。',
      `能从对话里捞的项：${fields}。用人话问，短句即可。`,
      '如果用户这一轮已经介绍了店和卖点，先归纳成短档案，立刻调用 dh_update_brief 写入，再继续完成他们这一轮的事。',
      ...platformPromptLines(opts.platforms || []),
      VIDEO_REQUEST_GUIDE,
      viralRecipePromptLine(recipe),
      '卖点不够时用人话一次问完：「店里主推啥、最怕客人踩什么坑」。不要一轮只问一句。',
      '用户答完后马上 dh_update_brief，只传有内容的字段。专业事先我们做，不要编造品牌、门店、价格或承诺。',
      '如果用户这一轮明显是写代码、改文件或查报错，先做正事；结尾用一句提一下这家还没档案，写口播时再说。',
    ].join('\n')
  }
  return [
    header,
    `这家公司仍没有客户档案。不要反复盘问，也不要用专业词问客户。做视频缺卖点就问一句主推什么，够写就 dh_update_brief。要记的项：${fields}。`,
    ...platformPromptLines(opts.platforms || []),
    '不要编造品牌、门店、价格或承诺。当次主推以用户这一轮说明为准。',
    VIDEO_REQUEST_GUIDE,
    viralRecipePromptLine(recipe),
  ].join('\n')
}

function emptyDefaultSpace(seed: SpaceSeed = {}): StudioSpace {
  const now = Date.now()
  return {
    id: DEFAULT_SPACE_ID,
    name: '默认',
    createdAt: now,
    updatedAt: now,
    lastProjectFolder: String(seed.lastProjectFolder || ''),
    lastDraftId: String(seed.lastDraftId || ''),
    lastDraftPath: String(seed.lastDraftPath || ''),
    lastViralRecipe: '',
    preferredVoiceId: '',
    preferredMusic: '',
    brief: emptyClientBrief(),
  }
}

function hydrateSpace(row: StudioSpace): StudioSpace {
  return {
    id: row.id,
    name: row.name.trim(),
    createdAt: Number(row.createdAt) || Date.now(),
    updatedAt: Number(row.updatedAt) || Date.now(),
    lastProjectFolder: String(row.lastProjectFolder || ''),
    lastDraftId: String(row.lastDraftId || ''),
    lastDraftPath: String(row.lastDraftPath || ''),
    lastViralRecipe: String(row.lastViralRecipe || ''),
    preferredVoiceId: String(row.preferredVoiceId || ''),
    preferredMusic: String(row.preferredMusic || ''),
    brief: normalizeClientBrief(row.brief),
  }
}

export function emptySpaceStore(seed: SpaceSeed = {}): SpaceStore {
  const space = emptyDefaultSpace(seed)
  return { version: 1, currentId: space.id, spaces: [space] }
}

function isStudioSpace(value: unknown): value is StudioSpace {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<StudioSpace>
  return typeof row.id === 'string' && isSpaceId(row.id) && typeof row.name === 'string' && row.name.trim() !== ''
}

export function loadSpaceStore(path = SPACE_STORE_PATH, seed: SpaceSeed = {}): SpaceStore {
  const fallback = emptySpaceStore(seed)
  try {
    if (!existsSync(path)) return fallback
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<SpaceStore>
    const spaces = Array.isArray(raw.spaces) ? raw.spaces.filter(isStudioSpace).map(hydrateSpace) : []
    if (!spaces.length) return fallback
    if (!spaces.some(item => item.id === DEFAULT_SPACE_ID)) spaces.unshift(emptyDefaultSpace(seed))
    const currentId = spaces.some(item => item.id === raw.currentId) ? String(raw.currentId) : spaces[0].id
    const sessionSpaces = hydrateSessionSpaces(raw.sessionSpaces, spaces)
    return { version: 1, currentId, spaces, ...sessionSpaces ? { sessionSpaces } : {} }
  } catch {
    return fallback
  }
}

export function saveSpaceStore(store: SpaceStore, path = SPACE_STORE_PATH) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({
    version: 1,
    currentId: store.currentId,
    spaces: store.spaces,
    ...store.sessionSpaces && Object.keys(store.sessionSpaces).length ? { sessionSpaces: store.sessionSpaces } : {},
  }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  chmodSync(path, 0o600)
}

function hydrateSessionSpaces(value: unknown, spaces: StudioSpace[]): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const known = new Set(spaces.map(item => item.id))
  const out: Record<string, string> = {}
  for (const [sessionId, spaceId] of Object.entries(value as Record<string, unknown>)) {
    const key = String(sessionId || '').trim()
    const id = String(spaceId || '').trim()
    if (!key || !known.has(id)) continue
    out[key] = id
  }
  return Object.keys(out).length ? out : undefined
}

function withSessionSpace(store: SpaceStore, sessionId: string | undefined, spaceId: string): SpaceStore {
  const key = String(sessionId || '').trim()
  if (!key) return store
  const sessionSpaces = { ...(store.sessionSpaces || {}) }
  delete sessionSpaces[key]
  sessionSpaces[key] = spaceId
  const keys = Object.keys(sessionSpaces)
  if (keys.length > 300) {
    for (const extra of keys.slice(0, keys.length - 300)) delete sessionSpaces[extra]
  }
  return { ...store, sessionSpaces }
}

/** Snapshot per-company defaults before an async Xiaocongcut operation starts. */
export function spaceWorkspace(store: SpaceStore, spaceId: string): SpaceSeed {
  const space = store.spaces.find(item => item.id === spaceId)
  if (!space) throw new Error('找不到这个公司空间')
  return {
    lastProjectFolder: space.lastProjectFolder,
    lastDraftId: space.lastDraftId,
    lastDraftPath: space.lastDraftPath,
  }
}

export function currentSpace(store: SpaceStore): StudioSpace {
  return store.spaces.find(item => item.id === store.currentId) || store.spaces[0]
}

export function spaceForSession(store: SpaceStore, sessionId?: string): StudioSpace {
  const key = String(sessionId || '').trim()
  const bound = key ? store.sessionSpaces?.[key] : undefined
  if (bound) {
    const space = store.spaces.find(item => item.id === bound)
    if (space) return space
  }
  return currentSpace(store)
}

export function ensureSessionSpace(store: SpaceStore, sessionId: string): SpaceStore {
  const key = String(sessionId || '').trim()
  if (!key) return store
  const bound = store.sessionSpaces?.[key]
  if (bound && store.spaces.some(item => item.id === bound)) return store
  return withSessionSpace(store, key, currentSpace(store).id)
}

export function publicSpaces(store: SpaceStore) {
  return {
    currentId: store.currentId,
    spaces: store.spaces.map(item => ({
      id: item.id,
      name: item.name,
      lastProjectFolder: item.lastProjectFolder,
      lastDraftId: item.lastDraftId,
      lastDraftPath: item.lastDraftPath,
      lastViralRecipe: item.lastViralRecipe || '',
      preferredVoiceId: item.preferredVoiceId || '',
      preferredMusic: item.preferredMusic || '',
      brief: item.brief,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  }
}

function clipName(name: string): string {
  const value = String(name || '').trim().replace(/\s+/g, ' ')
  if (!value) throw new Error('公司名称不能为空')
  if (value.length > 40) throw new Error('公司名称不要超过 40 个字')
  return value
}

export function patchSpace(store: SpaceStore, id: string, patch: Partial<Pick<StudioSpace, 'name' | 'lastProjectFolder' | 'lastDraftId' | 'lastDraftPath' | 'lastViralRecipe' | 'preferredVoiceId' | 'preferredMusic'>> & { brief?: unknown }): SpaceStore {
  const spaces = store.spaces.map(item => {
    if (item.id !== id) return item
    return {
      ...item,
      name: patch.name != null ? clipName(patch.name) : item.name,
      lastProjectFolder: patch.lastProjectFolder != null ? String(patch.lastProjectFolder) : item.lastProjectFolder,
      lastDraftId: patch.lastDraftId != null ? String(patch.lastDraftId) : item.lastDraftId,
      lastDraftPath: patch.lastDraftPath != null ? String(patch.lastDraftPath) : item.lastDraftPath,
      lastViralRecipe: patch.lastViralRecipe != null ? String(patch.lastViralRecipe) : item.lastViralRecipe,
      preferredVoiceId: patch.preferredVoiceId != null ? String(patch.preferredVoiceId).slice(0, 80) : item.preferredVoiceId,
      preferredMusic: patch.preferredMusic != null ? String(patch.preferredMusic).slice(0, 20) : item.preferredMusic,
      brief: patch.brief != null ? mergeClientBrief(item.brief, patch.brief) : item.brief,
      updatedAt: Date.now(),
    }
  })
  if (!spaces.some(item => item.id === id)) throw new Error('找不到这个公司空间')
  return { ...store, spaces }
}

export function selectSpace(store: SpaceStore, id: string, sessionId?: string): SpaceStore {
  if (!store.spaces.some(item => item.id === id)) throw new Error('找不到这个公司空间')
  return withSessionSpace({ ...store, currentId: id }, sessionId, id)
}

export function ensureSpaceDisk(spaceId: string) {
  const root = spaceAssetRoot(spaceId)
  mkdirSync(join(root, 'images'), { recursive: true })
  mkdirSync(join(root, 'materials', 'product'), { recursive: true })
  mkdirSync(join(root, 'materials', 'store'), { recursive: true })
  mkdirSync(join(root, 'materials', 'logo'), { recursive: true })
}

export function createSpace(store: SpaceStore, name: string, seed: SpaceSeed = {}): { store: SpaceStore; space: StudioSpace } {
  const now = Date.now()
  const space: StudioSpace = {
    id: newSpaceId(),
    name: clipName(name),
    createdAt: now,
    updatedAt: now,
    lastProjectFolder: String(seed.lastProjectFolder || ''),
    lastDraftId: String(seed.lastDraftId || ''),
    lastDraftPath: String(seed.lastDraftPath || ''),
    lastViralRecipe: '',
    preferredVoiceId: '',
    preferredMusic: '',
    brief: emptyClientBrief(),
  }
  const next: SpaceStore = {
    version: 1,
    currentId: space.id,
    spaces: [...store.spaces, space],
    ...store.sessionSpaces ? { sessionSpaces: store.sessionSpaces } : {},
  }
  return { store: next, space }
}

export function removeSpaceDisk(id: string) {
  if (!id || id === DEFAULT_SPACE_ID) return
  try { rmSync(join(SPACES_ROOT, id), { recursive: true, force: true }) } catch { /* best effort */ }
}

export function deleteSpace(store: SpaceStore, id: string): SpaceStore {
  if (id === DEFAULT_SPACE_ID) throw new Error('默认空间不能删除，可以改名当第一家公司用')
  if (store.spaces.length <= 1) throw new Error('至少保留一个公司空间')
  const spaces = store.spaces.filter(item => item.id !== id)
  if (spaces.length === store.spaces.length) throw new Error('找不到这个公司空间')
  const sessionSpaces = store.sessionSpaces
    ? Object.fromEntries(Object.entries(store.sessionSpaces).filter(([, spaceId]) => spaceId !== id))
    : undefined
  return {
    version: 1,
    currentId: store.currentId === id ? spaces[0].id : store.currentId,
    spaces,
    ...sessionSpaces && Object.keys(sessionSpaces).length ? { sessionSpaces } : {},
  }
}
