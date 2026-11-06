import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { isMap, parseDocument } from 'yaml'

/** Merge only this ref; malformed stores are never overwritten. No secret logging. */
export function mergeNewApiCredential(path: string, token?: string): void {
  const read = () => {
    try { return readFileSync(path, 'utf8') }
    catch (error: any) { if (error.code === 'ENOENT') return ''; throw error }
  }
  let tmp = ''
  try {
    mkdirSync(dirname(path), { recursive: true })
    for (let attempt = 0; attempt < 3; attempt++) {
      const original = read()
      const doc = parseDocument(original || 'version: 1\nrefs: {}\n')
      if (doc.errors.length || !isMap(doc.contents)) throw new Error('invalid store')
      if (!doc.has('refs')) doc.set('refs', {})
      if (!isMap(doc.get('refs', true))) throw new Error('invalid refs')
      if (token) doc.setIn(['refs', 'NEW_API_TOKEN'], token)
      else doc.deleteIn(['refs', 'NEW_API_TOKEN'])
      tmp = join(dirname(path), `.newapi-credential-${randomUUID()}.tmp`)
      writeFileSync(tmp, doc.toString(), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      // Re-read immediately before commit so ordinary concurrent edits are retried.
      if (read() !== original) { unlinkSync(tmp); tmp = ''; continue }
      renameSync(tmp, path); tmp = ''
      chmodSync(path, 0o600)
      return
    }
    throw new Error('store changed')
  } catch {
    // YAML parse errors may quote secrets: expose only a fixed message.
    throw new Error('New API 令牌同步失败；请检查本地凭据文件权限或格式')
  } finally {
    if (tmp) { try { unlinkSync(tmp) } catch { /* best effort */ } }
  }
}

export async function syncNewApiCredential(ctx: Context, token?: string): Promise<void> {
  try {
    const credentials = ctx.get('credentials')
    if (credentials) {
      const ref = credentialRef('NEW_API_TOKEN')
      if (token) await credentials.set(ref, token)
      else await credentials.unset(ref)
      return
    }
    mergeNewApiCredential(join(homedir(), '.dsh', '.credentials.yaml'), token)
  } catch {
    throw new Error('New API 令牌同步失败；请检查本地凭据服务或文件权限')
  }
}
