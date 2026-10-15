import { Check, AlertTriangle, Info, Clock3, X, FileText, ChevronRight, RotateCcw, ClipboardCheck, Pause } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import type { ModuleResult, Report, Navigate } from '../../types';
import { checks, isIncomplete, hasIssue, needsReview } from '../../data/demo';

export function Button({ children, className = '', variant = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return <button type="button" className={`btn rounded-lg text-sm font-medium transition-colors duration-150 ${variant} ${className}`} {...props}>{children}</button>;
}
export function Badge({ children, tone = '', icon }: { children: ReactNode; tone?: string; icon?: ReactNode }) {
  return <span className={`badge ${tone}`}>{icon}{children}</span>;
}
export function Panel({ className = '', children, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`panel bg-white rounded-xl border border-zinc-200 shadow-sm ${className}`} {...props}>{children}</section>;
}
export function PageHead({ title, extra, children }: { title: string; extra?: ReactNode; children?: ReactNode }) {
  return <div className="page-head"><div className="page-heading"><h1>{title}</h1>{extra}</div><div className="flex flex-wrap">{children}</div></div>;
}
export function Footer() { return <footer className="page-foot"><span>CDU-MED Studio <span className="px-2">/</span> 医学影像报告质控</span><span>原型 v0.1 · 合成示例 · 未连接模型服务</span></footer>; }
export function ResultBadge({ result }: { result: ModuleResult }) {
  if (result.status === 'failed') return <Badge tone="red" icon={<X />}>执行失败</Badge>;
  if (result.status === 'pending') return <Badge icon={<Clock3 />}>未执行</Badge>;
  if (result.status === 'running') return <Badge tone="blue" icon={<Clock3 />}>运行中</Badge>;
  if (result.status === 'cancelled') return <Badge icon={<Pause />}>已取消</Badge>;
  if (result.finding === 'issue') return <Badge tone="amber" icon={<AlertTriangle />}>发现异常</Badge>;
  if (result.finding === 'needs_review') return <Badge tone="blue" icon={<ClipboardCheck />}>需复核</Badge>;
  return <Badge tone="green" icon={<Check />}>未发现异常</Badge>;
}
export function ReportBadge({ report }: { report: Report }) {
  return hasIssue(report) ? <Badge tone="amber" icon={<AlertTriangle />}>发现异常</Badge> : needsReview(report) ? <Badge tone="blue" icon={<ClipboardCheck />}>需复核</Badge> : isIncomplete(report) ? <Badge tone="red" icon={<Info />}>检查不完整</Badge> : <Badge tone="green" icon={<Check />}>未发现异常</Badge>;
}
export function ReportTable({ reports, navigate, compact = false }: { reports: Report[]; navigate: Navigate; compact?: boolean }) {
  return <div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">报告</th>{!compact && <th scope="col">四项检查</th>}<th scope="col">质控结论</th><th scope="col">完整性</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>{reports.map(r => <tr key={r.id}><td><div className="report-name"><span className="file-icon"><FileText size={16} /></span><div><b>{r.id}</b><small>{r.name}</small></div></div></td>{!compact && <td><div className="flex" style={{ gap: 4 }}>{checks.map(m => { const v = r.results[m.key]; return <span key={m.key} title={`${m.name}：${v.status === 'failed' ? '执行失败' : v.finding === 'issue' ? '发现异常' : v.finding === 'needs_review' ? '需复核' : '已完成'}`} className={`badge ${v.status === 'failed' ? 'red' : v.finding === 'issue' ? 'amber' : v.finding === 'needs_review' ? 'blue' : 'green'}`}>{m.short}{v.status === 'failed' ? <X size={12} /> : v.finding === 'issue' ? <AlertTriangle size={12} /> : v.finding === 'needs_review' ? <ClipboardCheck size={12} /> : <Check size={12} />}</span>; })}</div></td>}<td><ReportBadge report={r} />{isIncomplete(r) && hasIssue(r) && <div className="mt-1 text-[10px] text-red-700">部分检查失败</div>}</td><td>{isIncomplete(r) ? <Badge tone="red">不完整</Badge> : <Badge>4 / 4 完成</Badge>}</td><td><button className="btn-link" onClick={() => navigate(`report/${r.id}/diagnosis`)}>查看 <ChevronRight size={14} /></button></td></tr>)}{!reports.length && <tr><td colSpan={5} className="empty">没有符合条件的报告</td></tr>}</tbody></table></div>;
}
export function InfoLine({ children }: { children: ReactNode }) { return <div className="info-line"><Info size={16} className="shrink-0 mt-0.5" /><span>{children}</span></div>; }
export function RetryButton({ onClick, children = '重试失败分支' }: { onClick: () => void; children?: ReactNode }) { return <Button onClick={onClick} variant="sm"><RotateCcw size={14} />{children}</Button>; }
export function MarkedText({ text, fragment }: { text: string; fragment?: string }) {
  if (!fragment || !text.includes(fragment)) return <>{text}</>;
  const start = text.indexOf(fragment);
  return <>{text.slice(0, start)}<mark>{fragment}</mark>{text.slice(start + fragment.length)}</>;
}
