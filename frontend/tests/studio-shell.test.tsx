import {act,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {StudioShell} from '../src/components/StudioShell';
import {Button,PageHead} from '../src/components/ui';

function viewport(narrow=false){
 const listeners=new Set<()=>void>();
 const media={matches:narrow,media:'(max-width: 1023px)',addEventListener:vi.fn((_name:string,listener:()=>void)=>listeners.add(listener)),removeEventListener:vi.fn((_name:string,listener:()=>void)=>listeners.delete(listener))};
 vi.stubGlobal('matchMedia',vi.fn(()=>media));
 return (value:boolean)=>act(()=>{media.matches=value;listeners.forEach(listener=>listener())});
}
function shell(active='overview'){
 return <StudioShell active={active} taskCount={6} pendingCount={12} onHelp={()=>{}}><button>内容操作</button></StudioShell>;
}
afterEach(()=>{localStorage.clear();vi.unstubAllGlobals()});

it('places live page actions in the topbar and clears them when the page changes',()=>{
 viewport();const click=vi.fn();
 const page=(title:string,actions=false)=><StudioShell active="overview" taskCount={6} pendingCount={12} onHelp={()=>{}}><PageHead title={title}>{actions&&<Button onClick={click}>新建质控</Button>}</PageHead><section>正文</section></StudioShell>;
 const view=render(page('工作台',true));
 const actions=screen.getByRole('group',{name:'页面操作'});
 fireEvent.click(within(actions).getByRole('button',{name:'新建质控'}));
 expect(click).toHaveBeenCalledOnce();
 expect(within(screen.getByRole('main')).queryByRole('button',{name:'新建质控'})).toBeNull();
 expect(screen.getByRole('heading',{level:1}).textContent).toBe('工作台');
 view.rerender(page('单份报告质控'));
 expect(actions.childElementCount).toBe(0);
 expect(screen.queryByRole('button',{name:'新建质控'})).toBeNull();
});

it('defaults to a labeled compact rail, highlights tasks, and remembers desktop preferences',()=>{
 viewport();let view=render(shell('report'));
 expect(screen.getByRole('button',{name:'展开侧边栏'}).getAttribute('aria-expanded')).toBe('false');
 expect(screen.getByRole('link',{name:'单份质控'}).querySelector('.nav-label')?.textContent).toBe('单份质控');
 const primary=screen.getByRole('navigation',{name:'主导航'});
 expect(within(primary).getByRole('link',{name:'批量任务'}).getAttribute('aria-current')).toBe('page');
 expect(within(primary).queryByRole('link',{name:'运行配置'})).toBeNull();
 expect(within(screen.getByRole('navigation',{name:'系统导航'})).getByRole('link',{name:'运行配置'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'展开侧边栏'}));
 expect(localStorage.getItem('medical_qc:sidebar')).toBe('expanded');
 view.unmount();view=render(shell('report'));
 expect(screen.getByRole('button',{name:'收起侧边栏'}).getAttribute('aria-expanded')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'收起侧边栏'}));
 expect(localStorage.getItem('medical_qc:sidebar')).toBe('collapsed');
 expect(screen.getByRole('link',{name:'批量任务'}).getAttribute('title')).toBe('批量任务');
 view.unmount();render(shell());
 expect(screen.getByRole('button',{name:'展开侧边栏'})).toBeTruthy();
});

it('keeps narrow navigation closed and traps focus until Escape restores the opener',()=>{
 viewport(true);render(shell());
 expect(screen.queryByRole('dialog',{name:'工作空间导航'})).toBeNull();
 const opener=screen.getByRole('button',{name:'打开导航'});
 fireEvent.click(opener);
 const drawer=screen.getByRole('dialog',{name:'工作空间导航'});
 const close=within(drawer).getByRole('button',{name:'关闭导航'});
 expect(document.activeElement).toBe(close);
 expect(screen.getByRole('button',{name:'内容操作'}).closest('.studio-workspace')?.hasAttribute('inert')).toBe(true);
 fireEvent.keyDown(document,{key:'Tab',shiftKey:true});
 expect(document.activeElement).toBe(within(drawer).getByRole('link',{name:'运行配置'}));
 fireEvent.keyDown(document,{key:'Tab'});
 expect(document.activeElement).toBe(close);
 fireEvent.keyDown(document,{key:'Escape'});
 expect(screen.queryByRole('dialog',{name:'工作空间导航'})).toBeNull();
 expect(document.activeElement).toBe(opener);
 expect(screen.getByRole('button',{name:'内容操作'}).closest('.studio-workspace')?.hasAttribute('inert')).toBe(false);
});

it('closes narrow navigation on selection and preserves the desktop preference across resizing',()=>{
 const resize=viewport();localStorage.setItem('medical_qc:sidebar','collapsed');
 render(shell());
 resize(true);
 fireEvent.click(screen.getByRole('button',{name:'打开导航'}));
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('link',{name:'人工复核'}));
 expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'打开导航'}));
 fireEvent.click(screen.getByRole('button',{name:'关闭导航遮罩'}));
 expect(screen.queryByRole('dialog')).toBeNull();
 resize(false);
 expect(screen.getByRole('button',{name:'展开侧边栏'})).toBeTruthy();
 expect(localStorage.getItem('medical_qc:sidebar')).toBe('collapsed');
});
