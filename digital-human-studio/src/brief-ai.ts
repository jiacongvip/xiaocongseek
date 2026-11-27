import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spaceAssetRoot, type ClientBrief } from './spaces.js'

/** 每家公司的「知识库」：客户贴进来的资料先落在这里，AI 归纳完也不删。 */
export function knowledgeDir(space: string): string {
  return join(spaceAssetRoot(space), 'knowledge')
}

const LIMITS: Record<string, number> = {
  identity: 80,
  business: 400,
  audience: 200,
  brand: 240,
  pains: 320,
  proof: 320,
  cta: 80,
  voice: 80,
  tone: 80,
  avoid: 200,
  keywords: 200,
  sample: 800,
  videoFormat: 80,
  editStyle: 160,
  visualStyle: 200,
  audioStyle: 160,
  outroTemplate: 200,
}

const MULTILINE = new Set(['pains', 'proof', 'sample'])

function safeName(name: string): string {
  const base = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  return base || 'notes.txt'
}

/** 把一份资料写进知识库，返回落盘后的相对名。 */
export function saveKnowledge(space: string, name: string, text: string): string {
  const dir = knowledgeDir(space)
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `${stamp}-${safeName(name)}`)
  writeFileSync(file, text, 'utf8')
  return file
}

export function listKnowledge(space: string): string[] {
  try {
    return readdirSync(knowledgeDir(space)).sort().reverse()
  } catch {
    return []
  }
}

/** 读知识库里最近几份资料，拼成给模型看的上下文（最多 maxChars）。 */
export function recentKnowledgeText(space: string, maxFiles = 6, maxChars = 12000): string {
  const parts: string[] = []
  let used = 0
  for (const name of listKnowledge(space).slice(0, maxFiles)) {
    try {
      const text = readFileSync(join(knowledgeDir(space), name), 'utf8').trim()
      if (!text) continue
      const block = `【${name}】\n${text}`
      if (used + block.length > maxChars) break
      parts.push(block)
      used += block.length
    } catch { /* 读不出来跳过 */ }
  }
  return parts.join('\n\n')
}

export function clip(value: unknown, max: number, multiline = false): string {
  const raw = String(value ?? '')
  const text = multiline ? raw.replace(/\r\n/g, '\n').trim() : raw.trim().replace(/\s+/g, ' ')
  return text.length > max ? text.slice(0, max) : text
}

export function briefDraftPrompts(input: {
  spaceName: string
  brief: ClientBrief
  blob: string
}): { system: string; user: string } {
  const system = [
    '你在帮一家门店把散落的资料整理成「口播档案」。',
    '事实类内容（品牌、门店、价格、年限、资质、客户评价）只允许用资料里出现的，不许编造；资料里没有就留空。',
    '但 sample（范例口播）可以现写：资料里有满意的口播就原样收，没有就根据档案信息和行业常识写一段能照着学的口播样例。',
    '每条都要短，能直接给写口播的人用；不要写形容词堆砌。',
    '只输出一个 JSON 对象，不要解释、不要代码块以外的内容。',
  ].join('\n')
  const shape = [
    '{"identity":"对外身份，一句话","business":"主营与卖点，短句","audience":"对谁说，带真实顾虑",',
    '"brand":"品牌事实：全称/城市/门店数/做了几年/价格带/资质，逗号隔开","pains":"客户痛点原话，2-3 条，用换行分隔",',
    '"proof":"证据：案例数、具体数据、客户评价原话，用换行分隔","cta":"结尾想让客户做的动作，一句",',
    '"voice":"自称与说话习惯","tone":"口吻，一句","avoid":"不要说的话","keywords":"核心关键词与固定话题词，逗号隔开",',
    '"videoFormat":"默认画幅与目标时长（如竖屏 9:16 · 20-45秒）","editStyle":"剪辑节奏与风格（如口播停顿快切 / 多段混剪）",',
    '"visualStyle":"字幕、花字与调色规范（如关键词标色+暖调warm_soft+避脸）","audioStyle":"人声降噪与BGM偏好（如降噪clean+轻快BGM压人声）",',
    '"outroTemplate":"固定片头/片尾落版文案","sample":"资料里有就原样收，没有就现写一段能照着学的口播样例",',
    '"missing":"资料里缺哪些关键信息，一句话"}',
  ].join('')
  const user = [
    `公司：${input.spaceName}`,
    '当前档案（可能已有内容，空的说明还没填）：',
    JSON.stringify(input.brief, null, 0),
    '',
    '客户刚给的资料：',
    input.blob.slice(0, 30000),
    '',
    '按这个 JSON 结构输出：',
    shape,
  ].join('\n')
  return { system, user }
}

/** 把模型给的草稿收成能直接写进档案的对象。 */
export function normalizeBriefDraft(value: unknown): { draft: Partial<ClientBrief>; missing: string } {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const draft: Partial<ClientBrief> = {}
  for (const [key, max] of Object.entries(LIMITS)) {
    const text = clip(row[key], max, MULTILINE.has(key))
    if (text) (draft as Record<string, string>)[key] = text
  }
  const missing = clip(row.missing, 200)
  return { draft, missing }
}

/** 对话式：模型回一段人话 + 一批要更新的字段。 */
export function briefChatPrompts(input: {
  spaceName: string
  brief: ClientBrief
  knowledge: string
  history: { role: 'user' | 'assistant'; text: string }[]
  message: string
}): { system: string; user: string } {
  const system = [
    '你是门店老板的「档案助手」，帮老板把口播档案填准、补全、改好。',
    '档案是用来给写口播的人/AI 用的底稿，字段固定，不许加新字段。',
    '事实类字段（身份、主营、受众、品牌、痛点、证据、引导、口吻、禁忌）只用资料和档案里已有的事实，不许编造品牌、门店、价格、年限、资质或客户评价；资料里没有就明说没有，别瞎补。',
    '老板可能让你：填某几格、改某格的措辞、根据资料补全、或者只是问一句。',
    '如果这轮要改档案，把要改的字段放进 updates；只是聊天/问答就把 updates 留空 {}。',
    'reply 是给老板看的人话，简短口语：说清你做了什么，或者还差什么资料才能做。',
    '只输出一个 JSON 对象，不要代码块标记、不要额外解释。',
    '输出结构：{"reply":"给老板的话","updates":{"字段名":"新值"},"missing":"还缺什么，没有就空字符串"}',
    'updates 的字段名只能用这些：identity,business,audience,brand,pains,proof,cta,voice,tone,avoid,keywords,sample,videoFormat,editStyle,visualStyle,audioStyle,outroTemplate。',
    '剪辑与视觉规范字段（videoFormat/editStyle/visualStyle/audioStyle/outroTemplate/keywords）用于指导 AI 剪视频与加字幕/花字/调色/BGM，老板让你给默认剪辑方案时可直接给出实用建议并写入。',
    'sample 就是「范例口播」那格。老板嘴里的「示例」「范例」「口播样例」都指这一格。老板贴了满意的口播就原样收进去；老板不会写、想要个示例时，你就根据档案已有的身份/主营/卖点 + 行业常识，现写一段口播样例给他照着改——这是模板不是事实，放开写，短一点、像真人讲话、结尾带个动作。',
  ].join('\n')
  const history = input.history
    .slice(-8)
    .map((item) => `${item.role === 'user' ? '老板' : '助手'}：${item.text}`)
    .join('\n')
  const user = [
    `公司：${input.spaceName}`,
    '',
    '当前档案（空的就是还没填）：',
    JSON.stringify(input.brief, null, 0),
    '',
    '资料库（老板之前给的资料，最新在前）：',
    input.knowledge ? input.knowledge.slice(0, 12000) : '（还没有资料）',
    '',
    history ? `之前的对话：\n${history}\n` : '',
    `老板现在说：${input.message}`,
  ].join('\n')
  return { system, user }
}

/** 把对话回复收成 {reply, updates, missing}。 */
export function normalizeBriefChat(value: unknown): { reply: string; updates: Partial<ClientBrief>; missing: string } {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const reply = clip(row.reply, 400)
  const updatesRaw = row.updates && typeof row.updates === 'object' ? (row.updates as Record<string, unknown>) : {}
  const updates: Partial<ClientBrief> = {}
  for (const [key, max] of Object.entries(LIMITS)) {
    const text = clip(updatesRaw[key], max, MULTILINE.has(key))
    if (text) (updates as Record<string, string>)[key] = text
  }
  const missing = clip(row.missing, 200)
  return { reply, updates, missing }
}
