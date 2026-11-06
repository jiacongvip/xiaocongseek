import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { mergeNewApiCredential, syncNewApiCredential } from '../dist/new-api-credential.js'
const dir = mkdtempSync(join(tmpdir(), 'dh-credentials-test-'))
try {
  const file = join(dir, '.credentials.yaml')
  const original = 'version: 1\n# retained comment\nrefs:\n  OTHER_KEY: mock-other\nrecords:\n  test/key:\n    kind: api-key\n    apiKey: mock-record\n'
  writeFileSync(file, original)
  mergeNewApiCredential(file, 'sk-mock-newapi')
  let data = parse(readFileSync(file, 'utf8'))
  assert.equal(data.refs.NEW_API_TOKEN, 'sk-mock-newapi')
  assert.equal(data.refs.OTHER_KEY, 'mock-other')
  assert.deepEqual(data.records, parse(original).records)
  assert(readFileSync(file, 'utf8').includes('# retained comment'))
  assert.equal(statSync(file).mode & 0o777, 0o600)
  mergeNewApiCredential(file)
  data = parse(readFileSync(file, 'utf8'))
  assert.equal(data.refs.NEW_API_TOKEN, undefined)
  assert.equal(data.refs.OTHER_KEY, 'mock-other')
  writeFileSync(file, 'refs: [invalid]\n')
  assert.throws(() => mergeNewApiCredential(file, 'mock'), /同步失败/)
  assert.equal(readFileSync(file, 'utf8'), 'refs: [invalid]\n')
  const calls = []
  const ctx = { get: name => { assert.equal(name, 'credentials'); return {
    set: async (ref, token) => calls.push(['set', ref, token]),
    unset: async ref => calls.push(['unset', ref]),
  } } }
  await syncNewApiCredential(ctx, 'mock-token')
  await syncNewApiCredential(ctx)
  assert.deepEqual(calls, [['set', 'NEW_API_TOKEN', 'mock-token'], ['unset', 'NEW_API_TOKEN']])
  console.log('PASS: optional service set/unset; fallback preserves refs/records/comments, 0600, malformed-store refusal')
} finally { rmSync(dir, { recursive: true, force: true }) }
