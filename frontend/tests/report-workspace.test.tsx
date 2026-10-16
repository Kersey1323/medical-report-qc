import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {getResult,getRunReports} from '../src/api';
import {useReportWorkspace} from '../src/hooks/useReportWorkspace';
import type {CheckKey,ResultDTO,RunReport} from '../src/api/types';
vi.mock('../src/api',()=>({getResult:vi.fn(),getRunReports:vi.fn()}));
const branches:CheckKey[]=['diagnosis','csc','cgec','rag'];
const row=(id='row-a'):RunReport=>({id,run_id:'run-a',report_id:'report-'+id,original_row:2,description:'原始描述',diagnosis:'原始诊断',extra_fields:{},errors:[],invalid:false,completeness:'complete',anomaly:'issue',results:Object.fromEntries(branches.map(branch=>[branch,{id:id+'-'+branch,status:'succeeded',finding:'issue'}]))});
const result=(id:string):ResultDTO=>({id,run_id:'run-a',run_report_id:id.slice(0,id.lastIndexOf('-')),branch:id.split('-').at(-1) as CheckKey,generation:1,review_revision:0,source_field:'description',source:id,outcome:{status:'succeeded',finding:'issue'},attempts:[],reviews:[],versions:[]});
function setup(){
 vi.mocked(getRunReports).mockImplementation(async(_id,_page,_signal,filter)=>({items:[row(filter?.split('=').at(-1))],page:1,page_size:20,total:1}));
 vi.mocked(getResult).mockImplementation(async id=>result(id));
}
afterEach(()=>vi.resetAllMocks());
it('reads source once, preloads branches, and switches without clearing cached results',async()=>{
 setup();
 const view=renderHook(({branch})=>useReportWorkspace('run-a','row-a',branch,1),{initialProps:{branch:'csc' as CheckKey}});
 await waitFor(()=>expect(view.result.current.result?.id).toBe('row-a-csc'));
 expect(getRunReports).toHaveBeenCalledTimes(1);expect(getResult).toHaveBeenCalledTimes(4);
 view.rerender({branch:'rag'});
 expect(view.result.current.result?.id).toBe('row-a-rag');expect(view.result.current.loading).toBe(false);
 view.rerender({branch:'csc'});
 expect(view.result.current.result?.id).toBe('row-a-csc');expect(getResult).toHaveBeenCalledTimes(4);
});
it('rejects late responses from another report and never exposes its review actions',async()=>{
 setup();let finish!:(r:ResultDTO)=>void;
 vi.mocked(getResult).mockImplementation(id=>id.startsWith('row-a')?new Promise(resolve=>{if(id.endsWith('csc'))finish=resolve}):Promise.resolve(result(id)));
 const view=renderHook(({report})=>useReportWorkspace('run-a',report,'csc',1),{initialProps:{report:'row-a'}});
 await waitFor(()=>expect(getResult).toHaveBeenCalledTimes(4));
 view.rerender({report:'row-b'});expect(view.result.current.result).toBeUndefined();
 await waitFor(()=>expect(view.result.current.result?.id).toBe('row-b-csc'));
 await act(async()=>finish(result('row-a-csc')));
 expect(view.result.current.result?.id).toBe('row-b-csc');
});
it('isolates branch failures and retries without hiding successful branches',async()=>{
 setup();vi.mocked(getResult).mockImplementation(async id=>{if(id.endsWith('rag'))throw Error('定位读取失败');return result(id)});
 const view=renderHook(({branch})=>useReportWorkspace('run-a','row-a',branch,1),{initialProps:{branch:'csc' as CheckKey}});
 await waitFor(()=>expect(view.result.current.result?.id).toBe('row-a-csc'));
 expect(view.result.current.error).toBeUndefined();view.rerender({branch:'rag'});
 await waitFor(()=>expect(view.result.current.error).toEqual(Error('定位读取失败')));
 expect(view.result.current.loading).toBe(false);
 vi.mocked(getResult).mockImplementation(async id=>result(id));
 act(()=>view.result.current.retry());
 await waitFor(()=>expect(view.result.current.result?.id).toBe('row-a-rag'));
});
it('refreshes saved review data and invalidates cached branches on a task revision',async()=>{
 setup();const view=renderHook(({revision})=>useReportWorkspace('run-a','row-a','csc',revision),{initialProps:{revision:1}});
 await waitFor(()=>expect(view.result.current.result?.id).toBe('row-a-csc'));
 vi.mocked(getResult).mockImplementation(async id=>({...result(id),review_revision:2}));
 await act(async()=>view.result.current.refresh());expect(view.result.current.result?.review_revision).toBe(2);
 expect(getRunReports).toHaveBeenCalledTimes(1);
 view.rerender({revision:2});expect(view.result.current.result).toBeUndefined();
 await waitFor(()=>expect(view.result.current.result?.id).toBe('row-a-csc'));
 expect(getRunReports).toHaveBeenCalledTimes(2);
});
