import {useState} from 'react';
import {getQueue} from '../api';
import {useRequest} from '../hooks/useRequest';
import {checks} from '../domain/checks';
import {PageHead,Panel,Pagination,Button} from '../components/ui';
import {CheckResult} from '../components/CheckResult';
import {ErrorPanel} from '../components/ErrorPanel';
export function Review(){
 const [page,setPage]=useState(1),[selected,setSelected]=useState('');const queue=useRequest('reviews:'+page,s=>getQueue(page,s));const result=queue.data?.items.find(r=>r.id===selected);
 return <div className="page"><PageHead title="人工复核"><Button onClick={queue.refresh}>刷新队列</Button></PageHead><ErrorPanel error={queue.error}/><div className="review-layout"><Panel><div className="panel-head"><h2>待复核建议</h2><span>{queue.data?.total??'—'}</span></div><div className="review-queue">{queue.data?.items.map(r=><button key={r.id} className={`queue-item ${selected===r.id?'active':''}`} onClick={()=>setSelected(r.id)}><strong>{checks.find(c=>c.key===r.branch)?.name}</strong><p>{r.source.slice(0,70)}{r.source.length>70?'…':''}</p><small className="mono">{r.id.slice(0,8)} · 第 {r.generation} 代</small></button>)}{!queue.loading&&!queue.data?.items.length&&<div className="empty">暂无待复核建议</div>}</div>{queue.data&&<Pagination page={page} total={queue.data.total} onPage={setPage}/>}</Panel><div>{result?<CheckResult key={result.id} result={result} onRefresh={queue.refresh}/>:<Panel><div className="empty">选择一条建议进行复核</div></Panel>}</div></div></div>
}
