import {splitMarkedText} from '../domain/spans';
import type {SourceSpan} from '../api/types';
export function MarkedText({source,spans=[]}:{source:string;spans?:SourceSpan[]}){
 try{return <>{splitMarkedText(source,spans).map((s,i)=>s.marked?<mark key={i} data-start={s.start} data-end={s.end} title={s.insertion?'建议插入位置':undefined}>{s.insertion?<span aria-label="建议插入位置">▏</span>:s.text}</mark>:<span key={i}>{s.text}</span>)}</>}
 catch{return <>{source}<span className="badge red">定位不可用，请复核</span></>}
}
