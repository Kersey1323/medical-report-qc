import { it,expect } from 'vitest';
import { splitMarkedText } from '../src/domain/spans';
import { parseRoute,serializeRoute } from '../src/hooks/useHashRoute';
it('marks only second code point match',()=>{
 const segments=splitMarkedText('𠮷灶。𠮷灶。',[{start:3,end:5,text:'𠮷灶'}]);
 expect(segments.filter(s=>s.marked).map(s=>s.text)).toEqual(['𠮷灶']);expect(segments.find(s=>s.marked)?.start).toBe(3);
});
it('keeps task and report identity',()=>{
 const route={page:'report' as const,run_id:'00000000-0000-4000-8000-000000000001',run_report_id:'00000000-0000-4000-8000-000000000002',branch:'rag' as const};
 expect(parseRoute(serializeRoute(route))).toEqual(route);expect(parseRoute('/runs/bad')).toEqual({page:'not_found'});
});
it('round-trips review task/report deep links and rejects malformed identities',()=>{
 const run_id='00000000-0000-4000-8000-000000000001',run_report_id='00000000-0000-4000-8000-000000000002';
 const task={page:'review_task' as const,run_id};
 const report={page:'review_report' as const,run_id,run_report_id,branch:'csc' as const};
 expect(parseRoute(serializeRoute(task))).toEqual(task);
 expect(parseRoute(serializeRoute(report))).toEqual(report);
 expect(parseRoute('/review/runs/bad')).toEqual({page:'not_found'});
 expect(parseRoute(`/review/runs/${run_id}/reports/${run_report_id}/other`)).toEqual({page:'not_found'});
});
