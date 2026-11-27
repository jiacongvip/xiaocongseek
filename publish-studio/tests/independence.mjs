import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const home = mkdtempSync(join(tmpdir(), 'publish-studio-ind-'))
process.env.HOME = home
let network = 0
globalThis.fetch = async () => { network++; throw new Error('network forbidden') }

const root = fileURLToPath(new URL('..', import.meta.url))
function walk(dir, out=[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (['node_modules', 'dist', '.git', 'tests'].includes(name)) continue
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|js|mjs|py|json|md)$/.test(name)) out.push(p)
  }
  return out
}
const files = walk(root)
const banned = ['MediaPublishPlatform-main', '/postVideo', 'sau_backend/conf.py']
for (const file of files) {
  if (file.endsWith('migration-manifest.json') || file.endsWith('CAPABILITY-MATRIX.md') || file.endsWith('README.md') || file.endsWith('ENABLE.md')) continue
  const text = readFileSync(file, 'utf8')
  for (const b of banned) {
    // allow explanatory docs already skipped; runtime/source must not call/path to original GEO
    if (text.includes(b)) assert.fail(`forbidden marker ${b} in ${file}`)
  }
}

const exe = join(root, 'publishing/executor.py')
const dry = spawnSync('python3', [exe], {
  input: JSON.stringify({
    mode: 'dry-run',
    pluginVendorRoot: join(root, 'publishing/vendor/geo'),
    runtimeRoot: home,
  }),
  encoding: 'utf8',
  env: { ...process.env, HOME: home },
})
assert.equal(dry.status, 0, dry.stderr + dry.stdout)
const dryJson = JSON.parse(dry.stdout)
assert.equal(dryJson.executed, false)
assert.equal(dryJson.requiresOriginalGeoProcess, false)
assert.equal(dryJson.usedPostVideo, false)
assert.equal(dryJson.vendorPresent, true)

const blocked = spawnSync('python3', [exe], {
  input: JSON.stringify({
    mode: 'execute',
    pluginVendorRoot: join(root, 'publishing/vendor/geo'),
    runtimeRoot: home,
    video: join(home, 'missing.mp4'),
    cover: join(home, 'missing.png'),
    accountFile: join(home, 'missing.json'),
    platform: 'douyin',
  }),
  encoding: 'utf8',
  env: { ...process.env, HOME: home, PUBLISH_STUDIO_ALLOW_EXECUTE: undefined },
})
assert.equal(blocked.status, 3)
const blockedJson = JSON.parse(blocked.stdout)
assert.equal(blockedJson.blocked, true)
assert.equal(blockedJson.usedPostVideo, false)
assert.match(blockedJson.error, /不会回退原GEO|未启用/)

// Original GEO path must be rejected if someone points vendor there
const evil = spawnSync('python3', [exe], {
  input: JSON.stringify({
    mode: 'dry-run',
    pluginVendorRoot: '/Users/jiacong/Desktop/开发文件/MediaPublishPlatform-main/sau_backend',
    runtimeRoot: home,
  }),
  encoding: 'utf8',
  env: { ...process.env, HOME: home },
})
assert.equal(evil.status, 2)
assert.match(JSON.parse(evil.stdout).error, /original GEO|forbidden/i)

assert.equal(network, 0)
console.log('PASS independence: no original GEO markers in runtime sources; dry-run works; execute blocked without silent GEO fallback')
