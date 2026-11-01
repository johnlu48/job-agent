import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store,rank} from '../src/core.ts';
import {discoverAll} from '../src/discovery.ts';
import {discoverFeed,usEligible} from '../src/public-feeds.ts';
import {eligible} from '../src/shared.ts';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
async function collect<T>(values:AsyncIterable<T>){const out:T[]=[];for await(const value of values)out.push(value);return out;}
const remote={id:'1',company:'Acme',position:'Senior Software Engineer Backend',location:'United States',description:'AWS DynamoDB distributed systems',url:'https://remoteok.com/remote-jobs/1',salary_min:0,salary_max:0};
test('Remote OK metadata and non-US jobs are filtered; attribution and unknown salary are retained',async()=>{
 const notices:string[]=[];const jobs=await collect(discoverFeed({type:'remoteok',company:'Remote OK'},{fetch:async()=>response([{legal:'Link back to Remote OK'},remote,{...remote,id:'2',location:'Germany'},{...remote,id:'3',location:'Worldwide',salary_min:200000,salary_max:300000}]),onNotice:m=>notices.push(m)}));
 assert.equal(jobs.length,2);assert.deepEqual(jobs[0].attribution,{name:'Remote OK',url:remote.url});assert(jobs[0].flags?.includes('SALARY_MISSING'));assert(jobs[0].flags?.includes('TOTAL_COMPENSATION_UNVERIFIED'));assert(!jobs[1].flags?.includes('LOCATION_REVIEW'));assert.equal(jobs[1].salary?.kind,'salary');assert.equal(jobs[1].salary?.currency,'UNSPECIFIED');assert.equal(notices.length,1);assert.equal(jobs[0].applicationUrl,undefined);assert.equal(eligible(jobs[0],{enabled:true,minScore:0,allowMissingSalary:true,answers:[],adapters:[]}),false);
});
test('Arbeitnow follows bounded pages and requires explicit US eligibility, not just a remote flag',async()=>{
 const urls:string[]=[];const request:typeof fetch=async input=>{urls.push(String(input));return response({data:[{slug:'job-'+urls.length,company_name:'Acme',title:'SDE II Backend',description:'AWS',remote:true,location:urls.length===1?'Berlin':'United States',url:'https://www.arbeitnow.com/jobs/job-'+urls.length}],links:{next:urls.length===1?'https://www.arbeitnow.com/api/job-board-api?page=2':null}});};
 const jobs=await collect(discoverFeed({type:'arbeitnow',company:'Arbeitnow',maxPages:2},{fetch:request}));assert.equal(urls.length,2);assert.match(urls[1],/page=2$/);assert.equal(jobs.length,1);assert.equal(jobs[0].sourceJobId,'job-2');assert.equal(usEligible('Berlin','Work remote',true),false);assert.equal(usEligible('Worldwide','Excluding United States',true),false);
});
test('SmartRecruiters public list/detail requests use no credentials and only published apply URLs',async()=>{
 const requests:string[]=[];const jobs=await collect(discoverFeed({type:'smartrecruiters',company:'Acme',board:'Acme',pageSize:1,maxPages:2},{fetch:async(input,init)=>{assert.equal(new Headers(init?.headers).has('Authorization'),false);const u=String(input);requests.push(u);return u.includes('?')?response({totalFound:2,content:[{id:u.includes('offset=0')?'1':'2',name:'Cloud Engineer'}]}):response({name:'Cloud Engineer',refNumber:'REQ-'+u.at(-1),location:{city:'Austin',country:'us',remote:true},applyUrl:'https://jobs.smartrecruiters.com/Acme/'+u.at(-1),jobAd:{sections:{jobDescription:{text:'AWS infrastructure'}}}});}}));assert.equal(jobs.length,2);assert.equal(requests.length,4);assert.equal(jobs[0].requisitionId,'REQ-1');assert.equal(jobs[0].applicationUrlStatus,'direct');
});
test('page failure preserves jobs from previous pages and reports partial success',async()=>{
 const store=new Store(':memory:');try{const result=await discoverAll([{type:'arbeitnow',company:'Arbeitnow',maxPages:2}],store,{fetch:async input=>String(input).includes('page=1')?response({data:[{slug:'job',company_name:'Acme',title:'Backend',description:'AWS',remote:true,location:'United States',url:'https://www.arbeitnow.com/jobs/job'}],links:{next:'next'}}):response({},404),enforceAccess:false});assert.equal(result.exitCode,2);assert.equal(store.jobs().length,1);assert.equal(result.sources[0].persisted,1);}finally{store.close();}
});
test('cross-provider URL and employer/requisition dedup retain history and original canonical ID',()=>{
 const store=new Store(':memory:');try{
 const job=rank({id:'native',company:'Acme Inc.',title:'Senior Software Engineer',location:'Austin',description:'AWS full description',url:'https://jobs.lever.co/acme/job',applicationUrl:'https://jobs.lever.co/acme/job/apply',source:'lever',requisitionId:'REQ-1'});store.save(job);store.reserve(job.id);store.finish(job.id,'submitted','confirmed',null,'observed');
 assert.equal(store.save({...job,id:'feed',source:'remoteok',url:'https://remoteok.com/remote-jobs/1',applicationUrl:'https://jobs.lever.co/acme/job?utm_source=remoteok',description:'short snippet'}),'native');assert.equal(store.jobs().length,1);assert.equal(store.jobs()[0].description,'AWS full description');assert.throws(()=>store.reserve('feed'),/Duplicate/);
 assert.equal(store.save({...job,id:'req',company:'Acme',url:'https://example.invalid/different',applicationUrl:undefined}),'native');assert.equal(store.jobs().length,1);
 assert.equal(store.save({...job,id:'other-employer',company:'Different Inc.',url:'https://example.invalid/other',applicationUrl:undefined}),'other-employer');assert.equal(store.jobs().length,2);
 }finally{store.close();}
});
test('a newly resolved feed posting merges prior aliases without losing a native submission',()=>{
 const store=new Store(':memory:');try{
 const job=rank({id:'feed',company:'Acme',title:'Backend',location:'Remote US',description:'AWS snippet',url:'https://remoteok.com/remote-jobs/1',source:'remoteok'});store.save(job);
 const native={...job,id:'native',source:'lever',url:'https://jobs.lever.co/acme/1',applicationUrl:'https://jobs.lever.co/acme/1',description:'Full employer description'};store.save(native);store.reserve('native');store.finish('native','submitted','confirmed','shot.png','Observed');
 assert.equal(store.save({...job,applicationUrl:native.url}),'native');assert.equal(store.jobs().length,1);assert.equal(store.jobs()[0].id,'native');assert.equal((store.application('native') as any).status,'submitted');assert.throws(()=>store.reserve('feed'),/Duplicate/);
 }finally{store.close();}
});
