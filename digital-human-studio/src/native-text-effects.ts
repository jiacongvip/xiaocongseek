/**
 * Native Jianying/CapCut text_effect (花字) / bubble ID helpers.
 * IDs are platform resource references — not locally rendered PNG, not Xiaocongcut cloud Effect IDs.
 * Catalog entries are copied from public open-source demos/source only; resource cache/VIP
 * status on a given machine is unknown until opened in Jianying/CapCut.
 */

export type NativeEffectKind = 'text_effect' | 'bubble'

export type NativeEffectCatalogEntry = {
  id: string
  kind: NativeEffectKind
  /** Human label from source; may not match UI locale. */
  label: string
  /** bubble only: companion resource_id when source listed both */
  resourceId?: string
  /** true | false | unknown — from source metadata when present */
  vip: boolean | 'unknown'
  source: string
  sourceUrl: string
  notes: string
}

/** Digit-only platform IDs observed in public demos (flower ≈ 16–22 digits; bubble effect_id may be shorter). */
export function isNativePlatformEffectId(raw: unknown, opts?: { role?: 'flower' | 'bubble_effect' | 'bubble_resource' }): {
  ok: boolean
  id?: string
  error?: string
} {
  if (raw == null || raw === '') {
    return { ok: false, error: 'effect id is empty' }
  }
  const id = String(raw).trim()
  if (!id) return { ok: false, error: 'effect id is empty' }
  // Reject cloud-style / UUID / hex-with-letters / path-like encodings.
  if (/[^0-9]/.test(id)) {
    return {
      ok: false,
      error:
        'rejected non-digit id: native Jianying/CapCut text_effect/bubble ids are decimal digit strings (not UUIDs, not Xiaocongcut cloud Effect encodings)',
    }
  }
  const role = opts?.role || 'flower'
  if (role === 'flower' || role === 'bubble_resource') {
    if (id.length < 16 || id.length > 22) {
      return {
        ok: false,
        error: `${role} id length ${id.length} out of 16–22 digit range for native platform resource ids`,
      }
    }
  } else {
    // bubble_effect_id in GuanYixuan demo is short ("361595"); allow 4–22 digits.
    if (id.length < 4 || id.length > 22) {
      return {
        ok: false,
        error: `bubble_effect_id length ${id.length} out of 4–22 digit range`,
      }
    }
  }
  return { ok: true, id }
}

/**
 * Curated public IDs only. Prefer entries with vip:false when choosing defaults for demos.
 * Do NOT claim free/cached; Jianying may still need network to fetch effect packs.
 */
export const NATIVE_TEXT_EFFECT_CATALOG: NativeEffectCatalogEntry[] = [
  {
    id: '7296357486490144036',
    kind: 'text_effect',
    label: 'demo_flower (GuanYixuan pyJianYingDraft demo.py)',
    vip: 'unknown',
    source: 'GuanYixuan/pyJianYingDraft demo.py add_effect',
    sourceUrl: 'https://github.com/GuanYixuan/pyJianYingDraft/blob/main/demo.py',
    notes: 'Public demo flower id. Cache/VIP unknown on this machine; opening draft may trigger Jianying download.',
  },
  {
    id: '7336825073334078725',
    kind: 'text_effect',
    label: 'demo_flower (GuanYixuan pyCapCut demo.py)',
    vip: 'unknown',
    source: 'GuanYixuan/pyCapCut demo.py add_effect',
    sourceUrl: 'https://github.com/GuanYixuan/pyCapCut/blob/main/demo.py',
    notes: 'CapCut-oriented demo id; may or may not resolve in Jianying. Resource status unknown.',
  },
  {
    id: '7371124431713832201',
    kind: 'text_effect',
    label: '黄色渐变立体发光花字',
    vip: false,
    source: 'aoguai/pyJianYingDraft metadata/text_effect.py (is_vip=False)',
    sourceUrl: 'https://github.com/aoguai/pyJianYingDraft/blob/main/pyJianYingDraft/metadata/text_effect.py',
    notes: 'Metadata only (id+md5). Not a bundled asset. Source marks non-VIP; local cache still unknown.',
  },
  {
    id: '6896143862222441735',
    kind: 'text_effect',
    label: '橙色立体花字',
    vip: false,
    source: 'aoguai/pyJianYingDraft metadata/text_effect.py (is_vip=False)',
    sourceUrl: 'https://github.com/aoguai/pyJianYingDraft/blob/main/pyJianYingDraft/metadata/text_effect.py',
    notes: 'Metadata only. Source marks non-VIP; local cache still unknown.',
  },
  {
    id: '7127614731187211551',
    kind: 'text_effect',
    label: '综艺 黄色红边',
    vip: false,
    source: 'aoguai/pyJianYingDraft metadata/text_effect.py (is_vip=False)',
    sourceUrl: 'https://github.com/aoguai/pyJianYingDraft/blob/main/pyJianYingDraft/metadata/text_effect.py',
    notes: 'Metadata only. Source marks non-VIP; local cache still unknown.',
  },
  {
    id: '7405027108893756707',
    kind: 'text_effect',
    label: '彩色微立体花字',
    vip: false,
    source: 'aoguai/pyJianYingDraft metadata/text_effect.py (is_vip=False)',
    sourceUrl: 'https://github.com/aoguai/pyJianYingDraft/blob/main/pyJianYingDraft/metadata/text_effect.py',
    notes: 'Metadata only. Source marks non-VIP; local cache still unknown.',
  },
  {
    id: '7510996426575449368',
    kind: 'text_effect',
    label: '白色花字',
    vip: false,
    source: 'aoguai/pyJianYingDraft metadata/text_effect.py (is_vip=False)',
    sourceUrl: 'https://github.com/aoguai/pyJianYingDraft/blob/main/pyJianYingDraft/metadata/text_effect.py',
    notes: 'Metadata only. Source marks non-VIP; local cache still unknown.',
  },
  {
    id: '361595',
    kind: 'bubble',
    label: 'bubble demo (GuanYixuan pyJianYingDraft)',
    resourceId: '6742029398926430728',
    vip: 'unknown',
    source: 'GuanYixuan/pyJianYingDraft demo.py add_bubble',
    sourceUrl: 'https://github.com/GuanYixuan/pyJianYingDraft/blob/main/demo.py',
    notes: 'Requires both bubble_effect_id and bubble_resource_id. Resource status unknown.',
  },
]

export function listNativeTextEffects(filter?: { kind?: NativeEffectKind; vip?: boolean | 'unknown' }) {
  let items = NATIVE_TEXT_EFFECT_CATALOG.slice()
  if (filter?.kind) items = items.filter((x) => x.kind === filter.kind)
  if (filter?.vip !== undefined) items = items.filter((x) => x.vip === filter.vip)
  return {
    success: true as const,
    kind: 'native_platform_effect_id_catalog',
    honesty:
      'These are digit platform resource ids for native editable text (materials.texts + text_effect). Not PNG overlays. Not Xiaocongcut cloud Effect IDs. Assets are NOT bundled; Jianying/CapCut may download on open. VIP/cache on this machine is unverified.',
    count: items.length,
    effects: items,
  }
}

export function resolveNativeFlowerEffectId(input?: string | null): {
  ok: boolean
  id?: string
  catalog?: NativeEffectCatalogEntry
  error?: string
  warning?: string
} {
  if (input == null || String(input).trim() === '') {
    return { ok: true }
  }
  const checked = isNativePlatformEffectId(input, { role: 'flower' })
  if (!checked.ok) return { ok: false, error: checked.error }
  const catalog = NATIVE_TEXT_EFFECT_CATALOG.find((x) => x.kind === 'text_effect' && x.id === checked.id)
  const warning = catalog
    ? `matched catalog «${catalog.label}»; vip=${String(catalog.vip)}; ${catalog.notes}`
    : 'id not in curated public catalog; still digit-format ok, but name/VIP/cache unknown — Jianying may fail to load or require network/membership'
  return { ok: true, id: checked.id, catalog, warning }
}

export function resolveNativeBubbleIds(input: {
  bubble_effect_id?: string | null
  bubble_resource_id?: string | null
}): {
  ok: boolean
  bubble_effect_id?: string
  bubble_resource_id?: string
  error?: string
  warning?: string
} {
  const be = input.bubble_effect_id != null && String(input.bubble_effect_id).trim() !== ''
  const br = input.bubble_resource_id != null && String(input.bubble_resource_id).trim() !== ''
  if (!be && !br) return { ok: true }
  if (be !== br) {
    return { ok: false, error: 'bubble_effect_id and bubble_resource_id must be provided together' }
  }
  const e = isNativePlatformEffectId(input.bubble_effect_id, { role: 'bubble_effect' })
  if (!e.ok) return { ok: false, error: `bubble_effect_id: ${e.error}` }
  const r = isNativePlatformEffectId(input.bubble_resource_id, { role: 'bubble_resource' })
  if (!r.ok) return { ok: false, error: `bubble_resource_id: ${r.error}` }
  const catalog = NATIVE_TEXT_EFFECT_CATALOG.find(
    (x) => x.kind === 'bubble' && x.id === e.id && (!x.resourceId || x.resourceId === r.id),
  )
  return {
    ok: true,
    bubble_effect_id: e.id,
    bubble_resource_id: r.id,
    warning: catalog
      ? `matched catalog bubble «${catalog.label}»; resource status unknown`
      : 'bubble ids digit-ok but not in curated catalog; cache/VIP unknown',
  }
}


/** Normalize alias for matching catalog labels / short keys. */
export function normalizeFlowerAlias(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-／/]+/g, '')
}

/**
 * Resolve flower by digit id OR human alias from curated catalog.
 * Prefer vip:false entries for defaultName 'default'|'推荐'|'默认花字'.
 */
export function resolveFlowerStyleAlias(input?: string | null): {
  ok: boolean
  id?: string
  catalog?: NativeEffectCatalogEntry
  error?: string
  warning?: string
  usedAlias?: string
} {
  if (input == null || String(input).trim() === '') return { ok: true }
  const raw = String(input).trim()
  // Digit id path
  if (/^\d+$/.test(raw)) {
    return resolveNativeFlowerEffectId(raw)
  }
  const key = normalizeFlowerAlias(raw)
  const defaults = new Set(['default', '默认', '默认花字', '推荐', '推荐花字', '花字', 'nativeflower', 'texteffect'])
  const flowers = NATIVE_TEXT_EFFECT_CATALOG.filter((x) => x.kind === 'text_effect')
  if (defaults.has(key) || defaults.has(raw)) {
    const pick = flowers.find((x) => x.vip === false) || flowers[0]
    if (!pick) return { ok: false, error: 'catalog has no text_effect entries' }
    return {
      ok: true,
      id: pick.id,
      catalog: pick,
      usedAlias: raw,
      warning: `alias「${raw}」→ ${pick.label} (${pick.id}); vip=${String(pick.vip)}; ${pick.notes}`,
    }
  }
  const hit = flowers.find((x) => {
    const label = normalizeFlowerAlias(x.label)
    return label === key || label.includes(key) || key.includes(label) || normalizeFlowerAlias(x.id) === key
  })
  if (!hit) {
    const names = flowers.map((x) => x.label).slice(0, 12).join(' / ')
    return {
      ok: false,
      error: `unknown flower_style「${raw}」; use dh_list_native_text_effects or one of: 默认花字, ${names}`,
    }
  }
  return {
    ok: true,
    id: hit.id,
    catalog: hit,
    usedAlias: raw,
    warning: `alias「${raw}」→ ${hit.label} (${hit.id}); vip=${String(hit.vip)}; ${hit.notes}`,
  }
}
