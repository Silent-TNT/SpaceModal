const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAN_PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAN_CHROMIUM_PATH||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),authorization:Boolean(r.headers().authorization)}));
  const response=await page.goto('https://www.spacemodal.com/generator-studio/');assert.equal(response.status(),200);
  await page.locator('[data-example]').first().click();await page.waitForSelector('.condition-card',{timeout:60000});
  assert.match(await page.locator('#messages').textContent(),/大模型已整理/);
  assert.equal(await page.locator('.condition-card [name="bedrooms"]').inputValue(),'3');
  await page.locator('.generate-button').click();await page.waitForFunction(()=>GeneratorState.result&&!GeneratorState.busy,{},{timeout:180000});
  assert.equal(await page.evaluate(()=>GeneratorState.result.model.generation.neuralUsed),true);
  assert.equal(await page.locator('#plans svg').count(),2);
  if(process.env.GENERATOR_SCREENSHOT)await page.screenshot({path:process.env.GENERATOR_SCREENSHOT,fullPage:true});
  await page.locator('[data-view="volume"]').click();await page.waitForTimeout(300);
  const box=await page.locator('#volume-canvas').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2+20);await page.mouse.up();
  if(process.env.GENERATOR_VOLUME_SCREENSHOT)await page.screenshot({path:process.env.GENERATOR_VOLUME_SCREENSHOT,fullPage:true});
  await page.locator('#prompt').fill('卧室改为四间');await page.locator('#send').click();await page.waitForFunction(()=>document.querySelectorAll('.condition-card').length===2,{},{timeout:60000});
  assert.equal(await page.locator('.condition-card [name="bedrooms"]').last().inputValue(),'4');
  assert.equal(await page.locator('.condition-card [name="length"]').last().inputValue(),'10800');
  assert.equal(requests.filter(r=>r.url.includes('dashscope.aliyuncs.com')||r.url.includes('api.deepseek.com')).length,0);assert.ok(requests.filter(r=>r.url.includes('/parse')).every(r=>!r.authorization));assert.deepEqual(errors,[]);
  console.log('PASS live HTTPS page, actual hosted LLM parser, browser neural model, generation, 3D interaction and follow-up requirements; no browser API key');
  await page.setViewportSize({width:390,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.goto('https://www.spacemodal.com/');assert.ok(await page.locator('a[href="/generator-studio/"]').count()>0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  console.log('PASS live navigation and mobile widths');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
