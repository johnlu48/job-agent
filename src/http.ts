export interface DiscoveryOptions {fetch?:typeof fetch;sleep?:(ms:number)=>Promise<void>;onAttempt?:(url:string)=>void;onRetry?:(message:string)=>void;onWarning?:(message:string)=>void;onNotice?:(message:string)=>void;enforceAccess?:boolean}
export function safeUrl(value:string){try{const u=new URL(value);for(const k of [...u.searchParams.keys()])if(/app_id|app_key|api_key|token|secret/i.test(k))u.searchParams.set(k,'REDACTED');return u.href;}catch{return '[invalid URL]';}}
export function errorText(e:unknown):string{if(!(e instanceof Error))return 'Discovery failed';const cause=e.cause as any;const code=cause?.code||(cause?.errors||[]).map((x:any)=>x.code).filter(Boolean).join(',');return `${e.name==='Error'?'':e.name+': '}${e.message.replace(/https?:\/\/[^\s]+/g,safeUrl)}${code?` (${code})`:''}`;}
class HttpError extends Error{status:number;retryAfter:number;constructor(status:number,url:string,retryAfter=0){super(`HTTP ${status}: ${safeUrl(url)}`);this.status=status;this.retryAfter=retryAfter;}}
export async function getJSON(url:string,options:DiscoveryOptions={},rateLimit?:()=>Promise<void>):Promise<any>{
 const request=options.fetch||globalThis.fetch;const sleep=options.sleep||((ms:number)=>new Promise<void>(r=>setTimeout(r,ms)));
 for(let attempt=1;attempt<=3;attempt++){
  try{await rateLimit?.();options.onAttempt?.(safeUrl(url));const r=await request(url,{signal:AbortSignal.timeout(30000),redirect:'error'});if(!r.ok){const header=r.headers.get('retry-after');const seconds=Number(header);const after=header?(Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(header)-Date.now())):0;throw new HttpError(r.status,url,after);}return await r.json();}
  catch(e){const retryable=e instanceof HttpError?[408,500,502,503,504,...(rateLimit?[429]:[])].includes(e.status):e instanceof TypeError||(e instanceof Error&&['TimeoutError','AbortError'].includes(e.name));if(!retryable||attempt===3)throw new Error(errorText(e));
   const delay=e instanceof HttpError&&e.retryAfter?e.retryAfter:500*attempt;
   // Do not retry before a long provider cooldown; let the next run handle it.
   if(delay>60000)throw new Error(`Provider cooldown exceeds this run's retry window: ${errorText(e)}`);
   options.onRetry?.(`Attempt ${attempt} failed: ${errorText(e)}; retrying in ${delay}ms`);await sleep(delay);
  }
 }
 throw Error('Discovery retry loop exhausted');
}
