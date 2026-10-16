import {useState} from 'react';
import {ArrowRight,FileText,Layers,ClipboardCheck,Activity,Upload} from 'lucide-react';
import {StatusIcon,CheckIcon} from '../components/StatusIcon';
import {useRequest} from '../hooks/useRequest';
import {getSummary,listRuns} from '../api';
import {navigate} from '../hooks/useHashRoute';
import {checks,label} from '../domain/checks';
import {Panel,PageHead,Button,Badge} from '../components/ui';
import {ErrorPanel} from '../components/ErrorPanel';
import {UploadDialog} from '../components/UploadDialog';
export function Overview(){
 const summary=useRequest('summary',getSummary),recent=useRequest('recent',s=>listRuns(1,s));
 const [upload,setUpload]=useState(false);
 const metrics=[
  {name:'报告总数',value:summary.data?.report_total,unit:'份原始报告',Icon:FileText},
  {name:'质控任务',value:summary.data?.run_total,unit:'全部任务',Icon:Layers},
  {name:'待人工复核',value:summary.data?.review_pending,unit:'条建议',Icon:ClipboardCheck},
  {name:'运行中任务',value:summary.data?.running_runs,unit:'后台处理',Icon:Activity},
 ];
 return <div className="page">
  <PageHead title="工作台"><Button onClick={()=>setUpload(true)}><Upload size={15}/>导入报告</Button><Button variant="primary" onClick={()=>navigate({page:'single'})}><FileText size={15}/>新建质控</Button></PageHead>
  <ErrorPanel error={summary.error||recent.error}/>
  <div className="metrics">{metrics.map(m=><section className="metric" key={m.name}><div className="metric-label">{m.name}<m.Icon size={17}/></div><div className="metric-value mono">{m.value??'—'}<span className="metric-unit">{m.unit}</span></div></section>)}</div>
  <div className="bento">
   <Panel density="compact">
    <div className="panel-head"><div className="flex"><h2>近期质控任务</h2><Badge>最近 {recent.data?.items.slice(0,6).length??0} 项</Badge></div><Button variant="subtle" onClick={()=>navigate({page:'batch'})}>全部任务 <ArrowRight size={15}/></Button></div>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>任务 / 来源</th><th>报告数</th><th>状态</th><th>工作单元</th><th>操作</th></tr></thead><tbody>{recent.data?.items.slice(0,6).map(r=><tr key={r.id}>
     <td><div className="task-file"><span className="file-icon"><FileText/></span><div><button className="btn-link" onClick={()=>navigate({page:'task',run_id:r.id})}>{r.filename||(r.counts.report_total===1?'单份报告质控':'多份报告质控')}</button><small className="block muted mono">{r.id.slice(0,8)} · {new Date(r.created_at).toLocaleString()}</small></div></div></td>
     <td className="mono">{r.counts.report_total}</td><td><Badge icon={<StatusIcon status={r.status}/>} tone={r.status==='completed'?'green':r.status==='failed'?'red':r.status==='partial'?'amber':r.status==='running'?'blue':''}>{label(r.status)}</Badge></td>
     <td><span className="mono">{r.counts.succeeded+r.counts.failed+r.counts.cancelled} / {r.counts.units_total}</span><div className="table-progress"><span style={{width:`${r.counts.units_total?(r.counts.succeeded+r.counts.failed+r.counts.cancelled)/r.counts.units_total*100:0}%`}}/></div></td>
     <td><Button variant="subtle sm" onClick={()=>navigate({page:'task',run_id:r.id})}>查看<ArrowRight size={14}/></Button></td>
    </tr>)}</tbody></table>{recent.loading&&!recent.data&&<div className="empty" role="status">正在读取任务…</div>}{!recent.data?.items.length&&!recent.loading&&<div className="empty">暂无质控任务</div>}</div>
   </Panel>
   <div className="stack">
    <Panel><div className="panel-head"><h2>开始工作</h2><ArrowRight size={16}/></div><div className="launch-actions">{[
     {name:'单份报告质控',detail:'粘贴描述与诊断',Icon:FileText,action:()=>navigate({page:'single'})},
     {name:'导入批量报告',detail:'CSV / XLSX · 字段映射',Icon:Upload,action:()=>setUpload(true)},
     {name:'处理待复核建议',detail:'按质控任务集中复核',Icon:ClipboardCheck,action:()=>navigate({page:'review'})},
    ].map(item=><button className="launch-action" key={item.name} onClick={item.action}><span className="shortcut-icon"><item.Icon size={19}/></span><span><strong>{item.name}</strong><small>{item.detail}</small></span><ArrowRight className="shortcut-arrow" size={15}/></button>)}</div></Panel>
    <Panel><div className="panel-head"><h2>待复核分布</h2><Button variant="subtle sm" onClick={()=>navigate({page:'review'})}><ClipboardCheck size={14} aria-hidden="true"/>进入复核</Button></div><div className="review-breakdown"><p><strong className="pending-total mono">{summary.data?.review_pending??'—'}</strong><span className="small muted"> 条建议等待确认</span></p>{checks.map(c=>{const n=summary.data?.review_by_branch?.[c.key]??0;return <div className="breakdown-row" key={c.key}><div className="between"><span className="icon-label"><CheckIcon branch={c.key} size={13}/>{c.name}</span><span className="mono">{summary.data?.review_by_branch?n:'—'}</span></div><div className="progress"><span style={{width:`${summary.data?.review_pending?n/summary.data.review_pending*100:0}%`}}/></div></div>})}</div></Panel>
   </div>
  </div>
  {upload&&<UploadDialog onClose={()=>{setUpload(false);recent.refresh();summary.refresh()}}/>}
 </div>;
}
