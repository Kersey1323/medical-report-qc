import { Check, X, SquarePen, Clock3, ChevronRight, BookOpen, AlertTriangle, CircleCheck } from 'lucide-react';
import type { CheckKey, Report, ReviewDecision, ReviewType } from '../types';
import { checks, suggestionDetail } from '../data/demo';
import { Badge, Button, ResultBadge, RetryButton } from './ui';

export function DecisionLabel({ decision }: { decision?: ReviewDecision }) {
  const names = { accept: '已接受', reject: '已驳回', edit: '已编辑确认', defer: '已暂缓' };
  return decision ? <span className="review-status"><Check size={13} />{names[decision.type]} · 本地操作者 · 仅保留在本次原型中</span> : null;
}
export function ReviewActions({ decision, isCandidate, onReview }: { decision?: ReviewDecision; isCandidate: boolean; onReview: (type: ReviewType) => void }) {
  return <><div className="action-row"><Button variant={decision?.type === 'accept' ? 'success sm' : 'primary sm'} onClick={() => onReview('accept')}><Check size={14} />{isCandidate ? '保留候选待核对' : '接受建议'}</Button><Button variant="sm" onClick={() => onReview('reject')}><X size={14} />驳回</Button><Button variant="sm" onClick={() => onReview('edit')}><SquarePen size={14} />编辑后确认</Button><Button variant="subtle sm" onClick={() => onReview('defer')}><Clock3 size={14} />暂缓</Button></div><DecisionLabel decision={decision} /></>;
}
export function CheckResult({ report, checkKey, decision, onReview, onEvidence, onRetry }: { report: Report; checkKey: CheckKey; decision?: ReviewDecision; onReview: (type: ReviewType) => void; onEvidence: () => void; onRetry: () => void }) {
  const result = report.results[checkKey], detail = suggestionDetail(report, checkKey), module = checks.find(m => m.key === checkKey)!;
  if (result.status === 'failed') return <div className="result-content"><div className="result-state"><h3>本项检查未完成</h3><ResultBadge result={result} /></div><div className="notice"><AlertTriangle size={17} /><span>{checkKey === 'diagnosis' ? '在线诊断判别服务超时' : '知识定位服务未返回有效结果'} · 示例故障</span></div><p className="reason mt16">已尝试 3 次，仍未完成有效判断。该分支不计为通过，其余分支和后续报告继续处理。</p><div className="mt24"><RetryButton onClick={onRetry}>模拟重试本分支</RetryButton></div><dl className="config-list mt24"><dt>失败阶段</dt><dd>{checkKey === 'diagnosis' ? '在线诊断判别' : '首轮原文片段定位'}</dd><dt>错误类型</dt><dd><code>API_TIMEOUT</code></dd><dt>结果保留</dt><dd>其他已完成检查不受影响</dd></dl></div>;
  if (result.finding === 'no_issue') return <div className="result-content"><div className="result-state"><h3>未发现异常</h3><ResultBadge result={result} /></div><div className="empty"><CircleCheck size={36} className="text-emerald-700 mx-auto" /><p>本项示例检查已完成</p><p className="mt-1">当前分支未返回可疑片段或修改建议。</p></div><p className="reason">仅代表该项示例结果；不等于临床诊断，也不覆盖其他检查结论。</p></div>;
  const offset = Array.from((checkKey === 'diagnosis' ? report.diagnosis : report.description).split(detail.source)[0]).length;
  return <div className="result-content"><div className="result-state"><h3>{detail.title}</h3><ResultBadge result={result} /></div><div className="flex wrap"><Badge>{detail.field}</Badge><span className="text-caption">原文位置 [{offset}, {offset + Array.from(detail.source).length})</span></div>
    {detail.target ? <div className="diff"><div><span className="diff-label">原文片段</span><span className="deletion">{detail.source}</span></div><div><span className="diff-label">{decision?.type === 'edit' ? '人工确认稿' : '模型建议 · 示例'}</span><span className="insertion">{decision?.type === 'edit' ? decision.text : detail.target}</span></div></div> : <div className="reference mt16"><span className="diff-label">待核对片段 · 不自动替换</span><mark className="bg-amber-100 text-amber-900 rounded px-1">{detail.source}</mark></div>}
    <p className="reason mt16">{detail.reason}</p>
    <div className="result-divider"><p className="reason-title">{checkKey === 'diagnosis' ? '7B 生成的参考诊断 · 示例' : checkKey === 'cgec' ? '教师参考与学生输出' : checkKey === 'csc' ? '覆盖与定位' : '定位记录'}</p><div className="reference whitespace-pre-wrap">{detail.reference}</div></div>
    {checkKey === 'cgec' && <div className="flex mt16"><Badge tone="green" icon={<Check />}>教师 / 学生一致 · 示例</Badge><span className="text-caption">分歧时保留双份结果并提示复核</span></div>}
    {(checkKey === 'rag' || checkKey === 'cgec') && <div className="result-divider"><button className="evidence-link" onClick={onEvidence}><span className="flex"><BookOpen size={17} /><span>查看{checkKey === 'cgec' ? ' Top-5 检索参考' : ' Top-10 参考报告'}<small>{checkKey === 'rag' ? '报告全文 · 检索排名 · 来源记录（合成示例）' : '原型展示 3 条合成知识条目'}</small></span></span><ChevronRight size={16} /></button></div>}
    <ReviewActions decision={decision} isCandidate={!detail.target} onReview={onReview} />
    <p className="text-caption mt16">{module.name}建议独立保存，不自动覆盖原始报告或合并其他分支修改。</p>
  </div>;
}
