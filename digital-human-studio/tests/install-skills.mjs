import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const { installBundledSkills, hashDir, resolveDshHome, MARKER } = await import('../dist/install-skills.js')

// 0. resolveDshHome 必须和宿主的 @deepseek-ai/dsh-home-paths 语义一致，
//    否则装到错的目录，宿主扫不到、客户以为插件没装好。
const envBefore = process.env.DSH_HOME
try {
  delete process.env.DSH_HOME
  assert.equal(resolveDshHome(), join(homedir(), '.dsh'), '未设置时落到 ~/.dsh')

  process.env.DSH_HOME = '   '
  assert.equal(resolveDshHome(), join(homedir(), '.dsh'), '纯空白视为未设置，不能解析成当前目录')

  process.env.DSH_HOME = '~/env-dsh'
  assert.equal(resolveDshHome(), join(homedir(), 'env-dsh'), '~ 前缀必须展开，不能留字面量')

  process.env.DSH_HOME = '/tmp/explicit-dsh'
  assert.equal(resolveDshHome(), resolve('/tmp/explicit-dsh'), '绝对路径原样使用')

  process.env.DSH_HOME = './relative-dsh'
  assert.equal(resolveDshHome(), resolve('./relative-dsh'), '相对路径要解析成绝对路径')
} finally {
  if (envBefore === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = envBefore
}

const root = mkdtempSync(join(tmpdir(), 'xdh-install-skills-'))
const skillsRoot = join(root, 'pkg', 'skills')
const destRoot = join(root, 'home', '.dsh', 'skills')

/** 造一个自带 skill 的源目录。 */
function writeSource(version) {
  const dir = join(skillsRoot, 'demo-skill')
  mkdirSync(join(dir, 'rules'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: demo-skill\ndescription: "v${version}"\n---\n\n正文 v${version}\n`)
  writeFileSync(join(dir, 'rules', 'hook.md'), `钩子规则 v${version}\n`)
}
/** 非 skill 目录（没有 SKILL.md）不该被装出去。 */
function writeNoise() {
  const dir = join(skillsRoot, 'notes')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'readme.txt'), '只是随手记的笔记\n')
}

// 1. 首次安装：目标不存在 → installed，文件 + 标记都到位
writeSource(1)
writeNoise()
let reports = installBundledSkills({ skillsRoot, destRoot })
assert.equal(reports.length, 1, '只装带 SKILL.md 的目录')
assert.equal(reports[0].name, 'demo-skill')
assert.equal(reports[0].outcome, 'installed')
const dest = join(destRoot, 'demo-skill')
assert.ok(existsSync(join(dest, 'SKILL.md')))
assert.ok(existsSync(join(dest, 'rules', 'hook.md')))
assert.ok(existsSync(join(dest, MARKER)), '安装后必须写纳管标记')
assert.ok(!existsSync(join(destRoot, 'notes')), '没有 SKILL.md 的目录不该被装')

// 2. 幂等：同版本再跑一次 → unchanged，不重写文件
const markerBefore = readFileSync(join(dest, MARKER), 'utf8')
reports = installBundledSkills({ skillsRoot, destRoot })
assert.equal(reports[0].outcome, 'unchanged')
assert.equal(readFileSync(join(dest, MARKER), 'utf8'), markerBefore, 'unchanged 不该动标记')

// 3. 纳管：用户手工放的、内容与包内一致 → adopted，补写标记
const adoptedRoot = join(root, 'adopted', 'skills')
mkdirSync(join(adoptedRoot, 'demo-skill', 'rules'), { recursive: true })
writeFileSync(join(adoptedRoot, 'demo-skill', 'SKILL.md'), readFileSync(join(skillsRoot, 'demo-skill', 'SKILL.md')))
writeFileSync(join(adoptedRoot, 'demo-skill', 'rules', 'hook.md'), readFileSync(join(skillsRoot, 'demo-skill', 'rules', 'hook.md')))
reports = installBundledSkills({ skillsRoot, destRoot: adoptedRoot })
assert.equal(reports[0].outcome, 'adopted')
assert.ok(existsSync(join(adoptedRoot, 'demo-skill', MARKER)), '纳管后要能跟随以后升级')

// 4. 冲突：目标已存在、内容不同、又不是本插件装的 → 不覆盖
const conflictRoot = join(root, 'conflict', 'skills')
mkdirSync(join(conflictRoot, 'demo-skill'), { recursive: true })
writeFileSync(join(conflictRoot, 'demo-skill', 'SKILL.md'), '用户自己写的一套，不能被插件冲掉\n')
reports = installBundledSkills({ skillsRoot, destRoot: conflictRoot })
assert.equal(reports[0].outcome, 'conflict')
assert.equal(
  readFileSync(join(conflictRoot, 'demo-skill', 'SKILL.md'), 'utf8'),
  '用户自己写的一套，不能被插件冲掉\n',
  '冲突时必须原样保留用户版本',
)

// 5. 升级：有标记且用户没改过 → 直接覆盖
writeSource(2)
reports = installBundledSkills({ skillsRoot, destRoot })
assert.equal(reports[0].outcome, 'upgraded')
assert.match(readFileSync(join(dest, 'SKILL.md'), 'utf8'), /v2/)

// 6. 升级但用户改过 → 先备份再覆盖，备份里是用户那版
writeFileSync(join(dest, 'rules', 'hook.md'), '用户手调的钩子规则\n')
writeSource(3)
reports = installBundledSkills({ skillsRoot, destRoot })
assert.equal(reports[0].outcome, 'upgraded-with-backup')
assert.ok(reports[0].backup && existsSync(reports[0].backup), '必须留下备份目录')
assert.equal(readFileSync(join(reports[0].backup, 'rules', 'hook.md'), 'utf8'), '用户手调的钩子规则\n')
assert.match(readFileSync(join(dest, 'rules', 'hook.md'), 'utf8'), /v3/)

// 7. hashDir 忽略 .DS_Store 和纳管标记，否则每次启动都会误判成有改动
const hashA = hashDir(dest)
writeFileSync(join(dest, '.DS_Store'), 'junk')
writeFileSync(join(dest, MARKER), '{"changed":true}')
assert.equal(hashDir(dest), hashA, '.DS_Store 和标记不应影响指纹')

// 8. 源目录不存在时安静返回，不抛
assert.deepEqual(installBundledSkills({ skillsRoot: join(root, 'nope'), destRoot }), [])

// 9. 装完目录里确实只有该有的东西
assert.deepEqual(readdirSync(dest).filter(name => name !== '.DS_Store').sort(), ['SKILL.md', MARKER, 'rules'].sort())

console.log('install-skills tests ok')
