import {ApiError} from '../api/client';
import {Button} from './ui';
export function ErrorPanel({error}:{error:unknown}){
 if(!error)return null;
 const e=error instanceof ApiError?error:null;
 return <div className="error-panel" role="alert"><strong>{e?.message||(error instanceof Error?error.message:'操作失败，请重试')}</strong>{e&&<details><summary>错误详情与追踪编号</summary><dl className="config-list"><dt>错误码</dt><dd>{e.code}</dd><dt>阶段</dt><dd>{e.detail.stage}</dd><dt>原因</dt><dd>{e.detail.cause||'未提供额外原因'}</dd><dt>可重试</dt><dd>{e.detail.retryable?'是':'否'}</dd><dt>请求编号</dt><dd>{e.request_id||'未收到编号'} {e.request_id&&<Button variant="subtle sm" onClick={()=>void navigator.clipboard?.writeText(e.request_id)}>复制</Button>}</dd></dl>{e.detail.context&&<pre>{JSON.stringify(e.detail.context,null,2)}</pre>}</details>}</div>
}
