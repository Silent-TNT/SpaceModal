(function(root){
 'use strict';
 const rng=seed=>()=>{seed=(seed+0x6D2B79F5)>>>0;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
 function neighbors(i,nx,ny){const x=i%nx,y=Math.floor(i/nx);return [x?i-1:-1,x<nx-1?i+1:-1,y?i-nx:-1,y<ny-1?i+nx:-1].filter(i=>i>=0);}
 function contacts(m){const edges=new Set();for(let f=0;f<2;f++)m.floorSpaces[f].forEach((a,i)=>{if(a<0)return;for(const j of neighbors(i,m.nx,m.ny)){const b=m.floorSpaces[f][j];if(b>=0&&a!==b)edges.add([m.spaces[a].key,m.spaces[b].key].sort().join('|'));}});return edges;}
 function evaluate(m,plan){
  const checks=[],add=(name,passed)=>checks.push({name,passed});
  const areas={};let reserve=0;
  for(const s of m.spaces){for(let f=0;f<2;f++){
   const cells=m.floorSpaces[f].map((v,i)=>v===s.id?i:-1).filter(i=>i>=0);if(!cells.length){if(s.label===7||s.floor===f)add(s.key+' 分配完整',false);continue;}
   const seen=new Set([cells[0]]),queue=[cells[0]];for(let h=0;h<queue.length;h++)for(const j of neighbors(queue[h],m.nx,m.ny))if(!seen.has(j)&&m.floorSpaces[f][j]===s.id){seen.add(j);queue.push(j);}
   add(s.key+' '+(f+1)+'F 面连通',seen.size===cells.length);areas[s.key+':'+f]=cells.length*.09;
   add(s.key+' '+(f+1)+'F 最低面积',cells.length*.09+1e-8>=s.minArea);
  }}
  add('楼梯上下层投影一致',m.floorSpaces[0].every((v,i)=>(v===0)===(m.floorSpaces[1][i]===0)));
  const actual=contacts(m),missing=plan.edges.filter(e=>e.kind==='required_contact'&&!actual.has([e.a,e.b].sort().join('|')));
  add('目标硬关系实现',!missing.length);
  for(let f=0;f<2;f++)reserve+=m.floorSpaces[f].filter(v=>v<0).length;
  const deviations=plan.rooms.filter(r=>r.type!=='stairs').reduce((sum,r)=>sum+Math.abs((areas[r.key+':'+(r.floor-1)]||0)-r.area)/r.area,0);
  const softMissing=plan.edges.filter(e=>e.kind==='preferred_contact'&&!actual.has([e.a,e.b].sort().join('|'))).length;
  return {accepted:checks.every(c=>c.passed),checks,missing,areas,reserveFraction:reserve/(m.nx*m.ny*2),score:deviations*10+softMissing*8};
 }
 function generate({length,width,seed,budget=80,plan,program,priors={}}){
  const nx=length/300,ny=width/300;
  if(![nx,ny].every(n=>Number.isInteger(n)&&n>=20&&n<=60))throw Error('生成边界须为6–18米并符合300mm模数');
  const candidates=[],failureCounts={};const fail=reason=>failureCounts[reason]=(failureCounts[reason]||0)+1;const attempts=Math.max(12,Math.min(200,budget));
  for(let attempt=0;attempt<attempts;attempt++){
   const random=rng((seed+Math.imul(attempt+1,2654435761))>>>0),spaces=[{id:0,key:'stairs',label:7,minArea:5.76,minWidth:2.4},...program.map((r,i)=>({id:i+1,...r}))];
   const floorSpaces=[Array(nx*ny).fill(-1),Array(nx*ny).fill(-1)],footprints=[new Uint8Array(nx*ny).fill(1),new Uint8Array(nx*ny).fill(1)];
   // A stepped footprint reserves actual empty regions; unused cells remain empty.
   for(let f=0;f<2;f++){
    const cutW=Math.max(2,Math.round(nx*Math.sqrt(plan.reserveFraction/2))),cutH=Math.max(2,Math.round(ny*Math.sqrt(plan.reserveFraction/2)));
    if(plan.reserveFraction>0)for(let y=0;y<cutH;y++)for(let x=0;x<cutW;x++){footprints[f][y*nx+x]=0;footprints[f][(ny-1-y)*nx+nx-1-x]=0;}
   }
   const sw=8,sh=8;
   const sx=plan.mode==='edge'?Math.max(0,nx-12):Math.max(0,Math.round(nx/2-sw/2)+(Math.floor(random()*5)-2));
   const sy=plan.mode==='edge'?Math.max(0,Math.round(ny/2-sh/2)):Math.max(0,Math.round(ny*.68-sh/2)+(Math.floor(random()*5)-2));
   let failed=false;
   for(let f=0;f<2;f++)for(let y=sy;y<sy+sh;y++)for(let x=sx;x<sx+sw;x++){if(x>=nx||y>=ny||!footprints[f][y*nx+x])failed=true;else floorSpaces[f][y*nx+x]=0;}
   if(failed)continue;
   const boxes=[[],[]],hubs=[];
   const paint=(f,box,id)=>{for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++)floorSpaces[f][y*nx+x]=id;};
   const clear=(f,b,gap=0)=>{
    if(b.x<0||b.y<0||b.x+b.w>nx||b.y+b.h>ny)return false;
    for(let y=b.y;y<b.y+b.h;y++)for(let x=b.x;x<b.x+b.w;x++)if(!footprints[f][y*nx+x]||floorSpaces[f][y*nx+x]>=0)return false;
    for(const other of [{x:sx,y:sy,w:sw,h:sh},...boxes[f]])if(!(b.x+b.w+gap<=other.x||other.x+other.w+gap<=b.x||b.y+b.h+gap<=other.y||other.y+other.h+gap<=b.y))return false;
    return true;
   };
   for(let f=0;f<2&&!failed;f++){
    const rooms=spaces.filter(s=>s.floor===f);
    const hub=rooms.find(s=>s.label===6)||rooms.find(s=>s.key===plan.edges.find(e=>e.a==='stairs'&&spaces.find(s=>s.key===e.b)?.floor===f)?.b);
    if(!hub){failed=true;break;}hubs[f]=hub;
    const pathW=hub.label===6?4:Math.ceil(hub.minWidth/.3);
    const rootBox=[{x:sx-pathW,y:sy,w:pathW,h:sh},{x:sx+sw,y:sy,w:pathW,h:sh},{x:sx,y:sy-pathW,w:sw,h:pathW},{x:sx,y:sy+sh,w:sw,h:pathW}].find(b=>clear(f,b));
    if(!rootBox){failed=true;break;}paint(f,rootBox,hub.id);boxes[f].push({...rootBox,id:hub.id});
    const pending=rooms.filter(r=>r.id!==hub.id).sort((a,b)=>b.minWidth-a.minWidth||b.minArea-a.minArea);
    for(const room of pending){
     const min=Math.ceil(room.minWidth/.3-1e-8),target=Math.max(room.minArea,Math.min(room.targetArea,room.minArea*1.05));
     const w=Math.max(min,Math.ceil(Math.sqrt(target/.09)*(.85+random()*.3))),h=Math.max(min,Math.ceil(target/.09/w));
     const choices=[];const p=priors[room.key];
     for(const [rw,rh] of [[w,h],[h,w]])for(let y=0;y+rh<=ny;y+=2)for(let x=0;x+rw<=nx;x+=2){const b={x,y,w:rw,h:rh};if(clear(f,b,pathW)){
      const distance=p?((x+rw/2)/nx-p.cx)**2+((y+rh/2)/ny-p.cy)**2:0;
      choices.push({...b,score:distance*.6+random()*.8+Math.min(x,y,nx-x-rw,ny-y-rh)*.015});
     }}
     choices.sort((a,b)=>a.score-b.score);const chosen=choices[0];if(!chosen){fail('placement:'+room.key);failed=true;break;}
     paint(f,chosen,room.id);boxes[f].push({...chosen,id:room.id});
    }
    if(failed)break;
    // Route a broad grid band from the public hub to each planned instance.
    const tileOK=(x,y)=>{if(x<0||y<0||x+pathW>nx||y+pathW>ny)return false;for(let j=0;j<pathW;j++)for(let i=0;i<pathW;i++){const at=(y+j)*nx+x+i,id=floorSpaces[f][at];if(!footprints[f][at]||id>=0&&id!==hub.id)return false;}return true;};
    for(const box of boxes[f].filter(b=>b.id!==hub.id)){
     const sources=[];for(let y=0;y+pathW<=ny;y++)for(let x=0;x+pathW<=nx;x++)if(tileOK(x,y)&&floorSpaces[f][y*nx+x]===hub.id)sources.push(y*nx+x);
     const parent=new Int32Array(nx*ny).fill(-2),queue=[];for(const at of sources){parent[at]=-1;queue.push(at);}
     const goals=new Set();for(let k=0;k<=box.h-pathW;k++)for(const x of [box.x-pathW,box.x+box.w])if(tileOK(x,box.y+k))goals.add((box.y+k)*nx+x);for(let k=0;k<=box.w-pathW;k++)for(const y of [box.y-pathW,box.y+box.h])if(tileOK(box.x+k,y))goals.add(y*nx+box.x+k);
     let end=-1;for(let head=0;head<queue.length;head++){const at=queue[head];if(goals.has(at)){end=at;break;}for(const next of neighbors(at,nx,ny))if(parent[next]===-2&&tileOK(next%nx,Math.floor(next/nx))){parent[next]=at;queue.push(next);}}
     if(end<0){fail('routing:'+box.id);failed=true;break;}
     for(let at=end;at>=0;at=parent[at])paint(f,{x:at%nx,y:Math.floor(at/nx),w:pathW,h:pathW},hub.id);
    }
    // Grow attached patches instead of slicing the whole boundary into rectangles.
    // Keep a two-cell attachment so isolated one-cell noise cannot be introduced.
    for(let step=0;step<14&&!failed;step++){
     let changed=false;
     for(const room of rooms){if(room.id===hub.id)continue;const count=floorSpaces[f].filter(id=>id===room.id).length;if(count*.09>=room.targetArea)continue;
      const patches=[],span=Math.ceil(room.minWidth/.3);
      for(const [w,h] of [[span,2],[2,span]])for(let y=0;y+h<=ny;y+=2)for(let x=0;x+w<=nx;x+=2){
       const cells=[];for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)cells.push(yy*nx+xx);
       if(cells.some(i=>!footprints[f][i]||floorSpaces[f][i]>=0))continue;
       let touching=0;for(const i of cells)touching+=neighbors(i,nx,ny).filter(j=>floorSpaces[f][j]===room.id).length;
       if(touching>=span)patches.push({x,y,w,h,score:random()-.2*touching});
      }
      if(patches.length){patches.sort((a,b)=>a.score-b.score);paint(f,patches[0],room.id);changed=true;}
     }if(!changed)break;
    }
   }
   if(failed)continue;
   const m={nx,ny,cell:300,floorCount:2,floorHeight:3000,seed,spaces,floorSpaces,floors:floorSpaces.map(grid=>grid.map(id=>id<0?-1:spaces[id].label))};
   const check=evaluate(m,plan);if(!check.accepted){fail('gate:'+check.checks.filter(c=>!c.passed).map(c=>c.name).join(','));continue;}
   m.validation={accepted:true,checks:check.checks};m.circulation={accepted:true,scope:'target geometric contact graph; not verified doors or routes'};m.programValidation={accepted:true};m.targetTopology=plan;m.actualTopology=[...contacts(m)];m.reserveFraction=check.reserveFraction;
   m.generation={strategy:'topology-first-grid-growth',score:check.score,candidateCount:attempts,selectedCandidate:attempt,neuralUsed:Object.keys(priors).length>0,validCandidateCount:0,areas:check.areas,softMissing:plan.edges.filter(e=>e.kind==='preferred_contact'&&!contacts(m).has([e.a,e.b].sort().join('|'))).length};candidates.push(m);
  }
  if(!candidates.length){if(typeof process!=='undefined'&&process.env.FREE_DEBUG)console.log(failureCounts);throw Error('未找到能落实目标拓扑和最低面积的方案。请增加生成边界、减少功能或调整策略；失败不代表需求不可实现。');}
  candidates.sort((a,b)=>a.generation.score-b.generation.score);const chosen=[];
  for(const m of candidates){const sig=m.floorSpaces.map(g=>g.join(',')).join('|');if(chosen.some(x=>x.signature===sig))continue;chosen.push({model:m,signature:sig});if(chosen.length===3)break;}
  for(const {model} of chosen)model.generation.validCandidateCount=candidates.length;
  return {model:chosen[0].model,alternatives:chosen.slice(1).map(x=>x.model)};
 }
 const api={generate,evaluate,contacts};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FreeCore=api;
})(globalThis);
