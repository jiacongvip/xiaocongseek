import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
const { listSfx, sfxItem, sfxPath, normalizeCues, sfxCatalogForAgent, SFX_DIR } = await import('../dist/sfx.js')

// 1. 清单能读到，且每个都指向真实文件
const items = listSfx()
assert.ok(items.length >= 27, `音效至少 27 个，实际 ${items.length}`)
assert.equal(items.length, 33, '当前应有 33 个')
for (const item of items) {
  assert.ok(existsSync(`${SFX_DIR}/${item.file}`), `${item.id} 的文件不存在：${item.file}`)
  assert.ok(item.dur > 0, `${item.id} 时长无效`)
  assert.ok(item.gain > 0 && item.gain <= 1, `${item.id} 默认音量应在 0~1`)
  assert.ok(item.use.length > 0, `${item.id} 缺少用途说明`)
}

// 2. 单个查询与路径解析
assert.equal(sfxItem('stamp')?.id, 'stamp')
assert.equal(sfxItem('nope'), undefined)
assert.ok(sfxPath('stamp')?.endsWith('stamp.wav'))
assert.equal(sfxPath('nope'), undefined)

// 3. 给模型的清单不带路径（避免模型自己拼路径）
const catalog = sfxCatalogForAgent()
assert.equal(catalog.length, items.length)
assert.ok(!('file' in catalog[0]), '清单不该暴露文件名')
assert.deepEqual(Object.keys(catalog[0]).sort(), ['dur', 'gain', 'id', 'use'])

// 4. 正常 cues：按时间排好序
const cues = normalizeCues([
  { at: 7.5, id: 'whoosh' },
  { at: 3.2, id: 'stamp' },
  { at: 12, id: 'ding', gain: 0.5 },
])
assert.deepEqual(cues.map(c => c.at), [3.2, 7.5, 12], '必须按时间升序')
assert.equal(cues[0].gain, undefined, '没传 gain 就保持 undefined，由调用方用 manifest 默认值')

// 5. 各种非法输入都要报清楚，不能静默吞掉
const bad = [
  [[], /不能为空/],
  [{ at: -1, id: 'stamp' }, /at 必须/],
  [{ at: 'abc', id: 'stamp' }, /at 必须/],
  [{ at: 1 }, /缺少 id/],
  [{ at: 1, id: 'wrong' }, /没有叫「wrong」/],
  [{ at: 1, id: 'stamp', gain: 'x' }, /gain 不是数字/],
]
for (const [input, pattern] of bad) {
  assert.throws(() => normalizeCues(Array.isArray(input) ? input : [input]), pattern)
}

// 6. gain 夹在 0~2：防止模型传 gain:10 把片子炸掉
const clamped = normalizeCues([
  { at: 1, id: 'hit', gain: 10 },
  { at: 2, id: 'blip', gain: -5 },
])
assert.equal(clamped[0].gain, 2)
assert.equal(clamped[1].gain, 0)

// 7. 上限：整片铺满音效不如不配
const tooMany = Array.from({ length: 201 }, (_, i) => ({ at: i * 0.5, id: 'tick' }))
assert.throws(() => normalizeCues(tooMany), /最多 200 个/)

// 8. 错误信息要能给模型指路（列出可用 id）
try {
  normalizeCues([{ at: 1, id: 'xxx' }])
  assert.fail('应该抛错')
} catch (error) {
  assert.ok(String(error.message).includes('stamp'), '报错里要带可用 id 列表，模型才能自我纠正')
}

console.log('sfx tests ok')
