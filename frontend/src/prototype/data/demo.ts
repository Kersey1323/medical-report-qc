import { ScanLine, Type, SquarePen, ScanSearch } from 'lucide-react';
import type { CheckKey, Report, ModuleResult, Decisions, Filter } from '../types';

export const checks = [
  { key: 'diagnosis', name: '诊断质控', short: '诊断', icon: ScanLine, tone: 'blue', method: '7B 参考生成 · 在线诊断判别', description: '核对影像描述与医生诊断的一致性', location: '本地 + 在线' },
  { key: 'csc', name: '字符纠错', short: '字符', icon: Type, tone: 'green', method: 'CPT + CSC LoRA · C2EC', description: '按标点分块，覆盖整份原始描述', location: '本地' },
  { key: 'cgec', name: '语法纠错', short: '语法', icon: SquarePen, tone: 'indigo', method: '检索增强教师 · 1.5B 学生', description: '识别语序、成分及搭配问题', location: '本地 + 在线' },
  { key: 'rag', name: '知识定位', short: '定位', icon: ScanSearch, tone: 'amber', method: 'Top-10 证据 · 条件复核', description: '依据医学知识定位可疑原文片段', location: '在线' },
] as const;
export const allCheckKeys: CheckKey[] = checks.map(c => c.key);
export const sampleDescription = '两肺纹理清晰。右肺上叶见一枚实性结节，大小约6×5mm，边界尚清。左肺下叶见少许条索壮影。纵隔未见明显肿大淋巴结。双侧胸腔未见积液。与前次检查比较右肺上叶结节未见明显增大较前。';
export const sampleDiagnosis = '1. 左肺上叶实性结节，建议随访。\n2. 左肺下叶少许纤维灶。';
const clean = '两肺纹理清晰，未见明显实质性病灶。纵隔未见明显肿大淋巴结。双侧胸腔未见积液。';
const normal = (): Record<CheckKey, ModuleResult> => ({ diagnosis: { status: 'succeeded', finding: 'no_issue' }, csc: { status: 'succeeded', finding: 'no_issue' }, cgec: { status: 'succeeded', finding: 'no_issue' }, rag: { status: 'succeeded', finding: 'no_issue' } });
export const initialReports: Report[] = [
  { id: 'R-001', name: '胸部 CT 平扫', time: '10:42', source: 'batch', description: sampleDescription, diagnosis: sampleDiagnosis, results: { diagnosis: { status: 'succeeded', finding: 'issue' }, csc: { status: 'succeeded', finding: 'issue' }, cgec: { status: 'succeeded', finding: 'issue' }, rag: { status: 'succeeded', finding: 'needs_review' } } },
  { id: 'R-002', name: '胸部 CT 平扫', time: '10:42', source: 'batch', description: clean, diagnosis: '胸部 CT 平扫未见明显异常。', results: normal() },
  { id: 'R-003', name: '胸部 CT 平扫', time: '10:42', source: 'batch', description: '两肺纹理清晰。左肺下叶见少许条索壮影。双侧胸腔未见积液。', diagnosis: '左肺下叶少许纤维灶。', results: { ...normal(), csc: { status: 'succeeded', finding: 'issue' }, rag: { status: 'failed' } } },
  { id: 'R-004', name: '胸部 CT 平扫', time: '10:42', source: 'batch', description: clean, diagnosis: '胸部 CT 平扫未见明显异常。', results: normal() },
  { id: 'R-005', name: '胸部 CT 平扫', time: '10:42', source: 'batch', description: '右肺上叶见磨玻璃结节，大小约5mm，边界欠清。纵隔未见明显肿大淋巴结。', diagnosis: '右肺上叶结节，建议随访。', results: { ...normal(), rag: { status: 'succeeded', finding: 'needs_review' } } },
  { id: 'R-006', name: '胸部 CT 平扫', time: '10:42', source: 'batch', description: clean, diagnosis: '胸部 CT 平扫未见明显异常。', results: { ...normal(), diagnosis: { status: 'failed' } } },
  { id: 'R-007', name: '胸部 CT 平扫', time: '09:18', source: 'single', description: clean, diagnosis: '胸部 CT 平扫未见明显异常。', results: normal() },
  { id: 'R-008', name: '胸部 CT 平扫', time: '09:04', source: 'single', description: clean, diagnosis: '胸部 CT 平扫未见明显异常。', results: normal() },
];
export const isIncomplete = (r: Report) => Object.values(r.results).some(v => v.status !== 'succeeded');
export const hasIssue = (r: Report) => Object.values(r.results).some(v => v.finding === 'issue');
export const needsReview = (r: Report) => Object.values(r.results).some(v => v.finding === 'needs_review');
export const decisionKey = (id: string, key: CheckKey) => `${id}:${key}`;
export function suggestions(reports: Report[], decisions: Decisions) {
  return reports.flatMap(report => checks.filter(m => ['issue', 'needs_review'].includes(report.results[m.key].finding ?? '')).map(module => ({ report, module, decision: decisions[decisionKey(report.id, module.key)] })));
}
export const pendingSuggestions = (reports: Report[], decisions: Decisions) => suggestions(reports, decisions).filter(s => !s.decision || s.decision.type === 'defer');
export function filterReports(reports: Report[], filter: Filter, query: string) {
  return reports.filter(r => `${r.id} ${r.name}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'issue' && hasIssue(r) || filter === 'review' && needsReview(r) || filter === 'partial' && isIncomplete(r) || filter === 'normal' && !hasIssue(r) && !needsReview(r) && !isIncomplete(r)));
}
export function suggestionDetail(r: Report, key: CheckKey) {
  if (key === 'diagnosis') return { source: '左肺上叶', target: '右肺上叶', title: '结节侧别不一致', reason: '影像描述为“右肺上叶”，医生诊断记录为“左肺上叶”。建议核对诊断中的侧别。', reference: '1. 右肺上叶实性结节，建议结合既往影像随访。\n2. 左肺下叶少许纤维灶。', field: '医生诊断' };
  if (key === 'csc') return { source: '条索壮影', target: '条索状影', title: '发现疑似错别字', reason: '“条索壮影”中的“壮”疑为形近字误用，候选为“状”。仅替换字符，保留其余原文。', reference: '分块 1 / 1 · 按原文位置回映射 · 未截断报告', field: '影像描述' };
  if (key === 'cgec') return { source: '与前次检查比较右肺上叶结节未见明显增大较前', target: '与前次检查比较，右肺上叶结节未见明显增大', title: '比较句表达重复', reason: '“与前次检查比较”与句末“较前”语义重复，建议删除句末重复成分，并补充停顿。', reference: '教师参考：与前次检查比较，右肺上叶结节未见明显增大。\n学生候选：与前次检查比较，右肺上叶结节未见明显增大。', field: '影像描述' };
  return { source: r.id === 'R-005' ? '边界欠清' : '未见明显增大较前', target: '', title: '候选片段需人工确认', reason: '定位分支返回候选片段，但现有示例证据不足以确认错误。保留原文，交由人工复核；不输出确定的替换结论。', reference: '第一轮返回候选片段；未触发“首轮无错误”条件，因此不进行第二轮复核。', field: '影像描述' };
}
export function exportCsv(reports: Report[]) {
  const rows = [['报告编号', '原始描述', '医生诊断', '检查完整性', ...checks.map(c => c.name)]];
  for (const r of reports) rows.push([r.id, r.description, r.diagnosis, isIncomplete(r) ? '不完整' : '完整', ...checks.map(c => { const v = r.results[c.key]; return v.status === 'failed' ? '执行失败' : v.status !== 'succeeded' ? '未完成' : v.finding === 'issue' ? '发现异常' : v.finding === 'needs_review' ? '需复核' : '未发现异常'; })]);
  const safe = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(safe).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = '质控结果_合成示例.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
