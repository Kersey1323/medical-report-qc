import {getResult} from '../api';
import {useRequest} from '../hooks/useRequest';
import {useRunPolling} from '../hooks/useRunPolling';
import {navigate} from '../hooks/useHashRoute';
import type {CheckKey,Page,RunReport} from '../api/types';
import {apiRequest} from '../api/client';
import {checks} from '../domain/checks';
import {PageHead,Button,Panel} from '../components/ui';
import {ErrorPanel} from '../components/ErrorPanel';
import {CheckResult} from '../components/CheckResult';
export function ReportDetail({runId,reportId,branch}:{runId:string;reportId:string;branch:CheckKey}){
 const {run,error}=useRunPolling(runId);
 const row=useRequest(`${reportId}:${run?.revision}`,s=>apiRequest<Page<RunReport>>(`/runs/${runId}/reports?run_report_id=${reportId}`,{signal:s}).then(p=>{const r=p.items.find(r=>r.id===reportId);if(!r)throw Error('报告不存在或不属于此任务');return r}));
 const mid=row.data?.results[branch]?.id;
 const result=useRequest(`${mid}:${run?.revision}`,s=>mid?getResult(mid,s):Promise.resolve(undefined));
 return <div className="page"><PageHead title="报告详情"><Button onClick={()=>navigate({page:'task',run_id:runId})}>返回任务</Button></PageHead><ErrorPanel error={error||row.error||result.error}/><nav className="branch-tabs" aria-label="报告质控项目">{checks.map(c=><Button key={c.key} variant={branch===c.key?'primary':''} disabled={!run?.checks.includes(c.key)} onClick={()=>navigate({page:'report',run_id:runId,run_report_id:reportId,branch:c.key})}>{c.name}{!run?.checks.includes(c.key)&&' · 未启用'}</Button>)}</nav>{result.data?<CheckResult key={result.data.id} result={result.data} onRefresh={result.refresh}/>:<Panel><div className="empty">{mid?'正在读取结果…':'本项未启用或暂无结果'}</div></Panel>}</div>
}
