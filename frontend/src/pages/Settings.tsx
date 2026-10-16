import {RefreshCw,ShieldCheck,FileText,BookOpen,Search,Info,Server,Workflow} from 'lucide-react';
import {StatusIcon} from '../components/StatusIcon';
import {getStatus,getConfig} from '../api';
import {useRequest} from '../hooks/useRequest';
import {checks} from '../domain/checks';
import {PageHead,Panel,Badge,Button} from '../components/ui';
import {ErrorPanel} from '../components/ErrorPanel';
const icons={diagnosis:ShieldCheck,csc:FileText,cgec:BookOpen,rag:Search};
export function Settings(){
 const status=useRequest('status',getStatus),config=useRequest('config',getConfig);
 return <div className="page"><PageHead title="运行配置"><Button onClick={()=>{status.refresh();config.refresh()}}><RefreshCw size={15}/>重新检测</Button></PageHead><ErrorPanel error={status.error||config.error}/><div className="setting-grid">
  <Panel><div className="panel-head"><h2 className="icon-label"><Server size={16} aria-hidden="true"/>服务就绪状态</h2><Badge icon={<StatusIcon status={status.loading?'running':status.data?.ready?'ready':'partial'}/>} tone={status.data?.ready?'green':'amber'}>{status.loading?'检测中':status.data?.ready?'全部就绪':'部分依赖未就绪'}</Badge></div><div className="panel-body">{checks.map(c=>{const b=status.data?.branches[c.key],Icon=icons[c.key];return <div key={c.key} className="setting-row"><span className="service-icon"><Icon size={18}/></span><div className="grow"><b>{c.name}</b><p className="muted">{c.description}</p>{b?.reasons.map((r,i)=><p key={i} className="text-red-700">{r.message}</p>)}</div><Badge icon={<StatusIcon status={status.loading?'running':b?.ready?'ready':'failed'}/>} tone={b?.ready?'green':status.loading?'':'amber'}>{status.loading?'检测中':b?.ready?'可运行':'不可用'}</Badge></div>})}<details className="mt16"><summary>模型身份与资源信息</summary><pre>{JSON.stringify(status.data?.identities,null,2)}</pre><pre>{JSON.stringify(status.data?.capacity,null,2)}</pre></details></div></Panel>
  <div className="stack"><Panel><div className="panel-head"><h2 className="icon-label"><Workflow size={16} aria-hidden="true"/>质控工作方式</h2><Badge>只读</Badge></div><dl>{[['默认检查','全部四项检查，可按需选择'],['字符处理','128 字分块 · 全文位置对齐'],['检索证据','展示本次实际使用的报告全文与来源'],['失败处理','保留失败详情，继续处理后续报告'],['人工复核','按任务聚合，分别保存原文、建议和意见']].map(([k,v])=><div className="method-row" key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><div className="panel-body"><details><summary>查看当前方法配置</summary><pre className="readable-json">{JSON.stringify(config.data,null,2)}</pre></details></div></Panel><div className="callout"><Info size={16}/><span>新任务使用提交时的配置快照。历史结果保留当时的方法与模型信息。</span></div></div>
 </div></div>;
}
