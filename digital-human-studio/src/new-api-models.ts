/**
 * After XiaocongAPI authorize / login / paste-token, sync GET /v1/models into
 * the running profile's llm-pi-ai `newapi` provider list (and sibling profile
 * patch files). Discovery alone does not persist; cordis.patch.yml / settings
 * writes are what the picker serves.
 *
 * Always upsert the **full** newapi provider (displayName, apiKeyEnv, api,
 * baseURL, models) — models-only patches leave Settings empty after the user
 * deletes providers. Emit block-style YAML so the loader can parse providers.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  chmodSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { isMap, isSeq, parseDocument, Scalar, YAMLMap, YAMLSeq } from 'yaml'

export const NEWAPI_PROVIDER = 'newapi'
export const PREFERRED_DEFAULT_MODELS = ['deepseek-chat', 'deepseek-flash'] as const
export const DEFAULT_NEWAPI_BASE_URL = 'http://127.0.0.1:3000/v1'
export const DEFAULT_DISPLAY_NAME = 'XiaocongAPI'
export const NEWAPI_API_KEY_ENV = 'NEW_API_TOKEN'
export const NEWAPI_API = 'openai-completions'

export type ModelEntry = { id: string; name: string }

export type SyncNewApiModelsResult = {
  models: string[]
  defaultModel?: string
  defaultChanged: boolean
  warning?: string
  appliedLive: boolean
  patchedFiles: string[]
}

export type NewApiProviderOpts = {
  defaultModel?: string
  displayName?: string
  /** OpenAI-compatible base including `/v1`, e.g. http://127.0.0.1:3000/v1 */
  baseURL?: string
}

/** Normalize studio base (…:3000) or already-suffixed …/v1 into llm-pi-ai baseURL. */
export function resolveNewApiBaseURL(baseUrl?: string | null): string {
  const raw = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!raw) return DEFAULT_NEWAPI_BASE_URL
  if (/\/v1$/i.test(raw)) return raw
  return `${raw}/v1`
}

/** OpenAI-compatible `data[].id` list; de-duped, order preserved. */
export function parseModelIds(payload: unknown): string[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  const data = root && Array.isArray(root.data) ? root.data
    : root && Array.isArray(root.models) ? root.models
      : []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of data) {
    const id = typeof item === 'string' ? item.trim()
      : item && typeof item === 'object' && typeof (item as any).id === 'string'
        ? String((item as any).id).trim()
        : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** Keep current if still offered; else prefer deepseek-chat → deepseek-flash → first. */
export function pickDefaultModel(ids: readonly string[], current?: string | null): string | undefined {
  if (!ids.length) return undefined
  if (current && ids.includes(current)) return current
  for (const preferred of PREFERRED_DEFAULT_MODELS) {
    if (ids.includes(preferred)) return preferred
  }
  return ids[0]
}

export function toModelEntries(ids: readonly string[]): ModelEntry[] {
  return ids.map((id) => ({ id, name: id }))
}

/** Full provider object for live settings.update / patch upsert. */
export function buildNewApiProvider(
  ids: readonly string[],
  opts: NewApiProviderOpts = {},
): Record<string, unknown> {
  return {
    displayName: opts.displayName || DEFAULT_DISPLAY_NAME,
    apiKeyEnv: NEWAPI_API_KEY_ENV,
    api: NEWAPI_API,
    baseURL: resolveNewApiBaseURL(opts.baseURL),
    models: toModelEntries(ids),
  }
}

function profilesRoot(): string {
  return join(homedir(), '.dsh', 'profiles')
}

/**
 * Always consider web + desktop patches when the file exists.
 * Do **not** require an existing `newapi` string — login must recreate the
 * provider after the user deletes all model providers in Settings.
 */
export function discoverNewApiPatchPaths(exclude?: string): string[] {
  const root = profilesRoot()
  const out: string[] = []
  for (const name of ['web', 'desktop']) {
    const path = join(root, name, 'cordis.patch.yml')
    if (exclude && path === exclude) continue
    if (!existsSync(path)) continue
    out.push(path)
  }
  return out
}

function findEntryMap(doc: ReturnType<typeof parseDocument>, id: string): YAMLMap | null {
  if (!isSeq(doc.contents)) return null
  for (const item of doc.contents.items) {
    if (!isMap(item)) continue
    const entryId = item.get('id')
    if (entryId === id) return item
  }
  return null
}

function forceBlock(node: YAMLMap | YAMLSeq): void {
  node.flow = false
}

function ensureMap(parent: YAMLMap, key: string): YAMLMap {
  const existing = parent.get(key, true)
  if (isMap(existing)) {
    forceBlock(existing)
    return existing
  }
  const next = new YAMLMap()
  forceBlock(next)
  parent.set(key, next)
  return next
}

function ensurePatchEntry(
  doc: ReturnType<typeof parseDocument>,
  id: string,
  name: string,
): YAMLMap {
  const existing = findEntryMap(doc, id)
  if (existing) return existing
  if (!isSeq(doc.contents)) throw new Error('invalid patch')
  const entry = new YAMLMap()
  forceBlock(entry)
  entry.set('id', id)
  entry.set('name', name)
  const config = new YAMLMap()
  forceBlock(config)
  entry.set('config', config)
  doc.contents.add(entry)
  return entry
}

function setProviderFields(newapi: YAMLMap, opts: NewApiProviderOpts): void {
  newapi.set('displayName', opts.displayName || DEFAULT_DISPLAY_NAME)
  newapi.set('apiKeyEnv', NEWAPI_API_KEY_ENV)
  newapi.set('api', NEWAPI_API)
  newapi.set('baseURL', resolveNewApiBaseURL(opts.baseURL))
  forceBlock(newapi)
}

/** Upsert providers.newapi (+ agent-default-model) in a patch file as block YAML. */
export function mergeNewApiModelsIntoPatch(
  path: string,
  ids: readonly string[],
  opts: NewApiProviderOpts = {},
): { wrote: boolean; previousIds: string[] } {
  if (!ids.length) return { wrote: false, previousIds: [] }
  const original = readFileSync(path, 'utf8')
  const doc = parseDocument(original)
  if (doc.errors.length || !isSeq(doc.contents)) throw new Error('invalid patch')

  const llm = ensurePatchEntry(doc, 'llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai')
  const config = ensureMap(llm, 'config')
  const providers = ensureMap(config, 'providers')
  // If providers was previously serialized as a flow map, force block before rewrite.
  forceBlock(providers)
  const newapi = ensureMap(providers, NEWAPI_PROVIDER)
  setProviderFields(newapi, opts)

  const previousIds: string[] = []
  const prevModels = newapi.get('models', true)
  if (isSeq(prevModels)) {
    for (const item of prevModels.items) {
      if (isMap(item) && typeof item.get('id') === 'string') previousIds.push(String(item.get('id')))
      else if (item instanceof Scalar && typeof item.value === 'string') previousIds.push(item.value)
      else if (typeof item === 'string') previousIds.push(item)
    }
  }

  const seq = new YAMLSeq()
  forceBlock(seq)
  for (const id of ids) {
    const row = new YAMLMap()
    forceBlock(row)
    row.set('id', id)
    row.set('name', id)
    seq.add(row)
  }
  newapi.set('models', seq)

  const defaultModel = opts.defaultModel || pickDefaultModel(ids)
  if (defaultModel) {
    const def = ensurePatchEntry(doc, 'agent-default-model', '@deepseek-ai/dsh-agent-default-model')
    const defConfig = ensureMap(def, 'config')
    const provider = defConfig.get('provider')
    // Create or rewrite when missing / already newapi; do not steal another provider's default.
    if (provider === undefined || provider === null || provider === NEWAPI_PROVIDER) {
      defConfig.set('provider', NEWAPI_PROVIDER)
      defConfig.set('model', defaultModel)
    } else if (!defConfig.has('provider')) {
      defConfig.set('provider', NEWAPI_PROVIDER)
      defConfig.set('model', defaultModel)
    }
  }

  const next = doc.toString({ collectionStyle: 'block', lineWidth: 0 })
  if (next === original) return { wrote: false, previousIds }

  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.newapi-models-${randomUUID()}.tmp`)
  try {
    writeFileSync(tmp, next, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    if (readFileSync(path, 'utf8') !== original) throw new Error('patch changed')
    renameSync(tmp, path)
    try { chmodSync(path, 0o600) } catch { /* best effort */ }
  } finally {
    try { unlinkSync(tmp) } catch { /* best effort */ }
  }
  return { wrote: true, previousIds }
}

type SettingsLike = {
  update: (ns: string, patch: object) => Promise<void>
  documentPath?: string
}

type ProfileContextLike = { patchPath?: string }

/**
 * Fetch models for a Bearer sk- token and apply them to live settings + patch files.
 * Empty listing keeps previous models and returns a warning (does not blank the picker).
 * Live update always writes the **full** newapi provider so Settings can recover after delete.
 */
export async function syncNewApiModels(
  ctx: Context,
  opts: {
    baseUrl: string
    token: string
    currentDefault?: string | null
    fetchModels: () => Promise<unknown>
  },
): Promise<SyncNewApiModelsResult> {
  const payload = await opts.fetchModels()
  const ids = parseModelIds(payload)
  if (!ids.length) {
    return {
      models: [],
      defaultChanged: false,
      warning: '鉴权成功，但该密钥下暂无可用模型；请在 XiaocongAPI 控制台配置渠道。已保留原模型列表。',
      appliedLive: false,
      patchedFiles: [],
    }
  }

  const baseURL = resolveNewApiBaseURL(opts.baseUrl)
  const provider = buildNewApiProvider(ids, {
    baseURL,
    displayName: DEFAULT_DISPLAY_NAME,
  })
  const defaultModel = pickDefaultModel(ids, opts.currentDefault)
  const needDefaultUpdate = !!defaultModel && (!opts.currentDefault || !ids.includes(opts.currentDefault))
  let defaultChanged = false
  let appliedLive = false
  const patchedFiles: string[] = []

  const settings = ctx.get('settings') as SettingsLike | undefined
  if (settings?.update) {
    try {
      await settings.update('llm-pi-ai', {
        providers: {
          [NEWAPI_PROVIDER]: provider,
        },
      })
      appliedLive = true
      if (needDefaultUpdate && defaultModel) {
        await settings.update('agent-default-model', {
          provider: NEWAPI_PROVIDER,
          model: defaultModel,
        })
        defaultChanged = true
      }
    } catch {
      // Fall through to file patch; surface as warning if files also fail.
      appliedLive = false
    }
  }

  // Always upsert sibling (and active) patches — including profiles that never
  // had newapi text — so desktop/web recover after Settings → delete all.
  const livePath = settings?.documentPath
    || (ctx.get('profileContext') as ProfileContextLike | undefined)?.patchPath
    || undefined
  const paths = discoverNewApiPatchPaths()
  if (livePath && existsSync(livePath) && !paths.includes(livePath)) paths.unshift(livePath)

  const unique = [...new Set(paths)]
  for (const path of unique) {
    try {
      const result = mergeNewApiModelsIntoPatch(path, ids, {
        defaultModel: defaultModel,
        displayName: DEFAULT_DISPLAY_NAME,
        baseURL,
      })
      if (result.wrote) patchedFiles.push(path)
      if (needDefaultUpdate && result.wrote) defaultChanged = true
    } catch {
      // Keep going; live apply may already have succeeded.
    }
  }

  if (!appliedLive && !patchedFiles.length) {
    return {
      models: ids,
      defaultModel,
      defaultChanged: false,
      warning: '已取得模型列表，但未能写入运行配置；请检查 ~/.dsh/profiles/*/cordis.patch.yml 权限后重试登录。',
      appliedLive: false,
      patchedFiles: [],
    }
  }

  return {
    models: ids,
    defaultModel,
    defaultChanged,
    appliedLive,
    patchedFiles,
  }
}
