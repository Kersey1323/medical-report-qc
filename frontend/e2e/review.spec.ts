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
 const reports=page.getByRole('table',{name:'任务复核报告'});
 await expect(reports.getByRole('row')).toHaveCount(3);
 await expect(page.getByText('合成任务乙：两肺血观束清晰。')).toHaveCount(0);
 await reports.getByRole('row').filter({hasText:'合成任务甲第一份'}).getByRole('button',{name:/^复核报告 /}).click();
 await expect(page).toHaveURL(new RegExp(`/review/runs/${runA}/reports/[^/]+/csc$`));
 await expect(page.getByRole('navigation',{name:'报告质控项目'})).toBeVisible();
 await expect(page.locator('.review-layout')).toHaveCount(0);
 await page.screenshot({path:test.info().outputPath('review-report.png')});
 await page.getByRole('button',{name:'接受建议',exact:true}).click();
 await expect(page.locator('.review-bar')).toContainText('已接受');
 await page.getByRole('button',{name:'返回报告列表'}).click();
 await expect(reports.getByRole('row')).toHaveCount(2);
 await page.getByRole('button',{name:'全部报告',exact:true}).click();
 await expect(reports.getByRole('row')).toHaveCount(3);
 await expect(reports.getByText('无待复核项')).toBeVisible();
 await page.getByRole('button',{name:'返回任务列表'}).click();
 await expect(row.getByRole('cell').nth(3)).toHaveText('1');
 await expect(row.getByRole('cell').nth(4)).toHaveText('1 条');
 await row.getByRole('button',{name:`复核任务 ${runA.slice(0,8)}`}).click();
 await reports.getByRole('row').filter({hasText:'合成任务甲第二份'}).getByRole('button',{name:/^复核报告 /}).click();
 await page.getByRole('button',{name:'接受建议',exact:true}).click();
 await expect(page.locator('.review-bar')).toContainText('已接受');
 await page.getByRole('button',{name:'返回报告列表'}).click();
 await expect(page.getByText('该任务暂无待复核报告')).toBeVisible();
 await page.getByRole('button',{name:'返回任务列表'}).click();
 await expect(page.getByRole('button',{name:`复核任务 ${runA.slice(0,8)}`})).toHaveCount(0);
 await expect(page.getByRole('button',{name:`复核任务 ${runB.slice(0,8)}`})).toBeVisible();
});
