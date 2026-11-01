import { chromium } from 'playwright';
import { type Job, relevant, rank, Store } from './core.ts';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {getJSON,errorText,type DiscoveryOptions} from './http.ts';
import {discoverFeed} from './public-feeds.ts';
import {accessControlledFetch} from './access.ts';
import {canonicalUrl} from './identity.ts';
export {getJSON} from './http.ts';
export interface Source {type:'greenhouse'|'lever'|'ashby'|'career'|'remoteok'|'arbeitnow'|'smartrecruiters';company:string;board?:string;url?:string;linkPattern?:string;enabled?:boolean;reason?:string;careersUrl?:string;maxPages?:number;pageSize?:number;verifiedUrl?:string;verifiedAt?:string}
export async function discover(s:Source,options:DiscoveryOptions={}):Promise<Job[]>{
 if(s.enabled===false)return [];
 if(['remoteok','arbeitnow','smartrecruiters'].includes(s.type)){const jobs:Job[]=[];for await(const job of discoverFeed(s as any,options))jobs.push(job);return jobs;}
 if(!s.company||!['greenhouse','lever','ashby','career'].includes(s.type))throw Error('Invalid discovery source configuration');
 if(s.type==='career'?!s.url:!s.board)throw Error(`Missing ${s.type==='career'?'url':'board'} for ${s.company}`);
 const get=(url:string)=>getJSON(url,options);
 const b=encodeURIComponent(s.board||'');let rows:any[]=[];
 if(s.type==='greenhouse'){const d=await get(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`);rows=d.jobs.map((j:any)=>({id:j.id,requisitionId:j.requisition_id,title:j.title,location:j.location.name,url:j.absolute_url,description:j.content}));}
 if(s.type==='lever'){const d=await get(`https://api.lever.co/v0/postings/${b}?mode=json`);rows=d.map((j:any)=>({id:j.id,title:j.text,location:[j.categories.location,j.workplaceType].filter(Boolean).join(' '),url:j.hostedUrl,description:j.descriptionPlain+' '+(j.lists||[]).map((l:any)=>l.content).join(' ')+' '+(j.salaryDescription||''),compensation:j.salaryRange}));}
 if(s.type==='ashby'){const d=await get(`https://api.ashbyhq.com/posting-api/job-board/${b}?includeCompensation=true`);rows=d.jobs.map((j:any)=>({id:j.id,requisitionId:j.externalJobId,title:j.title,location:[j.location,...(j.secondaryLocations||[]).map((x:any)=>x.location)].join(' '),url:j.applyUrl||j.jobUrl,description:j.descriptionPlain,compensation:j.compensation}));}
 if(s.type==='career'){
  const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();const response=await page.goto(s.url!,{waitUntil:'domcontentloaded'});if(response&&response.status()>=400)throw Error(`Career page HTTP ${response.status()}`);if(/captcha|access denied|verify you are human/i.test(await page.innerText('body')))throw Error('Website restriction: manual review required');
  const links=await page.locator('a[href]').evaluateAll(as=>as.map(a=>({url:(a as HTMLAnchorElement).href,title:(a.textContent||'').trim()})));
  for(const l of links.filter(l=>new RegExp(s.linkPattern||'jobs|careers|positions').test(l.url)&&relevant({...l} as Job)).slice(0,30)){await page.goto(l.url,{waitUntil:'domcontentloaded'});rows.push({id:l.url,title:l.title,location:'Unknown',url:l.url,description:await page.innerText('body')});}
 }finally{await browser.close();}}
 return rows.map(j=>rank({...j,id:`${s.type}:${s.board||s.company}:${j.id}`,company:s.company,source:s.type,sourceJobId:String(j.id),applicationUrl:j.url,applicationUrlStatus:'direct',canonicalUrl:canonicalUrl(j.url)})).filter(relevant);
}
export interface SourceResult {provider:string;company:string;status:'success'|'partial_success'|'failure'|'skipped';matched:number;persisted:number;attempts:number;errors:string[];reason?:string}
export interface DiscoverySummary {status:'success'|'partial_success'|'failure';exitCode:0|1|2;startedAt:string;finishedAt:string;succeeded:number;failed:number;partial:number;skipped:number;persisted:number;sources:SourceResult[]}
export async function discoverAll(sources:Source[],store:Store,options:DiscoveryOptions={}):Promise<DiscoverySummary>{
 const startedAt=new Date().toISOString();const results:SourceResult[]=[];
 const request=options.enforceAccess===false?(options.fetch||globalThis.fetch):accessControlledFetch(options,store.reportDirectory);
 for(const s of sources){
  const result:SourceResult={provider:s.type,company:s.company,status:'failure',matched:0,persisted:0,attempts:0,errors:[]};results.push(result);
  if(s.enabled===false){result.status='skipped';result.reason=s.reason||'Disabled in source configuration';store.log('discovery_skipped',s.company,result.reason);console.log(`${s.company}: skipped (${result.reason})`);continue;}
  try{
   const sourceOptions:DiscoveryOptions={...options,fetch:request,onNotice:message=>{store.log('discovery_terms',s.company,message);options.onNotice?.(message);},onAttempt:url=>{result.attempts++;options.onAttempt?.(url);},onRetry:message=>{store.log('discovery_retry',s.company,message);options.onRetry?.(message);},onWarning:message=>{result.errors.push(message);store.log('discovery_warning',s.company,message);options.onWarning?.(message);}};
   const jobs=['remoteok','arbeitnow','smartrecruiters'].includes(s.type)?discoverFeed(s as any,sourceOptions):await discover(s,sourceOptions);
   for await(const job of jobs){result.matched++;try{store.save(job);result.persisted++;}catch(e){const error=`Persist ${job.id}: ${errorText(e)}`;result.errors.push(error);store.log('discovery_error',s.company,error);}}
   result.status=result.errors.length?(result.persisted?'partial_success':'failure'):'success';
   store.log('discovered',s.company,JSON.stringify(result));console.log(`${s.company}: ${result.matched} matching jobs; ${result.persisted} persisted${result.errors.length?`; ${result.errors.length} errors`:''}`);
  }catch(e){result.status=result.persisted?'partial_success':'failure';const error=errorText(e);result.errors.push(error);store.log('discovery_error',s.company,error);console.error(`${s.company}: ${error}`);}
 }
 const succeeded=results.filter(r=>r.status==='success').length,partial=results.filter(r=>r.status==='partial_success').length,failed=results.filter(r=>r.status==='failure').length,skipped=results.filter(r=>r.status==='skipped').length;
 const status:DiscoverySummary['status']=succeeded||partial?(failed||partial?'partial_success':'success'):'failure';
 const summary:DiscoverySummary={status,exitCode:status==='success'?0:status==='partial_success'?2:1,startedAt,finishedAt:new Date().toISOString(),succeeded,failed,partial,skipped,persisted:results.reduce((n,r)=>n+r.persisted,0),sources:results};
 const directory=join(store.reportDirectory,'discovery');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'latest.json'),JSON.stringify(summary,null,2)+'\n');
 const csv=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
 writeFileSync(join(directory,'sources.csv'),'\uFEFF'+['provider,employer,status,matched,persisted,requests,error_or_skip_reason',...results.map(r=>[r.provider,r.company,r.status,r.matched,r.persisted,r.attempts,r.errors.join('; ')||r.reason||''].map(csv).join(','))].join('\r\n')+'\r\n');
 store.log('discovery_summary','',JSON.stringify(summary));console.log(`DISCOVERY_SUMMARY ${JSON.stringify(summary)}`);return summary;
}
