import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const py = process.env.LOCAL_STYLED_TEXT_PYTHON || 'python3'
const script = join(root, 'tools/local-styled-text/render.py')
const home = mkdtempSync(join(tmpdir(), 'stx-'))
const png = join(home, 'a.png')
const mp4 = join(home, 'a.mp4')

let r = spawnSync(py, [script, '--check'], { encoding: 'utf8' })
assert.equal(r.status, 0, r.stderr)
r = spawnSync(py, [script, '--text', '本地花字', '--style', 'glow_neon', '--entrance', 'fade_in', '--out-png', png, '--out-mp4', mp4], { encoding: 'utf8' })
assert.equal(r.status, 0, r.stderr + r.stdout)
const out = JSON.parse(r.stdout.trim().split('\n').pop())
assert.equal(out.success, true)
assert.ok(existsSync(png))
assert.ok(existsSync(mp4))

r = spawnSync(py, [script, '--text', 'x', '--style', 'not_a_style', '--out-png', join(home, 'b.png')], { encoding: 'utf8' })
assert.notEqual(r.status, 0)

const mod = await import(pathToFileURL(join(root, 'dist/local-styled-text.js')).href)
const listed = mod.listLocalTextStyles()
assert.ok(listed.styles.length >= 4)
assert.equal(listed.honesty.includes('effect_effect_id'), true)
assert.equal(listed.runtime.ok, true)

const space = 'co_styletest1'
const rendered = mod.renderLocalStyledText({ spaceId: space, text: '渐变立体', style: 'emboss_3d', entrance: 'slide_up' })
assert.equal(rendered.success, true, rendered.error)
assert.equal(rendered.item.nativeEffectId, false)
assert.ok(existsSync(rendered.item.png))
assert.equal(mod.renderLocalStyledText({ spaceId: '../etc', text: 'x', style: 'glow_neon' }).success, false)

// dist index should expose new tool names as strings
import { readFileSync } from 'node:fs'
const dist = readFileSync(join(root, 'dist/index.js'), 'utf8')
for (const name of ['dh_list_local_text_styles','dh_render_local_styled_text','dh_add_local_styled_text','dh_add_text']) {
  assert.ok(dist.includes(name), name)
}
assert.ok(dist.includes('transition_duration'))

console.log('PASS local-styled-text renderer + module isolation/honesty + tool wiring strings')
rmSync(home, { recursive: true, force: true })
