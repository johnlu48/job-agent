export interface SubmissionSettings {enabled:boolean;singleJobIds?:string[]}
export function authorizeSubmission(settings:SubmissionSettings,jobId?:string,once=false,env:NodeJS.ProcessEnv=process.env){
 if(once&&jobId&&settings.singleJobIds?.includes(jobId))return;
 if(env.JOB_AGENT_ENABLE_SUBMISSION==='YES'&&settings.enabled)return;
 throw Error('Live submissions are disabled. A single-job permit requires apply <permitted-job-id> --submit-once; bulk mode requires enabled=true and JOB_AGENT_ENABLE_SUBMISSION=YES.');
}
