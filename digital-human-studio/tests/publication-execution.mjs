// Supersedes phase-2 invented reserve/claim + mandatory WebAuthn contract tests.
// All original-service requests are fixture-only; no network, login or real media.
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
const home=mkdtempSync(join(tmpdir(),'geo-thin-fixture-')),oldHome=process.env.HOME,oldFetch=globalThis.fetch
process.env.HOME=home
let calls=[],postCount=0,platformCalls=0,used=7,limit=7,permission=true,authRequired=true,enforce=true,accountLabel='夹具原账号',accountPath='fixture-only-account.json',mode='ok',forceAuthRejectOnPost=false,accountStatus=1,waitRelease,enteredResolve
const response=(data,code=200)=>new Response(JSON.stringify({code,msg:'fixture',data}),{status:code})
const fixtureFetch=async(raw,init={})=>{
 const u=new URL(String(raw));assert.ok(['127.0.0.1','localhost','fixture-auth.test'].includes(u.hostname),'real network forbidden');calls.push(u.pathname)
 if(u.pathname==='/getClientAuthServerConfig')return response({enabled:authRequired,aid:62,baseUrl:'https://fixture-auth.test/client',permissions:{enabled:enforce}})
 if(u.pathname==='/client/login' || u.pathname==='/client/activate'){const b=JSON.parse(init.body);assert.equal(b.aid,62);assert.equal(b.product_key,'fixture-product');assert.ok(b.install_id);assert.ok(b.machine_hash);if(u.pathname.endsWith('/login'))assert.equal(b.password,'fixture-password');else assert.equal(b.auth_code,'fixture-code');return response({access_token:'fixture-access-never-output',refresh_token:'fixture-refresh-never-output'})}
 if(u.pathname==='/client/refresh'){assert.equal(JSON.parse(init.body).refresh_token,'fixture-refresh-never-output');return response({access_token:'fixture-access-never-output',refresh_token:'fixture-refresh-never-output'})}
 assert.equal(init.headers['X-Client-Aid'],'62')
 if(authRequired && init.headers.Authorization!=='Bearer fixture-access-never-output')return response(null,401)
 if(u.pathname==='/getClientPermissionContext')return response({permissions:permission===undefined?{}:{allow_publish:permission,daily_publish_limit:limit}})
 if(u.pathname==='/getAccounts')return response([[11,3,accountPath,accountLabel,accountStatus]])
 if(u.pathname==='/postVideo'){
  postCount++;if(forceAuthRejectOnPost)return response(null,401);const body=JSON.parse(init.body);assert.equal(body.type,3);assert.equal(body.platform,'douyin');assert.deepEqual(body.accountList,[accountPath]);assert.equal(body.enableTimer,false);assert.equal(body.isDraft,false);assert.equal(body.fileType,2);assert.equal(body.publishDriver,'automation');assert.ok(!('dispatchClaim' in body));assert.ok(body.fileList[0].startsWith(realpathSync(home)));assert.ok(body.thumbnail.startsWith(realpathSync(home)));assert.match(readFileSync(body.fileList[0],'utf8'),/^fixture-video-/)
  if(enforce && (permission===false || limit<=0 || used+1>limit))return response(null,403)
  used++;platformCalls++
  if(mode==='timeout')throw new Error('fixture transport failure; no actual request')
  if(mode==='wait'){enteredResolve?.();await new Promise(resolve=>{waitRelease=resolve})}
  return response({task_id:'fixture-upstream-task',status:'success',is_draft:false})
 }
 throw new Error('unrecognized fixture route: '+u.pathname)
}
globalThis.fetch=async(...args)=>{try{return await fixtureFetch(...args)}catch(e){if(e instanceof assert.AssertionError)console.error('FIXTURE assertion:',e.message);throw e}}
try{
 const spaces=await import('../dist/spaces.js'),materials=await import('../dist/studio-materials.js'),history=await import('../dist/studio-history.js'),packs=await import('../dist/publish-packs.js'),cal=await import('../dist/publish-calendar.js'),s=await import('../dist/publication-service.js')
 const created=spaces.createSpace(spaces.emptySpaceStore(),'隔离公司A'),a=created.space.id;spaces.saveSpaceStore(created.store)
 const routes=new Map(),disposers=[];const ctx={get(name){return name==='connection'?{requestRejection(){return undefined}}:name==='credentials'?{async unset(){},async set(){}}:undefined},effect(run){const off=run();if(typeof off==='function')disposers.push(off)},webServer:{register(def){routes.set(def.path,def.handler);return()=>{}}},tools:{register(){return()=>{}}}}
 const {apply}=await import('../dist/index.js');await apply(ctx)
 const act=(actor,input,space=a)=>s.publicationAction(space,actor,input)
 const human=async(id,body,session='fixture-host-session',space=a)=>{const req=Readable.from([Buffer.from(JSON.stringify({space,id,...body}))]);Object.assign(req,{method:'POST',url:'/digital-human-studio/publication-confirmation',headers:{host:'127.0.0.1:3080',origin:'http://127.0.0.1:3080','content-type':'application/json',authorization:session}});return new Promise((resolve,reject)=>routes.get('/digital-human-studio/publication-confirmation')(req,{headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true},end(value){const v=JSON.parse(String(value));if(this.status===400 || this.status===403)reject(new Error(v.error));else resolve(v)}}))} 
 const cover=materials.addStudioMaterial(a,'logo','fixture.png',Buffer.from('fixture-image'));let n=0
 async function make(){n++;const m=materials.addStudioMaterial(a,'product','fixture.mp4',Buffer.from('fixture-video-'+n));history.upsertStudioHistory(a,{id:'fixture-history-'+n,kind:'xdh-avatar-video',title:'夹具',at:n,status:'SUCCESS',mediaUrl:materials.materialPublicUrl(a,m)});const p=(await act('ui',{action:'pack.save',item:{historyId:'fixture-history-'+n,title:'夹具标题'+n,body:'夹具正文',topics:'#夹具',platform:'抖音',coverRef:'material:'+cover.id,scheduledAt:'2099-12-01T00:05',revision:0}})).item;const checked=(await act('ui',{action:'pack.check',id:p.id,revision:p.revision})).item;return {p:checked,m}}
 async function prepare(p,b){return (await act('ai',{action:'task.prepare',packId:p.id,packRevision:p.revision,bindingId:b.id})).item}
 await assert.rejects(act('ui',{action:'overview'},'co-not-registered'),/不存在/);await assert.rejects(act('ui',{action:'overview'},' '+a),/公司/);assert.equal((await act('ui',{action:'overview'})).runtime.enabled,false);assert.equal(calls.length,0,'import/status never connects')
 await s.publicationGeoAction(a,{action:'connect',baseUrl:'http://127.0.0.1:5409'});assert.equal((await act('ui',{action:'overview'})).runtime.connection.authRequired,true)
 await assert.rejects(act('ui',{action:'geo.accounts'}),/授权/)
 await s.publicationGeoAction(a,{action:'login',username:'fixture-user',password:'fixture-password',productKey:'fixture-product'});await s.publicationGeoAction(a,{action:'renew'});await s.publicationGeoAction(a,{action:'login',authCode:'fixture-code',productKey:'fixture-product'})
 const accounts=(await act('ui',{action:'geo.accounts'})).items;assert.equal(accounts.length,1);assert.ok(!JSON.stringify(accounts).includes(accountPath));const serviceId=accounts[0].serviceId
 const binding=(await act('ui',{action:'binding.save',item:{platform:'douyin',label:'本公司别名',geoAccountId:11,geoServiceId:serviceId}})).item
 assert.equal(binding.geoAccountLabel,accountLabel)
 await assert.rejects(act('ui',{action:'binding.save',item:{platform:'douyin',label:'跨公司',geoAccountId:11,geoServiceId:serviceId}},'default'),/已明确绑定/)
 assert.equal((await act('ui',{action:'geo.accounts'},'default')).items.length,0)
 await assert.rejects(act('ai',{action:'geo.accounts'}),/仅允许用户/)
 await assert.rejects(act('ai',{action:'binding.save',item:{}}),/仅允许用户/)
 const {p,m}=await make(),t=await prepare(p,binding)
 assert.equal((await act('ai',{action:'tasks.get',id:t.id})).item.id,t.id)
 assert.equal((await act('ui',{action:'tasks.get',id:t.id})).item.id,t.id)
 await assert.rejects(act('ai',{action:'confirmation.request',id:t.id}),/仅允许用户/)
 await assert.rejects(human(t.id,{action:'challenge',actor:'ui'}),/不接受/)
 await assert.rejects(human(t.id,{action:'challenge'},'fixture-host-session','default'),/找不到/)
 let expired=await human(t.id,{action:'challenge'});const clock=Date.now;try{Date.now=()=>clock()+121000;await assert.rejects(human(t.id,{action:'submit',challenge:expired.challenge,csrf:expired.csrf}),/无效/)}finally{Date.now=clock}
 let g=await human(t.id,{action:'challenge'});assert.equal(g.success,true,g.error);assert.ok(g.csrf);assert.ok(!g.publicKey)
 await assert.rejects(human(t.id,{action:'submit',challenge:g.challenge,csrf:g.csrf},'other-session'),/无效/)
 await assert.rejects(human(t.id,{action:'submit',challenge:g.challenge,csrf:'forged'}),/无效/)
 let result=await human(t.id,{action:'submit',challenge:g.challenge,csrf:g.csrf});assert.equal(result.blocked,true);assert.equal(result.item.state,'unconfirmed');assert.equal(postCount,1);assert.equal(used,7);assert.equal(platformCalls,0,'original ledger 7/7 denies; target must not count from zero')
 await assert.rejects(human(t.id,{action:'submit',challenge:g.challenge,csrf:g.csrf}),/无效/)
 limit=8;permission=false;assert.equal((await human(t.id,{action:'challenge'})).blocked,true);assert.equal(postCount,1)
 permission=undefined;g=await human(t.id,{action:'challenge'});assert.equal(g.success,true,'original missing permission defaults preserved');permission=true
 accountPath='fixture-only-changed-account.json';await assert.rejects(human(t.id,{action:'submit',challenge:g.challenge,csrf:g.csrf}),/变化/);assert.equal(postCount,1)
 g=await human(t.id,{action:'challenge'});writeFileSync(packs.packDownload(a,p.id,'video').path,'changed fixture bytes');assert.equal((await human(t.id,{action:'submit',challenge:g.challenge,csrf:g.csrf})).blocked,true);assert.equal(postCount,1)
 const f2=await make(),t2=await prepare(f2.p,binding);g=await human(t2.id,{action:'challenge'});const writable=Object.fromEntries(['id','historyId','title','body','topics','platform','coverRef','scheduledAt','revision'].map(k=>[k,f2.p[k]]));await act('ai',{action:'pack.save',item:{...writable,title:'变更版本'}});assert.equal((await human(t2.id,{action:'submit',challenge:g.challenge,csrf:g.csrf})).blocked,true)
 const f3=await make(),t3=await prepare(f3.p,binding);g=await human(t3.id,{action:'challenge'});await act('ui',{action:'task.cancel',id:t3.id});await assert.rejects(human(t3.id,{action:'submit',challenge:g.challenge,csrf:g.csrf}),/无效/)
 const f4=await make(),t4=await prepare(f4.p,binding);await act('ai',{action:'pack.calendar',id:f4.p.id,revision:f4.p.revision});g=await human(t4.id,{action:'challenge'});mode='wait';const entered=new Promise(resolve=>{enteredResolve=resolve}),pending=human(t4.id,{action:'submit',challenge:g.challenge,csrf:g.csrf});await entered
 assert.equal((await act('ui',{action:'tasks.get',id:t4.id})).item.state,'running');await assert.rejects(act('ui',{action:'task.cancel',id:t4.id}),/只能取消/);await assert.rejects(s.publicationGeoAction(a,{action:'logout'}),/正在处理/)
 await assert.rejects(human(t4.id,{action:'submit',challenge:g.challenge,csrf:g.csrf}),/无效/)
 waitRelease();result=await pending;assert.equal(result.item.state,'unknown');assert.equal(result.item.receipt.upstreamTaskId,'fixture-upstream-task');assert.equal(used,8);assert.equal(platformCalls,1)
 assert.equal((await human(t4.id,{action:'challenge'})).blocked,true);assert.equal(cal.loadPublishCalendar(a)[0].status,'pending')
 const rechecked=(await act('ui',{action:'pack.check',id:f4.p.id,revision:f4.p.revision})).item,again=await prepare(rechecked,binding);assert.equal((await human(again.id,{action:'challenge'})).blocked,true,'unknown video/account must not be blindly resent')
 const publicData=JSON.stringify(await act('ai',{action:'overview'}));for(const secret of ['fixture-access-never-output','fixture-refresh-never-output',accountPath,'fixture-password'])assert.ok(!publicData.includes(secret))
 const deniedAuth=await make(),deniedTask=await prepare(deniedAuth.p,binding);forceAuthRejectOnPost=true;g=await human(deniedTask.id,{action:'challenge'});result=await human(deniedTask.id,{action:'submit',challenge:g.challenge,csrf:g.csrf});assert.equal(result.blocked,true);assert.equal(result.item.state,'unconfirmed');assert.equal(used,8,'final original 401 cannot become allow');forceAuthRejectOnPost=false
 const beforeNoQuota=postCount;for(const forbidden of [0,-1]){limit=forbidden;assert.equal((await human(deniedTask.id,{action:'challenge'})).blocked,true)}assert.equal(postCount,beforeNoQuota);limit=20;accountStatus=0;assert.equal((await human(deniedTask.id,{action:'challenge'})).blocked,true,'missing/invalid original account authorization is blocked without touching cookie files');accountStatus=1
 limit=20;mode='timeout';const f5=await make(),t5=await prepare(f5.p,binding);g=await human(t5.id,{action:'challenge'});result=await human(t5.id,{action:'submit',challenge:g.challenge,csrf:g.csrf});assert.equal(result.item.state,'unknown');assert.equal(result.item.receipt.lockHeld,true)
 const before=postCount;assert.equal((await human(t5.id,{action:'challenge'})).blocked,true);assert.equal(postCount,before)
 const release=await human(t5.id,{action:'release.challenge'});await assert.rejects(human(t5.id,{action:'submit',challenge:release.challenge,csrf:release.csrf},'other-session'),/无效/)
 result=await human(t5.id,{action:'submit',challenge:release.challenge,csrf:release.csrf});assert.equal(result.item.state,'unknown');assert.equal(result.item.receipt.lockHeld,false);assert.equal(postCount,before)
 const f6=await make(),t6=await prepare(f6.p,binding);const diskPath=join(spaces.spaceAssetRoot(a),'publication-management.json'),disk=JSON.parse(readFileSync(diskPath));disk.tasks.find(t=>t.id===t6.id).state='running';writeFileSync(diskPath,JSON.stringify(disk));assert.equal((await act('ai',{action:'tasks.get',id:t6.id})).item.state,'unknown','orphan running state becomes unknown, not retried')
 const orphan=await make(),orphanTask=await prepare(orphan.p,binding);const lockDir=join(spaces.spaceAssetRoot('default'),'geo-delegation-locks');writeFileSync(join(lockDir,'service-'+serviceId+'.json'),JSON.stringify({space:a,id:orphanTask.id}));const recovered=(await act('ai',{action:'tasks.get',id:orphanTask.id})).item;assert.equal(recovered.state,'unknown');assert.equal(recovered.receipt.lockHeld,true);const orphanGrant=await human(orphanTask.id,{action:'release.challenge'});await human(orphanTask.id,{action:'submit',challenge:orphanGrant.challenge,csrf:orphanGrant.csrf})
 authRequired=false;enforce=false;permission=false;limit=0;await s.publicationGeoAction(a,{action:'connect',baseUrl:'http://127.0.0.1:5409'});const f7=await make(),t7=await prepare(f7.p,binding);assert.equal((await human(t7.id,{action:'challenge'})).success,true,'actual upstream switches, not caller override, determine original optional behavior')
 await assert.rejects(s.publicationGeoAction(a,{action:'connect',baseUrl:'http://example.com'}));await assert.rejects(s.publicationGeoAction(a,{action:'connect',baseUrl:'http://127.0.0.1:5409/secret?token=x'}));await assert.rejects(s.publicationGeoAction(a,{action:'connect',baseUrl:'http://127.0.0.1:5409',authOff:'true'}))
 const {GeoPublishClient,geoTags}=await import('../dist/geo-publish-client.js');const aliasClient=new GeoPublishClient(globalThis.fetch);await aliasClient.connect('http://localhost:5409');assert.equal(aliasClient.serviceId(),serviceId,'loopback aliases share local account and idempotency domain');assert.equal(geoTags('#家装 #建材，装修\n房子'),'家装,建材,装修,房子')
 assert.ok(calls.every(x=>!x.includes('reserve') && !x.includes('claim') && !x.includes('getValidAccounts')))
 const ui=readFileSync(new URL('../../deepseek-harness/packages/client/ui-settings-account/src/client/DigitalHumanPublicationManagement.tsx',import.meta.url),'utf8');assert.ok(!ui.includes('navigator.credentials'));assert.ok(ui.includes('我已核对完整预览'));assert.ok(ui.includes('epoch.current!==n'))
 for(const off of disposers.reverse())off()
 console.log('PASS original-GEO thin integration: real protocol fields, original shared quota, UI nonce/session/CSRF, AI prepare-only, company isolation, media/revision invalidation, serialization, replay/unknown guards and manual lock release (fixture transports only)')
}finally{globalThis.fetch=oldFetch;if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;rmSync(home,{recursive:true,force:true})}
