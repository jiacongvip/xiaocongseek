import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// Controlled static check: do not instantiate companies or launch a browser.
const root = fileURLToPath(new URL('..', import.meta.url))
const dist = readFileSync(join(root, 'dist/publication-service.js'), 'utf8')
const src = readFileSync(join(root, 'src/publication-service.ts'), 'utf8')

for (const [label, text] of [['dist', dist], ['src', src]]) {
  assert.match(text, /studio\.accounts\.patrol\.verify_page/)
  assert.match(text, /accounts\.patrol\.verify_page/)
  assert.match(text, /studio\.accounts\.patrol\.mark_verified/)
  assert.match(text, /accounts\.patrol\.mark_verified/)
  const allow = text.includes("action==='studio.accounts.patrol.verify_page'") || text.includes("action === 'studio.accounts.patrol.verify_page'")
  assert.equal(allow, true, `${label} allowlist missing verify_page`)
}

console.log('PASS: digital-human-studio forwards studio.accounts.patrol.verify_page / mark_verified (src+dist map check, no live page)')
