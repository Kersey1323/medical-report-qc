import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {X,Clock3,FileText,ListChecks,Braces,ScanLine,SpellCheck,TextCursorInput,Search} from 'lucide-react';
import type {CheckKey} from '../api/types';
import type {BranchState} from './SingleTimeline';
import {stageNames} from './SingleTimeline';
import {SingleOutcome} from './SingleOutcome';
import {SingleDetailSection} from './SingleDetailSection';
import {checks,label} from '../domain/checks';
import {Button,ResultBadge} from './ui';

const branchIcons={diagnosis:ScanLine,csc:SpellCheck,cgec:TextCursorInput,rag:Search};
export function SingleDetailsDialog({branch,state,description,diagnosis,requestId,onClose}:{branch:CheckKey;state:BranchState;description:string;diagnosis:string;requestId:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),Icon=branchIcons[branch];
 useEffect(()=>{const opener=document.activeElement as HTMLElement;const el=dialog.current!;el.showModal();return()=>{el.close();if(opener?.isConnected)opener.focus()}},[]);
 return createPortal(<dialog ref={dialog} className="single-details-dialog" aria-label={`${checks.find(c=>c.key===branch)?.short}质控详情`} onCancel={e=>{e.preventDefault();onClose()}}>
  <header className="single-details-header">
   <span className="single-details-icon"><Icon size={23}/></span>
   <div className="single-details-title"><h2>{checks.find(c=>c.key===branch)?.name}</h2><div className="single-details-meta"><span>质控详情</span>{state.elapsed_ms!==undefined&&<span><Clock3 size={13}/>{(state.elapsed_ms/1000).toFixed(1)} 秒</span>}<span><ListChecks size={13}/>{state.stages.length} 条处理记录</span></div></div>
   {state.outcome&&<ResultBadge status={state.outcome.status} finding={state.outcome.finding}/>}
   <Button variant="subtle icon-only" aria-label="关闭详情" onClick={onClose}><X size={19}/></Button>
  </header>
  <div className="single-details-body">
   {state.outcome&&<SingleOutcome branch={branch} outcome={state.outcome} description={description} diagnosis={diagnosis} requestId={requestId}/>}
   <div className="single-detail-resources">
    <SingleDetailSection title="本次报告全文" icon={FileText} meta="原始输入"><div className="single-full-report"><section><h4>影像描述</h4><p className="report-text">{description}</p></section><section><h4>医生诊断</h4><p className="report-text">{diagnosis||'未提供'}</p></section></div></SingleDetailSection>
    <SingleDetailSection title="处理阶段与耗时" icon={ListChecks} meta={`${state.stages.length} 条记录`}>
     <ol className="single-detail-stages">{state.stages.map((s,i)=><li className="single-detail-stage" key={i}><span className="single-stage-number">{String(i+1).padStart(2,'0')}</span><div><strong>{stageNames[s.stage||'']||s.stage||'处理阶段'}</strong>{s.chunk_key&&<p>{s.chunk_key}</p>}{s.detail?.message&&<p>{s.detail.message}</p>}</div><span className="single-stage-state" data-state={s.state}>{label(s.state||'pending')}</span>{s.at&&<time>{new Date(s.at).toLocaleTimeString('zh-CN',{hour12:false})}</time>}</li>)}</ol>
     {!state.stages.length&&<p className="document-note">本项没有返回处理阶段记录。</p>}
    </SingleDetailSection>
    <SingleDetailSection title="完整返回信息与追踪编号" icon={Braces} meta="原始数据"><pre>{JSON.stringify({request_id:requestId,branch,...state},null,2)}</pre></SingleDetailSection>
   </div>
  </div>
 </dialog>,document.body);
}
