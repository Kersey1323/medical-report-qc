import {useState,useRef,useEffect,useCallback} from 'react';
import {Send,RotateCcw,FileText,Square,ChevronDown,ArrowDown} from 'lucide-react';
import {allChecks,checks} from '../domain/checks';
import type {CheckKey} from '../api/types';
import {streamSingle,type SingleEvent} from '../api/single';
import {PageHead,Button} from '../components/ui';
import {CheckIcon} from '../components/StatusIcon';
import {SingleTimeline,type BranchState} from '../components/SingleTimeline';
import {SingleDetailsDialog} from '../components/SingleDetailsDialog';
import {ErrorPanel} from '../components/ErrorPanel';
import './single-report.css';
export const fieldClass='input rounded-xl text-sm font-normal transition-colors duration-200 ease-out';
export function CheckSelector({selected,onChange,disabled=false}:{selected:CheckKey[];onChange:(v:CheckKey[])=>void;disabled?:boolean}){return <div className="check-list">{checks.map(c=><label key={c.key} className="check-option"><input type="checkbox" checked={selected.includes(c.key)} disabled={disabled} onChange={e=>onChange(e.target.checked?[...selected,c.key]:selected.filter(k=>k!==c.key))}/><span><b>{c.name}</b><small>{c.description}</small></span></label>)}</div>}
const initial=():Record<CheckKey,BranchState>=>({diagnosis:{state:'pending',stages:[]},csc:{state:'pending',stages:[]},cgec:{state:'pending',stages:[]},rag:{state:'pending',stages:[]}});
export function SingleReport(){
 const [description,setDescription]=useState(''),[diagnosis,setDiagnosis]=useState(''),[selected,setSelected]=useState<CheckKey[]>([...allChecks]);
 const [requestId,setRequestId]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[submitted,setSubmitted]=useState<{description:string;diagnosis:string;checks:CheckKey[]}>();
 const [branches,setBranches]=useState(initial),[preflight,setPreflight]=useState('pending'),[finish,setFinish]=useState(''),[detailBranch,setDetailBranch]=useState<CheckKey|null>(null),[pinned,setPinned]=useState(true);
 const controller=useRef<AbortController|null>(null),generation=useRef(0),feed=useRef<HTMLDivElement>(null),nearBottom=useRef(true),autoScrolling=useRef(false);
 useEffect(()=>()=>{generation.current++;controller.current?.abort()},[]);
 const followLatest=useCallback(()=>{
  if(!nearBottom.current||!feed.current)return;
  const el=feed.current;
  autoScrolling.current=true;
  el.scrollTo({top:el.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 },[]);
 useEffect(()=>{
  if(!submitted||!feed.current)return;
  const content=feed.current.querySelector('.single-flow');
  if(!content)return;
  let frame=0;
  const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(followLatest)});
  observer.observe(content);
  return()=>{observer.disconnect();cancelAnimationFrame(frame)};
 },[submitted,followLatest]);
 const run=async()=>{
  if(controller.current)return;
  const abort=new AbortController();controller.current=abort;const id=++generation.current;
  const input={description,diagnosis,checks:allChecks.filter(c=>selected.includes(c))};
  setRequestId('');setSubmitted(input);setBranches(initial());setPreflight('pending');setFinish('');setError(undefined);setBusy(true);setDetailBranch(null);nearBottom.current=true;autoScrolling.current=false;setPinned(true);
  const receive=(event:SingleEvent)=>{
   if(id!==generation.current)return;
   if(event.request_id)setRequestId(event.request_id);
   if(event.type==='preflight')setPreflight(event.state||'pending');
   if(event.type==='complete')setFinish(event.state||'completed');
   if(event.branch){const b=event.branch;setBranches(old=>{const current=old[b];
    if(event.type==='branch')return {...old,[b]:{...current,started:true,state:event.state||'running'}};
    if(event.type==='stage'){const stages=current.stages.filter(s=>!(s.stage===event.stage&&s.chunk_key===event.chunk_key));return {...old,[b]:{...current,started:true,stages:[...stages,event]}}}
    if(event.type==='result')return {...old,[b]:{...current,started:true,state:event.outcome!.status,outcome:event.outcome,elapsed_ms:event.elapsed_ms}};
    return old;
   })}
  };
  try{await streamSingle(input,abort.signal,receive)}catch(e){if(id===generation.current){setFinish(abort.signal.aborted?'cancelled':'interrupted');if(!abort.signal.aborted)setError(e)}}
  finally{if(id===generation.current){setBusy(false);controller.current=null;setBranches(old=>Object.fromEntries(Object.entries(old).map(([k,v])=>[k,v.outcome?v:{...v,state:'cancelled',stages:v.stages.map(s=>s.state==='running'||s.state==='retrying'?{...s,state:'cancelled'}:s)}])) as Record<CheckKey,BranchState>)}}
 };
 const reset=()=>{if(busy)return;generation.current++;setSubmitted(undefined);setBranches(initial());setFinish('');setError(undefined);setPreflight('pending');setDetailBranch(null)};
 const inspect=()=>{nearBottom.current=false;autoScrolling.current=false;setPinned(false);const el=feed.current;if(el)el.scrollTo({top:el.scrollTop,behavior:'instant'})};
 const valid=!!description.trim()&&selected.length>0&&(!selected.includes('diagnosis')||!!diagnosis.trim());
 return <div className="page single-page">
  <PageHead title="单份质控"><span className="single-session-note">即时检查 · 不加入任务列表</span>{submitted&&<Button disabled={busy} onClick={e=>{e.preventDefault();reset()}}><RotateCcw size={14}/>新一份检查</Button>}</PageHead>
  <section className={`single-chat ${submitted?'has-timeline':''}`} aria-label="即时质控会话">
   <div className="single-feed" ref={feed}
    onWheel={e=>{if(e.deltaY<0)inspect()}}
    onKeyDown={e=>{if(['ArrowUp','PageUp','Home'].includes(e.key))inspect()}}
    onPointerDown={e=>{if(e.target===e.currentTarget&&e.clientX>=e.currentTarget.getBoundingClientRect().left+e.currentTarget.clientWidth)inspect()}}
    onScroll={()=>{const el=feed.current!;const atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<8;if(atBottom){autoScrolling.current=false;nearBottom.current=true;setPinned(true)}else if(!autoScrolling.current){nearBottom.current=false;setPinned(false)}}}>
    {!submitted?<div className="single-welcome"><span className="single-welcome-icon"><FileText size={30}/></span><h3>这份报告，有哪些细节值得核对？</h3><p>填写影像描述与医生诊断，检查过程和结果会在这里实时呈现。</p><div className="single-capabilities">{checks.map(c=><span key={c.key}><CheckIcon branch={c.key} size={16}/>{c.short}</span>)}</div></div>:<div className="single-flow">
     <details className="single-user-message" onClick={inspect}><summary><span className="single-report-icon"><FileText size={18}/></span><strong>本次报告</strong><span className="single-report-excerpt">{submitted.description}</span><span className="single-report-count">{Array.from(submitted.description).length} 字</span><ChevronDown size={14}/></summary><div className="single-report-full"><div><h4>影像描述</h4><p>{submitted.description}</p></div>{submitted.diagnosis&&<div><h4>医生诊断</h4><p>{submitted.diagnosis}</p></div>}</div></details>
     <SingleTimeline selected={submitted.checks} branches={branches} preflight={preflight} busy={busy} finish={finish} onDetails={setDetailBranch} onInspect={inspect} onAdvance={followLatest}/>
     <ErrorPanel error={error}/>
     {finish==='cancelled'&&<p className="single-end-note" role="status">已停止等待及后续检查。已经发出的模型请求可能仍在结束中。</p>}

    </div>}
   </div>
   {!pinned&&submitted&&<button className="single-scroll-latest" onClick={()=>{nearBottom.current=true;setPinned(true);followLatest()}}><ArrowDown size={14}/>查看最新进展</button>}
   <form className="single-composer" onSubmit={e=>{e.preventDefault();if(valid&&!busy&&!submitted)void run()}}>
    {!submitted&&<fieldset disabled={busy} className="single-checks"><legend className="sr-only">选择检查项目</legend>{checks.map(c=><label key={c.key} title={c.description}><input type="checkbox" checked={selected.includes(c.key)} onChange={e=>setSelected(e.target.checked?[...selected,c.key]:selected.filter(k=>k!==c.key))}/><CheckIcon branch={c.key} size={14}/>{c.short}</label>)}</fieldset>}
    {!submitted&&<div className="single-inputs"><label><span>影像描述 <b>*</b></span><textarea required value={description} disabled={busy} onChange={e=>setDescription(e.target.value)} placeholder="粘贴影像所见 / 检查描述…" maxLength={200000} rows={3}/></label><label><span>医生诊断 {selected.includes('diagnosis')&&<b>*</b>}</span><textarea required={selected.includes('diagnosis')} value={diagnosis} disabled={busy} onChange={e=>setDiagnosis(e.target.value)} placeholder="粘贴医生原始诊断…" maxLength={200000} rows={3}/></label></div>}
    <div className="single-composer-footer"><p>{busy?'请保持本页打开，检查结果将陆续呈现。':submitted?'本次结果仅在当前页面保留；模型建议请人工核对。':'本次检查不保存为任务，刷新或离开页面后结果清空。'}</p>{busy?<Button onClick={()=>controller.current?.abort()}><Square size={14}/>停止检查</Button>:submitted?<Button onClick={e=>{e.preventDefault();reset()}}><RotateCcw size={14}/>检查下一份</Button>:<Button type="submit" variant="primary" disabled={!valid}><Send size={16}/>开始质控</Button>}</div>
   </form>
  </section>
  {detailBranch&&submitted&&<SingleDetailsDialog branch={detailBranch} state={branches[detailBranch]} description={submitted.description} diagnosis={submitted.diagnosis} requestId={requestId} onClose={()=>setDetailBranch(null)}/>}
 </div>;
}
