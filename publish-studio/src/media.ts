
import { copyFileSync, mkdirSync, existsSync, realpathSync, createReadStream } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { isSpaceId, spaceRoot } from './paths.js'

async function sha256(path: string) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path)) h.update(chunk)
  return h.digest('hex')
}

/** Stage caller-provided local files into this company plugin sandbox. Rejects path escape after realpath. */
export async function stageCompanyMedia(spaceId: string, input: { videoPath: string; coverPath: string; tag?: string }) {
  if (!isSpaceId(spaceId)) throw new Error('非法公司')
  const video = realpathSync(input.videoPath)
  const cover = realpathSync(input.coverPath)
  if (!existsSync(video) || !existsSync(cover)) throw new Error('媒体文件不存在')
  const dir = join(spaceRoot(spaceId), 'media', (input.tag || randomBytes(8).toString('hex')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'staged')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const outVideo = join(dir, 'video' + extname(video))
  const outCover = join(dir, 'cover' + extname(cover))
  copyFileSync(video, outVideo)
  copyFileSync(cover, outCover)
  return {
    videoPath: realpathSync(outVideo),
    coverPath: realpathSync(outCover),
    videoHash: await sha256(outVideo),
    coverHash: await sha256(outCover),
  }
}
