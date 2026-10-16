import {test,expect} from '@playwright/test';
const envelope=(data:unknown)=>JSON.stringify({status:'success',request_id:'browser-test',data})+'\n';
const source='合成报告：两肺血观束清晰。';
test('temporary chat receives partial results without creating a durable task',async({page})=>{
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url())});
 await page.route('**/api/v1/single/stream',route=>route.fulfill({contentType:'application/x-ndjson',body:[
  {type:'start',checks:['diagnosis','csc','cgec','rag']},
  {type:'preflight',state:'succeeded'},
  {type:'branch',branch:'diagnosis',state:'running'},
  {type:'stage',branch:'diagnosis',stage:'diagnosis.generate',state:'failed',attempt:1,detail:{message:'合成故障'}},
  {type:'result',branch:'diagnosis',outcome:{status:'failed',finding:null,error:{code:'response_invalid',message:'合成故障',stage:'diagnosis.generate',retryable:false}}},
  {type:'stage',branch:'csc',stage:'csc.correct',state:'succeeded',attempt:1},
  {type:'result',branch:'csc',outcome:{status:'succeeded',finding:'issue',spans:[{start:8,end:9,text:'观'}],suggestions:[{before:'观',after:'管'}],details:{corrected_text:'合成报告：两肺血管束清晰。'}}},
  {type:'result',branch:'cgec',outcome:{status:'succeeded',finding:'no_issue',details:{corrected_text:source}}},
  {type:'result',branch:'rag',outcome:{status:'succeeded',finding:'no_issue',evidence:[],details:{reason:'未发现错误'}}},
  {type:'complete',state:'partial'},
 ].map(envelope).join('')}));
 await page.goto('/#single');await expect(page.getByRole('checkbox',{checked:true})).toHaveCount(4);
 await page.getByRole('textbox',{name:'影像描述'}).fill(source);await page.getByRole('textbox',{name:'医生诊断'}).fill('合成诊断：正常');
 await page.getByRole('button',{name:'开始质控',exact:true}).click();
 await expect(page.getByRole('button',{name:'检查下一份'})).toBeVisible();await expect(page).toHaveURL(/#single$/);
 await expect(page.locator('.single-message-caption [role=status]')).toHaveText('部分完成');
 await page.getByRole('button',{name:'查看诊断详情'}).click();
 await expect(page.getByRole('dialog')).toContainText('合成故障');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'查看字符详情'}).click();
 await expect(page.locator('.single-result mark')).toHaveText('观');
 await expect(page.locator('.single-result')).toContainText('合成报告：两肺血管束清晰。');
 await expect(page.locator('.progress')).toHaveCount(0);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'查看字符详情'})).toBeFocused();
 expect(posts).toHaveLength(1);expect(posts[0]).toContain('/single/stream');
 await page.reload();await expect(page.locator('.single-timeline-message')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'影像描述'})).toHaveValue('');
});

test('a broken stream keeps returned results and allows a new check',async({page})=>{
 await page.route('**/api/v1/single/stream',route=>route.fulfill({contentType:'application/x-ndjson',body:envelope({type:'preflight',state:'succeeded'})+envelope({type:'result',branch:'csc',outcome:{status:'succeeded',finding:'no_issue',details:{corrected_text:source}}})}));
 await page.goto('/#single');await page.getByRole('textbox',{name:'影像描述'}).fill(source);await page.getByRole('textbox',{name:'医生诊断'}).fill('合成诊断');await page.getByRole('button',{name:'开始质控',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('本次检查未完整结束');
 await page.getByRole('button',{name:'查看字符详情'}).click();await expect(page.locator('.single-result')).toContainText(source);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'检查下一份'}).click();await expect(page.getByRole('textbox',{name:'影像描述'})).toBeVisible();
});

test('timeline renders live stages before completion and stop aborts the connection',async({page})=>{
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
   if(String(input)!='/api/v1/single/stream')return original(input,init);
   const stream=new ReadableStream({start(controller){
    const send=(data:unknown)=>controller.enqueue(new TextEncoder().encode(JSON.stringify({status:'success',data,request_id:'live-test'})+'\n'));
    (window as typeof window & {sendSingleEvent:(e:unknown)=>void}).sendSingleEvent=send;
    send({type:'start',checks:['diagnosis','csc','cgec','rag']});send({type:'preflight',state:'succeeded'});
    send({type:'branch',branch:'diagnosis',state:'running'});
    send({type:'stage',branch:'diagnosis',stage:'diagnosis.generate',state:'running',at:new Date().toISOString(),attempt:1});
    init?.signal?.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});
   }});
   return new Response(stream,{headers:{'content-type':'application/x-ndjson'}});
  };
 });
 await page.goto('/#single');await page.getByRole('textbox',{name:'影像描述'}).fill(source);await page.getByRole('textbox',{name:'医生诊断'}).fill('合成诊断');await page.getByRole('button',{name:'开始质控',exact:true}).click();
 await expect(page.getByRole('button',{name:'停止检查'})).toBeVisible();
 await expect(page.locator('.single-stage-list')).toContainText('生成参考诊断');
 await expect(page.locator('.single-timeline-node.running')).toHaveCount(1);
 await page.evaluate(()=>{const send=(window as typeof window & {sendSingleEvent:(e:unknown)=>void}).sendSingleEvent;send({type:'stage',branch:'diagnosis',stage:'diagnosis.generate',state:'succeeded',attempt:1});send({type:'stage',branch:'diagnosis',stage:'diagnosis.judge',state:'running',attempt:1})});
 await expect(page.locator('.single-stage-list')).toContainText('核对诊断一致性');
 await page.screenshot({path:'../var/acceptance/single-chat-20261016/live-timeline.png'});
 await page.getByRole('button',{name:'停止检查'}).click();await expect(page.locator('.single-end-note')).toContainText('已停止等待');
 await expect(page.locator('.single-timeline-node.running')).toHaveCount(0);
 await page.getByRole('button',{name:'检查下一份'}).click();await expect(page.getByRole('textbox',{name:'影像描述'})).toBeVisible();
 await expect(page.getByRole('button',{name:'开始质控',exact:true})).toBeEnabled();
});

for(const width of [1280,1440,1920])test(`paired timeline ${width}px aligns process and output and opens full details`,async({page})=>{
 await page.setViewportSize({width,height:940});
 const report='合成报告：两肺血观束清晰，心影大小正常。'.repeat(12);
 await page.route('**/api/v1/single/stream',route=>route.fulfill({contentType:'application/x-ndjson',body:[
  {type:'preflight',state:'succeeded'},
  ...(['diagnosis','csc','cgec','rag'] as const).flatMap(branch=>[
   {type:'stage',branch,stage:branch==='diagnosis'?'diagnosis.generate':branch==='csc'?'csc.correct':branch==='cgec'?'cgec.student':'rag.first',state:'succeeded',at:'2026-10-16T09:00:00Z'},
   {type:'result',branch,elapsed_ms:4500,outcome:{status:'succeeded',finding:branch==='csc'?'issue':'no_issue',spans:branch==='csc'?[{start:8,end:9,text:'观'}]:[],suggestions:branch==='csc'?[{before:'观',after:'管'}]:[],details:branch==='diagnosis'?{reference_diagnosis:'合成参考诊断：未见明显异常。'}:{corrected_text:report.replaceAll('观','管')}}}
  ]),{type:'complete',state:'completed'},
 ].map(envelope).join('')}));
 await page.goto('/#single');await page.getByRole('textbox',{name:'影像描述'}).fill(report);await page.getByRole('textbox',{name:'医生诊断'}).fill('合成诊断：未见异常');await page.getByRole('button',{name:'开始质控',exact:true}).click();
 await expect(page.getByRole('button',{name:'检查下一份'})).toBeVisible();
 await expect(page.locator('.paired-timeline > li')).toHaveCount(5);
 const row=page.locator('[data-branch="csc"]');await row.scrollIntoViewIfNeeded();
 await expect(row.locator('.timeline-process')).toHaveCSS('transform','none');
 await expect(row.locator('.timeline-output')).toHaveCSS('transform','none');
 const bounds=await row.evaluate(el=>{const rect=(s:string)=>{const r=el.querySelector(s)!.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width}};const t=el.parentElement!.getBoundingClientRect();return {left:rect('.timeline-process'),dot:rect('.single-node-dot'),right:rect('.timeline-output'),center:t.x+t.width/2}});
 expect(Math.abs(bounds.dot.x+bounds.dot.width/2-bounds.center)).toBeLessThan(1);
 expect(bounds.left.x+bounds.left.width).toBeLessThan(bounds.dot.x);
 expect(bounds.right.x).toBeGreaterThan(bounds.dot.x+bounds.dot.width);
 expect(bounds.left.y).toBe(bounds.right.y);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await row.locator('.timeline-output-expand > summary').click();await expect(row.locator('.timeline-output-more')).toBeVisible();
 await expect(row.locator('.timeline-output-more')).toContainText('观 → 管');
 await page.getByRole('button',{name:'查看字符详情'}).click();
 const dialog=page.getByRole('dialog',{name:'字符质控详情'});await expect(dialog).toBeVisible();await expect(dialog.locator('mark')).toHaveText('观');
 await dialog.getByText('本次报告全文',{exact:true}).click();await expect(dialog).toContainText(report);
 await dialog.getByText('完整返回信息与追踪编号',{exact:true}).click();await expect(dialog).toContainText('browser-test');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'查看字符详情'})).toBeFocused();
 await row.locator('.timeline-output-expand > summary').click();
 await page.locator('.single-feed').evaluate(el=>el.scrollTop=0);await page.mouse.move(90,60);await page.waitForTimeout(250);
 await page.screenshot({path:test.info().outputPath(`paired-timeline-${width}.png`)});
});

for(const reduced of [false,true])test(`progressive cards follow real events and auto-scroll${reduced?' with reduced motion':''}`,async({page})=>{
 await page.setViewportSize({width:1440,height:700});
 await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
   if(String(input)!='/api/v1/single/stream')return original(input,init);
   const stream=new ReadableStream({start(controller){
    const send=(data:{type:string;[key:string]:unknown})=>{controller.enqueue(new TextEncoder().encode(JSON.stringify({status:'success',data,request_id:'progressive-test'})+'\n'));if(data.type==='complete')controller.close()};
    (window as typeof window & {sendSingleEvent:typeof send}).sendSingleEvent=send;
    send({type:'preflight',state:'running'});
    init?.signal?.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});
   }});
   return new Response(stream,{headers:{'content-type':'application/x-ndjson'}});
  };
 });
 await page.goto('/#single');await page.getByRole('textbox',{name:'影像描述'}).fill(source);await page.getByRole('textbox',{name:'医生诊断'}).fill('合成诊断');await page.getByRole('button',{name:'开始质控',exact:true}).click();
 await expect(page.locator('.timeline-process')).toHaveCount(1);
 await expect(page.locator('.timeline-output')).toHaveCount(0);
 await expect(page.locator('[data-branch]')).toHaveCount(0);
 const send=async(events:unknown[])=>page.evaluate(events=>{const emit=(window as typeof window & {sendSingleEvent:(e:unknown)=>void}).sendSingleEvent;events.forEach(emit)},events);
 await send([{type:'preflight',state:'succeeded'},{type:'branch',branch:'diagnosis',state:'running'}]);
 await expect(page.locator('[data-branch="diagnosis"]')).toBeVisible();
 await expect(page.locator('[data-branch="diagnosis"] .timeline-output')).toHaveCount(0);
 await expect(page.locator('[data-branch="csc"]')).toHaveCount(0);
 await expect(page.locator('[data-branch="diagnosis"] .timeline-process')).toHaveCSS('background-color','rgb(255, 255, 255)');
 await expect(page.locator('[data-branch="diagnosis"] .single-node-dot')).toHaveCSS('background-color','rgb(59, 130, 246)');
 await page.evaluate(()=>{
  const observed:string[]=[];(window as typeof window & {cardOrder:string[]}).cardOrder=observed;
  new MutationObserver(()=>{for(const [key,selector] of [['diagnosis-output','[data-branch="diagnosis"] .timeline-output'],['csc-process','[data-branch="csc"] .timeline-process']])if(document.querySelector(selector)&&!observed.includes(key))observed.push(key)}).observe(document.querySelector('.paired-timeline')!,{childList:true,subtree:true});
 });
 await send([{type:'result',branch:'diagnosis',elapsed_ms:4000,outcome:{status:'succeeded',finding:'no_issue',details:{reference_diagnosis:'合成参考诊断。'}}},{type:'branch',branch:'csc',state:'running'}]);
 await expect(page.locator('[data-branch="csc"]')).toBeVisible();
 expect(await page.evaluate(()=>(window as typeof window & {cardOrder:string[]}).cardOrder)).toEqual(['diagnosis-output','csc-process']);
 await expect(page.locator('[data-branch="csc"] .timeline-output')).toHaveCount(0);
 const feed=page.locator('.single-feed');
 await expect.poll(()=>feed.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(8);
 await expect.poll(()=>feed.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await feed.hover();await page.mouse.wheel(0,-1400);
 await expect(page.getByRole('button',{name:'查看最新进展'})).toBeVisible();
 await expect.poll(()=>feed.evaluate(el=>el.scrollTop)).toBe(0);
 await send([{type:'result',branch:'csc',outcome:{status:'succeeded',finding:'issue',details:{corrected_text:'合成字符修正。'}}},{type:'branch',branch:'cgec',state:'running'}]);
 await expect(page.locator('[data-branch="cgec"]')).toHaveCount(1);
 expect(await feed.evaluate(el=>el.scrollTop)).toBe(0);
 await page.getByRole('button',{name:'查看最新进展'}).click();
 await expect.poll(()=>feed.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(8);
 await expect(page.locator('[data-branch="csc"] .timeline-output')).toHaveCSS('background-color','rgb(255, 255, 255)');
 await expect(page.locator('[data-branch="csc"] .single-node-dot')).toHaveCSS('background-color','rgb(245, 158, 11)');
 await send([{type:'result',branch:'cgec',outcome:{status:'failed',finding:null,error:{code:'response_invalid',message:'合成失败',stage:'cgec.student',retryable:false}}},{type:'branch',branch:'rag',state:'running'}]);
 await expect(page.locator('[data-branch="rag"]')).toBeVisible();
 await expect(page.locator('[data-branch="cgec"] .timeline-output')).toHaveCSS('background-color','rgb(255, 255, 255)');
 await expect(page.locator('[data-branch="cgec"] .single-node-dot')).toHaveCSS('background-color','rgb(239, 68, 68)');
 await expect(page.locator('[data-branch="rag"] .timeline-output')).toHaveCount(0);
 await send([{type:'result',branch:'rag',outcome:{status:'succeeded',finding:'no_issue',details:{reason:'合成检索结果。'}}},{type:'complete',state:'partial'}]);
 await expect(page.getByRole('button',{name:'查看检索详情'})).toBeVisible();
 await expect.poll(()=>feed.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(8);
 await expect(page.locator('[data-branch="rag"] .timeline-output')).toHaveAttribute('data-reveal','visible');
 await expect(page.locator('[data-branch="rag"] .timeline-output')).toHaveCSS('opacity','1');
 await page.screenshot({path:test.info().outputPath(`progressive-${reduced?'reduced':'animated'}.png`)});
});
