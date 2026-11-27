/**
 * 能力清单（运行时生成）：「主页」直接读插件自己注册了什么，不依赖任何预生成文件。
 *
 * - 工具：注册时由 trackTool 记下来（见 index.ts），所以永远是当前这份代码里的真实工具
 * - 技能：扫插件包 skills/ 与 ~/.dsh/skills/，顺手对比是否已同步
 * - 花字：调 listLocalTextStyles()（Python 现画能力检测）+ 从 render.py 抓中文别名
 * - 音效：调 sfxCatalogForAgent()
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type ToolRow = { name: string; desc: string; group: string }
export type StyleRow = { id: string; label: string; note: string; calls: string[] }
export type SfxRow = { id: string; use: string; dur: number; gain: number }
export type SkillRow = {
  title: string
  brief: string
  rest: string
  origin: string
  rules: number
  internal: boolean
  synced: boolean | null
}

/** 工具分组：和 scripts/list-capabilities.mjs 保持同一套规则。 */
const GROUPS: Array<[string, RegExp]> = [
  ['引擎 / 草稿', /^dh_(engine|create_draft|list_drafts|load_draft|save_draft|export_draft|export_status|get_workspace|get_brief|update_brief)/],
  ['素材入库', /^dh_(ingest|label_materials|list_materials|media_ingest_status)/],
  ['时间线', /^dh_(add_video|add_audio|add_music|set_music|set_voice|add_narration|add_text|add_sfx|own_text|list_music|find_music)/],
  ['花字 / 包装', /^dh_(add_local_styled_text|render_local_styled_text|list_local_text_styles|list_native_text_effects|list_sfx)/],
  ['配音', /^dh_(list_voices|clone_voice)/],
  ['数字人', /^dh_avatar/],
  ['发布', /^dh_(publish|prepare_publication)/],
  ['平台抓取 / 分析', /^dh_(platform|comment_wordcloud|mediacrawler)/],
]

export function groupOfTool(name: string): string {
  return (GROUPS.find(([, re]) => re.test(name)) || ['其他'])[0]
}

function frontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
  }
  return out
}

function collectSkills(dir: string, origin: string): Array<SkillRow & { dir: string }> {
  if (!existsSync(dir)) return []
  const rows: Array<SkillRow & { dir: string }> = []
  for (const name of readdirSync(dir)) {
    if (name.includes('.bak')) continue
    try {
      if (!statSync(join(dir, name)).isDirectory()) continue
    } catch {
      continue
    }
    const file = join(dir, name, 'SKILL.md')
    if (!existsSync(file)) continue
    const meta = frontmatter(readFileSync(file, 'utf8'))
    const rulesDir = join(dir, name, 'rules')
    const rules = existsSync(rulesDir) ? readdirSync(rulesDir).filter(f => f.endsWith('.md')).length : 0
    const desc = (meta.description || '').replace(/^["']|["']$/g, '')
    const cut = desc.search(/[。.；;]/)
    rows.push({
      dir: name,
      title: meta.name || name,
      brief: cut > 0 ? desc.slice(0, cut) : desc.slice(0, 40),
      rest: cut > 0 ? desc.slice(cut + 1).trim() : '',
      origin,
      rules,
      internal: meta['user-invocable'] === 'false',
      synced: null,
    })
  }
  return rows
}

/** 从 render.py 的 STYLE_ALIASES 抓中文名 → 样式 id。文件随包发布，缺了就当没有。 */
function styleAliases(pluginRoot: string): Record<string, string[]> {
  const file = join(pluginRoot, 'tools', 'local-styled-text', 'render.py')
  const out: Record<string, string[]> = {}
  try {
    const src = readFileSync(file, 'utf8')
    const block = src.match(/STYLE_ALIASES = \{([\s\S]*?)\n\}/)
    if (!block) return out
    const re = /"([^"]+)":\s*"([a-z0-9_]+)"/g
    let hit: RegExpExecArray | null
    while ((hit = re.exec(block[1]))) (out[hit[2]] ||= []).push(hit[1])
  } catch {
    void 0
  }
  return out
}

export function buildCapabilities(
  pluginRoot: string,
  tools: Array<{ name: string; desc: string }>,
  styles: StyleRow[],
  sfx: SfxRow[],
) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const repoSkills = collectSkills(join(pluginRoot, 'skills'), '插件包')
  const installed = collectSkills(join(dshHome, 'skills'), '桌面已装')
  const installedDirs = new Set(installed.map(s => s.dir))
  for (const s of repoSkills) s.synced = installedDirs.has(s.dir)
  const skills: SkillRow[] = [
    ...repoSkills.map(({ dir: _dir, ...rest }) => rest),
    ...installed.filter(s => !repoSkills.some(r => r.dir === s.dir)).map(({ dir: _dir, ...rest }) => rest),
  ]

  const aliases = styleAliases(pluginRoot)
  const styleRows: StyleRow[] = styles.map(s => ({ ...s, calls: s.calls && s.calls.length ? s.calls : (aliases[s.id] || []) }))
  const toolRows: ToolRow[] = tools.map(t => ({ ...t, group: groupOfTool(t.name) }))

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    version: '',
    stats: { skills: skills.length, tools: toolRows.length, styles: styleRows.length, sfx: sfx.length },
    skills,
    tools: toolRows,
    styles: styleRows,
    sfx,
  }
}
