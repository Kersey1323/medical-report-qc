import { useEffect, useRef, useState, useId } from 'react';
import type { ReactNode } from 'react';
import { X, Upload, FileText, Check, ArrowRight, BookOpen, Info } from 'lucide-react';
import type { CheckKey, Notify } from '../types';
import { allCheckKeys, initialReports } from '../data/demo';
import { retrievedReportExamples } from '../data/retrieved-reports';
import { Badge, Button, InfoLine } from './ui';
import { CheckOptions, fieldClass } from '../pages/SingleReport';

export function Modal({ title, children, footer, onClose, drawer = false, wide = false }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; drawer?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex="0"]') || [])];
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } if (e.key === 'Tab') { const items = focusable(), first = items[0], last = items.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } };
    document.addEventListener('keydown', key);
    const root = document.querySelector<HTMLElement>('.studio-shell'); if (root) root.inert = true;
    return () => { document.removeEventListener('keydown', key); if (root) root.inert = false; previous?.focus(); };
  }, [onClose]);
  return <div className={drawer ? 'drawer-backdrop' : 'modal-backdrop'} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className={drawer ? `drawer ${wide ? 'drawer-wide' : ''}` : 'modal'} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-head"><h2 id={titleId}>{title}</h2><Button variant="subtle icon-only" aria-label="关闭弹窗" onClick={onClose}><X size={18} /></Button></div><div className={drawer ? 'drawer-body' : 'modal-body'}>{children}</div>{footer && <div className="modal-foot">{footer}</div>}</div></div>;
}
export function UploadDialog({ onClose, onCreate, notify }: { onClose: () => void; onCreate: (name: string, checks: CheckKey[]) => void; notify: Notify }) {
  const [step, setStep] = useState(1), [fileName, setFileName] = useState(''), [selected, setSelected] = useState<CheckKey[]>([...allCheckKeys]);
  const [descriptionColumn, setDescriptionColumn] = useState('影像描述'), [diagnosisColumn, setDiagnosisColumn] = useState('医生诊断');
  return <Modal title="新建批量任务" onClose={onClose} footer={<><Button onClick={() => step === 1 ? onClose() : setStep(1)}>{step === 1 ? '取消' : '上一步'}</Button><Button variant="primary" disabled={step === 1 ? !fileName : !selected.length || selected.includes('diagnosis') && diagnosisColumn === descriptionColumn} onClick={() => step === 1 ? setStep(2) : onCreate(fileName, selected)}>{step === 1 ? '下一步：确认检查' : '创建演示任务'}<ArrowRight size={14} /></Button></>}>
    <div className="steps"><span className={`step ${step === 1 ? 'active' : ''}`}><b>{step > 1 ? <Check size={12} /> : '1'}</b>导入报告</span><span className="step-line" /><span className={`step ${step === 2 ? 'active' : ''}`}><b>2</b>确认检查</span></div>
    {step === 1 ? <><label className="upload-zone"><span className="upload-symbol"><Upload size={23} /></span><b>{fileName || '选择 CSV / XLSX 文件'}</b><small>仅显示文件名，不读取文件内容 · 或使用下方合成样例</small><input className="sr-only" type="file" accept=".csv,.xlsx" onChange={e => { const f = e.target.files?.[0]; if (f) { if (!/\.(csv|xlsx)$/i.test(f.name)) { notify('请选择 CSV 或 XLSX 文件'); return; } setFileName(f.name); } }} /></label><div className="between mt16"><span className="text-caption">想先看看效果？</span><button className="btn-link" onClick={() => setFileName('胸部CT_合成样例.csv')}><FileText size={14} />使用 6 份合成报告</button></div>{fileName && <><div className="mapping-grid"><label className="field"><span className="label">影像描述列</span><select className={`${fieldClass} select wfull`} value={descriptionColumn} onChange={e => setDescriptionColumn(e.target.value)}><option>影像描述</option><option>医生诊断</option></select></label><label className="field"><span className="label">医生诊断列</span><select className={`${fieldClass} select wfull`} value={diagnosisColumn} onChange={e => setDiagnosisColumn(e.target.value)}><option>医生诊断</option><option>影像描述</option></select></label></div><span className="text-caption">预览：内置合成数据（非上传文件内容）</span><div className="table-scroll mt16"><table className="data-table"><thead><tr><th>行号</th><th>报告编号</th><th>影像描述</th></tr></thead><tbody>{initialReports.slice(0, 2).map((r, i) => <tr key={r.id}><td>{i + 2}</td><td>{r.id}</td><td>{r.description.slice(0, 24)}…</td></tr>)}</tbody></table></div></>}</> : <><div className="info-line"><FileText size={16} /><span className="grow">{fileName}</span><Badge>6 份合成报告</Badge></div><div className="mt16"><CheckOptions selected={selected} onChange={setSelected} /></div>{selected.includes('diagnosis') && descriptionColumn === diagnosisColumn && <div className="input-error">描述和诊断不能映射为同一列，请返回修改。</div>}<div className="mt16"><InfoLine>这里只模拟进度与任务创建；切换页面可继续观察。关闭 HTML 后演示状态重置。</InfoLine></div></>}
  </Modal>;
}
const evidence = [
  { title: '影像报告中的部位与侧别表达', tag: '诊断表述', content: '报告描述与诊断中的解剖部位和左右侧别应保持一致。存在不一致时，需要回到原始影像与医生记录核对。' },
  { title: '医学影像术语：条索状影', tag: '术语示例', content: '“条索状影”是一种形态描述。本条目用来演示原文片段与知识条目的关联展示。' },
  { title: '影像随访中的比较表达', tag: '报告语言', content: '比较描述应保留比较对象及变化方向，避免同一比较关系重复表达。知识证据不能替代对原报告的人工判断。' },
];
export function EvidenceDrawer({ onClose, kind, reportId }: { onClose: () => void; kind: string; reportId: string }) {
  if (kind === 'rag') return <Modal title="RAG 检索 · Top-10 参考报告" onClose={onClose} drawer wide>
    <div className="retrieval-context">
      <div className="between"><div className="flex wrap"><Badge tone="blue">检索对象 {reportId}</Badge><span className="text-caption">{retrievedReportExamples.length} 份参考报告 · 按检索排名</span></div><Badge>合成示例 · 未连接检索</Badge></div>
      <p className="reason mt16">完整展示参考报告正文及来源记录，供对照与溯源。</p>
    </div>
    <ol className="retrieved-reports" aria-label="RAG 检索 Top-10 参考报告">
      {retrievedReportExamples.map(report => <li className="retrieved-report" key={report.reportId}>
        <article aria-labelledby={`reference-${report.reportId}`}>
          <div className="between"><div className="flex"><span className="retrieval-rank">{String(report.rank).padStart(2, '0')}</span><h3 id={`reference-${report.reportId}`}>{report.title}</h3></div><span className="mono text-caption">{report.reportId}</span></div>
          <div className="retrieved-report-label">报告原文</div>
          <p className="retrieved-report-content">{report.content}</p>
          <dl className="retrieved-report-source"><div><dt>来源文件</dt><dd>{report.sourceFile}</dd></div><div><dt>来源位置</dt><dd>第 {report.sourceRecord} 条记录</dd></div></dl>
        </article>
      </li>)}
    </ol>
  </Modal>;
  return <Modal title={kind === 'cgec' ? '语法纠错 · 检索参考' : '知识证据'} onClose={onClose} drawer><div className="flex wrap"><Badge tone="blue">合成知识条目</Badge><Badge>仅用于布局审核</Badge></div><p className="reason mt16">实际系统会展示检索来源、原文片段、重排得分与索引版本。以下条目未接入真实知识库。</p>{evidence.map((e, i) => <article className="evidence-item" key={e.title}><div className="between"><Badge>{String(i + 1).padStart(2, '0')} · {e.tag}</Badge><BookOpen size={16} className="soft" /></div><h3>{e.title}</h3><p>{e.content}</p><footer><span>示例知识条目 · 非临床依据</span><span>示例-{i + 1}</span></footer></article>)}<div className="mt24"><InfoLine>此原型不提供医学建议，也未验证模型效果。证据面板仅演示信息层级与追溯交互。</InfoLine></div></Modal>;
}
export function HelpDialog({ onClose }: { onClose: () => void }) {
  return <Modal title="原型审核说明" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>开始审核</Button>}><div className="flex mb-4"><span className="module-icon"><Info size={20} /></span><h3>React + TypeScript + Vite + Tailwind CSS</h3></div><p className="reason">可审核五个页面、四项检查结果、失败分支重试、证据抽屉、批量导入与人工接受 / 驳回 / 编辑 / 暂缓。所有报告、知识与结果都是合成示例，未连接模型或后台服务。</p><p className="reason mt16">状态保留在本页内存中，刷新后重置。导出为真实 CSV 示例；正式系统按 spec 提供 XLSX。不会发送文本，不保存密钥，不修改旧项目。</p><div className="mt16"><InfoLine>构建产物是单文件 HTML，可断网双击打开，无需启动开发服务器。</InfoLine></div></Modal>;
}
