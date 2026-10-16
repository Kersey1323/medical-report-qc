import {ArrowUpRight,FileText,Layers,ClipboardCheck,Activity} from 'lucide-react';
import {useRequest} from '../hooks/useRequest';
import {getSummary,listRuns} from '../api';
import {navigate} from '../hooks/useHashRoute';
import {label} from '../domain/checks';
import {Panel,PageHead,Button,Badge} from '../components/ui';
import {ErrorPanel} from '../components/ErrorPanel';

export function Overview(){
 const summary=useRequest('summary',getSummary);
 const recent=useRequest('recent',s=>listRuns(1,s));
 const metrics=[
  {name:'报告总数',value:summary.data?.report_total,Icon:FileText,tone:'blue'},
  {name:'质控任务',value:summary.data?.run_total,Icon:Layers,tone:'slate'},
  {name:'待人工复核',value:summary.data?.review_pending,Icon:ClipboardCheck,tone:'amber'},
  {name:'运行中任务',value:summary.data?.running_runs,Icon:Activity,tone:'green'},
 ];
 const shortcuts=[
  {page:'single' as const,name:'单份报告质控',Icon:FileText},
  {page:'batch' as const,name:'导入批量报告',Icon:Layers},
  {page:'review' as const,name:'处理待复核建议',Icon:ClipboardCheck},
 ];
 return <div className="page">
  <PageHead title="工作台"><Button variant="primary" onClick={()=>navigate({page:'single'})}><FileText size={16}/>新建质控</Button></PageHead>
  <ErrorPanel error={summary.error||recent.error}/>
  <div className="metrics">{metrics.map(m=><Panel className="metric" key={m.name}>
   <div><span className="metric-label">{m.name}</span><div className="metric-value mono">{m.value??'—'}</div></div>
   <span className={`metric-icon ${m.tone}`}><m.Icon size={21} strokeWidth={1.7}/></span>
  </Panel>)}</div>
  <div className="bento mt24">
   <Panel density="compact">
    <div className="panel-head"><h2>近期任务</h2><Button variant="subtle" onClick={()=>navigate({page:'batch'})}>全部任务 <ArrowUpRight size={15}/></Button></div>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>任务 / 创建时间</th><th>报告</th><th>状态</th><th>已处理工作单元</th></tr></thead>
     <tbody>{recent.data?.items.slice(0,6).map(r=><tr key={r.id}>
      <td><button className="btn-link mono" onClick={()=>navigate({page:'task',run_id:r.id})}>{r.id.slice(0,8)}</button><small className="block muted">{new Date(r.created_at).toLocaleString()}</small></td>
      <td className="mono">{r.counts.report_total}</td>
      <td><Badge tone={r.status==='completed'?'green':r.status==='failed'?'red':r.status==='partial'?'amber':r.status==='running'?'blue':''}>{label(r.status)}</Badge></td>
      <td className="mono">{r.counts.succeeded+r.counts.failed+r.counts.cancelled} / {r.counts.units_total}</td>
     </tr>)}</tbody></table>
     {!recent.data?.items.length&&!recent.loading&&<div className="empty">暂无质控任务</div>}
    </div>
   </Panel>
   <Panel><div className="panel-head"><h2>开始工作</h2></div><div className="panel-body launch-actions">
    {shortcuts.map(item=><button className="launch-action" key={item.page} onClick={()=>navigate({page:item.page})}>
     <span className="shortcut-icon"><item.Icon size={19}/></span><span>{item.name}</span><ArrowUpRight className="shortcut-arrow" size={17}/>
    </button>)}
   </div></Panel>
  </div>
 </div>;
}
