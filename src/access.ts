import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {errorText,type DiscoveryOptions} from './http.ts';
const agent='JobApplicationAgent';
export function robotsPolicy(text:string,path:string){
 const groups:{agents:string[];rules:{allow:boolean;path:string}[];delay:number}[]=[];let group={agents:[] as string[],rules:[] as {allow:boolean;path:string}[],delay:0};let directed=false;
 for(const raw of text.split(/\r?\n/)){const line=raw.replace(/#.*/,'').trim();const index=line.indexOf(':');if(index<0)continue;const key=line.slice(0,index).trim().toLowerCase(),value=line.slice(index+1).trim();
  if(key==='user-agent'){if(directed){groups.push(group);group={agents:[],rules:[],delay:0};directed=false;}group.agents.push(value.toLowerCase());}
  else if(group.agents.length){directed=true;if((key==='allow'||key==='disallow')&&value)group.rules.push({allow:key==='allow',path:value});if(key==='crawl-delay'&&Number.isFinite(Number(value)))group.delay=Math.max(group.delay,Number(value)*1000);}
 }
 groups.push(group);const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&agent.toLowerCase().startsWith(a)));const selected=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
 const matches=selected.flatMap(g=>g.rules).filter(rule=>{const pattern=rule.path.replace(/[.+?^{}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');return new RegExp('^'+pattern).test(path);}).sort((a,b)=>b.path.replace(/\*/g,'').length-a.path.replace(/\*/g,'').length||Number(b.allow)-Number(a.allow));
 return {allowed:matches[0]?.allow??true,delay:Math.max(1000,...selected.map(g=>g.delay))};
}
export function accessControlledFetch(options:DiscoveryOptions,cacheRoot:string):typeof fetch{
 const request=options.fetch||globalThis.fetch;const sleep=options.sleep||((ms:number)=>new Promise<void>(r=>setTimeout(r,ms)));const robots=new Map<string,{text:string;delay:number}>(),last=new Map<string,number>(),blocked=new Map<string,Error>();
 return async(input,init)=>{
  const url=new URL(String(input));if(url.protocol!=='https:')throw Error('Discovery only permits HTTPS endpoints');
  if(blocked.has(url.origin))throw blocked.get(url.origin);
  if(!robots.has(url.origin)){
   try{
   const response=await request(url.origin+'/robots.txt',{headers:{'User-Agent':agent+'/1.0 (personal job search)'},signal:AbortSignal.timeout(15000),redirect:'error'});
   if(!response.ok&&response.status!==404)throw Error(`Cannot verify robots policy for ${url.hostname}: HTTP ${response.status}`);
   const text=response.status===404?'':await response.text();robots.set(url.origin,{text,delay:1000});last.set(url.origin,Date.now());
   }catch(e){const error=new Error(`Cannot verify robots policy for ${url.hostname}: ${errorText(e)}`);blocked.set(url.origin,error);throw error;}
  }
  const policy=robotsPolicy(robots.get(url.origin)!.text,url.pathname+url.search);if(!policy.allowed)throw Error(`robots.txt disallows ${url.origin}${url.pathname}`);
  const directory=join(cacheRoot,'http-cache');const path=join(directory,createHash('sha256').update(url.href).digest('hex')+'.json');
  const ttl=['remoteok.com','www.arbeitnow.com'].includes(url.hostname)?3600000:900000;
  if(existsSync(path)){try{const cached=JSON.parse(readFileSync(path,'utf8'));if(Date.now()-cached.at<ttl)return new Response(cached.body,{status:200,headers:{'Content-Type':'application/json'}});}catch{/* Invalid cache is refetched. */}}
  const wait=policy.delay-(Date.now()-(last.get(url.origin)||0));if(wait>0)await sleep(wait);last.set(url.origin,Date.now());
  const headers=new Headers(init?.headers);headers.set('User-Agent',agent+'/1.0 (personal job search)');headers.set('Accept','application/json');
  const response=await request(input,{...init,headers});
  if(response.ok&&response.headers.get('content-type')?.includes('json')){const body=await response.clone().text();mkdirSync(directory,{recursive:true});writeFileSync(path,JSON.stringify({at:Date.now(),body}));}
  return response;
 };
}
