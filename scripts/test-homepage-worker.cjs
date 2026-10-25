const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAN_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),budget=Number(process.env.GENERATOR_BUDGET||2400);
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/json'});
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.PLAN_CHROMIUM_PATH||undefined});
    const page=await browser.newPage(),errors=[],requests=[],reports=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
    await page.goto(`http://127.0.0.1:${server.address().port}/generator-studio/?parser=local`);
    for(const index of [0,3]){
      await page.evaluate(({index,budget})=>{
        const text=document.querySelectorAll('[data-example]')[index].dataset.example;
        const d={...Conditions.DEFAULTS,...Conditions.local(text,Conditions.DEFAULTS).patch,budget};
        window.testConditions=d;generate(d,{});
      },{index,budget});
      await page.waitForFunction(()=>!GeneratorState.busy,{},{timeout:600000});
      const report=await page.evaluate(()=>{
        const s=GeneratorState,r=s.result,m=r?.model;
        return {conditions:window.testConditions,done:r?.done,bedrooms:m?.spaces.filter(x=>x.label===4).length,
          bathrooms:m?.spaces.filter(x=>x.label===5).length,valid:r?.searchSummary.validCandidateCount,
          gates:m&&[m.validation,m.programValidation,m.circulation,m.anchorValidation,m.organization,m.daylight,m.traffic,m.functional,m.functionalRelations,m.mealGeometry,m.kitchenDining].every(x=>x?.accepted),
          drawn:document.querySelectorAll('#plans svg').length,messages:!r?document.getElementById('messages').textContent:undefined};
      });
      assert.ok(report.done,JSON.stringify(report));assert.ok(report.gates,JSON.stringify(report));assert.ok(report.valid>0);
      assert.equal(report.bedrooms,report.conditions.bedrooms);assert.equal(report.bathrooms,report.conditions.bathrooms);assert.equal(report.drawn,2);
      reports.push(report);console.log('PASS browser Worker',JSON.stringify(report));
    }
    assert.ok(requests.some(u=>u.includes('joint-planner.js?v=demand-program-v1')));
    assert.ok(requests.some(u=>u.includes('worker.js?v=demand-program-v1')));
    assert.deepEqual(errors,[]);
    fs.mkdirSync(path.join(root,'.qa'),{recursive:true});fs.writeFileSync(path.join(root,'.qa/homepage-worker.json'),JSON.stringify(reports,null,2));
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
