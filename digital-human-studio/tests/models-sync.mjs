import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseModelIds,
  pickDefaultModel,
  mergeNewApiModelsIntoPatch,
  resolveNewApiBaseURL,
  buildNewApiProvider,
  discoverNewApiPatchPaths,
} from '../dist/new-api-models.js'

assert.deepEqual(parseModelIds({ data: [{ id: 'a' }, { id: 'a' }, { id: 'b' }, { id: '  ' }] }), ['a', 'b'])
assert.equal(pickDefaultModel(['deepseek-flash', 'deepseek-chat'], 'missing'), 'deepseek-chat')
assert.equal(pickDefaultModel(['deepseek-flash', 'x'], 'x'), 'x')
assert.equal(pickDefaultModel(['deepseek-flash', 'x'], null), 'deepseek-flash')
assert.equal(pickDefaultModel(['only'], null), 'only')
assert.equal(resolveNewApiBaseURL('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/v1')
assert.equal(resolveNewApiBaseURL('http://127.0.0.1:3000/v1'), 'http://127.0.0.1:3000/v1')
assert.equal(resolveNewApiBaseURL(''), 'http://127.0.0.1:3000/v1')
const built = buildNewApiProvider(['deepseek-chat'], { baseURL: 'http://127.0.0.1:3000' })
assert.equal(built.displayName, 'XiaocongAPI')
assert.equal(built.apiKeyEnv, 'NEW_API_TOKEN')
assert.equal(built.api, 'openai-completions')
assert.equal(built.baseURL, 'http://127.0.0.1:3000/v1')
assert.deepEqual(built.models, [{ id: 'deepseek-chat', name: 'deepseek-chat' }])

const dir = mkdtempSync(join(tmpdir(), 'dh-models-'))
try {
  const file = join(dir, 'cordis.patch.yml')
  writeFileSync(file, `# keep
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      newapi:
        displayName: XiaocongAPI
        apiKeyEnv: NEW_API_TOKEN
        api: openai-completions
        baseURL: http://127.0.0.1:3000/v1
        models:
          - id: stale
            name: stale
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: newapi
    model: stale
- id: other
  config:
    keep: true
`)
  const result = mergeNewApiModelsIntoPatch(file, ['deepseek-chat', 'deepseek-flash'], {
    defaultModel: 'deepseek-chat',
    baseURL: 'http://127.0.0.1:3000',
  })
  assert.equal(result.wrote, true)
  assert.deepEqual(result.previousIds, ['stale'])
  const text = readFileSync(file, 'utf8')
  assert.match(text, /deepseek-chat/)
  assert.match(text, /deepseek-flash/)
  assert.doesNotMatch(text, /stale/)
  assert.match(text, /keep: true/)
  assert.match(text, /displayName: XiaocongAPI/)
  assert.match(text, /model: deepseek-chat/)
  assert.match(text, /baseURL: http:\/\/127\.0\.0\.1:3000\/v1/)
  // must stay block-style (no flow providers: { ... })
  assert.doesNotMatch(text, /providers:\s*\{/)
  // empty ids must not wipe
  const again = mergeNewApiModelsIntoPatch(file, [], {})
  assert.equal(again.wrote, false)

  // recreate provider when patch has no newapi / no llm-pi-ai
  const empty = join(dir, 'empty.patch.yml')
  writeFileSync(empty, `# bare
- id: ui-theme
  name: '@deepseek-ai/dsh-client-ui-theme'
  config:
    preference: light
`)
  const created = mergeNewApiModelsIntoPatch(empty, ['deepseek-chat', 'deepseek-reasoner'], {
    defaultModel: 'deepseek-chat',
    baseURL: 'http://127.0.0.1:3000',
  })
  assert.equal(created.wrote, true)
  const createdText = readFileSync(empty, 'utf8')
  assert.match(createdText, /id: llm-pi-ai/)
  assert.match(createdText, /id: agent-default-model/)
  assert.match(createdText, /displayName: XiaocongAPI/)
  assert.match(createdText, /baseURL: http:\/\/127\.0\.0\.1:3000\/v1/)
  assert.match(createdText, /deepseek-reasoner/)
  assert.doesNotMatch(createdText, /providers:\s*\{/)

  // flow-style garbage must be rewritten to block
  const flow = join(dir, 'flow.patch.yml')
  writeFileSync(flow, `- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      {
        newapi:
          {
            displayName: XiaocongAPI,
            apiKeyEnv: NEW_API_TOKEN,
            api: openai-completions,
            models: [{ id: stale, name: stale }]
          }
      }
`)
  const fixed = mergeNewApiModelsIntoPatch(flow, ['deepseek-chat'], {
    baseURL: 'http://127.0.0.1:3000/v1',
  })
  assert.equal(fixed.wrote, true)
  const fixedText = readFileSync(flow, 'utf8')
  assert.doesNotMatch(fixedText, /providers:\s*\{/)
  assert.match(fixedText, /baseURL: http:\/\/127\.0\.0\.1:3000\/v1/)
  assert.match(fixedText, /deepseek-chat/)

  // discover always returns existing web/desktop paths (smoke: function callable)
  assert.ok(Array.isArray(discoverNewApiPatchPaths()))

  console.log('PASS: parse/pick/merge/recreate/block-yaml/baseURL')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
