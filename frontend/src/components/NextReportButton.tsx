import {useState} from 'react';
import {ArrowLeft,ArrowRight,RefreshCw} from 'lucide-react';
import {getReportNavigation} from '../api';
import type {CheckKey} from '../api/types';
import {useRequest} from '../hooks/useRequest';
import {navigate} from '../hooks/useHashRoute';
import {Button} from './ui';
import {ErrorPanel} from './ErrorPanel';

export type ReportNavigationState={data?:{previous_run_report_id:string|null;next_run_report_id:string|null;position:number;total:number};loading:boolean;error?:unknown;refresh:()=>void};
type Props={runId:string;reportId:string;branch:CheckKey;disabled?:boolean;onNavigate?:(id:string)=>Promise<void>;navigation?:ReportNavigationState};
export function NextReportButton(props:Props){
 return props.navigation?<NavigationControl {...props} navigation={props.navigation}/>:<RequestedNavigation {...props}/>;
}
function RequestedNavigation(props:Props){
 const navigation=useRequest(`${props.runId}:${props.reportId}`,signal=>getReportNavigation(props.runId,props.reportId,signal));
 return <NavigationControl {...props} navigation={navigation}/>;
}
function NavigationControl({runId,branch,disabled=false,onNavigate,navigation}:Props&{navigation:ReportNavigationState}){
 const [moving,setMoving]=useState<'previous'|'next'|null>(null),[error,setError]=useState<unknown>();
 const next=navigation.data?.next_run_report_id;
 const previous=navigation.data?.previous_run_report_id;
 const move=async(direction:'previous'|'next')=>{
  const id=direction==='previous'?previous:next;
  if(!id||moving||disabled||navigation.loading)return;
  setMoving(direction);setError(undefined);
  try{if(onNavigate)await onNavigate(id);else navigate({page:'report',run_id:runId,run_report_id:id,branch})}
  catch(e){setError(e)}finally{setMoving(null)}
 };
 return <div className="report-navigation">
  {navigation.data&&<span className="small muted mono">{navigation.data.position} / {navigation.data.total} 份</span>}
  <Button disabled={disabled||!!moving||navigation.loading||!previous} onClick={()=>void move('previous')} title={navigation.data&&!previous?'已是第一份报告':'查看上一份有效报告，默认选中第一个已启用检查项'}><ArrowLeft size={15}/>{moving==='previous'?'正在切换…':'上一条'}</Button>
  <Button disabled={disabled||!!moving||navigation.loading||!next} onClick={()=>void move('next')} title="查看下一份有效报告，默认选中第一个已启用检查项">{moving==='next'?'正在切换…':navigation.loading?'读取顺序…':navigation.data&&!next?'已是最后一份':'下一条'}<ArrowRight size={15}/></Button>
  {!!navigation.error&&<Button variant="subtle sm" onClick={navigation.refresh}><RefreshCw size={14}/>重新读取顺序</Button>}
  <ErrorPanel error={error||navigation.error}/>
 </div>;
}
