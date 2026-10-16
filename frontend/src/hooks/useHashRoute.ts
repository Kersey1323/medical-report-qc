import {useEffect,useState} from 'react';
import type {CheckKey} from '../api/types';
export type Route={page:'overview'|'single'|'batch'|'review'|'settings'}|{page:'task';run_id:string}|{page:'report';run_id:string;run_report_id:string;branch:CheckKey}|{page:'not_found'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseRoute(hash:string):Route{
 const path=hash.replace(/^#\/?/,'').replace(/^\//,'');
 if(!path)return{page:'overview'};
 if(['overview','single','batch','review','settings'].includes(path))return{page:path as 'overview'};
 const parts=path.split('/');
 if(parts[0]==='runs'&&uuid.test(parts[1]||'')){
  if(parts.length===2)return{page:'task',run_id:parts[1]};
  if(parts.length===5&&parts[2]==='reports'&&uuid.test(parts[3])&&['diagnosis','csc','cgec','rag'].includes(parts[4]))return{page:'report',run_id:parts[1],run_report_id:parts[3],branch:parts[4] as CheckKey};
 }
 return{page:'not_found'};
}
export function serializeRoute(r:Route):string{return r.page==='task'?`/runs/${r.run_id}`:r.page==='report'?`/runs/${r.run_id}/reports/${r.run_report_id}/${r.branch}`:r.page}
export function navigate(r:Route){location.hash=serializeRoute(r)}
export function useHashRoute():[Route,typeof navigate]{
 const [route,setRoute]=useState(()=>parseRoute(location.hash));
 useEffect(()=>{const update=()=>setRoute(parseRoute(location.hash));window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update)},[]);
 return[route,navigate];
}
