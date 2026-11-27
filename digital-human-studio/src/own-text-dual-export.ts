/**
 * Dual-path export from own-text source layers:
 * - local_mp4: existing raster+FFmpeg engine
 * - jianying_native: Xiaocongcut /add_text plaintext materials.texts (NOT PNG)
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  exportOwnTextComposition,
  listOwnTextLayers,
  mapOwnStyleToNative,
  precheckOwnTextNativeExport,
  type OwnTextLayer,
} from './local-styled-text.js'
import { spaceAssetRoot } from './spaces.js'

export type XiaocongcutFetch = (
  baseUrl: string,
  path: string,
  body?: Record<string, unknown>,
) => Promise<{ error?: string; data?: any }>

export type DualExportArgs = {
  spaceId: string
  xiaocongcutBaseUrl: string
  fetch: XiaocongcutFetch
  /** create_draft / save_draft helpers from host; keep draft id in host workspace */
  createDraft: (args: { width?: number; height?: number }, spaceId: string) => Promise<any>
  saveDraft: (
    args: {
      draft_id?: string
      draft_folder?: string
      project_name?: string
      auto_deploy?: boolean
      auto_reload?: boolean
    },
    spaceId: string,
  ) => Promise<any>
  getLastDraftId: (spaceId: string) => string
  layer_ids?: string[]
  target?: string
  accept_native_approx?: boolean
  width?: number
  height?: number
  duration?: number
  bg_color?: string
  project_name?: string
}

function jsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function resolveTarget(raw: string): 'local_mp4' | 'jianying_native' | 'both' | '' {
  const t = String(raw || 'both').trim() || 'both'
  if (t === 'local' || t === 'local_mp4') return 'local_mp4'
  if (t === 'native' || t === 'jianying_native') return 'jianying_native'
  if (t === 'both') return 'both'
  return ''
}

export async function exportOwnTextDualPathCore(args: DualExportArgs) {
  const target = resolveTarget(args.target || 'both')
  if (!target) {
    return jsonSafe({ success: false, error: 'target 须为 local_mp4 | jianying_native | both' })
  }
  const spaceId = args.spaceId
  const listed = listOwnTextLayers(spaceId)
  if (!listed.success) return listed as any
  let layers = (listed.layers || []) as OwnTextLayer[]
  if (args.layer_ids?.length) {
    const want = new Set(args.layer_ids.map(String))
    layers = layers.filter((L) => want.has(L.id))
    if (layers.length !== want.size) {
      return jsonSafe({ success: false, error: '部分 layer_ids 不属于本公司或不存在' })
    }
  }
  if (!layers.length) return jsonSafe({ success: false, error: '无自有文字层可导出' })

  const wantLocal = target === 'local_mp4' || target === 'both'
  const wantNative = target === 'jianying_native' || target === 'both'
  const nativePlan = precheckOwnTextNativeExport(layers)

  if (wantNative) {
    if (nativePlan.status === 'blocked') {
      return jsonSafe({
        success: false,
        status: 'blocked',
        error: '存在无法映射到原生 /add_text 的样式，已拒绝（不会 PNG 冒充原生文字）',
        native_plan: nativePlan,
        honesty: nativePlan.honesty,
      })
    }
    if (nativePlan.status === 'needs_confirmation' && !args.accept_native_approx) {
      return jsonSafe({
        success: false,
        status: 'needs_confirmation',
        error:
          '部分样式在原生侧仅为近似（渐变/霓虹/多层描边/浮雕等）。若接受近似 solid+border(+shadow)，请传 accept_native_approx=true。不会静默降级。',
        native_plan: nativePlan,
        honesty: nativePlan.honesty,
      })
    }
  }

  const out: Record<string, unknown> = {
    success: true,
    target,
    layer_ids: layers.map((L) => L.id),
    revisions: Object.fromEntries(layers.map((L) => [L.id, L.revision])),
    native_plan: wantNative ? nativePlan : null,
    honesty:
      '双路共用自有文字源参数。本地MP4=自有栅格引擎；原生草稿=materials.texts 明文（非PNG）。近似样式仅在 accept_native_approx 后写入。结构可检≠剪映 UI 已验收。',
  }

  if (wantLocal) {
    const local = exportOwnTextComposition({
      spaceId,
      layerIds: layers.map((L) => L.id),
      width: args.width,
      height: args.height,
      durationSec: args.duration,
      bgColor: args.bg_color,
    })
    out.local_mp4 = local
    if (!(local as any).success) {
      out.success = false
      out.error = (local as any).error || 'local_mp4 export failed'
      return jsonSafe(out)
    }
  }

  if (wantNative) {
    const width = Number(args.width) || 720
    const height = Number(args.height) || 1280
    const isolatedRoot = join(spaceAssetRoot(spaceId), 'own-text-native-drafts')
    mkdirSync(isolatedRoot, { recursive: true, mode: 0o700 })
    if (/\/Movies\/|\/Containers\/|JianyingPro\/User Data\/Projects|CapCut\/User Data\/Projects/.test(isolatedRoot)) {
      return jsonSafe({
        success: false,
        error: '隔离草稿根异常落在剪映 Projects/Movies/Containers，已中止',
        local_mp4: out.local_mp4 || null,
      })
    }

    const created = await args.createDraft({ width, height }, spaceId)
    const draft_id =
      String((created as any).draft_id || (created as any).output?.draft_id || '').trim() ||
      String(args.getLastDraftId(spaceId) || '').trim()
    if (!draft_id) {
      return jsonSafe({
        success: false,
        error: `create_draft failed: ${(created as any).error || 'no draft_id'}`,
        create_draft: created,
        local_mp4: out.local_mp4 || null,
      })
    }

    const nativeAdds: any[] = []
    for (const L of layers) {
      const mapping = mapOwnStyleToNative(L)
      if (mapping.fidelity === 'unsupported') {
        return jsonSafe({
          success: false,
          error: `层 ${L.id} 样式不支持原生映射`,
          native_plan: nativePlan,
          local_mp4: out.local_mp4 || null,
        })
      }
      const end = Number(L.startSec) + Number(L.durationSec)
      const payload: Record<string, unknown> = {
        draft_id,
        text: L.text,
        start: L.startSec,
        end,
        transform_x: L.transformX,
        transform_y: L.transformY,
        font_color: mapping.native.font_color,
        font_size: mapping.native.font_size,
        border_color: mapping.native.border_color,
        border_width: mapping.native.border_width,
        shadow_enabled: !!mapping.native.shadow_enabled,
        track_name: `own_text_native_${L.id}`,
        width,
        height,
      }
      if (mapping.native.intro_animation) {
        payload.intro_animation = mapping.native.intro_animation
        payload.intro_duration = 0.45
      }
      const result = await args.fetch(args.xiaocongcutBaseUrl, '/add_text', payload)
      if (result.error || !result.data?.success) {
        return jsonSafe({
          success: false,
          error: `add_text failed for layer ${L.id}: ${result.error || result.data?.error || 'unknown'}`,
          local_mp4: out.local_mp4 || null,
          native_adds: nativeAdds,
        })
      }
      nativeAdds.push({
        layer_id: L.id,
        revision: L.revision,
        fidelity: mapping.fidelity,
        gaps: mapping.gaps,
        text: L.text,
        add_text_output: result.data.output ?? null,
      })
    }

    const project_name = String(args.project_name || `own-text-${draft_id}`)
      .replace(/[^\w\u4e00-\u9fff\-]+/g, '_')
      .slice(0, 60)
    const saved = await args.saveDraft(
      {
        draft_id,
        draft_folder: isolatedRoot,
        project_name,
        auto_deploy: false,
        auto_reload: false,
      },
      spaceId,
    )

    let verify: Record<string, unknown> = { ok: false }
    try {
      const draftPath =
        String((saved as any).draft_path || (saved as any).extract?.path || '').trim() ||
        join(isolatedRoot, project_name)
      const candidates = [
        join(draftPath, 'draft_info.json'),
        join(draftPath, 'draft_content.json'),
        join(isolatedRoot, draft_id, 'draft_info.json'),
        join(isolatedRoot, project_name, 'draft_info.json'),
      ]
      let draftJson: any = null
      let used = ''
      for (const c of candidates) {
        if (existsSync(c)) {
          draftJson = JSON.parse(readFileSync(c, 'utf8'))
          used = c
          break
        }
      }
      if (!draftJson) {
        verify = { ok: false, error: 'saved draft json not found under isolated root', tried: candidates }
      } else {
        const texts = draftJson.materials?.texts || []
        const foundPlain: string[] = []
        for (const t of texts) {
          try {
            const c = typeof t.content === 'string' ? JSON.parse(t.content) : t.content
            const plain = String(c?.text || '')
            if (plain) foundPlain.push(plain)
          } catch { /* ignore */ }
        }
        const expected = layers.map((L) => L.text)
        const allPresent = expected.every((tx) => foundPlain.includes(tx))
        const anyImageType = texts.some((t: any) => t.type === 'photo' || t.type === 'image')
        verify = {
          ok: allPresent && foundPlain.length > 0 && !anyImageType,
          draft_json: used,
          texts_count: texts.length,
          plains: foundPlain,
          expected,
          note: '结构检查：materials.texts 含明文；非 PNG。剪映 UI 可编辑需真人打开验收。',
        }
      }
    } catch (e: any) {
      verify = { ok: false, error: String(e?.message || e) }
    }

    out.jianying_native = {
      draft_id,
      save: saved,
      adds: nativeAdds,
      draft_folder: isolatedRoot,
      auto_deploy: false,
      verify,
      accepted_approx: !!args.accept_native_approx && nativePlan.hasApprox,
    }
    if (!(saved as any).success && !(saved as any).saved) {
      out.success = false
      out.error = (saved as any).error || 'save_draft failed'
    } else if (!verify.ok) {
      out.success = false
      out.error = '原生草稿已尝试保存，但 texts 明文校验未通过（未把 PNG 当成功）'
    }
  }

  return jsonSafe(out)
}
