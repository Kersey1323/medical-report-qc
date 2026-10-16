import {test,expect} from '@playwright/test';

test('review queue groups tasks and updates counts after each decision',async({page})=>{
 const seed=async(descriptions:string[])=>{
  const ids=[];
  for(const description of descriptions){
   const response=await page.request.post('/api/v1/reports',{data:{description,diagnosis:'合成诊断'}});
   ids.push((await response.json()).data.id);
  }
  const created=await page.request.post('/api/v1/runs',{data:{report_ids:ids,checks:['csc']}});
  const run=(await created.json()).data;
  await page.request.post(`/api/v1/runs/${run.id}/start`);
  await expect.poll(async()=>{
   const response=await page.request.get(`/api/v1/runs/${run.id}`);
   return (await response.json()).data.status;
  }).toBe('completed');
  return run.id as string;
 };
 const runA=await seed(['合成任务甲第一份：两肺血观束清晰。','合成任务甲第二份：两肺血观束清晰。']);
 const runB=await seed(['合成任务乙：两肺血观束清晰。']);
 await page.goto('/#review');
 const table=page.getByRole('table',{name:'待复核质控任务'});
 const row=table.getByRole('row').filter({has:page.getByRole('button',{name:`复核任务 ${runA.slice(0,8)}`})});
 await expect(row).toBeVisible();
 await expect(row.getByRole('cell').nth(2)).toHaveText('2');
 await expect(row.getByRole('cell').nth(3)).toHaveText('2');
 await expect(row.getByRole('cell').nth(4)).toHaveText('2 条');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('review-tasks.png')});
 await row.getByRole('button',{name:`复核任务 ${runA.slice(0,8)}`}).click();
 const queue=page.getByRole('region',{name:'任务待复核建议'});
 await expect(queue.getByRole('button',{name:/合成任务甲/})).toHaveCount(2);
 await expect(page.getByText('合成任务乙：两肺血观束清晰。')).toHaveCount(0);
 await queue.getByRole('button',{name:/合成任务甲第一份/}).click();
 await page.screenshot({path:test.info().outputPath('review-task-detail.png')});
 await page.getByRole('button',{name:'接受建议',exact:true}).click();
 await expect(queue.getByRole('button',{name:/合成任务甲/})).toHaveCount(1);
 await page.getByRole('button',{name:'返回任务列表'}).click();
 await expect(row.getByRole('cell').nth(3)).toHaveText('1');
 await expect(row.getByRole('cell').nth(4)).toHaveText('1 条');
 await row.getByRole('button',{name:`复核任务 ${runA.slice(0,8)}`}).click();
 await queue.getByRole('button',{name:/合成任务甲第二份/}).click();
 await page.getByRole('button',{name:'接受建议',exact:true}).click();
 await expect(page.getByText('该任务暂无待复核建议')).toBeVisible();
 await page.getByRole('button',{name:'返回任务列表'}).click();
 await expect(page.getByRole('button',{name:`复核任务 ${runA.slice(0,8)}`})).toHaveCount(0);
 await expect(page.getByRole('button',{name:`复核任务 ${runB.slice(0,8)}`})).toBeVisible();
});
