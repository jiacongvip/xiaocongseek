import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const isolatedHome = mkdtempSync(join(tmpdir(), 'xdh-hotboard-'))
process.env.HOME = isolatedHome
process.env.USERPROFILE = isolatedHome

const m = await import(pathToFileURL(join(pluginRoot, 'dist/industry-hotboard.js')).href)

{
  const preview = m.resolveIndustryHotboardQuery({})
  assert.equal(preview.usedFallback, true)
  assert.equal(preview.source, 'fallback')
  assert.equal(preview.query, '装修 瓷砖')
}

{
  const preview = m.resolveIndustryHotboardQuery({
    spaceName: '杭州岩板店',
    brief: { identity: '城西瓷砖店', business: '岩板、卫生间翻新', audience: '装修业主' },
  })
  assert.equal(preview.usedFallback, false)
  assert.equal(preview.source, 'brief')
  assert.ok(preview.parts.includes('岩板') || preview.query.includes('岩板'))
  assert.ok(preview.parts.includes('卫生间翻新') || preview.query.includes('卫生间翻新') || preview.query.includes('瓷砖'))
}

{
  const preview = m.resolveIndustryHotboardQuery({
    brief: { business: '全屋定制' },
    override: '门窗 铝门窗',
  })
  assert.equal(preview.source, 'override')
  assert.equal(preview.query, '门窗 铝门窗')
}

{
  const ranked = m.rankIndustrySampleHits([
    { title: '低赞', likedCount: '2', commentCount: '0', sourceKind: 'keyword_search' },
    { title: '高赞', likedCount: '88', commentCount: '12', sourceKind: 'keyword_search', url: 'https://www.xiaohongshu.com/explore/1' },
  ])
  assert.equal(ranked[0].title, '高赞')
  assert.equal(ranked[0].rank, 1)
  assert.equal(ranked[0].sourceKind, 'keyword_search')
}

{
  const spaceId = 'co-hotboard01'
  const board = {
    version: 1,
    spaceId,
    query: '瓷砖',
    parts: ['瓷砖'],
    usedFallback: false,
    source: 'brief',
    platform: 'xhs',
    collectedAt: Date.now(),
    officialHotSearch: false,
    sourceKind: 'keyword_search',
    sortNote: '小红书搜索默认按最热排（popularity_descending）',
    hits: [{ rank: 1, title: '岩板', engagementScore: 9, sourceKind: 'keyword_search' }],
  }
  m.saveIndustryHotboard(spaceId, board)
  const loaded = m.loadIndustryHotboard(spaceId)
  assert.equal(loaded?.query, '瓷砖')
  assert.equal(loaded?.officialHotSearch, false)
  assert.equal(loaded?.hits[0].title, '岩板')
}

{
  const cap = m.industryHotboardCapability()
  assert.equal(cap.industryHotBoard.wiredInPlugin, true)
  assert.equal(cap.industryHotBoard.officialHotSearch, false)
  assert.equal(cap.industryHotBoard.defaultPlatform, 'xhs')
  assert.equal(cap.industryHotBoard.crawlerType, 'search')
}

const detectedRoot = join(process.env.HOME === isolatedHome ? '/Users/jiacong/Desktop/开发文件/MediaCrawler' : '', '')
const mcRoot = '/Users/jiacong/Desktop/开发文件/MediaCrawler'
const python = join(mcRoot, '.venv/bin/python')
const fakeRunner = async (plan) => {
  assert.equal(plan.mode, 'search')
  assert.equal(plan.argv[plan.argv.indexOf('--type') + 1], 'search')
  assert.equal(plan.argv[plan.argv.indexOf('--platform') + 1], 'xhs')
  mkdirSync(plan.saveDataPath, { recursive: true })
  writeFileSync(
    join(plan.saveDataPath, 'hits.jsonl'),
    JSON.stringify({
      aweme_id: 'note-1',
      title: '岩板卫生间',
      liked_count: '66',
      comment_count: '8',
      aweme_url: 'https://www.xiaohongshu.com/explore/note-1',
    }) + '\n',
  )
  return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, mock: true }
}

const run = await m.runIndustryHotboard({
  spaceId: 'co-hotboard02',
  spaceName: '岩板店',
  brief: { business: '岩板瓷砖' },
  pluginConfig: {
    mediaCrawlerRoot: mcRoot,
    mediaCrawlerPython: python,
    mediaCrawlerEnabled: true,
    mediaCrawlerTimeoutMs: 60000,
  },
  runner: fakeRunner,
})
assert.equal(run.success, true, run.task?.error)
assert.equal(run.preview.source, 'brief')
assert.equal(run.board?.officialHotSearch, false)
assert.equal(run.board?.platform, 'xhs')
assert.equal(run.board?.hits[0].title, '岩板卫生间')
assert.equal(run.task.sourceKind, 'keyword_search')

void detectedRoot
console.log('PASS: industry-hotboard keywords/rank/snapshot/search')
rmSync(isolatedHome, { recursive: true, force: true })
