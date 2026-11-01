import {mkdirSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store,rank} from '../core.ts';
import type {SharedPolicy} from '../shared.ts';
import {profileEvidence} from './evidence.ts';
import type {AgentConfig} from './types.ts';
export function demoSetup(url:string,root=mkdtempSync(join(tmpdir(),'runtime-agent-'))){
 mkdirSync(root,{recursive:true});const resumeRoot=join(root,'resumes');mkdirSync(resumeRoot,{recursive:true});const resume=join(resumeRoot,'synthetic.txt');writeFileSync(resume,'SYNTHETIC LOCAL FIXTURE RESUME. AWS distributed systems. Not for real applications.');
 const profile={values:{fullName:'SYNTHETIC PERSON',displayName:'Synthetic Person',workAuthorizationUS:'Yes',requiresSponsorship:'No',technicalBackground:'Built AWS distributed systems.'},resumes:{'distributed-systems':resume,'ai-platform':resume}};
 const facts=profileEvidence(profile);const job=rank({id:'local:agent-demo',company:'LOCAL SYNTHETIC EMPLOYER',title:'Senior Backend Engineer',description:'Build AWS distributed systems services.',location:'Austin, TX',url,resume:'distributed-systems'});
 const policy:SharedPolicy={enabled:true,minScore:0,allowMissingSalary:true,answers:[{labels:['Full name'],value:'$displayName',approved:true}],adapters:[{hosts:['127.0.0.1'],formSelector:'form',resumeSelector:'input[type=file]',submitSelector:'button[type=submit]',confirmationSelector:'.success',confirmationText:'Application received'}]};
 const config:AgentConfig={model:'MOCK-local-test-only',maxSteps:25,maxRepeatedActions:2,maxTokens:200000,maxUsd:2,maxOutputTokens:1000,inputUsdPerMillion:1,outputUsdPerMillion:2,minFitScore:50,screenshots:false,allowedOrigins:[],requireRobots:true,navigationLabels:['next','continue','back','previous','review','review application','save and continue']};
 const store=new Store(join(root,'agent.sqlite'));store.save(job);
 return {root,resumeRoot,profile,facts,job,policy,config,store,options:{headless:true,session:join(root,'browser'),resumeRoot,localFixture:true}};
}
