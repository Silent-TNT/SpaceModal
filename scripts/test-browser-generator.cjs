const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const BrowserModel=require('../generator-studio/inference.js');
const core=require('../generator-studio/layout-core.js');
const render=require('../generator-studio/render.js');
const conditions=require('../generator-studio/conditions.js');
const model=new BrowserModel(require('../generator-studio/model.json'));
const references=require('./browser-model-reference.json');
let worst=0;
for(const ref of references){const result=model.predict(ref.program,ref.length,ref.width);assert.deepEqual(result.keys,ref.keys);
  for(const key of ['center','scale','bias','empty'])result[key].flat().forEach((v,i)=>{worst=Math.max(worst,Math.abs(v-ref[key].flat()[i]));});
  assert.deepEqual(result.assignments,ref.assignments);
}assert.ok(worst<1e-5);console.log('PASS Python/browser weights inference parity; max error',worst);
const defaults=conditions.DEFAULTS;
assert.deepEqual(conditions.local('10.8×10.8 米，三间卧室、两个卫生间',defaults).patch,{length:10800,width:10800,bedrooms:3,bathrooms:2});
assert.deepEqual(conditions.local('长12000毫米，宽9.9米，卧室改为四间',defaults).patch,{length:12000,width:9900,bedrooms:4});
assert.deepEqual(conditions.local('增加一间卧室',defaults).patch,{bedrooms:4});
assert.deepEqual(conditions.local('换一个方案',defaults).patch,{seed:124});
assert.throws(()=>conditions.local('10×10 米',defaults),/模数/);
assert.ok(conditions.local('不要厨房，要三层',defaults).unsupported.length);
assert.throws(()=>conditions.validate({bedrooms:0}));
console.log('PASS condition units, follow-up edits, unsupported preferences and bounds');

const {chromium}=require(process.env.PLAN_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const target=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404);return res.end();}const type=target.endsWith('.html')?'text/html':target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':'application/json';res.writeHead(200,{'Content-Type':type});fs.createReadStream(target).pipe(res);});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.PLAN_CHROMIUM_PATH||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r));
  await page.route('**/parse',async route=>{
    const r=route.request();assert.equal(r.headers().authorization,undefined);const body=r.postDataJSON();assert.equal(typeof body.text,'string');assert.ok(body.current);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({patch:{length:10800,width:10800,bedrooms:3,bathrooms:2},unsupported:[],source:'llm'})});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/generator-studio/`);
  await page.locator('[data-example]').first().click();await page.waitForSelector('.condition-card');
  assert.match(await page.locator('#messages').textContent(),/大模型已整理/);
  assert.equal(await page.locator('[name="anchorMode"]').count(),0);
  await page.locator('.generate-button').last().click();await page.waitForFunction(()=>GeneratorState.result&&!GeneratorState.busy,{},{timeout:180000});
  fs.mkdirSync(path.join(root,'.qa'),{recursive:true});
  fs.writeFileSync(path.join(root,'.qa/drawing-result.json'),JSON.stringify(await page.evaluate(()=>GeneratorState.result)));
  if(process.env.GENERATOR_SCREENSHOT)await page.screenshot({path:process.env.GENERATOR_SCREENSHOT,fullPage:true});
  assert.equal(await page.evaluate(()=>GeneratorState.view),'all');
  for(const id of ['volume','plan-view','topology'])assert.ok(await page.locator('#'+id).isVisible(),'overview includes '+id);
  assert.equal(await page.locator('#visible-floors').inputValue(),'2');
  assert.equal(await page.locator('#conversation-body').isVisible(),false,'confirmation collapses after generation');
  assert.match(await page.locator('.plan-panel h3').first().textContent(),/2F/);
  assert.ok(await page.locator('[data-edge-type="vertical"]').count()>0);
  const graphNode=page.locator('.topology-node').first(),sid=await graphNode.getAttribute('data-space-id'),floor=await graphNode.getAttribute('data-floor');
  await graphNode.click();
  assert.ok(await page.locator(`#plans rect.space-selected[data-space-id="${sid}"][data-floor="${floor}"]`).count()>0);
  assert.deepEqual(await page.evaluate(()=>GeneratorState.selected),{id:Number(sid),floor:Number(floor)});
  await page.locator('.topology-settings summary').click();
  await page.locator('[data-edge-toggle="adjacent"]').uncheck();
  assert.equal(await page.locator('[data-edge-type="adjacent"]:visible').count(),0);
  await page.locator('[data-edge-toggle="adjacent"]').check();
  await page.locator('.topology-settings summary').click();
  const graphBox=await page.locator('.topology-svg').getAttribute('viewBox');
  await page.locator('.topology-svg').hover();await page.mouse.wheel(0,-120);
  assert.notEqual(await page.locator('.topology-svg').getAttribute('viewBox'),graphBox);
  await page.locator('.topology-svg').dblclick();
  assert.equal(await page.locator('.topology-svg').getAttribute('viewBox'),graphBox);
  await page.locator('#volume-canvas').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Home');
  for(const width of [1920,1440,1366,1100,768,390]){
    await page.setViewportSize({width,height:width===1366?768:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow at '+width);
    if(width>=1100)assert.ok(await page.evaluate(()=>{
      const dock=document.getElementById('chat-form').getBoundingClientRect();
      return ['volume','plan-view','topology'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>240&&r.height>300&&r.bottom<=dock.top;});
    }),'readable, unobstructed overview at '+width);
  }
  await page.setViewportSize({width:1440,height:1000});
  console.log('PASS three-view overview, whole two-floor default, floor identity, linked selection, edge filters, drawing zoom and responsive dock');
  const result=await page.evaluate(()=>GeneratorState.result);assert.equal(result.model.generation.neuralUsed,true);assert.equal(result.meta.epoch,80);assert.equal(result.model.validation.accepted,true);
  const area=require('../generator-studio/area-prior.js'),profile=require('../generator-studio/area-prior.json');
  const empirical=JSON.parse(JSON.stringify(area.apply(core.createRoomProgram(3,2,area.balconyCounts(result.conditions,profile)),profile,10800*10800/1e6,result.conditions)));
  assert.equal(result.areaPrior.trainingCaseCount,300);
  assert.deepEqual(result.areaPrior.program,empirical);
  for(const report of result.model.programValidation.reports){const room=empirical.find(r=>r.key===report.key);assert.equal(report.targetArea,room.targetArea);assert.equal(report.areaSource.sourceSha256,result.areaPrior.sourceSha256);}
  await page.locator('.tools-menu summary').click();await page.locator('#area-info-open').click();assert.ok(await page.locator('#area-info').isVisible());assert.equal(await page.locator('#area-info tbody tr').count(),empirical.length);assert.match(await page.locator('#area-info-note').textContent(),/300/);await page.locator('#area-info-close').click();await page.locator('.tools-menu summary').click();
  console.log('PASS actual statistical program used in generation and visible area evidence');
  const choices=[result.model,...result.alternatives];
  assert.ok(choices.length>=1&&choices.length<=4);
  assert.ok(choices.every(m=>result.searchSummary.searches.some(s=>s.mode===m.anchorValidation.mode&&s.status==='found')));
  assert.equal(result.searchSummary.searches.length,3,'search all three relations even when fewer survive quality filtering');
  assert.deepEqual([...new Set(choices.map(m=>m.anchorValidation.relation))].sort(),[...result.searchSummary.selectedRelations].sort());
  assert.ok(choices.every(m=>m.generation.score<=choices[0].generation.score*1.35+15),'only comparable quality is displayed');
  console.log('Selected portfolio',choices.map(m=>({relation:m.anchorValidation.relation,score:m.generation.score,entry:m.programValidation.reports.find(r=>r.key==='entry').area})));
  assert.ok(choices.every(m=>m.organization.accepted));
  await page.locator('#show-circulation').check();assert.ok(await page.locator('.activity-envelope').count()>0);assert.ok(await page.locator('.circulation-route').count()>0);await page.locator('#show-circulation').uncheck();
  assert.match(await page.locator('#organization-summary').textContent(),/公共空间通行占用/);
  await page.locator('#prompt').focus();await page.locator('#search-info summary').click();assert.match(await page.locator('#search-info-content').textContent(),/个候选/);await page.locator('#search-info summary').click();await page.locator('#conversation-toggle').click();
  assert.deepEqual(result.areaPrior.balconyCounts,[0,2]);
  assert.equal(result.searchSummary.searches.reduce((sum,s)=>sum+s.budget,0),result.conditions.budget);
  assert.equal(result.conditions.anchorMode,undefined);
  assert.equal(result.searchSummary.validCandidateCount,result.searchSummary.searches.reduce((sum,s)=>sum+s.validCandidateCount,0));
  for(let i=0;i<choices.length;i++){
    await page.locator('#alternatives').selectOption(String(i));
    assert.match(await page.locator('#alternatives option:checked').textContent(),/入门近梯|侧向错位|前后分离/);
    assert.ok(choices[i].anchorValidation.accepted&&choices[i].programValidation.accepted&&choices[i].circulation.accepted);
    assert.deepEqual(await page.locator('.plan-panel h3').allTextContents(),['2F','1F']);
  }
  await page.locator('.tools-menu summary').click();const [selectedDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#download-json').click()]);
  await page.locator('.tools-menu summary').click();const selectedData=JSON.parse(fs.readFileSync(await selectedDownload.path(),'utf8'));
  assert.equal(selectedData.anchor_validation.mode,choices.at(-1).anchorValidation.mode);
  assert.equal(selectedData.area_prior.sourceSha256,result.areaPrior.sourceSha256);
  assert.deepEqual(selectedData.generation.conditions,result.conditions);
  await page.locator('#alternatives').selectOption('0');
  console.log('PASS automatic three-mode search, shared budget, unified labelled selection and valid options');
  const geometry=render.geometry(result.model);
  // Rectangle export must rebuild the same floor grids without overlap or identity loss.
  for(let f=0;f<2;f++){const grid=Array(result.model.nx*result.model.ny).fill(-1);for(const room of geometry.rooms.filter(r=>r.floor===f+1)){const sid=result.model.spaces.find(s=>s.key===room.functional_group_id).id;for(let y=room.box_min[1]/300;y<room.box_max[1]/300;y++)for(let x=room.box_min[0]/300;x<room.box_max[0]/300;x++){assert.equal(grid[y*result.model.nx+x],-1);grid[y*result.model.nx+x]=sid;}}assert.deepEqual(grid,Object.values(result.model.floorSpaces[f]));}
  assert.equal(await page.locator('#plans svg').count(),2);
  const layout=await page.locator('#plans').evaluate(el=>{const box=el.getBoundingClientRect();return [...el.querySelectorAll('.plan-panel')].every(panel=>{const svg=panel.querySelector('svg').getBoundingClientRect();return svg.bottom<=box.bottom+1&&svg.top>=box.top&&svg.height>100;});});
  assert.ok(layout,'both complete floor SVGs fit within the drawing canvas');
  await page.locator('[data-view="volume"]').click();assert.ok(await page.locator('#volume-canvas').evaluate(c=>c.width>0&&c.height>0));await page.waitForTimeout(200);if(process.env.GENERATOR_SCREENSHOT)await page.screenshot({path:process.env.GENERATOR_SCREENSHOT.replace('.png','-volume.png'),fullPage:true});
  await page.locator('#visible-floors').selectOption('1');await page.locator('#visible-floors').selectOption('2');
  await page.locator('[data-view="topology"]').click();assert.ok(await page.locator('#topology .topology-edge').count()>0);
  await page.locator('.tools-menu summary').click();await page.locator('[data-view="forecast"]').click();assert.equal(await page.locator('#forecast rect').count(),1152);
  console.log('PASS real browser model + generator, all four views and geometry identity round-trip');
  for(const button of ['download-json','download-showcase']){await page.locator('.tools-menu summary').click();const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#'+button).click()]);const file=await download.path();await page.locator('.tools-menu summary').click();if(button==='download-json')assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).review.project_accepted,null);else{const saved=path.join(path.dirname(process.env.GENERATOR_SCREENSHOT||__filename),'generator-showcase.html');fs.copyFileSync(file,saved);const standalone=await browser.newPage();standalone.on('pageerror',e=>errors.push('standalone: '+e.message));await standalone.goto('file:///'+saved.replace(/\\/g,'/'));await standalone.waitForSelector('#plans svg');assert.equal(await standalone.locator('#plans svg').count(),2);assert.ok(await standalone.locator('#volume').evaluate(c=>{const gl=c.getContext('webgl2');if(!gl||THREE.REVISION!=='172')return false;const pixels=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels.some((v,i)=>i%4===3&&v>0);}));assert.ok(await standalone.locator('#topology .topology-edge').count()>0);await standalone.close();}}
  console.log('PASS data download and self-contained plans/interactive 3D/A4 topology export');
  await page.reload();await page.waitForFunction(()=>GeneratorState.result);assert.equal(await page.evaluate(()=>GeneratorState.result.conditions.seed),123);assert.equal(await page.locator('#plans svg').count(),2);
  await page.locator('.tools-menu summary').click();await page.locator('#settings-open').click();await page.locator('#parser-mode').selectOption('local');await page.locator('#settings-form [type="submit"]').click();
  await page.locator('#prompt').fill('卧室改为四间');await page.locator('#send').click();await page.waitForSelector('.condition-card');assert.equal(await page.locator('.condition-card [name="bedrooms"]').last().inputValue(),'4');assert.match(await page.locator('#mode-label').textContent(),/无大模型调用/);
  await page.locator('#prompt').fill('换一个方案');await page.locator('#send').click();assert.equal(await page.locator('.condition-card [name="seed"]').last().inputValue(),'124');
  await page.locator('.generate-button').last().click();await page.locator('#cancel').click();assert.equal(await page.evaluate(()=>GeneratorState.busy),false);assert.equal(await page.evaluate(()=>GeneratorState.worker),null);
  await page.locator('#prompt').fill('不要厨房，要三层');await page.locator('#send').click();assert.ok(await page.locator('.warning').last().isVisible());
  await page.locator('#prompt').fill('10×10米');await page.locator('#send').click();await page.waitForFunction(()=>!GeneratorState.busy);assert.match(await page.locator('#messages').textContent(),/模数/);
  console.log('PASS reload recovery, follow-up chat, explicit fallback, stop and unsupported requirements');
  // Legacy mode remains readable, but cannot constrain a new automatic search.
  await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem('spacemodal-generator-last'));saved.conditions.anchorMode='hall';saved.model.generation.ruleRevision='bedroom-access-v2';delete saved.searchSummary;delete saved.areaPrior;localStorage.setItem('spacemodal-generator-last',JSON.stringify(saved));});
  await page.reload();await page.waitForFunction(()=>GeneratorState.result);
  assert.equal(await page.evaluate(()=>GeneratorState.conditions.anchorMode),undefined);
  assert.match(await page.locator('#result-status').textContent(),/重新生成/);
  await page.locator('#prompt').fill('换一个方案');await page.locator('#send').click();await page.waitForSelector('.condition-card');
  assert.equal(await page.locator('[name="anchorMode"]').count(),0);
  for(const width of [1440,1100,768,390]){await page.setViewportSize({width,height:950});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow at '+width);}
  assert.deepEqual(errors,[]);assert.ok(requests.filter(r=>r.url().includes('/parse')).every(r=>!r.headers().authorization));
  await page.locator('#prompt').fill('不要阳台，种子123');await page.locator('#send').click();
  assert.equal(await page.locator('.condition-card [name="balconies0"]').last().inputValue(),'0');
  assert.equal(await page.locator('.condition-card [name="balconies1"]').last().inputValue(),'0');
  await page.locator('.generate-button').last().click();
  await page.waitForFunction(()=>GeneratorState.result?.conditions.balconies0===0&&!GeneratorState.busy,{},{timeout:180000});
  assert.ok(await page.evaluate(()=>[GeneratorState.result.model,...GeneratorState.result.alternatives].every(m=>m.spaces.every(s=>s.label!==9)&&m.validation.accepted&&m.programValidation.accepted&&m.circulation.accepted)));
  assert.deepEqual(errors,[]);
  console.log('PASS user removes balconies through chat, confirmation and actual valid generation');
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-view="all"]').click();
  await page.screenshot({path:process.env.GENERATOR_SCREENSHOT||path.join(root,'scripts/generator-qa.png'),fullPage:true});
  console.log('PASS responsive 1440/1100/768/390, no browser errors or client API key');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
