import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '../../../../../digital-human-studio/package.json'))
// Resolve typescript from the sibling plugin that already has it installed.
let ts
try {
  ts = createRequire('/Users/jiacong/Desktop/开发文件/小葱/dsh-newapi-fork/digital-human-studio/package.json')('typescript')
} catch {
  ts = createRequire('/Users/jiacong/Desktop/开发文件/小葱/dsh-newapi-fork/deepseek-harness/package.json')('typescript')
}
const source = readFileSync(join(here, 'digital-human-publish-nav.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const dir = mkdtempSync(join(tmpdir(), 'publish-nav-'))
const out = join(dir, 'digital-human-publish-nav.mjs')
writeFileSync(out, code)
const { isSideNavOn, resolvePublishCompany } = await import(pathToFileURL(out).href)

assert.equal(isSideNavOn('home', 'home'), true)
assert.equal(isSideNavOn('home', 'companies'), false)
assert.equal(isSideNavOn('home', 'publish'), false)
assert.equal(isSideNavOn('publish', 'publish'), true)
assert.equal(isSideNavOn('publish', 'companies'), false)
assert.equal(isSideNavOn('publish', 'home'), false)
assert.equal(isSideNavOn('video-download', 'video-download'), true)
assert.equal(isSideNavOn('video-download', 'publish'), false)
assert.equal(isSideNavOn('industry-hotboard', 'industry-hotboard'), true)
assert.equal(isSideNavOn('industry-hotboard', 'video-download'), false)
assert.equal(isSideNavOn('industry-hotboard', 'companies'), false)
assert.equal(isSideNavOn('publish', 'video-download'), false)
assert.equal(isSideNavOn('publish-packs', 'companies'), true)
assert.equal(isSideNavOn('platform-accounts', 'companies'), true)
assert.equal(isSideNavOn('platform-accounts', 'publish'), false)
assert.equal(isSideNavOn('publish-packs', 'publish'), true)
assert.equal(isSideNavOn('calendar', 'companies'), true)
assert.equal(isSideNavOn('materials', 'companies'), true)
assert.equal(isSideNavOn('create', 'companies'), true)
assert.equal(isSideNavOn('works', 'companies'), true)
assert.equal(isSideNavOn('companies', 'companies'), true)

assert.deepEqual(resolvePublishCompany([], 'co-a'), { status: 'empty' })
assert.deepEqual(resolvePublishCompany([{ id: 'co-a', name: '甲' }], ''), { status: 'pick', spaces: [{ id: 'co-a', name: '甲' }] })
assert.deepEqual(resolvePublishCompany([{ id: 'co-a', name: '甲' }], 'co-missing'), { status: 'pick', spaces: [{ id: 'co-a', name: '甲' }] })
assert.deepEqual(resolvePublishCompany([{ id: 'co-a', name: '甲' }, { id: 'co-b', name: '乙' }], 'co-b'), { status: 'ready', space: { id: 'co-b', name: '乙' } })
const unknown = resolvePublishCompany([{ id: 'co-a', name: '甲' }, { id: 'co-b', name: '乙' }], 'co-x')
assert.equal(unknown.status, 'pick')
assert.equal(unknown.spaces.length, 2)

console.log('PASS: publish side-nav active states and company resolution never silent-default')
