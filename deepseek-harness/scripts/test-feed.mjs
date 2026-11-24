#!/usr/bin/env node
/** 本地更新测试源（macOS / Windows 通用）。
 *
 * 用法：
 *   1) 把安装包（.dmg 或 .exe）和 latest.json 放进本脚本所在目录
 *   2) node test-feed.mjs [端口，默认 18948]
 *   3) 启动桌面端前把更新地址指到本机：
 *        macOS/Linux:  XIAOCONG_UPDATE_URL=http://127.0.0.1:18948/latest.json <App 可执行文件>
 *        Windows:      set XIAOCONG_UPDATE_URL=http://127.0.0.1:18948/latest.json
 *                      "C:\...\Xiaocongseek.exe"
 *
 * 传输限速约 12 MB/s（256 KB / 20 ms），让下载进度条看得见。
 * /latest.json 返回同目录的清单；其它路径一律返回最大的那个安装包。
 */
import { createServer } from 'node:http'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const port = Number(process.argv[2] ?? 18948)

const feed = readFileSync(join(root, 'latest.json'))
const installers = readdirSync(root)
  .filter((name) => /\.(dmg|exe)$/iu.test(name))
  .map((name) => ({ name, size: statSync(join(root, name)).size, bytes: null }))
  .sort((a, b) => b.size - a.size)

if (installers.length === 0) {
  console.error('同目录下没有 .dmg / .exe 安装包')
  process.exit(1)
}
const install = installers[0]
install.bytes = readFileSync(join(root, install.name))

const CHUNK = 256 * 1024
const INTERVAL_MS = 20

createServer((req, res) => {
  if (req.url === '/latest.json') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(feed)
    return
  }
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': install.bytes.length,
  })
  let offset = 0
  const timer = setInterval(() => {
    if (offset >= install.bytes.length) {
      clearInterval(timer)
      res.end()
      return
    }
    const chunk = install.bytes.subarray(offset, offset + CHUNK)
    offset += chunk.length
    res.write(chunk)
  }, INTERVAL_MS)
  res.on('close', () => clearInterval(timer))
}).listen(port, '127.0.0.1', () => {
  console.log(`测试更新源已启动：http://127.0.0.1:${port}/latest.json`)
  console.log(`安装包：${install.name}（${(install.size / 1024 / 1024).toFixed(1)} MB，限速约 12 MB/s）`)
})
