import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, writeFileSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Job, Store } from './core.ts';
import { sharedApproval, type SharedPolicy } from './shared.ts';
import {fillCombobox,validateRequired} from './forms.ts';
import {authorizeSubmission} from './submission.ts';
export interface Approval { url:string; reviewed:boolean; fields:Record<string,string|boolean>; resumeSelector:string; submitSelector:string; confirmationSelector:string; confirmationText:string; confirmationPattern?:string; confirmationUrlPattern?:string; formSelector:string;automaticAnswers?:{selector:string;label:string;rule:string}[] }
export interface Profile { resumes:Record<string,string>; values:Record<string,string> }
export async function inspect(page:Page){return page.locator('input,select,textarea,button').evaluateAll(els=>els.map(e=>({tag:e.tagName,id:e.id,name:e.getAttribute('name'),type:e.getAttribute('type'),role:e.getAttribute('role'),ariaHidden:e.getAttribute('aria-hidden'),ariaControls:e.getAttribute('aria-controls'),tabIndex:e.getAttribute('tabindex'),required:e.hasAttribute('required')||e.getAttribute('aria-required')==='true',label:e.getAttribute('aria-label')||(e.id?document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent:null),context:e.closest('fieldset')?.textContent?.slice(0,2500)||e.parentElement?.parentElement?.textContent?.slice(0,2500)||'',text:e.tagName==='BUTTON'?e.textContent:null,options:e.tagName==='SELECT'?Array.from((e as HTMLSelectElement).options).map(o=>({value:o.value,text:o.text})):undefined})));}
export async function restriction(page:Page){if(/captcha|verify you are human|access denied|unusual traffic/i.test(await page.innerText('body')))throw Error('Website restriction detected; stop and review manually');if(await page.locator('iframe[src*="recaptcha"],iframe[src*="hcaptcha"]').count())throw Error('CAPTCHA detected; manual completion required');if(await page.locator('input[type=password]:visible,input[autocomplete=one-time-code]:visible').count()||/enter (?:the )?(?:verification|authentication|security) code|two-factor authentication required|sign in to continue/i.test(await page.innerText('body')))throw Error('MFA or authentication required; stop for manual login');}
export interface SubmissionOptions {once?:boolean;allowLocalTestSubmission?:boolean;onReserved?:()=>void}
export function assertSubmissionAllowed(job:Job,currentUrl:string,options:SubmissionOptions={}){
 const url=new URL(currentUrl),expected=new URL(job.applicationUrl||job.url);
 const greenhouse=['boards.greenhouse.io','job-boards.greenhouse.io'];
 if(url.origin!==expected.origin&&!(greenhouse.includes(url.hostname)&&greenhouse.includes(expected.hostname)))throw Error('Submission origin does not match the approved employer URL');
 const local=options.allowLocalTestSubmission===true&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.origin===expected.origin;
 if(!local){const settings=JSON.parse(readFileSync('config/submission.json','utf8').replace(/^\uFEFF/,''));authorizeSubmission(settings,job.id,options.once===true);}
}
export async function executeSubmission(page:Page,job:Job,store:Store,approval:Approval,screenshot:string,approvedSelectors:string[],options:SubmissionOptions={}){
 assertSubmissionAllowed(job,page.url(),options);
 await restriction(page);
 const missing=await validateRequired(page.locator(approval.formSelector),approvedSelectors);if(missing.length)throw Error('Missing required answers: '+missing.join(', '));
 if(!approval.confirmationText.trim()&&!approval.confirmationPattern)throw Error('An explicit confirmation phrase is required');
 const confirmation=page.locator(approval.confirmationSelector);if(await confirmation.isVisible().catch(()=>false))throw Error('Confirmation already visible before submission');
 const submit=page.locator(approval.formSelector).locator(approval.submitSelector);if(await submit.count()!==1)throw Error('Expected exactly one submit control');
 store.reserve(job.id);store.log('submission_attempt',job.id);options.onReserved?.();
 try{
  await submit.click({timeout:15000});await confirmation.waitFor({state:'visible',timeout:20000});
  const text=await confirmation.innerText();if(approval.confirmationPattern?!new RegExp(approval.confirmationPattern,'i').test(text):!text.includes(approval.confirmationText))throw Error('Confirmation text did not match');
  if(approval.confirmationUrlPattern&&!new RegExp(approval.confirmationUrlPattern).test(page.url()))throw Error('Confirmation URL did not match');
  await page.screenshot({path:screenshot,fullPage:true});store.finish(job.id,'submitted',page.url(),screenshot,'Observed approved confirmation');store.result(job.id,'submitted','',screenshot,page.url());return {status:'submitted',url:page.url(),screenshot};
 }catch(e){store.finish(job.id,'uncertain',null,null,String(e));store.result(job.id,'uncertain',String(e));throw e;}
}
export async function applyJob(job:Job,store:Store,profile:Profile,approval:Approval|undefined,live=false,options:{headless?:boolean;session?:string;shared?:SharedPolicy;once?:boolean;allowLocalTestSubmission?:boolean}={}){
 if(live&&store.application(job.id))throw Error('Duplicate or unresolved attempt; inspect status before retrying');
 if(['remoteok','arbeitnow','adzuna'].includes(job.source||'')&&!job.applicationUrl)throw Error('Aggregator application URL is unresolved; manual review required');
 if(live&&!options.shared&&(!approval?.reviewed||approval.url!==job.url))throw Error('Real submission requires reviewed approval matching the job URL');
 const session=options.session||'data/browser';mkdirSync('data/artifacts',{recursive:true});
 const context=await chromium.launchPersistentContext(session,{headless:options.headless??false,acceptDownloads:false});const page=await context.newPage();const stem=resolve('data/artifacts',`${Date.now()}-${job.id.replace(/[^a-z0-9]/gi,'_')}`);let screenshot:string|null=null;
 try{
  const response=await page.goto(job.applicationUrl||job.url,{waitUntil:'domcontentloaded',timeout:45000});if(response&&response.status()>=400)throw Error(`HTTP ${response.status()}`);await restriction(page);
  writeFileSync(stem+'.fields.json',JSON.stringify(await inspect(page),null,2));
  writeFileSync(stem+'.page.json',JSON.stringify({url:page.url(),forms:await page.locator('form').evaluateAll(forms=>forms.map(f=>({id:f.id,action:f.getAttribute('action')})))},null,2));
  if(options.shared)approval=await sharedApproval(page,job,options.shared,profile);
  if(approval?.automaticAnswers?.length){writeFileSync(stem+'.automatic-answers.json',JSON.stringify(approval.automaticAnswers,null,2));store.log('automatic_answers',job.id,JSON.stringify(approval.automaticAnswers));}
  if(!approval){screenshot=stem+'.png';await page.screenshot({path:screenshot,fullPage:true});store.log('needs_answers',job.id,stem+'.fields.json');store.result(job.id,'needs_answers','No approved answers configured',screenshot);return {status:'needs_answers',artifact:stem+'.fields.json'};}
  if(approval.url!==job.url)throw Error('Approval URL mismatch');
  const form=page.locator(approval.formSelector);if(await form.count()!==1)throw Error('Expected exactly one approved form');
  for(const [selector,answer] of Object.entries(approval.fields)){
   const field=form.locator(selector);if(await field.count()!==1)throw Error(`Ambiguous or missing field: ${selector}`);
   const type=await field.getAttribute('type');if(type==='password'||type==='file'||type==='submit'||type==='hidden')throw Error(`Unsupported approved field type: ${type}`);
   const value=typeof answer==='string'&&/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(answer)?profile.values[answer.slice(1)]:answer;
   if(value===undefined)throw Error(`Missing approved personal value: ${answer}`);
   if(type==='checkbox'||type==='radio'){if(typeof value!=='boolean')throw Error('Checkbox/radio requires explicit boolean');await field.setChecked(value);}
   else if(await field.evaluate(e=>e.tagName)==='SELECT')await field.selectOption(String(value));
   else if(await field.getAttribute('role')==='combobox')await fillCombobox(page,field,String(value));else await field.fill(String(value));
  }
  const resume=profile.resumes[job.resume||'distributed-systems'];if(!resume||!existsSync(resume))throw Error(`Missing ${job.resume} resume`);
  await form.locator(approval.resumeSelector).setInputFiles(resolve(resume));
  // Every required field needs an explicit approval, even when a site preselects an answer.
  const missing=await validateRequired(form,Object.keys(approval.fields));
  if(missing.length)throw Error(`Missing required answers: ${missing.join(', ')}. Add explicit approved values; no answers are inferred.`);
  await restriction(page);screenshot=stem+'.png';await page.screenshot({path:screenshot,fullPage:true});
  if(!live){store.log('dry_run',job.id,screenshot);store.result(job.id,'dry_run','',screenshot);return {status:'dry_run',screenshot};}
  return await executeSubmission(page,job,store,approval,stem+'-confirmation.png',Object.keys(approval.fields),options);
 }catch(e){try{screenshot=stem+'-error.png';await page.screenshot({path:screenshot,fullPage:true});}catch{}const uncertain=(store.application(job.id) as any)?.status==='uncertain';store.result(job.id,uncertain?'uncertain':'blocked',String(e),screenshot);store.log('application_error',job.id,String(e));throw e;}finally{await context.close();}
}
