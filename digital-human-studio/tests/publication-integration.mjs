import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {Readable} from 'node:stream'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const home=mkdtempSync(join(tmpdir(),'xdh-publication-fixture-')),oldHome=process.env.HOME,oldFetch=globalThis.fetch
process.env.HOME=home;let networkCalls=0;globalThis.fetch=()=>{networkCalls++;throw new Error('All network forbidden in publication fixture')}
const disposers=[]
try{
 const spaces=await import('../dist/spaces.js'),history=await import('../dist/studio-history.js'),materials=await import('../dist/studio-materials.js'),packs=await import('../dist/publish-packs.js'),calendar=await import('../dist/publish-calendar.js'),service=await import('../dist/publication-service.js')
 const created=spaces.createSpace(spaces.emptySpaceStore(),'夹具A'),a=created.space.id,b='default';let store=spaces.selectSpace(created.store,a,'chat-a');store=spaces.selectSpace(store,b,'chat-b');spaces.saveSpaceStore(store)
 const media=materials.addStudioMaterial(a,'product','fixture.mp4',Buffer.from('not-a-real-video')),cover=materials.addStudioMaterial(a,'logo','fixture.png',Buffer.from('not-a-real-image')),foreign=materials.addStudioMaterial(b,'logo','foreign.png',Buffer.from('foreign-fixture'))
 history.upsertStudioHistory(a,{id:'fixture-video-a',kind:'xdh-avatar-video',title:'A',at:1,status:'SUCCESS',mediaUrl:materials.materialPublicUrl(a,media)})
 history.upsertStudioHistory(b,{id:'fixture-video-b',kind:'xdh-avatar-video',title:'B',at:1,status:'SUCCESS',mediaUrl:materials.materialPublicUrl(b,foreign)})
 const writable=p=>Object.fromEntries(['id','historyId','title','body','topics','platform','coverRef','scheduledAt','revision'].map(k=>[k,p[k]]))
 const input={historyId:'fixture-video-a',title:'夹具标题',body:'夹具正文',topics:'#夹具',platform:'抖音',coverRef:`material:${cover.id}`,scheduledAt:'2099-12-01T00:05',revision:0}
 const act=(actor,input,space=a)=>service.publicationAction(space,actor,input)
 const raw=await act('ui',{action:'pack.save',item:input}),id=raw.item.id
 assert.equal(raw.item.checked,false)
 await assert.rejects(act('ai',{action:'task.prepare',packId:id,packRevision:raw.item.revision,bindingId:'missing'}),/账号/)
 await assert.rejects(act('ai',{action:'pack.check',id,revision:raw.item.revision}),/仅允许用户/)
 await assert.rejects(act('ai',{action:'binding.save',item:{platform:'douyin',label:'A'}}),/仅允许用户/)
 await assert.rejects(act('ui',{action:'binding.save',item:{platform:'doubao',label:'检测非发布'}}),/不是/)
 await assert.rejects(act('ui',{action:'binding.save',item:{platform:'douyin',label:'bad',cookie:'fixture-not-secret'}}),/只接受摘要/)
 const binding=(await act('ui',{action:'binding.save',item:{platform:'douyin',label:'A公开摘要',accountUid:'fixture_uid'}})).item
 const bBinding=(await act('ui',{action:'binding.save',item:{platform:'douyin',label:'B公开摘要'}},b)).item
 await assert.rejects(act('ai',{action:'task.prepare',packId:id,packRevision:raw.item.revision,bindingId:binding.id}),/尚未人工检查/)
 let checked=(await act('ui',{action:'pack.check',id,revision:raw.item.revision})).item
 await assert.rejects(act('ai',{action:'task.prepare',packId:id,packRevision:checked.revision,bindingId:bBinding.id}),/找不到当前公司的账号/)
 await assert.rejects(act('ai',{action:'pack.get',id},b),/找不到/)
 await assert.rejects(act('ai',{action:'pack.save',item:{...input,historyId:'fixture-video-b'}}),/不属于/)
 await assert.rejects(act('ai',{action:'pack.save',item:{...checked,coverRef:`material:${foreign.id}`}}),/封面不属于/)
 for(const value of [{space:b},{spaceId:b},{actor:'ui'},{nonce:'forged'},{path:'/etc/passwd'},{url:'http://169.254.169.254/'}])await assert.rejects(act('ai',{action:'overview',...value}),/不接受/)
 await assert.rejects(act('ai',{action:'pack.save',item:{...checked,path:'/etc/passwd'}}),/不接受文件路径/)
 await assert.rejects(act('ai',{action:'task.prepare',packId:id,packRevision:1,bindingId:binding.id}),/版本/)
 const prepared=await act('ai',{action:'task.prepare',packId:id,packRevision:checked.revision,bindingId:binding.id})
 const executionManifest=service.publicationExecutionManifest(a,prepared.item.id)
 const runner=new URL('../publishing/runner.py',import.meta.url)
 const run=(mode,body)=>spawnSync('python3',[fileURLToPath(runner),mode],{input:JSON.stringify(body),encoding:'utf8',env:{...process.env,HOME:home},timeout:5000})
 for(const platform of service.publicationPlatforms()){
  const probe=run('--dry-run',{...executionManifest,platform:platform.key});assert.equal(probe.status,0,probe.stderr);const report=JSON.parse(probe.stdout);assert.equal(report.executed,false);assert.equal(report.externalCalls,0);assert.equal(report.accountAccess,false);assert.equal(report.mediaRead,false)
 }
 const deniedExecution=run('--execute',executionManifest);assert.equal(deniedExecution.status,3);assert.equal(JSON.parse(deniedExecution.stdout).executed,false)
 for(const attack of [{path:'/etc/passwd'},{url:'http://169.254.169.254/'},{cookie:'fixture-not-a-cookie'}])assert.equal(run('--dry-run',{...executionManifest,...attack}).status,2)
 assert.equal(run('--dry-run',{...executionManifest,spaceId:'../other'}).status,2)
 assert.equal(run('--dry-run',{...executionManifest,platform:'doubao'}).status,2)
 assert.equal(prepared.item.state,'unconfirmed');assert.equal(prepared.item.snapshotValid,true);assert.ok(prepared.item.blockers.some(x=>x.includes('原GEO')));assert.equal(prepared.item.snapshot.videoHash,createHash('sha256').update('not-a-real-video').digest('hex'))
 assert.equal((await act('ui',{action:'task.prepare',packId:id,packRevision:checked.revision,bindingId:binding.id})).item.id,prepared.item.id)
 assert.equal((await act('ui',{action:'tasks.list'})).items.length,1)
 await assert.rejects(act('ai',{action:'confirmation.request',id:prepared.item.id}),/仅允许用户/)
 await assert.rejects(act('ai',{action:'confirmation.submit',id:prepared.item.id}),/仅允许用户/)
 assert.equal((await act('ui',{action:'confirmation.request',id:prepared.item.id})).blocked,true)
 assert.equal((await act('ui',{action:'confirmation.submit',id:prepared.item.id})).blocked,true)
 await assert.rejects(act('ai',{action:'task.retry',id:prepared.item.id}),/未知或禁止/)
 assert.equal((await act('ai',{action:'tasks.list'},b)).items.length,0)
 await act('ai',{action:'pack.calendar',id,revision:checked.revision});await act('ai',{action:'pack.calendar',id,revision:checked.revision})
 assert.equal(calendar.loadPublishCalendar(a).length,1);assert.equal(calendar.loadPublishCalendar(a)[0].status,'pending')
 assert.equal(packs.packDownload(a,id,'text').bytes.toString().includes('夹具正文'),true)
 const changed=(await act('ai',{action:'pack.save',item:{...writable(checked),title:'修改后标题'}})).item
 assert.equal(changed.checked,false);assert.equal((await act('ui',{action:'tasks.get',id:prepared.item.id})).item.snapshotValid,false)
 await assert.rejects(act('ai',{action:'task.prepare',packId:id,packRevision:changed.revision,bindingId:binding.id}),/人工检查/)
 checked=(await act('ui',{action:'pack.check',id,revision:changed.revision})).item
 const second=await act('ai',{action:'task.prepare',packId:id,packRevision:checked.revision,bindingId:binding.id});assert.notEqual(second.item.id,prepared.item.id)
 const stateFile=join(spaces.spaceAssetRoot(a),'publication-management.json'),disk=JSON.parse(readFileSync(stateFile,'utf8'));disk.tasks.find(t=>t.id===second.item.id).state='unknown';writeFileSync(stateFile,JSON.stringify(disk))
 const reused=await act('ui',{action:'task.prepare',packId:id,packRevision:checked.revision,bindingId:binding.id});assert.equal(reused.reused,true);assert.equal(reused.item.state,'unknown');assert.equal((await act('ui',{action:'tasks.list'})).items.length,2)
 await act('ui',{action:'binding.disable',id:binding.id,revision:binding.revision});assert.equal((await act('ai',{action:'tasks.get',id:second.item.id})).item.snapshotValid,false)
 await assert.rejects(act('ai',{action:'task.prepare',packId:id,packRevision:checked.revision,bindingId:binding.id}),/已停用/)
 const boundary=(await act('ai',{action:'calendar.save',item:{title:'北京跨月',scheduledAt:'2099-11-30T23:59',status:'pending'}})).item
 assert.equal(boundary.scheduledAt,'2099-11-30T23:59+08:00')
 await assert.rejects(act('ai',{action:'calendar.save',item:{...boundary,title:'旧响应'},expectedUpdatedAt:boundary.updatedAt-1}),/版本/)
 for(const time of ['2099-02-29T00:00','2099-11-31T00:00','2099-12-01T00:01Z','下个月'])await assert.rejects(act('ai',{action:'calendar.save',item:{title:'非法',scheduledAt:time}}))
 await assert.rejects(act('ai',{action:'calendar.save',item:{title:'跨公司',scheduledAt:'2099-12-01T00:00',historyId:'fixture-video-b'}}),/成片/)
 const gate=service.createOfflineConfirmationGate()
 assert.throws(()=>gate.issue('ai',a,'fixture','fingerprint',1),/仅允许用户/)
 const nonce=gate.issue('ui',a,'fixture','fingerprint',1)
 assert.throws(()=>gate.consume('ai',nonce,a,'fixture','fingerprint',1),/仅允许用户/)
 assert.throws(()=>gate.consume('ui',nonce,b,'fixture','fingerprint',1),/无效/)
 assert.throws(()=>gate.consume('ui',nonce,a,'fixture','changed',1),/无效/)
 assert.throws(()=>gate.consume('ui',nonce,a,'fixture','fingerprint',2),/无效/)
 assert.equal(gate.consume('ui',nonce,a,'fixture','fingerprint',1),true);assert.throws(()=>gate.consume('ui',nonce,a,'fixture','fingerprint',1),/已使用/)
 const originalNow=Date.now;const expiring=gate.issue('ui',a,'expiry','fingerprint',1);try{Date.now=()=>originalNow()+121000;assert.throws(()=>gate.consume('ui',expiring,a,'expiry','fingerprint',1),/过期/)}finally{Date.now=originalNow}
 assert.equal(service.publicationEvidenceState({}),'unknown')
 assert.equal(service.publicationEvidenceState({success:true}),'unknown')
 assert.equal(service.publicationEvidenceState({success:true,publishId:'fixture-id'}),'accepted')
 assert.equal(service.publicationEvidenceState({success:true,isDraft:true}),'waiting_human')
 assert.equal(service.publicationEvidenceState({success:true,uncertain:true}),'unknown')
 assert.equal(service.publicationEvidenceState({success:false}),'failed')
 assert.equal(service.publicationEvidenceState({verified:true,workId:'fixture-work',publicUrl:'https://example.invalid/work'}),'published_verified')
 assert.equal(JSON.parse(readFileSync(new URL('../publishing/platforms.json',import.meta.url),'utf8')).length,29)
 const platforms=service.publicationPlatforms();assert.equal(platforms.length,21);assert.equal(platforms.some(p=>p.key==='doubao'),false)
 const manifest=JSON.parse(readFileSync(new URL('../publishing/migration-manifest.json',import.meta.url),'utf8'))
 for(const item of manifest.files){const bytes=readFileSync(new URL('../publishing/vendor/geo/'+item.file,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256)}
 assert.equal(createHash('sha256').update(readFileSync(new URL('../publishing/'+manifest.license.file,import.meta.url))).digest('hex'),manifest.license.sha256)
 assert.match(readFileSync(new URL('../publishing/vendor/geo/utils/stealth.min.js',import.meta.url),'utf8'),/License: MIT/)
 const staticRunner=spawnSync('python3',['-c',`import ast,pathlib; tree=ast.parse(pathlib.Path(${JSON.stringify(fileURLToPath(runner))}).read_text()); names=[a.name.split('.')[0] for n in ast.walk(tree) if isinstance(n,ast.Import) for a in n.names]+[n.module.split('.')[0] for n in ast.walk(tree) if isinstance(n,ast.ImportFrom)]; assert set(names)<=set(['argparse','json','re','sys','pathlib']); assert not any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id in ['eval','exec','__import__'] for n in ast.walk(tree))`],{encoding:'utf8',env:{...process.env,HOME:home},timeout:5000})
 assert.equal(staticRunner.status,0,staticRunner.stderr)
 assert.ok(manifest.excluded.some(x=>x.file==='conf.py'));assert.equal(manifest.files.some(x=>/cookie|\.env|conf\.py$/.test(x.file)),false)
 const routes=new Map(),tools=new Map();let rejection,connectionAvailable=true
 const ctx={get(name){return name==='connection'?(connectionAvailable?{requestRejection(){return rejection}}:undefined):name==='credentials'?{async unset(){},async set(){}}:undefined},effect(run){const off=run();if(typeof off==='function')disposers.push(off)},webServer:{register(def){routes.set(def.path,def.handler);return()=>{}}},tools:{register(def){tools.set(def.name,def);return()=>{}}}}
 const {apply}=await import('../dist/index.js');await apply(ctx)
 const execA={agent:{session:{id:'chat-a'}}},execB={agent:{session:{id:'chat-b'}}}
 async function http(method,body,query='',headers={},route='/digital-human-studio/publication-management'){const req=Readable.from(body==null?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url:`${route}${query}`,headers:{host:'127.0.0.1:3080',origin:'http://127.0.0.1:3080','content-type':'application/json',...headers}});return new Promise(resolve=>{routes.get(route)(req,{headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true},end(value){resolve({status:this.status,body:JSON.parse(String(value))})}})})}
 for(const route of ['/digital-human-studio/publication-geo-connection','/digital-human-studio/publication-confirmation']){
  rejection=401;assert.equal((await http('POST',{space:a,action:'status'},'',{},route)).status,401);rejection=undefined
  assert.equal((await http('POST',{space:a,action:'status'},'',{origin:'https://evil.invalid'},route)).status,403)
  assert.equal((await http('GET',null,'',{},route)).status,405)
  assert.equal((await http('POST',{space:a,action:'status'},'',{'content-type':'text/plain'},route)).status,415)
  assert.equal((await http('POST',{action:'status'},'',{},route)).status,400)
 }
 assert.equal((await http('POST',{space:a,action:'status'},'',{},'/digital-human-studio/publication-geo-connection')).status,200)
 rejection=401;assert.equal((await http('GET',null,`?space=${a}`)).status,401);rejection=undefined;connectionAvailable=false;assert.equal((await http('GET',null,`?space=${a}`)).status,403);connectionAvailable=true
 assert.equal((await http('GET',null)).status,400);assert.equal((await http('GET',null,'?space=../outside')).status,400)
 assert.equal((await http('GET',null,'?space=space-unknown')).status,400)
 assert.equal((await http('GET',null,`?space=${a}&action=task.prepare`)).status,400)
 assert.equal((await http('POST',{space:a,action:'overview'},'',{origin:'https://evil.invalid'})).status,403)
 assert.equal((await http('POST',{space:a,action:'overview'},'',{'content-type':'text/plain'})).status,415)
 assert.equal((await http('POST',{space:a,action:'confirmation.request',id:prepared.item.id})).status,409)
 assert.equal((await http('POST',{space:a,action:'confirmation.submit',id:prepared.item.id,nonce:'forged'})).status,400)
 assert.equal((await http('POST',{space:a,action:'binding.save',item:{platform:'douyin',label:'Web账号摘要'}})).status,200)
 const aiOverview=await tools.get('dh_publication_overview').execute({},execA)
 assert.ok(aiOverview.bindings.some(x=>x.label==='Web账号摘要'));assert.equal(aiOverview.runtime.enabled,false)
 assert.equal((await tools.get('dh_publication_overview').execute({},execB)).bindings.length,1)
 await assert.rejects(tools.get('dh_publication_overview').execute({},{}),/明确的会话公司/)
 await assert.rejects(tools.get('dh_publication_overview').execute({space:b},execA),/不接受/)
 await assert.rejects(tools.get('dh_publish_packages').execute({operation:'check',id},execA),/明确发布包操作/)
 const fromAI=await tools.get('dh_publish_packages').execute({operation:'save',item:{...writable(checked),title:'AI保存可由Web读取'}},execA)
 assert.equal(fromAI.success,true)
 const viaWeb=(await http('GET',null,`?space=${a}&action=pack.get&id=${id}`)).body.item
 assert.equal(viaWeb.title,'AI保存可由Web读取');assert.equal(viaWeb.checked,false)
 assert.equal('mediaUrl' in fromAI.item,false,'AI output does not expose remote signed media links')
 const aiPlan=await tools.get('dh_publish_calendar').execute({operation:'save',item:{title:'AI排期',scheduledAt:'2099-12-01T00:01',status:'pending'}},execA)
 assert.ok((await http('GET',null,`?space=${a}&action=calendar.list`)).body.items.some(x=>x.id===aiPlan.item.id))
 assert.equal((await tools.get('dh_publish_tasks').execute({},execA)).items.length,2)
 await assert.rejects(tools.get('dh_prepare_publication').execute({packId:id,packRevision:viaWeb.revision,bindingId:binding.id},execA))
 assert.ok(calendar.loadPublishCalendar(a).every(x=>x.status==='pending'),'no task or export marks calendar published')
 // Actual registered AI tools interleave async media hashing after each session captures its company.
 const activeA=aiOverview.bindings.find(x=>x.label==='Web账号摘要')
 const latestA=packs.getPack(a,id),reviewedA=packs.checkPack(a,id,latestA.revision)
 const mediaB=materials.addStudioMaterial(b,'product','fixture-b.mp4',Buffer.from('company-b-video-fixture'))
 history.upsertStudioHistory(b,{id:'fixture-video-b',kind:'xdh-avatar-video',title:'B',at:1,status:'SUCCESS',mediaUrl:materials.materialPublicUrl(b,mediaB)})
 const packB=packs.savePack(b,{...input,historyId:'fixture-video-b',coverRef:`material:${foreign.id}`,revision:0}),reviewedB=packs.checkPack(b,packB.id,packB.revision)
 const pendingA=tools.get('dh_prepare_publication').execute({packId:id,packRevision:reviewedA.revision,bindingId:activeA.id},execA)
 const pendingB=tools.get('dh_prepare_publication').execute({packId:packB.id,packRevision:reviewedB.revision,bindingId:bBinding.id},execB)
 const [resultA,resultB]=await Promise.all([pendingA,pendingB])
 assert.equal(resultA.item.snapshot.spaceId,a);assert.equal(resultB.item.snapshot.spaceId,b)
 assert.equal(resultA.item.snapshot.title,'AI保存可由Web读取');assert.equal(resultB.item.snapshot.title,'夹具标题')
 assert.equal(resultA.item.state,'unconfirmed');assert.equal(resultB.item.state,'unconfirmed')
 const corrupted=join(spaces.spaceAssetRoot(b),'publication-management.json');writeFileSync(corrupted,'{broken-fixture');await assert.rejects(act('ui',{action:'binding.save',item:{platform:'douyin',label:'dont overwrite'}},b),/损坏/);assert.equal(readFileSync(corrupted,'utf8'),'{broken-fixture')
 assert.equal(networkCalls,0)
 console.log('PASS: isolated publication management CRUD/revisions/check invalidation/company-resource-path isolation/immutable media snapshot/idempotency/unknown no retry/unconfigured original-service delegation blocked/no AI confirmation/one-shot expiry gate/evidence states/auth+origin/session tools/Web-AI shared persistence/29-config and 11-file provenance; ZERO external calls')
}finally{for(const d of disposers.reverse())d();globalThis.fetch=oldFetch;if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;rmSync(home,{recursive:true,force:true})}
