import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {NextReportButton} from '../src/components/NextReportButton';
import {navigate} from '../src/hooks/useHashRoute';
import {getReportNavigation} from '../src/api';
vi.mock('../src/api',()=>({getReportNavigation:vi.fn()}));
vi.mock('../src/hooks/useHashRoute',()=>({navigate:vi.fn()}));
afterEach(()=>vi.clearAllMocks());
it('navigates to the next report in the same task using the supplied target branch',async()=>{
 vi.mocked(getReportNavigation).mockResolvedValue({previous_run_report_id:null,next_run_report_id:'row-21',position:20,total:22});
 render(<NextReportButton runId="run-a" reportId="row-20" branch="cgec"/>);
 fireEvent.click(await screen.findByRole('button',{name:'下一条'}));
 expect(navigate).toHaveBeenCalledWith({page:'report',run_id:'run-a',run_report_id:'row-21',branch:'cgec'});
});
it('keeps task review inside its workspace and exposes navigation failures',async()=>{
 vi.mocked(getReportNavigation).mockResolvedValue({previous_run_report_id:null,next_run_report_id:'row-2',position:1,total:2});
 const onNavigate=vi.fn().mockRejectedValue(new Error('下一份结果暂不可用'));
 render(<NextReportButton runId="run-a" reportId="row-1" branch="csc" onNavigate={onNavigate}/>);
 fireEvent.click(await screen.findByRole('button',{name:'下一条'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('下一份结果暂不可用');
 expect(onNavigate).toHaveBeenCalledWith('row-2');expect(navigate).not.toHaveBeenCalled();
});
it('disables navigation on the last report and while saving a review',async()=>{
 vi.mocked(getReportNavigation).mockResolvedValue({previous_run_report_id:null,next_run_report_id:null,position:1,total:1});
 const view=render(<NextReportButton runId="run-a" reportId="only" branch="csc"/>);
 expect(await screen.findByRole('button',{name:'已是最后一份'})).toBeDisabled();view.unmount();
 vi.mocked(getReportNavigation).mockResolvedValue({previous_run_report_id:null,next_run_report_id:'row-2',position:1,total:2});
 render(<NextReportButton runId="run-b" reportId="row-1" branch="csc" disabled/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'下一条'})).toBeDisabled());
 expect(navigate).not.toHaveBeenCalled();
});

it('navigates backwards and disables both directions on a single report',async()=>{
 vi.mocked(getReportNavigation).mockResolvedValue({previous_run_report_id:'row-19',next_run_report_id:'row-21',position:20,total:22});
 const onNavigate=vi.fn().mockResolvedValue(undefined);
 const view=render(<NextReportButton runId="run-a" reportId="row-20" branch="diagnosis" onNavigate={onNavigate}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'上一条'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'上一条'}));expect(onNavigate).toHaveBeenCalledWith('row-19');
 view.unmount();
 vi.mocked(getReportNavigation).mockResolvedValue({previous_run_report_id:null,next_run_report_id:null,position:1,total:1});
 render(<NextReportButton runId="run-b" reportId="only" branch="diagnosis"/>);
 await screen.findByRole('button',{name:'已是最后一份'});
 expect(screen.getByRole('button',{name:'上一条'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'已是最后一份'})).toBeDisabled();
});
