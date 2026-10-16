import {useState} from 'react';
import {ArrowRight,BookOpen,Copy,Check,FileText,Sparkles,MessageSquareText} from 'lucide-react';
import type {CheckKey} from '../api/types';
import type {SingleOutcome as Outcome} from '../api/single';
import {ApiError} from '../api/client';
import {MarkedText} from './MarkedText';
import {ErrorPanel} from './ErrorPanel';
import {Button} from './ui';
import {SingleDetailSection} from './SingleDetailSection';
import {checks} from '../domain/checks';

export function SingleOutcome({outcome,branch,description,diagnosis,requestId}:{requestId:string;outcome:Outcome;branch:CheckKey;description:string;diagnosis:string}){
 const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState<unknown>();
 const d=outcome.details||{},source=branch==='diagnosis'?diagnosis:description;
 const correction=typeof d.corrected_text==='string'?d.corrected_text:typeof d.reference_diagnosis==='string'?d.reference_diagnosis:'';
 const evidence=outcome.evidence?.filter(e=>e.used).sort((a,b)=>(a.used_rank||0)-(b.used_rank||0))||[];
 return <section className="single-result" aria-label={`${checks.find(c=>c.key===branch)?.short}检查结果`}>
  <ErrorPanel error={outcome.error?new ApiError(outcome.error,requestId,200):undefined}/>
  <div className="single-result-columns">
   <section className="single-comparison-panel"><header><h4><FileText size={16}/>{branch==='diagnosis'?'医生原始诊断':'原始影像描述'}</h4><span>原文</span></header><div className="single-comparison-text"><p className="report-text"><MarkedText source={source} spans={outcome.spans}/></p></div></section>
   <section className="single-comparison-panel is-suggestion"><header><h4><Sparkles size={16}/>{branch==='diagnosis'?'生成的参考诊断':'检查建议'}</h4>{correction&&<Button variant="subtle sm" onClick={async()=>{try{await navigator.clipboard.writeText(correction);setCopied(true);setCopyError(undefined)}catch(e){setCopyError(e)}}}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'已复制':branch==='diagnosis'?'复制参考诊断':'复制建议文本'}</Button>}</header><div className="single-comparison-text"><p className="report-text">{correction||(typeof d.reason==='string'?d.reason:outcome.status!=='succeeded'?'本项未完整完成，请查看错误详情。':outcome.finding==='no_issue'?'未发现异常。':'请核对原文中的高亮位置。')}</p>{branch==='diagnosis'&&<p className="single-comparison-note">参考诊断仅供核对，不等于标准答案。</p>}<ErrorPanel error={copyError}/></div></section>
  </div>
  {typeof d.reason==='string'&&correction&&<p className="single-explanation">{d.reason}</p>}
  {!!outcome.suggestions?.length&&<div className="single-edits"><h4>修改对照 <span>{outcome.suggestions.length} 处建议</span></h4>{outcome.suggestions.map((s,i)=><div className="edit-row" key={i}><del>{s.before||'〔插入〕'}</del><ArrowRight size={14}/><ins>{s.after||'〔删除〕'}</ins></div>)}</div>}
  {d.coverage_chars!==undefined&&<p className="document-note mt16">已检查 {String(d.coverage_chars)} / {String(d.source_chars)} 字符</p>}
  {d.teacher!==undefined&&<SingleDetailSection title="教师参考意见" icon={MessageSquareText}><pre>{JSON.stringify(d.teacher,null,2)}</pre></SingleDetailSection>}
  {(Array.isArray(d.fact_changes)&&d.fact_changes.length>0||d.mapping_ambiguous===true)&&<p className="single-explanation">建议涉及医学事实或位置映射风险，请结合原始报告人工核对。</p>}
  {(branch==='rag'||branch==='cgec')&&<SingleDetailSection title="检索报告与来源" icon={BookOpen} meta={`${evidence.length} 条证据`}>{evidence.map(e=><article className="single-evidence" key={e.id}><h4>{e.used_rank}. {e.candidate.doc_id||e.candidate.node_id}</h4><p className="report-text">{e.candidate.full_report_text||e.candidate.text}</p><p className="document-note">{e.candidate.full_report_text?'原报告全文':'索引片段'} · 节点 {e.candidate.node_id} · 重排分数 {e.candidate.rerank_score??'未记录'}</p><details><summary>来源详情</summary><pre>{JSON.stringify(e.candidate.provenance,null,2)}</pre></details></article>)}{!evidence.length&&<p className="document-note">本项没有可用的检索证据。</p>}</SingleDetailSection>}

 </section>;
}
