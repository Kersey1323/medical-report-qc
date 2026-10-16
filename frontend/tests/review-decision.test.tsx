import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {CheckResult} from '../src/components/CheckResult';
import {appendReview} from '../src/api';
import type {ResultDTO,ReviewDTO} from '../src/api/types';
vi.mock('../src/api',()=>({appendReview:vi.fn(),getReportNavigation:vi.fn(),getEvidence:vi.fn()}));
const decision:ReviewDTO={id:'review-1',module_result_id:'unit',generation:1,revision:1,type:'accept',text:null,note:null,operator:'test',created_at:'2026-10-16T01:00:00Z'};
const result:ResultDTO={id:'unit',run_id:'task',run_report_id:'row',branch:'csc',generation:1,review_revision:0,source_field:'description',source:'测试原文',outcome:{status:'succeeded',finding:'issue'},reviews:[],attempts:[],versions:[]};
const navigation={data:{previous_run_report_id:null,next_run_report_id:null,position:1,total:1},loading:false,refresh:()=>{}};
afterEach(()=>vi.resetAllMocks());
it('shows persisted acceptance clearly and blocks repeated acceptance',()=>{
 render(<CheckResult result={{...result,review_revision:1,reviews:[decision]}} onRefresh={()=>{}} navigation={navigation}/>);
 const accept=screen.getByRole('button',{name:'已接受',exact:true});expect(accept).toBeDisabled();
 expect(screen.getByText('本项复核已保存')).toBeVisible();fireEvent.click(accept);expect(appendReview).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'驳回',exact:true})).toBeEnabled();
});
it('keeps successful acceptance disabled even when refreshing the result fails',async()=>{
 vi.mocked(appendReview).mockResolvedValue(decision);
 render(<CheckResult result={result} onRefresh={async()=>{throw Error('刷新失败')}} navigation={navigation}/>);
 fireEvent.click(screen.getByRole('button',{name:'接受建议',exact:true}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'已接受',exact:true})).toBeDisabled());
 expect(await screen.findByRole('alert')).toHaveTextContent('刷新失败');
 fireEvent.click(screen.getByRole('button',{name:'已接受',exact:true}));expect(appendReview).toHaveBeenCalledTimes(1);
});
it('uses the latest decision and inference generation rather than old acceptance',()=>{
 const view=render(<CheckResult result={{...result,review_revision:2,reviews:[decision,{...decision,id:'review-2',revision:2,type:'reject'}]}} onRefresh={()=>{}} navigation={navigation}/>);
 expect(screen.getByRole('button',{name:'接受建议',exact:true})).toBeEnabled();
 view.rerender(<CheckResult result={{...result,generation:2,reviews:[decision]}} onRefresh={()=>{}} navigation={navigation}/>);
 expect(screen.getByRole('button',{name:'接受建议',exact:true})).toBeEnabled();expect(screen.queryByText('本项复核已保存')).toBeNull();
});
