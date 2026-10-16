import {useState,useEffect} from 'react';
import {StudioShell} from './components/StudioShell';
import {Footer,Button} from './components/ui';
import {useHashRoute} from './hooks/useHashRoute';
import {getSummary} from './api';
import type {Summary} from './api/types';
import {Overview} from './pages/Overview';
import {SingleReport} from './pages/SingleReport';
import {BatchTasks,TaskDetail} from './pages/BatchTasks';
import {ReportDetail} from './pages/ReportDetail';
import {Review} from './pages/Review';
import {Settings} from './pages/Settings';
export default function App(){
 const [route]=useHashRoute();const [summary,setSummary]=useState<Summary>();const [help,setHelp]=useState(false);
 useEffect(()=>{const c=new AbortController();getSummary(c.signal).then(setSummary).catch(()=>{if(!c.signal.aborted)setSummary(undefined)});return()=>c.abort()},[route]);
 let content;
 switch(route.page){case'overview':content=<Overview/>;break;case'single':content=<SingleReport/>;break;case'batch':content=<BatchTasks/>;break;case'task':content=<TaskDetail key={route.run_id} runId={route.run_id}/>;break;case'report':content=<ReportDetail key={`${route.run_id}:${route.run_report_id}:${route.branch}`} runId={route.run_id} reportId={route.run_report_id} branch={route.branch}/>;break;case'review':content=<Review/>;break;case'settings':content=<Settings/>;break;default:content=<div className="empty">页面不存在，请从左侧导航进入。</div>}
 return <><StudioShell active={route.page} taskCount={summary?.run_total??0} pendingCount={summary?.review_pending??0} onHelp={()=>setHelp(true)}>{content}<Footer/></StudioShell>{help&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="使用说明"><div className="modal-head"><h2>使用说明</h2><Button onClick={()=>setHelp(false)}>关闭</Button></div><div className="modal-body"><p>提交原始描述与医生诊断后，按所选项目独立质控。失败不会被记为正常；任务在后台持续运行，关闭页面不会取消。</p><p className="mt16">原文、模型建议、检索证据与人工意见分别保存。模型建议需人工核对。</p></div></section></div>}</>
}
