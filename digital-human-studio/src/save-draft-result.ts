/** Parse Xiaocongcut /save_draft responses and shape lossless JSON tool results. */
import { existsSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'

export type SaveDraftRaw = {
  success?: boolean
  error?: string
  output?: unknown
  draft_url?: unknown
  draft_path?: unknown
  draft_folder?: unknown
  [k: string]: unknown
}

/** Strip undefined/NaN/Infinity for Cordis lossless JSON. */
export function toLosslessJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'number' && !Number.isFinite(v)) return null
      return v
    }),
  ) as T
}

export function extractDraftPathFromSaveResponse(data: SaveDraftRaw | null | undefined): {
  path: string | null
  source: string
  rawOutputType: string
} {
  if (!data || typeof data !== 'object') {
    return { path: null, source: 'none', rawOutputType: typeof data }
  }
  const out = (data as any).output
  if (typeof out === 'string' && out.trim()) {
    return { path: out.trim(), source: 'output:string', rawOutputType: 'string' }
  }
  if (out && typeof out === 'object') {
    for (const key of ['draft_url', 'draft_path', 'path', 'deployed_path'] as const) {
      const v = (out as any)[key]
      if (typeof v === 'string' && v.trim() && !/^https?:\/\//i.test(v.trim())) {
        return { path: v.trim(), source: `output.${key}`, rawOutputType: 'object' }
      }
    }
    // nested output.output for double-wrapped shapes
    const nested = (out as any).output
    if (typeof nested === 'string' && nested.trim() && !/^https?:\/\//i.test(nested.trim())) {
      return { path: nested.trim(), source: 'output.output:string', rawOutputType: 'object' }
    }
  }
  for (const key of ['draft_url', 'draft_path', 'draft_folder'] as const) {
    const v = (data as any)[key]
    if (typeof v === 'string' && v.trim() && !/^https?:\/\//i.test(v.trim())) {
      // draft_folder alone is parent, not draft dir — only accept if it looks like a draft (has meta)
      if (key === 'draft_folder') continue
      return { path: v.trim(), source: key, rawOutputType: typeof out }
    }
  }
  return {
    path: null,
    source: 'unresolved',
    rawOutputType: out === null || out === undefined ? String(out) : typeof out,
  }
}

export function isPathInsideRoot(candidate: string, root: string): boolean {
  const c = resolve(candidate)
  const r = resolve(root)
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep)
}

/**
 * Only finalize paths under the requested draft_folder (or explicit allowRoots).
 * Rejects `[object Object]`, URLs, and path traversal outside controlled roots.
 */
export function resolveSafeDraftDirForFinalize(input: {
  extractedPath: string | null
  draftFolder?: string | null
  allowRoots?: string[]
  draftId?: string
}): { ok: true; draftDir: string } | { ok: false; error: string } {
  const raw = input.extractedPath?.trim() || ''
  if (!raw) return { ok: false, error: 'save 响应未给出可本地化的草稿目录路径' }
  if (raw === '[object Object]') {
    return { ok: false, error: 'save 响应 output 为对象但未正确解析路径（避免 String(object)）' }
  }
  if (/^https?:\/\//i.test(raw)) {
    return { ok: false, error: '拒绝对远程 URL 执行本地 finalize' }
  }
  if (raw.includes('\0') || raw.includes('..')) {
    // still allow legitimate dirs that contain ".." only as path segments after resolve check
  }
  let draftDir = resolve(raw)
  // If response pointed at parent folder + we know draftId, try join
  if (
    input.draftId &&
    input.draftFolder &&
    isPathInsideRoot(draftDir, resolve(input.draftFolder)) &&
    !existsSync(draftDir + '/draft_meta_info.json') &&
    existsSync(resolve(input.draftFolder, input.draftId, 'draft_meta_info.json'))
  ) {
    draftDir = resolve(input.draftFolder, input.draftId)
  }
  if (!existsSync(draftDir) || !statSync(draftDir).isDirectory()) {
    return { ok: false, error: `草稿目录不存在或不是目录: ${draftDir}` }
  }
  const roots = [
    ...(input.draftFolder ? [resolve(input.draftFolder)] : []),
    ...((input.allowRoots || []).map((r) => resolve(r))),
  ].filter(Boolean)
  if (!roots.length) {
    return { ok: false, error: '缺少受控输出根（draft_folder），拒绝对任意响应路径 finalize' }
  }
  const allowed = roots.some((r) => isPathInsideRoot(draftDir, r))
  if (!allowed) {
    return {
      ok: false,
      error: `草稿路径不在受控输出根内，已拒绝 finalize: ${draftDir}`,
    }
  }
  // basic traversal safety after resolve
  if (draftDir.includes('\0')) return { ok: false, error: '非法路径' }
  return { ok: true, draftDir }
}

export function shapeSaveDraftToolResult(input: {
  saved: boolean
  xiaocongcut: SaveDraftRaw
  draftId: string
  projectName?: string
  draftFolder?: string | null
  extractedPath: string | null
  extractSource: string
  rawOutputType: string
  finalize?: Record<string, unknown> | null
  finalizeError?: string | null
  workspace?: unknown
}): Record<string, unknown> {
  const finalizeRan = input.finalize != null
  const finalizeOk = !!(input.finalize && (input.finalize as any).ok === true)
  const body: Record<string, unknown> = {
    // Xiaocongcut save success stays success=true even if finalize only warns (no blind retry).
    success: input.saved,
    saved: input.saved,
    draft_id: input.draftId,
    project_name: input.projectName || input.draftId,
    draft_folder: input.draftFolder || null,
    draft_path: input.extractedPath || null,
    output: typeof input.xiaocongcut.output === 'string'
      ? input.xiaocongcut.output
      : input.xiaocongcut.output && typeof input.xiaocongcut.output === 'object'
        ? input.xiaocongcut.output
        : input.extractedPath,
    extract: {
      source: input.extractSource,
      rawOutputType: input.rawOutputType,
      path: input.extractedPath,
    },
    assetCheck: input.finalize ?? null,
    finalize: input.finalize
      ? { ran: true, ok: finalizeOk, ...(input.finalize as object) }
      : {
          ran: false,
          ok: false,
          error: input.finalizeError || 'finalize 未执行',
        },
    workspace: input.workspace ?? null,
  }
  if (input.xiaocongcut.error) body.xiaocongcutError = String(input.xiaocongcut.error)
  if (input.saved && input.finalizeError) {
    body.warning = `草稿已保存，但 finalize 失败（未盲着重试以免重复草稿）: ${input.finalizeError}`
    body.success = true
  } else if (input.saved && finalizeRan && !finalizeOk) {
    body.warning = `草稿已保存，但 finalize 未完全成功（未盲着重试）: ${String((input.finalize as any)?.error || 'see assetCheck')}`
    body.success = true
  } else if (!input.saved) {
    body.success = false
    body.error = String(input.xiaocongcut.error || 'save_draft failed')
  }
  return toLosslessJson(body)
}

export async function processSaveDraftResponse(input: {
  xiaocongcutData: SaveDraftRaw
  draftId: string
  projectName?: string
  draftFolder?: string | null
  allowRoots?: string[]
  workspace?: unknown
  finalizeFn?: (draftDir: string, opts: { draftId: string; draftName?: string }) => Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const raw = input.xiaocongcutData
  const xiaocongcutSaved = raw.success !== false
  const extracted = extractDraftPathFromSaveResponse(raw)
  let finalizeResult: Record<string, unknown> | null = null
  let finalizeError: string | null = null
  let path = extracted.path

  if (xiaocongcutSaved) {
    const safe = resolveSafeDraftDirForFinalize({
      extractedPath: extracted.path,
      draftFolder: input.draftFolder || null,
      draftId: input.draftId,
      allowRoots: (input.allowRoots || []).filter(Boolean),
    })
    if (!safe.ok) {
      finalizeError = safe.error
    } else if (input.finalizeFn) {
      try {
        finalizeResult = input.finalizeFn(safe.draftDir, {
          draftId: input.draftId,
          draftName: input.projectName || input.draftId,
        })
        if (finalizeResult && typeof (finalizeResult as any).draft_fold_path === 'string') {
          path = String((finalizeResult as any).draft_fold_path)
        } else {
          path = safe.draftDir
        }
      } catch (err: any) {
        finalizeError = String(err?.message || err)
        path = safe.draftDir
      }
    } else {
      finalizeError = 'finalizeFn missing'
      path = safe.draftDir
    }
  }

  return shapeSaveDraftToolResult({
    saved: xiaocongcutSaved,
    xiaocongcut: raw,
    draftId: input.draftId,
    projectName: input.projectName || input.draftId,
    draftFolder: input.draftFolder || null,
    extractedPath: path,
    extractSource: extracted.source,
    rawOutputType: extracted.rawOutputType,
    finalize: finalizeResult,
    finalizeError,
    workspace: input.workspace ?? null,
  })
}
