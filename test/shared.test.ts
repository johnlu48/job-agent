import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from '../src/fixture.ts';
import {Store,rank} from '../src/core.ts';
import {applyJob} from '../src/apply.ts';
import {batch,type SharedPolicy} from '../src/shared.ts';
test('shared answers handle multiple jobs without per-job approvals; unknown required question blocks',async()=>{
 const f=await fixture();const dir=mkdtempSync(join(tmpdir(),'shared-agent-'));const resume=join(dir,'resume.txt');writeFileSync(resume,'synthetic');const store=new Store(':memory:');
 const policy:SharedPolicy={enabled:true,minScore:0,allowMissingSalary:true,answers:[{labels:['Full name'],value:'Synthetic',approved:true},{labels:['Email'],value:'demo@example.invalid',approved:true},{labels:['Work authorization'],value:'No',approved:true}],adapters:[{hosts:['127.0.0.1'],formSelector:'form',resumeSelector:'#resume',submitSelector:'button',confirmationSelector:'.confirmation',confirmationText:'Your application has been received'}]};
 const profile={values:{},resumes:{'distributed-systems':resume}};
 const one=rank({id:'shared:one',company:'fixture',title:'Backend',location:'Austin',url:f.url,description:'AWS'});
 try{
  for(let i=0;i<2;i++)store.save({...one,id:`shared:${i}`,url:f.url+'?job='+i});
  const result=await batch(store,policy,j=>applyJob(j,store,profile,undefined,false,{allowLocalTestSubmission:true,headless:true,session:join(dir,'browser'),shared:policy}));
  assert.equal(result.length,2);assert(result.every(r=>r.status==='completed'));assert.equal(f.count(),0);
  const unknown={...policy,answers:policy.answers.filter(a=>a.labels[0]!=='Work authorization')};
  await assert.rejects(()=>applyJob(one,store,profile,undefined,true,{allowLocalTestSubmission:true,headless:true,session:join(dir,'browser'),shared:unknown}),/Missing required shared answers.*Work authorization/);assert.equal(f.count(),0);
  assert.equal((await applyJob(one,store,profile,undefined,true,{allowLocalTestSubmission:true,headless:true,session:join(dir,'browser'),shared:policy})).status,'submitted');assert.equal(f.count(),1);
 }finally{store.close();await f.close();}
});
test('batch skips duplicates, non-target locations, continues after errors and stops at daily cap',async()=>{
 const store=new Store(':memory:');const policy:SharedPolicy={enabled:true,minScore:0,allowMissingSalary:true,answers:[],adapters:[]};
 const base={company:'fixture',title:'Backend',location:'Austin',description:'AWS'};
 try{
 for(let i=0;i<12;i++)store.save(rank({...base,id:String(i),url:'https://example.invalid/'+i}));
 store.save(rank({...base,id:'eu',url:'https://example.invalid/eu',location:'Europe'}));store.reserve('0');
 const seen:string[]=[];await batch(store,policy,async j=>{seen.push(j.id);store.reserve(j.id);return 'local simulated attempt';});
 assert.equal(seen.length,9);assert(!seen.includes('0'));assert(!seen.includes('eu'));
 assert.deepEqual(await batch(store,policy,async()=>assert.fail('cap exceeded')),[]);
 }finally{store.close();}
 const fresh=new Store(':memory:');try{fresh.save(rank({...base,id:'a',url:'https://example.invalid/a'}));fresh.save(rank({...base,id:'b',url:'https://example.invalid/b'}));const results=await batch(fresh,policy,async j=>{if(j.id==='a')throw Error('unknown question');return 'dry run';});assert.deepEqual(results.map(r=>r.status),['blocked','completed']);}finally{fresh.close();}
});
