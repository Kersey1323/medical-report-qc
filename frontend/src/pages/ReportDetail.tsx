import {useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeft,RefreshCw} from 'lucide-react';
import {getReportNavigation} from '../api';
import {useRequest} from '../hooks/useRequest';
import {useRunPolling} from '../hooks/useRunPolling';
import {useReportWorkspace} from '../hooks/useReportWorkspace';
import {navigate} from '../hooks/useHashRoute';
import type {CheckKey} from '../api/types';
import {checks} from '../domain/checks';
import {PageHead,Button,Panel,Badge} from '../components/ui';
import {CheckIcon} from '../components/StatusIcon';
import {ErrorPanel} from '../components/ErrorPanel';
import {CheckResult} from '../components/CheckResult';
import {NextReportButton} from '../components/NextReportButton';

export function ReportDetail({runId,reportId,branch,reviewMode=false}:{runId:string;reportId:string;branch:CheckKey;reviewMode?:boolean}){
 const {run,error}=useRunPolling(runId);
 const workspace=useReportWorkspace(runId,reportId,branch,run?.revision);
 const {row,result}=workspace;
 const order=useRequest(`${runId}:${reportId}`,async signal=>({reportId,data:await getReportNavigation(runId,reportId,signal)}));
 const navigation={data:order.data?.reportId===reportId?order.data.data:undefined,loading:order.loading||order.data?.reportId!==reportId&&!order.error,error:order.error,refresh:order.refresh};
 const body=useRef<HTMLDivElement>(null);
 const [height,setHeight]=useState(0);
 // Preserve the tallest visited branch at this viewport width. A slow response
 // must not collapse the document or pull the footer/scroll position upwards.
 useLayoutEffect(()=>{
  const element=body.current;if(!element)return;
  let width=element.getBoundingClientRect().width;
  const measure=()=>setHeight(old=>Math.max(old,element.getBoundingClientRect().height));
  const observer=new ResizeObserver(()=>{
   const nextWidth=element.getBoundingClientRect().width;
   if(nextWidth!==width){width=nextWidth;setHeight(element.getBoundingClientRect().height)}else measure();
  });observer.observe(element);measure();return()=>observer.disconnect();
 },[]);
 const loading=workspace.loading&&!error;
 const navigateReport=async(id:string)=>navigate({page:reviewMode?'review_report':'report',run_id:runId,run_report_id:id,branch:checks.find(check=>run?.checks.includes(check.key))?.key||'diagnosis'});
 return <div className="page">
  <PageHead title={reviewMode?'报告复核':'报告详情'}><Button variant="subtle" onClick={()=>navigate({page:reviewMode?'review_task':'task',run_id:runId})}><ArrowLeft size={15}/>{reviewMode?'返回报告列表':'返回任务'}</Button></PageHead>
  <ErrorPanel error={error}/>
  <div className="report-context"><div className="flex"><strong className="mono">{row?.report_id?.slice(0,8)||reportId.slice(0,8)}</strong>{row?.original_row!=null&&<span>原始第 {row.original_row} 行</span>}<span>任务 {runId.slice(0,8)}</span></div>{result&&<Badge>第 {result.generation} 代结果</Badge>}</div>
  <nav className="branch-tabs" aria-label="报告质控项目">{checks.map(c=>{
   const disabled=!!run&&!run.checks.includes(c.key);
   return <Button key={c.key} aria-label={c.name} aria-current={branch===c.key?'page':undefined} className={branch===c.key?'active':''} disabled={disabled} onClick={()=>navigate({page:reviewMode?'review_report':'report',run_id:runId,run_report_id:reportId,branch:c.key})}><CheckIcon branch={c.key} size={16}/>{c.name}{disabled&&' · 未启用'}</Button>;
  })}</nav>
  <div className="report-workspace" aria-busy={loading} style={height?{minHeight:height}:undefined}>
   <div ref={body}>
    {result?<div key={`${result.id}:${result.generation}`} className="report-content-enter"><CheckResult result={result} report={row} onRefresh={workspace.refresh} navigation={navigation} onNavigate={navigateReport}/></div>:loading?<div className="report-loading" role="status"><span>正在读取结果…</span><div className="report-placeholder-grid" aria-hidden="true">{[0,1].map(column=><div key={column}>{[0,1,2,3,4,5].map(line=><i key={line}/>)}</div>)}</div></div>:<Panel>
     <ErrorPanel error={workspace.error}/>
     <div className="empty">{workspace.error?'当前结果读取失败':row?.invalid?'无效导入行，没有可检查的报告。':error?'任务信息读取失败':'本项未启用或暂无结果'}</div>
     <div className="panel-foot">{workspace.error?<Button onClick={workspace.retry}><RefreshCw size={14}/>重新读取结果</Button>:<span>可以继续查看当前任务的其他报告</span>}{row&&<NextReportButton runId={runId} reportId={reportId} branch={branch} navigation={navigation} onNavigate={navigateReport}/>}</div>
    </Panel>}
   </div>
  </div>
 </div>;
}
