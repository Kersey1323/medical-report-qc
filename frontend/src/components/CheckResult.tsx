import {useState} from 'react';
import {ArrowRight,BookOpen,Check,ClipboardCheck,FileText,Pause,X,Pencil,History,FileCode,LockKeyhole} from 'lucide-react';
import {StatusIcon,CheckIcon} from './StatusIcon';
import {appendReview} from '../api';
import {apiRequest,ApiError} from '../api/client';
import type {ResultDTO,ReviewDTO,ReviewType,RunReport} from '../api/types';
import {Panel,Button,ResultBadge,Badge} from './ui';
import {MarkedText} from './MarkedText';
import {ErrorPanel} from './ErrorPanel';
import {EvidenceDrawer} from './EvidenceDrawer';
import {NextReportButton,type ReportNavigationState} from './NextReportButton';
import {checks} from '../domain/checks';

const reviewLabels={accept:'已接受',reject:'已驳回',edit:'已编辑确认',defer:'暂缓'};
export function CheckResult({result,onRefresh,report,onNavigate,navigation}:{result:ResultDTO;onRefresh:()=>void|Promise<void>;report?:RunReport;navigation?:ReportNavigationState;onNavigate?:(id:string)=>Promise<void>}){
 const [evidence,setEvidence]=useState(false),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);
 const [editing,setEditing]=useState(false),[edit,setEdit]=useState(''),[note,setNote]=useState(''),[raw,setRaw]=useState('');
 const o=result.outcome,d=o.details||{};
 const [savedDecision,setSavedDecision]=useState<ReviewDTO>();
 const reviews=savedDecision&&!result.reviews.some(r=>r.id===savedDecision.id)?[...result.reviews,savedDecision]:result.reviews;
 const latest=reviews.filter(r=>r.generation===result.generation).sort((a,b)=>b.revision-a.revision)[0];
 const accepted=latest?.type==='accept';
 const review=async(type:ReviewType)=>{
  if(busy||(type==='accept'&&accepted))return;setBusy(true);setError(undefined);
  try{const saved=await appendReview({...result,review_revision:latest?.revision??result.review_revision},type,type==='edit'?edit:undefined,note);setSavedDecision(saved);setEditing(false);window.dispatchEvent(new Event('medical-qc:updated'));await onRefresh()}
  catch(e){setError(e);if(e instanceof ApiError&&e.code==='revision_conflict')onRefresh()}
  finally{setBusy(false)}
 };
 const showRaw=async(id:string)=>{try{const r=await apiRequest<{text:string;total_bytes:number}>(`/results/${result.id}/attempts/${id}/raw`);setRaw(r.text+(r.total_bytes>1048576?'\n（响应超过1MiB，当前显示首段）':''))}catch(e){setError(e)}};
 const outcomeError=o.error?new ApiError(o.error,'',200):undefined;
 return <>
  <div className="result-layout">
   <section className="document-pane">
    <div className="document-title"><h2 className="flex"><FileText size={17}/>{report?'原始报告':result.source_field==='diagnosis'?'医生原始诊断':'原始影像描述'}</h2><Badge icon={<LockKeyhole size={12} aria-hidden="true"/>}>原文只读</Badge></div>
    {report?<>
     <div className="document-section"><h3>影像描述</h3><p className="report-text">{result.source_field==='description'?<MarkedText source={result.source} spans={o.spans}/>:report.description||'未提供'}</p></div>
     <div className="document-section"><h3>医生诊断</h3><p className="report-text">{result.source_field==='diagnosis'?<MarkedText source={result.source} spans={o.spans}/>:report.diagnosis||'未提供'}</p></div>
    </>:<p className="report-text"><MarkedText source={result.source} spans={o.spans}/></p>}
    {Array.isArray(d.candidate_spans)&&d.candidate_spans.length>0&&<p className="small text-amber-800 mt16">片段多次出现，需核对所有候选位置：{JSON.stringify(d.candidate_spans)}</p>}
    <p className="document-note mt24">高亮片段对应当前检查定位；原始报告独立保存。</p>
   </section>
   <section className="document-pane result-pane">
    <div className="document-title"><h2 className="icon-label"><CheckIcon branch={result.branch}/>{checks.find(c=>c.key===result.branch)?.name}</h2><ResultBadge status={o.status} finding={o.finding}/></div>
    <ErrorPanel error={outcomeError}/>
    {typeof d.reference_diagnosis==='string'&&<div className="document-section"><h3>生成的参考诊断</h3><p className="report-text">{d.reference_diagnosis}</p><p className="document-note mt16">参考内容不等于标准答案。</p></div>}
    {typeof d.corrected_text==='string'&&<div className="document-section"><h3>模型建议</h3><p className="report-text">{d.corrected_text}</p></div>}
    {typeof d.reason==='string'&&<p className="report-text">{d.reason}</p>}
    {result.branch==='diagnosis'&&o.status==='succeeded'&&<p className="document-note mt16">本协议仅提供定位片段，未提供解释。</p>}
    {d.teacher!==undefined&&<div className="document-section"><h3>教师意见</h3>{typeof d.teacher==='string'?<p className="report-text">{d.teacher}</p>:<details><summary className="small">查看教师复核内容</summary><pre>{JSON.stringify(d.teacher,null,2)}</pre></details>}</div>}
    {!!o.suggestions?.length&&<div className="finding"><h3>原文编辑建议</h3>{o.suggestions.map((s,i)=><div className="edit-row" key={i}><Badge tone="blue">{String(i+1).padStart(2,'0')}</Badge><del>{s.before||'〔插入〕'}</del><ArrowRight size={14}/><ins>{s.after||'〔删除〕'}</ins>{s.start!==undefined&&<small className="muted mono">[{s.start},{s.end})</small>}</div>)}</div>}
    {o.status!=='succeeded'&&<p className="small muted mt16">此项尚未完整成功，不能据此判断报告正常。</p>}
    {(result.branch==='cgec'||result.branch==='rag')&&<Button className="mt16" onClick={()=>setEvidence(true)}><BookOpen size={15}/>查看本次检索报告与来源</Button>}
    {result.branch==='csc'&&d.coverage_chars!==undefined&&<div className="coverage"><span>检查覆盖</span><span className="mono">{String(d.coverage_chars)} / {String(d.source_chars)} 字符</span></div>}
   </section>
  </div>
  <section className={`review-controls ${accepted?'review-accepted':''}`} aria-label="人工复核操作">
   <ErrorPanel error={error}/>
   <div className="review-bar">
    <div className="flex"><ClipboardCheck size={17}/><h2>人工复核</h2><span className={`review-decision ${accepted?'accepted':''}`} role="status"><StatusIcon status={latest?.type||'needs_review'} size={16}/>{latest?reviewLabels[latest.type]:'待确认'}{accepted&&<span className="review-saved-label">本项复核已保存</span>}</span></div>
    <div className="review-actions">
     {o.status==='succeeded'&&<><Button variant="subtle" disabled={busy} onClick={()=>void review('defer')}><Pause size={14} aria-hidden="true"/>暂缓</Button><Button disabled={busy} onClick={()=>void review('reject')}><X size={14} aria-hidden="true"/>驳回</Button><Button disabled={busy} onClick={()=>setEditing(v=>!v)}><Pencil size={14} aria-hidden="true"/>编辑后确认</Button><Button variant={accepted?'accepted-action':'primary'} disabled={busy||accepted} onClick={()=>void review('accept')}><Check size={15}/>{busy?'提交中…':accepted?'已接受':'接受建议'}</Button></>}
     <NextReportButton runId={result.run_id} reportId={result.run_report_id} branch={result.branch} disabled={busy} onNavigate={onNavigate} navigation={navigation}/>
    </div>
   </div>
   {o.status==='succeeded'&&<div className="review-note"><label className="flex"><span className="small muted">复核备注</span><input className="input-field grow" value={note} disabled={busy} onChange={e=>setNote(e.target.value)} placeholder="可选，记录判断依据"/></label></div>}
   {editing&&<div className="review-edit"><label className="field"><span className="label">编辑后确认内容</span><textarea className="input-field" rows={3} value={edit} disabled={busy} onChange={e=>setEdit(e.target.value)} placeholder="仅针对本条建议填写"/></label><div className="flex"><Button variant="primary" disabled={busy||!edit.trim()} onClick={()=>void review('edit')}><Check size={14} aria-hidden="true"/>确认修改</Button><Button disabled={busy} onClick={()=>setEditing(false)}><X size={14} aria-hidden="true"/>取消编辑</Button></div></div>}
   {reviews.length>0&&<details className="review-history-section" open><summary><History className="inline-icon" size={14} aria-hidden="true"/>复核历史 · {reviews.length} 条</summary>{reviews.map(r=><div key={r.id} className="review-history"><p>{reviewLabels[r.type]} · 第 {r.generation} 代 · {new Date(r.created_at).toLocaleString()}</p>{r.text&&<p className="report-text">{r.text}</p>}{r.note&&<p>{r.note}</p>}</div>)}</details>}
  </section>
  <Panel className="mt16"><details className="audit"><summary>处理过程与尝试记录 <span className="muted">· 第 {result.generation} 代</span></summary>{result.attempts.map(a=><div className="between" key={a.id}><p>{a.stage} · 尝试 {a.attempt_no} · {a.status}</p><Button variant="subtle sm" onClick={()=>void showRaw(a.id)}><FileCode size={14} aria-hidden="true"/>读取原始响应</Button></div>)}{raw&&<pre>{raw}</pre>}<details className="mt16"><summary>本次方法与输出详情</summary><pre>{JSON.stringify(d,null,2)}</pre></details>{result.versions.length>0&&<details><summary>历史执行代际</summary><pre>{JSON.stringify(result.versions,null,2)}</pre></details>}</details></Panel>
  {evidence&&<EvidenceDrawer resultId={result.id} onClose={()=>setEvidence(false)}/>}
 </>;
}
