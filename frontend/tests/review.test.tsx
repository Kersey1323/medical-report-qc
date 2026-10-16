import {fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {Review} from '../src/pages/Review';

const runA='aaaaaaaa-0000-4000-8000-000000000001';
const runB='bbbbbbbb-0000-4000-8000-000000000002';
const tasks=[
 {run_id:runA,created_at:'2026-10-16T01:00:00Z',status:'completed',filename:'实验验证10份.xlsx',report_total:10,pending_reports:2,pending_results:3},
 {run_id:runB,created_at:'2026-10-15T01:00:00Z',status:'partial',filename:null,report_total:1,pending_reports:1,pending_results:1},
];
const result=(id:string,run:string,source:string)=>({id,run_id:run,run_report_id:'report-'+id,branch:'csc',generation:1,review_revision:0,source_field:'description',source,outcome:{status:'succeeded',finding:'issue',details:{corrected_text:'修正内容'}},attempts:[],reviews:[],versions:[]});
const a=result('result-a',runA,'任务甲报告：血观束清晰');
const a2=result('result-a2',runA,'任务甲下一页：骨折');
const b=result('result-b',runB,'任务乙报告：骨质增生');
function server(){
 let reviewed=false;
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input),'http://localhost');
  let data:unknown;
  if(url.pathname.endsWith('/reviews/tasks')) data={items:reviewed?[tasks[1]]:tasks,total:reviewed?1:2,page:1,page_size:20};
  else if(url.pathname.endsWith('/results')){
   const run=url.searchParams.get('run_id');
   const page=Number(url.searchParams.get('page')||1);
   const items=run===runA?(reviewed?[]:[page===2?a2:a]):run===runB?[b]:[a,b];
   data={items,total:run===runA?(reviewed?0:21):items.length,page,page_size:20};
  }else if(url.pathname.endsWith('/reviews')&&init?.method==='POST'){
   reviewed=true;data={id:'review-a',type:'accept'};
  }else throw new Error('Unexpected API: '+url.pathname);
  return new Response(JSON.stringify({status:'success',data}),{status:200,headers:{'Content-Type':'application/json'}});
 }));
}
afterEach(()=>vi.unstubAllGlobals());

it('lists one row per task and opens only that task’s paginated suggestions',async()=>{
 server();render(<Review/>);
 const table=await screen.findByRole('table',{name:'待复核质控任务'});
 expect(within(table).getAllByRole('row')).toHaveLength(3);
 expect(within(table).getByText('实验验证10份.xlsx')).toBeTruthy();
 expect(screen.queryByText(a.source)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'复核任务 aaaaaaaa'}));
 const queue=await screen.findByRole('region',{name:'任务待复核建议'});
 await within(queue).findByText(a.source);
 expect(screen.queryByText(b.source)).toBeNull();
 fireEvent.click(within(queue).getByRole('button',{name:'下一页'}));
 await within(queue).findByText(a2.source);
 expect(screen.queryByText(a.source)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'返回任务列表'}));
 await screen.findByRole('table',{name:'待复核质控任务'});
 fireEvent.click(screen.getByRole('button',{name:'复核任务 bbbbbbbb'}));
 await screen.findByText(b.source);
 expect(screen.queryByText(a2.source)).toBeNull();
});

it('refreshes task counts after accepting a suggestion and removes completed tasks',async()=>{
 server();render(<Review/>);
 fireEvent.click(await screen.findByRole('button',{name:'复核任务 aaaaaaaa'}));
 const queue=await screen.findByRole('region',{name:'任务待复核建议'});
 fireEvent.click(await within(queue).findByRole('button',{name:new RegExp(a.source)}));
 fireEvent.click(await screen.findByRole('button',{name:'接受建议',exact:true}));
 await screen.findByText('该任务暂无待复核建议');
 expect(screen.queryByRole('button',{name:'接受建议',exact:true})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'返回任务列表'}));
 const table=await screen.findByRole('table',{name:'待复核质控任务'});
 expect(within(table).queryByText('实验验证10份.xlsx')).toBeNull();
 expect(within(table).getAllByRole('row')).toHaveLength(2);
});
