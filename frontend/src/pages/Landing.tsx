import {useRef,useState} from 'react';
import {ArrowRight,ArrowUpRight,BookOpen,BriefcaseMedical,Check,CheckCheck,ChevronRight,ClipboardCheck,FileCheck2,FileText,Layers,ScanText,Search,ShieldCheck,Sparkles} from 'lucide-react';
import {useScrollReveal} from '../hooks/useScrollReveal';
import './landing.css';

const capabilities=[
 {Icon:ShieldCheck,name:'诊断一致性',en:'DIAGNOSIS',text:'从影像描述生成参考诊断，结合医生原始诊断，识别需要进一步核对的差异。',detail:'生成参照 → 一致性判别'},
 {Icon:ScanText,name:'字符纠错',en:'SPELLING',text:'面向医学术语与局部字符错误，处理错字、少字和多字，约束非必要修改。',detail:'领域适配 → 约束解码'},
 {Icon:BookOpen,name:'语法纠错',en:'GRAMMAR',text:'结合教师参考与医学表达证据，检查成分、语序和句式，保留原始病例事实。',detail:'教师知识 → 学生条件推理'},
 {Icon:Search,name:'检索增强定位',en:'RETRIEVAL',text:'将可疑片段定位回原始报告，提供本次检索的报告内容，支持参考与溯源。',detail:'医学检索 → 原文定位'},
];
const chapters=[
 {chapter:'03',label:'诊断生成',title:'让诊断审核，多一份领域参照。',description:'论文第三章研究基于大语言模型微调与强化学习的影像诊断生成方法，分析领域适配的生成结果对下游诊断审核的作用。',tags:['LoRA 微调','GRPO 强化学习','生成式参照'],steps:['影像描述','参考诊断生成','结合原诊断判别'],note:'参考诊断提供比较依据；文本差异本身不等于诊断错误。'},
 {chapter:'04',label:'字符纠错',title:'专注局部编辑，守住医学表达。',description:'论文第四章结合医学领域继续预训练、CSC 监督微调与 C2EC 约束解码，研究医学影像描述中的错字、少字和多字问题。',tags:['医学 CPT','CSC LoRA','C2EC'],steps:['医学领域适配','候选评分与约束','字符级编辑建议'],note:'通过编辑代价与忠实性约束，控制替换、插入和删除范围。'},
 {chapter:'05',label:'语法与定位',title:'让表达修正，有知识、有证据。',description:'论文第五章结合 EXAM 教师知识、医学表达检索与语义编辑评价，分别研究跨词语的语法纠错和原文错误片段定位。',tags:['EXAM 教师知识','RAG 表达证据','SEE 离线评价'],steps:['检索医学表达','教师参考与纠错','原文片段定位'],note:'参考报告用于表达参照，不能替代当前病例的影像与临床事实。'},
];
const workflow=[
 {Icon:FileText,title:'提交原始报告',text:'输入影像描述与医生诊断，或导入 CSV / XLSX 批量报告。'},
 {Icon:Layers,title:'执行四项检查',text:'诊断、字符、语法、检索分别记录结果，按报告查看进度。'},
 {Icon:Search,title:'查看建议与证据',text:'对照原文核对修改建议，查看定位片段与检索来源。'},
 {Icon:ClipboardCheck,title:'人工复核与留痕',text:'接受、驳回或编辑建议，保存复核意见与操作历史。'},
];

function ReportVisual(){
 return <div data-reveal className="landing-visual" aria-label="四项质控流程示意">
  <div className="landing-orbit" aria-hidden="true"/><div className="landing-visual-glow" aria-hidden="true"/>
  <div className="landing-report-sheet">
   <div className="landing-sheet-heading"><span><FileText size={21}/></span><div><strong>医学影像报告</strong><small>从原始描述到审核依据</small></div><span className="landing-sheet-dot" aria-hidden="true"/></div>
   <div className="landing-sheet-body"><span className="landing-sheet-label">影像描述</span><div className="landing-text-lines" aria-hidden="true"><i/><i/><i/><i/></div>
    <div className="landing-scan"><svg viewBox="0 0 260 145" fill="none" aria-hidden="true"><path d="M126 18v40l-26 26m34-66v40l26 26" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/><path d="M112 38C89 40 67 69 58 99c-7 22 6 30 24 24l28-10c8-3 10-10 10-21V51c0-10-2-15-8-13Zm36 0c23 2 45 31 54 61 7 22-6 30-24 24l-28-10c-8-3-10-10-10-21V51c0-10 2-15 8-13Z" fill="#0052ff0b" stroke="currentColor" strokeWidth="2"/><path d="m101 68-20 30m24-15-13 23m67-38 20 30m-24-15 13 23" stroke="currentColor" strokeWidth="1.5"/><path d="M20 20h18M20 20v18m222-18h-18m18 0v18M20 125h18m-18 0v-18m222 18h-18m18 0v-18" stroke="#b3c8ff" strokeWidth="2"/></svg></div>
    <span className="landing-sheet-label">医生诊断</span><div className="landing-text-lines short" aria-hidden="true"><i/><i/></div>
   </div>
   <div className="landing-sheet-footer"><ShieldCheck size={14}/>原始文本独立保存<span>01 / 04</span></div>
  </div>
  <div className="landing-float landing-float-check"><span className="landing-float-icon"><CheckCheck size={21}/></span><div><strong>四项独立检查</strong><small>诊断 · 字符 · 语法 · 检索</small></div></div>
  <div className="landing-float landing-float-evidence"><span><Search size={17}/>检索证据</span><strong>建议，有据可循<ArrowUpRight size={17}/></strong><small>原文定位 · 报告溯源</small></div>
  <div className="landing-visual-caption"><span/>质控流程示意 · 非真实病例</div>
 </div>;
}

export function Landing(){
 const scrollRoot=useRef<HTMLDivElement>(null);
 useScrollReveal(scrollRoot);
 const [chapter,setChapter]=useState(0);
 const tabs=useRef<(HTMLButtonElement|null)[]>([]);
 const current=chapters[chapter];
 const scrollTo=(id:string)=>document.getElementById(id)?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
 return <div ref={scrollRoot} className="landing-page">
  <a className="landing-skip" href="#home" onClick={e=>{e.preventDefault();document.getElementById('landing-main')?.focus()}}>跳到主要内容</a>
  <header className="landing-header"><div className="landing-container landing-header-inner">
   <a className="landing-brand" href="#home" aria-label="CDU-MED Studio 首页"><span className="landing-logo"><BriefcaseMedical size={23}/></span><span>CDU-MED <em>Studio</em></span></a>
   <nav aria-label="首页导航"><button onClick={()=>scrollTo('landing-capabilities')}>质控能力</button><button onClick={()=>scrollTo('landing-research')}>研究方法</button><button onClick={()=>scrollTo('landing-workflow')}>工作流程</button></nav>
   <a className="landing-button landing-button-primary landing-header-cta" href="#overview">进入工作台<ArrowUpRight size={16}/></a>
  </div></header>
  <main id="landing-main" tabIndex={-1}>
   <section className="landing-hero"><div className="landing-container landing-hero-grid">
    <div data-reveal className="landing-hero-copy"><span className="landing-eyebrow"><span/>面向医学影像报告的智能质控</span>
     <h1>从每一个字符，<br/>到每一份<span>可信报告。</span></h1>
     <p>以领域模型理解医学表达，以检索证据支持审核。<br/>连接诊断、字符与语法检查，让每一处建议都能被看见、被核对。</p>
     <div className="landing-hero-actions"><a href="#single" className="landing-button landing-button-primary">开始报告质控<ArrowRight size={18}/></a><button className="landing-button" onClick={()=>scrollTo('landing-research')}><BookOpen size={17}/>探索研究方法</button></div>
     <div className="landing-hero-notes"><span><Check size={15}/>四项检查</span><span><Check size={15}/>证据溯源</span><span><Check size={15}/>人工复核</span></div>
    </div><ReportVisual/>
   </div></section>
   <div data-reveal className="landing-container landing-principles"><span>研究驱动 · 面向实际审核流程</span><div><ShieldCheck/>诊断一致性</div><div><ScanText/>医学字符纠错</div><div><BookOpen/>语法表达修正</div><div><Search/>检索证据定位</div></div>
   <section id="landing-capabilities" className="landing-container landing-section">
    <div data-reveal className="landing-section-heading"><div><span className="landing-kicker">多层次质控</span><h2>一份报告，<span>四个审核视角。</span></h2></div><p>从诊断一致性到语言表达，分层识别问题。<br/>保留原文，独立呈现各项检查结果。</p></div>
    <div className="landing-capability-grid">{capabilities.map((c,i)=><article data-reveal className="landing-capability" key={c.en}><div className="landing-capability-top"><span className="landing-capability-icon"><c.Icon size={23}/></span><span>0{i+1}</span></div><h3>{c.name}</h3><p>{c.text}</p><div className="landing-capability-detail">{c.detail}<ArrowUpRight size={16}/></div></article>)}</div>
   </section>
   <section id="landing-research" className="landing-research-section"><div className="landing-container">
    <div data-reveal className="landing-section-heading"><div><span className="landing-kicker">从论文到应用</span><h2>把研究方法，<span>带进审核工作流。</span></h2></div><p>围绕论文第三、四、五章的研究方向，<br/>构建分层的影像报告质控能力。</p></div>
    <div data-reveal className="landing-research-tabs" role="tablist" aria-label="论文章节">{chapters.map((c,i)=><button key={c.chapter} ref={el=>{tabs.current[i]=el}} id={`chapter-tab-${i}`} role="tab" aria-selected={chapter===i} aria-controls="chapter-panel" tabIndex={chapter===i?0:-1} onClick={()=>setChapter(i)} onKeyDown={e=>{const next=e.key==='ArrowRight'?(i+1)%3:e.key==='ArrowLeft'?(i+2)%3:e.key==='Home'?0:e.key==='End'?2:null;if(next!==null){e.preventDefault();setChapter(next);tabs.current[next]?.focus()}}}><span>第{['三','四','五'][i]}章</span>{c.label}<ChevronRight size={15}/></button>)}</div>
    <div id="chapter-panel" data-reveal className="landing-research-panel" role="tabpanel" aria-labelledby={`chapter-tab-${chapter}`} tabIndex={0}>
     <div className="landing-research-copy"><div className="landing-chapter-label"><BookOpen size={16}/>论文研究 · CHAPTER {current.chapter}</div><h3>{current.title}</h3><p>{current.description}</p><div className="landing-research-tags">{current.tags.map(t=><span key={t}>{t}</span>)}</div></div>
     <div className="landing-method"><span className="landing-method-label">方法路径</span>{current.steps.map((step,i)=><div className="landing-method-step" key={step}><span>0{i+1}</span><strong>{step}</strong>{i===2?<FileCheck2 size={20}/>:<ArrowRight size={20}/>}</div>)}<p>{current.note}</p></div>
    </div>
    <p className="landing-research-note">以上为论文方法概述；当前工程使用的模型与参数以工作台运行配置为准。</p>
   </div></section>
   <section id="landing-workflow" className="landing-container landing-section">
    <div data-reveal className="landing-section-heading"><div><span className="landing-kicker">审核闭环</span><h2>让每一步判断，<span>都有迹可循。</span></h2></div><a href="#batch" className="landing-text-link">查看批量任务<ArrowUpRight size={17}/></a></div>
    <div className="landing-workflow-grid">{workflow.map((s,i)=><article data-reveal key={s.title}><div className="landing-workflow-number"><s.Icon size={23}/><span>0{i+1}</span></div><h3>{s.title}</h3><p>{s.text}</p></article>)}</div>
   </section>
   <section data-reveal className="landing-container landing-final"><div><span className="landing-kicker"><Sparkles size={15}/>研究落地，从一份报告开始</span><h2>把注意力，留给值得复核的细节。</h2><p>模型提供建议，证据支持判断，最终由人确认。</p></div><a href="#overview" className="landing-button landing-button-primary">进入质控工作台<ArrowRight size={18}/></a></section>
  </main>
  <footer className="landing-container landing-footer"><a className="landing-brand" href="#home"><BriefcaseMedical size={20}/><span>CDU-MED Studio</span></a><span>医学影像报告智能质控 · 研究与应用</span><button onClick={()=>document.querySelector('.landing-page')?.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}>返回顶部 ↑</button></footer>
 </div>;
}
