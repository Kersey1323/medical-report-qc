import { it,expect,vi } from 'vitest';
import { apiRequest,ApiError,downloadArtifact } from '../src/api/client';
it('throws typed errors for HTTP 200/error',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'error',data:null,request_id:'r',detail:{code:'revision_conflict',message:'版本变化',stage:'review',retryable:false}}),{status:200,headers:{'Content-Type':'application/json'}})));
 try{await apiRequest('/results/one');throw Error('missing rejection')}catch(e){expect(e).toBeInstanceOf(ApiError);expect((e as ApiError).code).toBe('revision_conflict');expect((e as ApiError).http_status).toBe(200)}
});
it('does not download JSON errors as XLSX',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'error',detail:{code:'artifact_not_ready',message:'未生成',stage:'export',retryable:true},request_id:'r'}),{headers:{'Content-Type':'application/json'}})));
 await expect(downloadArtifact('x')).rejects.toBeInstanceOf(ApiError);
});
it('queries failed tasks as success data',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'success',data:{status:'failed'},request_id:'r',detail:null}))));
 expect(await apiRequest('/runs/x')).toEqual({status:'failed'});
});
