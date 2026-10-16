import {fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {Review,TaskReview} from '../src/pages/Review';
import {navigate} from '../src/hooks/useHashRoute';
vi.mock('../src/hooks/useHashRoute',()=>({navigate:vi.fn()}));
const run='aaaaaaaa-0000-4000-8000-000000000001';
const report='bbbbbbbb-0000-4000-8000-000000000002';
const row={id:report,run_id:run,report_id:'source-a',original_row:2,description:'同一报告原文，字符和定位两项待复核',diagnosis:'诊断',results:{csc:{id:'csc-a',status:'succeeded',finding:'issue'},rag:{id:'rag-a',status:'succeeded',finding:'issue'}},pending_results:2,pending_branches:['csc','rag']};
function server(){
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
  const url=new URL(String(input),'http://localhost');let data;
  if(url.pathname.endsWith('/reviews/tasks'))data={items:[{run_id:run,filename:'测试任务.csv',created_at:'2026-10-16T01:00:00Z',report_total:2,pending_reports:1,pending_results:2,status:'completed'}],total:1,page:1,page_size:20};
  else if(url.pathname.endsWith('/reports')){const all=url.searchParams.get('review_state')==='all';const page=url.searchParams.get('page');data={items:page==='2'?[{...row,id:'second-page',description:'第二页报告'}]:all?[row,{...row,id:'done',description:'已复核报告',pending_results:0,pending_branches:[]}]:[row],total:all?2:21,page:1,page_size:20};}
  else if(url.pathname.endsWith('/runs/'+run))data={id:run,filename:'测试任务.csv',counts:{report_total:22}};
  else throw Error('Unexpected API '+url.pathname);
  return new Response(JSON.stringify({status:'success',data}),{headers:{'Content-Type':'application/json'}});
 }));
}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()});
it('keeps task aggregation and opens the task report list',async()=>{
 server();render(<Review/>);
 const table=await screen.findByRole('table',{name:'待复核质控任务'});
 await within(table).findByText('测试任务.csv');expect(within(table).getAllByRole('row')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'复核任务 aaaaaaaa'}));
 expect(navigate).toHaveBeenCalledWith({page:'review_task',run_id:run});
});
it('renders one row per report and opens the full report at the selected check',async()=>{
 server();render(<TaskReview runId={run}/>);
 const table=screen.getByRole('table',{name:'任务复核报告'});
 await within(table).findByText(row.description);expect(within(table).getAllByRole('row')).toHaveLength(2);
 expect(screen.getByText('2 项待复核')).toBeVisible();expect(screen.queryByRole('region',{name:'任务待复核建议'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'复核报告 bbbbbbbb'}));
 expect(navigate).toHaveBeenLastCalledWith({page:'review_report',run_id:run,run_report_id:report,branch:'csc'});
 fireEvent.click(screen.getByRole('button',{name:'复核检索结果 bbbbbbbb'}));
 expect(navigate).toHaveBeenLastCalledWith({page:'review_report',run_id:run,run_report_id:report,branch:'rag'});
});
it('paginates reports, offers reviewed reports, and returns to task aggregation',async()=>{
 server();render(<TaskReview runId={run}/>);await screen.findByText(row.description);
 fireEvent.click(screen.getByRole('button',{name:'下一页'}));await screen.findByText('第二页报告');
 fireEvent.click(screen.getByRole('button',{name:'全部报告',exact:true}));await screen.findByText('已复核报告');
 expect(screen.getByText('无待复核项')).toBeVisible();
 await waitFor(()=>expect(screen.getByRole('button',{name:'上一页'})).toBeDisabled());
 fireEvent.click(screen.getByRole('button',{name:'返回任务列表'}));expect(navigate).toHaveBeenLastCalledWith({page:'review'});
});
