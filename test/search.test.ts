import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Store,rank} from '../src/core.ts';
import {startSearch} from '../src/search.ts';
import {exportReport} from '../src/report.ts';
import type {SharedPolicy} from '../src/shared.ts';
const policy:SharedPolicy={enabled:true,minScore:0,allowMissingSalary:true,answers:[],adapters:[]};
function seed(store:Store,count:number){for(let i=0;i<count;i++)store.save(rank({id:String(i),company:'Company '+i,title:'Backend',location:'Austin',url:'https://example.invalid/'+i,description:i?'AWS':'AWS base salary $300,000; equity unspecified'}));}
test('one-command workflow discovers first, continues after failures, caps at ten, persists readable error report',async()=>{
 const store=new Store(':memory:');const order:string[]=[];
 try{
 const output=await startSearch(store,policy,async()=>{order.push('discover');seed(store,14);return 'local discovery fixture';},async(j,live)=>{
  assert.equal(live,true);order.push(j.id);
  if(j.id==='0')throw Error('Missing required shared answer: relocation');
  store.reserve(j.id);
  if(j.id==='1'){store.finish(j.id,'uncertain',null,null,'Confirmation not observed');throw Error('Confirmation not observed');}
  store.finish(j.id,'submitted',j.url+'/confirmation','fixture.png','Observed confirmation');return {status:'submitted',url:j.url+'/confirmation',screenshot:'fixture.png'};
 });
 assert.equal(order[0],'discover');assert.equal(output.mode,'live');assert.equal(output.results.length,11);
 assert.equal((store.db.prepare('SELECT count(*) n FROM applications').get() as any).n,10);
 const rows=exportReport(store);assert.match(rows.find(r=>r.job_id==='0')!.error,/relocation/);assert.equal(rows.find(r=>r.job_id==='1')!.status,'uncertain');assert.match(rows.find(r=>r.job_id==='1')!.error,/Confirmation/);
 const success=rows.find(r=>r.status==='submitted')!;assert(success.confirmation_url);assert.equal(success.error,'');assert.equal(success.compensation,'Not disclosed');
 const csv=readFileSync(join(store.reportDirectory,'applications.csv'),'utf8');assert(csv.includes('"company","title","location","compensation"'));assert(csv.includes('"error"'));assert(csv.includes('relocation'));
 const again=await startSearch(store,policy,async()=>{},async()=>assert.fail('daily quota must persist'));assert.equal(again.results.length,0);
 }finally{store.close();}
});
test('start-search dry-run never enables live mode and report escapes CSV formula values',async()=>{
 const store=new Store(':memory:');try{let count=0;await startSearch(store,policy,async()=>seed(store,12),async(j,live)=>{assert.equal(live,false);count++;return {status:'dry_run'};},true);assert.equal(count,10);assert.equal((store.db.prepare('SELECT count(*) n FROM applications').get() as any).n,0);
 store.save(rank({id:'formula',company:'=HYPERLINK("bad")',title:'Backend',location:'Austin',url:'https://example.invalid/formula',description:'AWS'}));exportReport(store);const csv=readFileSync(join(store.reportDirectory,'applications.csv'),'utf8');assert(csv.includes("'=HYPERLINK"));
 }finally{store.close();}
});
