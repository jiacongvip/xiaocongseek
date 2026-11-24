/** Read and update the external AI agents' MCP config files, preserving everything we don't own. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { XcyMcpAgentState } from './shared.js'

/** Config file formats this package knows how to edit. */
type AgentFormat =
  /** JSON object with a flat `mcpServers` map at the root. */
  | 'json-mcpServers'
  /** JSON object whose server map lives at `mcp.servers`. */
  | 'json-mcp-servers'
  /** TOML with a `[mcp_servers.xiaocongseek]` section. */
  | 'toml-section'

interface AgentSpec {
  key: string
  label: string
  format: AgentFormat
  path: string
}

/** Agent catalog, ordered as the settings panel lists them. */
export const AGENT_SPECS: readonly AgentSpec[] = [
  {
    key: 'workbuddy',
    label: 'WorkBuddy',
    format: 'json-mcpServers',
    path: join(homedir(), '.workbuddy', '.mcp.json'),
  },
  {
    key: 'claude-code',
    label: 'Claude Code',
    format: 'json-mcpServers',
    path: join(homedir(), '.claude.json'),
  },
  {
    key: 'cursor',
    label: 'Cursor',
    format: 'json-mcpServers',
    path: join(homedir(), '.cursor', 'mcp.json'),
  },
  {
    key: 'codex',
    label: 'Codex (ChatGPT)',
    format: 'toml-section',
    path: join(homedir(), '.codex', 'config.toml'),
  },
  {
    key: 'opencode',
    label: 'OpenCode',
    format: 'json-mcp-servers',
    path: join(homedir(), '.config', 'opencode', 'opencode.json'),
  },
]

const SERVER_KEY = 'xiaocongseek'

/** The server entry other agents read. Cursor and Xiaocongcut use the bare `url` form; http-typed agents use `type`. */
function httpEntry(url: string): Record<string, unknown> {
  return { type: 'http', url, description: 'Xiaocongseek local MCP: project / render / subtitle / media / digital-human' }
}

function urlEntry(url: string): Record<string, unknown> {
  return { url }
}

function readText(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function writeTextAtomic(path: string, text: string): string | null {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text, 'utf8')
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

/** JSON config with a server map at one root key. */
function setJsonAgent(spec: AgentSpec, url: string, enabled: boolean): string | null {
  const text = readText(spec.path)
  if (text === null) {
    if (!enabled) return null
    const fresh: Record<string, unknown> = {}
    if (spec.format === 'json-mcpServers') {
      fresh.mcpServers = { [SERVER_KEY]: httpEntry(url) }
    } else {
      fresh.mcp = { servers: { [SERVER_KEY]: httpEntry(url) } }
    }
    return writeTextAtomic(spec.path, `${JSON.stringify(fresh, null, 2)}\n`)
  }
  const doc = parseJson(text)
  if (doc === null) return `${spec.path} 不是可解析的 JSON，未改动`
  if (spec.format === 'json-mcpServers') {
    const servers = doc.mcpServers
    if (!enabled) {
      if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return null
      const map = servers as Record<string, unknown>
      if (!(SERVER_KEY in map)) return null
      delete map[SERVER_KEY]
      return writeTextAtomic(spec.path, `${JSON.stringify(doc, null, 2)}\n`)
    }
    const map = (typeof servers === 'object' && servers !== null && !Array.isArray(servers)) ? servers as Record<string, unknown> : {}
    map[SERVER_KEY] = httpEntry(url)
    doc.mcpServers = map
    return writeTextAtomic(spec.path, `${JSON.stringify(doc, null, 2)}\n`)
  }
  const mcp = doc.mcp
  if (!enabled) {
    if (typeof mcp !== 'object' || mcp === null || Array.isArray(mcp)) return null
    const servers = (mcp as Record<string, unknown>).servers
    if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return null
    const map = servers as Record<string, unknown>
    if (!(SERVER_KEY in map)) return null
    delete map[SERVER_KEY]
    return writeTextAtomic(spec.path, `${JSON.stringify(doc, null, 2)}\n`)
  }
  const root = (typeof mcp === 'object' && mcp !== null && !Array.isArray(mcp)) ? mcp as Record<string, unknown> : {}
  const servers = (typeof root.servers === 'object' && root.servers !== null && !Array.isArray(root.servers))
    ? root.servers as Record<string, unknown>
    : {}
  servers[SERVER_KEY] = httpEntry(url)
  root.servers = servers
  doc.mcp = root
  return writeTextAtomic(spec.path, `${JSON.stringify(doc, null, 2)}\n`)
}

/** Codex keeps its servers as a TOML section; edit only `[mcp_servers.xiaocongseek]`. */
function setTomlAgent(spec: AgentSpec, url: string, enabled: boolean): string | null {
  const section = `[mcp_servers.${SERVER_KEY}]`
  const text = readText(spec.path) ?? ''
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === section)
  if (enabled) {
    const block = [section, `url = "${url}"`]
    if (start >= 0) {
      let end = start + 1
      while (end < lines.length && !/^\s*\[/.test(lines[end] ?? '') && (lines[end] ?? '').trim() !== '') end += 1
      const trailing = (lines[end] ?? '') === '' ? end + 1 : end
      lines.splice(start, trailing - start, ...block)
    } else {
      if (text.length > 0 && !text.endsWith('\n')) lines.push('')
      lines.push(...block)
    }
    return writeTextAtomic(spec.path, `${lines.join('\n')}\n`)
  }
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !/^\s*\[/.test(lines[end] ?? '')) end += 1
  lines.splice(start, end - start)
  while (lines[0] === '') lines.shift()
  return writeTextAtomic(spec.path, `${lines.join('\n')}\n`)
}

/** Apply a bind/unbind for one agent and return its error, if any. */
export function setAgentBound(spec: AgentSpec, url: string, enabled: boolean): string | null {
  if (spec.format === 'toml-section') return setTomlAgent(spec, url, enabled)
  return setJsonAgent(spec, url, enabled)
}

/** Read one agent's current binding state without touching its file. */
export function readAgentState(spec: AgentSpec, url: string): XcyMcpAgentState {
  const text = readText(spec.path)
  if (text === null) {
    return { key: spec.key, label: spec.label, enabled: false, path: spec.path, present: false }
  }
  let enabled = false
  if (spec.format === 'json-mcpServers') {
    const doc = parseJson(text)
    const servers = doc?.mcpServers
    enabled = typeof servers === 'object' && servers !== null && !Array.isArray(servers) && SERVER_KEY in servers
  } else if (spec.format === 'json-mcp-servers') {
    const doc = parseJson(text)
    const mcp = doc?.mcp
    const servers = (typeof mcp === 'object' && mcp !== null && !Array.isArray(mcp)) ? (mcp as Record<string, unknown>).servers : undefined
    enabled = typeof servers === 'object' && servers !== null && !Array.isArray(servers) && SERVER_KEY in servers
  } else {
    const wanted = `[mcp_servers.${SERVER_KEY}]`
    enabled = text.split(/\r?\n/).some(line => line.trim() === wanted)
  }
  void url
  return { key: spec.key, label: spec.label, enabled, path: spec.path, present: true }
}

export { httpEntry, urlEntry }
