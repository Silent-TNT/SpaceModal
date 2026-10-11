const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAN_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const target=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':target.endsWith('.html')?'text/html':target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':'application/json'});
  fs.createReadStream(target).pipe(res);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAN_CHROMIUM_PATH||undefined});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/worker.js?baseline=1',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(root,'generator-studio/worker.js'),'utf8').replace('onLayout:(models,summary)=>publish(models,summary,false),','')}));
    await page.goto(`http://127.0.0.1:${server.address().port}/generator-studio/?parser=local`);
    const start=async stop=>page.evaluate(stop=>{
      window.previewEvents=[];
      generate({...Conditions.DEFAULTS,budget:240},{});
      GeneratorState.worker.addEventListener('message',({data})=>{
        if(!data.partial)return;
        previewEvents.push({busy:GeneratorState.busy,workerAlive:!!GeneratorState.worker,
          accepted:GeneratorState.models.every(m=>m.validation.accepted&&m.circulation.accepted&&m.programValidation.accepted&&m.anchorValidation.accepted&&m.daylight.accepted),
          drawn:document.querySelectorAll('#plans .plan-panel').length,
          status:document.getElementById('result-status').textContent,
          running:data.searchSummary.searches.some(s=>s.status==='running'),elapsed:data.elapsedSeconds});
        if(stop)document.getElementById('cancel').click();
      });
    },stop);
    await start(false);
    await page.waitForFunction(()=>GeneratorState.result?.done&&!GeneratorState.busy,{},{timeout:180000});
    const full=await page.evaluate(()=>({events:previewEvents,result:GeneratorState.result}));
    assert.ok(full.events.length>=2,'streams first validated candidate and later mode results');
    assert.ok(full.events[0].running,'first result arrives before its mode finishes');
    assert.ok(full.events.every(e=>e.busy&&e.workerAlive&&e.accepted&&e.drawn===2));
    assert.match(full.events[0].status,/合格方案.*继续优化/);
    assert.ok(full.events[0].elapsed<full.result.elapsedSeconds);
    assert.equal(full.result.partial,false);
    assert.equal(full.result.searchSummary.partial,undefined);
    assert.ok(full.result.model.validation.accepted);
    console.log(`PASS actual Worker: first layout ${full.events[0].elapsed.toFixed(2)}s; complete ${full.result.elapsedSeconds.toFixed(2)}s; ${full.events.length} updates`);
    const baseline=await page.evaluate(conditions=>new Promise((resolve,reject)=>{
      const worker=new Worker('worker.js?baseline=1');
      worker.onmessage=({data})=>{if(data.done){worker.terminate();resolve(data);}else if(data.error){worker.terminate();reject(Error(data.error));}};
      worker.onerror=e=>{worker.terminate();reject(Error(e.message));};worker.postMessage(conditions);
    }),full.result.conditions);
    const geometry=m=>({floors:m.floors.map(g=>Array.from(g)),floorSpaces:m.floorSpaces.map(g=>Array.from(g)),score:m.generation.score,candidate:m.generation.selectedCandidate,mode:m.anchorValidation.mode});
    assert.deepEqual([full.result.model,...full.result.alternatives].map(geometry),[baseline.model,...baseline.alternatives].map(geometry));
    assert.deepEqual(full.result.searchSummary,baseline.searchSummary);
    console.log('PASS streaming and non-streaming generation produce identical final geometry, ranking and diagnostics');
    await page.reload();
    assert.equal(await page.evaluate(()=>GeneratorState.result.partial),false);
    await start(true);
    await page.waitForFunction(()=>previewEvents.length&&!GeneratorState.busy,{},{timeout:180000});
    assert.equal(await page.evaluate(()=>GeneratorState.worker),null);
    assert.equal(await page.evaluate(()=>GeneratorState.result.stopped),true);
    assert.match(await page.locator('#result-status').textContent(),/已停止.*已保留/);
    await page.locator('.tools-menu summary').click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download-json').click()]);
    const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(exported.generation.search_summary.partial,true);
    assert.equal(exported.daylight.accepted,true);
    await page.reload();
    assert.equal(await page.evaluate(()=>GeneratorState.result.stopped),true);
    assert.equal(await page.locator('#plans .plan-panel').count(),2);
    assert.match(await page.locator('#result-status').textContent(),/已保留.*优化未完成/);
    console.log('PASS stop retains validated layout, download identifies partial search, reload restores layout');
    // A later calculation failure must preserve this run's validated preview.
    await page.evaluate(()=>{
      const preview=structuredClone(GeneratorState.result);
      generate({...Conditions.DEFAULTS,budget:240},{});
      const worker=GeneratorState.worker;
      worker.onmessage({data:preview});
      worker.onmessage({data:{error:'模拟后续计算失败'}});
    });
    assert.equal(await page.evaluate(()=>GeneratorState.busy),false);
    assert.equal(await page.evaluate(()=>GeneratorState.result.stopped),true);
    assert.equal(await page.locator('#plans .plan-panel').count(),2);
    assert.match(await page.locator('#result-status').textContent(),/已保留/);
    assert.deepEqual(errors,[]);
    console.log('PASS later error retains preview; no browser errors');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
