import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Store} from '../core.ts';
import {rank} from '../core.ts';
import {eligible} from '../shared.ts';
import {agentConfig} from './config.ts';
import {ResponsesModel} from './model.ts';
import {loadEvidence} from './evidence.ts';
import {Budget} from './budget.ts';
import {evaluateJob} from './semantic.ts';
import {assertSubmissionAllowed} from '../apply.ts';
import {agentTables,runBrowserAgent} from './controller.ts';
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
export async function agentCommand(command:string,id:string|undefined,flags:string[],store:Store){
 const profile=read('config/profile.json');const policy=read('config/shared.json');
 if(command==='agent-evidence'){const facts=await loadEvidence(profile);const path=join(store.reportDirectory,'approved-evidence.json');writeFileSync(path,JSON.stringify(facts,null,2)+'\n');console.log(JSON.stringify({path,profileFacts:facts.filter(f=>f.source==='profile').length,resumeExcerpts:facts.filter(f=>f.source==='resume').length},null,2));return;}
 const job=store.jobs().find(j=>j.id===id);if(!job)throw Error('Job ID not found');
 const live=!flags.includes('--dry-run')&&(flags.includes('--submit')||flags.includes('--submit-once'));
 if(command==='agent-apply'&&live)assertSubmissionAllowed(job,job.applicationUrl||job.url,{once:flags.includes('--submit-once')});
 const config=agentConfig();const model=new ResponsesModel();const facts=await loadEvidence(profile);
 if(command==='agent-evaluate'){
  const budget=new Budget(config);const evaluation=await evaluateJob(job,facts,model,budget,config);agentTables(store);store.db.prepare('INSERT INTO semantic_evaluations VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET model=excluded.model,evaluation=excluded.evaluation,created_at=excluded.created_at').run(job.id,config.model,JSON.stringify(evaluation),new Date().toISOString());
  console.log(JSON.stringify({jobId:job.id,deterministicPolicy:{eligible:eligible(job,policy),flags:rank(job).flags},evaluation,usage:{inputTokens:budget.inputTokens,outputTokens:budget.outputTokens,estimatedUsd:budget.estimatedUsd}},null,2));return;
 }
 const result=await runBrowserAgent(job,store,profile,policy,config,model,facts,{live,once:flags.includes('--submit-once'),headless:!flags.includes('--headed')});console.log(JSON.stringify(result,null,2));if(!['dry_run_ready','submitted'].includes(result.status))process.exitCode=1;
}
