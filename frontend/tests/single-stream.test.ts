import {afterEach,it,expect,vi} from 'vitest';
import {streamSingle,type SingleEvent} from '../src/api/single';
const input={description:'合成报告',diagnosis:'',checks:['csc' as const]};
const envelope=(data:unknown)=>JSON.stringify({status:'success',data,request_id:'test'})+'\n';
afterEach(()=>vi.unstubAllGlobals());
it('decodes fragmented UTF-8 events and requires an explicit completion',async()=>{
 const text=envelope({type:'stage',branch:'csc',stage:'csc.correct',state:'running'})+envelope({type:'result',branch:'csc',outcome:{status:'succeeded',finding:'no_issue',details:{corrected_text:'合成报告'}}})+envelope({type:'complete',state:'completed'});
 const bytes=new TextEncoder().encode(text);
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close()}}),{headers:{'content-type':'application/x-ndjson'}})));
 const events:SingleEvent[]=[];await streamSingle(input,new AbortController().signal,e=>events.push(e));
 expect(events.map(e=>e.type)).toEqual(['stage','result','complete']);expect(events[1].outcome?.details?.corrected_text).toBe('合成报告');
});
it('retains received results but never treats a truncated stream as complete',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(envelope({type:'result',branch:'csc',outcome:{status:'succeeded',finding:'no_issue'}}),{headers:{'content-type':'application/x-ndjson'}})));
 const events:SingleEvent[]=[];await expect(streamSingle(input,new AbortController().signal,e=>events.push(e))).rejects.toMatchObject({code:'stream_interrupted'});expect(events).toHaveLength(1);
});
it('surfaces the HTTP-200 error envelope and malformed stream',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({status:'error',request_id:'trace',detail:{code:'single_busy',message:'稍后再试',stage:'single.admission',retryable:true}}),{headers:{'content-type':'application/json'}})).mockResolvedValueOnce(new Response('invalid\n',{headers:{'content-type':'application/x-ndjson'}}));vi.stubGlobal('fetch',fetcher);
 await expect(streamSingle(input,new AbortController().signal,()=>{})).rejects.toMatchObject({code:'single_busy',request_id:'trace'});
 await expect(streamSingle(input,new AbortController().signal,()=>{})).rejects.toMatchObject({code:'stream_interrupted'});
});
