#!/usr/bin/env node
/**
 * Triggered by npm/pnpm prepare + postinstall when the plugin is installed/linked.
 * Also runnable: node scripts/ensure-runtime.mjs [--status|--force]
 * Hosts that set ignore-scripts will skip this — Cordis apply still reports honest not-ready.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'publishing', 'ensure_runtime.py')
const home = homedir()
const candidates = [
  process.env.PUBLISH_STUDIO_BOOTSTRAP_PYTHON,
  join(home, '.local/bin/python3.12'),
  join(home, '.local/bin/python3.11'),
  'python3',
].filter(Boolean)
const bootstrap = candidates.find((p) => p === 'python3' || existsSync(p)) || 'python3'

const args = process.argv.slice(2)
console.log(`[publish-studio] ensure-runtime via ${bootstrap}`)
const r = spawnSync(bootstrap, [script, ...args], {
  stdio: 'inherit',
  cwd: join(root, 'publishing'),
  env: process.env,
})
process.exit(r.status == null ? 1 : r.status)
