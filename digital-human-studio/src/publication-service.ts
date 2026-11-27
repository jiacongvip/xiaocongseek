import { rememberPlatforms } from './platform-feed.js'
import { getPublishStudio, publishStudioRuntime, configurePublishStudio } from './publish-studio-bridge.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, createReadStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spaceAssetRoot, isSpaceId, loadSpaceStore } from './spaces.js'
import { loadPacks, getPack, savePack, checkPack, deletePack, packView, packOptions, packDownload } from './publish-packs.js'
import { loadPublishCalendar, upsertPublishPlan, deletePublishPlan } from './publish-calendar.js'
export type PublicationActor = 'ui' | 'ai'
export type PublicationState = 'unconfirmed' | 'queued' | 'running' | 'waiting_human' | 'accepted' | 'published_verified' | 'failed' | 'unknown' | 'cancelled'
type Binding = { id:string; platform:string; label:string; accountUid:string; revision:number; enabled:boolean; status:'unconfigured'; credentialRef?:string; geoServiceId?:string;geoAccountId?:number;geoAccountLabel?:string; updatedAt:number }
type Snapshot = { geoServiceId?:string;geoAccountId?:number;geoAccountLabel?:string; credentialRef?:string; spaceId:string; packId:string; packRevision:number; bindingId:string; bindingRevision:number; platform:string; accountLabel:string; accountUid:string; title:string; body:string; topics:string; coverRef:string; historyId:string; scheduledAt:string; videoHash:string; coverHash:string }
type Task = { id:string; state:PublicationState; snapshot:Snapshot; fingerprint:string; blockers:string[]; createdAt:number; updatedAt:number; evidence?:string; receipt?:Record<string,unknown>; dispatchStartedAt?:number; executionFinishedAt?:number; events?:{at:number;code:string}[] }
type Store = { version:1; bindings:Binding[]; tasks:Task[] }
type Platform = { key:string; type:number; kind:string; features:Record<string,unknown>; execution:string; validation:string }
const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
const platformFile=new URL('../publishing/platforms.json',import.meta.url)
export function publicationPlatforms():Platform[] { return JSON.parse(readFileSync(platformFile,'utf8')).filter((p:Platform)=>p.kind==='publisher-adapter') }
function knownSpace(space:string){if(!isSpaceId(space) || space!==space.trim() || !loadSpaceStore().spaces.some(s=>s.id===space))throw new Error('非法或不存在的公司')}
function file(space:string) {if(!isSpaceId(space))throw new Error('非法公司');return join(spaceAssetRoot(space),'publication-management.json')}
function load(space:string):Store {
 const f=file(space);if(!existsSync(f))return {version:1,bindings:[],tasks:[]}
 try{const s=JSON.parse(readFileSync(f,'utf8'));if(s.version!==1 || !Array.isArray(s.bindings) || !Array.isArray(s.tasks) || !s.bindings.every((b:Binding)=>b && /^binding-[a-f0-9-]{36}$/.test(b.id) && b.status==='unconfigured' && Number.isInteger(b.revision)) || !s.tasks.every((t:Task)=>t && /^task-[a-f0-9]{32}$/.test(t.id) && t.snapshot?.spaceId===space && typeof t.fingerprint==='string'))throw new Error();return s}
 catch{throw new Error('发布管理索引损坏，已保留原文件')}
}
function save(space:string,s:Store){const f=file(space);mkdirSync(dirname(f),{recursive:true});const tmp=`${f}.${randomUUID()}.tmp`;try{writeFileSync(tmp,JSON.stringify(s,null,2),{flag:'wx',mode:0o600});renameSync(tmp,f)}finally{if(existsSync(tmp))unlinkSync(tmp)}}
function str(value:unknown,name:string,max=200){if(typeof value!=='string' || !value.trim() || value.length>max)throw new Error(`请明确提供${name}，不能根据“这个”或上下文猜测`);return value.trim()}
function uiOnly(actor:PublicationActor){if(actor!=='ui')throw new Error('此动作仅允许用户在发布管理界面操作，AI不能批准或执行对外发布')}
function binding(space:string,id:unknown){const b=load(space).bindings.find(x=>x.id===id);if(!b)throw new Error('找不到当前公司的账号绑定');return b}
function task(space:string,id:unknown){const t=load(space).tasks.find(x=>x.id===id);if(!t)throw new Error('找不到当前公司的发布任务');return t}
function revision(actual:number,value:unknown){if(actual!==value)throw new Error('版本已变化，请重新读取后再操作')}
export function publicationRuntimeStatus(){return publishStudioRuntime()}
async function mediaHash(path:string){const before=statSync(path);const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);const after=statSync(path);if(before.size!==after.size || before.mtimeMs!==after.mtimeMs || before.ino!==after.ino)throw new Error('准备期间媒体发生变化，请重新准备');return h.digest('hex')}

/** 平台文案清洗：去 Markdown 标记、压空行、按平台限制截断。 */
export function cleanPlatformCopy(text: string, platform: string): string {
  let t = String(text || '').replace(/\r\n?/g, '\n')
  t = t.replace(/[\u200b\u200c\u200d\ufeff]/g, '')  // 零宽字符
  t = t.replace(/\*|`/g, '')                       // **粗体**、星号、代码符号
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '')         // ## 小标题（去掉星号后再处理）
  t = t.replace(/(^|\n)\s*[-*•·]\s+/g, '$1')     // 列表符号
  t = t.replace(/[ \t]+\n/g, '\n')
  t = t.replace(/\n{3,}/g, '\n\n')
  t = t.trim()
  const limit = platform === 'douyin' ? 1000 : platform === 'xiaohongshu' ? 1000 : 5000
  if (t.length > limit) t = t.slice(0, limit)
  return t
}

/** 标题：单行、去标记、抖音上限 30 字。 */
export function cleanPlatformTitle(text: string, platform: string): string {
  const one = cleanPlatformCopy(text, platform).replace(/\n+/g, ' ').trim()
  if (platform === 'tencent' || platform === '视频号' || platform === 'shipinhao') {
    const cleaned = one
      .replace(/[,，、;；|｜—–·•]+/g, ' ')
      .replace(/[^\u4e00-\u9fffA-Za-z0-9\s《》"'“”‘’:：+?？%℃]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    return cleaned.length > 16 ? cleaned.slice(0, 16).trim() : cleaned
  }
  const limit = platform === 'douyin' ? 30 : 80
  return one.length > limit ? one.slice(0, limit) : one
}

/** 标签：统一成 #标签 形式，去掉已有井号和空白。 */
export function cleanPlatformTopics(text: string): string {
  return String(text || '')
    .split(/[\s,，#]+/)
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => `#${x}`)
    .join(' ')
}


/** 抖音展示的是「作品描述」，标题不一定露出：描述开头固定带上标题，保证客户看得到。 */
export function ensureTitleInBody(title: string, body: string): string {
  const t = String(title || '').trim()
  if (!t) return body
  const head = body.slice(0, t.length + 4)
  if (head.startsWith(t)) return body
  return `${t}\n\n${body}`
}

async function buildSnapshot(space:string,packId:unknown,packRevision:unknown,bindingId:unknown){
 const p=getPack(space,str(packId,'发布包ID'));revision(p.revision,packRevision)
 const b=binding(space,str(bindingId,'账号绑定ID'));if(!b.enabled)throw new Error('账号元数据已停用')
 const view=packView(space,p);if(!view.checked)throw new Error('发布包尚未人工检查或内容已变化，请在界面重新检查')
 const aliases:Record<string,string>={'抖音':'douyin','小红书':'xiaohongshu','视频号':'tencent','微信视频号':'tencent','快手':'kuaishou','B站':'bilibili','哔哩哔哩':'bilibili','公众号':'wechat_official','微信公众号':'wechat_official'}
 if((aliases[view.planPlatform] || view.planPlatform)!==b.platform)throw new Error('排期平台与明确选择的账号平台不一致')
 const blockers=[...publicationRuntimeStatus().reasons]
 let videoHash='',coverHash=''
 try{const media=packDownload(space,p.id,'video');if(!('path' in media) || !media.path)throw new Error();videoHash=await mediaHash(media.path)}catch{blockers.push('本地视频不可用；不自动获取外链')}
 try{const cover=packDownload(space,p.id,'cover');if(!('path' in cover) || !cover.path)throw new Error();coverHash=await mediaHash(cover.path)}catch{blockers.push('本地封面不可用；不自动获取外链')}
 revision(getPack(space,p.id).revision,p.revision);revision(binding(space,b.id).revision,b.revision)
 if(!packView(space,getPack(space,p.id)).checked)throw new Error('准备期间资源或检查状态变化，请重新检查')
 const snapshot:Snapshot={credentialRef:b.credentialRef || '',spaceId:space,packId:p.id,packRevision:p.revision,bindingId:b.id,bindingRevision:b.revision,platform:b.platform,accountLabel:b.label,accountUid:b.accountUid,title:cleanPlatformTitle(p.title,b.platform),body:(b.platform==='douyin'?ensureTitleInBody(cleanPlatformTitle(p.title,b.platform),cleanPlatformCopy(p.body,b.platform)):cleanPlatformCopy(p.body,b.platform)),topics:cleanPlatformTopics(p.topics),coverRef:p.coverRef,historyId:view.planHistoryId,scheduledAt:view.planScheduledAt,videoHash,coverHash}
 return {snapshot,blockers}
}
function taskView(space:string,t:Task){let snapshotValid=false;try{const p=getPack(space,t.snapshot.packId),b=binding(space,t.snapshot.bindingId);snapshotValid=p.revision===t.snapshot.packRevision && b.revision===t.snapshot.bindingRevision && b.enabled && packView(space,p).checked}catch{}return {...t,snapshotValid,blockers:[...publicationRuntimeStatus().reasons,...(!t.snapshot.videoHash?['本地视频不可用']:[]),...(!t.snapshot.coverHash?['本地封面不可用']:[]),...(!snapshotValid?['发布包、账号或检查状态已变化，此快照失效；须重新检查并准备']:[])]}}
function publicPack(space:string,id:unknown,actor:PublicationActor){const p=packView(space,getPack(space,id));if(actor==='ui')return p;const {checkedFingerprint,mediaUrl,coverUrl,...summary}=p;return summary}
/** One service shared by HTTP/plugin and session-scoped AI. No actor comes from request data. */
export async function publicationAction(space:string,actor:PublicationActor,input:Record<string,unknown>):Promise<any>{
 knownSpace(space)
 for(const key of ['space','spaceId','actor','nonce','authorization','credential','cookie','token','path','url'])if(key in input)throw new Error('不接受公司覆盖、凭据、任意路径或确认授权参数')
 const action=String(input.action || '')
 if(['overview','tasks.list','tasks.get'].includes(action)){/* independent plugin recovers itself */}
 if(action==='task.cancel'){const studio=getPublishStudio(); if(!studio)throw new Error('未启用独立发布插件'); return studio.action(space,actor,{action:'task.cancel',id:str(input.id,'任务ID')})}
 if(action==='task.verify'){uiOnly(actor);return {success:false,blocked:true,error:'独立插件不将适配器返回当作最终发表证据；请在平台核对后手动更新日历'}}
 if(action==='geo.status' || action==='geo.accounts' || action==='geo.connect' || action==='geo.login'){throw new Error('原GEO委托入口已禁用；请使用独立 publish-studio')}
 if(action==='studio.auth.settings.get' || action==='studio.auth.settings.save' || action==='studio.auth.baseline' || action==='studio.auth.login' || action==='studio.auth.activate' || action==='studio.auth.logout' || action==='studio.runtime.deps' || action==='studio.accounts.beginLogin' || action==='studio.accounts.platforms' || action==='studio.accounts.create' || action==='studio.accounts.login.start' || action==='studio.accounts.login.poll' || action==='studio.accounts.login.cancel' || action==='studio.accounts.remove' || action==='studio.accounts.list' || action==='studio.accounts.patrol.get' || action==='studio.accounts.patrol.history' || action==='studio.accounts.patrol.save' || action==='studio.accounts.patrol.run' || action==='studio.accounts.patrol.stop' || action==='studio.accounts.patrol.draft.save' || action==='studio.accounts.patrol.send' || action==='studio.accounts.patrol.draft.send' || action==='studio.accounts.patrol.tick' || action==='studio.accounts.patrol.verify_page' || action==='studio.accounts.patrol.mark_verified'){
  const studio=getPublishStudio(); if(!studio)throw new Error('未启用独立发布插件 publish-studio')
  const map:Record<string,string>={
   'studio.runtime.deps':'runtime.deps','studio.auth.settings.get':'auth.settings.get','studio.auth.settings.save':'auth.settings.save','studio.auth.baseline':'auth.baseline',
   'studio.auth.login':'auth.login','studio.auth.activate':'auth.activate','studio.auth.logout':'auth.logout',
   'studio.accounts.beginLogin':'accounts.beginLogin','studio.accounts.platforms':'accounts.platforms','studio.accounts.create':'accounts.create',
   'studio.accounts.login.start':'accounts.login.start','studio.accounts.login.poll':'accounts.login.poll','studio.accounts.login.cancel':'accounts.login.cancel',
   'studio.accounts.remove':'accounts.remove','studio.accounts.list':'accounts.list','studio.accounts.patrol.get':'accounts.patrol.get','studio.accounts.patrol.history':'accounts.patrol.history','studio.accounts.patrol.save':'accounts.patrol.save','studio.accounts.patrol.run':'accounts.patrol.run','studio.accounts.patrol.stop':'accounts.patrol.stop','studio.accounts.patrol.draft.save':'accounts.patrol.draft.save','studio.accounts.patrol.send':'accounts.patrol.send','studio.accounts.patrol.draft.send':'accounts.patrol.draft.send','studio.accounts.patrol.tick':'accounts.patrol.tick','studio.accounts.patrol.verify_page':'accounts.patrol.verify_page','studio.accounts.patrol.mark_verified':'accounts.patrol.mark_verified'
  }
  const readOnly=action==='studio.accounts.platforms' || action==='studio.accounts.list' || action==='studio.runtime.deps' || action==='studio.accounts.patrol.get' || action==='studio.accounts.patrol.history' || action==='studio.accounts.patrol.tick'
  if(!readOnly) uiOnly(actor)
  const result=await studio.action(space, readOnly?actor:'ui',{...input,action:map[action]})
  if(action==='studio.accounts.list') rememberPlatforms(space,(result as {items?:unknown}|undefined)?.items)
  return result
 }
 if(action==='overview'){
  const studio=getPublishStudio()
  if(studio){
   const accounts=await studio.action(space,actor,{action:'accounts.list'})
   rememberPlatforms(space,(accounts as {items?:unknown}|undefined)?.items)
   const tasks=await studio.action(space,actor,{action:'tasks.list'})
   return {success:true,spaceId:space,runtime:publicationRuntimeStatus(),platforms:publicationPlatforms(),bindings:accounts.items,tasks:tasks.items}
  }
  return {success:true,spaceId:space,runtime:publicationRuntimeStatus(),platforms:publicationPlatforms(),bindings:[],tasks:[]}
 }
 if(action==='pack.list')return {success:true,spaceId:space,items:loadPacks(space).map(p=>publicPack(space,p.id,actor)),...packOptions(space)}
 if(action==='pack.get')return {success:true,spaceId:space,item:publicPack(space,input.id,actor)}
 if(action==='pack.save'){const p=savePack(space,(input.item || {}) as Record<string,unknown>);return {success:true,spaceId:space,item:publicPack(space,p.id,actor)}}
 if(action==='pack.check'){uiOnly(actor);const p=checkPack(space,input.id,input.revision);return {success:true,spaceId:space,item:publicPack(space,p.id,actor)}}
 if(action==='pack.delete'){deletePack(space,input.id,input.revision);return {success:true,spaceId:space}}
 if(action==='pack.calendar')throw new Error('发布包不再单独保存时间，请到日历里改排期')
 if(action==='calendar.list')return {success:true,spaceId:space,items:loadPublishCalendar(space),timeZone:'Asia/Shanghai'}
 if(action==='calendar.save'){
  const item=(input.item || {}) as Record<string,unknown>
  if(item.id){const old=loadPublishCalendar(space).find(x=>x.id===item.id);if(!old)throw new Error('找不到当前公司的排期');revision(old.updatedAt,input.expectedUpdatedAt)}
  return {success:true,spaceId:space,item:upsertPublishPlan(space,item),timeZone:'Asia/Shanghai'}
 }
 if(action==='calendar.delete'){const old=loadPublishCalendar(space).find(x=>x.id===input.id);if(!old)throw new Error('找不到当前公司的排期');revision(old.updatedAt,input.expectedUpdatedAt);deletePublishPlan(space,input.id);return {success:true,spaceId:space}}
 if(action==='binding.save'){
  uiOnly(actor);const item=(input.item || {}) as Record<string,unknown>
  const studio=getPublishStudio(); if(!studio)throw new Error('未启用独立发布插件 publish-studio，无法保存账号绑定；不会回退原GEO')
  if(Object.keys(item).some(k=>['cookie','token','password','path','filePath','credential','geoAccountId','geoServiceId','credentialRef'].includes(k)))throw new Error('账号绑定只接受摘要，禁止传入登录态/原GEO字段或凭据')
  return studio.action(space,'ui',{action:'accounts.save',item})
 }
 if(action==='binding.disable'){uiOnly(actor);const s=load(space),b=binding(space,input.id);revision(b.revision,input.revision);b.enabled=false;b.revision++;b.updatedAt=Date.now();s.bindings=s.bindings.map(x=>x.id===b.id?b:x);save(space,s);return {success:true,spaceId:space}}
 if(action==='tasks.list'){const studio=getPublishStudio(); if(!studio)return {success:true,spaceId:space,items:[]}; return studio.action(space,actor,{action:'tasks.list'})}
 if(action==='tasks.get'){const studio=getPublishStudio(); if(!studio)throw new Error('未启用独立发布插件'); return studio.action(space,actor,{action:'tasks.get',id:input.id})}
 if(action==='task.prepare'){
  const studio=getPublishStudio(); if(!studio)throw new Error('未启用独立发布插件 publish-studio；不会回退原GEO')
  const pack=getPack(space,str(input.packId,'发布包ID')); revision(pack.revision,input.packRevision)
  const view=packView(space,pack); if(!view.checked)throw new Error('发布包尚未人工检查或内容已变化，请在界面重新检查')
  const video=packDownload(space,pack.id,'video'); const cover=packDownload(space,pack.id,'cover')
  if(!('path' in video) || !video.path || !('path' in cover) || !cover.path)throw new Error('本地视频/封面不可用；不自动获取外链')
  const aliases:Record<string,string>={'抖音':'douyin','小红书':'xiaohongshu','视频号':'tencent','微信视频号':'tencent','快手':'kuaishou','B站':'bilibili','哔哩哔哩':'bilibili'}
  const platform=aliases[view.planPlatform] || view.planPlatform
  return studio.action(space,actor,{action:'task.prepare',packId:pack.id,packRevision:pack.revision,bindingId:str(input.bindingId,'账号绑定ID'),platform,title:pack.title,body:pack.body,topics:pack.topics,stageVideoPath:video.path,stageCoverPath:cover.path})
 }
 if(action==='confirmation.request' || action==='confirmation.submit'){uiOnly(actor);return {success:false,blocked:true,error:'请在发布管理界面使用人工预览确认专用入口；普通管理接口不会批准或执行发布'}}
 throw new Error('未知或禁止的发布动作；AI只能准备草稿，不能批准、发送或自动重试')
}

/** Reference-only manifest for the disabled offline runner; never carries credentials or file paths. */
export function publicationExecutionManifest(space:string,id:string){const t=task(space,id);if(!taskView(space,t).snapshotValid)throw new Error('发布快照已失效');return {schemaVersion:1,spaceId:space,taskId:t.id,packId:t.snapshot.packId,packRevision:t.snapshot.packRevision,platform:t.snapshot.platform,bindingId:t.snapshot.bindingId,snapshotFingerprint:t.fingerprint}}

/** Offline confirmation primitive for a future audited executor. NOT wired to production routes. */
export function createOfflineConfirmationGate(){
 const grants=new Map<string,{space:string;taskId:string;fingerprint:string;revision:number;expires:number;used:boolean}>()
 return {
  issue(actor:PublicationActor,space:string,taskId:string,fingerprint:string,revision:number){uiOnly(actor);const nonce=randomUUID()+randomUUID();grants.set(digest(nonce),{space,taskId,fingerprint,revision,expires:Date.now()+120000,used:false});return nonce},
  consume(actor:PublicationActor,nonce:string,space:string,taskId:string,fingerprint:string,revision:number){uiOnly(actor);const grant=grants.get(digest(nonce));if(!grant || grant.used || grant.expires<Date.now() || grant.space!==space || grant.taskId!==taskId || grant.fingerprint!==fingerprint || grant.revision!==revision)throw new Error('确认授权无效、过期、已使用或内容变化');grant.used=true;return true},
 }
}
/** Offline evidence mapper; boolean success or a management-page redirect is not published proof. */
export function publicationEvidenceState(result:{success?:boolean;isDraft?:boolean;publishId?:string;workId?:string;publicUrl?:string;verified?:boolean;uncertain?:boolean}):PublicationState {
 if(result.isDraft)return 'waiting_human'
 if(result.uncertain)return 'unknown'
 if(result.verified && result.workId && result.publicUrl && /^https:\/\//.test(result.publicUrl))return 'published_verified'
 if(result.publishId)return 'accepted'
 if(result.success===false)return 'failed'
 return 'unknown'
}


export async function publicationHumanAction(space:string,input:Record<string,unknown>,session:string){
 if(!isSpaceId(space) || !session)throw new Error('公司或确认会话无效')
 const studio=getPublishStudio(); if(!studio)throw new Error('未启用独立发布插件 publish-studio；不会回退原GEO')
 const allowed=['action','id','challenge','csrf']; if(Object.keys(input).some(k=>!allowed.includes(k)))throw new Error('确认接口不接受公司覆盖、路径、凭据或自造授权参数')
 return studio.humanAction(space,input,session)
}

/** Optional legacy GEO bridge entry — always disabled by default. */
export async function publicationGeoAction(_space?:string,_input?:Record<string,unknown>){
 throw new Error('原GEO /postVideo 委托默认关闭；请启用独立 publish-studio')
}

export async function publicationTaskMedia(space:string,id:string,kind:string){
 knownSpace(space); if(!['video','cover'].includes(kind))throw new Error('资源类型无效')
 const studio=getPublishStudio()
 if(studio){
  const got=await studio.action(space,'ui',{action:'tasks.get',id})
  const packId=got?.item?.snapshot?.packId
  if(!packId)throw new Error('任务快照缺少发布包，无法预览')
  return packDownload(space,packId,kind)
 }
 // Legacy local tasks only if studio absent
 const t=task(space,id)
 return packDownload(space,t.snapshot.packId,kind)
}

export { configurePublishStudio, getPublishStudio }
