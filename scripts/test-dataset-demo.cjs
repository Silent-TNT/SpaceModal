const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.PLAN_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const target=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404);return res.end();}
  const type=target.endsWith('.html')?'text/html':target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':target.endsWith('.jpg')?'image/jpeg':'application/json';
  res.writeHead(200,{'Content-Type':type});fs.createReadStream(target).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAN_CHROMIUM_PATH||undefined});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],apiRequests=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))apiRequests.push(r.url());});
    page.on('dialog',d=>d.accept());
    const url=`http://127.0.0.1:${server.address().port}/dataset-studio/`;
    await page.goto(url);await page.waitForFunction(()=>state.draft?.case_id===2107&&Object.keys(state.images).length===2&&!persistence.switching);
    assert.equal(await page.evaluate(()=>state.cases.length),10);
    for(const id of [2107,2108,2110,2111,2115,2125,2126,2128,2135,2142]){
      await page.evaluate(id=>openCase(id),id);
      assert.equal(await page.evaluate(()=>Object.keys(state.images).length),2);
      assert.ok(await page.evaluate(()=>state.draft.rooms.length)>0);
    }
    console.log('PASS ten samples and twenty floor images');
    await page.locator('#rotate-btn').click();await page.evaluate(()=>autosaveTick());
    const rotation=await page.evaluate(()=>state.draft.north_rotation_quadrants);
    await page.reload();await page.waitForFunction(()=>state.draft&&!persistence.switching);
    await page.evaluate(()=>openCase(2142));assert.equal(await page.evaluate(()=>state.draft.north_rotation_quadrants),rotation);
    console.log('PASS browser-only save and refresh recovery');

    await page.locator('#upload-plans-btn').click();
    await page.locator('[name=name]').fill('答辩本地上传');
    const image=path.join(root,'dataset-studio/cases/2107/floor-1.jpg');
    // Same filename on both floors must still map to two independent uploaded blobs.
    await page.locator('[name=floor1]').setInputFiles(image);await page.locator('[name=floor2]').setInputFiles(image);
    await page.locator('[name=width]').fill('600');await page.locator('[name=depth]').fill('600');
    await page.locator('#upload-form [type=submit]').click();
    await page.waitForFunction(()=>state.draft?.source==='local_upload'&&!persistence.switching);
    const importedId=await page.evaluate(()=>state.draft.case_id);
    assert.equal(await page.evaluate(()=>state.cases.length),11);
    assert.equal(await page.evaluate(()=>new Set(state.draft.floors.map(f=>f.image_name)).size),2);
    await page.evaluate(()=>{state.draft.rooms=[
      {id:'a',floor:1,type:'entryway',box_min:[0,0,0],box_max:[600,600,3000]},
      {id:'b',floor:2,type:'bedroom',box_min:[0,0,3000],box_max:[600,600,6000]}];renderRoomList();render();});
    await page.evaluate(()=>autosaveTick());await page.reload();await page.waitForFunction(()=>state.draft&&!persistence.switching);
    await page.evaluate(id=>openCase(id),importedId);
    assert.equal(await page.evaluate(()=>state.draft.rooms.length),2);
    assert.ok(await page.evaluate(()=>state.draft.floors.every(f=>f.image_url.startsWith('blob:'))));
    console.log('PASS upload, two image mapping, edit and persistent reload');

    await page.locator('#validate-btn').click();await page.waitForFunction(()=>state.qc?.valid===true);
    const downloadPromise=page.waitForEvent('download');await page.locator('#approve-btn').click();
    const download=await downloadPromise,downloadPath=await download.path();
    const data=JSON.parse(fs.readFileSync(downloadPath,'utf8'));
    assert.equal(data.schema_version,'geometry_v1');assert.equal(data.rooms.length,2);assert.equal(data.review.mode,'browser_demo');
    assert.equal(await page.evaluate(()=>state.draft.status),'draft');
    console.log('PASS validation and geometry download without sealing editable draft');
    await page.locator('#vision-btn').click();await page.waitForFunction(()=>document.getElementById('message').textContent.includes('没有在线 AI'));
    console.log('PASS uploaded plans do not claim online AI recognition');
    assert.deepEqual(apiRequests,[]);assert.deepEqual(errors,[]);
    console.log('PASS no private backend calls or browser errors');
    for(const width of [1440,1100,768,390]){
      await page.setViewportSize({width,height:1000});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);
    }
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>openCase(2107));
    if(!await page.evaluate(()=>drawerPinned('inspector')))await page.locator('#inspector-toggle').click();
    await page.waitForTimeout(350);
    if(process.env.PLAN_SCREENSHOT_PATH)await page.screenshot({path:process.env.PLAN_SCREENSHOT_PATH});
    console.log('PASS responsive layout');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
