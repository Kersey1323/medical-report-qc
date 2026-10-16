import {act,renderHook,waitFor,render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {StrictMode} from 'react';
import {useRequest} from '../src/hooks/useRequest';
import {useRunPolling} from '../src/hooks/useRunPolling';
import {UploadDialog} from '../src/components/UploadDialog';
import * as api from '../src/api';
vi.mock('../src/api',()=>({getRun:vi.fn(),getImport:vi.fn(),uploadImport:vi.fn(),confirmImport:vi.fn(),createRun:vi.fn(),startRun:vi.fn()}));
afterEach(()=>vi.clearAllMocks());
it('refresh retains last data and a failed refresh is retryable',async()=>{
 let reject!:(e:Error)=>void;let resolve!:(v:string)=>void;const load=vi.fn().mockResolvedValueOnce('saved').mockImplementationOnce(()=>new Promise((_,r)=>reject=r)).mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockImplementation(()=>new Promise(()=>{}));
 const {result,rerender}=renderHook(({id})=>useRequest(id,load),{initialProps:{id:'a'}});
 await waitFor(()=>expect(result.current.data).toBe('saved'));
 act(()=>result.current.refresh());expect(result.current.data).toBe('saved');
 await act(async()=>reject(new Error('offline')));expect(result.current.data).toBe('saved');expect(result.current.error).toBeDefined();
 act(()=>result.current.refresh());await act(async()=>resolve('fresh'));expect(result.current.data).toBe('fresh');
 rerender({id:'b'});expect(result.current.data).toBeUndefined();
});
it('polls terminal once and ignores a stale route response',async()=>{
 let complete!:(v:unknown)=>void;
 vi.mocked(api.getRun).mockImplementationOnce(()=>new Promise(r=>complete=r)).mockResolvedValue({id:'b',status:'completed',revision:8} as never);
 const {result,rerender,unmount}=renderHook(({id})=>useRunPolling(id),{initialProps:{id:'a'}});
 rerender({id:'b'});await waitFor(()=>expect(result.current.run?.id).toBe('b'));
 await act(async()=>complete({id:'a',status:'running',revision:100}));expect(result.current.run?.id).toBe('b');unmount();
});
it('StrictMode upload shows parsed server file and Escape closes modal',async()=>{
 vi.mocked(api.uploadImport).mockResolvedValue({id:'upload1',status:'ready',filename:'actual.csv',errors:[],columns:['描述','诊断'],preview_rows:[{original_row:2,cells:{描述:'真实上传合成行',诊断:'正常'}}],total_rows:1,confirmed:false,invalid_rows:[],valid_rows:0} as never);
 const close=vi.fn();render(<StrictMode><UploadDialog onClose={close}/></StrictMode>);
 fireEvent.change(screen.getByLabelText(/选择 CSV/),{target:{files:[new File(['x'],'actual.csv',{type:'text/csv'})]}});
 await screen.findByText('真实上传合成行');fireEvent.keyDown(document,{key:'Escape'});expect(close).toHaveBeenCalled();
});
