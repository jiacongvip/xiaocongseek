/** Image-capable XiaocongAPI model ids. Chat sync must keep these out of the LLM picker. */

export function isImageModelId(id: string): boolean {
  const value = id.trim().toLowerCase()
  if (!value || value.startsWith('xdh-')) return false
  return /(?:^|[-_/])(?:image|img|imagine-image)(?:$|[-_/])|dall-e|gpt-image|seedream|flux[-_.]|imagen|midjourney|^mj-|qwen-image|z-image|wan2\.\d+-t2i|wan2\.\d+-image|wanx.*t2i|grok-imagine/.test(value)
}

export function isChatModelId(id: string): boolean {
  const value = id.trim()
  if (!value || value.startsWith('xdh-')) return false
  return !isImageModelId(value)
}

const GROK_PUBLIC_PREFIXES = ['web/', 'console/', 'build/']

/** Prefer grok-imagine-image-lite over Web/grok-imagine-image-lite in the picker. */
export function canonicalImageModelId(id: string): string {
  const value = id.trim()
  const lower = value.toLowerCase()
  for (const prefix of GROK_PUBLIC_PREFIXES) {
    if (lower.startsWith(prefix)) return value.slice(prefix.length)
  }
  return value
}

export function ratioToImageSize(ratio: string, model = ''): string {
  const value = String(ratio || '').trim()
  if (/(?:grok-imagine|gpt-image)/i.test(model) && /^(auto|1:1|16:9|9:16|4:3|3:4|3:2|2:3)$/.test(value)) return value
  if (value === '9:16' || value === '3:4') return '1024x1792'
  if (value === '16:9' || value === '4:3') return '1792x1024'
  return '1024x1024'
}
