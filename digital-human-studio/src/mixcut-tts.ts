import { execFileSync } from 'node:child_process'
import { whichSync } from './platform.js'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

function resolveBin(name: 'ffmpeg' | 'ffprobe'): string {
  const candidates = [
    join(homedir(), '.local', 'bin', name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  try {
    return whichSync(name) || ''
  } catch {
    return ''
  }
}

export function probeAudioDuration(absolute: string): number {
  const ffprobe = resolveBin('ffprobe')
  if (!ffprobe || !absolute || !existsSync(absolute)) return 0
  try {
    const out = execFileSync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      absolute,
    ], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const seconds = Number(out)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  } catch {
    return 0
  }
}

export async function downloadNarrationAudio(url: string, outDir: string): Promise<{
  path: string
  duration: number
  bytes: number
}> {
  const target = String(url || '').trim()
  if (!/^https?:\/\//i.test(target)) throw new Error('配音地址无效')
  mkdirSync(outDir, { recursive: true })
  const response = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(90_000) })
  if (!response.ok) throw new Error(`配音下载失败 (${response.status})`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 64) throw new Error('配音文件是空的')
  const type = String(response.headers.get('content-type') || '')
  const ext = /wav/i.test(type) || /\.wav(\?|$)/i.test(target)
    ? 'wav'
    : /flac/i.test(type) || /\.flac(\?|$)/i.test(target)
      ? 'flac'
      : /mpeg|mp3/i.test(type) || /\.mp3(\?|$)/i.test(target)
        ? 'mp3'
        : 'wav'
  const path = join(outDir, `n-${randomUUID().replace(/-/g, '').slice(0, 10)}.${ext}`)
  writeFileSync(path, buffer)
  if (!existsSync(path) || statSync(path).size < 64) throw new Error('配音落盘失败')
  return { path, duration: probeAudioDuration(path), bytes: statSync(path).size }
}
