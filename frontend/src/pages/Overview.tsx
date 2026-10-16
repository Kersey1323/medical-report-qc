import {ArrowUpRight,FileText,Layers,ClipboardCheck,Activity} from 'lucide-react';
import {useRequest} from '../hooks/useRequest';
import {getSummary,listRuns} from '../api';
import {navigate} from '../hooks/useHashRoute';
import {label} from '../domain/checks';
import {Panel,PageHead,Button,Badge} from '../components/ui';
import {ErrorPanel} from '../components/ErrorPanel';
export function Overview(){
 const summary=useRequest('summary',getSummary);const recent=useRequest('recent',s=>listRuns(1,s));
 return <div className="page"><PageHead title="工作台"><Button variant="primary" onClick={()=>navigate({page:'single'})}><FileText size={16}/>新建质控</Button></PageHead><ErrorPanel error={summary.error||recent.error}/>
 <div className="metrics">{[{name:'报告总数',value:summary.data?.report_total,Icon:FileText},{name:'质控任务',value:summary.data?.run_total,Icon:Layers},{name:'待人工复核',value:summary.data?.review_pending,Icon:ClipboardCheck},{name:'运行中任务',value:summary.data?.running_runs,Icon:Activity}].map(m=><Panel className="metric" key={m.name}><div className="between"><span className="muted">{m.name}</span><m.Icon size={18}/></div><div className="metric-value">{m.value??'—'}</div></Panel>)}</div>
 <div className="bento mt24"><Panel><div className="panel-head"><h2>近期任务</h2><Button variant="subtle" onClick={()=>navigate({page:'batch'})}>全部任务 <ArrowUpRight size={15}/></Button></div><div className="table-scroll"><table className="data-table"><thead><tr><th>任务</th><th>报告</th><th>状态</th><th>已处理工作单元</th></tr></thead><tbody>{recent.data?.items.slice(0,6).map(r=><tr key={r.id}><td><button className="btn-link mono" onClick={()=>navigate({page:'task',run_id:r.id})}>{r.id.slice(0,8)}</button><small className="block muted">{new Date(r.created_at).toLocaleString()}</small></td><td>{r.counts.report_total}</td><td><Badge>{label(r.status)}</Badge></td><td>{r.counts.succeeded+r.counts.failed+r.counts.cancelled} / {r.counts.units_total}</td></tr>)}</tbody></table>{!recent.data?.items.length&&!recent.loading&&<div className="empty">暂无质控任务</div>}</div></Panel><Panel><div className="panel-head"><h2>开始工作</h2></div><div className="panel-body launch-actions"><Button onClick={()=>navigate({page:'single'})}>单份报告质控 <ArrowUpRight size={16}/></Button><Button onClick={()=>navigate({page:'batch'})}>导入批量报告 <ArrowUpRight size={16}/></Button><Button onClick={()=>navigate({page:'review'})}>处理待复核建议 <ArrowUpRight size={16}/></Button></div></Panel></div></div>
}
