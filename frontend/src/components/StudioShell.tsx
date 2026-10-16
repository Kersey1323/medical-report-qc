import {useEffect,useRef,useState} from 'react';
import {Home,LayoutGrid,FileText,Layers,ClipboardCheck,Settings2,PanelLeftClose,PanelLeftOpen,UserRound,BriefcaseMedical,ChevronRight,Info,Menu,X} from 'lucide-react';
import type {ReactNode} from 'react';
import {Button} from './ui';
import {PageActionsContext} from './PageActionsContext';

const nav=[
  {key:'home',name:'首页',icon:Home},
  {key:'overview',name:'工作台',icon:LayoutGrid},
  {key:'single',name:'单份质控',icon:FileText},
  {key:'batch',name:'批量任务',icon:Layers},
  {key:'review',name:'人工复核',icon:ClipboardCheck},
];
const settings={key:'settings',name:'运行配置',icon:Settings2};
const narrowQuery='(max-width: 1023px)';

export function StudioShell({active,children,pendingCount,taskCount,onHelp}:{active:string;children:ReactNode;pendingCount:number;taskCount:number;onHelp:()=>void}){
  const [collapsed,setCollapsed]=useState(()=>localStorage.getItem('medical_qc:sidebar')==='collapsed');
  const [narrow,setNarrow]=useState(()=>window.matchMedia(narrowQuery).matches);
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [actionsTarget,setActionsTarget]=useState<HTMLDivElement|null>(null);
  const sidebar=useRef<HTMLElement>(null);
  const menuButton=useRef<HTMLButtonElement>(null);
  const isCollapsed=collapsed&&!narrow;
  const activeName=active==='review_report'?'报告复核':active==='review_task'?'任务报告复核':active==='report'?'报告详情':active==='task'?'任务详情':[...nav,settings].find(item=>item.key===active)?.name||'工作台';
  const activeNav=active.startsWith('review')?'review':active==='report'||active==='task'?'batch':active;

  useEffect(()=>{
    const media=window.matchMedia(narrowQuery);
    const change=()=>{setNarrow(media.matches);setDrawerOpen(false)};
    media.addEventListener('change',change);
    return()=>media.removeEventListener('change',change);
  },[]);

  useEffect(()=>{
    if(!narrow||!drawerOpen)return;
    sidebar.current?.querySelector<HTMLButtonElement>('[data-close-navigation]')?.focus();
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDrawerOpen(false)}
      if(event.key==='Tab'){
        const items=Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')||[]);
        const first=items[0],last=items.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
      }
    };
    document.addEventListener('keydown',keydown);
    return()=>{document.removeEventListener('keydown',keydown);menuButton.current?.focus()};
  },[narrow,drawerOpen]);

  const navItem=(item:(typeof nav)[number])=><a key={item.key} href={`#${item.key}`} className={`nav-link ${activeNav===item.key?'active':''}`} aria-current={activeNav===item.key?'page':undefined} aria-label={item.name} title={isCollapsed?item.name:undefined} onClick={()=>setDrawerOpen(false)}>
    <item.icon className="icon"/><span className="nav-label">{item.name}</span>
    {item.key==='batch'&&<span className="nav-count">{taskCount}</span>}
    {item.key==='review'&&<span className="nav-count">{pendingCount}</span>}
  </a>;

  return <PageActionsContext.Provider value={actionsTarget}><div className={`studio-shell ${active==='overview'?'home-theme':''} ${isCollapsed?'sidebar-collapsed':''} ${narrow&&drawerOpen?'navigation-open':''}`}>
    {narrow&&drawerOpen&&<button type="button" className="nav-backdrop" aria-label="关闭导航遮罩" tabIndex={-1} onClick={()=>setDrawerOpen(false)}/>}
    <aside ref={sidebar} className="studio-sidebar" id="studio-navigation" hidden={narrow&&!drawerOpen} role={narrow?'dialog':undefined} aria-modal={narrow&&drawerOpen?true:undefined} aria-label="工作空间导航">
      {narrow&&<Button className="navigation-close" variant="subtle icon-only" data-close-navigation aria-label="关闭导航" onClick={()=>setDrawerOpen(false)}><X size={18}/></Button>}
      <a className="studio-brand" href="#overview" aria-label="CDU-MED Studio 总览" title={isCollapsed?'CDU-MED Studio':undefined} onClick={()=>setDrawerOpen(false)}>
        <span className="brand-mark"><BriefcaseMedical size={23} strokeWidth={1.7}/></span>
        <span className="brand-copy"><strong>CDU-MED <em>Studio</em></strong><small>医学影像报告质控</small></span>
      </a>
      <div className="nav-caption">工作空间</div>
      <nav className="studio-nav" aria-label="主导航">{nav.map(navItem)}</nav>
      <nav className="sidebar-secondary" aria-label="系统导航">{navItem(settings)}</nav>
      <div className="sidebar-bottom">
        {!narrow&&<button type="button" className="sidebar-collapse" onClick={()=>setCollapsed(value=>{localStorage.setItem('medical_qc:sidebar',value?'expanded':'collapsed');return !value})} aria-expanded={!collapsed} aria-controls="studio-navigation" aria-label={collapsed?'展开侧边栏':'收起侧边栏'} title={collapsed?'展开侧边栏':undefined}>
          {collapsed?<PanelLeftOpen className="icon"/>:<PanelLeftClose className="icon"/>}<span className="nav-label">收起侧边栏</span>
        </button>}
        <div className="sidebar-user" title={isCollapsed?'本地操作者 · 免登录工作空间':undefined}><span className="avatar"><UserRound size={16}/></span><div className="user-copy"><b>本地操作者</b><small>免登录工作空间</small></div></div>
      </div>
    </aside>
    <div className="studio-workspace" inert={narrow&&drawerOpen}>
      <header className="studio-topbar">
        <div className="flex">
          {narrow&&<button ref={menuButton} type="button" className="btn subtle icon-only navigation-menu" aria-label="打开导航" aria-expanded={drawerOpen} aria-controls="studio-navigation" onClick={()=>setDrawerOpen(true)}><Menu size={19}/></button>}
          <div className="breadcrumb"><span>工作空间</span><ChevronRight size={14}/><b>{activeName}</b></div>
        </div>
        <div className="top-right"><div ref={setActionsTarget} className="topbar-actions" role="group" aria-label="页面操作"/><Button variant="subtle icon-only" aria-label="使用说明" title="使用说明" onClick={onHelp}><Info size={18}/></Button></div>
      </header>
      <main className="studio-content" id="main" tabIndex={-1}>{children}</main>
    </div>
  </div></PageActionsContext.Provider>;
}
