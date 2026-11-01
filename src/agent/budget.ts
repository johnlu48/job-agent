import {BudgetError,type AgentConfig,type ModelGateway,type ModelRequest,type ModelResponse} from './types.ts';
export class Budget {
 inputTokens=0;outputTokens=0;estimatedUsd=0;
 constructor(publicConfig:AgentConfig){this.config=publicConfig;}
 config:AgentConfig;
 async call(model:ModelGateway,request:ModelRequest):Promise<ModelResponse>{
  // UTF-8 bytes conservatively bound text tokenization; include tool schemas, history and framing.
  const upperInput=Buffer.byteLength(JSON.stringify(request),'utf8')+2048;
  const reserve=upperInput*this.config.inputUsdPerMillion/1e6+request.max_output_tokens*this.config.outputUsdPerMillion/1e6;
  if(this.inputTokens+this.outputTokens+upperInput+request.max_output_tokens>this.config.maxTokens||this.estimatedUsd+reserve>this.config.maxUsd)throw new BudgetError('Per-application token or dollar budget would be exceeded; no request sent');
  let response:ModelResponse;
  try{response=await model.respond(request);}catch(e){this.inputTokens+=upperInput;this.outputTokens+=request.max_output_tokens;this.estimatedUsd+=reserve;throw e;}
  const usage=response.usage;if(!usage||!Number.isInteger(usage.input_tokens)||!Number.isInteger(usage.output_tokens)||usage.input_tokens<0||usage.output_tokens<0)throw new BudgetError('Invalid model usage; cannot account for this request');
  this.inputTokens+=usage.input_tokens;this.outputTokens+=usage.output_tokens;this.estimatedUsd+=(usage.input_tokens*this.config.inputUsdPerMillion+usage.output_tokens*this.config.outputUsdPerMillion)/1e6;
  if(usage.input_tokens>upperInput||usage.output_tokens>request.max_output_tokens||this.inputTokens+this.outputTokens>this.config.maxTokens||this.estimatedUsd>this.config.maxUsd)throw new BudgetError('Reported usage exceeded the reserved budget; stopping immediately');
  if(response.status&&response.status!=='completed')throw Error(`Model response was ${response.status}; no action executed`);
  return response;
 }
}
