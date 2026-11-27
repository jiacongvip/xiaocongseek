import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
const { pickMixcutMusic, musicChoiceMenu, mixcutMusicFile, MIXCUT_MUSIC } = await import('../dist/mixcut-music.js')

assert.equal(MIXCUT_MUSIC.length, 2)
assert.equal(pickMixcutMusic('热闹一点').id, 'lively')
assert.equal(pickMixcutMusic('稳一点').id, 'steady')
assert.equal(pickMixcutMusic('先不要'), 'none')
assert.equal(pickMixcutMusic(''), undefined)
assert.match(musicChoiceMenu(), /先不要/)
for (const item of MIXCUT_MUSIC) {
  const file = mixcutMusicFile(item)
  assert.equal(existsSync(file), true, file)
  assert.ok(item.volume >= 0.4 && item.volume <= 0.5)
}
console.log('mixcut-music tests ok')
