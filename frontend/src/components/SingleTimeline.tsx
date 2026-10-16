import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Check,Clock3,LoaderCircle,Square,TriangleAlert,ShieldCheck,ChevronDown,ArrowUpRight} from 'lucide-react';
import type {CheckKey} from '../api/types';
import type {SingleEvent,SingleOutcome} from '../api/single';
import {checks,label} from '../domain/checks';
import {CheckIcon} from './StatusIcon';
import {Button,ResultBadge} from './ui';

export const stageNames:Record<string,string>={'diagnosis.generate':'生成参考诊断','diagnosis.judge':'核对诊断一致性','csc.correct':'分块字符纠错','retrieval':'检索与重排医学报告','cgec.teacher':'教师分析与参考修正','cgec.student':'生成语法修正建议','rag.first':'定位原文可疑片段','rag.second':'复核定位结果'};
export interface BranchState {started?:boolean;state:string;stages:SingleEvent[];outcome?:SingleOutcome;elapsed_ms?:number}
function StateIcon({state}:{state:string}){return state==='succeeded'?<Check size={13}/>:state==='running'||state==='retrying'?<LoaderCircle className="single-spinner" size={13}/>:state==='failed'?<TriangleAlert size={13}/>:state==='cancelled'?<Square size={11}/>:<Clock3 size={13}/>}
export function outcomePreview(outcome:SingleOutcome){
 const d=outcome.details||{};
 if(outcome.status!=='succeeded')return outcome.error?.message||'本项未返回完整结果，请重新检查。';
 if(typeof d.reference_diagnosis==='string'&&d.reference_diagnosis)return d.reference_diagnosis;
 if(typeof d.corrected_text==='string'&&d.corrected_text)return d.corrected_text;
 if(typeof d.reason==='string'&&d.reason)return d.reason;
 return outcome.finding==='no_issue'?'本项检查未发现异常。':'请结合原文位置与检查建议核对。';
}
export function SingleTimeline({selected,branches,preflight,busy,finish,onDetails,onInspect,onAdvance}:{selected:CheckKey[];branches:Record<CheckKey,BranchState>;preflight:string;busy:boolean;finish:string;onDetails:(key:CheckKey)=>void;onInspect:()=>void;onAdvance:()=>void}){
 const timeline=useRef<HTMLOListElement>(null);
 const [shown,setShown]=useState(1);
 const preflightDone=['succeeded','failed'].includes(preflight);
 // Only real lifecycle events unlock cards; future checks never get placeholders.
 let available=preflightDone?2:1;
 const progressed=selected.filter(b=>branches[b].started||branches[b].outcome||branches[b].stages.length);
 const entries=progressed.map(b=>{const process=++available;const output=branches[b].outcome?++available:undefined;return {b,process,output}});
 useEffect(()=>{
  if(shown>=available)return;
  const delay=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:240;
  const timer=window.setTimeout(()=>setShown(value=>value+1),delay);
  return()=>window.clearTimeout(timer);
 },[shown,available]);
 useLayoutEffect(()=>{
  const cards=timeline.current?.querySelectorAll<HTMLElement>('.timeline-card:not([data-reveal])')||[];
  if(!window.IntersectionObserver||window.matchMedia('(prefers-reduced-motion: reduce)').matches){cards.forEach(card=>card.dataset.reveal='visible');return}
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){(entry.target as HTMLElement).dataset.reveal='visible';observer.unobserve(entry.target)}}),{root:timeline.current?.closest('.single-feed'),threshold:0.06});
  // Re-observe cards still below the viewport when another card arrives.
  cards.forEach(card=>card.dataset.reveal='pending');
  timeline.current?.querySelectorAll<HTMLElement>('[data-reveal="pending"]').forEach(card=>observer.observe(card));
  return()=>observer.disconnect();
 },[shown]);
 useEffect(()=>{onAdvance()},[shown,onAdvance]);
 const readyState=busy&&preflight==='pending'?'running':!busy&&['pending','running'].includes(preflight)?'cancelled':preflight;
 return <section className="single-timeline-message" aria-label="实时质控过程">
  <div className="single-message-caption"><ShieldCheck size={16}/>质控过程<span role="status">{busy?'正在处理':shown<available?'正在呈现结果':finish==='completed'?'检查完成':finish==='partial'?'部分完成':finish==='failed'?'检查失败':finish==='cancelled'?'已停止':'检查中断'}</span></div>
  <div className="paired-timeline-labels" aria-hidden="true"><span>检查流程</span><span>流程输出</span></div>
  <ol className="single-timeline paired-timeline" ref={timeline}>
   <li className={`single-timeline-node ${readyState}`}>
    <div className="timeline-process timeline-card"><div className="timeline-card-meta"><span className="timeline-number">01 · 服务预检</span><span className="timeline-state"><StateIcon state={readyState}/>{label(readyState)}</span></div><div className="timeline-card-heading"><span className="timeline-icon"><ShieldCheck size={18}/></span><h3>检查服务与模型</h3></div><p className="timeline-subtext">连接服务，确认本次检查所需模型是否可用。</p></div>
    <span className="single-node-dot" aria-hidden="true"><StateIcon state={readyState}/></span>
    {preflightDone&&shown>=2&&<div className={`timeline-output timeline-card tone-${preflight==='failed'?'error':'success'}`}><div className="timeline-card-meta"><span>01 · 预检输出</span><span className="timeline-state">{preflight==='succeeded'?'服务就绪':'部分服务不可用'}</span></div><div className="timeline-card-heading"><h3>{preflight==='succeeded'?'已就绪，可以开始检查':'部分服务需要检查'}</h3></div><p className="timeline-subtext">{preflight==='succeeded'?'预检通过，按所选项目执行检查。':preflight==='failed'?'可用项目继续执行，不可用项目将返回失败原因。':busy?'正在确认连接与模型状态。':'预检未完整完成，不能视为通过。'}</p></div>}
   </li>
   {entries.filter(entry=>entry.process<=shown).map(({b,output})=>{const index=selected.indexOf(b),state=branches[b],check=checks.find(c=>c.key===b)!,outcome=state.outcome;
    return <li key={b} className={`single-timeline-node ${state.state}`} data-branch={b} data-finding={outcome?.finding}>
     <div className="timeline-process timeline-card">
      <div className="timeline-card-meta"><span className="timeline-number">{String(index+2).padStart(2,'0')} · {check.short}检查</span><span className="timeline-state"><StateIcon state={state.state}/>{state.state==='pending'?'等待检查':state.state==='cancelled'?'未完成':label(state.state)}</span></div><div className="timeline-card-heading"><span className="timeline-icon"><CheckIcon branch={b} size={18}/></span><h3>{check.name}</h3></div>
      <div className="timeline-process-meta"><span>{check.description}</span>{state.elapsed_ms!==undefined&&<span>{(state.elapsed_ms/1000).toFixed(1)}s</span>}</div>
      {!!state.stages.length&&<details className="single-stage-list" open={state.state==='running'} onClick={onInspect}><summary>{state.state==='running'?'当前处理阶段':`${state.stages.length} 个处理阶段`}</summary><div className="timeline-stage-entries">{state.stages.map((s,i)=><div key={`${s.stage}:${s.chunk_key}`}><StateIcon state={s.state||'pending'}/><span>{stageNames[s.stage||'']||s.stage}{s.chunk_key&&` · 片段 ${i+1}`}{s.reused?' · 复用本次检索':''}{(s.attempt||0)>1?` · 第 ${s.attempt} 次尝试`:''}{s.detail&&<small>{s.detail.message}</small>}</span><time>{s.at?new Date(s.at).toLocaleTimeString('zh-CN',{hour12:false}):''}</time></div>)}</div></details>}
     </div>
     <span className="single-node-dot" aria-hidden="true"><StateIcon state={state.state}/></span>
     {outcome&&output!==undefined&&shown>=output&&<article className={`timeline-output timeline-card tone-${outcome.status==='failed'?'error':outcome.finding==='issue'||outcome.finding==='needs_review'?'warning':outcome.finding==='no_issue'?'success':'neutral'}`} aria-label={`${check.short}流程输出`}>
      <details className="timeline-output-expand" onClick={onInspect}>
       <summary aria-label={`展开${check.short}输出`}><span className="timeline-card-meta"><span>{String(index+2).padStart(2,'0')} · 检查输出</span><ResultBadge status={outcome.status} finding={outcome.finding}/></span><span className="timeline-card-heading"><h3>{outcome.status!=='succeeded'?'本项检查未完成':b==='diagnosis'?'诊断核对结果':b==='csc'?'字符修正建议':b==='cgec'?'语法修正建议':'检索定位结果'}</h3><ChevronDown className="timeline-expand-icon" size={15}/></span><span className="timeline-output-preview">{outcomePreview(outcome)}</span><span className="timeline-expand-label">展开更多内容</span></summary>
       <div className="timeline-output-more"><p>{outcomePreview(outcome)}</p>{!!outcome.suggestions?.length&&<ul>{outcome.suggestions.slice(0,3).map((s,i)=><li key={i}>{s.before||'〔插入〕'} → {s.after||'〔删除〕'}</li>)}</ul>}{typeof outcome.details?.reason==='string'&&outcome.details.reason!==outcomePreview(outcome)&&<p>{outcome.details.reason}</p>}<p className="timeline-subtext">{outcome.suggestions?.length?`${outcome.suggestions.length} 条修改建议 · `:''}完整原文、建议与相关依据可在详情中查看。</p></div>
      </details>
      <div className="timeline-output-actions"><Button variant="subtle sm" aria-label={`查看${check.short}详情`} onClick={()=>{onInspect();onDetails(b)}}>查看详情<ArrowUpRight size={14}/></Button></div>
     </article>}
    </li>;
   })}
  </ol>
 </section>;
}
