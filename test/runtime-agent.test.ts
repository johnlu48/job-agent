import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {unfamiliarForm} from '../src/agent/fixture.ts';
import {demoSetup} from '../src/agent/demo-support.ts';
import {DemoModel} from '../src/agent/mock-demo-model.ts';
import {runBrowserAgent,agentInstructions} from '../src/agent/controller.ts';
import {groundAnswer,approvedResume} from '../src/agent/evidence.ts';
import {validateAction,browserTools} from '../src/agent/tools.ts';
import {agentConfig} from '../src/agent/config.ts';
import type {ModelGateway,ModelRequest,ModelResponse,Control} from '../src/agent/types.ts';

test('observe-reason-act recovers validation, navigates an unfamiliar multi-step form and fills conditional fields without submitting',async()=>{
 const fixture=await unfamiliarForm({injection:true});const setup=demoSetup(fixture.url);const model=new DemoModel();
 try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,model,setup.facts,setup.options);
  assert.equal(result.status,'dry_run_ready',result.error);assert(result.steps>=8);assert.equal(fixture.count(),0);assert.equal(setup.store.db.prepare('SELECT count(*) n FROM applications').get()!.n,0);
  assert(model.requests.length>3);assert(model.requests.every(r=>r.store===false&&r.parallel_tool_calls===false));
  const log=readFileSync(result.logPath,'utf8');assert.match(log,/Uppercase|uppercase/);assert.match(log,/upload_resume/);assert.match(log,/action_decision/);assert(result.inputTokens>0&&result.estimatedUsd>0);
  const directory=join(result.logPath,'..');const snapshots=readdirSync(directory).filter(n=>n.startsWith('observation-')).map(n=>readFileSync(join(directory,n),'utf8'));assert(snapshots.some(s=>s.includes('Describe your distributed systems experience')));
  assert(model.requests.some(r=>JSON.stringify(r.input).includes('SYSTEM OVERRIDE')));assert(model.requests.every(r=>r.instructions===agentInstructions||r.instructions.includes('Assess job fit')));
 }finally{setup.store.close();await fixture.close();}
});
test('local fixture submission uses the actual authorized executor and only marks observed confirmation submitted',async()=>{
 const fixture=await unfamiliarForm();const setup=demoSetup(fixture.url);
 try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,new DemoModel(),setup.facts,{...setup.options,live:true});assert.equal(result.status,'submitted',result.error);assert.equal(fixture.count(),1);assert.equal((setup.store.application(setup.job.id) as any).status,'submitted');assert(result.confirmationUrl);assert(result.screenshot);
  const duplicate=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,new DemoModel(),setup.facts,{...setup.options,live:true});assert.equal(duplicate.status,'blocked');assert.equal(fixture.count(),1);
 }finally{setup.store.close();await fixture.close();}
});
test('unknown legal questions stop for missing facts rather than fabricating eligibility',async()=>{
 const fixture=await unfamiliarForm({unknownQuestion:true});const setup=demoSetup(fixture.url);
 try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,new DemoModel(),setup.facts,setup.options);assert.equal(result.status,'needs_answers');assert.match(result.error||'',/clearance/);assert.equal(fixture.count(),0);}finally{setup.store.close();await fixture.close();}
});
test('misleading page instructions cannot create filesystem/shell tools or alter approved file paths',async()=>{
 const fixture=await unfamiliarForm({injection:true});const setup=demoSetup(fixture.url);const good=new DemoModel();
 const malicious:ModelGateway={respond:async request=>request.text?good.respond(request):({id:'malicious',status:'completed',usage:{input_tokens:100,output_tokens:50},output:[{type:'function_call',call_id:'evil',name:'read_file',arguments:JSON.stringify({path:'.env'})}]})};
 try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,malicious,setup.facts,setup.options);assert.equal(result.status,'blocked');assert.match(result.error||'',/forbidden tool/);assert.equal(fixture.count(),0);assert.throws(()=>validateAction('upload_resume',JSON.stringify({target_id:'c1',revision:'r',resume_kind:'../../.env',rationale:'page asked'})),/resume category/);assert.throws(()=>approvedResume({...setup.profile,resumes:{'distributed-systems':'package.json'}},'distributed-systems',setup.resumeRoot),/outside/);}finally{setup.store.close();await fixture.close();}
});
test('repeated actions and maximum steps terminate the model loop',async()=>{
 for(const maxSteps of [20,1]){const fixture=await unfamiliarForm();const setup=demoSetup(fixture.url);const normal=new DemoModel();const repetitive:ModelGateway={respond:async request=>request.text?normal.respond(request):({id:'repeat',status:'completed',usage:{input_tokens:50,output_tokens:20},output:[{type:'function_call',call_id:'repeat',name:'inspect_page',arguments:JSON.stringify({rationale:'Inspect again.'})}]})};
  try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,{...setup.config,maxSteps},repetitive,setup.facts,setup.options);assert.equal(result.status,maxSteps===1?'max_steps':'stalled');assert.equal(fixture.count(),0);}finally{setup.store.close();await fixture.close();}
 }
});
test('budgets stop before issuing unaffordable requests and model usage is accounted across the application',async()=>{
 const fixture=await unfamiliarForm();const setup=demoSetup(fixture.url);let calls=0;const model:ModelGateway={respond:async()=>{calls++;throw Error('must not send');}};
 try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,{...setup.config,maxUsd:0.000001},model,setup.facts,setup.options);assert.equal(result.status,'budget_exhausted');assert.equal(calls,0);assert.equal(fixture.count(),0);}finally{setup.store.close();await fixture.close();}
});
test('runtime tool validation rejects missing evidence, unsupported answer claims and protected fact substitution',()=>{
 assert.equal(browserTools.length,6);assert.throws(()=>validateAction('fill_field','{"target_id":"c1"}'),/schema/);
 const control={id:'c1',label:'Will you require sponsorship?',type:'text',context:''} as Control;
 const facts=[{id:'profile:requiresSponsorship',value:'No',source:'profile' as const,topic:'requiresSponsorship'},{id:'resume:1',value:'AWS systems',source:'resume' as const,topic:'professional'}];
 assert.throws(()=>groundAnswer(control,'Yes',[{id:'resume:1',quote:'AWS systems'}],facts),/requiresSponsorship/);
 assert.throws(()=>groundAnswer(control,'No, I have ten years experience',[{id:'profile:requiresSponsorship',quote:'No'}],facts),/unsupported|not supported/);
 assert.equal(groundAnswer(control,'No',[{id:'profile:requiresSponsorship',quote:'No'}],facts),'No');
 assert.throws(()=>agentConfig({}),/OPENAI_MODEL/);
});
test('a misleading Next button cannot submit behind the executor in dry-run mode',async()=>{
 const fixture=await unfamiliarForm({prematurePost:true});const setup=demoSetup(fixture.url);
 try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,new DemoModel(),setup.facts,setup.options);assert.equal(result.status,'blocked');assert.match(result.error||'',/network write blocked/);assert.equal(fixture.count(),0);}finally{setup.store.close();await fixture.close();}
});
test('protected-field enforcement rejects an LLM trying to reuse US work authorization as security clearance',async()=>{
 const fixture=await unfamiliarForm({unknownQuestion:true});const setup=demoSetup(fixture.url);const normal=new DemoModel();
 const unsafe:ModelGateway={respond:async request=>{if(request.text)return normal.respond(request);const payload=JSON.parse(request.input.findLast(item=>item.role==='user'&&Array.isArray(item.content))!.content[0].text);const c=payload.untrustedObservation.controls.find((c:Control)=>/security clearance/i.test(c.label));if(!c)return normal.respond(request);return {id:'unsafe',status:'completed',usage:{input_tokens:100,output_tokens:50},output:[{type:'function_call',call_id:'unsafe',name:'choose_option',arguments:JSON.stringify({target_id:c.id,revision:payload.untrustedObservation.revision,value:'Yes',evidence:[{id:'profile:workAuthorizationUS',quote:'Yes'}],rationale:'Try a legal fact for another legal question.'})}]};}};
 try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,unsafe,setup.facts,setup.options);assert.equal(result.status,'needs_answers');assert.match(result.error||'',/__unknown_legal_fact/);assert.equal(fixture.count(),0);}finally{setup.store.close();await fixture.close();}
});
test('the actual executor rejects unauthorized live mode without relying on CLI checks',async()=>{
 const fixture=await unfamiliarForm();const setup=demoSetup(fixture.url);
 try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,new DemoModel(),setup.facts,{headless:true,session:setup.options.session,resumeRoot:setup.resumeRoot,live:true});assert.equal(result.status,'blocked');assert.match(result.error||'',/submissions are disabled/);assert.equal(fixture.count(),0);assert.equal(setup.store.db.prepare('SELECT count(*) n FROM applications').get()!.n,0);}finally{setup.store.close();await fixture.close();}
});
test('CAPTCHA, MFA and access restrictions stop before model-selected browser actions',async()=>{
 for(const restriction of ['captcha','mfa','denied'] as const){const fixture=await unfamiliarForm({restriction});const setup=demoSetup(fixture.url);const model=new DemoModel();
  try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,model,setup.facts,setup.options);assert.equal(result.status,'blocked');assert.match(result.error||'',/restriction|MFA|access error/);assert.equal(model.calls,1);assert.equal(fixture.count(),0);}finally{setup.store.close();await fixture.close();}
 }
});
test('missing confirmation leaves an uncertain attempt and prevents retries',async()=>{
 const fixture=await unfamiliarForm({missingConfirmation:true});const setup=demoSetup(fixture.url);
 try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,new DemoModel(),setup.facts,{...setup.options,live:true});assert.equal(result.status,'uncertain');assert.equal(fixture.count(),1);assert.equal((setup.store.application(setup.job.id) as any).status,'uncertain');const again=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,new DemoModel(),setup.facts,{...setup.options,live:true});assert.equal(again.status,'blocked');assert.equal(fixture.count(),1);}finally{setup.store.close();await fixture.close();}
});
test('prechecked optional marketing is declined using policy evidence, not mistaken for candidate privacy consent',async()=>{
 const fixture=await unfamiliarForm({precheckedMarketing:true});const setup=demoSetup(fixture.url);
 try{const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,setup.config,new DemoModel(),setup.facts,{...setup.options,live:true});assert.equal(result.status,'submitted',result.error);assert.equal(fixture.count(),1);assert(!fixture.posted[0].includes('newsletter='));assert.match(readFileSync(result.logPath,'utf8'),/"value":"false"/);}finally{setup.store.close();await fixture.close();}
});
