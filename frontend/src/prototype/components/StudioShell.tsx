import { useState } from 'react';
import { LayoutGrid, FileText, Layers, ClipboardCheck, Settings2, PanelLeftClose, PanelLeftOpen, UserRound, BriefcaseMedical, ChevronRight, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './ui';

const nav = [ { key: 'overview', name: '工作台', icon: LayoutGrid }, { key: 'single', name: '单份质控', icon: FileText }, { key: 'batch', name: '批量任务', icon: Layers }, { key: 'review', name: '人工复核', icon: ClipboardCheck }, { key: 'settings', name: '运行配置', icon: Settings2 } ];
export function StudioShell({ active, children, pendingCount, taskCount, onHelp }: { active: string; children: ReactNode; pendingCount: number; taskCount: number; onHelp: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const activeName = active === 'report' ? '报告详情' : active === 'task' ? '任务详情' : nav.find(n => n.key === active)?.name || '工作台';
  const activeNav = active === 'report' || active === 'task' ? 'batch' : active;
  return <div className={`studio-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="studio-sidebar" id="studio-navigation" aria-label="工作空间导航">
      <a className="studio-brand" href="#overview" aria-label="CDU-MED Studio 总览"><span className="brand-mark"><BriefcaseMedical size={23} strokeWidth={1.7} /></span><span className="brand-copy"><strong>CDU-MED <em>Studio</em></strong><small>医学影像报告质控</small></span></a>
      <div className="nav-caption">工作空间</div><nav className="studio-nav" aria-label="主导航">{nav.map(n => <a key={n.key} href={`#${n.key}`} className={`nav-link ${activeNav === n.key ? 'active' : ''}`} aria-current={activeNav === n.key ? 'page' : undefined} aria-label={n.name} title={collapsed ? n.name : undefined}><n.icon className="icon" /><span className="nav-label">{n.name}</span>{n.key === 'batch' && <span className="nav-count">{taskCount}</span>}{n.key === 'review' && <span className="nav-count">{pendingCount}</span>}</a>)}</nav>
      <div className="sidebar-bottom"><button className="sidebar-collapse" onClick={() => setCollapsed(v => !v)} aria-expanded={!collapsed} aria-controls="studio-navigation" aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}>{collapsed ? <PanelLeftOpen className="icon" /> : <PanelLeftClose className="icon" />}<span className="nav-label">收起侧边栏</span></button><div className="sidebar-user"><span className="avatar"><UserRound size={16} /></span><div className="user-copy"><b>本地操作者</b><small>免登录工作空间</small></div></div></div>
    </aside>
    <div className="studio-workspace"><header className="studio-topbar"><div className="flex"><div className="breadcrumb"><span>工作空间</span><ChevronRight size={14} /><b>{activeName}</b></div></div><div className="top-right"><span className="top-date small soft">2026 年 10 月 15 日 · 示例工作日</span><span className="prototype-badge" title="所有结果均为合成示例，未连接任何模型服务"><i />交互原型 · 示例数据</span><Button variant="subtle icon-only" aria-label="原型使用说明" title="原型使用说明" onClick={onHelp}><Info size={18} /></Button></div></header><main className="studio-content" id="main" tabIndex={-1}>{children}</main></div>
  </div>;
}
