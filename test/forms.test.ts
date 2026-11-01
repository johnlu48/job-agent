import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,rank} from '../src/core.ts';
import {applyJob} from '../src/apply.ts';
import type {SharedPolicy} from '../src/shared.ts';
import {normalizeLabel} from '../src/forms.ts';
const combo=(id:string,label:string,options:string[])=>`<div data-select-container><label for="${id}">${label}</label><input id="${id}" role="combobox" aria-required="true" aria-controls="${id}-list"><input aria-hidden="true" tabindex="-1" required style="position:absolute;opacity:0;width:1px;height:1px"><span data-selected-value></span><div role="listbox" id="${id}-list" hidden>${options.map(o=>`<button type="button" role="option">${o}</button>`).join('')}</div></div>`;
test('captured Cloudflare relocation question matches the approved straight-apostrophe label',()=>{
 const captured='Do you currently live or are you willing to relocate to the job\u2019s location?*';
 const approved="Do you currently live or are you willing to relocate to the job's location?";
 assert.equal(normalizeLabel(captured),normalizeLabel(approved));
 // Corruption must be repaired in configuration, not hidden by fuzzy question matching.
 assert.notEqual(normalizeLabel(captured),normalizeLabel(approved.replace("job's",'job?s')));
});
test('modern Greenhouse-style comboboxes select approved options and validate mirrored required controls',async()=>{
 let submissions=0;const server=createServer((req,res)=>{if(req.method==='POST'){submissions++;res.end('<h1>Application submitted!</h1>');return;}res.setHeader('Content-Type','text/html');res.end(`<form id="modern" method="post"><label for="first_name">First Name</label><input id="first_name" required><label for="source">How did you hear about this job?</label><input id="source" required>${combo('country','Country*',['United States +1','Canada +1'])}${combo('city','Location (City)*',['Austin, TX, USA','Austin, Minnesota, USA'])}${combo('sponsor','Require sponsorship?',['Yes','No'])}<label for="resume">Resume</label><input id="resume" type="file" required><fieldset><legend>Candidate privacy policy</legend><label for="ack">Acknowledge/Confirm</label><input id="ack" type="checkbox" required></fieldset><button type="submit">Submit</button></form><script>
 for(const root of document.querySelectorAll('[data-select-container]')){const input=root.querySelector('[role=combobox]'),list=root.querySelector('[role=listbox]'),mirror=root.querySelector('[aria-hidden]');input.addEventListener('focus',()=>{list.hidden=false;input.setAttribute('aria-expanded','true');});input.addEventListener('input',()=>{list.hidden=false;});for(const option of root.querySelectorAll('[role=option]'))option.addEventListener('click',()=>{root.querySelector('[data-selected-value]').textContent=option.textContent;mirror.value=option.textContent;input.value='';list.hidden=true;input.setAttribute('aria-expanded','false');});}
 </script>`);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r()));const url=`http://127.0.0.1:${(server.address() as any).port}/`;
 const dir=mkdtempSync(join(tmpdir(),'modern-forms-'));const resume=join(dir,'resume.txt');writeFileSync(resume,'synthetic fixture');const db=new Store(':memory:');
 const job=rank({id:'modern:one',company:'Fixture',title:'Senior Software Engineer',description:'AWS distributed systems',location:'Austin',url,source:'greenhouse'});
 const profile={values:{firstName:'Synthetic',country:'United States',city:'Austin, Texas, United States'},resumes:{'distributed-systems':resume}};
 const policy:SharedPolicy={enabled:true,minScore:0,allowMissingSalary:true,answers:[{labels:['How did you hear about this job?'],value:'Fixture careers page',approved:true},{labels:['First Name'],value:'$firstName',approved:true},{labels:['Country'],value:'$country',approved:true},{labels:['Location (City)'],value:'$city',approved:true},{labels:['Require sponsorship?'],value:'No',approved:true}],adapters:[{hosts:['127.0.0.1'],formSelector:'form',resumeSelector:'#resume',submitSelector:'button[type=submit]',confirmationSelector:'h1',confirmationText:'',confirmationPattern:'^Application submitted!$'}]};
 const options={allowLocalTestSubmission:true,headless:true,session:join(dir,'browser'),shared:policy};
 try{
  await assert.rejects(()=>applyJob(job,db,profile,undefined,false,options),/Acknowledge\/Confirm/);assert.equal(submissions,0);
  policy.answers.push({labels:['Acknowledge/Confirm'],value:true,approved:true,jobIds:[job.id]});
  assert.equal((await applyJob(job,db,profile,undefined,false,options)).status,'dry_run');assert.equal(submissions,0);
  await assert.rejects(()=>applyJob({...job,id:'modern:two'},db,profile,undefined,false,options),/Acknowledge\/Confirm/);
  policy.answers=policy.answers.filter(a=>!a.labels.includes('Acknowledge/Confirm')&&!a.labels.includes('How did you hear about this job?'));
  policy.automation={candidatePrivacyAcknowledgment:true,discoverySourceAnswer:true};
  assert.equal((await applyJob(job,db,profile,undefined,true,options)).status,'submitted');
  const event=db.db.prepare("SELECT detail FROM events WHERE event='automatic_answers' LIMIT 1").get() as any;assert.match(event.detail,/discovery_source/);assert.match(event.detail,/candidate_privacy_acknowledgment/);assert.equal(submissions,1);
 }finally{db.close();await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
