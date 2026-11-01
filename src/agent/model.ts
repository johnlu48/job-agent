import OpenAI from 'openai';
import type {ModelGateway,ModelRequest,ModelResponse} from './types.ts';
export class ResponsesModel implements ModelGateway{
 client:OpenAI;
 secret?:string;
 constructor(env:NodeJS.ProcessEnv=process.env,client?:OpenAI){if(!client&&!env.OPENAI_API_KEY)throw Error('Set OPENAI_API_KEY in the environment; it is never read from a page or profile');this.secret=env.OPENAI_API_KEY;this.client=client||new OpenAI({apiKey:env.OPENAI_API_KEY,maxRetries:0,timeout:45000});}
 async respond(request:ModelRequest):Promise<ModelResponse>{
  try{
  const response=await this.client.responses.create({model:request.model,instructions:request.instructions,input:request.input as any,tools:request.tools as any,text:request.text as any,tool_choice:request.tools?.length?'required':undefined,include:['reasoning.encrypted_content'],max_output_tokens:request.max_output_tokens,parallel_tool_calls:false,store:false});
  if(!response.usage)throw Error('Responses API did not return token usage; stopping for budget safety');
  return {id:response.id,status:response.status,output:response.output as any,output_text:response.output_text,usage:{input_tokens:response.usage.input_tokens,output_tokens:response.usage.output_tokens}};
  }catch(e){const message=String(e);throw Error(this.secret?message.split(this.secret).join('[redacted API key]'):message);}
 }
}
