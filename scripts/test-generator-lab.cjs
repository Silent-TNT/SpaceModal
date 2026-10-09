const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Design=require('../generator-lab/design.js'),Free=require('../generator-lab/free-core.js');
const BrowserModel=require('../generator-studio/inference.js');
const neural=new BrowserModel(require('../generator-studio/model.json'));
const conditions={length:12000,width:12000,bedrooms:3,bathrooms:2,seed:123,budget:32};
const counts=Design.explicitCounts('不要厨房，要两个阳台');assert.deepEqual(counts,{kitchen:0,balcony:2});
assert.equal(Design.defaults(conditions,'edge',counts).rooms.filter(r=>r.type==='kitchen').length,0);
const disconnected=Design.defaults(conditions);disconnected.edges=[];assert.throws(()=>Design.validate(disconnected,conditions),/连接/);
const wrongCounts=Design.defaults(conditions);wrongCounts.requirements.counts={kitchen:0};assert.throws(()=>Design.validate(wrongCounts,conditions),/数量/);
const fingerprints=new Set();
for(const seed of [11,42,123])for(const mode of ['central','edge','split']){
 const plan=Design.defaults(conditions,mode),program=Design.compile(plan),forecast=neural.predict(program,12000,12000);
 const result=Free.generate({...conditions,seed,plan,program,priors:forecast.priors});
 assert.ok(Free.evaluate(result.model,plan).accepted);
 assert.ok(result.model.floorSpaces.flat().some(v=>v===-1));
 assert.equal(result.model.spaces.filter(r=>r.label===4).length,3);
 assert.ok(result.model.generation.neuralUsed);
 fingerprints.add(JSON.stringify(result.model.floorSpaces));
 console.log('PASS model preferences + topology gates',mode,seed,result.model.generation.validCandidateCount);
}assert.equal(fingerprints.size,9);
const {chromium}=require(process.env.PLAN_PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAN_CHROMIUM_PATH||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('spacemodal-topology-lab-preferences',JSON.stringify({mode:'local',budget:32})));
  await page.goto(process.env.LAB_URL||'http://127.0.0.1:8898/generator-lab/');
  await page.locator('[data-example]').first().click();
  assert.equal(await page.locator('.target-preview svg').count(),1);
  assert.equal(await page.evaluate(()=>GeneratorState.result),null);
  await page.locator('.strategy-select').last().selectOption('1');
  await page.locator('.generate-button').last().click();
  await page.waitForFunction(()=>!GeneratorState.busy,{}, {timeout:60000});
  assert.ok(await page.evaluate(()=>GeneratorState.result?.model.validation.accepted));
  for(const view of ['plans','volume','topology','forecast'])await page.locator(`[data-view="${view}"]`).click();
  const jsonDownload=page.waitForEvent('download');await page.locator('#download-json').click();
  const downloaded=await jsonDownload;const data=JSON.parse(fs.readFileSync(await downloaded.path(),'utf8'));
  assert.ok(data.undefined_reserve_regions.length);assert.ok(data.target_topology.rooms.length);assert.ok(data.actual_topology.length);
  const htmlDownload=page.waitForEvent('download');await page.locator('#download-showcase').click();const html=await htmlDownload;
  const artifact=path.resolve(__dirname,'../qa-artifacts/topology-voxel-showcase.html');fs.mkdirSync(path.dirname(artifact),{recursive:true});await html.saveAs(artifact);
  const showcase=await browser.newPage();await showcase.goto('file:///'+artifact.replace(/\\/g,'/'));
  assert.equal(await showcase.locator('#plans svg').count(),2);assert.equal(await showcase.locator('#topology svg').count(),1);await showcase.locator('#floors').selectOption('1');
  await page.reload();assert.ok(await page.evaluate(()=>GeneratorState.result));
  await page.locator('#prompt').fill('不要厨房，卧室改为四间');await page.locator('#send').click();
  const planned=JSON.parse(await page.locator('.condition-card pre').last().textContent()).target_topology;
  assert.equal(planned.rooms.filter(r=>r.type==='kitchen').length,0);assert.equal(planned.rooms.filter(r=>r.type==='bedroom').length,4);
  for(const width of [1440,1100,768,390]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow '+width);}
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-view="plans"]').click();await page.screenshot({path:path.resolve(__dirname,'../qa-artifacts/topology-lab.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS topology preview, actual model generation, four views, JSON reserve/graphs, offline HTML, restoration, explicit counts, responsive widths');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
