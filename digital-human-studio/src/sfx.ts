/**
 * 音效库读取 + 音效点校验。
 *
 * 音效文件在 `assets/sfx/*.wav`，全部由 `scripts/gen-sfx.py` 程序合成（无版权问题），
 * 元数据在 `assets/sfx/manifest.json`（id / 时长 / 峰值 / 用途 / 默认音量）。
 *
 * 这里只负责「找文件、校验参数」，怎么铺进草稿是 index.ts 的事。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 音效目录；dist 在包根下一层，所以上级就是包根。 */
export const SFX_DIR = join(PLUGIN_ROOT, 'assets', 'sfx')

export type SfxItem = {
  id: string
  file: string
  dur: number
  peak: number
  use: string
  gain: number
}

export type SfxCue = {
  /** 时间线上第几秒响，单位秒 */
  at: number
  id: string
  /** 覆盖默认音量；不传用 manifest 里按用途定好的 */
  gain?: number
}

let cache: SfxItem[] | undefined

/** 读 manifest；读不到就返回空数组（调用方据此报「音效库缺失」而不是崩）。 */
export function listSfx(): SfxItem[] {
  if (cache !== undefined) return cache
  const file = join(SFX_DIR, 'manifest.json')
  if (!existsSync(file)) {
    cache = []
    return cache
  }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const items = Array.isArray(data?.items) ? data.items : []
    cache = items.filter(
      (x: any) =>
        x &&
        typeof x.id === 'string' &&
        typeof x.file === 'string' &&
        Number.isFinite(Number(x.dur)) &&
        Number.isFinite(Number(x.gain)),
    )
  } catch {
    cache = []
  }
  return cache ?? []
}

export function sfxItem(id: string): SfxItem | undefined {
  return listSfx().find(item => item.id === id)
}

/** 拿音效文件的绝对路径；id 不认识或文件丢了返回 undefined。 */
export function sfxPath(id: string): string | undefined {
  const item = sfxItem(id)
  if (!item) return undefined
  const path = join(SFX_DIR, item.file)
  return existsSync(path) ? path : undefined
}

/**
 * 校验并规范化音效点。
 *
 * 严格校验而不是「猜一个近似值」：音效配错位置比没配更糟——观众会以为画面卡了。
 * @param raw - 模型传来的原始数组
 * @returns 按时间升序排好的音效点
 */
export function normalizeCues(raw: unknown): SfxCue[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('cues 不能为空，要传 [{ at: 3.2, id: "stamp" }] 这种数组')
  }
  if (raw.length > 200) {
    throw new Error(`一次最多 200 个音效点（收到 ${raw.length} 个）。全片铺满音效比不配更难听，挑重点。`)
  }
  const items = listSfx()
  if (items.length === 0) throw new Error('音效库为空（assets/sfx/manifest.json 缺失），先跑 scripts/gen-sfx.py')
  const known = new Set(items.map(item => item.id))

  const out: SfxCue[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i] as Record<string, unknown> | null
    const at = Number(row?.at)
    const id = String(row?.id ?? '').trim()
    if (!Number.isFinite(at) || at < 0) {
      throw new Error(`第 ${i + 1} 个音效的 at 必须是不小于 0 的秒数，收到 ${JSON.stringify(row?.at)}`)
    }
    if (!id) throw new Error(`第 ${i + 1} 个音效缺少 id`)
    if (!known.has(id)) {
      throw new Error(`没有叫「${id}」的音效。可用：${items.map(item => item.id).join(' / ')}`)
    }
    const rawGain = row?.gain
    let gain: number | undefined
    if (rawGain != null && rawGain !== '') {
      const n = Number(rawGain)
      if (!Number.isFinite(n)) throw new Error(`第 ${i + 1} 个音效的 gain 不是数字`)
      // 夹到 0~2：允许略高于默认，但不给增益 10 倍把整条片子炸掉的机会。
      gain = Math.min(2, Math.max(0, n))
    }
    out.push({ at, id, gain })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** 给模型看的紧凑清单：只列 id + 时长 + 用途，不带路径和峰值。 */
export function sfxCatalogForAgent(): Array<{ id: string; dur: number; use: string; gain: number }> {
  return listSfx().map(item => ({ id: item.id, dur: item.dur, use: item.use, gain: item.gain }))
}
