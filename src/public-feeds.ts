import {rank,relevant,type Job} from './core.ts';
import {getJSON,type DiscoveryOptions} from './http.ts';
import {canonicalUrl,employerKey} from './identity.ts';
export interface FeedSettings {type:'remoteok'|'arbeitnow'|'smartrecruiters';company:string;board?:string;maxPages?:number;pageSize?:number}
export const clean=(s:unknown)=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
export function usEligible(location:string,description='',remote=false){
 const text=clean(location+' '+description);
 if(/(?:not (?:available|open|eligible) (?:to|in)|excluding|except) (?:the )?(?:us\b|usa\b|united states)/i.test(text))return false;
 const us=/\b(?:united states|usa|u\.s\.|us)\b/i.test(location)||/\baustin\b/i.test(location);
 const global=/\b(worldwide|anywhere|global)\b/i.test(location)||/\b(?:work|hire|hiring|open to applicants) (?:from )?anywhere\b/i.test(description);
 const explicit=/\b(?:remote (?:in|from) (?:the )?(?:us|united states)|(?:us|united states)[ -](?:based|eligible))\b/i.test(text);
 return /\baustin\b/i.test(location)||(remote&&(us||global||explicit));
}
function httpsUrl(raw:unknown){try{const u=new URL(String(raw));return u.protocol==='https:'&&!u.username&&!u.password?u.href:undefined;}catch{return;}}
function salary(raw:any):Job['salary']{const min=Number(raw.salary_min),max=Number(raw.salary_max);return (min>0||max>0)?{...(min>0?{min}:{}),...(max>0?{max}:{}),currency:typeof raw.salary_currency==='string'?raw.salary_currency:'UNSPECIFIED',period:'unspecified',kind:'salary',predicted:false}:undefined;}
function feedJob(source:string,raw:any,fields:Pick<Job,'id'|'company'|'title'|'location'|'url'|'description'>):Job{
 const link=httpsUrl(raw.apply_url);const parsed=link?new URL(link):undefined;
 const tenant=parsed?.pathname.split('/').filter(Boolean)[0];
 const valid=parsed&&['jobs.lever.co','jobs.ashbyhq.com','boards.greenhouse.io','job-boards.greenhouse.io'].includes(parsed.hostname)&&employerKey(tenant||'')===employerKey(fields.company)&&parsed.pathname.split('/').filter(Boolean).length>=2;
 return rank({...fields,source,sourceJobId:String(raw.id||raw.slug),canonicalUrl:canonicalUrl(valid?link!:fields.url),applicationUrl:valid?link:undefined,applicationUrlStatus:valid?'direct':'unresolved',postedAt:raw.date||(raw.created_at?new Date(raw.created_at*1000).toISOString():undefined),attribution:{name:source==='remoteok'?'Remote OK':'Arbeitnow',url:fields.url},salary:source==='remoteok'?salary(raw):undefined});
}
export async function* discoverFeed(s:FeedSettings,options:DiscoveryOptions={}):AsyncGenerator<Job>{
 const pages=s.maxPages??2;if(!Number.isInteger(pages)||pages<1||pages>10)throw Error('maxPages must be 1 through 10');
 if(s.type==='remoteok'){
  const data=await getJSON('https://remoteok.com/api',options);if(!Array.isArray(data))throw Error('Invalid Remote OK response');
  for(const raw of data){
   if(raw.legal){options.onNotice?.(String(raw.legal));continue;}
   if(!raw.id||!raw.company||!raw.position)continue;
   const url=httpsUrl(raw.url);if(!url)continue;const location=clean(raw.location);const description=clean(raw.description);
   if(!usEligible(location,description,true))continue;
   const job=feedJob('remoteok',raw,{id:`remoteok:${raw.id}`,company:clean(raw.company),title:clean(raw.position),location:location+' (remote; US eligible per posting)',url,description});
   // Feed apply_url is not assumed to be a legitimate employer destination.
   if(relevant(job))yield job;
  }
  return;
 }
 if(s.type==='arbeitnow'){
  for(let page=1;page<=pages;page++){
   const data=await getJSON(`https://www.arbeitnow.com/api/job-board-api?page=${page}`,options);if(!Array.isArray(data.data))throw Error('Invalid Arbeitnow response');
   for(const raw of data.data){const url=httpsUrl(raw.url);if(!url||!raw.slug||!raw.company_name||!raw.title)continue;const location=clean(raw.location),description=clean(raw.description);if(!usEligible(location,description,raw.remote===true))continue;
    const job=feedJob('arbeitnow',raw,{id:`arbeitnow:${raw.slug}`,company:clean(raw.company_name),title:clean(raw.title),location:location+(raw.remote?' (remote; US eligible per posting)':''),url,description});if(relevant(job))yield job;
   }
   if(!data.data.length||!data.links?.next)break;
  }
  return;
 }
 if(!s.board)throw Error('SmartRecruiters requires a verified company identifier');
 const size=s.pageSize??100;if(!Number.isInteger(size)||size<1||size>100)throw Error('SmartRecruiters pageSize must be 1 through 100');
 for(let page=0;page<pages;page++){
  const base=`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(s.board)}/postings`;
  const data=await getJSON(`${base}?limit=${size}&offset=${page*size}`,options);if(!Array.isArray(data.content))throw Error('Invalid SmartRecruiters response');
  for(const raw of data.content){if(!raw.id||!relevant({title:clean(raw.name)} as Job))continue;
   const detail=await getJSON(`${base}/${encodeURIComponent(raw.id)}`,options);const url=httpsUrl(detail.applyUrl||detail.postingUrl);if(!url){options.onWarning?.(`SmartRecruiters ${raw.id}: no published application/posting URL`);continue;}
   const location=[detail.location?.city,detail.location?.region,detail.location?.country,detail.location?.remote?'Remote':''].filter(Boolean).join(', ');
   const job=rank({id:`smartrecruiters:${s.board}:${raw.id}`,company:s.company,title:clean(detail.name||raw.name),location,description:clean(Object.values(detail.jobAd?.sections||{}).map((v:any)=>v.text||'').join(' ')),url,applicationUrl:url,applicationUrlStatus:'direct',canonicalUrl:canonicalUrl(url),source:'smartrecruiters',sourceJobId:String(raw.id),requisitionId:detail.refNumber,postedAt:detail.releasedDate});yield job;
  }
  if(!data.content.length||data.content.length<size||page*size+data.content.length>=data.totalFound)break;
 }
}
