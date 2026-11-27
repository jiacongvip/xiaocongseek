import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '../tools/chrome-cdp-page-media/download_dy_page_media.py')
const py = join(homedir(), 'Desktop', '开发文件', 'MediaCrawler', '.venv', 'bin', 'python')

assert.equal(existsSync(script), true, 'download_dy_page_media.py')
assert.equal(existsSync(py), true, 'MediaCrawler venv python')

const probe = spawnSync(
  py,
  [
    '-c',
    [
      'import os, httpx',
      "os.environ['NO_PROXY']='::1,[::1],localhost'",
      "os.environ['no_proxy']=os.environ['NO_PROXY']",
      'try:',
      '    httpx.AsyncClient()',
      "    print('env-client-unexpected-ok')",
      'except Exception as e:',
      "    print(type(e).__name__ + ':' + str(e))",
    ].join('\n'),
  ],
  { encoding: 'utf8' },
)
assert.equal(probe.status, 0, probe.stderr)
const envBroken = /InvalidURL|Invalid port/.test(probe.stdout)
if (!envBroken) {
  console.log('page-media-httpx: default httpx did not trip on NO_PROXY IPv6:', probe.stdout.trim())
}

const trust = spawnSync(
  py,
  [
    '-c',
    [
      'import importlib.util, os',
      `spec = importlib.util.spec_from_file_location('page_media', ${JSON.stringify(script)})`,
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      "os.environ['NO_PROXY']='::1,[::1],localhost'",
      "os.environ['no_proxy']=os.environ['NO_PROXY']",
      'client = mod.make_media_http_client()',
      "print('trust-env-false-ok')",
    ].join('\n'),
  ],
  { encoding: 'utf8' },
)
assert.equal(trust.status, 0, trust.stderr + trust.stdout)
assert.match(trust.stdout, /trust-env-false-ok/)

const capture = spawnSync(
  py,
  [
    '-c',
    [
      'import importlib.util',
      `spec = importlib.util.spec_from_file_location('page_media', ${JSON.stringify(script)})`,
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'bag = mod.CaptureBag()',
      'hdr = lambda n: {"content-type": "video/mp4", "content-length": str(n)}',
      'bag.consider("https://v3.douyinvod.com/video/tos/cn/small.mp4", hdr(1_000_000), 206)',
      'bag.consider("https://v3.douyinvod.com/video/tos/cn/large.mp4", hdr(4_500_000), 206)',
      'assert "audio" in bag.captured, bag.captured.keys()',
      'assert bag.captured["video"]["length"] == 4_500_000',
      'assert bag.captured["audio"]["length"] == 1_000_000',
      "print('capture-second-stream-ok')",
    ].join('\n'),
  ],
  { encoding: 'utf8' },
)
assert.equal(capture.status, 0, capture.stderr + capture.stdout)
assert.match(capture.stdout, /capture-second-stream-ok/)

console.log('page-media-httpx: ok')
