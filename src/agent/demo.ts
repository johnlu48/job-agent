import {resolve} from 'node:path';
import {unfamiliarForm} from './fixture.ts';
import {demoSetup} from './demo-support.ts';
import {DemoModel} from './mock-demo-model.ts';
import {agentConfig} from './config.ts';
import {runBrowserAgent} from './controller.ts';
const fixture=await unfamiliarForm({injection:true});const setup=demoSetup(fixture.url,resolve('data/agent-demo',String(Date.now())));
try{
 const actual=process.argv.includes('--openai');
 const model=actual?new(await import('./model.ts')).ResponsesModel():new DemoModel();
 const config=actual?agentConfig():setup.config;
 console.log(actual?'Responses API model, synthetic local form, forced dry-run.':'EXPLICIT MOCK MODEL demonstration; no OpenAI requests. Same real controller and Playwright executor.');
 const result=await runBrowserAgent(setup.job,setup.store,setup.profile,setup.policy,config,model,setup.facts,{...setup.options,live:false});
 console.log(JSON.stringify({...result,localSubmissions:fixture.count()},null,2));
 if(result.status!=='dry_run_ready'||fixture.count()!==0)process.exitCode=1;
}finally{setup.store.close();await fixture.close();}
