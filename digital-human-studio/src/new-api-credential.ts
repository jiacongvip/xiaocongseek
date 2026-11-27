import type { Context } from '@deepseek-ai/cordis'
import { readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

/**
 * Credential reference branding.
 *
 * The store only ever sees the reference name; the brand is a compile-time
 * distinction. Declaring it here keeps this package free of a runtime import
 * that a packaged plugin cannot resolve.
 */
declare const credentialRefBrand: unique symbol
type CredentialRef = string & { readonly [credentialRefBrand]: true }

/** @param value - reference name. @returns the same name as a branded reference. */
function credentialRef(value: string): CredentialRef {
  return value as CredentialRef
}

/** Store key holding the XiaocongAPI token. */
const NEW_API_REF = 'NEW_API_TOKEN'

/**
 * Set or remove one reference in a `version`/`refs` YAML store without parsing
 * the whole document. Tokens are written as JSON-quoted scalars, which YAML
 * accepts, so no escaping rules are guessed here.
 * @param original - current store text.
 * @param token - token to store, or undefined to remove the reference.
 * @returns updated store text.
 */
function refsWithToken(original: string, token?: string): string {
  const source = original.trim() ? original : 'version: 1\nrefs: {}\n'
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const refsAt = lines.findIndex(line => /^refs\s*:/.test(line))
  if (refsAt < 0) {
    if (token === undefined) return source
    lines.push('refs:', `  ${NEW_API_REF}: ${JSON.stringify(token)}`)
    return lines.join('\n')
  }
  const inline = (lines[refsAt] ?? '').replace(/^refs\s*:/, '').trim()
  if (inline && inline !== '{}') throw new Error('invalid refs')
  let end = refsAt + 1
  while (end < lines.length && (lines[end] === '' || lines[end]?.startsWith(' '))) end++
  const block = lines.slice(refsAt + 1, end)
  const at = block.findIndex(line => new RegExp(`^\\s+${NEW_API_REF}\\s*:`).test(line))
  if (at >= 0) {
    if (token === undefined) block.splice(at, 1)
    else block[at] = `  ${NEW_API_REF}: ${JSON.stringify(token)}`
  } else if (token !== undefined) {
    block.push(`  ${NEW_API_REF}: ${JSON.stringify(token)}`)
  }
  lines.splice(refsAt + 1, end - refsAt - 1, ...block)
  return lines.join('\n')
}

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
      const next = refsWithToken(original, token)
      if (next === original) return
      tmp = join(dirname(path), `.newapi-credential-${randomUUID()}.tmp`)
      writeFileSync(tmp, next, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      // Re-read immediately before commit so ordinary concurrent edits are retried.
      if (read() !== original) { unlinkSync(tmp); tmp = ''; continue }
      renameSync(tmp, path); tmp = ''
      chmodSync(path, 0o600)
      return
    }
    throw new Error('store changed')
  } catch {
    // YAML quoting may expose secrets: raise only a fixed message.
    throw new Error('New API 令牌同步失败；请检查本地凭据文件权限或格式')
  } finally {
    if (tmp) { try { unlinkSync(tmp) } catch { /* best effort */ } }
  }
}

export async function syncNewApiCredential(ctx: Context, token?: string): Promise<void> {
  try {
    const credentials = ctx.get('credentials')
    if (credentials) {
      const ref = credentialRef(NEW_API_REF)
      if (token) await credentials.set(ref, token)
      else await credentials.unset(ref)
      return
    }
    mergeNewApiCredential(join(homedir(), '.dsh', '.credentials.yaml'), token)
  } catch {
    throw new Error('New API 令牌同步失败；请检查本地凭据服务或文件权限')
  }
}
