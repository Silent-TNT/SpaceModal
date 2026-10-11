const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAN_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),render=require('../generator-studio/render.js');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'.qa/drawing-result.json'),'utf8'));
const dense={nx:16,ny:16,spaces:Array.from({length:16},(_,id)=>({id,key:'space-'+id,label:id===0?7:[4,5,6,10][id%4]})),connections:[]};
dense.floorSpaces=[0,1].map(()=>Array.from({length:256},(_,i)=>Math.floor(i/16/4)*4+Math.floor(i%16/4)));
for(const floor of [0,1])for(let i=0;i<15;i++)dense.connections.push({floor,a:i,b:i+1});
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+name+(name.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAN_CHROMIUM_PATH||undefined});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(value=>localStorage.setItem('spacemodal-generator-last',JSON.stringify(value)),fixture);
    await page.goto(`http://127.0.0.1:${server.address().port}/generator-studio/?parser=local`);
    await page.waitForFunction(()=>globalThis.GeneratorState?.volume);
    // Check real and deliberately dense floor graphs, without running a new search.
    for(const model of [fixture.model,dense]){
      const report=await page.evaluate(html=>{
        const host=document.createElement('div');host.style.cssText='position:absolute;left:-3000px;width:560px';host.innerHTML=html;document.body.append(host);
        const svg=host.querySelector('svg'),nodes=[...host.querySelectorAll('.topology-node')];
        const labels=nodes.map(n=>({key:n.dataset.floor+':'+n.dataset.spaceId,box:n.querySelector('text').getBBox()}));
        const overlaps=[];
        for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
          const a=labels[i].box,b=labels[j].box;
          if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)overlaps.push([labels[i].key,labels[j].key]);
        }
        const result={overlaps,nodes:nodes.map(n=>({key:n.dataset.floor+':'+n.dataset.spaceId,x:Number(n.dataset.x),y:Number(n.dataset.y)})),edges:[...host.querySelectorAll('.topology-edge')].map(e=>({a:e.dataset.a,b:e.dataset.b,type:e.dataset.edgeType,visible:getComputedStyle(e).display!=='none'}))};
        host.remove();return result;
      },render.topology(model));
      assert.deepEqual(report.overlaps,[],'labels remain separated');
      assert.equal(report.nodes.length,model.spaces.reduce((sum,s)=>sum+model.floorSpaces.filter(map=>map.includes(s.id)).length,0));
      const byKey=new Map(report.nodes.map(n=>[n.key,n]));
      for(const edge of report.edges){
        assert.ok(byKey.has(edge.a)&&byKey.has(edge.b));
        if(edge.type==='vertical'){assert.equal(byKey.get(edge.a).x,byKey.get(edge.b).x);assert.ok(byKey.get(edge.a).y<byKey.get(edge.b).y);}
        if(edge.type==='access')assert.ok(model.connections.some(e=>`${e.floor}:${e.a}`===edge.a&&`${e.floor}:${e.b}`===edge.b||`${e.floor}:${e.b}`===edge.a&&`${e.floor}:${e.a}`===edge.b));
        if(edge.type==='adjacent'&&edge.visible)assert.ok(!report.edges.some(e=>e.type==='access'&&e.a===edge.a&&e.b===edge.b),'no double-drawn connection');
      }
      assert.equal(render.topology(model),render.topology(model),'deterministic layout');
    }
    console.log('PASS real/dense graph labels, floor identity, aligned stairs, true access edges and stable layout');
    await page.locator('.topology-settings summary').click();
    const overlaps=page.locator('[data-overlap-access]');assert.ok(await overlaps.count());
    assert.equal(await overlaps.evaluateAll(es=>es.filter(e=>getComputedStyle(e).display!=='none').length),0);
    await page.locator('[data-edge-toggle="access"]').uncheck();
    assert.ok(await overlaps.evaluateAll(es=>es.every(e=>getComputedStyle(e).display!=='none')));
    await page.locator('[data-edge-toggle="adjacent"]').uncheck();
    assert.equal(await overlaps.evaluateAll(es=>es.filter(e=>getComputedStyle(e).display!=='none').length),0);
    await page.locator('[data-edge-toggle="access"]').check();await page.locator('[data-edge-toggle="adjacent"]').check();
    await page.locator('.topology-settings summary').click();
    const stair=page.locator('.topology-node').filter({has:page.locator('title', {hasText:'楼梯'})}).first();
    await stair.focus();await page.keyboard.press('Enter');
    assert.ok(await page.locator('.topology-node.node-related').count()>1);
    assert.ok(await page.locator('.topology-edge[data-edge-type="vertical"].edge-selected').count());
    assert.ok(await page.locator('#plans .space-selected').count());
    for(const width of [1366,768,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    assert.deepEqual(errors,[]);
    console.log('PASS access/adjacency fallback filters, keyboard selection, cross-floor neighborhood and responsive view');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
