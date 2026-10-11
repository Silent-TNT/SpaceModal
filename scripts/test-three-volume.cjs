const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAN_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'.qa/drawing-result.json'),'utf8'));
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
    const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(value=>localStorage.setItem('spacemodal-generator-last',JSON.stringify(value)),fixture);
    const url=`http://127.0.0.1:${server.address().port}/generator-studio/?parser=local`;
    await page.goto(url);await page.waitForFunction(()=>globalThis.GeneratorState?.volume);
    await page.evaluate(()=>{
      const Renderer=THREE.WebGLRenderer;
      globalThis.THREE={...THREE,WebGLRenderer:class extends Renderer{
        constructor(options){super(options);const render=this.render;this.render=(scene,camera)=>{globalThis.frame={renderer:this,scene,camera};return render.call(this,scene,camera);};}
      }};
      GeneratorState.volume.dispose();GeneratorState.volume=SpatialRender.volume(document.getElementById('volume-canvas'),GeneratorState.result.model);
    });
    await page.locator('[data-view="volume"]').click();
    assert.equal(await page.evaluate(()=>THREE.REVISION),'172');
    // Independently raycast each sampled pixel: the rendered color must belong to
    // the closest face, including angles where centroid sorting lost surfaces.
    for(const turns of [0,26,13,13,13,13]){
      await page.locator('#volume-canvas').focus();
      for(let i=0;i<turns;i++)await page.keyboard.press('ArrowRight');
      const report=await page.evaluate(()=>{
        const canvas=document.getElementById('volume-canvas'),copy=document.createElement('canvas');
        copy.width=canvas.width;copy.height=canvas.height;const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);
        const pixels=ctx.getImageData(0,0,copy.width,copy.height).data,ray=new THREE.Raycaster();
        const meshes=frame.scene.children.filter(m=>m.visible),point=new THREE.Vector2();
        const hit=(x,y)=>{point.set(x/copy.width*2-1,1-y/copy.height*2);ray.setFromCamera(point,frame.camera);return ray.intersectObjects(meshes,false)[0];};
        let checked=0,bad=0,sample=null;
        for(let y=15;y<copy.height;y+=13)for(let x=15;x<copy.width;x+=13){
          const h=hit(x+.5,y+.5);if(!h)continue;
          if(![[3,0],[-3,0],[0,3],[0,-3]].every(([dx,dy])=>{const n=hit(x+.5+dx,y+.5+dy);return n&&n.object===h.object&&n.face.materialIndex===h.face.materialIndex;}))continue;
          const hex=h.object.material[h.face.materialIndex].color.getHex(THREE.SRGBColorSpace),expected=[hex>>16,(hex>>8)&255,hex&255],offset=(y*copy.width+x)*4;
          checked++;if(expected.some((v,i)=>Math.abs(v-pixels[offset+i])>8)||pixels[offset+3]<250)bad++;
          if(!sample)sample={x:x/copy.width,y:y/copy.height,...h.object.userData};
        }
        return {checked,bad,sample};
      });
      assert.ok(report.checked>100,JSON.stringify(report));assert.equal(report.bad,0,'closest surface colors at rotated view');
      const box=await page.locator('#volume-canvas').boundingBox();
      await page.mouse.click(box.x+box.width*report.sample.x,box.y+box.height*report.sample.y);
      assert.deepEqual(await page.evaluate(()=>GeneratorState.selected),{id:report.sample.id,floor:report.sample.floor});
      assert.ok(await page.locator('#plans .space-selected').count());
    }
    console.log('PASS depth-buffer surfaces at six angles and nearest-space selection linked to plans');
    await page.locator('#volume-home').click();
    await page.locator('#visible-floors').selectOption('1');
    assert.ok(await page.evaluate(()=>frame.scene.children.filter(m=>m.visible).every(m=>m.userData.floor===0)));
    await page.locator('#volume-home').click();
    assert.ok(await page.evaluate(()=>frame.scene.children.some(m=>m.visible&&m.userData.floor===1)));
    const cdp=await page.context().newCDPSession(page),box=await page.locator('#volume-canvas').boundingBox();
    const x=box.x+box.width/2,y=box.y+box.height/2;
    const before=await page.evaluate(()=>frame.camera.right);
    const touch=(id,x,y)=>({id,x,y,radiusX:2,radiusY:2,force:1});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(1,x-40,y),touch(2,x+40,y)]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(1,x-80,y),touch(2,x+80,y)]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.ok(await page.evaluate(value=>frame.camera.right<value*.7,before),'two-finger pinch zooms');
    const position=await page.evaluate(()=>frame.camera.position.toArray());
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(1,x,y)]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(1,x+60,y+10)]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.notDeepEqual(await page.evaluate(()=>frame.camera.position.toArray()),position);
    await page.locator('#volume-home').click();
    assert.equal(await page.evaluate(()=>frame.camera.right),before);
    await page.locator('.tools-menu summary').click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download-showcase').click()]);
    const saved=path.join(root,'.qa/three-offline-showcase.html');await download.saveAs(saved);
    assert.ok(fs.readFileSync(saved,'utf8').includes('Permission is hereby granted, free of charge'));
    const offline=await browser.newPage(),external=[];
    offline.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await offline.route(/^https?:/,route=>route.abort());
    await offline.goto('file:///'+saved.replace(/\\/g,'/'));
    assert.ok(await offline.locator('#volume').evaluate(canvas=>{
      const gl=canvas.getContext('webgl2');if(!gl||THREE.REVISION!=='172')return false;
      const pixels=new Uint8Array(canvas.width*canvas.height*4);
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      return pixels.some((value,i)=>i%4===3&&value>0);
    }));
    assert.deepEqual(external,[]);await offline.close();
    console.log('PASS exported Three.js actually renders offline with no HTTP requests');
    const memory=await page.evaluate(()=>{const renderer=frame.renderer;GeneratorState.volume.dispose();return renderer.info.memory;});
    assert.deepEqual(memory,{geometries:0,textures:0});
    console.log('PASS floor visibility, real touch rotation/pinch/reset and GPU resource disposal');
    const fallback=await browser.newPage();
    await fallback.addInitScript(value=>{
      localStorage.setItem('spacemodal-generator-last',JSON.stringify(value));
      const get=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:get.call(this,type,...args);};
    },fixture);
    await fallback.goto(url);await fallback.waitForSelector('#plans svg');
    assert.ok(await fallback.getByText('此设备暂时无法启用三维显示', {exact:false}).isVisible());
    assert.equal(await fallback.locator('#plans svg').count(),2);
    assert.ok(await fallback.locator('#topology .topology-edge').count());
    assert.deepEqual(errors,[]);
    console.log('PASS unavailable WebGL leaves plans and topology usable');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
