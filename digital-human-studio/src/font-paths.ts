/**
 * 字体路径归一化。
 *
 * 老工程/模板里，「字幕 font」可能存的是绝对文件路径，而且多半写的是作者本机的
 * `~/XiaocongcutAPI/fonts/Full-XXX.otf`。这地方一旦换电脑就不存在了 —— 预览退回
 * PingFang、导出跟预览对不上，甚至引擎直接缺字。
 *
 * 所有字体文件都已经随包放在 `vendor/xiaocongcut/fonts`，所以这里做一层「按文件名重定向」：
 * 只要 basename 能在包内找到同名文件，就换成包内绝对路径（运行时按当前安装位置算，
 * 客户装到哪都对）。找不到就原样保留，绝不把配方改坏。
 */
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const VENDOR_FONTS = join(PLUGIN_ROOT, 'vendor', 'xiaocongcut', 'fonts')

const FONT_FILE_RE = /\.(otf|ttf|ttc)$/i

/** 是文件路径（不是族名）才处理。命中包内同名字体时返回包内路径，否则给 undefined。 */
export function normalizeFontPath(font: unknown): string | undefined {
  const s = String(font ?? '')
  if (!s || !FONT_FILE_RE.test(s) || !/[\\/]/.test(s)) return undefined
  if (s.startsWith(VENDOR_FONTS)) return s
  const file = basename(s)
  const hit = join(VENDOR_FONTS, file)
  return existsSync(hit) ? hit : undefined
}

/** 深拷贝式遍历：只改 `font` 字段里的旧路径，其余原样。 */
export function normalizeRecipeFonts<T>(input: T): T {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: any = {}
      for (const k of Object.keys(v)) {
        const val = (v as any)[k]
        if (k === 'font' && typeof val === 'string') {
          const fixed = normalizeFontPath(val)
          out[k] = fixed || val
        } else {
          out[k] = walk(val)
        }
      }
      return out
    }
    return v
  }
  return walk(input) as T
}
