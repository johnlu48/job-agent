import type {Job} from '../core.ts';
export interface Evidence {id:string;value:string;source:'profile'|'background'|'resume'|'policy'|'provenance';topic:string;aliases?:string[];resumeKind?:string}
export interface EvidenceRef {id:string;quote:string}
export interface AgentConfig {model:string;maxSteps:number;maxRepeatedActions:number;maxTokens:number;maxUsd:number;maxOutputTokens:number;inputUsdPerMillion:number;outputUsdPerMillion:number;minFitScore:number;screenshots:boolean;allowedOrigins:string[];allowedDraftUrls?:string[];requireRobots:boolean;navigationLabels:string[]}
export interface Control {id:string;tag:string;type:string;role:string;label:string;context:string;value:string;required:boolean;disabled:boolean;options:{value:string;text:string}[];href:string;formAction:string;submit:boolean;invalid:boolean}
export interface Observation {revision:string;fingerprint:string;url:string;title:string;text:string;controls:Control[];validationMessages:string[];restrictions:string[];screenshot?:string}
export interface ModelResponse {id:string;output:Record<string,any>[];output_text?:string;usage:{input_tokens:number;output_tokens:number};status?:string}
export interface ModelRequest {model:string;instructions:string;input:Record<string,any>[];tools?:Record<string,any>[];text?:Record<string,any>;max_output_tokens:number;parallel_tool_calls:false;store:false}
export interface ModelGateway {respond(request:ModelRequest):Promise<ModelResponse>}
export type ToolName='inspect_page'|'fill_field'|'choose_option'|'click'|'upload_resume'|'stop_for_missing_fact';
export interface Action {name:ToolName;args:{rationale:string;target_id?:string;revision?:string;value?:string;evidence?:EvidenceRef[];resume_kind?:string;question?:string}}
export interface SemanticEvaluation {fit:'strong'|'possible'|'weak';score:number;summary:string;required_qualifications:{requirement:string;job_quote:string;assessment:'supported'|'unknown'|'gap';evidence:EvidenceRef[]}[];missing_facts:string[]}
export interface AgentResult {status:string;jobId:string;runId:string;steps:number;inputTokens:number;outputTokens:number;estimatedUsd:number;logPath:string;screenshot?:string;error?:string;confirmationUrl?:string;evaluation?:SemanticEvaluation}
export class MissingFactError extends Error {}
export class PolicyError extends Error {}
export class BudgetError extends Error {}
export const shortJob=(job:Job)=>({id:job.id,company:job.company,title:job.title,location:job.location,description:job.description.slice(0,20000),compensation:job.compensation,salary:job.salary,flags:job.flags});
