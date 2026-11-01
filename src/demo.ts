import { mkdirSync,writeFileSync } from 'node:fs';
import { fixture } from './fixture.ts';
import { Store,rank } from './core.ts';
import { applyJob,type Approval } from './apply.ts';
mkdirSync('data/demo',{recursive:true});writeFileSync('data/demo/resume.txt','SYNTHETIC TEST RESUME. Not for applications.');
const f=await fixture();const db=new Store('data/demo/demo.sqlite');
try{const job=rank({id:'demo:local',company:'LOCAL FIXTURE',title:'Senior Software Engineer - Distributed Systems',location:'Austin, TX',url:f.url,description:'AWS DynamoDB distributed systems IoT orchestration'});db.save(job);const approval:Approval={url:f.url,reviewed:true,formSelector:'form',fields:{'#name':'Synthetic Demo','#email':'demo@example.invalid','#auth':'no'},resumeSelector:'#resume',submitSelector:'button',confirmationSelector:'.confirmation',confirmationText:'Your application has been received'};console.log(JSON.stringify(job,null,2));console.log(await applyJob(job,db,{values:{},resumes:{'distributed-systems':'data/demo/resume.txt'}},approval,false,{headless:true,session:'data/demo/browser'}));console.log(`Local form submissions observed: ${f.count()}`);if(f.count()!==0)throw Error('Dry-run submitted unexpectedly');}finally{db.close();await f.close();}
