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
