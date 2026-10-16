import {getStatus,getConfig} from '../api';
import {useRequest} from '../hooks/useRequest';
import {checks} from '../domain/checks';
import {PageHead,Panel,Badge,Button} from '../components/ui';
import {ErrorPanel} from '../components/ErrorPanel';
export function Settings(){
 const status=useRequest('status',getStatus);const config=useRequest('config',getConfig);
 return <div className="page"><PageHead title="运行配置"><Button onClick={()=>{status.refresh();config.refresh()}}>重新检测</Button></PageHead><ErrorPanel error={status.error||config.error}/><div className="setting-grid"><Panel><div className="panel-head"><h2>服务就绪状态</h2><Badge tone={status.data?.ready?'green':'amber'}>{status.loading?'检测中':status.data?.ready?'就绪':'部分依赖未就绪'}</Badge></div><div className="panel-body">{checks.map(c=>{const b=status.data?.branches[c.key];return <div key={c.key} className="setting-row"><div><b>{c.name}</b>{b?.reasons.map((r,i)=><p key={i} className="text-red-700">{r.message}</p>)}</div><Badge tone={b?.ready?'green':''}>{b?.ready?'可运行':'不可用'}</Badge></div>})}<details className="mt16"><summary>模型身份与资源信息</summary><pre>{JSON.stringify(status.data?.identities,null,2)}</pre><pre>{JSON.stringify(status.data?.capacity,null,2)}</pre></details></div></Panel><Panel><div className="panel-head"><h2>当前方法配置</h2><Badge>只读</Badge></div><div className="panel-body"><p className="small muted">配置由后端管理；新任务固定当时的版本，历史结果不会随配置变化。</p><pre className="readable-json mt16">{JSON.stringify(config.data,null,2)}</pre></div></Panel></div></div>
}
