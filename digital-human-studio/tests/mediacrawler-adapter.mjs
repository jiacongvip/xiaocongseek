import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const isolatedHome = mkdtempSync(join(tmpdir(), 'xdh-mc-live-'))
process.env.HOME = isolatedHome
process.env.USERPROFILE = isolatedHome
// Production must NOT depend on these env gates
delete process.env.DH_MEDIACRAWLER_RUNNER
delete process.env.DH_MEDIACRAWLER_ALLOW_LIVE

const m = await import('../dist/mediacrawler-adapter.js')

assert.equal(m.defaultProductionRunner(), m.liveMcRunner)

const cap = m.mediacrawlerCapabilityReport({})
assert.equal(cap.productionDefaultRunner, 'live')
assert.equal(cap.fakeOnlyViaTestInjection, true)
assert.ok(cap.configured === true || cap.loginPhase === 'needs_setup')

// URL rules
assert.equal(m.parsePlatformMediaLink('https://www.douyin.com/video/1').platform, 'dy')
assert.equal(m.parsePlatformMediaLink('https://www.zhihu.com/question/1').mediaDownloadSupported, false)
assert.throws(() => m.parsePlatformMediaLink('http://127.0.0.1/x'), /内网/)

const spaceId = 'co-mclive01'

// Production handler WITHOUT injected runner must select live path:
// we intercept by wrapping: call with disabled config → needs_setup (no fake files)
const missing = await m.runPlatformMediaDownload({
  spaceId,
  slot: 'product',
  source: 'https://www.douyin.com/video/7123',
  pluginConfig: {
    mediaCrawlerRoot: '',
    mediaCrawlerPython: '',
    mediaCrawlerEnabled: false,
    mediaCrawlerTimeoutMs: 60000,
  },
})
assert.equal(missing.task.status, 'needs_setup')
assert.equal(missing.task.mock, false)
assert.equal(missing.task.runner, 'live')

// Detectable/local config + INJECTED fake only for chain test (explicit DI)
const detected = m.detectMediaCrawlerCandidate()
assert.ok(detected, 'desktop MC candidate should exist on this machine')
let liveSelected = false
const spyLive = async (plan, ctx) => {
  liveSelected = true
  // Do NOT create platform-success fiction: fail fast as needs_login without writing media
  return {
    exitCode: 1,
    stdout: '[BilibiliLogin.begin] Begin login Bilibili by qrcode ...\n',
    stderr: '请确认扫码已完成\n',
    timedOut: false,
    mock: false,
    loginSeen: true,
  }
}

const liveProbe = await m.runPlatformMediaDownload({
  spaceId,
  slot: 'product',
  source: 'https://www.bilibili.com/video/BV1xx411c7mD',
  pluginConfig: {
    mediaCrawlerRoot: detected.root,
    mediaCrawlerPython: detected.python,
    mediaCrawlerEnabled: true,
    mediaCrawlerTimeoutMs: 60000,
  },
  runner: spyLive,
})
assert.equal(liveSelected, true)
assert.equal(liveProbe.task.runner, 'injected')
assert.equal(liveProbe.task.mock, false)
assert.equal(liveProbe.task.status, 'needs_login')
assert.ok(liveProbe.task.loginHint)
assert.ok(liveProbe.task.argv?.includes('--get_media'))
assert.equal(liveProbe.task.argv?.includes('--cookies'), false)

// Explicit DI fake for argv/import unit only — must set mock note
const fakeResult = await m.runPlatformMediaDownload({
  spaceId,
  slot: 'logo',
  source: 'https://www.xiaohongshu.com/explore/abc',
  pluginConfig: {
    mediaCrawlerRoot: detected.root,
    mediaCrawlerPython: detected.python,
    mediaCrawlerEnabled: true,
    mediaCrawlerTimeoutMs: 60000,
  },
  runner: m.fakeMcRunnerForTests,
})
assert.equal(fakeResult.task.mock, true)
assert.equal(fakeResult.task.runner, 'injected')
assert.ok(String(fakeResult.task.note || '').includes('injected'))
assert.equal(fakeResult.success, true)

// zhihu reject
const z = await m.runPlatformMediaDownload({
  spaceId,
  slot: 'product',
  source: 'https://www.zhihu.com/question/9',
  pluginConfig: {
    mediaCrawlerRoot: detected.root,
    mediaCrawlerPython: detected.python,
    mediaCrawlerEnabled: true,
    mediaCrawlerTimeoutMs: 60000,
  },
})
assert.equal(z.task.status, 'rejected')


// Share-text URL extraction (抖音口令)
{
  const share = '3.00 wSL:/ :2pm q@e.od 07/17 demo # 抖音 https://v.douyin.com/63olGBmI40U/ 复制此链接'
  const parsed = m.parsePlatformMediaLink(share)
  assert.equal(parsed.platform, 'dy')
  assert.match(parsed.specifiedId, /v\.douyin\.com/)
}

// Controllable runner replay of real dy failure class (Playwright browser missing) — no live crawl
{
  const pwMissingStderr = `2026-11-09 21:20:56 MediaCrawler INFO (core.py:88) - [DouYinCrawler] 使用标准模式启动浏览器
Traceback (most recent call last):
  File "/Users/secretuser/Desktop/开发文件/MediaCrawler/media_platform/douyin/core.py", line 410, in launch_browser
    browser_context = await chromium.launch_persistent_context(
playwright._impl._errors.Error: BrowserType.launch_persistent_context: Executable doesn't exist at /Users/secretuser/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     playwright install                                     ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
cookie=SECRETVALUE token=abc123`
  const classified = m.classifyCliFailure({ exitCode: 1, stderr: pwMissingStderr, stdout: '', loginSeen: false })
  assert.equal(classified.code, 'playwright_browser_missing')
  assert.match(classified.error, /Playwright/)
  assert.match(classified.nextStep, /playwright install chromium/)
  assert.equal(classified.status, 'failed')
  assert.doesNotMatch(classified.detail, /secretuser/)
  assert.doesNotMatch(classified.detail, /SECRETVALUE/)
  assert.doesNotMatch(classified.detail, /abc123/)
  assert.match(classified.detail, /Executable doesn't exist/)

  const replay = await m.runPlatformMediaDownload({
    spaceId,
    slot: 'product',
    source: 'https://v.douyin.com/63olGBmI40U',
    pluginConfig: {
      mediaCrawlerRoot: detected.root,
      mediaCrawlerPython: detected.python,
      mediaCrawlerEnabled: true,
      mediaCrawlerTimeoutMs: 60000,
    },
    runner: async () => ({
      exitCode: 1,
      stdout: '',
      stderr: pwMissingStderr,
      timedOut: false,
      mock: false,
      loginSeen: false,
    }),
  })
  assert.equal(replay.success, false)
  assert.equal(replay.task.mock, false)
  assert.equal(replay.task.status, 'failed')
  assert.equal(replay.task.code, 'playwright_browser_missing')
  assert.match(String(replay.task.nextStep || ''), /playwright install/)
  assert.doesNotMatch(String(replay.task.detail || ''), /secretuser|SECRETVALUE/)
  // must NOT be mislabeled as needs_login
  assert.notEqual(replay.task.status, 'needs_login')
}



// exit0 + account blocked (real dy log shape) must NOT become no_media/needs_login
{
  const blockedStderr = `2026-11-09 22:24:04 MediaCrawler INFO (core.py:137) - [DouYinCrawler.start] pong=True, skip login (non-cookie or empty cookies)
2026-11-09 22:24:04 MediaCrawler INFO (core.py:235) - [DouYinCrawler.get_specified_awemes] Short link resolved to aweme ID: 7702542138755534090
2026-11-09 22:24:05 MediaCrawler ERROR (client.py:144) - request params incrr, response.text: 
2026-11-09 22:24:05 MediaCrawler ERROR (core.py:265) - [DouYinCrawler.get_aweme_detail] Get aweme detail error: account blocked, 
2026-11-09 22:24:05 MediaCrawler INFO (core.py:151) - [DouYinCrawler.start] Douyin Crawler finished ...`
  const c = m.classifyCliLogs({ exitCode: 0, stderr: blockedStderr, stdout: '', loginSeen: false })
  assert.ok(c)
  assert.equal(c.code, 'platform_restricted')
  assert.notEqual(c.status, 'needs_login')
  assert.match(c.error, /空正文|blocked|映射/)
  assert.match(c.nextStep, /停止|官方/)
  assert.match(String(c.nextStep), /互不共享|不共享|官方/)

  const replay = await m.runPlatformMediaDownload({
    spaceId,
    slot: 'product',
    source: 'https://v.douyin.com/63olGBmI40U',
    pluginConfig: {
      mediaCrawlerRoot: detected.root,
      mediaCrawlerPython: detected.python,
      mediaCrawlerEnabled: true,
      mediaCrawlerTimeoutMs: 60000,
    },
    runner: async () => ({
      exitCode: 0,
      stdout: '',
      stderr: blockedStderr,
      timedOut: false,
      mock: false,
      loginSeen: false,
    }),
  })
  assert.equal(replay.success, false)
  assert.equal(replay.task.mock, false)
  assert.equal(replay.task.code, 'platform_restricted')
  assert.notEqual(replay.task.code, 'no_media')
  assert.notEqual(replay.task.status, 'needs_login')
  assert.ok(replay.task.detail && /account blocked/i.test(replay.task.detail))
  assert.equal(cap.sessionIsolation?.sharedOfficialOAuth, false)
}


console.log('mediacrawler-adapter live-default tests ok')
rmSync(isolatedHome, { recursive: true, force: true })


// --- Keyword search (NOT hot-board) ---
assert.equal(m.mediacrawlerCapabilityReport({}).hotBoard.availableInMediaCrawlerCli, true)
assert.equal(m.mediacrawlerCapabilityReport({}).hotBoard.wiredInPlugin, true)
assert.equal(m.mediacrawlerCapabilityReport({}).hotBoard.officialHotSearch, false)
assert.equal(m.mediacrawlerCapabilityReport({}).keywordSearch.wiredInPlugin, true)
assert.throws(() => m.normalizeSearchKeyword(''), /关键词/)
assert.equal(m.normalizeSearchKeyword(' 小程序开发 '), '小程序开发')

const searchPlan = m.buildMcSearchCliPlan({
  root: detected.root,
  python: detected.python,
  platform: 'dy',
  keywords: '小程序开发',
  saveDataPath: join(isolatedHome, '.dsh/digital-human-assets/mediacrawler-jobs/t-search/out'),
  maxNotes: 10,
})
assert.equal(searchPlan.mode, 'search')
assert.ok(searchPlan.argv.includes('--type'))
assert.equal(searchPlan.argv[searchPlan.argv.indexOf('--type') + 1], 'search')
assert.equal(searchPlan.argv[searchPlan.argv.indexOf('--keywords') + 1], '小程序开发')
assert.equal(searchPlan.argv[searchPlan.argv.indexOf('--get_media') + 1], 'false')
assert.equal(searchPlan.argv[searchPlan.argv.indexOf('--get_comment') + 1], 'false')
assert.equal(searchPlan.argv[searchPlan.argv.indexOf('--crawler_max_notes_count') + 1], '10')
assert.equal(searchPlan.argv.includes('--cookies'), false)
m.assertSafeCliPlan(searchPlan, detected.root)
const detailPlan = m.buildMcCliPlan({
  root: detected.root,
  python: detected.python,
  platform: 'dy',
  specifiedId: 'https://www.douyin.com/video/1',
  saveDataPath: join(isolatedHome, '.dsh/digital-human-assets/mediacrawler-jobs/t-detail/out'),
})
assert.equal(resolve(detailPlan.argv[0]), resolve(m.mediacrawlerRunnerScriptPath()))
assert.equal(detailPlan.argv.includes('--cookies'), false)
m.assertSafeCliPlan(detailPlan, detected.root)

// Cap enforcement
const capped = m.buildMcSearchCliPlan({
  root: detected.root,
  python: detected.python,
  platform: 'dy',
  keywords: 'test',
  saveDataPath: join(isolatedHome, '.dsh/digital-human-assets/mediacrawler-jobs/t-search2/out'),
  maxNotes: 99,
})
assert.equal(capped.argv[capped.argv.indexOf('--crawler_max_notes_count') + 1], '10')

// Injected runner: succeed with fabricated jsonl hits (no live network)
const outSearch = join(isolatedHome, '.dsh/digital-human-assets/mediacrawler-jobs')
const fakeSearchRunner = async (plan, ctx) => {
  assert.equal(plan.mode, 'search')
  assert.equal(plan.argv[plan.argv.indexOf('--type') + 1], 'search')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(plan.saveDataPath, { recursive: true })
  writeFileSync(
    join(plan.saveDataPath, 'hits.jsonl'),
    JSON.stringify({
      aweme_id: '7702542138755534090',
      title: 'fixture keyword hit',
      liked_count: '12',
      comment_count: '3',
      aweme_url: 'https://www.douyin.com/video/7702542138755534090',
      source_keyword: '小程序开发',
    }) + '\n',
  )
  return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, mock: true }
}
const searchRun = await m.runPlatformKeywordSearch({
  spaceId,
  platform: 'dy',
  keywords: '小程序开发',
  maxNotes: 10,
  pluginConfig: {
    mediaCrawlerRoot: detected.root,
    mediaCrawlerPython: detected.python,
    mediaCrawlerEnabled: true,
    mediaCrawlerTimeoutMs: 60000,
  },
  runner: fakeSearchRunner,
})
assert.equal(searchRun.success, true)
assert.equal(searchRun.task.sourceKind, 'keyword_search')
assert.equal(searchRun.task.mode, 'search')
assert.ok(searchRun.task.collectedAt)
assert.equal(searchRun.task.searchHits?.length, 1)
assert.equal(searchRun.task.searchHits[0].sourceKind, 'keyword_search')
assert.equal(searchRun.task.materials?.length || 0, 0)

console.log('PASS: keyword search plan/cap/DI hits; industry hotboard uses search')


// --- browser mode + 2483 classification + sidecar ---
assert.equal(m.normalizeBrowserMode('cdp_existing'), 'cdp_existing')
assert.equal(m.normalizeCdpPort(9222), 9222)
assert.equal(m.normalizeCdpPort(9333), 9222) // never invent alternate ports
const runnerPath = m.mediacrawlerRunnerScriptPath()
assert.ok(existsSync(runnerPath), 'sidecar runner must exist')

const searchCdp = m.buildMcSearchCliPlan({
  root: detected.root,
  python: detected.python,
  platform: 'dy',
  keywords: '小程序开发',
  saveDataPath: join(isolatedHome, '.dsh/digital-human-assets/mediacrawler-jobs/t-search-cdp/out'),
  maxNotes: 10,
  browserMode: 'cdp_existing',
  cdpPort: 9222,
})
assert.equal(searchCdp.browserMode, 'cdp_existing')
assert.equal(resolve(searchCdp.argv[0]), resolve(runnerPath))
assert.equal(searchCdp.argv.includes('--cookies'), false)
m.assertSafeCliPlan(searchCdp, detected.root)

const classified2483 = m.classifyCliFailure({
  exitCode: 0,
  stdout: '',
  stderr:
    "pong=True, skip login (non-cookie or empty cookies)\n" +
    "search douyin keyword: 小程序开发, page: 1 is empty,None; response_summary={'status_code': 2483, 'status_msg': '请先登录，再继续搜索吧'};\n",
  loginSeen: false,
})
assert.equal(classified2483.code, 'needs_login', '2483 must not be masked by pong skip-login')

const cookieLoginLogs = m.classifyCliLogs({
  exitCode: 0,
  stdout:
    '[dh-mc-runner] using original MediaCrawler saved cookie login (.douyin_cookies.txt); headless; cookie values not printed\n',
  stderr:
    "[DouYinLogin.login_by_cookies] Begin login douyin by cookie ...\n" +
    "[DouYinCrawler.search] keyword:全家装, aweme_list:['7510022292337102114']\n" +
    '[DouYinCrawler.start] Douyin Crawler finished ...\n',
  loginSeen: true,
})
assert.equal(cookieLoginLogs, null, 'cookie inject Begin login is not a QR wait')

const cookieSearchRunner = async (plan) => {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(plan.saveDataPath, { recursive: true })
  writeFileSync(
    join(plan.saveDataPath, 'hits.jsonl'),
    JSON.stringify({
      aweme_id: '7510022292337102114',
      title: 'cookie login search hit',
      liked_count: '8',
      comment_count: '1',
      aweme_url: 'https://www.douyin.com/video/7510022292337102114',
      source_keyword: '全家装',
    }) + '\n',
  )
  return {
    exitCode: 0,
    stdout: '[dh-mc-runner] using original MediaCrawler saved cookie login (.douyin_cookies.txt); headless; cookie values not printed\n',
    stderr: '[DouYinLogin.login_by_cookies] Begin login douyin by cookie ...\n',
    timedOut: false,
    mock: true,
    loginSeen: true,
  }
}
const cookieSearch = await m.runPlatformKeywordSearch({
  spaceId,
  platform: 'dy',
  keywords: '全家装',
  maxNotes: 10,
  pluginConfig: {
    mediaCrawlerRoot: detected.root,
    mediaCrawlerPython: detected.python,
    mediaCrawlerEnabled: true,
    mediaCrawlerTimeoutMs: 60000,
  },
  runner: cookieSearchRunner,
})
assert.equal(cookieSearch.success, true, 'cookie login + hits must succeed')
assert.equal(cookieSearch.task.status, 'succeeded')
assert.equal(cookieSearch.task.searchHits?.length, 1)

console.log('PASS: sidecar argv, port pin, 2483→needs_login, cookie login search succeeds')
