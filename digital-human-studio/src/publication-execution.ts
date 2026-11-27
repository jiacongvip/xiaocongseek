/** @deprecated Phase-2 prototype. Not registered or used by production. Original GEO /postVideo is the current executor and quota authority; no new claim/reserve/WebAuthn contract is required. */
import { randomBytes, createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
export type Scope={spaceId:string;taskId:string;fingerprint:string;platform:string;bindingId:string;credentialRef:string;packRevision:number;bindingRevision:number}
export type Policy={allowed:boolean;clientAuthorized:boolean;allowPublish:boolean;quotaRemaining:number;policyRevision:string;expiresAt:number}
export type Reservation={allowed:boolean;reservationId:string;policyRevision:string;expiresAt:number}
export type CredentialSummary={configured:boolean;spaceId:string;bindingId:string;platform:string;credentialRef:string;revision:string}
export type CredentialLease=CredentialSummary & {accountFile:string;expiresAt:number;driver:'browser'|'wechat-api'}
export type ExecutionJob={scope:Scope;snapshot:any;mediaRoot:string;video:string;cover:string;contentMode:'video'|'image'|'article'}
export type Receipt={requestId?:string;workId?:string;publicUrl?:string}
export type ExecutionResult={kind:'accepted'|'waiting_human'|'unknown'|'failed_before_dispatch'|'failed';failureCode?:'platform-rejected'|'invalid-content';receipt?:Receipt}
export type Providers={version:1;revision:string;authorization:{inspect(scope:Scope):Promise<Policy>;reserve(scope:Scope,policy:Policy):Promise<Reservation>;claim(scope:Scope,reservation:Reservation):Promise<boolean>;settle(scope:Scope,reservation:Reservation,outcome:string):Promise<void>};credentials:{describe(scope:Scope):Promise<CredentialSummary>;lease(scope:Scope):Promise<CredentialLease>};presence:PresenceProvider;executor:{id:string;capabilities?:{platform:string;modes:string[]}[];preflight(job:ExecutionJob):Promise<boolean>;execute(job:ExecutionJob,lease:CredentialLease,reservation:Reservation,onProgress:(event:'progress'|'waiting_human')=>void):Promise<ExecutionResult>};evidence?:{verify(scope:Scope,receipt:Receipt):Promise<{verified:boolean;workId?:string;publicUrl?:string}>}}
export type PresenceProvider={options(spaceId:string):{rpId:string;allowCredentials:{id:string;type:'public-key'}[]};verify(spaceId:string,challenge:string,assertion:unknown):Promise<boolean>}
type Repo={get(space:string,id:string):any;list(space:string):any[];validate(space:string,id:string):Promise<ExecutionJob>;patch(space:string,id:string,changes:Record<string,unknown>,code:string):any}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const safeReceipt=(raw:Receipt|undefined):Receipt=>{const r:Receipt={};if(raw?.requestId && /^[\w.:-]{1,200}$/.test(raw.requestId))r.requestId=raw.requestId;if(raw?.workId && /^[\w.:-]{1,200}$/.test(raw.workId))r.workId=raw.workId;if(raw?.publicUrl){try{const u=new URL(raw.publicUrl);if(u.protocol==='https:' && !u.username && !u.password){u.search='';u.hash='';r.publicUrl=u.toString()}}catch{}}return r}
/** Provider objects are trusted server wiring, NEVER JSON supplied by browser/model. */
export function createPublicationExecution(repo:Repo){
 let providers:Providers|undefined
 const challenges=new Map<string,{space:string;id:string;session:string;fingerprint:string;providerRevision:string;credentialRevision:string;policyRevision:string;expires:number}>(),inflight=new Set<string>(),accountLocks=new Set<string>()
 const key=(space:string,id:string)=>space+':'+id
 function configure(p?:Providers){providers=undefined;challenges.clear();if(p && (p.version!==1 || !p.revision || !p.authorization?.inspect || !p.authorization?.reserve || !p.authorization?.claim || !p.authorization?.settle || !p.credentials?.describe || !p.credentials?.lease || !p.presence?.verify || !p.presence?.options || !p.executor?.preflight || !p.executor?.execute))throw new Error('发布provider配置契约不完整');providers=p;challenges.clear()}
 function runtime(){return {enabled:!!providers,mode:providers?'provider-gated':'providers-missing',connectedModes:providers?.executor.capabilities || [],schedulerEnabled:false,reasons:providers?[]:['未配置合法GEO授权、发布权限与原子额度provider','未配置独立凭据引用provider；不会扫描或迁移GEO账号','未配置用户验证(WebAuthn)与受控执行器','未启动自动发送调度器']}}
 function recover(space:string){for(const t of repo.list(space))if((['queued','running'].includes(t.state) || t.state==='waiting_human' && t.dispatchStartedAt && !t.executionFinishedAt) && !inflight.has(key(space,t.id)))repo.patch(space,t.id,{state:'unknown'},'process-interrupted-no-retry')}
 function unresolved(space:string,t:any){return repo.list(space).some(x=>x.id!==t.id && ['unknown','accepted','waiting_human','running','queued'].includes(x.state) && x.snapshot.packId===t.snapshot.packId && x.snapshot.bindingId===t.snapshot.bindingId)}
 function policyOkay(p:Policy){return p?.allowed===true && p.clientAuthorized===true && p.allowPublish===true && Number.isSafeInteger(p.quotaRemaining) && p.quotaRemaining>=1 && typeof p.policyRevision==='string' && !!p.policyRevision && typeof p.expiresAt==='number' && Number.isFinite(p.expiresAt) && p.expiresAt>Date.now()}
 function credentialOkay(c:CredentialSummary,s:Scope){return c?.configured===true && c.spaceId===s.spaceId && c.bindingId===s.bindingId && c.platform===s.platform && c.credentialRef===s.credentialRef && typeof c.revision==='string' && !!c.revision}
 async function ready(space:string,id:string){
  recover(space);const p=providers;if(!p)return {blocked:true,reasons:runtime().reasons}
  const t=repo.get(space,id);if(t.state!=='unconfirmed')return {blocked:true,reasons:['任务已执行、取消或结果未知，不允许重复发送']}
  if(unresolved(space,t))return {blocked:true,reasons:['同发布包/账号有结果未知任务，须先人工核对，不允许换版本盲重试']}
  let job:ExecutionJob;try{job=await repo.validate(space,id)}catch{return {blocked:true,reasons:['发布包、账号或本地媒体已变化/缺失，请重新检查并准备']}}
  if(!job.scope.credentialRef)return {blocked:true,reasons:['账号尚未选择独立凭据引用']}
  try{
   const [policy,credential]=await Promise.all([p.authorization.inspect(job.scope),p.credentials.describe(job.scope)])
   if(providers!==p)return {blocked:true,reasons:['provider已变化，请重新确认']}
   if(!policyOkay(policy))return {blocked:true,reasons:['合法授权、allow_publish或剩余额度未通过']}
   if(!credentialOkay(credential,job.scope))return {blocked:true,reasons:['独立凭据未配置、归属不符或已变化']}
   if(!await p.executor.preflight(job))return {blocked:true,reasons:['执行环境或平台适配前置检查未通过']}
   const options=p.presence.options(space);if(!options.allowCredentials.length)return {blocked:true,reasons:['未登记本公司用户验证器，不能仅凭HTTP请求批准发布']}
   return {blocked:false,job,policy,credential,p,options,reasons:[]}
  }catch{return {blocked:true,reasons:['provider检查不可用；未获取凭据或执行发布']}}
 }
 async function challenge(space:string,id:string,session:string){
  const r=await ready(space,id);if(r.blocked || !r.job || !r.p || !r.credential || !r.policy || !r.options)return {success:false,blocked:true,error:r.reasons.join('；')}
  const nonce=randomBytes(32).toString('base64url');for(const [n,g] of challenges)if(g.expires<Date.now() || (g.space===space && g.id===id && g.session===session))challenges.delete(n)
  challenges.set(nonce,{space,id,session,fingerprint:r.job.scope.fingerprint,providerRevision:r.p.revision,credentialRevision:r.credential.revision,policyRevision:r.policy.policyRevision,expires:Date.now()+120000})
  return {success:true,spaceId:space,id,challenge:nonce,publicKey:{...r.options,challenge:nonce,userVerification:'required',timeout:120000}}
 }
 async function submit(space:string,id:string,session:string,nonce:string,assertion:unknown){
  const grant=challenges.get(nonce);if(!grant || grant.space!==space || grant.id!==id || grant.session!==session || grant.expires<Date.now())throw new Error('确认凭证无效、过期、跨公司/会话或已使用')
  // Consume before any await; parallel replay cannot pass. A failed assertion needs a fresh visible confirmation.
  challenges.delete(nonce)
  const p=providers;if(!p || grant.providerRevision!==p.revision)throw new Error('provider变化，须重新确认')
  let valid=false;try{valid=await p.presence.verify(space,nonce,assertion)}catch{}
  if(!valid)throw new Error('用户验证签名无效，不能批准发布')
  const r=await ready(space,id);if(r.blocked || !r.job || !r.credential || !r.policy || r.p!==p)return {success:false,blocked:true,error:r.reasons.join('；')}
  const job=r.job;if(grant.expires<=Date.now())throw new Error('用户确认已过期，须重新操作');if(job.scope.fingerprint!==grant.fingerprint || r.credential.revision!==grant.credentialRevision || r.policy.policyRevision!==grant.policyRevision)throw new Error('内容、凭据或授权版本变化，须重新确认')
  const taskKey=key(space,id),accountKey=space+':'+job.scope.bindingId
  if(inflight.has(taskKey) || accountLocks.has(accountKey))return {success:false,blocked:true,error:'任务或账号已有执行中的操作，不排队重复发送'}
  inflight.add(taskKey);accountLocks.add(accountKey)
  let reservation:Reservation|undefined,dispatched=false
  try{
   repo.patch(space,id,{state:'queued'},'human-confirmed')
   reservation=await p.authorization.reserve(job.scope,r.policy)
   if(reservation?.allowed!==true || typeof reservation.reservationId!=='string' || !reservation.reservationId || reservation.reservationId.length>512 || reservation.policyRevision!==r.policy.policyRevision || typeof reservation.expiresAt!=='number' || !Number.isFinite(reservation.expiresAt) || reservation.expiresAt<=Date.now())throw new Error('quota-reservation-denied')
   if(repo.get(space,id).state==='cancelled'){await p.authorization.settle(job.scope,reservation,'cancelled-before-execution');return {success:true,spaceId:space,item:repo.get(space,id)}}
   const lease=await p.credentials.lease(job.scope)
   if(!credentialOkay(lease,job.scope) || lease.revision!==r.credential.revision || typeof lease.expiresAt!=='number' || !Number.isFinite(lease.expiresAt) || lease.expiresAt<=Date.now())throw new Error('credential-unavailable')
   const current=await repo.validate(space,id)
   if(current.scope.fingerprint!==grant.fingerprint || providers!==p)throw new Error('snapshot-changed')
   if(repo.get(space,id).state==='cancelled'){await p.authorization.settle(job.scope,reservation,'cancelled-before-execution');return {success:true,spaceId:space,item:repo.get(space,id)}}
   if(grant.expires<=Date.now() || reservation.expiresAt<=Date.now() || lease.expiresAt<=Date.now())throw new Error('provider-permit-expired')
   repo.patch(space,id,{state:'running',dispatchStartedAt:Date.now()},'dispatch-claiming');dispatched=true
   if(!await p.authorization.claim(job.scope,reservation) || providers!==p || grant.expires<=Date.now() || reservation.expiresAt<=Date.now() || lease.expiresAt<=Date.now())throw new Error('dispatch-claim-denied-or-uncertain')
   repo.patch(space,id,{},'executor-starting')
   const result=await p.executor.execute(current,lease,reservation,event=>{const state=repo.get(space,id).state;if(['running','waiting_human'].includes(state))repo.patch(space,id,{state:event==='waiting_human'?'waiting_human':'running'},event==='waiting_human'?'platform-needs-human':'executor-progress')})
   if(!['accepted','waiting_human','unknown','failed_before_dispatch','failed'].includes(result.kind))throw new Error('invalid-executor-result')
   const receipt=safeReceipt(result.receipt);let state:string=result.kind==='failed_before_dispatch' || result.kind==='failed' && !['platform-rejected','invalid-content'].includes(String(result.failureCode))?'unknown':result.kind
   if(state==='accepted' && !receipt.requestId)state='unknown'
   if((state==='accepted' || state==='unknown') && p.evidence && Object.keys(receipt).length){try{const proof=await p.evidence.verify(job.scope,receipt);const safe=safeReceipt(proof);if(proof.verified && safe.workId && safe.publicUrl){state='published_verified';Object.assign(receipt,safe)}}catch{}}
   repo.patch(space,id,{state,receipt,executionFinishedAt:Date.now()},state==='unknown'?'result-unknown-no-retry':'executor-result')
   try{await p.authorization.settle(job.scope,reservation,state)}catch{repo.patch(space,id,{},'quota-settlement-unknown')}
   return {success:true,spaceId:space,item:repo.get(space,id)}
  }catch{
   const state=dispatched?'unknown':repo.get(space,id).state==='cancelled'?'cancelled':'unconfirmed'
   repo.patch(space,id,{state},dispatched?'execution-interrupted-no-retry':'provider-or-resource-blocked')
   if(reservation?.allowed)try{await p.authorization.settle(job.scope,reservation,dispatched?'unknown':'blocked-before-execution')}catch{}
   return {success:false,spaceId:space,blocked:!dispatched,error:dispatched?'执行结果未知，禁止自动重试，请核对平台':'授权额度、凭据或媒体复核未通过，未执行发布',item:repo.get(space,id)}
  }finally{inflight.delete(taskKey);accountLocks.delete(accountKey)}
 }
 function cancel(space:string,id:string){const t=repo.get(space,id);if(!['unconfirmed','queued'].includes(t.state) || t.dispatchStartedAt)throw new Error('仅可取消尚未执行的任务；不代表撤回平台内容');for(const [n,g] of challenges)if(g.space===space && g.id===id)challenges.delete(n);return {success:true,spaceId:space,item:repo.patch(space,id,{state:'cancelled'},'cancelled-before-execution')}}
 async function verifyResult(space:string,id:string){const t=repo.get(space,id),p=providers;if(!p?.evidence || !t.receipt || !['accepted','unknown'].includes(t.state))return {success:false,blocked:true,error:'缺少可核验回执或结果核验provider，须在平台人工核对'};try{const scope={spaceId:space,taskId:id,fingerprint:t.fingerprint,platform:t.snapshot.platform,bindingId:t.snapshot.bindingId,credentialRef:t.snapshot.credentialRef || '',packRevision:t.snapshot.packRevision,bindingRevision:t.snapshot.bindingRevision},proof=await p.evidence.verify(scope,t.receipt),receipt=safeReceipt(proof);if(!proof.verified || !receipt.workId || !receipt.publicUrl)return {success:false,blocked:true,error:'平台尚未提供最终发表证据'};return {success:true,spaceId:space,item:repo.patch(space,id,{state:'published_verified',receipt:{...t.receipt,...receipt}},'platform-publication-verified')}}catch{return {success:false,blocked:true,error:'核验暂不可用，没有重发内容'}}}
 return {configure,runtime,ready,challenge,submit,cancel,verifyResult,recover}
}

/** Real WebAuthn signature verifier using pre-enrolled PUBLIC keys only. No auto-trust registration. */
export function createWebAuthnPresence(config:{rpId:string;origin:string;credentials:{id:string;spaces:string[];publicKeyJwk:Record<string,unknown>}[]}):PresenceProvider{
 const counters=new Map<string,number>()
 return {options(space){return {rpId:config.rpId,allowCredentials:config.credentials.filter(c=>c.spaces.includes(space)).map(c=>({id:c.id,type:'public-key' as const}))}},async verify(space,challenge,input){
  try{const a=input as any,c=config.credentials.find(c=>c.id===a.id && c.spaces.includes(space));if(!c || a.type!=='public-key')return false
   const client=Buffer.from(a.response.clientDataJSON,'base64url'),data=JSON.parse(client.toString('utf8')),auth=Buffer.from(a.response.authenticatorData,'base64url'),signature=Buffer.from(a.response.signature,'base64url')
   if(data.type!=='webauthn.get' || data.challenge!==challenge || data.origin!==config.origin || data.crossOrigin===true || auth.length<37 || !auth.subarray(0,32).equals(createHash('sha256').update(config.rpId).digest()) || (auth[32]! & 5)!==5)return false
   const count=auth.readUInt32BE(33),previous=counters.get(c.id) || 0;if(count && previous && count<=previous)return false
   const key=createPublicKey({key:c.publicKeyJwk as any,format:'jwk'}),okay=verifySignature('sha256',Buffer.concat([auth,createHash('sha256').update(client).digest()]),key,signature)
   if(okay)counters.set(c.id,count);return okay
  }catch{return false}
 }}
}
