import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {Store,day,rank} from '../src/core.ts';
import {reportRows} from '../src/report.ts';

const windows=process.platform==='win32';
const launcher=resolve('scripts/Invoke-JobAgent.ps1');
function fixture(options:{fail?:boolean;partial?:boolean;delay?:boolean;unsafe?:boolean;timeout?:number}={}){
 const root=mkdtempSync(join(tmpdir(),'job scheduler spaces '));
 for(const dir of ['config','src','data'])mkdirSync(join(root,dir));
 writeFileSync(join(root,'config/scheduler.json'),JSON.stringify({workflow:options.unsafe?['start-search']:['discover','review'],dailyRunLimit:1,commandTimeoutSeconds:options.timeout||20}));
 writeFileSync(join(root,'src/cli.ts'),`import fs from 'node:fs';
const command=process.argv[2];
if(!['discover','review'].includes(command))throw Error('unsafe command');
fs.appendFileSync('calls.jsonl',JSON.stringify({command,cwd:process.cwd(),live:process.env.JOB_AGENT_ENABLE_SUBMISSION||''})+'\\n');
console.log('fixture '+command);console.error('fixture stderr');
if(${!!options.partial}&&command==='discover'){console.log('DISCOVERY_SUMMARY '+JSON.stringify({status:'partial_success',exitCode:2,persisted:2,failed:1}));process.exitCode=2;}
if(${!!options.delay}&&command==='discover')await new Promise(r=>setTimeout(r,2000));
if(${!!options.fail}&&command==='discover')process.exitCode=7;
`);
 return root;
}
function launch(root:string){
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',launcher,'-ProjectRoot',root,'-NodePath',process.execPath],{cwd:tmpdir(),windowsHide:true,env:{...process.env,JOB_AGENT_ENABLE_SUBMISSION:'YES'}});
 let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
 const done=new Promise<{code:number|null;stdout:string;stderr:string}>((r,j)=>{child.on('error',j);child.on('exit',code=>r({code,stdout,stderr}));});
 return {child,done};
}
const calls=(root:string)=>readFileSync(join(root,'calls.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));

test('launcher fixes cwd, disables inherited submission flag, logs outputs and limits daily runs', {skip:!windows},async()=>{
 const root=fixture();const one=await launch(root).done;assert.equal(one.code,0,one.stdout+one.stderr);
 assert.deepEqual(calls(root).map(c=>c.command),['discover','review']);assert(calls(root).every(c=>c.cwd===root&&c.live===''));
 const two=await launch(root).done;assert.equal(two.code,0,two.stdout+two.stderr);assert.match(two.stdout,/skipped_daily_limit/);assert.equal(calls(root).length,2);
 const state=JSON.parse(readFileSync(join(root,'data/scheduler/state.json'),'utf8'));assert.equal(state.runs,1);
 const log=readFileSync(join(root,'data/scheduler/logs/launcher.jsonl'),'utf8');assert.match(log,/command_finished/);assert.match(log,/stderr/);
});
test('confirmed submission today skips without consuming a run; yesterday does not', {skip:!windows},async()=>{
 const root=fixture();const db=new DatabaseSync(join(root,'data/agent.sqlite'));
 db.exec('CREATE TABLE applications(job_id TEXT,status TEXT,day TEXT,submitted_day TEXT)');db.prepare('INSERT INTO applications VALUES(?,?,?,?)').run('a','submitted','2000-01-01',day());db.close();
 const skipped=await launch(root).done;assert.equal(skipped.code,0,skipped.stdout+skipped.stderr);assert.match(skipped.stdout,/skipped_submitted_today/);assert(!existsSync(join(root,'calls.jsonl')));assert(!existsSync(join(root,'data/scheduler/state.json')));
 const old=new DatabaseSync(join(root,'data/agent.sqlite'));old.exec("UPDATE applications SET submitted_day='2000-01-01'");old.close();assert.equal((await launch(root).done).code,0);assert.equal(calls(root).length,2);
});
test('legacy submission date blocks today and corrupt database fails closed', {skip:!windows},async()=>{
 const root=fixture();const db=new DatabaseSync(join(root,'data/agent.sqlite'));db.exec('CREATE TABLE applications(status TEXT,day TEXT)');db.prepare('INSERT INTO applications VALUES(?,?)').run('submitted',day());db.close();assert.match((await launch(root).done).stdout,/skipped_submitted_today/);
 const corrupt=fixture();writeFileSync(join(corrupt,'data/agent.sqlite'),'invalid database');assert.equal((await launch(corrupt).done).code,1);assert(!existsSync(join(corrupt,'calls.jsonl')));
});
test('CLI errors propagate, review still runs, and unsafe workflow is refused', {skip:!windows},async()=>{
 const root=fixture({fail:true});const failed=await launch(root).done;assert.equal(failed.code,1,failed.stdout+failed.stderr);assert.deepEqual(calls(root).map(c=>c.command),['discover','review']);assert.match(failed.stdout,/exit=7/);
 const unsafe=fixture({unsafe:true});const rejected=await launch(unsafe).done;assert.equal(rejected.code,1);assert.match(rejected.stdout,/Only discover and review/);assert(!existsSync(join(unsafe,'calls.jsonl')));
});
test('partial discovery completes with warnings, review still runs, and structured outcomes are retained', {skip:!windows},async()=>{
 const root=fixture({partial:true});const result=await launch(root).done;assert.equal(result.code,0,result.stdout+result.stderr);assert.match(result.stdout,/discovery_partial_success/);assert.match(result.stdout,/completed_with_warnings/);assert.deepEqual(calls(root).map(c=>c.command),['discover','review']);const record=JSON.parse(readFileSync(join(root,'data/scheduler/latest-run.json'),'utf8'));assert.equal(record.outcome,'completed_with_warnings');assert.equal(record.exitCode,0);assert.equal(record.stages[0].exitCode,2);assert.equal(record.stages[0].summary.failed,1);assert.equal(record.stages[1].outcome,'success');
});
test('overlapping launcher is skipped while the first holds the lock', {skip:!windows},async()=>{
 const root=fixture({delay:true});const first=launch(root);
 await new Promise<void>((r,j)=>{const timer=setTimeout(()=>j(Error('Launcher did not start')),10000);first.child.stdout.on('data',d=>{if(String(d).includes('"started"')){clearTimeout(timer);r();}});first.child.on('error',j);});
 const second=await launch(root).done;assert.equal(second.code,0,second.stdout+second.stderr);assert.match(second.stdout,/skipped_duplicate/);assert.equal((await first.done).code,0);assert.equal(calls(root).length,2);
});
test('command timeout stops child process and records failure', {skip:!windows},async()=>{
 const root=fixture({delay:true,timeout:1});const result=await launch(root).done;assert.equal(result.code,1,result.stdout+result.stderr);assert.match(result.stdout,/CLI timed out/);
});
test('scheduler count resets on the next Chicago day, and malformed state fails closed', {skip:!windows},async()=>{
 const root=fixture();mkdirSync(join(root,'data/scheduler'));writeFileSync(join(root,'data/scheduler/state.json'),JSON.stringify({day:'2000-01-01',runs:10}));
 const result=await launch(root).done;assert.equal(result.code,0,result.stdout+result.stderr);assert.equal(JSON.parse(readFileSync(join(root,'data/scheduler/state.json'),'utf8')).runs,1);
 const corrupt=fixture();mkdirSync(join(corrupt,'data/scheduler'));writeFileSync(join(corrupt,'data/scheduler/state.json'),'{broken');assert.equal((await launch(corrupt).done).code,1);assert(!existsSync(join(corrupt,'calls.jsonl')));
});
test('zero daily run limit permits repeated launcher tests without resetting state', {skip:!windows},async()=>{
 const root=fixture();const path=join(root,'config/scheduler.json');const config=JSON.parse(readFileSync(path,'utf8'));config.dailyRunLimit=0;writeFileSync(path,JSON.stringify(config));
 for(let i=0;i<3;i++){const result=await launch(root).done;assert.equal(result.code,0,result.stdout+result.stderr);assert.doesNotMatch(result.stdout,/skipped_daily_limit/);}
 assert.equal(calls(root).length,6);assert.equal(JSON.parse(readFileSync(join(root,'data/scheduler/state.json'),'utf8')).runs,3);
});
test('schema migration preserves historical data and records only observed submission timestamps',()=>{
 const root=mkdtempSync(join(tmpdir(),'agent-migrate-'));const path=join(root,'agent.sqlite');const legacy=new DatabaseSync(path);
 legacy.exec('CREATE TABLE applications(job_id TEXT PRIMARY KEY,status TEXT NOT NULL,day TEXT NOT NULL,confirmation_url TEXT,screenshot TEXT,detail TEXT)');legacy.prepare('INSERT INTO applications VALUES(?,?,?,?,?,?)').run('legacy','submitted','2025-01-01','url',null,'old');legacy.close();
 const store=new Store(path);try{
 const job=rank({id:'fresh',company:'Fixture',title:'Backend',location:'Austin',url:'https://example.invalid/fresh',description:'AWS'});store.save(job);store.reserve(job.id);store.finish(job.id,'uncertain',null,null,'not observed');assert.equal(reportRows(store)[0].submitted_at,'');
 store.finish(job.id,'submitted','https://example.invalid/confirmation',null,'observed');const row=reportRows(store)[0];assert.equal(row.submitted_date,day());assert.match(row.submitted_at,/^\d{4}-\d{2}-\d{2}T/);
 const original=row.submitted_at;store.finish(job.id,'submitted','same',null,'same');assert.equal(reportRows(store)[0].submitted_at,original);
 assert.equal((store.db.prepare('SELECT submitted_at FROM applications WHERE job_id=?').get('legacy') as any).submitted_at,null);
 }finally{store.close();}
});
