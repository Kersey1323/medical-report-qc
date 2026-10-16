import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,RefreshCw,ClipboardCheck,FileText,Eye} from 'lucide-react';
import {CheckLegend} from '../components/CheckLegend';
import {StatusIcon,CheckIcon} from '../components/StatusIcon';
import {getReviewTasks,getReviewReports,getRun} from '../api';
import {useRequest} from '../hooks/useRequest';
import {navigate} from '../hooks/useHashRoute';
import {checks,label} from '../domain/checks';
import {PageHead,Panel,Pagination,Button,Badge,ResultBadge} from '../components/ui';
import {ErrorPanel} from '../components/ErrorPanel';

export function Review(){
 const [page,setPage]=useState(1);
 const tasks=useRequest('review-tasks:'+page,signal=>getReviewTasks(page,signal));
 useEffect(()=>{
  if(tasks.data&&!tasks.loading){
   const lastPage=Math.max(1,Math.ceil(tasks.data.total/20));
   if(page>lastPage)setPage(lastPage);
  }
 },[tasks.data,tasks.loading,page]);
 return <div className="page">
  <PageHead title="人工复核"><Button onClick={tasks.refresh}><RefreshCw size={15}/>刷新队列</Button></PageHead>
  <ErrorPanel error={tasks.error}/>
  <Panel density="compact" aria-busy={tasks.loading}>
   <div className="panel-head"><h2 className="icon-label"><ClipboardCheck size={16}/>待复核质控任务</h2><span className="small muted">{tasks.data?.total??'—'} 个任务</span></div>
   <div className="table-scroll">
    <table className="data-table" aria-label="待复核质控任务">
     <thead><tr><th>任务 / 创建时间</th><th>报告来源</th><th>报告总数</th><th>待复核报告</th><th>待复核建议</th><th>任务状态</th><th>操作</th></tr></thead>
     <tbody>{tasks.data?.items.map(task=><tr key={task.run_id}>
      <td><b className="mono">{task.run_id.slice(0,8)}</b><small className="block muted">{new Date(task.created_at).toLocaleString()}</small></td>
      <td className="review-task-source">{task.filename||(task.report_total===1?'单份质控任务':'多份质控任务')}</td>
      <td className="mono">{task.report_total}</td><td className="mono">{task.pending_reports}</td><td><Badge tone="amber" icon={<Eye size={13} aria-hidden="true"/>}>{task.pending_results} 条</Badge></td>
      <td><Badge icon={<StatusIcon status={task.status}/>} tone={task.status==='failed'?'red':task.status==='partial'?'amber':task.status==='completed'?'green':task.status==='running'?'blue':''}>{label(task.status)}</Badge></td>
      <td><Button aria-label={`复核任务 ${task.run_id.slice(0,8)}`} onClick={()=>navigate({page:'review_task',run_id:task.run_id})}>进入复核<ArrowRight size={14} aria-hidden="true"/></Button></td>
     </tr>)}</tbody>
    </table>
    {tasks.loading&&!tasks.data&&<div className="empty" role="status">加载任务中…</div>}
    {!tasks.loading&&!tasks.error&&!tasks.data?.items.length&&<div className="empty">暂无待复核任务</div>}
   </div>
   {tasks.data&&<Pagination page={page} total={tasks.data.total} onPage={setPage}/>}
  </Panel>
 </div>;
}

export function TaskReview({runId}:{runId:string}){
 const [page,setPage]=useState(1),[filter,setFilter]=useState<'pending'|'all'>('pending');
 const task=useRequest(runId,signal=>getRun(runId,signal));
 const reports=useRequest(`review-reports:${runId}:${page}:${filter}`,signal=>getReviewReports(runId,page,filter,signal));
 useEffect(()=>{if(reports.data&&!reports.loading){const last=Math.max(1,Math.ceil(reports.data.total/20));if(page>last)setPage(last)}},[reports.data,reports.loading,page]);
 return <div className="page">
  <PageHead title="任务报告复核">
   <Button onClick={()=>navigate({page:'review'})}><ArrowLeft size={15}/>返回任务列表</Button>
   <Button onClick={()=>navigate({page:'task',run_id:runId})}><Eye size={15}/>查看质控任务</Button>
   <Button onClick={()=>{reports.refresh();task.refresh()}}><RefreshCw size={15}/>刷新报告</Button>
  </PageHead>
  <ErrorPanel error={task.error||reports.error}/>
  <div className="review-task-context"><div><h2>{task.data?.filename||'质控任务'}</h2><p className="small muted mono">任务 {runId}</p></div><Badge icon={<FileText size={13}/>}>报告 {task.data?.counts.report_total??'—'} 份</Badge></div>
  <Panel density="compact" aria-busy={reports.loading}>
   <div className="panel-head"><h2 className="icon-label"><ClipboardCheck size={16}/>{filter==='pending'?'待复核报告':'任务全部报告'}<span className="small muted">{reports.data?.total??'—'} 份</span></h2><div className="segments" aria-label="复核报告筛选">{(['pending','all'] as const).map(value=><Button key={value} aria-pressed={filter===value} className={filter===value?'active':''} onClick={()=>{setFilter(value);setPage(1)}}>{value==='pending'?'待复核':'全部报告'}</Button>)}</div></div>
   <CheckLegend reports={reports.data?.items}/>
   <div className="table-scroll"><table className="data-table" aria-label="任务复核报告"><thead><tr><th>报告 / 原始行</th><th>影像描述摘要</th><th>四项检查</th><th>待复核项目</th><th>操作</th></tr></thead><tbody>
    {reports.data?.items.map(report=>{
     const first=report.pending_branches[0]||checks.find(c=>report.results[c.key])?.key||'diagnosis';
     return <tr key={report.id}>
      <td><div className="task-file"><FileText size={16}/><div><b className="mono">{report.report_id?.slice(0,8)}</b><small className="block muted">{report.original_row!=null?`原始第 ${report.original_row} 行`:'单份报告'}</small></div></div></td>
      <td className="review-report-preview">{report.description.slice(0,90)}{report.description.length>90?'…':''}</td>
      <td><div className="flex wrap">{checks.map(check=>{const unit=report.results[check.key];return unit?<button key={check.key} className="result-link result-link-icons" title={`${check.name} · ${label(unit.status==='succeeded'?unit.finding||'unknown':unit.status)}`} aria-label={`复核${check.short}结果 ${report.id.slice(0,8)}`} onClick={()=>navigate({page:'review_report',run_id:runId,run_report_id:report.id,branch:check.key})}><CheckIcon branch={check.key}/><span>{check.short}</span><ResultBadge status={unit.status} finding={unit.finding} iconOnly/></button>:null})}</div></td>
      <td><Badge tone={report.pending_results?'amber':''} icon={<StatusIcon status={report.pending_results?'needs_review':'complete'}/>}>{report.pending_results?`${report.pending_results} 项待复核`:'无待复核项'}</Badge></td>
      <td><Button aria-label={`复核报告 ${report.id.slice(0,8)}`} onClick={()=>navigate({page:'review_report',run_id:runId,run_report_id:report.id,branch:first})}>进入复核<ArrowRight size={14}/></Button></td>
     </tr>;
    })}
   </tbody></table>{reports.loading&&!reports.data&&<div className="empty" role="status">加载报告中…</div>}{!reports.loading&&!reports.error&&!reports.data?.items.length&&<div className="empty">{filter==='pending'?'该任务暂无待复核报告':'该任务没有有效报告'}</div>}</div>
   {reports.data&&<Pagination page={page} total={reports.data.total} onPage={setPage}/>}
  </Panel>
 </div>;
}
