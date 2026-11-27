#!/usr/bin/env node
/**
 * Bridge regression: default executor is independent publish-studio;
 * original GEO /postVideo bridge stays off; AI cannot approve/execute.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dhRoot = path.resolve(__dirname, '..')
const psRoot = path.resolve(dhRoot, '..', 'publish-studio')

const bridgeUrl = pathToFileURL(path.join(dhRoot, 'dist/publish-studio-bridge.js')).href
const serviceUrl = pathToFileURL(path.join(dhRoot, 'dist/publication-service.js')).href
const studioModUrl = pathToFileURL(path.join(psRoot, 'dist/service.js')).href

const { configurePublishStudio, getPublishStudio, publishStudioRuntime } = await import(bridgeUrl)
const pub = await import(serviceUrl)
const { createPublishStudio } = await import(studioModUrl)

let passed = 0
function ok(name) { passed++; console.log('PASS', name) }

// 1) Default: no studio configured => blocked, no GEO fallback
configurePublishStudio(undefined)
assert.equal(getPublishStudio(), undefined)
const rt0 = publishStudioRuntime()
assert.equal(rt0.enabled, false)
assert.match(rt0.mode, /missing|publish-studio/)
assert.ok(rt0.reasons.some(r => /不会回退原GEO/.test(r) || /publish-studio/.test(r)))
ok('default runtime blocked without publish-studio')

// 2) publicationGeoAction always throws (default off)
await assert.rejects(() => pub.publicationGeoAction('space_x', { action: 'status' }), /原GEO|publish-studio|关闭|禁用/)
ok('publicationGeoAction default closed')

// 3) Wire real independent studio API
const studio = createPublishStudio()
assert.equal(studio.independent, true)
assert.equal(studio.requiresOriginalGeoProcess, false)
configurePublishStudio(studio)
assert.equal(getPublishStudio()?.independent, true)
assert.equal(getPublishStudio()?.requiresOriginalGeoProcess, false)
ok('configurePublishStudio accepts independent plugin only')

// 4) Reject GEO-dependent fake backend
assert.throws(() => configurePublishStudio({ independent: true, requiresOriginalGeoProcess: true, action: async () => ({}), humanAction: async () => ({}), runtimeStatus: () => ({ enabled: true, mode: 'x', reasons: [] }) }), /原GEO|拒绝/)
// restore good studio after rejected configure attempt — configure throws before assign
configurePublishStudio(studio)
ok('rejects GEO-dependent backend registration')

// 5) AI cannot approve / confirmation / execute via publicationAction
const space = 'space_bridge_test_001'
// knownSpace requires real space store — publicationAction calls knownSpace which may throw.
// Probe through studio.action directly for AI policy, and publicationAction for geo/confirm paths that don't need pack IO.
await assert.rejects(() => studio.action(space, 'ai', { action: 'confirmation.request', id: 't1' }), /AI不能|批准|执行/)
await assert.rejects(() => studio.action(space, 'ai', { action: 'confirmation.submit', id: 't1' }), /AI不能|批准|执行/)
const blocked = await studio.action(space, 'ui', { action: 'confirmation.request', id: 't1' })
assert.equal(blocked.blocked, true)
ok('AI cannot approve/execute; confirmation blocked on management action')

// 6) Default executor identity: independent plugin, not GEO client modules
const idxJs = await import('node:fs').then(fs => fs.readFileSync(path.join(dhRoot, 'dist/index.js'), 'utf8'))
assert.ok(idxJs.includes('configurePublishStudio'))
assert.ok(!/from ['"]\.\/geo-publish-client/.test(idxJs))
assert.ok(!/from ['"]\.\/geo-publish-control/.test(idxJs))
assert.ok(!/from ['"]\.\/publication-providers/.test(idxJs))
// production path must not construct fetch to /postVideo (message strings may mention it)
const callHits = [...idxJs.matchAll(/fetch\([^)]*postVideo|axios[^;]*postVideo|['"]\/postVideo['"]\s*,/g)]
assert.equal(callHits.length, 0, 'index dist must not call /postVideo')
const pubJs = await import('node:fs').then(fs => fs.readFileSync(path.join(dhRoot, 'dist/publication-service.js'), 'utf8'))
assert.ok(!/from ['"]\.\/geo-publish/.test(pubJs))
assert.ok(pubJs.includes('getPublishStudio'))
ok('dist default imports independent bridge, no geo-publish client')

// 7) publicationHumanAction requires studio (already configured)
await assert.rejects(() => pub.publicationHumanAction(space, { action: 'confirmation.request' }, ''), /公司或确认会话无效|会话/)
ok('humanAction requires session')

console.log(`\nBridge regression: ${passed} passed`)
