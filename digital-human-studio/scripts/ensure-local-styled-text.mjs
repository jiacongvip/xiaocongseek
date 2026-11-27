#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'tools/local-styled-text/render.py')
const candidates = [
  process.env.LOCAL_STYLED_TEXT_PYTHON,
  '/usr/bin/python3',
  'python3',
  join(homedir(), '.local/bin/python3.12'),
  join(homedir(), '.local/bin/python3.11'),
].filter(Boolean)

let chosen = null
for (const py of candidates) {
  if (!(py === 'python3' || py === '/usr/bin/python3' || existsSync(py))) continue
  const r = spawnSync(py, [script, '--check'], { encoding: 'utf8' })
  if (r.status === 0) { chosen = py; break }
}
if (!chosen) {
  console.error('[digital-human-studio] local-styled-text runtime missing (need Pillow+font+ffmpeg on a Python).')
  process.exit(1)
}
console.log('[digital-human-studio] ensure local-styled-text via', chosen)
const r = spawnSync(chosen, [script, '--check'], { stdio: 'inherit' })
process.exit(r.status == null ? 1 : r.status)
