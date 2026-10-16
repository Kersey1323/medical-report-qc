import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {ExportAction} from '../src/pages/BatchTasks';
import * as api from '../src/api';
vi.mock('../src/api',()=>({getExport:vi.fn(),requestExport:vi.fn(),listRuns:vi.fn(),getRunReports:vi.fn(),getRun:vi.fn()}));
it('resumes persisted export id after reload instead of creating a duplicate',async()=>{
 sessionStorage.setItem('medical_qc:export:run-1','saved-artifact');
 vi.mocked(api.getExport).mockResolvedValue({id:'saved-artifact',status:'ready',filename:'actual.xlsx'} as never);
 render(<ExportAction runId="run-1"/>);
 await screen.findByRole('button',{name:'下载 XLSX'});expect(api.getExport).toHaveBeenCalledWith('saved-artifact',expect.any(AbortSignal));expect(api.requestExport).not.toHaveBeenCalled();
});
it('offers a new current snapshot while retaining the previous download',async()=>{
 vi.clearAllMocks();sessionStorage.setItem('medical_qc:export:run-2','old-artifact');
 vi.mocked(api.getExport).mockResolvedValue({id:'old-artifact',status:'ready',filename:'old.xlsx',snapshot_at:'2026-10-15T08:00:00Z'} as never);
 vi.mocked(api.requestExport).mockResolvedValue({id:'new-artifact',status:'pending',filename:'new.xlsx'} as never);
 render(<ExportAction runId="run-2"/>);
 await screen.findByRole('button',{name:'下载 XLSX'});
 expect(screen.getByText(/快照/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'重新生成 XLSX'}));
 await waitFor(()=>expect(api.requestExport).toHaveBeenCalledWith('run-2'));
 expect(sessionStorage.getItem('medical_qc:export:run-2')).toBe('new-artifact');
});
