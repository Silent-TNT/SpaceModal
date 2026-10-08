(function(root){
  'use strict';
  const LABELS=[['玄关','#f6b55c'],['客厅','#63aee6'],['餐厅','#ffd36a'],['厨房','#e88172'],['卧室','#aa9af3'],['卫生间','#69cabb'],['走道','#8294aa'],['楼梯','#e3a5c2'],['家政','#c1d780'],['阳台','#66d2dc'],['多功能室','#bb97d8']];
  const TYPES=['entryway','living_room','dining_room','kitchen','bedroom','bathroom','corridor','stairs','utility','balcony','multi_purpose'];
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function rects(model,floor,sid){
    const {nx,ny}=model,map=model.floorSpaces[floor],used=new Uint8Array(nx*ny),result=[];
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      if(used[y*nx+x]||map[y*nx+x]!==sid)continue;
      let w=1;while(x+w<nx&&!used[y*nx+x+w]&&map[y*nx+x+w]===sid)w++;
      let h=1;outer:while(y+h<ny){for(let i=0;i<w;i++)if(used[(y+h)*nx+x+i]||map[(y+h)*nx+x+i]!==sid)break outer;h++;}
      for(let j=0;j<h;j++)for(let i=0;i<w;i++)used[(y+j)*nx+x+i]=1;
      result.push({x,y,w,h});
    }return result;
  }
  function plan(model,floor){
    const scale=480/Math.max(model.nx,model.ny),w=model.nx*scale,h=model.ny*scale;
    let markup=`<svg class="plan-svg" viewBox="-45 -45 ${w+90} ${h+100}" role="img" aria-label="${floor+1}层平面"><defs><pattern id="grid-${floor}" width="${scale}" height="${scale}" patternUnits="userSpaceOnUse"><path d="M ${scale} 0 L 0 0 0 ${scale}" fill="none" stroke="#fff" stroke-opacity=".17" stroke-width=".6"/></pattern></defs><rect width="${w}" height="${h}" fill="#eeeae2"/>`;
    for(const s of model.spaces){
      const pieces=rects(model,floor,s.id);if(!pieces.length)continue;
      const color=LABELS[s.label][1];
      for(const r of pieces)markup+=`<rect x="${r.x*scale}" y="${h-(r.y+r.h)*scale}" width="${r.w*scale}" height="${r.h*scale}" fill="${color}" stroke="white" stroke-width=".6"><title>${escape(LABELS[s.label][0])} · ${escape(s.key)}</title></rect>`;
      const cells=[];model.floorSpaces[floor].forEach((id,i)=>{if(id===s.id)cells.push(i)});
      const cx=cells.reduce((a,i)=>a+i%model.nx+.5,0)/cells.length,cy=cells.reduce((a,i)=>a+Math.floor(i/model.nx)+.5,0)/cells.length;
      const anchor=cells.reduce((best,i)=>{const d=(i%model.nx+.5-cx)**2+(Math.floor(i/model.nx)+.5-cy)**2;return d<best.d?{i,d}:best},{i:cells[0],d:Infinity}).i;
      const ax=(anchor%model.nx+.5)*scale,ay=h-(Math.floor(anchor/model.nx)+.5)*scale;
      markup+=`<text x="${ax}" y="${ay-3}" text-anchor="middle" font-size="12" fill="#182836">${escape(LABELS[s.label][0])}<tspan x="${ax}" dy="15" font-size="10">${(cells.length*.09).toFixed(1)}㎡</tspan></text>`;
    }
    markup+=`<rect width="${w}" height="${h}" fill="url(#grid-${floor})" pointer-events="none"/><rect width="${w}" height="${h}" fill="none" stroke="#263a35" stroke-width="1.4"/><path d="M 0 -20 H ${w}" stroke="#888"/><text x="${w/2}" y="-27" text-anchor="middle" font-size="12">${(model.nx*.3).toFixed(1)} m</text><text x="-20" y="${h/2}" text-anchor="middle" font-size="12" transform="rotate(-90 -20 ${h/2})">${(model.ny*.3).toFixed(1)} m</text><text x="0" y="${h+30}" font-size="12" fill="#586760">${floor+1}F · 300 mm 网格</text></svg>`;
    return markup;
  }
  function topology(model){
    const nodes=model.spaces.map((s,i)=>({...s,x:180+Math.cos(i/model.spaces.length*Math.PI*2)*130,y:190+Math.sin(i/model.spaces.length*Math.PI*2)*135}));
    const byId=new Map(nodes.map(n=>[n.id,n]));const edges=new Set();
    for(let f=0;f<2;f++)for(let y=0;y<model.ny;y++)for(let x=0;x<model.nx;x++){
      const a=model.floorSpaces[f][y*model.nx+x];
      for(const [xx,yy] of [[x+1,y],[x,y+1]]){if(xx>=model.nx||yy>=model.ny)continue;const b=model.floorSpaces[f][yy*model.nx+xx];if(a>=0&&b>=0&&a!==b)edges.add([a,b].sort((a,b)=>a-b).join(','));}
    }
    let out='<svg class="topology-svg" viewBox="0 0 360 430" role="img" aria-label="功能体块几何贴邻拓扑"><text x="180" y="18" text-anchor="middle" font-size="13">两层功能体块 · 几何贴邻</text>';
    for(const edge of edges){const [a,b]=edge.split(',').map(id=>byId.get(Number(id)));out+=`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#8a9a91" stroke-opacity=".4"/>`;}
    for(const n of nodes)out+=`<circle cx="${n.x}" cy="${n.y}" r="19" fill="${LABELS[n.label][1]}" stroke="white"/><text x="${n.x}" y="${n.y+4}" text-anchor="middle" font-size="9">${escape(LABELS[n.label][0])}</text><text x="${n.x}" y="${n.y+33}" text-anchor="middle" font-size="8" fill="#68766c">${escape(n.key)}</text>`;
    return out+'<text x="180" y="390" text-anchor="middle" font-size="10">线表示体块贴邻，不代表真实门或通行路径。</text></svg>';
  }
  function geometry(model){
    const rooms=[];
    for(let f=0;f<2;f++)for(const s of model.spaces)for(const r of rects(model,f,s.id))rooms.push({id:`${f}_${s.id}_${r.x}_${r.y}`,functional_group_id:s.key,type:TYPES[s.label],floor:f+1,floors:[f+1],box_min:[r.x*300,r.y*300,f*3000],box_max:[(r.x+r.w)*300,(r.y+r.h)*300,(f+1)*3000]});
    return {schema_version:'geometry_v1',condition_inputs:{user_provided:{length_mm:model.nx*300,width_mm:model.ny*300}},rooms,review:{mode:'browser_generation_demo',project_accepted:null,demo_accepted:model.validation.accepted&&model.circulation.accepted&&model.programValidation.accepted},seed:model.seed};
  }
  function volume(canvas,model){
    let angle=-.65,tilt=.62,zoom=1,showFloors=2,drag=null;
    const ctx=canvas.getContext('2d');
    const cuboids=[];
    for(let f=0;f<2;f++)for(const s of model.spaces)for(const r of rects(model,f,s.id))cuboids.push({...r,z:f*10,d:10,label:s.label});
    function draw(){
      const box=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);
      if(!box.width||!box.height)return;
      canvas.width=box.width*ratio;canvas.height=box.height*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,box.width,box.height);
      const scale=Math.min(box.width/(model.nx+model.ny+12),box.height/(model.nx+model.ny+20))*zoom;
      const project=(x,y,z)=>{x-=model.nx/2;y-=model.ny/2;const rx=x*Math.cos(angle)-y*Math.sin(angle),ry=x*Math.sin(angle)+y*Math.cos(angle);return [box.width/2+rx*scale,box.height*.62+ry*scale*tilt-z*scale*.85,ry+z*.01];};
      const faces=[];
      const face=(points,color,shade)=>faces.push({p:points.map(p=>project(...p)),color,shade});
      for(const b of cuboids){if(b.z>=showFloors*10)continue;const {x,y,w,h,z,d}=b,c=LABELS[b.label][1];
        face([[x,y,z+d],[x+w,y,z+d],[x+w,y+h,z+d],[x,y+h,z+d]],c,0);
        face([[x,y,z],[x+w,y,z],[x+w,y,z+d],[x,y,z+d]],c,.17);
        face([[x+w,y,z],[x+w,y+h,z],[x+w,y+h,z+d],[x+w,y,z+d]],c,.25);
        face([[x+w,y+h,z],[x,y+h,z],[x,y+h,z+d],[x+w,y+h,z+d]],c,.17);
        face([[x,y+h,z],[x,y,z],[x,y,z+d],[x,y+h,z+d]],c,.25);
      }
      faces.sort((a,b)=>a.p.reduce((s,p)=>s+p[2],0)/4-b.p.reduce((s,p)=>s+p[2],0)/4);
      for(const f of faces){ctx.beginPath();f.p.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=f.color;ctx.fill();if(f.shade){ctx.fillStyle=`rgba(20,35,30,${f.shade})`;ctx.fill();}ctx.strokeStyle='rgba(255,255,255,.6)';ctx.lineWidth=.5;ctx.stroke();}
      ctx.fillStyle='#65746c';ctx.font='12px sans-serif';ctx.fillText('每层 3 m · 拖动旋转 · 滚轮缩放',18,box.height-18);
    }
    const pointerDown=e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
    const pointerMove=e=>{if(!drag)return;angle+=(e.clientX-drag.x)*.009;tilt=Math.max(.18,Math.min(.95,tilt+(e.clientY-drag.y)*.003));drag={x:e.clientX,y:e.clientY};draw();};
    const pointerUp=()=>drag=null;
    const wheel=e=>{e.preventDefault();zoom=Math.max(.5,Math.min(2,zoom-e.deltaY*.001));draw();};
    canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);canvas.addEventListener('wheel',wheel,{passive:false});
    const observer=new ResizeObserver(draw);observer.observe(canvas);draw();
    return {draw,setFloors:n=>{showFloors=n;draw();},dispose:()=>{observer.disconnect();canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',pointerUp);canvas.removeEventListener('wheel',wheel);}};
  }
  const api={LABELS,TYPES,escape,rects,plan,topology,geometry,volume};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SpatialRender=api;
})(globalThis);
