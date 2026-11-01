import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {Store} from '../src/core.ts';
import {discoverAll,type Source} from '../src/discovery.ts';
const sources:Source[]=[{type:'greenhouse',company:'Cloudflare',board:'cloudflare'},{type:'lever',company:'Old Board',board:'obsolete'},{type:'ashby',company:'OpenAI',board:'openai'}];
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const gh={jobs:[{id:1,title:'Senior Software Engineer',location:{name:'Austin'},absolute_url:'https://job-boards.greenhouse.io/cloudflare/jobs/1',content:'AWS DynamoDB'}]};
const ashby={jobs:[{id:'ai',title:'AI Platform Engineer',location:'Remote US',applyUrl:'https://jobs.ashbyhq.com/openai/ai/application',descriptionPlain:'Observability'}]};
test('one employer 404 is not retried, later employers continue and successful jobs persist',async()=>{
 const store=new Store(':memory:');let missing=0;const request:typeof fetch=async input=>{const u=String(input);if(u.includes('greenhouse'))return json(gh);if(u.includes('lever')){missing++;return json({},404);}return json(ashby);};
 try{const result=await discoverAll(sources,store,{fetch:request,sleep:async()=>{},enforceAccess:false});assert.equal(result.status,'partial_success');assert.equal(result.exitCode,2);assert.equal(result.persisted,2);assert.equal(missing,1);assert.equal(store.jobs().length,2);assert.match(result.sources[1].errors[0],/HTTP 404/);assert.equal(JSON.parse(readFileSync(join(store.reportDirectory,'discovery/latest.json'),'utf8')).status,'partial_success');assert.equal(store.db.prepare("SELECT count(*) n FROM events WHERE event='discovery_error'").get()!.n,1);}finally{store.close();}
});
test('all employer sources failing reports total failure without deleting previously saved jobs',async()=>{
 const store=new Store(':memory:');try{await discoverAll([sources[0]],store,{fetch:async()=>json(gh),enforceAccess:false});const result=await discoverAll(sources,store,{fetch:async()=>json({},404),enforceAccess:false});assert.equal(result.status,'failure');assert.equal(result.exitCode,1);assert.equal(result.failed,3);assert.equal(store.jobs().length,1);}finally{store.close();}
});
test('transient server failure retries successfully and logs retry without duplicating records',async()=>{
 const store=new Store(':memory:');let requests=0;const delays:number[]=[];try{const result=await discoverAll([sources[0]],store,{fetch:async()=>++requests===1?json({},503):json(gh),sleep:async ms=>{delays.push(ms);},enforceAccess:false});assert.equal(result.status,'success');assert.equal(result.exitCode,0);assert.equal(requests,2);assert.deepEqual(delays,[500]);assert.equal(store.jobs().length,1);assert.equal(store.db.prepare("SELECT count(*) n FROM events WHERE event='discovery_retry'").get()!.n,1);}finally{store.close();}
});
test('disabled employers and empty results are reported explicitly',async()=>{
 const store=new Store(':memory:');try{const result=await discoverAll([{...sources[0],enabled:false,reason:'retired'},sources[2]],store,{fetch:async()=>json({jobs:[]}),enforceAccess:false});assert.equal(result.status,'success');assert.equal(result.skipped,1);assert.equal(result.sources[0].reason,'retired');assert.equal(result.persisted,0);}finally{store.close();}
});
test('configured employer catalog has 30-50 verified identifiers and exclusively credential-free providers',()=>{
 const catalog:Source[]=JSON.parse(readFileSync('config/sources.json','utf8'));const employers=catalog.filter(s=>s.board&&s.verifiedUrl);assert(employers.length>=30&&employers.length<=50);assert.equal(new Set(employers.map(s=>s.company)).size,employers.length);assert(catalog.every(s=>['remoteok','arbeitnow','greenhouse','lever','ashby','smartrecruiters','career'].includes(s.type)));assert(employers.every(s=>s.verifiedAt&&s.verifiedUrl?.includes(s.board!)));
});
test('CLI refuses live start-search when submission configuration is disabled',()=>{
 const root=mkdtempSync(join(tmpdir(),'cli-safety-'));mkdirSync(join(root,'config'));writeFileSync(join(root,'config/submission.json'),'{"enabled":false}');
 const child=spawnSync(process.execPath,[resolve('src/cli.ts'),'start-search','--submit'],{cwd:root,env:{...process.env,JOB_AGENT_ENABLE_SUBMISSION:'YES'},encoding:'utf8',windowsHide:true});assert.equal(child.status,1,child.stderr);assert.match(child.stderr,/Live submissions are disabled/);
});
