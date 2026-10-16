import type {CheckKey,RunReport} from '../api/types';
import {checks,label} from '../domain/checks';
import {CheckIcon,StatusIcon} from './StatusIcon';

export function CheckLegend({reports=[],enabled}:{reports?:Pick<RunReport,'results'>[];enabled?:CheckKey[]}){
 const statuses=[...new Set(['no_issue','issue','needs_review',...reports.flatMap(report=>Object.values(report.results).map(unit=>unit.status==='succeeded'?unit.finding||'unknown':unit.status))])];
 return <div className="review-check-legend" aria-label="检查图标说明">
  <div className="review-legend-group">{checks.filter(check=>!enabled||enabled.includes(check.key)).map(check=><span className="icon-label" key={check.key}><CheckIcon branch={check.key}/>{check.short}</span>)}</div>
  <div className="review-legend-group">{statuses.map(status=><span key={status} className={`badge ${status==='no_issue'?'green':status==='issue'?'amber':status==='needs_review'?'blue':status==='failed'?'red':''}`}><StatusIcon status={status}/>{label(status)}</span>)}</div>
 </div>;
}
