import {ApiError,TransportError,unwrap} from './client';
import type {CheckKey,ErrorDetail,EvidenceSnapshot,Outcome} from './types';
export interface SingleOutcome extends Outcome {evidence?:EvidenceSnapshot[]}
export interface SingleEvent {
 type:'start'|'preflight'|'branch'|'stage'|'result'|'complete'|'heartbeat';
 request_id?:string;at?:string;checks?:CheckKey[];branch?:CheckKey;stage?:string;chunk_key?:string;
 state?:string;attempt?:number;detail?:ErrorDetail;elapsed_ms?:number;reused?:boolean;
 outcome?:SingleOutcome;branches?:Partial<Record<CheckKey,{ready:boolean;reasons:ErrorDetail[]}>>;
}
const invalid=(message:string)=>new TransportError({code:'stream_interrupted',message,stage:'web.single',retryable:true},'',200);
export async function streamSingle(data:{description:string;diagnosis:string;checks:CheckKey[]},signal:AbortSignal,onEvent:(event:SingleEvent)=>void){
 let response:Response;
 try{response=await fetch('/api/v1/single/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal})}
 catch(e){if(signal.aborted)throw e;throw invalid('无法连接业务服务，请检查网络与服务状态')}
 if(!response.ok)throw invalid(`即时质控连接失败（HTTP ${response.status}）`);
 if(!response.headers.get('content-type')?.includes('application/x-ndjson')){
  try{unwrap(await response.json(),response.status)}catch(e){if(e instanceof ApiError)throw e;throw invalid('即时质控服务返回了无效响应')}
  throw invalid('即时质控服务未返回流式结果，请确认后端已更新');
 }
 if(!response.body)throw invalid('浏览器未收到质控结果流');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',complete=false;
 const consume=(line:string)=>{
  if(!line.trim())return;
  let raw:unknown;try{raw=JSON.parse(line)}catch{throw invalid('质控数据流格式损坏，请重新检查')}
  const event=unwrap<SingleEvent>(raw,response.status);
  if(!event||!['start','preflight','branch','stage','result','complete','heartbeat'].includes(event.type))throw invalid('质控事件类型无效');
  if(['branch','stage','result'].includes(event.type)&&!['diagnosis','csc','cgec','rag'].includes(event.branch||''))throw invalid('质控分支标识无效');
  if(event.type==='result'&&(!event.outcome||!['succeeded','failed','cancelled'].includes(event.outcome.status)))throw invalid('质控结果不完整');
  if(event.type==='complete')complete=true;
  if(event.type!=='heartbeat')onEvent({...event,request_id:String((raw as Record<string,unknown>).request_id||'')});
 };
 try{
  while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let i;while((i=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,i));buffer=buffer.slice(i+1)}if(done){consume(buffer);break}}
  if(!complete)throw invalid('连接已中断，本次检查未完整结束。已收到的结果仍可查看，请重新检查未完成项目。');
 }catch(e){if(signal.aborted||e instanceof ApiError)throw e;throw invalid('质控连接中断，尚未完成的项目不能视为通过')}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
