import {Activity,BookOpen,Check,CheckCheck,ChevronRight,CircleHelp,Clock,Eye,FileText,Pause,Search,ShieldCheck,TriangleAlert,X,type LucideIcon} from 'lucide-react';
import type {CheckKey} from '../api/types';

const statusIcons:Record<string,LucideIcon>={
 completed:Check,succeeded:Check,ready:Check,no_issue:Check,normal:Check,
 complete:CheckCheck,issue:TriangleAlert,partial:TriangleAlert,invalid:TriangleAlert,
 failed:X,cancelled:X,needs_review:Eye,unknown:CircleHelp,pending:Clock,running:Activity,
 accept:Check,reject:X,edit:CheckCheck,defer:Pause,
};
const checkIcons:Record<CheckKey,LucideIcon>={diagnosis:ShieldCheck,csc:FileText,cgec:BookOpen,rag:Search};

/** Decorative icons use visible labels or accessible text supplied by the caller. */
export function StatusIcon({status,size=13}:{status:string;size?:number}){
 const Icon=statusIcons[status]||CircleHelp;
 return <Icon size={size} aria-hidden="true" focusable="false"/>;
}
export function CheckIcon({branch,size=15}:{branch:CheckKey;size?:number}){
 const Icon=checkIcons[branch]||ChevronRight;
 return <Icon size={size} aria-hidden="true" focusable="false"/>;
}
