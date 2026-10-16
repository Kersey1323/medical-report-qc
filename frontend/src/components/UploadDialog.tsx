import {useEffect,useRef,useState} from 'react';
import {Upload,FileUp,X,RotateCcw,Check,Columns3} from 'lucide-react';
import {uploadImport,getImport,confirmImport,createRun,startRun} from '../api';
import type {ImportDTO,CheckKey} from '../api/types';
import {allChecks} from '../domain/checks';
import {CheckSelector,fieldClass} from '../pages/SingleReport';
import {Button} from './ui';
import {ErrorPanel} from './ErrorPanel';
import {navigate} from '../hooks/useHashRoute';
export function UploadDialog({onClose}:{onClose:()=>void}){
 const [data,setData]=useState<ImportDTO>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);const [desc,setDesc]=useState(''),[diag,setDiag]=useState(''),[selected,setSelected]=useState<CheckKey[]>([...allChecks]);const input=useRef<HTMLInputElement>(null);const alive=useRef(true);
 const modal=useRef<HTMLElement>(null);const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{alive.current=true;const old=document.activeElement as HTMLElement;input.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close.current();if(e.key==='Tab'){const els=Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')||[]);const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};document.addEventListener('keydown',key);return()=>{alive.current=false;document.removeEventListener('keydown',key);old?.focus()}},[]);
 const id=data?.id;const status=data?.status;
 useEffect(()=>{if(!id||!['pending','running'].includes(status||''))return;const c=new AbortController();let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const next=await getImport(id,c.signal);if(c.signal.aborted)return;setData(next);if(['pending','running'].includes(next.status))timer=setTimeout(poll,2000)}catch(e){if(!c.signal.aborted){setError(e);timer=setTimeout(poll,2000)}}};timer=setTimeout(poll,1000);return()=>{c.abort();clearTimeout(timer)}},[id,status]);
 const upload=async(file:File)=>{setBusy(true);setError(undefined);try{const result=await uploadImport(file);if(alive.current){setData(result);sessionStorage.setItem('medical_qc:last_import',result.id)}}catch(e){setError(e)}finally{setBusy(false)}};
 const resume=async()=>{const id=sessionStorage.getItem('medical_qc:last_import');if(!id)return;try{setData(await getImport(id))}catch(e){setError(e)}};
 const confirm=async()=>{setBusy(true);setError(undefined);try{const confirmation=await confirmImport(data!.id,desc,diag||null,selected);setData(await getImport(data!.id));if(!confirmation.report_ids.length)throw Error('没有有效报告，请重新上传并检查必填字段');const run=await createRun({import_id:data!.id,checks:selected});try{await startRun(run.id)}catch(e){setError(e)}navigate({page:'task',run_id:run.id});onClose()}catch(e){setError(e)}finally{setBusy(false)}};
 const previewRows=data?.preview_rows.slice(0,5)||[];
 const columnWidth=(column:string)=>column===desc||column===diag||/描述|诊断|所见|结论|description|diagnosis/i.test(column)?280:/序号|编号|^id$/i.test(column)?120:160;
 return <div className="modal-backdrop"><section ref={modal} className="modal import-modal" role="dialog" aria-modal="true" aria-label="导入批量报告">
  <div className="modal-head"><h2 className="icon-label"><Upload size={17} aria-hidden="true"/>导入批量报告</h2><Button aria-label="关闭导入" onClick={onClose}><X size={15} aria-hidden="true"/>关闭</Button></div>
  <div className="modal-body">
   <div className="import-steps"><span className={!data?'active':''}><Upload size={14} aria-hidden="true"/>1 选择文件</span><span aria-hidden="true">›</span><span className={data?'active':''}><Columns3 size={14} aria-hidden="true"/>2 字段映射与检查</span></div>
   <ErrorPanel error={error}/>
   {!data?<>
    <label className="upload-zone"><FileUp className="upload-icon" size={28} aria-hidden="true"/><b>选择 CSV 或 XLSX 文件</b><small>UTF-8 CSV · 首个工作表 · 最大20MiB / 10000行</small><input ref={input} type="file" accept=".csv,.xlsx" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f)}}/></label>
    <Button variant="subtle mt16" onClick={()=>void resume()}><RotateCcw size={15} aria-hidden="true"/>恢复上次导入</Button>
   </>:<>
    <p className="import-file-summary"><span title={data.filename}>{data.filename}</span><span className="muted">{data.status==='ready'?'解析完成':data.status==='failed'?'解析失败':'后台解析中，可关闭此窗口'}</span></p>
    {data.errors.map((e,i)=><p role="alert" key={i}>{e.message}</p>)}
    {data.status==='ready'&&<>
     <div className="mapping-grid">
      <label className="field"><span className="label">描述列 *</span><select className={fieldClass} value={desc} disabled={busy} onChange={e=>setDesc(e.target.value)}><option value="">请选择列</option>{data.columns.map(c=><option key={c}>{c}</option>)}</select></label>
      <label className="field"><span className="label">诊断列 {selected.includes('diagnosis')&&'*'}</span><select className={fieldClass} value={diag} disabled={busy} onChange={e=>setDiag(e.target.value)}><option value="">不映射</option>{data.columns.map(c=><option key={c}>{c}</option>)}</select></label>
     </div>
     <div className="import-preview-heading"><h3>数据预览</h3><span className="small muted">共 {data.total_rows} 行 · 预览前 {previewRows.length} 行，长文本仅显示摘要</span></div>
     <div className="table-scroll import-preview" tabIndex={0} role="region" aria-label="导入数据预览">
      <table className="data-table" style={{width:80+data.columns.reduce((sum,c)=>sum+columnWidth(c),0)}}>
       <colgroup><col style={{width:80}}/>{data.columns.map(c=><col key={c} style={{width:columnWidth(c)}}/>)}</colgroup>
       <thead><tr><th>原始行号</th>{data.columns.map(c=><th key={c} title={c}>{c}</th>)}</tr></thead>
       <tbody>{previewRows.map(r=><tr key={r.original_row}><td className="mono">{r.original_row}</td>{data.columns.map(c=><td key={c}><span className="import-cell-summary">{r.cells[c]||'—'}</span></td>)}</tr>)}</tbody>
      </table>
     </div>
     <div className="import-preview-heading"><h3>检查项目</h3><span className="small muted">已选 {selected.length} 项</span></div>
     <CheckSelector selected={selected} onChange={setSelected} disabled={busy}/>
     {data.confirmed&&<p className="small muted">有效 {data.valid_rows} 行，无效 {data.invalid_rows.length} 行。</p>}
    </>}
   </>}
  </div>
  {data?.status==='ready'&&<div className="import-footer">
   <span className="small muted">{!desc?'请选择影像描述对应的列':selected.includes('diagnosis')&&!diag?'诊断检查需要映射诊断列':!selected.length?'请至少选择一项检查':'将导入全部报告，保留无效行及原因'}</span>
   <Button variant="primary" disabled={busy||!desc||!selected.length||(selected.includes('diagnosis')&&!diag)} onClick={()=>void confirm()}><Check size={15} aria-hidden="true"/>{busy?'正在确认…':'确认映射并创建任务'}</Button>
  </div>}
 </section></div>;
}
