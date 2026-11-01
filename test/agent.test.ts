import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store,rank } from '../src/core.ts';
import { applyJob,type Approval } from '../src/apply.ts';
import { fixture } from '../src/fixture.ts';
test('ranking preserves unknown salary and selects resumes',()=>{const base={id:'a',company:'x',title:'Senior Software Engineer',location:'Remote US',url:'https://example.com',description:'AWS DynamoDB distributed systems'};const j=rank(base);assert(j.flags?.includes('SALARY_MISSING'));assert.equal(j.resume,'distributed-systems');assert.equal(rank({...base,description:'AI platform observability'}).resume,'ai-platform');assert(rank({...base,description:base.description+' $300,000'}).score!>j.score!);assert(rank({...base,location:'Remote Europe'}).flags?.includes('LOCATION_REVIEW'));});
test('SQLite deduplicates and caps attempts, including uncertain ones',()=>{const d=new Store(':memory:');try{d.reserve('a');assert.throws(()=>d.reserve('a'),/Duplicate/);d.finish('a','uncertain',null,null,'timeout');for(let i=0;i<9;i++)d.reserve(String(i));assert.throws(()=>d.reserve('six'),/cap/);}finally{d.close();}});
test('browser fills/uploads without submitting, blocks missing answers, confirms local submission',async()=>{const f=await fixture();const dir=mkdtempSync(join(tmpdir(),'agent-test-'));const resume=join(dir,'resume.txt');writeFileSync(resume,'synthetic fixture');const d=new Store(':memory:');const job=rank({id:'test',company:'fixture',title:'Backend',description:'AWS',location:'Austin',url:f.url});const a:Approval={url:f.url,reviewed:true,formSelector:'form',fields:{'#name':'Test','#email':'test@example.invalid','#auth':'no'},resumeSelector:'#resume',submitSelector:'button',confirmationSelector:'.confirmation',confirmationText:'Your application has been received'};const p={values:{},resumes:{'distributed-systems':resume}};const opts={allowLocalTestSubmission:true,headless:true,session:join(dir,'browser')};try{
assert.equal((await applyJob(job,d,p,a,false,opts)).status,'dry_run');assert.equal(f.count(),0);
await assert.rejects(()=>applyJob(job,d,p,{...a,fields:{'#name':'Test','#email':'test@example.invalid'}},false,opts),/Missing required answers/);assert.equal(f.count(),0);
await assert.rejects(()=>applyJob(job,d,p,undefined,true,opts),/requires reviewed/);
assert.equal((await applyJob(job,d,p,a,true,opts)).status,'submitted');assert.equal(f.count(),1);assert.equal((d.db.prepare('SELECT status FROM applications').get() as any).status,'submitted');
await assert.rejects(()=>applyJob(job,d,p,a,true,opts),/Duplicate/);assert.equal(f.count(),1);
}finally{d.close();await f.close();}});
