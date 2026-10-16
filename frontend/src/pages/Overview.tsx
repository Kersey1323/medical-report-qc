import {useState} from 'react';
import {ArrowRight,ArrowUpRight,FileText,Layers,ClipboardCheck,Activity,RefreshCw} from 'lucide-react';
import {StatusIcon,CheckIcon} from '../components/StatusIcon';
import {useRequest} from '../hooks/useRequest';
import {getSummary,listRuns} from '../api';
import {navigate} from '../hooks/useHashRoute';
import {checks,label} from '../domain/checks';
import {PageHead} from '../components/ui';
import {ErrorPanel} from '../components/ErrorPanel';
import {UploadDialog} from '../components/UploadDialog';
import './overview.css';

const buttonClass='home-button rounded-xl font-medium transition-colors duration-200 ease-out';
const cardClass='rounded-xl bg-white border shadow-sm';
const tones=['blue','slate','amber','green'];
const ringColors=['#0052ff','#0284c7','#6366f1','#059669'];

export function Overview(){
 const summary=useRequest('summary',getSummary),recent=useRequest('recent',s=>listRuns(1,s));
 const [upload,setUpload]=useState(false);
 const metrics=[
  {name:'报告总数',value:summary.data?.report_total,unit:'份报告',Icon:FileText,page:'batch' as const},
  {name:'质控任务',value:summary.data?.run_total,unit:'个任务',Icon:Layers,page:'batch' as const},
  {name:'待人工复核',value:summary.data?.review_pending,unit:'条建议',Icon:ClipboardCheck,page:'review' as const},
  {name:'运行中任务',value:summary.data?.running_runs,unit:'个任务',Icon:Activity,page:'batch' as const},
 ];
 const pending=summary.data?.review_pending;
 const distribution=checks.map(c=>summary.data?.review_by_branch?.[c.key]??0);
 const distributionTotal=distribution.reduce((sum,n)=>sum+n,0);
 let offset=0;
 return <div className="page home-page">
  <PageHead title="工作台"><button type="button" className={`${buttonClass} home-refresh`} disabled={summary.loading||recent.loading} onClick={()=>{summary.refresh();recent.refresh()}}><RefreshCw size={14} aria-hidden="true"/>刷新概览</button></PageHead>
  <ErrorPanel error={summary.error||recent.error}/>
  <section className="home-metrics" aria-label="质控统计" aria-busy={summary.loading}>
   {metrics.map((m,i)=><button type="button" key={m.name} className={`${cardClass} ${buttonClass} home-metric home-tone-${tones[i]}`} onClick={()=>navigate({page:m.page})} aria-label={`${m.name}：${m.value??'加载中'}${m.value!=null?m.unit:''}`}>
    <span className="home-metric-top"><span>{m.name}</span><m.Icon size={19} strokeWidth={1.8} aria-hidden="true"/></span>
    <span className="home-metric-bottom"><span className="home-number">{m.value??'—'}</span><span className="home-unit">{m.unit}</span><ArrowUpRight size={17} aria-hidden="true"/></span>
   </button>)}
  </section>

  <div className="home-lower-grid">
   <section className={`${cardClass} home-recent`} aria-labelledby="home-recent-title">
    <div className="home-section-heading"><h2 id="home-recent-title">继续你的工作</h2><button type="button" className={`${buttonClass} home-text-button`} onClick={()=>navigate({page:'batch'})}>全部任务<ArrowRight size={15} aria-hidden="true"/></button></div>
    <div className="home-task-list" aria-busy={recent.loading}>
     {recent.data?.items.slice(0,4).map(r=>{
      const processed=r.counts.succeeded+r.counts.failed+r.counts.cancelled;
      return <button type="button" key={r.id} className={`${buttonClass} home-task`} onClick={()=>navigate({page:'task',run_id:r.id})}>
       <span className="home-task-icon"><FileText size={20} strokeWidth={1.8} aria-hidden="true"/></span>
       <span className="home-task-copy"><span className="home-task-title">{r.filename||(r.counts.report_total===1?'单份报告质控':'多份报告质控')}</span><span className="home-task-meta">{r.counts.report_total} 份报告<span aria-hidden="true">·</span>{new Date(r.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}<span className="home-task-id">{r.id.slice(0,8)}</span></span></span>
       <span className="home-task-state"><span className={`home-status home-status-${r.status}`}><StatusIcon status={r.status}/>{label(r.status)}</span><span className="home-task-progress">{processed} / {r.counts.units_total} 项</span></span>
       <ArrowUpRight className="home-task-arrow" size={17} aria-hidden="true"/>
      </button>;
     })}
     {recent.loading&&!recent.data&&<div className="home-empty" role="status">正在读取近期任务…</div>}
     {!recent.loading&&!recent.error&&!recent.data?.items.length&&<div className="home-empty"><FileText size={26} strokeWidth={1.3}/><p>从第一份报告开始</p><button type="button" className={buttonClass} onClick={()=>setUpload(true)}>导入报告<ArrowRight size={15}/></button></div>}
     {!!recent.error&&<div className="home-empty">任务暂时无法读取，请刷新重试。</div>}
    </div>
   </section>
   <section className={`${cardClass} home-review`} aria-labelledby="home-review-title">
    <div className="home-section-heading"><h2 id="home-review-title">留一份细心，给复核</h2><ClipboardCheck size={19} strokeWidth={1.8} aria-hidden="true"/></div>
    <div className="home-review-summary">
     <div className="home-review-number"><span className="home-number">{pending??'—'}</span><p>{pending===0?'当前暂无待复核建议':'条建议等待你确认'}</p></div>
     <svg className="home-review-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="39" fill="none" stroke="var(--border)" strokeWidth="9"/>{distributionTotal>0&&distribution.map((n,i)=>{const portion=n/distributionTotal*100,start=offset;offset+=portion;return <circle key={checks[i].key} cx="50" cy="50" r="39" fill="none" stroke={ringColors[i]} strokeWidth="9" pathLength="100" strokeDasharray={`${portion} ${100-portion}`} strokeDashoffset={-start} transform="rotate(-90 50 50)"/>})}<path d="M40 50L47 57L61 43" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round"/></svg>
    </div>
    <div className="home-distribution">{checks.map((c,i)=><div key={c.key}><span><i style={{background:ringColors[i]}}/><CheckIcon branch={c.key} size={14}/>{c.short}</span><span>{summary.data?.review_by_branch?distribution[i]:'—'}</span></div>)}</div>
    <button type="button" className={`${buttonClass} home-review-action`} onClick={()=>navigate({page:'review'})}>进入人工复核<ArrowRight size={16} aria-hidden="true"/></button>
   </section>
  </div>
  <div className="home-bottom-note"><span>原文独立保存，每一次建议都有迹可循。</span><span>CDU-MED Studio</span></div>
  {upload&&<UploadDialog onClose={()=>{setUpload(false);recent.refresh();summary.refresh()}}/>}
 </div>;
}
