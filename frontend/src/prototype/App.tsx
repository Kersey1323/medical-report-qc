import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckKey, Decisions, Filter, ReviewType, Task } from './types';
import { allCheckKeys, checks, decisionKey, initialReports, pendingSuggestions, suggestionDetail, isIncomplete } from './data/demo';
import { StudioShell } from './components/StudioShell';
import { EvidenceDrawer, HelpDialog, Modal, UploadDialog } from './components/Overlays';
import { Button } from './components/ui';
import { Overview } from './pages/Overview';
import { SingleReport, fieldClass } from './pages/SingleReport';
import { BatchTasks, TaskDetail } from './pages/BatchTasks';
import { ReportDetail } from './pages/ReportDetail';
import { Review } from './pages/Review';
import { Settings } from './pages/Settings';

const initialTasks: Task[] = [
  { id: 'QC-1015-001', name: '胸部CT_合成样例.csv', reports: 6, time: '10-15 10:42', status: 'partial' },
  { id: 'QC-1015-002', name: '单份报告检查', reports: 2, time: '10-15 09:18', status: 'completed' },
];
export default function App() {
  const [hash, setHash] = useState(location.hash.slice(1) || 'overview');
  const [reports, setReports] = useState(initialReports), [decisions, setDecisions] = useState<Decisions>({});
  const [defaultChecks, setDefaultChecks] = useState<CheckKey[]>([...allCheckKeys]), [demoChecks, setDemoChecks] = useState<CheckKey[]>([...allCheckKeys]);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [overlay, setOverlay] = useState<'upload' | 'help' | 'evidence' | 'edit' | null>(null);
  const [evidenceKind, setEvidenceKind] = useState<CheckKey>('rag');
  const [evidenceReportId, setEvidenceReportId] = useState('R-001');
  const [edit, setEdit] = useState({ id: '', key: 'diagnosis' as CheckKey, text: '', note: '' });
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((text: string) => { setMessage(text); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setMessage(''), 4000); }, []);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  const navigate = useCallback((path: string) => { location.hash = path; }, []);
  useEffect(() => { const update = () => setHash(location.hash.slice(1) || 'overview'); window.addEventListener('hashchange', update); return () => { window.removeEventListener('hashchange', update); if (timer.current) clearTimeout(timer.current); }; }, []);
  useEffect(() => { const main = document.getElementById('main'); main?.scrollTo(0, 0); main?.focus({ preventScroll: true }); }, [hash]);
  const running = tasks.some(t => t.status === 'running');
  useEffect(() => { if (!running) return; const id = setInterval(() => setTasks(current => current.map(t => t.status !== 'running' ? t : { ...t, progress: Math.min((t.progress ?? 0) + 1, 6), status: (t.progress ?? 0) >= 5 ? 'partial' : 'running' })), 1800); return () => clearInterval(id); }, [running]);
  const [route, query = ''] = hash.split('?'), [rawPage, id, branch] = route.split('/');
  const page = ['overview', 'single', 'batch', 'task', 'report', 'review', 'settings'].includes(rawPage) ? rawPage : 'overview';
  const selectedBranch: CheckKey = checks.some(c => c.key === branch) ? branch as CheckKey : 'diagnosis';
  const onEvidence = (reportId: string, key: CheckKey) => { setEvidenceReportId(reportId); setEvidenceKind(key); setOverlay('evidence'); };
  const review = (reportId: string, key: CheckKey, type: ReviewType, note?: string) => {
    if (type === 'edit') { const r = reports.find(r => r.id === reportId)!; const detail = suggestionDetail(r, key); setEdit({ id: reportId, key, text: decisions[decisionKey(reportId, key)]?.text || detail.target || detail.source, note: note || '' }); setOverlay('edit'); return; }
    setDecisions(d => ({ ...d, [decisionKey(reportId, key)]: { type, note } }));
    notify(type === 'accept' ? '已记录人工选择；原始报告与模型建议保持独立。' : type === 'reject' ? '已驳回本条建议，保留原始记录。' : '已暂缓，仍保留在待复核队列。');
  };
  const retry = (reportId?: string, key?: CheckKey) => {
    setReports(current => current.map(r => ({ ...r, results: Object.fromEntries(Object.entries(r.results).map(([k, v]) => [k, v.status === 'failed' && (!reportId || reportId === r.id) && (!key || key === k) ? { status: 'succeeded', finding: 'no_issue' } : v])) as typeof r.results })));
    notify('模拟重试完成：仅更新失败分支，未调用模型服务。');
  };
  const task = tasks.find(t => t.id === id) || tasks[0];
  const derivedTask = task.id === 'QC-1015-001' ? { ...task, status: reports.filter(r => r.source === 'batch').some(isIncomplete) ? 'partial' as const : 'completed' as const } : task;
  const report = reports.find(r => r.id === id) || reports[0];
  const downloadTemplate = () => { const blob = new Blob(['\uFEFF报告编号,影像描述,医生诊断\r\n示例001,"两肺纹理清晰，未见明显实质性病灶。","胸部CT平扫未见明显异常。"'], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = '医学报告导入模板_示例.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  let content;
  if (page === 'single') content = <SingleReport key={hash} sample={id === 'sample'} defaultChecks={defaultChecks} onRun={keys => { setDemoChecks(keys); navigate(`report/demo/${keys[0]}`); }} />;
  else if (page === 'batch') content = <BatchTasks tasks={tasks.map(t => t.id === 'QC-1015-001' ? { ...t, status: reports.filter(r => r.source === 'batch').some(isIncomplete) ? 'partial' : 'completed' } : t)} navigate={navigate} onUpload={() => setOverlay('upload')} onTemplate={downloadTemplate} />;
  else if (page === 'task') content = <TaskDetail key={`${id}:${query}`} task={derivedTask} reports={reports} navigate={navigate} initialFilter={new URLSearchParams(query).get('filter') === 'partial' ? 'partial' as Filter : 'all'} onRetryAll={() => retry()} onCancel={() => { setTasks(ts => ts.map(t => t.id === id ? { ...t, status: 'cancelled' } : t)); notify('已停止演示进度，预置结果仍可查看。'); }} />;
  else if (page === 'report') content = <ReportDetail report={report} checkKey={selectedBranch} decisions={decisions} navigate={navigate} onReview={review} onEvidence={onEvidence} onRetry={retry} demo={id === 'demo'} enabled={id === 'demo' ? demoChecks : allCheckKeys} />;
  else if (page === 'review') content = <Review reports={reports} decisions={decisions} navigate={navigate} onReview={review} onEvidence={onEvidence} />;
  else if (page === 'settings') content = <Settings defaults={defaultChecks} onSave={setDefaultChecks} notify={notify} />;
  else content = <Overview reports={reports} decisions={decisions} navigate={navigate} onUpload={() => setOverlay('upload')} onSample={() => navigate('single/sample')} />;
  return <><StudioShell active={page} taskCount={tasks.length} pendingCount={pendingSuggestions(reports, decisions).length} onHelp={() => setOverlay('help')}>{content}</StudioShell>
    {overlay === 'help' && <HelpDialog onClose={closeOverlay} />}
    {overlay === 'evidence' && <EvidenceDrawer kind={evidenceKind} reportId={evidenceReportId} onClose={closeOverlay} />}
    {overlay === 'upload' && <UploadDialog onClose={closeOverlay} notify={notify} onCreate={(name, keys) => { const taskId = `DEMO-${String(tasks.length + 1).padStart(3, '0')}`; setTasks(ts => [{ id: taskId, name, reports: 6, time: '10-15 11:06', status: 'running', progress: 0, checks: keys }, ...ts]); setOverlay(null); navigate(`task/${taskId}`); notify('演示任务已创建，使用内置合成报告。'); }} />}
    {overlay === 'edit' && <Modal title="编辑后确认" onClose={closeOverlay} footer={<><Button onClick={closeOverlay}>取消</Button><Button variant="primary" disabled={!edit.text.trim()} onClick={() => { setDecisions(d => ({ ...d, [decisionKey(edit.id, edit.key)]: { type: 'edit', text: edit.text, note: edit.note } })); setOverlay(null); notify('人工确认稿已保存到本次原型，原文及模型记录未覆盖。'); }}>保存人工确认稿</Button></>}><p className="reason mb-4">{edit.id} · {checks.find(c => c.key === edit.key)?.name} · 仅编辑本条建议片段</p><label className="field"><span className="label">人工确认内容</span><textarea className={`${fieldClass} textarea`} value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} /></label><label className="field"><span className="label">复核备注</span><textarea className={`${fieldClass} textarea`} value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })} placeholder="选填" /></label></Modal>}
    {message && <div className="toast" role="status" aria-live="polite">{message}</div>}
  </>;
}
