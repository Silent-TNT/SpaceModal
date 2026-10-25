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
  function boundarySegments(model,floor,sid){
    const {nx,ny}=model,map=model.floorSpaces[floor],segments=[];
    const same=(x,y)=>x>=0&&y>=0&&x<nx&&y<ny&&map[y*nx+x]===sid;
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)if(same(x,y)){
      if(!same(x,y-1))segments.push([[x,y],[x+1,y]]);
      if(!same(x+1,y))segments.push([[x+1,y],[x+1,y+1]]);
      if(!same(x,y+1))segments.push([[x+1,y+1],[x,y+1]]);
      if(!same(x-1,y))segments.push([[x,y+1],[x,y]]);
    }
    return segments;
  }
  function plan(model,floor,showOrganization=false){
    const scale=480/Math.max(model.nx,model.ny),w=model.nx*scale,h=model.ny*scale;
    let markup=`<svg class="plan-svg" viewBox="-45 -45 ${w+90} ${h+100}" role="img" aria-label="${floor+1}层平面"><defs><pattern id="grid-${floor}" width="${scale}" height="${scale}" patternUnits="userSpaceOnUse"><path d="M ${scale} 0 L 0 0 0 ${scale}" fill="none" stroke="#fff" stroke-opacity=".17" stroke-width=".6"/></pattern></defs><rect width="${w}" height="${h}" fill="#eeeae2"/>`;
    for(const s of model.spaces){
      const pieces=rects(model,floor,s.id);if(!pieces.length)continue;
      const color=LABELS[s.label][1];
      for(const r of pieces)markup+=`<rect x="${r.x*scale}" y="${h-(r.y+r.h)*scale}" width="${r.w*scale}" height="${r.h*scale}" data-space-id="${s.id}" data-floor="${floor}" fill="${color}" stroke="none"><title>${escape(LABELS[s.label][0])} · ${escape(s.key)}</title></rect>`;
      markup+=`<path class="space-outline" d="${boundarySegments(model,floor,s.id).map(([a,b])=>`M ${a[0]*scale} ${h-a[1]*scale} L ${b[0]*scale} ${h-b[1]*scale}`).join(' ')}" fill="none" stroke="white" stroke-width=".6" pointer-events="none"/>`;
      const cells=[];model.floorSpaces[floor].forEach((id,i)=>{if(id===s.id)cells.push(i)});
      const cx=cells.reduce((a,i)=>a+i%model.nx+.5,0)/cells.length,cy=cells.reduce((a,i)=>a+Math.floor(i/model.nx)+.5,0)/cells.length;
      const anchor=cells.reduce((best,i)=>{const d=(i%model.nx+.5-cx)**2+(Math.floor(i/model.nx)+.5-cy)**2;return d<best.d?{i,d}:best},{i:cells[0],d:Infinity}).i;
      const ax=(anchor%model.nx+.5)*scale,ay=h-(Math.floor(anchor/model.nx)+.5)*scale;
      markup+=`<text x="${ax}" y="${ay-5}" data-space-id="${s.id}" data-floor="${floor}" text-anchor="middle" font-size="28" fill="#182836">${escape(s.key==='1:stair-landing'?'到达走道':LABELS[s.label][0])}<tspan x="${ax}" dy="28" font-size="22">${(cells.length*.09).toFixed(1)}㎡</tspan></text>`;
    }
    if(showOrganization&&model.organization){
      for(const a of model.organization.activities.filter(a=>a.floor===floor))markup+=`<rect class="activity-envelope" x="${a.x*scale}" y="${h-(a.y+a.h)*scale}" width="${a.w*scale}" height="${a.h*scale}" fill="#ffffff55" stroke="#28543c" stroke-width="1.5" stroke-dasharray="3 2"><title>受保护活动区 ${a.area.toFixed(1)}㎡；简化活动范围，不是真实家具</title></rect>`;
      for(const r of model.organization.routes.filter(r=>r.floor===floor))markup+=`<polyline class="circulation-route" points="${r.squares.map(p=>`${(p.x+p.w/2)*scale},${h-(p.y+p.h/2)*scale}`).join(' ')}" fill="none" stroke="#163e70" stroke-opacity=".6" stroke-width="2"><title>至 ${escape(r.target)} 的网格通路，${r.length.toFixed(1)}米；非真实门或人体模拟</title></polyline>`;
    }
    if(floor===0&&model.anchorValidation?.mode){const g=model.generation.geometry,x=(g.entryX+(g.entryW||g.stairW)/2)*scale,sx=(g.stairX+g.stairW/2)*scale,end=h-(g.stairY+g.stairH/2)*scale,entryY=h-(g.entryY||0)*scale;markup+=`<path d="M ${x} ${entryY+14} V ${entryY}" fill="none" stroke="#243b30" stroke-width="2"/><circle cx="${sx}" cy="${end}" r="4" fill="#243b30"/><text x="${x+7}" y="${entryY+17}" font-size="11">${g.entryY?'玄关':'入口'} ↑</text>`;}
    markup+=`<rect width="${w}" height="${h}" fill="url(#grid-${floor})" pointer-events="none"/><rect width="${w}" height="${h}" fill="none" stroke="#263a35" stroke-width="1.4"/><path d="M 0 -8 H ${w}" stroke="#888"/><text x="${w/2}" y="-16" text-anchor="middle" font-size="26">${(model.nx*.3).toFixed(1)} m</text><text x="-20" y="${h/2}" text-anchor="middle" font-size="26" transform="rotate(-90 -20 ${h/2})">${(model.ny*.3).toFixed(1)} m</text><text x="0" y="${h+30}" font-size="12" fill="#586760">${floor+1}F · 300 mm 网格</text></svg>`;
    return markup;
  }
  function topology(model){
    // Keep floor identity and use plan centroids as stable spatial anchors.
    const width=560,nodes=[],edges=[],floorHeights=[],publicLabels=new Set([0,1,2,6,7,10]);
    let offset=24;
    for(const floor of [1,0]){
      const map=model.floorSpaces[floor],present=model.spaces.filter(s=>map.includes(s.id));
      const height=Math.max(310,Math.ceil(present.length/4)*82+64);
      floorHeights.push({floor,offset,height});
      for(const space of present){
        let x=0,y=0,count=0;
        map.forEach((id,i)=>{if(id===space.id){x+=i%model.nx+.5;y+=Math.floor(i/model.nx)+.5;count++;}});
        const label=space.key==='1:stair-landing'?'到达走道':LABELS[space.label][0];
        const ax=64+x/count/model.nx*432,ay=offset+64+(1-y/count/model.ny)*(height-120);
        nodes.push({...space,floor,labelText:label,x:ax,y:ay,ax,ay,halfWidth:Math.max(38,label.length*10),backbone:publicLabels.has(space.label)});
      }
      const contacts=new Set(),access=new Set();
      const key=(a,b)=>[a,b].sort((a,b)=>a-b).join(',');
      for(let y=0;y<model.ny;y++)for(let x=0;x<model.nx;x++){
        const a=map[y*model.nx+x];if(a<0)continue;
        for(const [xx,yy] of [[x+1,y],[x,y+1]]){if(xx>=model.nx||yy>=model.ny)continue;const b=map[yy*model.nx+xx];if(b>=0&&a!==b)contacts.add(key(a,b));}
      }
      for(const e of model.connections||[])if(e.floor===floor&&e.a!==e.b)access.add(key(e.a,e.b));
      for(const pair of contacts){const [a,b]=pair.split(',').map(Number);edges.push({a:`${floor}:${a}`,b:`${floor}:${b}`,type:'adjacent',overlap:access.has(pair)});}
      for(const pair of access){const [a,b]=pair.split(',').map(Number);edges.push({a:`${floor}:${a}`,b:`${floor}:${b}`,type:'access'});}
      offset+=height+96;
    }
    const byKey=new Map(nodes.map(n=>[`${n.floor}:${n.id}`,n]));
    // Only actual overlapping instances of the same stair connect across floors.
    for(const space of model.spaces.filter(s=>s.label===7)){
      const lower=byKey.get(`0:${space.id}`),upper=byKey.get(`1:${space.id}`);
      if(!lower||!upper||!model.floorSpaces[0].some((id,i)=>id===space.id&&model.floorSpaces[1][i]===space.id))continue;
      const x=(lower.ax+upper.ax)/2;
      for(const n of [upper,lower]){
        const f=floorHeights.find(f=>f.floor===n.floor);
        n.x=n.ax=x;n.y=n.ay=n.floor===1?f.offset+f.height-34:f.offset+54;n.fixed=true;
      }
      edges.push({a:`1:${space.id}`,b:`0:${space.id}`,type:'vertical'});
    }
    // Static label-aware separation; positions stay anchored to the plan, with no animation.
    for(const f of floorHeights){
      const group=nodes.filter(n=>n.floor===f.floor);
      for(let pass=0;pass<100;pass++){
        for(const n of group)if(!n.fixed){n.x+=(n.ax-n.x)*.025;n.y+=(n.ay-n.y)*.025;}
        for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
          const a=group[i],b=group[j],dx=b.x-a.x,dy=b.y-a.y;
          const overlapX=a.halfWidth+b.halfWidth+14-Math.abs(dx),overlapY=70-Math.abs(dy);
          if(overlapX<=0||overlapY<=0||a.fixed&&b.fixed)continue;
          const share=a.fixed||b.fixed?1:.5;
          if(overlapX<overlapY){const move=(overlapX+.5)*Math.sign(dx||1)*share;if(!a.fixed)a.x-=move;if(!b.fixed)b.x+=move;}
          else{const move=(overlapY+.5)*Math.sign(dy||1)*share;if(!a.fixed)a.y-=move;if(!b.fixed)b.y+=move;}
        }
        for(const n of group)if(!n.fixed){n.x=Math.max(56+n.halfWidth,Math.min(width-32-n.halfWidth,n.x));n.y=Math.max(f.offset+66,Math.min(f.offset+f.height-48,n.y));}
      }
    }
    let out='<div class="view-head"><h2><span>03</span> 拓扑</h2><details class="topology-settings view-controls"><summary aria-label="拓扑显示设置" title="拓扑显示设置">显示</summary><div class="topology-options"><label><input type="checkbox" data-edge-toggle="adjacent" checked>几何贴邻</label><label><input type="checkbox" data-edge-toggle="access" checked>规划通行</label><label><input type="checkbox" data-edge-toggle="vertical" checked>跨层对应</label><p>○ 房间 · □ 交通 · ◇ 楼梯</p><p>节点位置参考平面，局部避让。粗实线：公共交通骨架；细实线：规划通行；点线：贴邻；紫色虚线：跨层。同一联系优先显示通行。规划连接不代表真实门或踏步。</p></div></details><button type="button" class="view-expand quiet" data-focus="topology" aria-label="放大两层拓扑" title="放大两层拓扑">↗</button></div>';
    out+=`<svg class="topology-svg" viewBox="0 0 ${width} ${offset-54}" role="img" aria-label="按平面相对位置排列的两层异构拓扑，突出公共交通骨架及楼梯跨层联系">`;
    for(const f of floorHeights)out+=`<text x="24" y="${f.offset+30}" font-size="18" fill="#879287">${f.floor+1}F</text>`;
    for(const e of edges){
      const a=byKey.get(e.a),b=byKey.get(e.b);if(!a||!b)continue;
      const backbone=e.type==='access'&&a.backbone&&b.backbone;
      const color={adjacent:'#aab3aa',access:backbone?'#476b59':'#7f9789',vertical:'#8a77a2'}[e.type];
      const tip={adjacent:'几何贴邻，不代表真实门',access:backbone?'公共空间之间的规划通行骨架，非真实门扇':'生成器规划通行连接，非真实门扇',vertical:'同一楼梯的上下层投影对应，非踏步验证'}[e.type];
      const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,inset=18;
      const x1=a.x+dx/length*inset,y1=a.y+dy/length*inset,x2=b.x-dx/length*inset,y2=b.y-dy/length*inset;
      const path=`M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}`;
      out+=`<path class="topology-edge" data-edge-type="${e.type}" data-a="${e.a}" data-b="${e.b}" ${e.overlap?'data-overlap-access="true"':''} ${backbone?'data-backbone="true"':''} d="${path}" fill="none" stroke="${color}" stroke-width="${e.type==='adjacent'?1:backbone?3.5:2}" stroke-linecap="round" ${e.type==='adjacent'?'stroke-dasharray="1 6"':e.type==='vertical'?'stroke-dasharray="6 7"':''}><title>${tip}</title></path>`;
    }
    for(const n of nodes){
      const type=n.label===7?'楼梯':n.label===0||n.label===6?'交通':'房间',radius=n.backbone?16:11;
      const attrs=`fill="${LABELS[n.label][1]}" stroke="#f7f6f2" stroke-width="3"`;
      const shape=type==='楼梯'?`<path d="M ${n.x} ${n.y-17} L ${n.x+17} ${n.y} L ${n.x} ${n.y+17} L ${n.x-17} ${n.y} Z" ${attrs}/>`:type==='交通'?`<rect x="${n.x-15}" y="${n.y-14}" width="30" height="28" rx="6" ${attrs}/>`:`<circle cx="${n.x}" cy="${n.y}" r="${radius}" ${attrs}/>`;
      out+=`<g class="topology-node" role="button" tabindex="0" aria-label="${n.floor+1}层 ${escape(n.key)} ${escape(n.labelText)}" data-space-id="${n.id}" data-floor="${n.floor}" data-x="${n.x.toFixed(2)}" data-y="${n.y.toFixed(2)}" data-backbone="${n.backbone}"><title>${escape(n.key)} · ${type}</title><rect class="topology-hit" x="${n.x-n.halfWidth}" y="${n.y-22}" width="${n.halfWidth*2}" height="62" fill="transparent"/>${shape}<text x="${n.x}" y="${n.y+36}" text-anchor="middle" font-size="20" stroke="#f7f6f2" stroke-width="5" paint-order="stroke" fill="#536459">${escape(n.labelText)}</text></g>`;
    }
    return out+'</svg>';
  }
  function geometry(model){
    const rooms=[];
    for(let f=0;f<2;f++)for(const s of model.spaces)for(const r of rects(model,f,s.id))rooms.push({id:`${f}_${s.id}_${r.x}_${r.y}`,functional_group_id:s.key,type:TYPES[s.label],floor:f+1,floors:[f+1],box_min:[r.x*300,r.y*300,f*3000],box_max:[(r.x+r.w)*300,(r.y+r.h)*300,(f+1)*3000]});
    return {schema_version:'geometry_v1',condition_inputs:{user_provided:{length_mm:model.nx*300,width_mm:model.ny*300}},rooms,planned_connections:model.connections,circulation_facade:model.traffic,functional_validation:model.functional,functional_relations:model.functionalRelations,review:{mode:'browser_generation_demo',project_accepted:null,demo_accepted:model.validation.accepted&&model.circulation.accepted&&model.programValidation.accepted&&model.daylight?.accepted!==false&&model.functional?.accepted!==false&&model.functionalRelations?.accepted!==false&&model.traffic?.accepted!==false,daylight_potential_accepted:model.daylight?.accepted??null,actual_daylight_verified:false},daylight:model.daylight,entry_limits:{revision:model.generation?.entryRevision,report:model.programValidation?.reports?.find(r=>r.key==='entry')},seed:model.seed};
  }
  function reviewBundle(result,selectedIndex=0){
    const models=[result.model,...(result.alternatives||[])];
    if(!Number.isInteger(selectedIndex)||selectedIndex<0||selectedIndex>=models.length)throw Error('请选择有效方案后导出');
    const candidates=models.map((model,index)=>{
      const shapeReports=[];
      for(let floor=0;floor<2;floor++)for(const space of model.spaces){
        const map=model.floorSpaces[floor],cells=[];
        for(let i=0;i<map.length;i++)if(map[i]===space.id)cells.push(i);
        if(!cells.length)continue;
        const remaining=new Set(cells),componentAreas=[];
        while(remaining.size){const first=remaining.values().next().value,queue=[first];remaining.delete(first);
          for(let head=0;head<queue.length;head++){
            const at=queue[head],x=at%model.nx,y=Math.floor(at/model.nx);
            for(const next of [x>0?at-1:-1,x+1<model.nx?at+1:-1,y>0?at-model.nx:-1,y+1<model.ny?at+model.nx:-1])if(remaining.delete(next))queue.push(next);
          }
          componentAreas.push(queue.length*.09);
        }
        const xs=cells.map(i=>i%model.nx),ys=cells.map(i=>Math.floor(i/model.nx));
        const boundingArea=(Math.max(...xs)-Math.min(...xs)+1)*(Math.max(...ys)-Math.min(...ys)+1)*.09;
        const validation=model.programValidation?.reports?.find(r=>r.key===space.key&&r.floor===floor);
        shapeReports.push({floor:floor+1,spaceId:space.id,key:space.key,label:LABELS[space.label][0],area:cells.length*.09,rectangleCount:rects(model,floor,space.id).length,componentCount:componentAreas.length,componentAreas,boundingBoxFill:cells.length*.09/boundingArea,shape:validation?.shape,shapeMetrics:validation?.shapeMetrics,minimumWidth:validation?.width,maxArea:validation?.maxArea});
      }
      const g=model.generation?.geometry;
      const staircase=g?{revision:model.generation.stairRevision,dimensionsMm:[g.stairW*300,g.stairH*300],area:g.stairW*g.stairH*.09,positionMm:[g.stairX*300,g.stairY*300],positionClass:g.stairPlacement,entryAnchorMm:[g.entryX*300,(g.entryY||0)*300],actualRelation:model.anchorValidation?.relation,evidence:g.stairEvidence}:undefined;
      const meal=model.mealGeometry?{...model.mealGeometry,evidence:g?.mealEvidence,plannedRoutes:model.kitchenDining,areaChanges:model.mealGeometry.reports.map(r=>({floor:r.floor+1,kitchenInitial:g?.mealEvidence?.initialKitchen?.area,kitchenFinal:r.kitchen.area,diningInitial:g?.mealEvidence?.initialDining?.area,diningFinal:r.dining.area})),integrityAdjustments:g?.integrityAdjustments}:undefined;
      return {index:index+1,name:`方案 ${String(index+1).padStart(2,'0')}`,selected:index===selectedIndex,ruleRevision:model.generation?.ruleRevision,shapeRevision:model.generation?.shapeRevision,staircase,meal,daylight:model.daylight,geometry:geometry(model),shapeReports,model:{...model,floorSpaces:model.floorSpaces.map(g=>Array.from(g)),floors:model.floors?.map(g=>Array.from(g))}};
    });
    return {schema_version:'spacemodal_review_v1',exported_at:new Date().toISOString(),selected_scheme:selectedIndex+1,candidate_count:candidates.length,units:{geometry:'mm',cell_mm:300,area:'m2',floor_numbering:'one-based; raw model arrays are zero-based'},notes:['rectangleCount 是显示与导出的矩形分块数；componentCount 才是不连通区域数。','包含全部展示候选及原始校验结果；通过现有检查不代表空间形状已经合理。','采光检查仅代表体块外墙与阳台相邻的潜力，不代表真实窗洞、日照或照度已验证。'],generation:{conditions:result.conditions,condition_sources:result.sources,search_summary:result.searchSummary,area_prior:result.areaPrior,meta:result.meta,elapsed_seconds:result.elapsedSeconds},candidates};
  }
  function volume(canvas,model){
    const THREE=root.THREE;
    let renderer;
    try{
      if(!THREE)throw Error('Three.js unavailable');
      renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
    }catch(error){
      canvas.hidden=true;
      const note=document.createElement('p');note.className='view-note';note.setAttribute('role','status');
      note.textContent='此设备暂时无法启用三维显示，请查看两层平面与拓扑，或在浏览器设置中启用图形加速。';canvas.after(note);
      return {draw(){},home(){},select(){},setFloors(){},dispose(){note.remove();canvas.hidden=false;}};
    }
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,3000);
    const target=new THREE.Vector3(model.nx/2,0,model.ny/2),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
    const meshes=[],pointers=new Map();
    let angle=-.65,tilt=.62,zoom=1,showFloors=2,selected=null,disposed=false;
    const shade=(hex,alpha)=>{const color=parseInt(hex.slice(1),16),rgb=[color>>16,(color>>8)&255,color&255];return '#'+rgb.map((v,i)=>Math.round(v*(1-alpha)+[20,35,30][i]*alpha).toString(16).padStart(2,'0')).join('');};
    for(let floor=0;floor<2;floor++)for(const space of model.spaces){
      const pieces=rects(model,floor,space.id);if(!pieces.length)continue;
      const color=LABELS[space.label][1],sideX=shade(color,.25),sideZ=shade(color,.17);
      const materials=[sideX,color,sideZ].map(color=>new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}));
      const positions=[],linePositions=[],geometry=new THREE.BufferGeometry(),bottom=floor*10,top=bottom+10;
      const quad=(a,b,c,d,material)=>{const start=positions.length/3;positions.push(...a,...b,...c,...a,...c,...d);geometry.addGroup(start,6,material);};
      for(const r of pieces)for(const z of [bottom,top])quad([r.x,z,r.y],[r.x+r.w,z,r.y],[r.x+r.w,z,r.y+r.h],[r.x,z,r.y+r.h],1);
      const boundary=boundarySegments(model,floor,space.id),vertices=new Map();
      for(const [a,b] of boundary){
        quad([a[0],bottom,a[1]],[b[0],bottom,b[1]],[b[0],top,b[1]],[a[0],top,a[1]],a[0]===b[0]?0:2);
        for(const z of [bottom,top])linePositions.push(a[0],z,a[1],b[0],z,b[1]);
        for(const p of [a,b]){const key=p.join(',');if(!vertices.has(key))vertices.set(key,[]);vertices.get(key).push([b[0]-a[0],b[1]-a[1]]);}
      }
      for(const [key,directions] of vertices)if(directions.length!==2||directions[0][0]*directions[1][1]!==directions[0][1]*directions[1][0]){const [x,y]=key.split(',').map(Number);linePositions.push(x,bottom,y,x,top,y);}
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
      const mesh=new THREE.Mesh(geometry,materials);mesh.userData={id:space.id,floor};
      const lines=new THREE.BufferGeometry();lines.setAttribute('position',new THREE.Float32BufferAttribute(linePositions,3));
      mesh.add(new THREE.LineSegments(lines,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.6,depthWrite:false})));
      scene.add(mesh);meshes.push(mesh);
    }
    function draw(){
      if(disposed)return;
      const box=canvas.getBoundingClientRect();if(!box.width||!box.height)return;
      renderer.setPixelRatio(Math.min(root.devicePixelRatio||1,2));renderer.setSize(box.width,box.height,false);
      const scale=Math.min(box.width/(model.nx+model.ny)*1.4,box.height/(.6*(model.nx+model.ny)+20)*1.2)*zoom,norm=Math.hypot(.85,tilt);
      camera.left=-box.width/2/scale;camera.right=box.width/2/scale;
      camera.top=box.height*.62/(scale*norm);camera.bottom=-box.height*.38/(scale*norm);
      camera.position.set(target.x+Math.sin(angle)*850,tilt*1000,target.z+Math.cos(angle)*850);
      camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld();
      for(const mesh of meshes){
        mesh.visible=mesh.userData.floor<showFloors;
        const active=selected&&selected.id===mesh.userData.id&&selected.floor===mesh.userData.floor;
        mesh.children[0].material.color.set(active?'#163e70':'#ffffff');mesh.children[0].material.opacity=active?1:.6;
      }
      renderer.render(scene,camera);
    }
    const clampZoom=value=>Math.max(.5,Math.min(2,value));
    const distance=()=>{const [a,b]=pointers.values();return Math.hypot(a.x-b.x,a.y-b.y);};
    const pointerDown=e=>{
      if(e.button!==0)return;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false});
      if(pointers.size>1)for(const p of pointers.values())p.moved=true;
      canvas.setPointerCapture(e.pointerId);
    };
    const pointerMove=e=>{
      const p=pointers.get(e.pointerId);if(!p)return;
      const before=pointers.size===2?distance():0,dx=e.clientX-p.x,dy=e.clientY-p.y;
      p.x=e.clientX;p.y=e.clientY;p.moved=p.moved||Math.hypot(p.x-p.startX,p.y-p.startY)>5;
      if(pointers.size===2){if(before>0)zoom=clampZoom(zoom*distance()/before);}
      else if(pointers.size===1){angle+=dx*.009;tilt=Math.max(.18,Math.min(.95,tilt+dy*.003));}
      draw();
    };
    const pointerUp=e=>{
      const p=pointers.get(e.pointerId);
      if(p&&!p.moved&&pointers.size===1&&e.type==='pointerup'){
        const box=canvas.getBoundingClientRect();pointer.set((e.clientX-box.left)/box.width*2-1,1-(e.clientY-box.top)/box.height*2);
        raycaster.setFromCamera(pointer,camera);
        const hit=raycaster.intersectObjects(meshes.filter(mesh=>mesh.visible),false)[0];
        if(hit)canvas.dispatchEvent(new CustomEvent('space-select',{bubbles:true,detail:{...hit.object.userData}}));
      }
      pointers.delete(e.pointerId);
      if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    };
    const home=()=>{angle=-.65;tilt=.62;zoom=1;showFloors=2;draw();};
    const keyDown=e=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(e.key))return;
      e.preventDefault();if(e.key==='Home')return home();
      if(e.key==='ArrowLeft')angle-=.12;if(e.key==='ArrowRight')angle+=.12;
      if(e.key==='ArrowUp')tilt=Math.min(.95,tilt+.05);if(e.key==='ArrowDown')tilt=Math.max(.18,tilt-.05);
      if(e.key==='+'||e.key==='=')zoom=clampZoom(zoom+.1);if(e.key==='-')zoom=clampZoom(zoom-.1);draw();
    };
    const wheel=e=>{e.preventDefault();zoom=clampZoom(zoom-e.deltaY*.001);draw();};
    const contextLost=e=>{e.preventDefault();canvas.setAttribute('aria-label','三维图形连接中断，正在等待恢复');};
    const contextRestored=()=>{canvas.setAttribute('aria-label','完整两层三维功能体块，可拖动旋转、滚轮或双指缩放');draw();};
    const events={keydown:keyDown,pointerdown:pointerDown,pointermove:pointerMove,pointerup:pointerUp,pointercancel:pointerUp,lostpointercapture:pointerUp,wheel,webglcontextlost:contextLost,webglcontextrestored:contextRestored};
    for(const [name,handler] of Object.entries(events))canvas.addEventListener(name,handler,{passive:false});
    const observer=new ResizeObserver(draw);observer.observe(canvas);draw();
    return {draw,home,select:space=>{selected=space;draw();},setFloors:n=>{showFloors=n;draw();},dispose:()=>{
      disposed=true;observer.disconnect();pointers.clear();
      for(const [name,handler] of Object.entries(events))canvas.removeEventListener(name,handler);
      for(const mesh of meshes){mesh.geometry.dispose();mesh.material.forEach(material=>material.dispose());mesh.children[0].geometry.dispose();mesh.children[0].material.dispose();}
      scene.clear();renderer.dispose();
    }};
  }
  const api={LABELS,TYPES,escape,rects,boundarySegments,plan,topology,geometry,reviewBundle,volume};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SpatialRender=api;
})(globalThis);
