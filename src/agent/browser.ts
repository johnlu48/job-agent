import {chromium,type BrowserContext,type Page} from 'playwright';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {controls,fillCombobox,validateRequired} from '../forms.ts';
import {executeSubmission,restriction,assertSubmissionAllowed,type Profile,type Approval} from '../apply.ts';
import {robotsPolicy} from '../access.ts';
import {approvedResume,groundAnswer,requiredSlot} from './evidence.ts';
import {MissingFactError,PolicyError,type Action,type AgentConfig,type Control,type Evidence,type Observation} from './types.ts';
import type {Job,Store} from '../core.ts';
import type {SharedPolicy} from '../shared.ts';
type BrowserOptions={headless?:boolean;session?:string;resumeRoot?:string;live?:boolean;once?:boolean;localFixture?:boolean};

export class BrowserExecutor {
 context?:BrowserContext;page?:Page;observation?:Observation;violation='';
 robots=new Map<string,{text:string;delay:number}>();lastNavigation=new Map<string,number>();
 prefix='agent-'+randomUUID();serial=0;uploaded=false;submissionArmed=false;approvedSelectors=new Set<string>();observedValues=new Map<string,string>();
 job:Job;store:Store;profile:Profile;policy:SharedPolicy;config:AgentConfig;directory:string;options:BrowserOptions;
 constructor(job:Job,store:Store,profile:Profile,policy:SharedPolicy,config:AgentConfig,directory:string,options:BrowserOptions={}){this.job=job;this.store=store;this.profile=profile;this.policy=policy;this.config=config;this.directory=directory;this.options=options;}
 allowedOrigins(){const origin=new URL(this.job.applicationUrl||this.job.url);const list=new Set([origin.origin,...this.config.allowedOrigins]);if(['boards.greenhouse.io','job-boards.greenhouse.io'].includes(origin.hostname)){list.add('https://boards.greenhouse.io');list.add('https://job-boards.greenhouse.io');}return list;}
 async access(url:string,navigation=false){const u=new URL(url);const local=this.options.localFixture&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname);if(u.protocol!=='https:'&&!local)throw new PolicyError('Agent application URLs must be HTTPS (except explicit localhost fixtures)');if(!this.allowedOrigins().has(u.origin))throw new PolicyError('Navigation outside the configured employer origins');
  if(this.config.requireRobots&&!local){if(!this.robots.has(u.origin)){const response=await fetch(u.origin+'/robots.txt',{headers:{'User-Agent':'JobApplicationAgent/1.0 (personal job search)'},signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok&&response.status!==404)throw new PolicyError('Cannot verify employer robots restrictions');this.robots.set(u.origin,{text:response.status===404?'':await response.text(),delay:1000});this.lastNavigation.set(u.origin,Date.now());}const policy=robotsPolicy(this.robots.get(u.origin)!.text,u.pathname+u.search);if(!policy.allowed)throw new PolicyError('Employer robots policy disallows this application path');if(navigation){const delay=policy.delay-(Date.now()-(this.lastNavigation.get(u.origin)||0));if(delay>0)await new Promise(r=>setTimeout(r,delay));this.lastNavigation.set(u.origin,Date.now());}}
 }
 async start(){
  if(this.options.live)assertSubmissionAllowed(this.job,this.job.applicationUrl||this.job.url,{once:this.options.once,allowLocalTestSubmission:this.options.localFixture});
  await this.access(this.job.applicationUrl||this.job.url);mkdirSync(this.directory,{recursive:true});
  this.context=await chromium.launchPersistentContext(this.options.session||'data/browser',{headless:this.options.headless??true,acceptDownloads:false,viewport:{width:1100,height:800},userAgent:'JobApplicationAgent/1.0 (personal job application)'});
  await this.context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
   const write=!['GET','HEAD','OPTIONS'].includes(request.method());const allowedDraft=(this.config.allowedDraftUrls||[]).includes(url.href);
   if(write&&!allowedDraft&&(!this.submissionArmed||!this.allowedOrigins().has(url.origin))){if(this.allowedOrigins().has(url.origin))this.violation='Unapproved network write blocked before authorized submission; a verified draft/upload endpoint may be required';await route.abort('blockedbyclient');return;}
   if(request.isNavigationRequest()){
   try{await this.access(request.url(),true);}catch(e){this.violation=String(e);await route.abort('blockedbyclient');return;}
  }await route.continue();});
  this.page=await this.context.newPage();this.page.on('download',download=>{this.violation='Unexpected download is unsupported';void download.cancel();});
  this.context.on('page',page=>{if(page!==this.page){this.violation='Unexpected popup is unsupported';void page.close();}});
  const response=await this.page.goto(this.job.applicationUrl||this.job.url,{waitUntil:'domcontentloaded',timeout:45000});if(response&&response.status()>=400)throw new PolicyError(`Employer access error: HTTP ${response.status()}`);
 }
 locator(id:string){if(!/^c\d+$/.test(id))throw new PolicyError('Only observed control IDs are accepted');return this.page!.locator(`[data-agent-node="${this.prefix}-${id}"]`);}
 async observe():Promise<Observation>{
  const page=this.page!;if(this.violation)throw new PolicyError(this.violation);if(!this.allowedOrigins().has(new URL(page.url()).origin))throw new PolicyError('Employer origin changed unexpectedly');await restriction(page);
  for(const form of await page.locator('form').all())await controls(form);
  const nodes=await page.locator('input,select,textarea,button,[role=combobox],[role=button]').evaluateAll((els,prefix)=>{
   let serial=Number(document.documentElement.getAttribute('data-agent-sequence')||'0');
   const result=els.filter(e=>{const c=e as HTMLInputElement;return (e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).opacity!=='0'&&e.getAttribute('aria-hidden')!=='true')||(c.type==='file'&&!c.disabled);}).slice(0,100).map(e=>{
    let node=e.getAttribute('data-agent-node');if(!node?.startsWith(prefix+'-')){node=prefix+'-c'+(++serial);e.setAttribute('data-agent-node',node);}
    const c=e as HTMLInputElement;const labelled=(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ');
    const label=e.getAttribute('aria-label')||Array.from(c.labels||[]).map(l=>l.textContent||'').join(' ')||labelled||(['BUTTON','A'].includes(e.tagName)?e.textContent||'':'');
    let selected='';if(e.getAttribute('role')==='combobox'&&!c.value){let root=e.parentElement;for(let depth=0;root&&root.tagName!=='FORM'&&depth<6;depth++,root=root.parentElement){const value=root.querySelector('[class*="singleValue"],[class*="single-value"],[data-selected-value]');if(value){selected=(value.textContent||'').trim();break;}}}
    const form=c.form;return {id:node.slice(prefix.length+1),domId:e.id,tag:e.tagName,type:e.getAttribute('type')||(e.tagName==='BUTTON'?'submit':'text'),role:e.getAttribute('role')||'',label:label.trim().slice(0,350),context:(e.closest('fieldset')?.textContent||e.parentElement?.parentElement?.textContent||'').trim().slice(0,700),value:c.type==='password'?'':c.type==='checkbox'||c.type==='radio'?String(c.checked):(e.getAttribute('data-agent-selected-label')||c.value||selected).slice(0,2500),required:c.required||e.getAttribute('aria-required')==='true',disabled:c.disabled||e.getAttribute('aria-disabled')==='true',options:e.tagName==='SELECT'?Array.from((e as HTMLSelectElement).options).map(o=>({value:o.value,text:o.text})):[],href:e.getAttribute('href')||'',formAction:form?.getAttribute('action')||'',submit:e.tagName==='BUTTON'?(c.type==='submit'):(e.tagName==='INPUT'&&c.type==='submit'),invalid:'checkValidity' in c?!c.checkValidity():false};
   });document.documentElement.setAttribute('data-agent-sequence',String(serial));return result;
  },this.prefix);
  const text=(await page.innerText('body')).slice(0,10000);const alerts=await page.locator('[role=alert],[aria-live=assertive],.error-message,[data-error]').allTextContents();
  const payload={url:page.url(),title:await page.title(),text,controls:nodes as Control[],validationMessages:alerts.map(s=>s.trim()).filter(Boolean).slice(0,25),restrictions:[]};
  const stable={url:payload.url,controls:payload.controls.map(({id,...c})=>({...c,domId:undefined})),validationMessages:payload.validationMessages};
  const observation:Observation={revision:randomUUID(),fingerprint:createHash('sha256').update(JSON.stringify(stable)).digest('hex'),...payload};
  if(this.config.screenshots){const buffer=await page.screenshot({fullPage:false});if(buffer.byteLength>512000)throw new PolicyError('Screenshot exceeds the model observation size bound');observation.screenshot='data:image/png;base64,'+buffer.toString('base64');}
  this.observation=observation;return observation;
 }
 async execute(action:Action,facts:Evidence[]):Promise<{terminal?:string;question?:string;result?:unknown}>{
  if(action.name==='stop_for_missing_fact')return {terminal:'needs_answers',question:action.args.question};
  if(action.name==='inspect_page')return {result:'Page inspected'};
  if(this.violation)throw new PolicyError(this.violation);await restriction(this.page!);
  const observation=this.observation!;if(action.args.revision!==observation.revision)throw Error('Stale observation; inspect and use current control IDs');
  const control=observation.controls.find(c=>c.id===action.args.target_id);if(!control||control.disabled)throw Error('Target is not an observed enabled control');
  const field=this.locator(control.id);if(await field.count()!==1)throw Error('Observed control changed; inspect again');
  if(action.name==='fill_field'||action.name==='choose_option'){
   if(['password','file','hidden','submit'].includes(control.type))throw new PolicyError('This field type cannot be filled');
   const value=groundAnswer(control,action.args.value!,action.args.evidence!,facts);
   if(action.name==='choose_option'){
    if(control.type==='checkbox'||control.type==='radio'){if(!['true','false'].includes(value))throw new MissingFactError('Checkbox/radio answer requires explicit boolean evidence');await field.setChecked(value==='true');}
    else if(control.tag==='SELECT'){const candidates=control.options.filter(o=>o.value===value||o.text===value);if(candidates.length!==1)throw Error('Approved option not uniquely available');await field.selectOption(candidates[0].value);}
    else if(control.role==='combobox')await fillCombobox(this.page!,field,value);else throw Error('choose_option requires a select, combobox, checkbox or radio');
   }else{if(!['INPUT','TEXTAREA'].includes(control.tag)||control.role==='combobox'||['checkbox','radio'].includes(control.type))throw Error('Use choose_option for this control');await field.fill(value);}
   await this.remember(control.id);return {result:'Approved answer entered'};
  }
  if(action.name==='upload_resume'){
   if(control.type!=='file'||!(/resume|curriculum|\bcv\b/i.test(control.label+' '+((control as any).domId||''))))throw new MissingFactError('Only a resume upload is supported; other required documents need approval');
   const kind=action.args.resume_kind!;if(kind!==(this.job.resume||'distributed-systems'))throw new PolicyError('Resume selection differs from the existing approved job category');
   await field.setInputFiles(approvedResume(this.profile,kind,this.options.resumeRoot||resolve('resumes')));this.uploaded=true;await this.remember(control.id);return {result:`Uploaded approved ${kind} resume`};
  }
  if(action.name==='click'){
   if(!['BUTTON','INPUT'].includes(control.tag)&&control.role!=='button')throw new PolicyError('Only observed buttons can be clicked');
   const final=control.submit||/submit|\bapply\b|send (?:my )?application|finish|complete (?:my )?application/i.test(control.label);
   if(final){
    if(control.submit&&this.config.navigationLabels.includes(control.label.trim().toLowerCase()))throw new MissingFactError('Native-submit navigation requires a verified adapter; cannot assume it is only an intermediate step');
    await this.verifyRemembered();
    for(const c of this.observation!.controls){if(c.disabled||this.observedValues.has(c.id)||!c.value||(['checkbox','radio'].includes(c.type)&&c.value==='false')||/decline|prefer not to|do not wish/i.test(c.value))continue;if(['checkbox','radio'].includes(c.type)||c.tag==='TEXTAREA'||requiredSlot(c))throw Error('Unapproved prefilled/default answer must be verified with evidence: '+c.label);}
    const form=field.locator('xpath=ancestor::form[1]');if(await form.count()!==1)throw new MissingFactError('Submission button must belong to exactly one form');
    const approved=await this.currentApproved();const missing=await validateRequired(form,approved);if(missing.length)throw Error('Required fields remain incomplete: '+missing.join(', '));
    if(!this.uploaded)throw Error('Upload the selected approved resume before completing this application');
    if(!this.options.live)return {terminal:'dry_run_ready',result:'Stopped before final submit; no submission was clicked'};
    const adapter=this.policy.adapters.find(a=>a.hosts.includes(new URL(this.page!.url()).hostname));if(!adapter)throw new PolicyError('No configured confirmation rule for this employer');
    await this.page!.locator('form[data-agent-final-form]').evaluateAll(forms=>forms.forEach(f=>f.removeAttribute('data-agent-final-form')));await form.evaluate(f=>f.setAttribute('data-agent-final-form','true'));
    const approval:Approval={...adapter,url:this.job.url,reviewed:true,fields:{},formSelector:'form[data-agent-final-form=true]',submitSelector:`[data-agent-node="${this.prefix}-${control.id}"]`};
    const result=await executeSubmission(this.page!,this.job,this.store,approval,join(this.directory,'confirmation.png'),approved,{once:this.options.once,allowLocalTestSubmission:this.options.localFixture,onReserved:()=>{this.submissionArmed=true;}});return {terminal:'submitted',result};
   }
   if(!this.config.navigationLabels.includes(control.label.trim().toLowerCase()))throw new MissingFactError('Unsupported navigation button; cannot infer consent or application side effects');
   if(control.formAction){const target=new URL(control.formAction,this.page!.url());if(!this.allowedOrigins().has(target.origin))throw new PolicyError('Form navigation targets an unapproved origin');}
   await field.click();await this.page!.waitForLoadState('domcontentloaded');return {result:'Navigation button clicked'};
  }
  throw new PolicyError('Unsupported tool');
 }
 async remember(id:string){const field=this.locator(id);const value=await field.evaluate(e=>{const c=e as HTMLInputElement;return c.type==='checkbox'||c.type==='radio'?String(c.checked):e.getAttribute('data-agent-selected-label')||c.value||'';});this.observedValues.set(id,value);this.approvedSelectors.add(`[data-agent-node="${this.prefix}-${id}"]`);}
 async currentApproved(){const selectors:string[]=[];for(const id of this.observedValues.keys()){const field=this.locator(id);if(await field.count()!==1)continue;selectors.push(`[data-agent-node="${this.prefix}-${id}"]`);const key=await field.getAttribute('data-agent-field');if(key!==null)selectors.push(`[data-agent-field="${key}"]`);}return selectors;}
 async verifyRemembered(){for(const [id,expected] of this.observedValues){const field=this.locator(id);if(await field.count()!==1)continue;const actual=await field.evaluate(e=>{const c=e as HTMLInputElement;return c.type==='checkbox'||c.type==='radio'?String(c.checked):e.getAttribute('data-agent-selected-label')||c.value||'';});if(actual!==expected)throw Error('An entered answer changed before submission; re-observe and reapply approved evidence to '+id);}}
 async screenshot(name='final.png'){if(!this.page)return undefined;const path=join(this.directory,name);await this.page.screenshot({path,fullPage:true});return path;}
 async close(){await this.context?.close();}
}
