import type {SourceSpan} from '../api/types';
export function splitMarkedText(source:string,spans:SourceSpan[]){
 const chars=Array.from(source);for(const s of spans)if(s.start<0||s.end<s.start||s.end>chars.length||chars.slice(s.start,s.end).join('')!==s.text)throw Error('定位区间与原文不符');
 const boundaries=[...new Set([0,chars.length,...spans.flatMap(s=>[s.start,s.end])])].sort((a,b)=>a-b);
 const out:Array<{text:string;marked:boolean;start:number;end:number;span_ids:string[];insertion?:boolean}>=[];
 for(let i=0;i<boundaries.length;i++){
  const start=boundaries[i];for(const [id,s]of spans.entries())if(s.start===start&&s.end===start)out.push({text:'',marked:true,start,end:start,span_ids:[String(id)],insertion:true});
  if(i===boundaries.length-1)break;const end=boundaries[i+1];const ids=spans.flatMap((s,id)=>s.start<=start&&s.end>=end&&s.start!==s.end?[String(id)]:[]);
  out.push({text:chars.slice(start,end).join(''),marked:!!ids.length,start,end,span_ids:ids});
 }return out;
}
