import type {ButtonHTMLAttributes,HTMLAttributes,ReactNode} from 'react';
import {useContext} from 'react';
import {createPortal} from 'react-dom';
import {PageActionsContext} from '../PageActionsContext';
import type {ExecutionStatus,Finding} from '../../api/types';
import {label} from '../../domain/checks';
export function Button({children,className='',variant='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:string}){return <button type="button" className={`btn px-3 py-1.5 rounded-md text-sm font-medium bg-transparent hover:bg-[#efedea] active:bg-[#e3e1db] transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2 ${variant} ${className}`} {...props}>{children}</button>}
export function Badge({children,tone='',icon}:{children:ReactNode;tone?:string;icon?:ReactNode}){return <span className={`badge ${tone}`}>{icon}{children}</span>}
export function Panel({className='',children,density='default',...props}:HTMLAttributes<HTMLElement>&{density?:'default'|'compact'}){return <section className={`panel group bg-white border border-gray-200 rounded-lg shadow-sm ${density==='compact'?'table-panel':''} ${className}`} {...props}><span className="block-handle opacity-0 group-hover:opacity-100 transition-opacity duration-150" aria-hidden="true">⋮⋮</span>{children}</section>}
export function PageHead({title,children}:{title:string;children?:ReactNode}){
 const target=useContext(PageActionsContext);
 return <><h1 className="sr-only">{title}</h1>{children&&(target?createPortal(children,target):target===undefined?<div className="page-actions-standalone">{children}</div>:null)}</>;
}
export function Footer(){return <footer className="page-foot"><span>CDU-MED Studio / 医学影像报告质控</span><span>原文 · 建议 · 人工意见独立保存</span></footer>}
export function ResultBadge({status,finding}:{status:ExecutionStatus;finding?:Finding|null}){return <Badge tone={status==='failed'?'red':status==='succeeded'?(finding==='issue'?'amber':finding==='needs_review'?'blue':'green'):''}>{status==='succeeded'?label(finding||'unknown'):label(status)}</Badge>}
export function Pagination({page,total,onPage}:{page:number;total:number;onPage:(n:number)=>void}){return <div className="panel-foot"><span className="muted small">共 {total} 条 · 第 {page} 页</span><div className="flex"><Button disabled={page===1} onClick={()=>onPage(page-1)}>上一页</Button><Button disabled={page*20>=total} onClick={()=>onPage(page+1)}>下一页</Button></div></div>}
