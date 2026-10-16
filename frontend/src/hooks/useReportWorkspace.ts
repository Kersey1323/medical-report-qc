import {useEffect,useRef,useState} from 'react';
import {getResult,getRunReports} from '../api';
import type {CheckKey,ResultDTO,RunReport} from '../api/types';

type Workspace={key:string;row?:RunReport;rowError?:unknown;results:Partial<Record<CheckKey,ResultDTO>>;errors:Partial<Record<CheckKey,unknown>>};

// A report's four branches share one source request. Results are read in parallel
// and retained until the report or task revision changes, including tab switches.
export function useReportWorkspace(runId:string,reportId:string,branch:CheckKey,revision?:number){
 const key=JSON.stringify([runId,reportId,revision]);
 const [workspace,setWorkspace]=useState<Workspace>();
 const [retry,setRetry]=useState(0);
 const controller=useRef<AbortController | undefined>(undefined);
 useEffect(()=>{
  if(revision===undefined)return;
  const request=new AbortController();controller.current=request;
  setWorkspace({key,results:{},errors:{}});
  const update=(change:(old:Workspace)=>Workspace)=>{
   if(!request.signal.aborted)setWorkspace(old=>old?.key===key?change(old):old);
  };
  void getRunReports(runId,1,request.signal,'&run_report_id='+reportId).then(async page=>{
   const row=page.items.find(item=>item.id===reportId);
   if(!row)throw Error('报告不存在或不属于此任务');
   update(old=>({...old,row}));
   await Promise.allSettled(Object.entries(row.results).map(async([name,unit])=>{
    const check=name as CheckKey;
    try{
     const result=await getResult(unit.id,request.signal);
     update(old=>({...old,results:{...old.results,[check]:result}}));
    }catch(error){update(old=>({...old,errors:{...old.errors,[check]:error}}))}
   }));
  }).catch(rowError=>update(old=>({...old,rowError})));
  return()=>request.abort();
 },[runId,reportId,revision,key,retry]);
 const current=workspace?.key===key?workspace:undefined;
 const row=current?.row;
 const result=current?.results[branch];
 const error=current?.rowError||current?.errors[branch];
 const loading=!error&&(!row||!!row.results[branch]&&!result);
 const refresh=async()=>{
  if(!result)return;
  const request=controller.current;
  const updated=await getResult(result.id,request?.signal);
  if(!request?.signal.aborted)setWorkspace(old=>old?.key===key?{...old,results:{...old.results,[branch]:updated}}:old);
 };
 return {row,result,error,loading,refresh,retry:()=>setRetry(value=>value+1)};
}
