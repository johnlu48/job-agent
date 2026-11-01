// Explicit test/demo double. Production CLI never selects this gateway or falls back to it.
import type {ModelGateway,ModelRequest,ModelResponse,Observation,Evidence} from './types.ts';
export class DemoModel implements ModelGateway{
 calls=0;requests:ModelRequest[]=[];
 async respond(request:ModelRequest):Promise<ModelResponse>{
  this.calls++;this.requests.push(request);
  if(request.text){const input=JSON.parse(request.input[0].content);return {id:'mock-evaluation',status:'completed',output:[],output_text:JSON.stringify({fit:'strong',score:90,summary:'The approved AWS distributed-systems fact supports this synthetic backend role.',required_qualifications:[{requirement:'AWS',job_quote:'AWS',assessment:'supported',evidence:[{id:'profile:technicalBackground',quote:input.approvedEvidence.find((f:Evidence)=>f.id==='profile:technicalBackground').value}]}],missing_facts:[]}),usage:{input_tokens:200,output_tokens:120}};}
  const content=request.input.findLast(item=>item.role==='user'&&Array.isArray(item.content))!.content as any;const payload=JSON.parse(content[0].text);const obs:Observation=payload.untrustedObservation;const facts:Evidence[]=payload.approvedEvidence;
  let name='inspect_page',args:Record<string,any>={rationale:'Inspect the current unfamiliar form.'};
  const choose=(control:any,value:string,id:string,quote=value)=>{name=control.tag==='SELECT'||control.role==='combobox'||control.type==='checkbox'?'choose_option':'fill_field';args={target_id:control.id,revision:obs.revision,value,evidence:[{id,quote}],rationale:'Use the matching approved fact and current control.'};};
  const full=obs.controls.find(c=>c.label==='Full name');
  if(full){const correction=obs.validationMessages.some(s=>s.includes('uppercase'));const fact=facts.find(f=>f.id===(correction?'profile:fullName':`answer:${full.id}`))!;if(full.value!==fact.value)choose(full,fact.value,fact.id);
   else{const next=obs.controls.find(c=>c.label==='Next')!;name='click';args={target_id:next.id,revision:obs.revision,rationale:'Continue to the next step and observe the result.'};}}
  else{
   const unknown=obs.controls.find(c=>/security clearance/i.test(c.label));if(unknown){name='stop_for_missing_fact';args={question:unknown.label,rationale:'No approved security-clearance fact exists.'};}
   else{const auth=obs.controls.find(c=>/authorized to work/.test(c.label));const sponsor=obs.controls.find(c=>/sponsorship/.test(c.label));const experience=obs.controls.find(c=>/distributed systems experience/.test(c.label));const file=obs.controls.find(c=>c.type==='file');const marketing=obs.controls.find(c=>/marketing newsletter/.test(c.label));
    if(marketing&&marketing.value==='true')choose(marketing,'false',`answer:${marketing.id}`);else if(auth&&!auth.value)choose(auth,'Yes','profile:workAuthorizationUS');else if(sponsor&&!sponsor.value)choose(sponsor,'No','profile:requiresSponsorship');else if(experience&&!experience.value)choose(experience,facts.find(f=>f.id==='profile:technicalBackground')!.value,'profile:technicalBackground');
    else if(file&&!file.value){name='upload_resume';args={target_id:file.id,revision:obs.revision,resume_kind:payload.selectedResume,rationale:'Upload only the configured approved resume.'};}
    else{const submit=obs.controls.find(c=>c.submit)!;name='click';args={target_id:submit.id,revision:obs.revision,rationale:'All observed fields are complete; ask the executor to finish under its mode and policy.'};}
   }
  }
  return {id:`mock-${this.calls}`,status:'completed',output:[{type:'function_call',call_id:`call-${this.calls}`,name,arguments:JSON.stringify(args)}],usage:{input_tokens:300,output_tokens:80}};
 }
}
