import type {ButtonHTMLAttributes,HTMLAttributes,ReactNode} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {StatusIcon} from '../StatusIcon';
import {useContext} from 'react';
import {createPortal} from 'react-dom';
import {PageActionsContext} from '../PageActionsContext';
import type {ExecutionStatus,Finding} from '../../api/types';
import {label} from '../../domain/checks';
export function Button({children,className='',variant='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:string}){return <button type="button" className={`btn rounded-xl font-medium transition-colors duration-200 ease-out ${variant} ${className}`} {...props}>{children}</button>}
export function Badge({children,tone='',icon}:{children:ReactNode;tone?:string;icon?:ReactNode}){return <span className={`badge ${tone}`}>{icon}{children}</span>}
export function Panel({className='',children,density='default',...props}:HTMLAttributes<HTMLElement>&{density?:'default'|'compact'}){return <section className={`panel bg-white border rounded-xl ${density==='compact'?'table-panel':''} ${className}`} {...props}>{children}</section>}
export function PageHead({title,children}:{title:string;children?:ReactNode}){
 const target=useContext(PageActionsContext);
 return <><h1 className="sr-only">{title}</h1>{children&&(target?createPortal(children,target):target===undefined?<div className="page-actions-standalone">{children}</div>:null)}</>;
}
export function Footer(){return <footer className="page-foot"><span>CDU-MED Studio / 医学影像报告质控</span><span>原文 · 建议 · 人工意见独立保存</span></footer>}
export function ResultBadge({status,finding,iconOnly=false}:{status:ExecutionStatus;finding?:Finding|null;iconOnly?:boolean}){return <Badge icon={<StatusIcon status={status==='succeeded'?finding||'unknown':status}/>} tone={status==='failed'?'red':status==='succeeded'?(finding==='issue'?'amber':finding==='needs_review'?'blue':'green'):''}>{iconOnly?<span className="sr-only">{status==='succeeded'?label(finding||'unknown'):label(status)}</span>:status==='succeeded'?label(finding||'unknown'):label(status)}</Badge>}
export function Pagination({page,total,onPage}:{page:number;total:number;onPage:(n:number)=>void}){return <div className="panel-foot"><span className="muted small">共 {total} 条 · 第 {page} 页</span><div className="flex"><Button disabled={page===1} onClick={()=>onPage(page-1)}><ChevronLeft size={14} aria-hidden="true"/>上一页</Button><Button disabled={page*20>=total} onClick={()=>onPage(page+1)}>下一页<ChevronRight size={14} aria-hidden="true"/></Button></div></div>}
