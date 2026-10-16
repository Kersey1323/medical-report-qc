import type {ButtonHTMLAttributes,HTMLAttributes,ReactNode} from 'react';
import type {ExecutionStatus,Finding} from '../../api/types';
import {label} from '../../domain/checks';
export function Button({children,className='',variant='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:string}){return <button type="button" className={`btn rounded-lg text-sm font-medium transition-colors duration-150 ${variant} ${className}`} {...props}>{children}</button>}
export function Badge({children,tone='',icon}:{children:ReactNode;tone?:string;icon?:ReactNode}){return <span className={`badge ${tone}`}>{icon}{children}</span>}
export function Panel({className='',children,...props}:HTMLAttributes<HTMLElement>){return <section className={`panel bg-white rounded-xl border border-zinc-200 shadow-sm ${className}`} {...props}>{children}</section>}
export function PageHead({title,children}:{title:string;children?:ReactNode}){return <div className="page-head"><h1>{title}</h1><div className="flex flex-wrap">{children}</div></div>}
export function Footer(){return <footer className="page-foot"><span>CDU-MED Studio / 医学影像报告质控</span><span>原文 · 建议 · 人工意见独立保存</span></footer>}
export function ResultBadge({status,finding}:{status:ExecutionStatus;finding?:Finding|null}){return <Badge tone={status==='failed'?'red':status==='succeeded'?(finding==='issue'?'amber':finding==='needs_review'?'blue':'green'):''}>{status==='succeeded'?label(finding||'unknown'):label(status)}</Badge>}
export function Pagination({page,total,onPage}:{page:number;total:number;onPage:(n:number)=>void}){return <div className="panel-foot"><span className="muted small">共 {total} 条 · 第 {page} 页</span><div className="flex"><Button disabled={page===1} onClick={()=>onPage(page-1)}>上一页</Button><Button disabled={page*20>=total} onClick={()=>onPage(page+1)}>下一页</Button></div></div>}
