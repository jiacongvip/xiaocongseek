#!/usr/bin/env node
/**
 * 生成「插件能力清单」：技能 / 工具 / 数字人 / 花字 / 音效，全部从源文件实时读。
 *
 * 用法：
 *   node scripts/list-capabilities.mjs [输出路径] [--no-preview]
 *
 * 花字预览图靠 tools/local-styled-text/render.py 现画（需要 Python + Pillow），
 * 缺依赖时自动退化成纯文字卡片，不影响其余内容。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const noPreview = args.includes('--no-preview')
const jsonFlag = args.indexOf('--json')
const JSON_ARG = jsonFlag >= 0 ? (args[jsonFlag + 1] || '') : ''
const OUT = args.find((a, i) => !a.startsWith('--') && !(jsonFlag >= 0 && i === jsonFlag + 1))
  || join(ROOT, '..', '插件能力清单.html')
const DSH_SKILLS = join(process.env.DSH_HOME || join(process.env.HOME || '', '.dsh'), 'skills')
const read = p => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/* ═══ 技能 ═══════════════════════════════════════════ */
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const out = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
  }
  return out
}

function collectSkills(dir, origin) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => statSync(join(dir, name)).isDirectory() && !name.includes('.bak'))
    .map(name => {
      const file = join(dir, name, 'SKILL.md')
      if (!existsSync(file)) return null
      const meta = frontmatter(read(file))
      const rulesDir = join(dir, name, 'rules')
      const rules = existsSync(rulesDir) ? readdirSync(rulesDir).filter(f => f.endsWith('.md')) : []
      const desc = (meta.description || '').replace(/^["']|["']$/g, '')
      // 描述第一句当"触发场景"，剩下的折叠进详情
      const cut = desc.search(/[。.；;]/)
      return {
        dir: name,
        origin,
        title: meta.name || name,
        brief: cut > 0 ? desc.slice(0, cut) : desc.slice(0, 40),
        rest: cut > 0 ? desc.slice(cut + 1).trim() : '',
        internal: meta['user-invocable'] === 'false',
        rules,
      }
    })
    .filter(Boolean)
}

const repoSkills = collectSkills(join(ROOT, 'skills'), '插件包')
const installed = collectSkills(DSH_SKILLS, '桌面已装')
const installedByDir = new Map(installed.map(s => [s.dir, s]))
for (const s of repoSkills) s.synced = installedByDir.has(s.dir)
const allSkills = [...repoSkills, ...installed.filter(s => !repoSkills.some(r => r.dir === s.dir))]

/* ═══ 工具 ═══════════════════════════════════════════ */
const tools = []
{
  const src = read(join(ROOT, 'src', 'index.ts'))
  const re = /name: '(dh_[a-z_0-9]+)',\s*\n\s*description:\s*\n?\s*'((?:[^'\\]|\\.)*)'/g
  let hit
  while ((hit = re.exec(src))) {
    const desc = hit[2].replace(/\\'/g, "'").replace(/\s+/g, ' ').trim()
    tools.push({ name: hit[1], desc })
  }
}
const GROUPS = [
  ['引擎 / 草稿', /^dh_(engine|create_draft|list_drafts|load_draft|save_draft|export_draft|export_status|get_workspace|get_brief|update_brief)/],
  ['素材入库', /^dh_(ingest|label_materials|list_materials|media_ingest_status)/],
  ['时间线', /^dh_(add_video|add_audio|add_music|set_music|set_voice|add_narration|add_text|add_sfx|own_text|list_music|find_music)/],
  ['花字 / 包装', /^dh_(add_local_styled_text|render_local_styled_text|list_local_text_styles|list_native_text_effects|list_sfx)/],
  ['配音', /^dh_(list_voices|clone_voice)/],
  ['数字人', /^dh_avatar/],
  ['发布', /^dh_(publish|prepare_publication)/],
  ['平台抓取 / 分析', /^dh_(platform|comment_wordcloud|mediacrawler)/],
]
const groupOf = name => (GROUPS.find(([, re]) => re.test(name)) || ['其他'])[0]
const grouped = new Map()
for (const t of tools) {
  const g = groupOf(t.name)
  if (!grouped.has(g)) grouped.set(g, [])
  grouped.get(g).push(t)
}

/* ═══ 花字 ═══════════════════════════════════════════ */
const renderPy = read(join(ROOT, 'tools', 'local-styled-text', 'render.py'))
const styles = []
{
  const block = renderPy.match(/^STYLES = \{([\s\S]*?)\n\}/m)
  if (block) {
    // 缩进不统一（有个 4 空格的），按"遇到新条目就切段"
    for (const chunk of block[1].split(/^\s{2,6}(?="[a-z0-9_]+":\s*\{)/m).slice(1)) {
      const id = (chunk.match(/^"([a-z0-9_]+)":/) || [])[1]
      if (!id) continue
      styles.push({
        id,
        label: (chunk.match(/"label":\s*"([^"]*)"/) || [])[1] || '',
        note: (chunk.match(/"note":\s*"([^"]*)"/) || [])[1] || '',
      })
    }
  }
}
const aliases = {}
{
  const block = renderPy.match(/STYLE_ALIASES = \{([\s\S]*?)\n\}/)
  if (block) {
    const re = /"([^"]+)":\s*"([a-z0-9_]+)"/g
    let hit
    while ((hit = re.exec(block[1]))) (aliases[hit[2]] ||= []).push(hit[1])
  }
}
for (const s of styles) s.calls = aliases[s.id] || []

/* 花字预览：调 render.py 现画，失败就跳过 */
const PREVIEW_DIR = join(tmpdir(), 'dsh-capability-previews')
const previewScript = `
import importlib.util, sys, json
from PIL import Image
spec = importlib.util.spec_from_file_location("r", sys.argv[1])
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
outdir, text = sys.argv[2], sys.argv[3]
ok = []
for sid in r.STYLES:
    t = "" if sid == "check_mark" else text
    try:
        img = r.render_style(t, sid, width=460, height=150, font_size=54)
        bg = Image.new("RGB", img.size, (242, 243, 246))
        bg.paste(img, (0, 0), img if img.mode == "RGBA" else None)
        bg.save(f"{outdir}/{sid}.png", optimize=True)
        ok.append(sid)
    except Exception:
        pass
print(json.dumps(ok))
`
let previews = {}
if (!noPreview && styles.length) {
  try {
    mkdirSync(PREVIEW_DIR, { recursive: true })
    const py = ['python3', '/usr/bin/python3'].find(p => p === 'python3' || existsSync(p))
    const out = execFileSync(py, ['-c', previewScript, join(ROOT, 'tools', 'local-styled-text', 'render.py'), PREVIEW_DIR, '这面墙别刷白'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 120000,
    })
    for (const id of JSON.parse(out.trim().split('\n').pop())) {
      const file = join(PREVIEW_DIR, `${id}.png`)
      if (existsSync(file)) previews[id] = readFileSync(file).toString('base64')
    }
  } catch {
    previews = {}
  }
}

/* ═══ 音效 ═══════════════════════════════════════════ */
let sfx = []
{
  const raw = read(join(ROOT, 'assets', 'sfx', 'manifest.json'))
  if (raw) {
    try { sfx = JSON.parse(raw).items || [] } catch { sfx = [] }
  }
}
const maxDur = Math.max(...sfx.map(s => Number(s.dur) || 0), 1)

/* ═══ 渲染 ═══════════════════════════════════════════ */
const pkg = JSON.parse(read(join(ROOT, 'package.json')) || '{}')
const now = new Date().toLocaleString('zh-CN', { hour12: false })

const skillRows = allSkills.map(s => {
  const sync = s.origin === '插件包'
    ? (s.synced ? '<span class="ok">✓ 已同步</span>' : '<span class="bad">未同步</span>')
    : '<span class="dim">—</span>'
  return `<tr data-key="${esc(s.title)} ${esc(s.brief)} ${esc(s.origin)}">
    <td>
      <div class="ttl"><code>${esc(s.title)}</code>${s.internal ? '<span class="chip">内部</span>' : ''}</div>
      <div class="desc">${esc(s.brief)}</div>
      ${s.rest ? `<details><summary>更多</summary><div class="desc">${esc(s.rest)}</div></details>` : ''}
    </td>
    <td><span class="chip">${esc(s.origin)}</span></td>
    <td class="center">${s.rules.length || '<span class="dim">—</span>'}</td>
    <td class="center">${sync}</td>
  </tr>`
}).join('\n')

const toolBlocks = [...grouped.entries()].map(([g, list]) => `
  <div class="tgroup" data-group="${esc(g)}">
    <div class="tgroup-h">${esc(g)}<span class="count">${list.length}</span></div>
    <table class="mini"><tbody>
      ${list.map(t => `<tr data-key="${esc(t.name)} ${esc(t.desc)}"><td class="name"><code>${esc(t.name)}</code></td><td class="desc">${esc(t.desc)}</td></tr>`).join('\n')}
    </tbody></table>
  </div>
`).join('\n')

const avatarTools = tools.filter(t => /^dh_avatar/.test(t.name))
const avatarRows = avatarTools.map(t => {
  let model = (t.desc.match(/\((xdh-[a-z-]+)\)/) || t.desc.match(/(\/v1\/[a-z/]+)/) || [])[1]
  if (!model) model = /task/.test(t.name) ? '网关任务池' : '—'
  return `<tr data-key="${esc(t.name)} ${esc(model)} ${esc(t.desc)}">
    <td class="name"><code>${esc(t.name)}</code></td>
    <td><code class="model">${esc(model)}</code></td>
    <td class="desc">${esc(t.desc.replace(/^Digital Human Studio:\s*/, ''))}</td>
  </tr>`
}).join('\n')

const styleCards = styles.map(s => {
  const img = previews[s.id]
  return `<figure class="style-card" data-key="${esc(s.id)} ${esc(s.label)} ${esc(s.calls.join(' '))}">
    ${img
      ? `<img src="data:image/png;base64,${img}" alt="${esc(s.label)}" loading="lazy">`
      : '<div class="no-preview">无预览</div>'}
    <figcaption>
      <b>${esc(s.label)}</b>
      <code>${esc(s.id)}</code>
      <div class="alias">${s.calls.length ? s.calls.slice(0, 3).map(c => `<span class="chip">${esc(c)}</span>`).join('') : '<span class="bad">无中文名</span>'}</div>
    </figcaption>
  </figure>`
}).join('\n')

const sfxRows = sfx.map(s => {
  const w = Math.max(4, Math.round((Number(s.dur) / maxDur) * 100))
  return `<tr data-key="${esc(s.id)} ${esc(s.use || '')}">
    <td class="name"><code>${esc(s.id)}</code></td>
    <td class="desc">${esc(s.use || '')}</td>
    <td class="dur"><span class="bar" style="width:${w}%"></span><span class="num">${s.dur}s</span></td>
    <td class="center num">${s.gain}</td>
  </tr>`
}).join('\n')

const nav = [
  ['skills', '技能', allSkills.length],
  ['tools', '工具', tools.length],
  ['avatar', '数字人', avatarTools.length],
  ['styles', '花字', styles.length],
  ['sfx', '音效', sfx.length],
].map(([id, label, n]) => `<button class="tab${id === 'skills' ? ' is-on' : ''}" type="button" role="tab" data-goto="${id}">${label}<span class="n">${n}</span></button>`).join('')

const gchips = [['all', '全部', tools.length], ...[...grouped.entries()].map(([g, list]) => [g, g, list.length])]
  .map(([id, label, n], i) => `<button class="gchip${i === 0 ? ' is-on' : ''}" type="button" data-group="${esc(id)}">${esc(label)}<span class="dim"> ${n}</span></button>`)
  .join('')

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>数字人工作室 · 能力清单</title>
<style>
  :root {
    --ink:#16181c; --sub:#6a6f77; --line:#e4e6ea; --bg:#f7f8fa; --card:#fff;
    --accent:#0b62d0; --ok:#137a4b; --bad:#b4362b; --chip:#f1f2f5;
    --shadow:0 1px 2px rgba(16,18,22,.04), 0 4px 14px rgba(16,18,22,.05);
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e9eaee; --sub:#9aa0a9; --line:#2a2d33; --bg:#131417; --card:#1b1d21;
            --accent:#6ea8ff; --ok:#5fd39a; --bad:#ff8b7d; --chip:#26292f;
            --shadow:0 1px 2px rgba(0,0,0,.4), 0 6px 20px rgba(0,0,0,.35); }
  }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; scroll-padding-top:72px; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.65 -apple-system,"PingFang SC","Helvetica Neue",Inter,sans-serif;
    -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1080px; margin:0 auto; padding:0 28px 80px; }

  header { padding:44px 0 8px; }
  h1 { font-size:28px; margin:0 0 6px; letter-spacing:-.025em; font-weight:650; }
  .meta { color:var(--sub); font-size:13px; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:24px 0 0; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:12px;
          padding:14px 16px; box-shadow:var(--shadow); }
  .stat b { display:block; font-size:26px; line-height:1.1; font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
  .stat span { color:var(--sub); font-size:12px; }

  nav { position:sticky; top:0; z-index:10; margin:22px 0 0; padding:10px 0;
        background:color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter:blur(8px); }
  nav .inner { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  nav { border-bottom:1px solid var(--line); }
  nav .tabs { display:flex; gap:2px; flex-wrap:wrap; }
  nav .tab { appearance:none; background:transparent; border:0; border-bottom:2px solid transparent;
             font:inherit; font-size:13.5px; font-weight:500; color:var(--sub);
             cursor:pointer; padding:7px 12px; margin-bottom:-1px;
             display:inline-flex; align-items:center; gap:6px; }
  nav .tab:hover { color:var(--ink); }
  nav .tab.is-on { color:var(--accent); border-bottom-color:var(--accent); font-weight:600; }
  nav .tab .n { font-size:11px; font-variant-numeric:tabular-nums; color:var(--sub);
                background:var(--chip); border-radius:20px; padding:0 6px; line-height:16px; }
  nav .tab.is-on .n { color:var(--accent); background:color-mix(in srgb, var(--accent) 14%, transparent); }
  nav .tab.dim { opacity:.45; }

  .tabpanel { display:none; }
  .tabpanel.is-on { display:block; }
  .no-hit { color:var(--sub); font-size:13px; padding:20px 0; }
  .gchips { display:flex; gap:6px; flex-wrap:wrap; margin:0 0 12px; }
  .gchip { appearance:none; font:inherit; font-size:12.5px; color:var(--ink); cursor:pointer;
           background:var(--card); border:1px solid var(--line); border-radius:20px; padding:3px 10px; }
  .gchip:hover { border-color:var(--accent); }
  .gchip.is-on { border-color:var(--accent); color:var(--accent);
                 background:color-mix(in srgb, var(--accent) 8%, transparent); }
  nav input { margin-left:auto; width:210px; padding:6px 12px; border-radius:20px;
              border:1px solid var(--line); background:var(--card); color:var(--ink); font-size:13px; }
  nav input:focus { outline:2px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset:1px; }

  section { margin:38px 0 0; }
  .sec-h { display:flex; align-items:baseline; gap:10px; margin:0 0 3px; }
  h2 { font-size:18px; margin:0; letter-spacing:-.01em; }
  .sec-n { color:var(--sub); font-size:12px; }
  .hint { color:var(--sub); font-size:13px; margin:0 0 14px; }

  .panel { background:var(--card); border:1px solid var(--line); border-radius:12px;
           box-shadow:var(--shadow); overflow:hidden; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-weight:600; font-size:11.5px; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap;
       color:var(--sub); padding:9px 14px; background:var(--chip); border-bottom:1px solid var(--line); }
  td { padding:11px 14px; border-bottom:1px solid var(--line); vertical-align:top; }
  tr:last-child td { border-bottom:0; }
  tbody tr:hover td { background:color-mix(in srgb, var(--accent) 4%, transparent); }
  .ttl { display:flex; align-items:center; gap:8px; margin-bottom:1px; }
  .desc { color:var(--sub); font-size:13px; line-height:1.55; }
  .center { text-align:center; }
  td.center { white-space:nowrap; }
  .dim { color:var(--sub); }
  .ok { color:var(--ok); font-size:12.5px; }
  .bad { color:var(--bad); font-size:12.5px; }
  code { font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
         background:var(--chip); padding:1.5px 5px; border-radius:5px; }
  code.model { color:var(--accent); }
  .chip { font-size:11px; color:var(--sub); border:1px solid var(--line);
          border-radius:20px; padding:0 7px; white-space:nowrap; }
  details { margin-top:4px; }
  summary { cursor:pointer; color:var(--accent); font-size:12.5px; list-style:none; }
  summary::-webkit-details-marker { display:none; }
  summary::before { content:"＋ "; }
  details[open] summary::before { content:"− "; }

  .tgroup + .tgroup { border-top:1px solid var(--line); }
  .tgroup-h { display:flex; align-items:center; gap:8px; padding:10px 14px; background:var(--chip);
              font-size:12px; font-weight:600; color:var(--sub); }
  .count { font-variant-numeric:tabular-nums; background:var(--card); border:1px solid var(--line);
           border-radius:20px; padding:0 7px; font-weight:500; }
  table.mini td { padding:8px 14px; border-bottom:1px solid var(--line); }
  table.mini tr:last-child td { border-bottom:0; }
  td.name { white-space:nowrap; width:1%; }

  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(232px,1fr)); gap:14px; }
  .style-card { margin:0; background:var(--card); border:1px solid var(--line); border-radius:12px;
                box-shadow:var(--shadow); overflow:hidden; }
  .style-card img { display:block; width:100%; height:110px; object-fit:contain; background:#f2f3f6; }
  .no-preview { height:110px; display:flex; align-items:center; justify-content:center;
                color:var(--sub); font-size:12px; background:var(--chip); }
  figcaption { padding:10px 12px 12px; }
  figcaption b { display:block; font-size:13.5px; font-weight:600; }
  figcaption code { display:inline-block; margin-top:3px; font-size:11px; }
  .alias { margin-top:7px; display:flex; gap:4px; flex-wrap:wrap; }

  .dur { position:relative; white-space:nowrap; }
  .bar { display:inline-block; height:5px; border-radius:3px; background:var(--accent);
         opacity:.28; vertical-align:middle; margin-right:8px; max-width:110px; }
  .num { font-variant-numeric:tabular-nums; color:var(--sub); font-size:12.5px; }

  footer { margin:52px 0 0; padding-top:18px; border-top:1px solid var(--line);
           color:var(--sub); font-size:12.5px; line-height:2; }
  .hidden { display:none !important; }
  @media (max-width:720px) {
    .stats { grid-template-columns:repeat(2,1fr); }
    nav input { width:100%; margin:6px 0 0; }
    .wrap { padding:0 16px 60px; }
  }
  @media print {
    nav, footer { display:none; }
    body { background:#fff; }
    .panel, .stat, .style-card { box-shadow:none; }
  }
</style></head>
<body>
<div class="wrap">
<header>
  <h1>数字人工作室 · 能力清单</h1>
  <div class="meta">${esc(pkg.name || 'digital-human-studio')} ${esc(pkg.version || '')} · 生成于 ${esc(now)} · 共 ${allSkills.length} 个技能 / ${tools.length} 个工具</div>
  <div class="stats">
    <div class="stat"><b>${allSkills.length}</b><span>技能</span></div>
    <div class="stat"><b>${tools.length}</b><span>工具</span></div>
    <div class="stat"><b>${styles.length}</b><span>花字样式</span></div>
    <div class="stat"><b>${sfx.length}</b><span>音效</span></div>
  </div>
</header>

<nav><div class="inner">
  <div class="tabs" role="tablist">${nav}</div>
  <input id="q" type="search" placeholder="筛工具 / 花字 / 音效…" autocomplete="off">
</div></nav>

<section id="skills" class="tabpanel is-on" data-panel="skills">
  <div class="sec-h"><h2>技能</h2><span class="sec-n">什么时候用、规矩写在这</span></div>
  <p class="hint">「插件包」是仓库源文件，改完要同步到 <code>~/.dsh/skills</code> 桌面才认。最后一列盯的就是这件事。</p>
  <div class="panel"><table>
    <thead><tr><th>技能</th><th>来源</th><th class="center">规则文件</th><th class="center">同步</th></tr></thead>
    <tbody>${skillRows}</tbody>
  </table></div>
  <p class="no-hit" hidden>没有匹配的技能</p>
</section>

<section id="tools" class="tabpanel" data-panel="tools">
  <div class="sec-h"><h2>工具</h2><span class="sec-n">模型能调的全部动作</span></div>
  <p class="hint">名字以 <code>dh_</code> 开头，按用途分组。想知道运行时是否可用，在对话里让它列工具即可。</p>
  <div class="gchips">${gchips}</div>
  <div class="panel">${toolBlocks}</div>
  <p class="no-hit" hidden>没有匹配的工具</p>
</section>

<section id="avatar" class="tabpanel" data-panel="avatar">
  <div class="sec-h"><h2>数字人制作</h2><span class="sec-n">能力在工具层，走网关 xdh-* 模型</span></div>
  <p class="hint">提交后交给 XiaocongAPI 异步跑，用 <code>dh_avatar_task</code> 查进度；状态依次 <code>SUBMITTED → QUEUED → IN_PROGRESS → SUCCESS / FAILURE</code>。形象音色读 <code>~/.dsh/digital-human-assets/library.json</code>。</p>
  <div class="panel"><table>
    <thead><tr><th>工具</th><th>模型 / 端点</th><th>作用</th></tr></thead>
    <tbody>${avatarRows}</tbody>
  </table></div>
  <p class="no-hit" hidden>没有匹配的接口</p>
</section>

<section id="styles" class="tabpanel" data-panel="styles">
  <div class="sec-h"><h2>花字样式</h2><span class="sec-n">共 ${styles.length} 种，含真实渲染预览</span></div>
  <p class="hint">灰底是渲染出来的实际效果，不是设计稿。调 <code>dh_add_local_styled_text</code> 时 <code>style</code> 传中文名或 id 都行。${Object.keys(previews).length ? '' : '<span class="bad">本次没生成预览图（缺 Python/Pillow）</span>'}</p>
  <div class="grid">${styleCards}</div>
  <p class="no-hit" hidden>没有匹配的花字</p>
</section>

<section id="sfx" class="tabpanel" data-panel="sfx">
  <div class="sec-h"><h2>音效</h2><span class="sec-n">共 ${sfx.length} 个，本地合成无版权</span></div>
  <p class="hint">先 <code>dh_list_sfx</code> 拿清单，再 <code>dh_add_sfx</code> 按秒铺点。条形越长表示越长，不是越响。</p>
  <div class="panel"><table>
    <thead><tr><th>id</th><th>用途</th><th>时长</th><th class="center">默认音量</th></tr></thead>
    <tbody>${sfxRows}</tbody>
  </table></div>
  <p class="no-hit" hidden>没有匹配的音效</p>
</section>

<footer>
  重新生成：双击工作区里的「查看能力清单.command」，或在包根执行 <code>node scripts/list-capabilities.mjs</code>（加 <code>--no-preview</code> 跳过画图，快很多）。<br>
  数据来源：<code>skills/*/SKILL.md</code>、<code>src/index.ts</code> 工具注册、<code>tools/local-styled-text/render.py</code>、<code>assets/sfx/manifest.json</code>。
</footer>
</div>
<script>
  const tabs = [...document.querySelectorAll('.tab')]
  const panels = [...document.querySelectorAll('.tabpanel')]
  const baseCount = new Map(tabs.map(t => [t.dataset.goto, Number(t.querySelector('.n').textContent)]))
  const q = document.getElementById('q')
  const groups = [...document.querySelectorAll('.tgroup')]
  const chips = [...document.querySelectorAll('.gchip')]
  let group = 'all'

  const show = (id, scroll) => {
    tabs.forEach(t => t.classList.toggle('is-on', t.dataset.goto === id))
    panels.forEach(p => p.classList.toggle('is-on', p.dataset.panel === id))
    if (history.replaceState) history.replaceState(null, '', '#' + id)
    if (scroll) window.scrollTo(0, 0)
  }
  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.goto, true)))
  chips.forEach(c => c.addEventListener('click', () => {
    group = c.dataset.group
    chips.forEach(x => x.classList.toggle('is-on', x === c))
    filter()
  }))

  const match = (el, k) => !k || (el.dataset.key || '').toLowerCase().includes(k)

  function filter() {
    const k = q.value.trim().toLowerCase()

    // 非工具区：技能 / 数字人 / 花字 / 音效
    document.querySelectorAll('.tabpanel:not(#tools) [data-key]').forEach(el => {
      el.classList.toggle('hidden', !match(el, k))
    })

    // 工具区：先按分组，再按关键字，组内无命中就整组隐藏
    groups.forEach(g => {
      const ok = group === 'all' || (g.dataset.group || '') === group
      const rows = [...g.querySelectorAll('tr')]
      rows.forEach(tr => tr.classList.toggle('hidden', !match(tr, k)))
      const hits = rows.filter(tr => !tr.classList.contains('hidden')).length
      g.classList.toggle('hidden', !ok || hits === 0)
    })

    // 每个 tab 的命中数
    const counts = {}
    panels.forEach(p => {
      counts[p.dataset.panel] = [...p.querySelectorAll('[data-key]')]
        .filter(el => !el.classList.contains('hidden')).length
    })
    tabs.forEach(t => {
      const id = t.dataset.goto
      t.querySelector('.n').textContent = k ? counts[id] : baseCount.get(id)
      t.classList.toggle('dim', !!k && !counts[id])
    })
    panels.forEach(p => {
      const empty = p.querySelector('.no-hit')
      if (empty) empty.hidden = !k || counts[p.dataset.panel] > 0
    })

    // 当前 tab 没结果时，自动跳到第一个有结果的
    if (k) {
      const cur = panels.find(p => p.classList.contains('is-on'))
      if (cur && !counts[cur.dataset.panel]) {
        const first = panels.find(p => counts[p.dataset.panel] > 0)
        if (first) show(first.dataset.panel)
      }
    }
  }

  q.addEventListener('input', filter)

  const init = decodeURIComponent((location.hash || '').replace('#', ''))
  show(panels.some(p => p.dataset.panel === init) ? init : 'skills', true)
</script>
</body></html>`

/* ═══ 结构化清单：插件「主页」读这个文件 ═══════════════ */
const capabilities = {
  generatedAt: new Date().toISOString(),
  version: pkg.version || '',
  stats: { skills: allSkills.length, tools: tools.length, styles: styles.length, sfx: sfx.length },
  skills: allSkills.map(s => ({
    title: s.title,
    brief: s.brief,
    rest: s.rest,
    origin: s.origin,
    rules: s.rules.length,
    internal: !!s.internal,
    synced: s.origin === '插件包' ? !!s.synced : null,
  })),
  tools: tools.map(t => ({ name: t.name, desc: t.desc, group: groupOf(t.name) })),
  styles: styles.map(s => ({ id: s.id, label: s.label, note: s.note || '', calls: s.calls || [] })),
  sfx: sfx.map(s => ({ id: s.id, use: s.use || '', dur: s.dur, gain: s.gain })),
}
const JSON_OUT = JSON_ARG || join(ROOT, 'dist', 'capabilities.json')
mkdirSync(dirname(JSON_OUT), { recursive: true })
writeFileSync(JSON_OUT, JSON.stringify(capabilities, null, 2))

/* 顺手把离线快照写进 lib/client.js：后端没重启（/capabilities 404）时主页也有东西可看 */
{
  const clientFile = join(ROOT, 'lib', 'client.js')
  const src = read(clientFile)
  const begin = '/* @capabilities:begin */'
  const end = '/* @capabilities:end */'
  const i = src.indexOf(begin)
  const j = src.indexOf(end)
  if (i >= 0 && j > i) {
    const slim = {
      generatedAt: capabilities.generatedAt,
      stats: capabilities.stats,
      skills: capabilities.skills.map(({ rest, ...keep }) => keep),
      tools: capabilities.tools,
      styles: capabilities.styles,
      sfx: capabilities.sfx,
    }
    const block = `${begin}\n    const CAPABILITY_SNAPSHOT = ${JSON.stringify(slim)}\n    ${end}`
    writeFileSync(clientFile, src.slice(0, i) + block + src.slice(j + end.length))
    console.log(`snapshot: lib/client.js (${Math.round(Buffer.byteLength(JSON.stringify(slim)) / 1024)} KB inline)`)
  }
}

writeFileSync(OUT, html)
const kb = Math.round(Buffer.byteLength(html) / 1024)
console.log(`技能 ${repoSkills.length}(插件包) + ${installed.length}(桌面) ｜工具 ${tools.length}｜花字 ${styles.length}（预览 ${Object.keys(previews).length}）｜音效 ${sfx.length}`)
console.log(`written: ${OUT} (${kb} KB)`)
console.log(`json:    ${JSON_OUT}`)
