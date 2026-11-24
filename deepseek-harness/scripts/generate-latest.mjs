#!/usr/bin/env node
/** 生成 Xiaocongseek 更新源 latest.json（配合桌面端「更新检测」）。
 *
 * 用法（macOS + Windows 双平台）：
 *   node generate-latest.mjs \
 *     --dmg ./Xiaocongseek-0.2.3-mac-arm64.dmg \
 *     --exe ./xiaocongseek-0.2.3-win-x64-unsigned.exe \
 *     --base https://xiaocongapi.azheteng.cn/xiaocongseek \
 *     --version 0.2.3 \
 *     --notes "更新说明…"
 *
 * 只发一个平台时可省略另一个参数；至少要给 --dmg 或 --exe 其中一个。
 *
 * 可选：
 *   --min-version 0.2.0   低于该版本的客户端强制提示升级（默认不填）
 *   --out latest.json      输出文件名（默认 latest.json）
 *
 * 产物 latest.json 需与安装包放在同一网络目录下。
 * 桌面端按系统取字段：macOS 读 dmgUrl，Windows 读 exeUrl。
 */
import { basename, resolve } from 'node:path'
import { statSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const get = (name) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : null
}

const dmgPath = get('--dmg')
const exePath = get('--exe')
const base = get('--base')
const version = get('--version')
const notes = get('--notes')
const minVersion = get('--min-version')
const out = get('--out') ?? 'latest.json'

if ((!dmgPath && !exePath) || !base || !version) {
  console.error('缺少参数：--base / --version 必填，且 --dmg 与 --exe 至少给一个')
  process.exit(1)
}

const release = { version }
const files = []

if (dmgPath) {
  const file = resolve(dmgPath)
  const name = basename(file)
  release.dmgUrl = `${base.replace(/\/+$/, '')}/${encodeURIComponent(name)}`
  release.dmgSizeBytes = statSync(file).size
  files.push(name)
}
if (exePath) {
  const file = resolve(exePath)
  const name = basename(file)
  release.exeUrl = `${base.replace(/\/+$/, '')}/${encodeURIComponent(name)}`
  release.exeSizeBytes = statSync(file).size
  files.push(name)
}

if (notes) release.notes = notes
release.publishedAt = new Date().toISOString()
if (minVersion) release.minVersion = minVersion

writeFileSync(out, JSON.stringify(release, null, 2) + '\n')
console.log(`已生成 ${out}：`)
console.log(JSON.stringify(release, null, 2))
console.log('\n发布检查清单：')
files.forEach((name) => console.log(`  · 把 ${name} 上传到 ${base}/ 目录`))
if (release.dmgUrl) console.log(`  · 确认 ${release.dmgUrl} 可访问（HTTP 200）`)
if (release.exeUrl) console.log(`  · 确认 ${release.exeUrl} 可访问（HTTP 200）`)
console.log(`  · 桌面端默认 feed 是 ${base}/latest.json，可在设置页点「检查更新」验证`)
