import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
let ts
try {
  ts = createRequire('/Users/jiacong/Desktop/开发文件/小葱/dsh-newapi-fork/digital-human-studio/package.json')('typescript')
} catch {
  ts = createRequire('/Users/jiacong/Desktop/开发文件/小葱/dsh-newapi-fork/deepseek-harness/package.json')('typescript')
}
const source = readFileSync(join(here, 'digital-human-publication-runtime.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const dir = mkdtempSync(join(tmpdir(), 'pub-runtime-'))
const out = join(dir, 'digital-human-publication-runtime.mjs')
writeFileSync(out, code)
const { normalizePublicationOverview, publicationRuntimeStatusLines } = await import(pathToFileURL(out).href)

// 1) independent runtime without connection must not throw and must not claim connected
const independent = normalizePublicationOverview({
  success: true,
  spaceId: 'co1',
  platforms: [],
  bindings: [],
  tasks: [],
  runtime: { enabled: false, mode: 'independent-publish-studio', reasons: ['需要登录'] },
}, 'co1')
assert.equal(independent.runtime.connection, null)
assert.equal(independent.runtime.enabled, false)
assert.equal(independent.runtime.independent, true)
const lines = publicationRuntimeStatusLines(independent.runtime)
assert.ok(lines.some(l => /blocked|未就绪|不可真实发送/.test(l)))
assert.equal(lines.some(l => l.includes('已连接')), false)

// 2) missing runtime object
const missingRuntime = normalizePublicationOverview({ success: true, spaceId: 'co1', platforms: [], bindings: [], tasks: [] }, 'co1')
assert.equal(missingRuntime.runtime.enabled, false)
assert.equal(missingRuntime.runtime.connection, null)
assert.ok(Array.isArray(missingRuntime.runtime.reasons))

// 3) explicit connection true only when connected===true
const connected = normalizePublicationOverview({
  success: true,
  spaceId: 'co1',
  runtime: { enabled: true, mode: 'legacy', reasons: [], connection: { connected: true, baseUrl: 'http://127.0.0.1:1', authRequired: false, authenticated: false, permissionsEnforced: false, authCenterOrigin: '' } },
}, 'co1')
assert.equal(connected.runtime.connection?.connected, true)
const connectedLines = publicationRuntimeStatusLines(connected.runtime)
assert.ok(connectedLines.some(l => l.includes('已连接')))

// 4) connection object with connected:false must not become true
const offline = normalizePublicationOverview({
  success: true,
  spaceId: 'co1',
  runtime: { enabled: false, mode: 'x', reasons: [], connection: { connected: false, baseUrl: '', authRequired: true, authenticated: false, permissionsEnforced: null, authCenterOrigin: '' } },
}, 'co1')
assert.equal(offline.runtime.connection?.connected, false)

// 5) invalid / mismatch throws (render path should catch via overview())
assert.throws(() => normalizePublicationOverview(null, 'co1'), /无效/)
assert.throws(() => normalizePublicationOverview({ success: false, error: 'boom' }, 'co1'), /boom/)
assert.throws(() => normalizePublicationOverview({ success: true, spaceId: 'other' }, 'co1'), /不匹配/)

// 6) simulate render field access that used to crash
function renderProbe(view) {
  const connection = view.runtime.connection
  const status = publicationRuntimeStatusLines(view.runtime)
  const authText = connection
    ? (connection.connected ? '已连接' : '未连接')
    : '无connection字段'
  return { statusCount: status.length, authText, enabled: view.runtime.enabled }
}
const probe = renderProbe(independent)
assert.equal(probe.authText, '无connection字段')
assert.equal(probe.enabled, false)
assert.ok(probe.statusCount >= 1)

console.log('PASS: publication runtime normalize/render-safe without connection; no forged connected')
