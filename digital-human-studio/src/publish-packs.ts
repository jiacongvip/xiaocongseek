import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, extname, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { isSpaceId, spaceAssetRoot } from './spaces.js'
import { exportCoverFramePath, exportFilePath, exportRoot, exportThumbPath } from './export-history.js'
import { loadStudioHistory } from './studio-history.js'
import { listStudioMaterials, findStudioMaterial, materialAbsolutePath, materialMime, spaceMaterialsRoot } from './studio-materials.js'
import { readImageFile, imageLayoutForSpace } from './image-jobs.js'
import { loadPublishCalendar, type PublishPlan } from './publish-calendar.js'
/**
 * 发布包只描述「这条排期发什么内容」：时间、平台、关联成片一律以日历排期为准，
 * 这里不再重复保存，避免两处数据打架。
 */
export type PublishPack = { id: string; planId: string; title: string; body: string; topics: string; coverRef: string; revision: number; checkedFingerprint: string; updatedAt: number }
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
function root(space: string) { if (!isSpaceId(space)) throw new Error('非法公司'); return spaceAssetRoot(space) }
export function packsPath(space: string) { return join(root(space), 'publish-packs.json') }
export function loadPacks(space: string): PublishPack[] {
  const path = packsPath(space)
  if (!existsSync(path)) return []
  try { const data = JSON.parse(readFileSync(path, 'utf8')); if (data.version !== 1 || !Array.isArray(data.items) || !data.items.every((p: PublishPack) => p && /^pack-[a-f0-9]{32}$/.test(p.id) && /^pub-[a-f0-9-]{36}$/.test(p.planId) && Number.isInteger(p.revision) && p.revision > 0 && ['title','body','topics','coverRef','checkedFingerprint'].every(k => typeof (p as any)[k] === 'string'))) throw new Error(); return data.items }
  catch { throw new Error('发布包文件损坏，原文件已保留') }
}
function save(space: string, items: PublishPack[]) {
  const file = packsPath(space); mkdirSync(dirname(file), { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`
  try { writeFileSync(temp, JSON.stringify({ version: 1, items }, null, 2), { flag: 'wx', mode: 0o600 }); renameSync(temp, file) }
  finally { if (existsSync(temp)) unlinkSync(temp) }
}
function video(space: string, id: string) {
  // 数字人视频和「导入成品」都算发布包可用的视频；其它 kind 不能当视频发。
  return loadStudioHistory(space).find(x => x.id === id && (x.kind === 'xdh-avatar-video' || x.kind === 'xdh-export-video') && x.status === 'SUCCESS')
}
function field(value: unknown, label: string, limit: number) { if (typeof value !== 'string' || value.length > limit) throw new Error(`${label}无效或过长`); return value.trim() }
function safeUrl(space: string, value: string): string {
  if (!value || /[\\\x00-\x1f]/.test(value)) return ''
  if (value.startsWith('/digital-human-studio/')) return localMedia(space,value) ? value : ''
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? value : '' } catch { return '' }
}
function coverUrl(space: string, ref: string): string {
  if (!ref) return ''
  // 成稿页生成的封面本身就是本公司的受控资源 URL，可直接作为发布包封面。
  if (ref.startsWith('/digital-human-studio/')) return safeUrl(space, ref)
  if (ref.startsWith('material:')) { const item = findStudioMaterial(space, ref.slice(9)); if (item?.kind === 'image') return safeUrl(space,`/digital-human-studio/materials/file?space=${encodeURIComponent(space)}&id=${encodeURIComponent(item.id)}`) }
  if (ref.startsWith('history:')) { const row = loadStudioHistory(space).find(x => x.id === ref.slice(8) && ['ximg','xdh-image'].includes(x.kind) && x.status === 'SUCCESS'); if (row) return safeUrl(space,row.mediaUrl || row.coverUrl || '') }
  return ''
}
export function resolveCoverRef(space: string, ref: string): string { return coverUrl(space, ref) }
function mediaStamp(space: string, url: string) { const file=localMedia(space,url); if (!file) return ''; const stat=statSync(file.path); return [stat.size,stat.mtimeMs,stat.ctimeMs] }
/** 排期是唯一时间来源；成片与封面取自排期关联的成片和发布包自己选的封面。 */
export function planOf(space: string, planId: string): PublishPlan | undefined { return loadPublishCalendar(space).find(x => x.id === planId) }
function fingerprint(space: string, p: PublishPack) { const plan=planOf(space,p.planId); const media=video(space,plan?.historyId || '')?.mediaUrl || '',cover=coverUrl(space,p.coverRef); return hash(JSON.stringify([p.planId,plan?.scheduledAt || '',plan?.platform || '',plan?.historyId || '',p.title,p.body,p.topics,media,mediaStamp(space,media),p.coverRef,cover,mediaStamp(space,cover)])) }
export function packOptions(space: string) {
  return { plans: loadPublishCalendar(space).map(x => ({ id: x.id, title: x.title, scheduledAt: x.scheduledAt, platform: x.platform, status: x.status, historyId: x.historyId })), covers: [
    ...listStudioMaterials(space).filter(x => x.kind === 'image').map(x => ({ id: `material:${x.id}`, title: x.name })),
    ...loadStudioHistory(space).filter(x => ['ximg','xdh-image'].includes(x.kind) && x.status === 'SUCCESS').map(x => ({ id: `history:${x.id}`, title: x.title })) ] }
}
export function packView(space: string, p: PublishPack) {
  const plan = planOf(space, p.planId)
  const row = video(space, plan?.historyId || ''), media = safeUrl(space,row?.mediaUrl || ''), cover = coverUrl(space, p.coverRef)
  return { ...p, checked: !!p.checkedFingerprint && p.checkedFingerprint === fingerprint(space,p), mediaUrl: media, coverUrl: cover, missingVideo: !row || !media, missingCover: !!p.coverRef && !cover, missingPlan: !plan, planTitle: plan?.title || '', planPlatform: plan?.platform || '', planScheduledAt: plan?.scheduledAt || '', planStatus: plan?.status || '', planHistoryId: plan?.historyId || '', videoDownload: !!localMedia(space,media), coverDownload: !!localMedia(space,cover) }
}
export function getPack(space: string, id: unknown) { if (typeof id !== 'string' || !/^pack-[a-f0-9]{32}$/.test(id)) throw new Error('发布包ID无效'); const p = loadPacks(space).find(x => x.id === id); if (!p) throw new Error('找不到当前公司的发布包'); return p }
function expected(p: PublishPack, revision: unknown) { if (revision !== p.revision) throw new Error('发布包已被修改，请刷新后重试，未覆盖新版本') }
export function savePack(space: string, input: Record<string, unknown>) {
  const planId = field(input.planId, '排期', 80)
  const plan = planOf(space, planId)
  if (!plan) throw new Error('排期不属于当前公司或已被删除，请回到日历重新选择')
  const id = input.id ? String(input.id) : `pack-${hash(planId).slice(0,32)}`
  const items = loadPacks(space), previous = items.find(x => x.id === id)
  if (input.id && !previous) throw new Error('找不到当前公司的发布包')
  if (previous) expected(previous,input.revision)
  else if (input.revision !== 0) throw new Error('新发布包版本无效')
  const coverRef = field(input.coverRef ?? '', '封面', 240)
  if (coverRef && !coverUrl(space,coverRef) && !(previous && previous.coverRef === coverRef)) throw new Error('封面不属于当前公司或已失效')
  for (const key of ['path','url','mediaUrl','coverUrl','platform','scheduledAt','historyId']) if (key in input) throw new Error('时间、平台和成片以日历排期为准，请在日历里修改')
  const title = field(input.title || plan.title,'标题',120); if (!title) throw new Error('标题不能为空')
  const p: PublishPack = { id, planId, title, body: field(input.body ?? '', '正文',20000), topics: field(input.topics ?? '', '话题',2000), coverRef, revision: (previous?.revision || 0)+1, checkedFingerprint: previous?.checkedFingerprint || '', updatedAt: Date.now() }
  if (!previous || fingerprint(space,p) !== fingerprint(space,previous)) p.checkedFingerprint = ''
  save(space,[p,...items.filter(x=>x.id!==id)]);return p
}
export function checkPack(space: string, id: unknown, revision: unknown) {
  const p = getPack(space,id); expected(p,revision)
  const plan = planOf(space,p.planId)
  if (!plan) throw new Error('对应的日历排期已被删除，请回到日历重新选择')
  const missing: string[] = []
  if (!safeUrl(space, video(space, plan.historyId)?.mediaUrl || '')) missing.push('有效成片')
  if (!coverUrl(space, p.coverRef)) missing.push('封面')
  if (!plan.platform) missing.push('平台')
  if (!p.body) missing.push('正文')
  if (missing.length) throw new Error(`请补齐${missing.join('、')}后再确认检查`)
  p.checkedFingerprint = fingerprint(space,p);p.revision++;p.updatedAt=Date.now();save(space,loadPacks(space).map(x=>x.id===p.id?p:x));return p
}
export function deletePack(space: string, id: unknown, revision: unknown) { const p=getPack(space,id);expected(p,revision);save(space,loadPacks(space).filter(x=>x.id!==p.id));return true }
export function packText(space: string, p: PublishPack) { const plan=planOf(space,p.planId); return `${p.title}\n\n${p.body}\n\n${p.topics}\n\n平台：${plan?.platform || '未填'}\n计划时间（北京时间UTC+8）：${plan?.scheduledAt || '未设置'}\n仅供人工发布；导出不代表已发布。\n` }
/** Never fetch a remote URL. Only resolve explicitly scoped, known local resource endpoints. */
function localMedia(space: string, value: string): { path: string; mime: string } | undefined {
  if (!value.startsWith('/digital-human-studio/')) return undefined
  try {
    const url=new URL(value,'http://local.invalid'); if (url.searchParams.get('space')!==space) return undefined
    let file: string | undefined, mime='', base=''
    if (url.pathname==='/digital-human-studio/materials/file') { const item=findStudioMaterial(space,url.searchParams.get('id') || ''); if (item) { file=materialAbsolutePath(space,item);mime=materialMime(item.name);base=spaceMaterialsRoot(space) } }
    if (url.pathname==='/digital-human-studio/image/file') { const ext=url.searchParams.get('ext') || '';if (ext && !/^(png|jpg|jpeg|webp|gif|bmp|avif)$/.test(ext)) return undefined;const item=readImageFile(url.searchParams.get('id') || '',ext,space);file=item?.path;mime=item?.contentType || '';base=imageLayoutForSpace(space).files }
    if (url.pathname==='/digital-human-studio/works/file') { const item=exportFilePath(space,url.searchParams.get('id') || '');if (item) { file=item.path;mime=item.mime;base=exportRoot(space) } }
    if (url.pathname==='/digital-human-studio/works/cover-file') { const p=exportCoverFramePath(space,url.searchParams.get('id') || '');if (existsSync(p)) { file=p;mime='image/jpeg';base=exportRoot(space) } }
    if (url.pathname==='/digital-human-studio/works/thumb') { const p=exportThumbPath(space,url.searchParams.get('id') || '');if (existsSync(p)) { file=p;mime='image/jpeg';base=exportRoot(space) } }
    if (!file || !existsSync(file)) return undefined
    const real=realpathSync(file); const allowed=base && existsSync(base) ? realpathSync(base) : resolve(realpathSync(homedir()),relative(homedir(),base)); if (!base || !real.startsWith(`${allowed}${sep}`) || !statSync(real).isFile() || !/^(image|video)\//.test(mime) || mime==='image/svg+xml') return undefined
    return { path:real,mime }
  } catch { return undefined }
}
export function packDownload(space: string, id: unknown, kind: string) {
  const p=getPack(space,id)
  if (kind==='text') return { bytes:Buffer.from(packText(space,p),'utf8'), mime:'text/plain; charset=utf-8', name:'publish-copy.txt' }
  if (kind!=='video' && kind!=='cover') throw new Error('下载类型无效')
  const plan=planOf(space,p.planId)
  const url=kind==='video' ? video(space,plan?.historyId || '')?.mediaUrl || '' : coverUrl(space,p.coverRef)
  const file=localMedia(space,url);if (!file) throw new Error('资源缺失或仅有外链，不能安全下载；可手动打开原链接，系统不会代为获取')
  if (kind==='video' && !file.mime.startsWith('video/')) throw new Error('视频类型无效')
  if (kind==='cover' && !file.mime.startsWith('image/')) throw new Error('封面类型无效')
  return { path:file.path,mime:file.mime,name:`${kind}${extname(file.path)}` }
}
