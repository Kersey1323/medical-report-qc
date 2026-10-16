import {useEffect,useState} from 'react';
import type {CheckKey} from '../api/types';
export type Route={page:'home'|'overview'|'single'|'batch'|'review'|'settings'}|{page:'task';run_id:string}|{page:'report';run_id:string;run_report_id:string;branch:CheckKey}|{page:'review_task';run_id:string}|{page:'review_report';run_id:string;run_report_id:string;branch:CheckKey}|{page:'not_found'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseRoute(hash:string):Route{
 const path=hash.replace(/^#\/?/,'').replace(/^\//,'');
 if(!path)return{page:'home'};
 if(['home','overview','single','batch','review','settings'].includes(path))return{page:path as 'overview'};
 const parts=path.split('/');
 if(parts[0]==='review'&&parts[1]==='runs'&&uuid.test(parts[2]||'')){
  if(parts.length===3)return{page:'review_task',run_id:parts[2]};
  if(parts.length===6&&parts[3]==='reports'&&uuid.test(parts[4])&&['diagnosis','csc','cgec','rag'].includes(parts[5]))return{page:'review_report',run_id:parts[2],run_report_id:parts[4],branch:parts[5] as CheckKey};
 }
 if(parts[0]==='runs'&&uuid.test(parts[1]||'')){
  if(parts.length===2)return{page:'task',run_id:parts[1]};
  if(parts.length===5&&parts[2]==='reports'&&uuid.test(parts[3])&&['diagnosis','csc','cgec','rag'].includes(parts[4]))return{page:'report',run_id:parts[1],run_report_id:parts[3],branch:parts[4] as CheckKey};
 }
 return{page:'not_found'};
}
export function serializeRoute(r:Route):string{return r.page==='review_task'?`/review/runs/${r.run_id}`:r.page==='review_report'?`/review/runs/${r.run_id}/reports/${r.run_report_id}/${r.branch}`:r.page==='task'?`/runs/${r.run_id}`:r.page==='report'?`/runs/${r.run_id}/reports/${r.run_report_id}/${r.branch}`:r.page}
export function navigate(r:Route){location.hash=serializeRoute(r)}
export function useHashRoute():[Route,typeof navigate]{
 const [route,setRoute]=useState(()=>parseRoute(location.hash));
 useEffect(()=>{const update=()=>setRoute(parseRoute(location.hash));window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update)},[]);
 return[route,navigate];
}
