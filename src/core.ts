import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, appendFileSync, mkdtempSync } from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {identityKeys} from './identity.ts';
import {jobLocation} from './location.ts';
export interface Job { id:string; company:string; title:string; location:string; url:string; description:string; compensation?:unknown; score?:number; resume?:string; flags?:string[]; compensationTarget?:string; reasons?:string[];source?:string;sourceJobId?:string;canonicalUrl?:string;applicationUrl?:string;applicationUrlStatus?:'direct'|'verified_redirect'|'unresolved';requisitionId?:string;postedAt?:string;contractType?:string;attribution?:{name:string;url:string};salary?:{min?:number;max?:number;currency:string;period:'year'|'unspecified';kind:'salary';predicted:boolean} }
export const DAILY_CAP=10;
export function rank(j:Job):Job {
 j={...j,location:jobLocation(j.location,j.description)};
 const text=`${j.title} ${j.description}`.toLowerCase();
 const flags:string[]=[];
 const disclosed=`${j.description} ${JSON.stringify(j.compensation||'')}`;
 if(!j.compensation&&!j.salary && !/\$[\d,]+/.test(j.description)) flags.push('SALARY_MISSING');
 if(j.salary?.predicted)flags.push('SALARY_PREDICTED');
 if(['remoteok','arbeitnow','adzuna'].includes(j.source||'')&&!j.applicationUrl)flags.push('APPLICATION_URL_UNRESOLVED');
 flags.push('TOTAL_COMPENSATION_UNVERIFIED');
 const location=/austin/i.test(j.location)||(/remote/i.test(j.location)&&/\b(us|usa|united states)\b/i.test(j.location));
 if(!location) flags.push('LOCATION_REVIEW');
 const terms=['dynamodb','aws','distributed systems','iot','orchestration','workcellai','observability','backend','infrastructure','ai platform','cloud engineering'];
 let score=terms.reduce((s,t)=>s+(text.includes(t)?8:0),0)+(location?20:0);
 if(/senior|engineer ii|sde ii/i.test(j.title)) score+=10;
 // Dollar figures are disclosed amounts, never assumed to be total compensation.
 const amounts=[...disclosed.matchAll(/\$([\d,]+)(k)?/gi)].map(m=>Number(m[1].replaceAll(',',''))*(m[2]?1000:1));
 if(j.salary&&!j.salary.predicted&&j.salary.currency==='USD')amounts.push(j.salary.min||0,j.salary.max||0);
 if(amounts.some(n=>n>=300000)) score+=20; else if(amounts.some(n=>n>=250000)) score+=10;
 return {...j,score,flags,compensationTarget:amounts.some(n=>n>=300000)?'DISCLOSED_AMOUNT_300K_PLUS_TC_REVIEW':amounts.some(n=>n>=250000)?'DISCLOSED_AMOUNT_250K_PLUS_TC_REVIEW':'TC_REVIEW_REQUIRED',reasons:terms.filter(t=>text.includes(t)),resume:/ai platform|observability|machine learning|\bllm\b/i.test(text)?'ai-platform':'distributed-systems'};
}
export function relevant(j:Job){return /\bsde ii\b|software engineer ii|senior software engineer|distributed systems|infrastructure|back[- ]?end|ai platform|cloud engineer/i.test(j.title);}
export function day(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());}
export class Store {
 db:DatabaseSync;
 reportDirectory:string;
 constructor(path='data/agent.sqlite'){mkdirSync('data',{recursive:true});this.reportDirectory=path===':memory:'?mkdtempSync(join(tmpdir(),'agent-report-')):dirname(resolve(path));this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, url TEXT UNIQUE, json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS applications(job_id TEXT PRIMARY KEY, status TEXT NOT NULL, day TEXT NOT NULL, confirmation_url TEXT, screenshot TEXT, detail TEXT);
 CREATE TABLE IF NOT EXISTS events(at TEXT, event TEXT, job_id TEXT, detail TEXT);
 CREATE TABLE IF NOT EXISTS application_results(job_id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', screenshot TEXT, confirmation_url TEXT);`);
 const columns=this.db.prepare('PRAGMA table_info(applications)').all() as any[];
 for(const column of ['submitted_at','submitted_day'])if(!columns.some(c=>c.name===column))this.db.exec(`ALTER TABLE applications ADD COLUMN ${column} TEXT`);
 this.db.exec(`CREATE TABLE IF NOT EXISTS job_identities(key TEXT PRIMARY KEY,job_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS job_aliases(alias TEXT PRIMARY KEY,canonical_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS job_sources(job_id TEXT,source TEXT,source_id TEXT,source_url TEXT,PRIMARY KEY(job_id,source,source_id));`);
 for(const row of this.db.prepare('SELECT id,json FROM jobs WHERE id NOT IN (SELECT alias FROM job_aliases)').all() as any[]){for(const key of identityKeys(JSON.parse(row.json)))this.db.prepare('INSERT OR IGNORE INTO job_identities VALUES(?,?)').run(key,row.id);}
 }
 save(j:Job){
  this.db.exec('BEGIN IMMEDIATE');try{
   const keys=identityKeys(j);const matches=new Set<string>();
   const alias=this.db.prepare('SELECT canonical_id FROM job_aliases WHERE alias=?').get(j.id) as any;
   if(alias)matches.add(alias.canonical_id);
   if(this.db.prepare('SELECT 1 FROM jobs WHERE id=?').get(j.id))matches.add(alias?.canonical_id||j.id);
   for(const key of keys){const match=this.db.prepare('SELECT job_id FROM job_identities WHERE key=?').get(key) as any;if(match)matches.add(match.job_id);}
   const ids=[...matches];const id=ids.find(id=>this.application(id))||ids[0]||j.id;
   const old=this.db.prepare('SELECT json FROM jobs WHERE id=?').get(id) as any;
   const existing:Job|undefined=old?JSON.parse(old.json):undefined;
   // Native postings carry fuller descriptions; keep the original ID so application history stays attached.
   const aggregators=['remoteok','arbeitnow','adzuna'];
   const preferExisting=existing&&!aggregators.includes(existing.source||'')&&aggregators.includes(j.source||'');
   const merged=rank({...j,...(preferExisting?existing:{}),...(!preferExisting?j:{}),id,applicationUrl:preferExisting?(existing.applicationUrl||existing.url):(j.applicationUrl||existing?.applicationUrl),requisitionId:j.requisitionId||existing?.requisitionId});
   this.db.prepare('INSERT INTO jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,json=excluded.json').run(id,existing?.url||j.url,JSON.stringify({...merged,url:existing?.url||j.url}));
   for(const previous of ids.filter(other=>other!==id)){
    this.db.prepare('UPDATE job_aliases SET canonical_id=? WHERE canonical_id=?').run(id,previous);
    this.db.prepare('INSERT INTO job_aliases VALUES(?,?) ON CONFLICT(alias) DO UPDATE SET canonical_id=excluded.canonical_id').run(previous,id);
    this.db.prepare('UPDATE job_identities SET job_id=? WHERE job_id=?').run(id,previous);
   }
   if(j.id!==id)this.db.prepare('INSERT INTO job_aliases VALUES(?,?) ON CONFLICT(alias) DO UPDATE SET canonical_id=excluded.canonical_id').run(j.id,id);
   for(const key of [...keys,...identityKeys(merged)])this.db.prepare('INSERT INTO job_identities VALUES(?,?) ON CONFLICT(key) DO UPDATE SET job_id=excluded.job_id').run(key,id);
   this.db.prepare('INSERT OR IGNORE INTO job_sources VALUES(?,?,?,?)').run(id,j.source||j.id.split(':')[0],j.sourceJobId||j.id,j.url);
   this.db.exec('COMMIT');return id;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 application(id:string){return this.db.prepare("SELECT * FROM applications WHERE job_id=? OR job_id IN (SELECT alias FROM job_aliases WHERE canonical_id=?) ORDER BY CASE status WHEN 'submitted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,day DESC LIMIT 1").get(id,id);}
 jobs():Job[]{return (this.db.prepare('SELECT json FROM jobs WHERE id NOT IN (SELECT alias FROM job_aliases)').all() as any[]).map(r=>rank(JSON.parse(r.json))).sort((a,b)=>(b.score||0)-(a.score||0));}
 reserve(id:string){this.db.exec('BEGIN IMMEDIATE');try{const alias=this.db.prepare('SELECT canonical_id FROM job_aliases WHERE alias=?').get(id) as any;id=alias?.canonical_id||id;if(this.application(id))throw Error('Duplicate or unresolved attempt; inspect status before retrying');if((this.db.prepare("SELECT count(*) n FROM applications WHERE day=?").get(day()) as any).n>=DAILY_CAP)throw Error('Daily cap reached');this.db.prepare("INSERT INTO applications(job_id,status,day) VALUES(?,'pending',?)").run(id,day());this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 result(id:string,status:string,error='',screenshot:string|null=null,url:string|null=null){this.db.prepare('INSERT INTO application_results VALUES(?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,error=excluded.error,screenshot=excluded.screenshot,confirmation_url=excluded.confirmation_url').run(id,status,new Date().toISOString(),error,screenshot,url);}
 finish(id:string,status:string,url:string|null,shot:string|null,detail:string){this.db.prepare('UPDATE applications SET status=?,confirmation_url=?,screenshot=?,detail=?,submitted_at=CASE WHEN ?=\'submitted\' THEN COALESCE(submitted_at,?) ELSE submitted_at END,submitted_day=CASE WHEN ?=\'submitted\' THEN COALESCE(submitted_day,?) ELSE submitted_day END WHERE job_id=?').run(status,url,shot,detail,status,new Date().toISOString(),status,day(),id);}
 log(event:string,id='',detail=''){this.db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(new Date().toISOString(),event,id,detail);appendFileSync(join(this.reportDirectory,'agent.log'),JSON.stringify({at:new Date().toISOString(),event,id,detail})+'\n');}
 close(){this.db.close();}
}
