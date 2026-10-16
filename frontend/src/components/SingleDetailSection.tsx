import type {ReactNode} from 'react';
import {ChevronDown,type LucideIcon} from 'lucide-react';

export function SingleDetailSection({title,icon:Icon,meta,children}:{title:string;icon:LucideIcon;meta?:ReactNode;children:ReactNode}){
 return <details className="single-result-details single-detail-section">
  <summary><span className="single-section-icon"><Icon size={17}/></span><span className="single-section-title">{title}</span>{meta&&<span className="single-section-meta">{meta}</span>}<ChevronDown className="single-section-chevron" size={16}/></summary>
  <div className="single-section-content">{children}</div>
 </details>;
}
