import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type MixcutMusic = {
  id: 'lively' | 'steady'
  name: string
  file: string
  /** Timeline gain under the voice. */
  volume: number
}

/** Original beds shipped with the plugin. Customers pick by the plain name. */
export const MIXCUT_MUSIC: MixcutMusic[] = [
  { id: 'lively', name: '热闹一点', file: 'lively.mp3', volume: 0.45 },
  { id: 'steady', name: '稳一点', file: 'steady.mp3', volume: 0.45 },
]

export function musicChoiceMenu(): string {
  return '热闹一点 / 稳一点 / 先不要'
}

export function pickMixcutMusic(wanted = ''): MixcutMusic | 'none' | undefined {
  const key = String(wanted || '').trim()
  if (!key) return undefined
  if (/先不要|不要音乐|不用音乐|别放音乐|无音乐|^不要$|^不用$|^none$/i.test(key)) return 'none'
  const lower = key.toLowerCase()
  if (lower === 'lively' || key.includes('热闹')) return MIXCUT_MUSIC[0]
  if (lower === 'steady' || key.includes('稳一点') || key === '稳') return MIXCUT_MUSIC[1]
  return MIXCUT_MUSIC.find(item => item.id === lower || item.name === key)
}

export function mixcutMusicFile(item: MixcutMusic): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'music', item.file)
}

export function mixcutMusicReady(item: MixcutMusic): boolean {
  return existsSync(mixcutMusicFile(item))
}

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])

export type MusicHit = {
  name: string
  path: string
  source: 'builtin' | 'shelf' | 'cabinet'
  note: string
  score: number
}

export type MusicCandidate = {
  name: string
  path: string
  note?: string
}

/** Local shelf the shop can drop its own tracks into. Not the internet. */
export function mixcutMusicShelf(): string {
  return join(homedir(), '.dsh', 'music')
}

function moodWords(query: string): string[] {
  const text = query.toLowerCase()
  const words = new Set<string>()
  const add = (group: string[]) => { for (const word of group) words.add(word) }
  if (/热闹|欢快|轻快|活泼|带劲|upbeat|lively|happy/.test(text)) add(['热闹', '欢快', '轻快', '活泼', 'lively', 'upbeat'])
  if (/稳|舒缓|安静|轻柔|calm|steady|soft/.test(text)) add(['稳', '舒缓', '安静', 'steady', 'calm'])
  for (const part of text.split(/[\s,，、/]+/)) {
    const token = part.trim()
    if (token) words.add(token)
  }
  return [...words]
}

function scoreMusic(name: string, note: string, query: string): number {
  const hay = `${name} ${note}`.toLowerCase()
  const words = moodWords(query)
  if (words.length === 0) return 1
  let score = 0
  for (const word of words) {
    if (hay.includes(word)) score += 3
  }
  return score
}

function walkAudio(root: string, depth: number, out: MusicCandidate[]): void {
  if (depth < 0 || out.length >= 200 || !existsSync(root)) return
  let names: string[] = []
  try { names = readdirSync(root) } catch { return }
  for (const name of names) {
    if (name.startsWith('.')) continue
    const path = join(root, name)
    let info: ReturnType<typeof statSync>
    try { info = statSync(path) } catch { continue }
    if (info.isDirectory()) walkAudio(path, depth - 1, out)
    else if (AUDIO_EXT.has(extname(name).toLowerCase())) out.push({ name, path })
    if (out.length >= 200) return
  }
}

/**
 * Find a bed from the two shipped tracks, ~/.dsh/music, and this company's audio cabinet.
 * Does not search or download from the internet.
 */
export function findMixcutMusic(query = '', cabinet: MusicCandidate[] = []): {
  query: string
  shelf: string
  recommended: MusicHit | null
  hits: MusicHit[]
} {
  const hits: MusicHit[] = []
  for (const item of MIXCUT_MUSIC) {
    const path = mixcutMusicFile(item)
    if (!existsSync(path)) continue
    const note = item.id === 'lively' ? '热闹 轻快 无歌词' : '稳 舒缓 无歌词'
    hits.push({ name: item.name, path, source: 'builtin', note, score: scoreMusic(item.name, note, query) })
  }
  const shelf: MusicCandidate[] = []
  walkAudio(mixcutMusicShelf(), 2, shelf)
  for (const item of shelf) {
    const note = '曲库'
    const base = scoreMusic(item.name, note, query)
    hits.push({ name: basename(item.name), path: item.path, source: 'shelf', note, score: base > 0 ? base + 1 : 0 })
  }
  for (const item of cabinet) {
    if (!item.path || !existsSync(item.path)) continue
    const note = String(item.note || '素材柜')
    const base = scoreMusic(item.name, `${note} 素材柜`, query)
    hits.push({ name: item.name, path: item.path, source: 'cabinet', note, score: base > 0 ? base + 1 : 0 })
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh'))
  const recommended = hits.find(item => item.score > 0) ?? null
  return { query: query.trim(), shelf: mixcutMusicShelf(), recommended, hits: hits.slice(0, 12) }
}
