const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAN_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..');
const largeEnvelope=process.argv.includes('--large-envelope');
const compactEnvelope=process.argv.includes('--compact-envelope');
const outputDirectory=path.join(root,compactEnvelope?'.qa/compact-envelope':largeEnvelope?'.qa/large-envelope':'.qa/circulation');
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const target=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
 if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':target.endsWith('.html')?'text/html':target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':'application/json'});fs.createReadStream(target).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAN_CHROMIUM_PATH||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/generator-studio/`);
  await page.evaluate(budget=>{GeneratorState.mode='local';GeneratorState.conditions.budget=budget;},largeEnvelope||compactEnvelope?80:2400);
  await page.locator('#prompt').fill((compactEnvelope?'10.8×10.2':largeEnvelope?'15×12':'13.5×11.4')+'米，三间卧室，一层一间卧室，二层增加客厅和家政用房，一层不要阳台，二层两个阳台');await page.locator('#send').click();
  await page.waitForSelector('.condition-card');
  for(const [key,value] of Object.entries({bedrooms:3,bedrooms0:1,living1:1,utility1:1,balconies0:0,balconies1:2}))assert.equal(await page.locator(`.condition-card [name="${key}"]`).last().inputValue(),String(value));
  assert.equal(await page.locator('.condition-card .warning').count(),0);
  assert.equal(await page.locator('.condition-card [name="utilityRole0"]').last().inputValue(),'service');assert.equal(await page.locator('.condition-card [name="utilityRole1"]').last().inputValue(),'laundry');
  await page.setViewportSize({width:390,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:1000});
  if(process.argv.includes('--ui-only')){assert.deepEqual(errors,[]);console.log('PASS floor controls, natural language fields and mobile layout');return;}
  if(process.argv.includes('--restore-only')){
   const saved=JSON.parse(fs.readFileSync(path.join(outputDirectory,'browser-result.json'),'utf8'));
   await page.evaluate(saved=>localStorage.setItem('spacemodal-generator-last',JSON.stringify(saved)),saved);await page.reload();
  }else{
   await page.locator('.generate-button').last().click();
   await page.waitForFunction(()=>GeneratorState.result||!GeneratorState.busy,{},{timeout:600000});
   if(largeEnvelope||compactEnvelope)await page.waitForFunction(()=>!GeneratorState.busy,{},{timeout:600000});
  }
  assert.ok(await page.evaluate(()=>GeneratorState.result),'actual Worker must produce a valid layout');
  // Preserve the first admitted preview so all following UI/export checks use it.
  if(await page.evaluate(()=>GeneratorState.busy))await page.locator('#cancel').click();
  const result=await page.evaluate(()=>GeneratorState.result),m=result.model;
  if(largeEnvelope){assert.equal(m.nx,50);assert.equal(m.ny,40);assert.ok(m.generation.geometry.jointDimensionPlanning);assert.ok(m.traffic.accepted);}
  if(compactEnvelope){assert.equal(m.nx,36);assert.equal(m.ny,34);assert.equal(m.generation.geometry.strategy,'compact-public-spine');assert.ok(m.traffic.accepted);}
  assert.ok(m.validation.accepted&&m.programValidation.accepted&&m.organization.accepted&&m.daylight.accepted&&m.mealGeometry.accepted&&m.kitchenDining.accepted);
  assert.equal(m.functional.revision,'functional-joint-v1');assert.ok(m.functional.accepted&&m.functionalRelations.accepted);assert.ok(m.functionalRelations.reports.filter(r=>['service','laundry'].includes(r.role)).every(r=>!r.viaEntry));assert.ok(m.generation.geometry.functionalStages.length>=2);
  const program=result.areaPrior.program;
  assert.equal(program.filter(r=>r.label===4&&r.floor===0).length,1);assert.equal(program.filter(r=>r.label===4&&r.floor===1).length,2);
  assert.ok(program.some(r=>r.key==='living-1'&&r.floor===1)&&program.some(r=>r.key==='utility-1'&&r.floor===1));
  assert.ok(m.organization.activities.some(r=>r.key==='living-1'&&r.floor===1));
  assert.equal(await page.locator('#plans .plan-panel').count(),2);
  fs.mkdirSync(outputDirectory,{recursive:true});fs.writeFileSync(path.join(outputDirectory,'browser-result.json'),JSON.stringify(result));
  await page.locator('.tools-menu summary').click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download-json').click()]);
  const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.ok(exported.circulation_facade?.accepted);assert.ok(exported.generation.anchor_geometry.actualAreaCoordination.accepted);assert.ok(exported.functional_validation.accepted&&exported.functional_relations.accepted);assert.equal(exported.generation.conditions.utilityRole0,'service');assert.equal(exported.generation.conditions.utilityRole1,'laundry');
  assert.deepEqual(exported.planned_connections,m.connections);
  assert.equal(exported.generation.conditions.bedrooms0,1);assert.equal(exported.generation.conditions.living1,1);assert.equal(exported.generation.conditions.utility1,1);
  assert.ok(exported.rooms.some(r=>r.type==='bedroom'&&r.floor===1)&&exported.rooms.some(r=>r.type==='living_room'&&r.floor===2)&&exported.rooms.some(r=>r.type==='utility'&&r.floor===2));
  fs.writeFileSync(path.join(outputDirectory,'browser-geometry.json'),JSON.stringify(exported));
  assert.ok(exported.circulation_facade.reports.every(r=>r.connectionHosts.every(h=>h.hosts.length>=2)));
  await page.locator('#area-info-open').click();assert.ok((await page.locator('#area-info-note').innerText()).includes('实际楼梯及交通占地重新协调'));assert.ok(!(await page.locator('#area-info-table').innerText()).includes('NaN'));await page.locator('#area-info-close').click();
  await page.locator('.tools-menu summary').click();await page.reload();assert.equal(await page.evaluate(()=>GeneratorState.conditions.bedrooms0),1);
  await page.screenshot({path:path.join(outputDirectory,'browser-workspace.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log(process.argv.includes('--restore-only')?'PASS saved Worker result restored in current browser, complete portal export, reload and mobile UI':'PASS actual Worker functional rules, role controls, stages, portal relations, geometry export, reload and mobile UI');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
