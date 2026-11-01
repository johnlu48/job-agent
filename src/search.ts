import type {Store,Job} from './core.ts';
import {DAILY_CAP} from './core.ts';
import {batch,type SharedPolicy} from './shared.ts';
import {exportReport} from './report.ts';
export async function startSearch(store:Store,policy:SharedPolicy,discover:()=>Promise<unknown>,apply:(job:Job,live:boolean)=>Promise<unknown>,dryRun=false){
 if(!policy.enabled)throw Error('Shared policy must be enabled for start-search');
 try{
  const discovery=await discover();
  const results=await batch(store,policy,j=>apply(j,!dryRun),DAILY_CAP,!dryRun);
  return {mode:dryRun?'dry_run':'live',discovery,results,report:'data/applications.csv'};
 }finally{exportReport(store);}
}
