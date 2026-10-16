import {useEffect,useState} from 'react';
import {getRun} from '../api';
import type {RunDTO} from '../api/types';
export function useRunPolling(id:string){
 const [run,setRun]=useState<RunDTO>();const [error,setError]=useState<unknown>();const [tick,setTick]=useState(0);
 useEffect(()=>{let active=true;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;setRun(undefined);setError(undefined);
 const poll=async()=>{try{const next=await getRun(id,controller.signal);if(!active)return;setRun(old=>!old||next.revision>=old.revision?next:old);setError(undefined);if(['pending','running'].includes(next.status))timer=setTimeout(poll,2000)}catch(e){if(active){setError(e);timer=setTimeout(poll,2000)}}};void poll();
 return()=>{active=false;controller.abort();clearTimeout(timer)}},[id,tick]);
 return{run,error,loading:!run&&!error,refresh:()=>setTick(x=>x+1)};
}
