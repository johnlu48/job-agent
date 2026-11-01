import type { Page } from 'playwright';
import type { Approval, Profile } from './apply.ts';
import { rank, relevant, type Job, type Store, day, DAILY_CAP } from './core.ts';
import { exportReport } from './report.ts';
import {controls,normalizeLabel} from './forms.ts';
import {automaticAnswer,type RoutineAutomation} from './automatic-answers.ts';
export interface SharedAnswer { labels:string[]; value:string|boolean; approved:boolean;jobIds?:string[];fieldIds?:string[] }
export interface SharedPolicy {
 enabled:boolean; minScore:number; allowMissingSalary:boolean; answers:SharedAnswer[];
 automation?:RoutineAutomation;
 adapters:{ hosts:string[]; formSelector:string; resumeSelector:string; submitSelector:string; confirmationSelector:string; confirmationText:string;confirmationPattern?:string }[];
}
export const normalize=normalizeLabel;
export function eligible(job:Job,policy:SharedPolicy){const j=rank(job);return relevant(j)&&!j.flags?.includes('APPLICATION_URL_UNRESOLVED')&&!j.flags?.includes('LOCATION_REVIEW')&&j.score!>=policy.minScore&&(policy.allowMissingSalary||!j.flags?.includes('SALARY_MISSING'));}
export async function sharedApproval(page:Page,job:Job,policy:SharedPolicy,profile?:Profile):Promise<Approval>{
 if(!policy.enabled)throw Error('Shared application policy is not enabled');
 if(!eligible(job,policy))throw Error('Job does not match shared targeting policy');
 const host=new URL(page.url()).hostname;const adapters=policy.adapters.filter(a=>a.hosts.includes(host));
 if(adapters.length!==1)throw Error(`No unique shared adapter for ${host}`);
 const a=adapters[0];const form=page.locator(a.formSelector);
 if(await form.count()!==1)throw Error('Shared adapter requires exactly one form');
 const fieldsOnPage=await controls(form);
 const fields:Record<string,string|boolean>={};const missing:string[]=[];const automaticAnswers:{selector:string;label:string;rule:string}[]=[];
 for(const c of fieldsOnPage){
  if(c.disabled||['hidden','submit','button','reset'].includes(c.type))continue;
  if(c.mirrorOf)continue; // Its actual validity is checked after the controller is selected.
  if(c.type==='file'){if(c.required&&!(await form.locator(c.selector).evaluate((el,s)=>el.matches(s),a.resumeSelector)))missing.push(c.label||'Additional required upload');continue;}
  const matches=policy.answers.filter(ans=>ans.approved&&(!ans.jobIds||ans.jobIds.includes(job.id))&&(!ans.fieldIds||ans.fieldIds.includes(c.id))&&ans.labels.some(l=>normalize(l)===normalize(c.label)));
  if(matches.length===0){const generated=automaticAnswer(c,job,policy.automation);if(generated){matches.push({labels:[c.label],value:generated.value,approved:true});automaticAnswers.push({selector:c.selector,label:c.label,rule:generated.rule});}}
  if(matches.length!==1||!c.label||['radio','password'].includes(c.type)){if(c.required)missing.push(c.label||c.selector);continue;}
  let value=matches[0].value;
  if(typeof value==='string'&&/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value)){const resolved=profile?.values[value.slice(1)];if(resolved===undefined)throw Error(`Missing approved personal value for ${c.label}`);value=resolved;}
  if(c.tag==='SELECT'&&typeof value==='string'){
   const answer=value;const options=c.options.filter(o=>o.value===answer||normalize(o.text)===normalize(answer));
   if(options.length!==1){missing.push(c.label+' (ambiguous or missing option)');continue;}value=options[0].value;
  }
  fields[c.selector]=value;
 }
 if(missing.length)throw Error('Missing required shared answers: '+missing.join('; '));
 return {url:job.url,reviewed:true,fields,automaticAnswers,...a};
}
export async function batch(store:Store,policy:SharedPolicy,run:(j:Job)=>Promise<unknown>,limit=DAILY_CAP,fillDailyQuota=false){
 if(!policy.enabled)throw Error('Enable the shared policy after approving reusable answers');
 if(!Number.isInteger(limit)||limit<1||limit>DAILY_CAP)throw Error(`Batch limit must be 1 through ${DAILY_CAP}`);
 const results:{id:string;status:string;result?:unknown;error?:string}[]=[];
 for(const j of store.jobs()){
  if(!fillDailyQuota&&results.length>=limit)break;
  if(!eligible(j,policy)||store.application(j.id))continue;
  if((store.db.prepare('SELECT count(*) n FROM applications WHERE day=?').get(day()) as any).n>=DAILY_CAP)break;
  try{const result=await run(j);const r=result as any;store.result(j.id,r?.status||'completed','',r?.screenshot||null,r?.url||null);results.push({id:j.id,status:'completed',result});}
  catch(e){const previous=store.db.prepare('SELECT screenshot FROM application_results WHERE job_id=?').get(j.id) as any;store.result(j.id,'blocked',String(e),previous?.screenshot||null);store.log('batch_blocked',j.id,String(e));results.push({id:j.id,status:'blocked',error:String(e)});}
  finally{exportReport(store);}
 }
 return results;
}
