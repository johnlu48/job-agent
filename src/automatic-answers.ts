import type {Job} from './core.ts';
export interface RoutineAutomation {discoverySourceAnswer?:boolean;candidatePrivacyAcknowledgment?:boolean}
export interface Question {label:string;context:string;type:string}
export function sourceAnswer(job:Job){
 if(job.attribution?.name)return `Found on ${job.attribution.name} through my automated job search.`;
 const provider=job.source||job.id.split(':')[0];
 const names:Record<string,string>={greenhouse:'Greenhouse',lever:'Lever',ashby:'Ashby',smartrecruiters:'SmartRecruiters'};
 return names[provider]?`${job.company} careers page (${names[provider]}), found through my job-search agent.`:undefined;
}
export function automaticAnswer(question:Question,job:Job,policy:RoutineAutomation={}){
 const label=question.label.toLowerCase().replace(/[?*]/g,'').replace(/\s+/g,' ').trim();
 if(policy.discoverySourceAnswer&&['how did you hear about this job','how did you hear about us','how did you find this position','how did you hear about this position'].includes(label)){
  const value=sourceAnswer(job);if(value)return {value,rule:'discovery_source'};
 }
 const context=question.context.toLowerCase();
 const ordinaryAcknowledgment=/acknowledge|review|confirm|have read/.test(label+' '+context);
 const candidatePrivacy=/candidate(?:'s)? privacy (?:policy|notice)|applicant privacy (?:policy|notice)/.test(context);
 const unrelated=/marketing|newsletter|talent (?:pool|community)|future (?:job )?opportunities|arbitration|terms (?:of service|and conditions)|background check|certif(?:y|ication)|information.{0,20}accurate/.test(context);
 if(policy.candidatePrivacyAcknowledgment&&question.type==='checkbox'&&ordinaryAcknowledgment&&candidatePrivacy&&!unrelated)return {value:true,rule:'candidate_privacy_acknowledgment'};
 return undefined;
}
