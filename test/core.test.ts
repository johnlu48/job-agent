import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store,rank } from '../src/core.ts';
test('ranking preserves unknown compensation and selects the right resume',()=>{
 const base={id:'a',company:'x',title:'Senior Software Engineer',location:'Remote US',url:'https://example.com',description:'AWS DynamoDB distributed systems'};
 const j=rank(base);assert(j.flags?.includes('SALARY_MISSING'));assert(j.flags?.includes('TOTAL_COMPENSATION_UNVERIFIED'));assert.equal(j.resume,'distributed-systems');assert.equal(rank({...base,description:'AI platform observability'}).resume,'ai-platform');assert(rank({...base,description:base.description+' $300,000'}).score!>j.score!);assert(rank({...base,location:'Remote Europe'}).flags?.includes('LOCATION_REVIEW'));
});
test('transactional cap counts pending and uncertain attempts, duplicates stay blocked',()=>{const d=new Store(':memory:');try{d.reserve('a');assert.throws(()=>d.reserve('a'),/Duplicate/);d.finish('a','uncertain',null,null,'timeout');for(let i=0;i<9;i++)d.reserve(String(i));assert.throws(()=>d.reserve('six'),/cap/);}finally{d.close();}});
test('upsert keeps job data and deduplicates source aliases by URL',()=>{const d=new Store(':memory:');try{const j=rank({id:'x',company:'X',title:'Backend',location:'Austin',url:'https://example.com/job',description:'AWS'});d.save(j);d.save({...j,title:'Updated'});assert.equal(d.jobs().length,1);assert.equal(d.jobs()[0].title,'Updated');assert.equal(d.save({...j,id:'alias'}),'x');assert.equal(d.jobs().length,1);d.reserve('x');assert.throws(()=>d.reserve('alias'),/Duplicate/);}finally{d.close();}});
