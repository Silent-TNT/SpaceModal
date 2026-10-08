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
  await page.route('https://spacemodal-parser.silent-tnt.chatgpt.site/parse',async route=>{
    const r=route.request();assert.equal(r.headers().authorization,undefined);const body=r.postDataJSON();assert.equal(typeof body.text,'string');assert.ok(body.current);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({patch:{length:10800,width:10800,bedrooms:3,bathrooms:2},unsupported:[],source:'llm'})});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/generator-studio/`);
  await page.locator('[data-example]').first().click();await page.waitForSelector('.condition-card');
  assert.match(await page.locator('#messages').textContent(),/大模型已整理/);
  await page.locator('.generate-button').last().click();await page.waitForFunction(()=>GeneratorState.result&&!GeneratorState.busy,{},{timeout:180000});
  const result=await page.evaluate(()=>GeneratorState.result);assert.equal(result.model.generation.neuralUsed,true);assert.equal(result.meta.epoch,80);assert.equal(result.model.validation.accepted,true);
  const geometry=render.geometry(result.model);
  // Rectangle export must rebuild the same floor grids without overlap or identity loss.
  for(let f=0;f<2;f++){const grid=Array(result.model.nx*result.model.ny).fill(-1);for(const room of geometry.rooms.filter(r=>r.floor===f+1)){const sid=result.model.spaces.find(s=>s.key===room.functional_group_id).id;for(let y=room.box_min[1]/300;y<room.box_max[1]/300;y++)for(let x=room.box_min[0]/300;x<room.box_max[0]/300;x++){assert.equal(grid[y*result.model.nx+x],-1);grid[y*result.model.nx+x]=sid;}}assert.deepEqual(grid,Object.values(result.model.floorSpaces[f]));}
  assert.equal(await page.locator('#plans svg').count(),2);
  await page.locator('[data-view="volume"]').click();assert.ok(await page.locator('#volume-canvas').evaluate(c=>c.width>0&&c.height>0));await page.waitForTimeout(200);if(process.env.GENERATOR_SCREENSHOT)await page.screenshot({path:process.env.GENERATOR_SCREENSHOT.replace('.png','-volume.png'),fullPage:true});
  await page.locator('#visible-floors').selectOption('1');await page.locator('#visible-floors').selectOption('2');
  await page.locator('[data-view="topology"]').click();assert.ok(await page.locator('#topology line').count()>0);
  await page.locator('[data-view="forecast"]').click();assert.equal(await page.locator('#forecast rect').count(),1152);
  console.log('PASS real browser model + generator, all four views and geometry identity round-trip');
  for(const button of ['download-json','download-showcase']){const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#'+button).click()]);const file=await download.path();if(button==='download-json')assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).review.project_accepted,null);else{const saved=path.join(path.dirname(process.env.GENERATOR_SCREENSHOT||__filename),'generator-showcase.html');fs.copyFileSync(file,saved);const standalone=await browser.newPage();standalone.on('pageerror',e=>errors.push('standalone: '+e.message));await standalone.goto('file:///'+saved.replace(/\\/g,'/'));await standalone.waitForSelector('#plans svg');assert.equal(await standalone.locator('#plans svg').count(),2);assert.ok(await standalone.locator('#volume').evaluate(c=>c.width>0));assert.ok(await standalone.locator('#topology line').count()>0);await standalone.close();}}
  console.log('PASS data download and self-contained plans/interactive 3D/A4 topology export');
  await page.reload();await page.waitForFunction(()=>GeneratorState.result);assert.equal(await page.evaluate(()=>GeneratorState.result.conditions.seed),123);assert.equal(await page.locator('#plans svg').count(),2);
  await page.locator('#settings-open').click();await page.locator('#parser-mode').selectOption('local');await page.locator('#settings-form [type="submit"]').click();
  await page.locator('#prompt').fill('卧室改为四间');await page.locator('#send').click();await page.waitForSelector('.condition-card');assert.equal(await page.locator('.condition-card [name="bedrooms"]').last().inputValue(),'4');assert.match(await page.locator('#mode-label').textContent(),/无大模型调用/);
  await page.locator('#prompt').fill('换一个方案');await page.locator('#send').click();assert.equal(await page.locator('.condition-card [name="seed"]').last().inputValue(),'124');
  await page.locator('.generate-button').last().click();await page.locator('#cancel').click();assert.equal(await page.evaluate(()=>GeneratorState.busy),false);assert.equal(await page.evaluate(()=>GeneratorState.worker),null);
  await page.locator('#prompt').fill('不要厨房，要三层');await page.locator('#send').click();assert.ok(await page.locator('.warning').last().isVisible());
  await page.locator('#prompt').fill('10×10米');await page.locator('#send').click();await page.waitForFunction(()=>!GeneratorState.busy);assert.match(await page.locator('#messages').textContent(),/模数/);
  console.log('PASS reload recovery, follow-up chat, explicit fallback, stop and unsupported requirements');
  for(const width of [1440,1100,768,390]){await page.setViewportSize({width,height:950});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow at '+width);}
  assert.deepEqual(errors,[]);assert.ok(requests.filter(r=>r.url().includes('/parse')).every(r=>!r.headers().authorization));
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-view="plans"]').click();
  await page.screenshot({path:process.env.GENERATOR_SCREENSHOT||path.join(root,'scripts/generator-qa.png'),fullPage:true});
  console.log('PASS responsive 1440/1100/768/390, no browser errors or client API key');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
