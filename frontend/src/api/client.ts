import type { ErrorDetail } from './types';
export class ApiError extends Error{
 readonly code:string;
 constructor(public detail:ErrorDetail,public request_id:string,public http_status:number){super(detail.message);this.name='ApiError';this.code=detail.code}
}
export class TransportError extends ApiError{}
function invalid(message:string,status=0):TransportError{return new TransportError({code:'response_invalid',message,stage:'web.transport',retryable:true},'',status)}
export function unwrap<T>(value:unknown,status:number):T{
 if(!value||typeof value!=='object')throw invalid('服务返回的响应不是有效对象',status);
 const b=value as Record<string,unknown>;
 if(b.status==='error'&&b.detail&&typeof b.detail==='object'){
  const detail=b.detail as ErrorDetail;if(typeof detail.message!=='string'||typeof detail.code!=='string')throw invalid('服务错误响应结构不完整',status);
  throw new ApiError(detail,String(b.request_id||''),status);
 }
 if(b.status!=='success'||!('data'in b)||b.data===undefined)throw invalid('服务响应封装不完整',status);
 return b.data as T;
}
export async function apiRequest<T>(path:string,init:RequestInit={}):Promise<T>{
 const headers=new Headers(init.headers);if(init.body&&!(init.body instanceof FormData))headers.set('Content-Type','application/json');
 let response:Response;
 try{response=await fetch('/api/v1'+path,{...init,headers})}catch(e){if((e as Error).name==='AbortError')throw e;throw invalid('无法连接业务服务，请检查网络和5100服务')}
 if(!response.ok)throw invalid(`HTTP连接失败（${response.status}）`,response.status);
 let body:unknown;try{body=await response.json()}catch{throw invalid('收到非JSON响应，请检查反向代理',response.status)}
 return unwrap<T>(body,response.status);
}
export const post=<T>(path:string,data?:unknown)=>apiRequest<T>(path,{method:'POST',body:data===undefined?undefined:JSON.stringify(data)});
export async function downloadArtifact(id:string):Promise<{blob:Blob;filename:string}>{
 const r=await fetch('/api/v1/exports/'+id+'/download');
 const type=r.headers.get('content-type')||'';
 if(type.includes('json')){unwrap(await r.json(),r.status);throw invalid('导出接口未返回文件',r.status)}
 if(!r.ok||!type.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))throw invalid('下载内容不是有效的XLSX文件',r.status);
 const header=r.headers.get('content-disposition')||'';const encoded=header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
 return {blob:await r.blob(),filename:encoded?decodeURIComponent(encoded):header.match(/filename="?([^";]+)/)?.[1]||'医学质控.xlsx'};
}
