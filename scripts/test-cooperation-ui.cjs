const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAN_PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAN_CHROMIUM_PATH||undefined});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8898/generator-lab/');
  await page.evaluate(async()=>{GeneratorState.mode='local';const c={length:12000,width:12000,bedrooms:3,bathrooms:2,seed:123,budget:32};await generate(c,{},Design.defaults(c,'edge'));});
  const accepted=await page.evaluate(()=>JSON.stringify(GeneratorState.result.model.floorSpaces));
  await page.evaluate(async()=>{const c={length:7200,width:12000,bedrooms:3,bathrooms:2,seed:123,budget:32};await generate(c,{},Design.defaults(c,'central',{multi_purpose:0}));});
  assert.equal(await page.evaluate(()=>JSON.stringify(GeneratorState.result.model.floorSpaces)),accepted);assert.ok((await page.locator('#history-content').textContent()).includes('可用宽度或面积不足'));
  await page.route('**/design',async route=>{const body=route.request().postDataJSON(),plan=body.current_plan;plan.rooms.find(r=>r.type==='bedroom').floor=1;await route.fulfill({json:{patch:{},strategies:[plan],unsupported:[]}});});
  await page.evaluate(async()=>{GeneratorState.mode='remote';const c={length:7200,width:12000,bedrooms:3,bathrooms:2,seed:123,budget:32};await generate(c,{},Design.defaults(c,'central',{multi_purpose:0}));});
  assert.equal(await page.evaluate(()=>JSON.stringify(GeneratorState.result.model.floorSpaces)),accepted);
  await page.unroute('**/design');
  await page.route('**/design',async route=>{const body=route.request().postDataJSON(),plan=body.current_plan;plan.mode='edge';plan.design_summary='把楼梯移到边部，减少狭窄分区；仍需重新检查。<img src=x onerror=alert(1)>'; await route.fulfill({json:{patch:{},strategies:[plan],unsupported:[]}});});
  await page.evaluate(async()=>{GeneratorState.mode='remote';const c={length:7200,width:12000,bedrooms:3,bathrooms:2,seed:123,budget:32};await generate(c,{},Design.defaults(c,'central',{multi_purpose:0}));});
  const processText=await page.locator('#history-content').textContent();assert.ok(processText.includes('可用宽度或面积不足'));assert.ok(processText.includes('楼梯居中调整为楼梯靠边'));assert.ok(processText.includes('大模型调整说明'));assert.ok(processText.includes('上下层楼梯位置对齐'));assert.ok(!processText.includes('room_band_capacity'));assert.equal(await page.locator('.process-checks li').count(),6);assert.equal(await page.locator('#history-content img').count(),0);assert.ok(await page.locator('#plans').evaluate(el=>el.getBoundingClientRect().height>250));await page.screenshot({path:'qa-artifacts/design-process.png',fullPage:true});
  const revised=await page.evaluate(()=>JSON.stringify(GeneratorState.result.model.floorSpaces));
  await page.route('**/generator-lab/worker.js',route=>route.fulfill({contentType:'application/javascript',body:'self.onmessage=()=>{};'}));
  await page.evaluate(()=>{const c={length:12000,width:12000,bedrooms:3,bathrooms:2,seed:123,budget:32};generate(c,{},Design.defaults(c));});
  await page.locator('#cancel').click();await page.waitForFunction(()=>!GeneratorState.busy);assert.equal(await page.evaluate(()=>JSON.stringify(GeneratorState.result.model.floorSpaces)),revised);assert.ok((await page.locator('#history-content').textContent()).includes('已停止生成'));assert.deepEqual(errors,[]);
  console.log('PASS local failure, rejected remote revision and cancellation retain prior valid results; no browser errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
