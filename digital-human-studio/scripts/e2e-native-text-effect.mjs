#!/usr/bin/env node
/**
 * Isolated E2E for native editable text + text_effect ref.
 * Mirrors dh_add_text validation/payload → local 9001 → save/finalize.
 * Never writes Movies/Containers/Jianying Projects.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync, createWriteStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DH = join(__dirname, '..')
const ART = join(DH, 'artifacts', 'isolated-native-texteffect-demo')
const OUT = join(ART, 'out')
const FIX = join(ART, 'fixtures')

for (const bad of [ART, OUT]) {
  if (String(bad).includes('/Movies/') || String(bad).includes('/Containers/') || String(bad).includes('JianyingPro')) {
    throw new Error('refusing unsafe path ' + bad)
  }
}
rmSync(ART, { recursive: true, force: true })
mkdirSync(FIX, { recursive: true })
mkdirSync(OUT, { recursive: true })

const {
  listNativeTextEffects,
  resolveNativeFlowerEffectId,
  resolveNativeBubbleIds,
  isNativePlatformEffectId,
} = await import(pathToFileURL(join(DH, 'dist/native-text-effects.js')).href)
const { processSaveDraftResponse } = await import(pathToFileURL(join(DH, 'dist/save-draft-result.js')).href)
const { finalizeSavedDraftAssets } = await import(pathToFileURL(join(DH, 'dist/draft-save-finalize.js')).href)

const report = { tests: [], warnings: [] }
function pass(name, detail) {
  report.tests.push({ name, ok: true, detail })
  console.log('PASS', name, detail ? JSON.stringify(detail).slice(0, 180) : '')
}
function fail(name, err) {
  report.tests.push({ name, ok: false, error: String(err) })
  console.error('FAIL', name, err)
  throw err instanceof Error ? err : new Error(String(err))
}

// --- validation unit cases ---
{
  const empty = resolveNativeFlowerEffectId('')
  assert.equal(empty.ok, true)
  assert.equal(empty.id, undefined)
  pass('empty_effect_id_ok_means_plain_text')

  const badFmt = resolveNativeFlowerEffectId('effect_cloud_abc-uuid')
  assert.equal(badFmt.ok, false)
  pass('reject_non_digit_cloudish_id', { error: badFmt.error })

  const short = resolveNativeFlowerEffectId('12345')
  assert.equal(short.ok, false)
  pass('reject_short_flower_id', { error: short.error })

  const listed = listNativeTextEffects({ kind: 'text_effect' })
  assert.ok(listed.effects.length >= 3)
  pass('list_catalog', { count: listed.effects.length })

  const prefer = listed.effects.find((e) => e.vip === false) || listed.effects[0]
  const okId = resolveNativeFlowerEffectId(prefer.id)
  assert.equal(okId.ok, true)
  pass('accept_catalog_flower_id', { id: okId.id, vip: prefer.vip })

  const bubBad = resolveNativeBubbleIds({ bubble_effect_id: '361595', bubble_resource_id: '' })
  assert.equal(bubBad.ok, false)
  pass('reject_bubble_half_pair')
}

// --- fixtures ---
const bg = join(FIX, 'bg.mp4')
const ff = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#1a1a2e:s=720x1280:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', bg], { encoding: 'utf8' })
if (ff.status !== 0) fail('ffmpeg_bg', ff.stderr || ff.error)
pass('synthetic_bg')

async function vc(path, body) {
  const res = await fetch('http://127.0.0.1:9001' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

// health
{
  const h = await vc('/get_font_types')
  assert.equal(h.status, 200)
  pass('9001_health')
}

// create
const created = await vc('/create_draft', { width: 720, height: 1280 })
assert.equal(created.data?.success, true)
const draftId = created.data.output.draft_id
assert.ok(draftId)
pass('create_draft', { draftId })

// add video
const vid = await vc('/add_video', {
  draft_id: draftId,
  video_url: bg,
  start: 0,
  end: 3,
  width: 720,
  height: 1280,
})
assert.equal(vid.data?.success, true, JSON.stringify(vid.data).slice(0, 200))
pass('add_video')

/** Mirror dh_add_text handler validation + payload */
async function addNativeTextLike(args) {
  const flower = resolveNativeFlowerEffectId(args.effect_effect_id)
  if (!flower.ok) return { success: false, error: flower.error, phase: 'validate' }
  const bubble = resolveNativeBubbleIds({
    bubble_effect_id: args.bubble_effect_id,
    bubble_resource_id: args.bubble_resource_id,
  })
  if (!bubble.ok) return { success: false, error: bubble.error, phase: 'validate' }
  const payload = {
    draft_id: draftId,
    text: String(args.text).trim().slice(0, 80),
    font_size: args.font_size ?? 8.0,
    font_color: args.font_color || '#ffffff',
    shadow_enabled: !!args.shadow_enabled,
    border_width: args.border_width ?? 0,
    start: args.start ?? 0,
    end: args.end ?? 3,
    transform_y: args.transform_y ?? -0.8,
    track_name: args.track_name || 'text_main',
  }
  if (args.intro_animation) payload.intro_animation = args.intro_animation
  if (flower.id) payload.effect_effect_id = flower.id
  if (bubble.bubble_effect_id) {
    payload.bubble_effect_id = bubble.bubble_effect_id
    payload.bubble_resource_id = bubble.bubble_resource_id
  }
  const r = await vc('/add_text', payload)
  return {
    success: !!r.data?.success,
    error: r.data?.error,
    data: r.data,
    flower,
    payload,
  }
}

// invalid id via handler-like path must fail before/at validation
{
  const bad = await addNativeTextLike({ text: '坏ID', effect_effect_id: 'not-a-digit-id', start: 0, end: 1, track_name: 'bad' })
  assert.equal(bad.success, false)
  assert.equal(bad.phase, 'validate')
  pass('handler_reject_bad_id', { error: bad.error })
}

// plain native text (no effect)
{
  const plain = await addNativeTextLike({
    text: '大象商城',
    font_size: 10,
    font_color: '#ffffff',
    shadow_enabled: true,
    border_width: 40,
    transform_y: -0.35,
    start: 0.2,
    end: 2.8,
    track_name: 'plain_native',
    intro_animation: 'Fade_In',
  })
  assert.equal(plain.success, true, JSON.stringify(plain).slice(0, 300))
  pass('add_plain_native_text')
}

// flower ref — prefer non-VIP catalog entry; fall back to GuanYixuan demo id
const flowerPick =
  listNativeTextEffects({ kind: 'text_effect' }).effects.find((e) => e.vip === false)?.id ||
  '7296357486490144036'
report.flowerPick = flowerPick
report.flowerMeta = listNativeTextEffects({ kind: 'text_effect' }).effects.find((e) => e.id === flowerPick)

{
  const flower = await addNativeTextLike({
    text: '原生可编辑花字',
    font_size: 12,
    font_color: '#ffff00',
    transform_y: -0.65,
    start: 0.4,
    end: 2.8,
    track_name: 'flower_native',
    effect_effect_id: flowerPick,
  })
  assert.equal(flower.success, true, JSON.stringify(flower).slice(0, 400))
  assert.equal(flower.payload.effect_effect_id, flowerPick)
  pass('add_native_text_with_text_effect', { id: flowerPick, warning: flower.flower.warning })
  report.warnings.push(flower.flower.warning)
}

// save isolated
const projectName = 'native_texteffect_demo'
const save = await vc('/save_draft', {
  draft_id: draftId,
  draft_folder: OUT,
  project_name: projectName,
  auto_deploy: false,
})
assert.equal(save.data?.success, true, JSON.stringify(save.data).slice(0, 400))
pass('save_draft_auto_deploy_false')

const shaped = await processSaveDraftResponse({
  xiaocongcutData: save.data,
  draftId,
  projectName,
  draftFolder: OUT,
  allowRoots: [OUT],
  finalizeFn: finalizeSavedDraftAssets,
})
assert.equal(shaped.saved, true)
assert.ok(!JSON.stringify(shaped).includes('undefined'))
pass('handler_lossless_finalize', {
  draft_url: shaped.draft_url || shaped.path || shaped.output,
  assetCheck: shaped.assetCheck || shaped.finalize,
})

const draftDir = shaped.draft_url || shaped.path || join(OUT, projectName)
const draftPath = typeof draftDir === 'string' ? draftDir : join(OUT, projectName)
assert.ok(existsSync(draftPath), draftPath)
assert.ok(!draftPath.includes('/Movies/'))
assert.ok(!draftPath.includes('/Containers/'))
pass('path_safe_not_movies', { draftPath })

const infoPath = existsSync(join(draftPath, 'draft_info.json'))
  ? join(draftPath, 'draft_info.json')
  : join(draftPath, 'draft_content.json')
const info = JSON.parse(readFileSync(infoPath, 'utf8'))
const texts = info.materials?.texts || []
const effects = (info.materials?.effects || []).filter((e) => e.type === 'text_effect')
const textBlob = JSON.stringify(texts)
assert.ok(texts.length >= 2, 'need >=2 text materials')
assert.ok(textBlob.includes('大象商城'), 'plain text content missing')
assert.ok(textBlob.includes('原生可编辑花字'), 'flower text content missing')
assert.ok(effects.length >= 1, 'text_effect material missing')
assert.ok(effects.some((e) => String(e.effect_id) === flowerPick || String(e.resource_id) === flowerPick))
pass('structure_texts_and_text_effect', {
  texts: texts.length,
  text_effects: effects.length,
  effect_ids: effects.map((e) => e.effect_id),
  mirrors: {
    draft_content: existsSync(join(draftPath, 'draft_content.json')),
    draft_info: existsSync(join(draftPath, 'draft_info.json')),
  },
})

// ownership: company-ish — materials under draft assets if video copied
const videos = info.materials?.videos || []
for (const v of videos) {
  if (v.path) assert.ok(String(v.path).includes(draftPath) || existsSync(v.path))
}
pass('media_paths_present', { videos: videos.length })

// zip
const zipPath = join(ART, 'native_texteffect_demo.zip')
const zip = spawnSync('zip', ['-r', '-q', zipPath, projectName], { cwd: OUT, encoding: 'utf8' })
if (zip.status !== 0) {
  // fallback: zip from ART including out/
  const zip2 = spawnSync('zip', ['-r', '-q', zipPath, 'out/' + projectName], { cwd: ART, encoding: 'utf8' })
  assert.equal(zip2.status, 0, zip2.stderr)
}
assert.ok(existsSync(zipPath))
pass('zip_created', { zipPath, bytes: readFileSync(zipPath).length })

const readme = `# 原生可编辑文字 + text_effect 演示草稿

## 这是什么
独立隔离草稿（\`auto_deploy:false\`），含：
1. **普通原生文字**「大象商城」—— \`materials.texts\` 明文，可在剪映改字
2. **原生花字引用**「原生可编辑花字」—— 同为 \`materials.texts\` 明文 + \`materials.effects\` 中 \`type=text_effect\`，\`effect_id=${flowerPick}\`

不是 PNG 叠层，不是 Xiaocongcut 云端 Effect 编码。

## 花字 ID 来源与边界
- 选用 ID：\`${flowerPick}\`
- 目录说明：见工具 \`dh_list_native_text_effects\` / 源码 \`src/native-text-effects.ts\`
- VIP/本机缓存：**未在本机剪映 UI 验证**；打开草稿时剪映**可能联网下载**效果包
- 未打包任何会员资产；开源库仅提供数字 ID 引用

## 如何导入（最短验收）
1. 解压 zip，得到草稿文件夹 \`${projectName}\`
2. **手动**复制到你的剪映草稿根目录（本包故意未写入 Movies/Containers）
3. 重启或刷新剪映草稿列表后打开
4. 检查：两段文字是否仍是文字轨道（可双击改字）；花字段是否带效果（若提示加载失败=需联网/会员/缓存）
5. **UI 可编辑性与视觉效果：本会话未打开剪映验证**

## 工具对照
| 工具 | 类型 |
|---|---|
| \`dh_add_text\` | 原生可编辑文字；可选 \`effect_effect_id\`（纯数字平台 ID） |
| \`dh_list_native_text_effects\` | 公开源码核实过的 ID 目录 |
| \`dh_add_local_styled_text\` | 本地 PNG 风格叠层，**不能**当原生文字改 |

## 安全
输出仅在工程 \`artifacts/isolated-native-texteffect-demo/\`，未触碰真实剪映 Projects。
`

writeFileSync(join(ART, 'README.md'), readme, 'utf8')
writeFileSync(join(ART, 'e2e-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log('DONE', JSON.stringify({ zipPath, draftPath, flowerPick, tests: report.tests.length }, null, 2))
