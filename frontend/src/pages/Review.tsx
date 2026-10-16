import {useEffect,useState} from 'react';
import {getQueue,getReviewTasks} from '../api';
import type {ReviewTaskDTO} from '../api/types';
import {useRequest} from '../hooks/useRequest';
import {navigate} from '../hooks/useHashRoute';
import {checks,label} from '../domain/checks';
import {PageHead,Panel,Pagination,Button,Badge} from '../components/ui';
import {CheckResult} from '../components/CheckResult';
import {ErrorPanel} from '../components/ErrorPanel';

function TaskReview({task,refreshRevision,onTasksChanged}:{task:ReviewTaskDTO;refreshRevision:number;onTasksChanged:()=>void}){
 const [page,setPage]=useState(1);
 const [selected,setSelected]=useState('');
 const queue=useRequest(`reviews:${task.run_id}:${page}:${refreshRevision}`,signal=>getQueue(page,signal,task.run_id));
 const result=queue.data?.items.find(item=>item.id===selected);
 useEffect(()=>{
  if(queue.data&&!queue.loading){
   const lastPage=Math.max(1,Math.ceil(queue.data.total/20));
   if(page>lastPage){setPage(lastPage);setSelected('')}
  }
 },[queue.data,queue.loading,page]);
 const refresh=()=>{queue.refresh();onTasksChanged()};
 return <>
  <Panel className="mb24">
   <div className="panel-head">
    <div><h2>{task.filename||(task.report_total===1?'单份质控任务':'多份质控任务')}</h2><p className="small muted mono">任务 {task.run_id}</p></div>
    <Badge>报告 {task.report_total} 份</Badge>
   </div>
  </Panel>
  <ErrorPanel error={queue.error}/>
  <div className="review-layout">
   <Panel aria-label="任务待复核建议" aria-busy={queue.loading}>
    <div className="panel-head"><h2>任务内待复核建议</h2><span>{queue.data?.total??'—'}</span></div>
    <div className="review-queue">
     {queue.data?.items.map(item=><button key={item.id} className={`queue-item group ${selected===item.id?'active':''}`} aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}>
      <span className="block-handle" aria-hidden="true">⋮⋮</span>
      <strong>{checks.find(check=>check.key===item.branch)?.name}</strong>
      <p>{item.source.slice(0,70)}{item.source.length>70?'…':''}</p>
      <small className="mono">报告 {item.run_report_id.slice(0,8)} · 第 {item.generation} 代</small>
     </button>)}
     {queue.loading&&!queue.data&&<div className="empty" role="status">加载建议中…</div>}
     {!queue.loading&&!queue.error&&!queue.data?.items.length&&<div className="empty">该任务暂无待复核建议</div>}
    </div>
    {queue.data&&<Pagination page={page} total={queue.data.total} onPage={next=>{setSelected('');setPage(next)}}/>}
   </Panel>
   <div>{result?<CheckResult key={`${result.id}:${result.generation}`} result={result} onRefresh={refresh}/>:<Panel><div className="empty">选择该任务内的一条建议进行复核</div></Panel>}</div>
  </div>
 </>;
}

export function Review(){
 const [page,setPage]=useState(1);
 const [selectedTask,setSelectedTask]=useState<ReviewTaskDTO>();
 const [refreshRevision,setRefreshRevision]=useState(0);
 const tasks=useRequest('review-tasks:'+page,signal=>getReviewTasks(page,signal));
 useEffect(()=>{
  if(tasks.data&&!tasks.loading){
   const lastPage=Math.max(1,Math.ceil(tasks.data.total/20));
   if(page>lastPage)setPage(lastPage);
  }
 },[tasks.data,tasks.loading,page]);
 const refresh=()=>{tasks.refresh();setRefreshRevision(value=>value+1)};
 const currentTask=selectedTask&&(tasks.data?.items.find(task=>task.run_id===selectedTask.run_id)||selectedTask);
 return <div className="page">
  <PageHead title="人工复核">
   {selectedTask&&<Button onClick={()=>setSelectedTask(undefined)}>返回任务列表</Button>}
   {selectedTask&&<Button onClick={()=>navigate({page:'task',run_id:selectedTask.run_id})}>查看质控任务</Button>}
   <Button onClick={refresh}>刷新队列</Button>
  </PageHead>
  <ErrorPanel error={tasks.error}/>
  {currentTask?<TaskReview key={currentTask.run_id} task={currentTask} refreshRevision={refreshRevision} onTasksChanged={tasks.refresh}/>:<Panel density="compact" aria-busy={tasks.loading}>
   <div className="panel-head"><h2>待复核质控任务</h2><span className="small muted">{tasks.data?.total??'—'} 个任务</span></div>
   <div className="table-scroll">
    <table className="data-table" aria-label="待复核质控任务">
     <thead><tr><th>任务 / 创建时间</th><th>报告来源</th><th>报告总数</th><th>待复核报告</th><th>待复核建议</th><th>任务状态</th><th>操作</th></tr></thead>
     <tbody>{tasks.data?.items.map(task=><tr key={task.run_id}>
      <td><b className="mono">{task.run_id.slice(0,8)}</b><small className="block muted">{new Date(task.created_at).toLocaleString()}</small></td>
      <td className="review-task-source">{task.filename||(task.report_total===1?'单份质控任务':'多份质控任务')}</td>
      <td className="mono">{task.report_total}</td><td className="mono">{task.pending_reports}</td><td><Badge tone="amber">{task.pending_results} 条</Badge></td>
      <td><Badge tone={task.status==='failed'?'red':task.status==='partial'?'amber':task.status==='completed'?'green':task.status==='running'?'blue':''}>{label(task.status)}</Badge></td>
      <td><Button aria-label={`复核任务 ${task.run_id.slice(0,8)}`} onClick={()=>setSelectedTask(task)}>进入复核</Button></td>
     </tr>)}</tbody>
    </table>
    {tasks.loading&&!tasks.data&&<div className="empty" role="status">加载任务中…</div>}
    {!tasks.loading&&!tasks.error&&!tasks.data?.items.length&&<div className="empty">暂无待复核任务</div>}
   </div>
   {tasks.data&&<Pagination page={page} total={tasks.data.total} onPage={setPage}/>}
  </Panel>}
 </div>;
}
