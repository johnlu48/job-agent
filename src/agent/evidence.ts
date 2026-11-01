import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,relative,extname,isAbsolute} from 'node:path';
import type {Profile} from '../apply.ts';
import type {Job} from '../core.ts';
import type {SharedPolicy} from '../shared.ts';
import {normalizeLabel} from '../forms.ts';
import {automaticAnswer} from '../automatic-answers.ts';
import {MissingFactError,PolicyError,type Evidence,type EvidenceRef,type Control,type Observation} from './types.ts';
export function approvedResume(profile:Profile,kind:string,root=resolve('resumes')){
 if(!['distributed-systems','ai-platform'].includes(kind)||!profile.resumes[kind])throw new PolicyError('Unapproved resume category');
 const base=realpathSync(root),path=realpathSync(resolve(profile.resumes[kind]));const rel=relative(base,path);
 if(rel.startsWith('..')||isAbsolute(rel)||!['.pdf','.txt'].includes(extname(path).toLowerCase())||statSync(path).size>8*1024*1024)throw new PolicyError('Resume path, extension or size is outside the approved resume boundary');
 return path;
}
export function profileEvidence(profile:Profile):Evidence[]{return Object.entries(profile.values).filter(([key,v])=>!/password|secret|token|api.?key|credential|ssn|social.?security|passport|bank|credit.?card/i.test(key)&&typeof v==='string'&&v.trim()).map(([key,value])=>({id:`profile:${key}`,value,source:'profile',topic:key}));}
export async function loadEvidence(profile:Profile,resumeRoot=resolve('resumes')):Promise<Evidence[]>{
 const evidence=profileEvidence(profile);
 for(const kind of ['distributed-systems','ai-platform']){
  const path=approvedResume(profile,kind,resumeRoot);let lines:string[]=[];
  if(extname(path).toLowerCase()==='.txt')lines=readFileSync(path,'utf8').split(/\r?\n/);
  else{
   const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
   const document=await pdfjs.getDocument({data:new Uint8Array(readFileSync(path)),useSystemFonts:true,disableFontFace:true}).promise;
   try{if(document.numPages>8)throw new PolicyError('Approved resume exceeds eight-page extraction limit');for(let page=1;page<=document.numPages;page++){
    const content=await(await document.getPage(page)).getTextContent();let text='';for(const item of content.items){if('str' in item)text+=item.str+(item.hasEOL?'\n':' ');}lines.push(...text.split(/\n/));
   }}finally{await document.destroy();}
  }
  lines.filter(s=>s.trim().length>=3).slice(0,250).forEach((line,i)=>evidence.push({id:`resume:${kind}:${i+1}`,value:line.trim().slice(0,2500),source:'resume',topic:'professional',resumeKind:kind}));
 }
 return evidence;
}
export function observationEvidence(base:Evidence[],observation:Observation,job:Job,policy:SharedPolicy):Evidence[]{
 const result=[...base];for(const c of observation.controls){
  const matches=policy.answers.filter(a=>a.approved&&(!a.jobIds||a.jobIds.includes(job.id))&&(!a.fieldIds||a.fieldIds.includes(c.id)||a.fieldIds.includes((c as any).domId))&&a.labels.some(l=>normalizeLabel(l)===normalizeLabel(c.label)));
  let value:string|boolean|undefined;
  if(matches.length===1){value=matches[0].value;if(typeof value==='string'&&/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value))value=base.find(f=>f.id===`profile:${String(value).slice(1)}`)?.value;}
  else if(matches.length===0)value=automaticAnswer(c,job,policy.automation)?.value;
  if(value===undefined&&/currently live.*(?:relocate|job.*location)/i.test(c.label)&&/\baustin\b/i.test(job.location)&&base.some(f=>f.id==='profile:city'&&/^austin$/i.test(f.value.trim())))value='Yes';
  if(value===undefined&&!c.required&&c.type==='checkbox'&&/marketing|newsletter|talent (?:pool|community)/i.test(c.label+' '+c.context))value='false';
  if(value!==undefined)result.push({id:`answer:${c.id}`,value:String(value),source:'policy',topic:`control:${c.id}`});
 }
 return result;
}
export function checkReferences(refs:EvidenceRef[],facts:Evidence[]){
 if(!refs.length)throw new MissingFactError('An answer requires approved evidence references');
 return refs.map(ref=>{const fact=facts.find(f=>f.id===ref.id);if(!fact||!ref.quote.trim()||!fact.value.includes(ref.quote))throw new MissingFactError('Evidence reference is missing or its quote is not present in the approved source');return {fact,quote:ref.quote};});
}
export function requiredSlot(control:Control):string|undefined{
 const q=normalizeLabel(control.label);
 if(/^(?:yes|no|answer|response|select|choose)?$/.test(q))return '__unidentified_question';
 if(/preferred.*name/.test(q))return 'preferredName';
 if(/first.*name|given name/.test(q))return 'firstName';if(/last.*name|family name|surname/.test(q))return 'lastName';if(/full.*name|legal name|^name$/.test(q))return 'fullName';
 if(/email/.test(q))return 'email';if(/phone|mobile number/.test(q))return 'phone';
 if(/sponsor/.test(q))return 'requiresSponsorship';if(/citizen|nationality/.test(q))return 'citizenship';if(/authori[sz].*work|legally.*work/.test(q))return 'workAuthorizationUS';
 if(/hispanic|latino/.test(q))return 'hispanicOrLatino';if(/race|ethnicity/.test(q))return 'raceCategory';if(/gender|sex\b/.test(q))return 'gender';if(/veteran/.test(q))return 'veteranStatus';if(/disabilit|medical/.test(q))return 'disabilityStatus';
 if(/convict|criminal|clearance|government.*eligib|export control|previously.*employ|current.*employee/.test(q))return '__unknown_legal_fact';
 if(/social security|\bssn\b|passport|bank account|credit card|date of birth|birthdate|\bage\b/.test(q))return '__unsupported_sensitive_identifier';
 if(/salary|compensation/.test(q))return /total/.test(q)?'totalCompensationExpectation':'baseSalaryExpectation';
 if(/currently live.*relocate|willing.*relocate/.test(q))return 'relocationPreference';
 if(/willing.*hybrid|hybrid.*schedule/.test(q))return 'hybridAcceptable';if(/willing.*onsite|work.*on.site/.test(q))return 'onsiteAcceptable';
 if(/years/.test(q)){
  if(/rust|java|python|aws|dynamodb|typescript|golang|kubernetes|\bgo\b/.test(q))return '__unknown_technology_years';
  return /including internships|count internships/.test(q)?'yearsExperienceIncludingInternships':'yearsProfessionalExcludingInternships';
 }
 if(/country/.test(q))return 'country';if(/location.*city/.test(q))return 'applicationLocation';if(/city/.test(q))return 'city';
 return undefined;
}
export function groundAnswer(control:Control,value:string,refs:EvidenceRef[],facts:Evidence[]){
 const verified=checkReferences(refs,facts);const slot=requiredSlot(control);
 if(!slot&&/^(?:yes|no|true|false)$/i.test(value.trim())&&!verified.some(r=>r.fact.source==='policy'&&r.fact.topic===`control:${control.id}`))throw new MissingFactError('A boolean screening answer needs an approved answer for this exact question; unrelated Yes/No facts cannot support it');
 if(/authori[sz]|sponsor|citizen/.test(control.label.toLowerCase())&&/canada|united kingdom|\buk\b|germany|australia/.test(control.label.toLowerCase()))throw new MissingFactError('Country-specific legal eligibility is not established by the approved US facts');
 if(slot&&!verified.some(r=>r.fact.id===`profile:${slot}`||(r.fact.source==='policy'&&r.fact.topic===`control:${control.id}`)))throw new MissingFactError(`Missing approved fact for ${slot}: ${control.label}`);
 if(verified.some(r=>r.fact.source==='policy'&&r.fact.topic!==`control:${control.id}`))throw new PolicyError('A scoped answer cannot be used for another field');
 if(slot&&verified.some(r=>r.quote!==r.fact.value))throw new MissingFactError('Protected personal facts must be quoted in full');
 const quotes=verified.map(r=>r.quote);const accepted=[...quotes,quotes.join(' '),quotes.join('\n')].map(s=>s.trim());
 if(!accepted.includes(value.trim()))throw new MissingFactError('Generated answer contains text not supported verbatim by its approved evidence. Supply approved wording or stop for missing fact.');
 if(control.type==='checkbox'&&!['true','false'].includes(value))throw new MissingFactError('Checkboxes require an explicit approved true/false answer');
 return value;
}
