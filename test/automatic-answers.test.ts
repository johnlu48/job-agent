import {test} from 'node:test';
import assert from 'node:assert/strict';
import {automaticAnswer} from '../src/automatic-answers.ts';
import {authorizeSubmission} from '../src/submission.ts';
const job={id:'greenhouse:acme:123',company:'Acme',title:'Backend',location:'Austin',description:'AWS',url:'https://example.invalid/123'};
test('routine discovery questions use the actual source rather than fabricated referrals',()=>{
 const answer=automaticAnswer({label:'How did you hear about this job?',context:'',type:'text'},job,{discoverySourceAnswer:true});assert.match(String(answer?.value),/Acme careers page \(Greenhouse\)/);
 assert.equal(automaticAnswer({label:'Who referred you?',context:'',type:'text'},job,{discoverySourceAnswer:true}),undefined);
 assert.equal(automaticAnswer({label:'How did you hear about this job?',context:'',type:'text'},job),undefined);
});
test('standing privacy authorization covers acknowledgments but not unrelated or ambiguous consent',()=>{
 const policy={candidatePrivacyAcknowledgment:true};const q={label:'Acknowledge/Confirm',context:"Please review and acknowledge Cloudflare's Candidate Privacy Policy.",type:'checkbox'};
 assert.equal(automaticAnswer(q,job,policy)?.value,true);
 for(const extra of [' Subscribe to marketing emails.',' Join our talent community.',' Agree to arbitration.',' Certify all information is accurate.'])assert.equal(automaticAnswer({...q,context:q.context+extra},job,policy),undefined);
 assert.equal(automaticAnswer({...q,context:'Acknowledge/Confirm'},job,policy),undefined);
 assert.equal(automaticAnswer({...q,type:'text'},job,policy),undefined);
});
test('single-job permission does not enable bulk or other jobs',()=>{
 const config={enabled:false,singleJobIds:[job.id]};authorizeSubmission(config,job.id,true,{});
 assert.throws(()=>authorizeSubmission(config,'other',true,{}),/disabled/);assert.throws(()=>authorizeSubmission(config,undefined,true,{}),/disabled/);assert.throws(()=>authorizeSubmission(config,job.id,false,{JOB_AGENT_ENABLE_SUBMISSION:'YES'}),/disabled/);
});
