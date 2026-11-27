import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'ps-rt-'))
process.env.PUBLISH_STUDIO_RUNTIME_ROOT = join(home, 'runtime')

const bootstrap = process.env.PUBLISH_STUDIO_BOOTSTRAP_PYTHON || `${process.env.HOME}/.local/bin/python3.12`
const script = join(root, 'publishing', 'ensure_runtime.py')

function run(args) {
  return spawnSync(bootstrap, [script, ...args], {
    cwd: join(root, 'publishing'),
    env: process.env,
    encoding: 'utf8',
  })
}

// missing status
let r = run(['--status'])
assert.equal(r.status, 1)
const missing = JSON.parse(r.stdout)
assert.equal(missing.ready, false)
assert.ok(missing.missing?.includes('runtime') || missing.phase === 'missing')

// corrupt status
mkdirSync(process.env.PUBLISH_STUDIO_RUNTIME_ROOT, { recursive: true })
writeFileSync(join(process.env.PUBLISH_STUDIO_RUNTIME_ROOT, 'status.json'), '{not-json', 'utf8')
r = run(['--status'])
assert.equal(r.status, 1)
const corrupt = JSON.parse(r.stdout)
assert.equal(corrupt.ready, false)
assert.ok(corrupt.phase === 'corrupt' || (corrupt.missing || []).includes('status'))

console.log('PASS runtime-ensure: missing/corrupt status honest (no fake ready)')
rmSync(home, { recursive: true, force: true })
