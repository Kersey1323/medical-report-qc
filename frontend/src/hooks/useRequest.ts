import {useEffect,useState,useRef,useCallback} from 'react';
export function useRequest<T>(key:string,load:(signal:AbortSignal)=>Promise<T>){
 const [data,setData]=useState<T>();const [loading,setLoading]=useState(true);const [error,setError]=useState<unknown>();const [revision,setRevision]=useState(0);const loader=useRef(load);loader.current=load;const previousKey=useRef(key);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError(undefined);if(previousKey.current!==key)setData(undefined);previousKey.current=key;
 loader.current(controller.signal).then(value=>{if(!controller.signal.aborted)setData(value)}).catch(e=>{if(!controller.signal.aborted)setError(e)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
 return()=>controller.abort()},[key,revision]);
 const refresh=useCallback(()=>setRevision(x=>x+1),[]);
 return{data,loading,error,refresh};
}
