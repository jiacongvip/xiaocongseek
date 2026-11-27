/**
 * 把插件自带的 skills 铺到宿主的 skill 扫描目录（`$DSH_HOME/skills`）。
 *
 * 为什么需要这一步：插件（npm 包）和 skill（宿主目录）是两条互不相干的发现路径。
 * 宿主只扫 `~/.dsh/skills`、项目级 `.dsh/skills` 这些固定位置，**不会**去插件目录里找。
 * 所以光把 skills 打进 npm 包，用户装上插件后宿主依然扫不到，必须在插件启动时落盘一次。
 *
 * 覆盖策略（别改成无脑覆盖）：
 * - 目标不存在            → 安装。
 * - 目标内容与包内一致    → 只补写标记，不动文件（把手工放的这套纳管）。
 * - 有我们的标记、用户没改 → 覆盖升级。
 * - 有我们的标记、用户改过 → 备份后覆盖（备份路径写进报告）。
 * - 没有标记且内容不同    → 不覆盖，报 conflict，交给人决定。
 *
 * 幂等：同一版本重复启动只做 hash 比对，不写盘。
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 写在每个已安装 skill 目录里的纳管标记；有这个标记才认为是我们装的。 */
export const MARKER = '.dsh-install.json'

export type SkillInstallOutcome =
  | 'installed'
  | 'upgraded'
  | 'upgraded-with-backup'
  | 'adopted'
  | 'unchanged'
  | 'conflict'
  | 'skipped'

export type SkillInstallReport = {
  name: string
  outcome: SkillInstallOutcome
  /** 备份目录（仅 upgraded-with-backup） */
  backup?: string
  /** 人能看懂的原因 */
  detail?: string
}

type Marker = { package: string; version: string; hash: string; installedAt: number }

/** 展开 `~`、`~/`、`~\` 前缀（与 @deepseek-ai/dsh-home-paths 的 expandHomePath 一致）。 */
function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * 宿主 home：`$DSH_HOME` 优先，否则 `~/.dsh`。
 *
 * 必须和 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome` 完全一致，否则装歪了宿主就扫不到：
 * - 空 / 纯空白的 `DSH_HOME` 视为未设置（否则会把 home 解析成当前目录）
 * - `DSH_HOME=~/xxx` 要展开成绝对路径（配成 `~` 形式很常见）
 * - 相对路径要按 cwd 解析成绝对路径
 */
export function resolveDshHome(): string {
  const fromEnv = process.env.DSH_HOME
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(expandHomePath(selected))
}

function readPluginVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
    return typeof pkg?.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function walkFiles(dir: string, base: string = dir): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store' || name === MARKER) continue
    const abs = join(dir, name)
    const stat = statSync(abs)
    if (stat.isDirectory()) out.push(...walkFiles(abs, base))
    else if (stat.isFile()) out.push(relative(base, abs))
  }
  return out.sort()
}

/** 目录内容的指纹：路径 + 内容，跳过 macOS 垃圾文件和纳管标记。 */
export function hashDir(dir: string): string {
  const hash = createHash('sha256')
  for (const rel of walkFiles(dir)) {
    hash.update(rel)
    hash.update('\0')
    hash.update(readFileSync(join(dir, rel)))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 32)
}

function readMarker(dir: string): Marker | undefined {
  const file = join(dir, MARKER)
  if (!existsSync(file)) return undefined
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return typeof data?.hash === 'string' ? (data as Marker) : undefined
  } catch {
    return undefined
  }
}

function writeMarker(dir: string, hash: string): void {
  const marker: Marker = {
    package: 'digital-human-studio',
    version: readPluginVersion(),
    hash,
    installedAt: Date.now(),
  }
  writeFileSync(join(dir, MARKER), `${JSON.stringify(marker, null, 2)}\n`)
}

function copySkill(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
}

/**
 * 安装插件自带的全部 skills。失败不抛异常——skill 装不上不该让插件起不来。
 * @param options.skillsRoot 覆盖源目录（测试用）
 * @param options.destRoot 覆盖目标目录（测试用）
 */
export function installBundledSkills(options: { skillsRoot?: string; destRoot?: string } = {}): SkillInstallReport[] {
  const sourceRoot = options.skillsRoot ?? join(PLUGIN_ROOT, 'skills')
  const destRoot = options.destRoot ?? join(resolveDshHome(), 'skills')
  if (!existsSync(sourceRoot)) return []

  const reports: SkillInstallReport[] = []
  let entries: string[]
  try {
    entries = readdirSync(sourceRoot)
  } catch {
    return []
  }

  for (const name of entries) {
    if (name.startsWith('.')) continue
    const source = join(sourceRoot, name)
    try {
      if (!statSync(source).isDirectory()) continue
      // 只认带 SKILL.md 的目录，避免把随手丢的笔记当技能装出去。
      if (!existsSync(join(source, 'SKILL.md'))) continue

      const dest = join(destRoot, name)
      const sourceHash = hashDir(source)

      if (!existsSync(dest)) {
        copySkill(source, dest)
        writeMarker(dest, sourceHash)
        reports.push({ name, outcome: 'installed' })
        continue
      }

      const destHash = hashDir(dest)
      const marker = readMarker(dest)

      if (destHash === sourceHash) {
        // 内容已经一致：补写标记把这套纳管，下次升级才能跟上。
        if (!marker) {
          writeMarker(dest, sourceHash)
          reports.push({ name, outcome: 'adopted', detail: '内容一致，已纳管' })
        } else {
          reports.push({ name, outcome: 'unchanged' })
        }
        continue
      }

      if (!marker) {
        // 用户手工放的、内容又不一样：不碰，只报告。
        reports.push({ name, outcome: 'conflict', detail: '目标已存在且不是本插件安装，未覆盖' })
        continue
      }

      const userEdited = destHash !== marker.hash
      if (!userEdited) {
        copySkill(source, dest)
        writeMarker(dest, sourceHash)
        reports.push({ name, outcome: 'upgraded' })
      } else {
        const backup = `${dest}.bak.${Date.now()}`
        renameSync(dest, backup)
        copySkill(source, dest)
        writeMarker(dest, sourceHash)
        reports.push({ name, outcome: 'upgraded-with-backup', backup })
      }
    } catch (error: any) {
      reports.push({ name, outcome: 'skipped', detail: error?.message || String(error) })
    }
  }

  return reports
}

/** 启动时跑一次，把结果打成一行日志，别刷屏。 */
export function installBundledSkillsOnBoot(): void {
  let reports: SkillInstallReport[]
  try {
    reports = installBundledSkills()
  } catch (error: any) {
    console.warn('[digital-human-studio] skills 安装跳过：', error?.message || error)
    return
  }
  const changed = reports.filter(item => item.outcome !== 'unchanged')
  for (const item of reports) {
    if (item.outcome === 'conflict') {
      console.warn(
        `[digital-human-studio] skill ${item.name} 未覆盖：目标目录已存在且不是本插件安装。` +
          `要跟随插件升级，请删掉该目录后重启。`,
      )
    } else if (item.outcome === 'upgraded-with-backup') {
      console.warn(`[digital-human-studio] skill ${item.name} 已升级，你改过的旧版备份在 ${item.backup}`)
    } else if (item.outcome === 'skipped') {
      console.warn(`[digital-human-studio] skill ${item.name} 安装失败：${item.detail}`)
    }
  }
  if (changed.length > 0) {
    console.log(
      `[digital-human-studio] skills 就绪：${changed.map(item => `${item.name}(${item.outcome})`).join(', ')}`,
    )
  }
}
