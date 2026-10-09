(function(root){
 'use strict';
 const Rules=typeof module!=='undefined'&&module.exports?require('./rules.js'):root.Rules;
 const rng=seed=>()=>{seed=(seed+0x6D2B79F5)>>>0;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
 const shuffle=(a,r)=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 function evaluate(m,plan){
  const validation=Rules.validate(m),actual=Rules.contacts(m),areas={},checks=[...validation.checks];
  for(const s of m.spaces)for(let f=0;f<2;f++)if(s.label===7||s.floor===f){const area=m.floorSpaces[f].filter(id=>id===s.id).length*.09;areas[s.key+':'+f]=area;checks.push({name:s.key+' '+(f+1)+'F 最低面积',passed:area+1e-8>=s.minArea});}
  const missing=plan.edges.filter(e=>e.kind==='required_contact'&&!actual.has([e.a,e.b].sort().join('|'))),softMissing=plan.edges.filter(e=>e.kind==='preferred_contact'&&!actual.has([e.a,e.b].sort().join('|'))).length;
  checks.push({name:'目标硬关系实现',passed:!missing.length});
  const deviation=plan.rooms.reduce((sum,r)=>sum+Math.abs((areas[r.key+':'+(r.floor-1)]||0)-r.area)/r.area,0),complexity=m.spaces.reduce((sum,s)=>sum+[0,1].reduce((n,f)=>n+(Rules.shape(m.floorSpaces[f],m.nx,m.ny,s.id)==='L'?1:0),0),0);
  return {accepted:checks.every(c=>c.passed),checks,validation,missing,areas,reserveFraction:0,softMissing,score:deviation*10+softMissing*8+complexity*2};
 }
 function generate({length,width,seed,budget=32,plan,program,priors={}}){
  const nx=length/300,ny=width/300,attempts=Math.max(12,Math.min(200,budget));
  if(![nx,ny].every(n=>Number.isInteger(n)&&n>=20&&n<=60))throw Error('生成边界须为6–18米并符合300mm模数');
  const spaces=[{id:0,key:'stairs',label:7,minArea:5.76,minWidth:2.4},...program.map((r,i)=>({id:i+1,...r}))],candidates=[],failures={};let best=null,repairs=0;
  const fail=code=>failures[code]=(failures[code]||0)+1;
  for(let attempt=0;attempt<attempts;attempt++){
   const random=rng((seed+Math.imul(attempt+1,2654435761))>>>0),rotate=random()<.5,W=rotate?ny:nx,H=rotate?nx:ny;
   const hubs=[0,1].map(f=>spaces.find(s=>s.floor===f&&s.label===6)||spaces.find(s=>s.floor===f&&['entryway','living_room','dining_room','multi_purpose'].includes(plan.rooms.find(r=>r.key===s.key)?.type)&&plan.edges.some(e=>e.kind==='required_contact'&&[e.a,e.b].includes('stairs')&&[e.a,e.b].includes(s.key))));
   if(hubs.some(h=>!h)){fail('public_hub');continue;}
   const band=Math.max(...hubs.map(h=>Math.ceil(h.minWidth/.3))),sw=8,sh=8;
   const low=8,high=H-band-8;if(high<low){fail('stair_band_capacity');continue;}
   const y=Math.max(low,Math.min(high,Math.round((H-band)/2)+(Math.floor(random()*9)-4))),topY=y+band,topH=H-topY;
   const sx=plan.mode==='edge'?(random()<.5?0:W-sw):Math.max(0,Math.min(W-sw,Math.round(W/2-sw/2)+(Math.floor(random()*7)-3)));
   const buckets=[{x:0,y:0,w:W,h:y},{x:0,y:topY,w:sx,h:topH},{x:sx+sw,y:topY,w:W-sx-sw,h:topH}].filter(b=>b.w>0);
   let failed=false;const floorSpaces=[];
   for(let f=0;f<2;f++){
    const hub=hubs[f],rooms=spaces.filter(s=>s.floor===f&&s.id!==hub.id),bins=buckets.map(b=>({...b,rooms:[],used:0}));
    const groups=[],seen=new Set();
    for(const room of rooms)if(!seen.has(room.key)){const group=[room];seen.add(room.key);for(let k=0;k<group.length;k++)for(const e of plan.edges.filter(e=>e.kind==='required_contact')){const other=e.a===group[k].key?e.b:e.b===group[k].key?e.a:null,target=rooms.find(r=>r.key===other);if(target&&!seen.has(target.key)){seen.add(target.key);group.push(target);}}groups.push(group);}
    const ordered=shuffle(groups,random).sort((a,b)=>b.length-a.length);
    for(const group of ordered){
     const choices=[];
     for(const b of bins){
      const required=group.map(r=>Math.max(Math.ceil(r.minWidth/.3-1e-8),Math.ceil(r.minArea/.09/b.h-1e-8)));
      if(group.some(r=>b.h*.3+1e-8<r.minWidth)||b.used+required.reduce((a,v)=>a+v,0)>b.w)continue;
      const cx=rotate?(b.y+b.h/2)/H:(b.x+b.w/2)/W,cy=rotate?(b.x+b.w/2)/W:(b.y+b.h/2)/H;
      const distance=group.reduce((sum,r)=>{const p=priors[r.key];return sum+(p?(p.cx-cx)**2+(p.cy-cy)**2:0);},0)/group.length;
      choices.push({b,required,score:random()+distance*.6+(b.rooms.length?0:-.5)});
     }
     choices.sort((a,b)=>a.score-b.score);if(!choices.length){failed=true;fail('room_band_capacity');if(!best)best=[{rule:'CAPACITY',code:'room_band_capacity',instance:group.map(r=>r.key),expected:group.map(r=>({key:r.key,min_width_mm:r.minWidth*1000,min_area_m2:r.minArea})),actual:bins.map(b=>({width_mm:b.w*300,height_mm:b.h*300,free_width_mm:(b.w-b.used)*300}))}];break;}
     const chosen=choices[0];for(let i=0;i<group.length;i++){chosen.b.rooms.push({...group[i],minimumWidth:chosen.required[i]});chosen.b.used+=chosen.required[i];}
    }
    if(failed)break;
    if(bins.some(b=>!b.rooms.length)){failed=true;fail('empty_partition_band');break;}
    function renderBins(){
     const local=Array(W*H).fill(-1),paint=(b,id)=>{for(let yy=b.y;yy<b.y+b.h;yy++)for(let xx=b.x;xx<b.x+b.w;xx++)local[yy*W+xx]=id;};
     paint({x:0,y,w:W,h:band},hub.id);paint({x:sx,y:topY,w:sw,h:sh},0);
     for(const b of bins){
      const remaining=b.w-b.used,weights=b.rooms.map(r=>Math.max(.1,r.targetArea-r.minimumWidth*b.h*.09)),sum=weights.reduce((a,v)=>a+v,0),widths=b.rooms.map((r,i)=>r.minimumWidth+Math.floor(remaining*weights[i]/sum));
      let extra=b.w-widths.reduce((a,v)=>a+v,0);for(let i=0;extra>0;i++,extra--)widths[i%widths.length]++;
      let xx=b.x;for(let i=0;i<b.rooms.length;i++){paint({x:xx,y:b.y,w:widths[i],h:b.h},b.rooms[i].id);xx+=widths[i];}
     }
     if(topH>sh){const left=bins.find(b=>b.y===topY&&b.x===0&&b.w===sx),right=bins.find(b=>b.y===topY&&b.x===sx+sw),owner=left?left.rooms[left.rooms.length-1]:right?.rooms[0];if(!owner)return null;paint({x:sx,y:topY+sh,w:sw,h:topH-sh},owner.id);}
     return local;
    }
    const toGrid=local=>{const grid=Array(nx*ny);for(let yy=0;yy<H;yy++)for(let xx=0;xx<W;xx++)grid[rotate?xx*nx+yy:yy*nx+xx]=local[yy*W+xx];return grid;};
    const penalty=local=>{if(!local)return Infinity;const actual=Rules.contacts({nx,ny,spaces,floorSpaces:[toGrid(local)]});return plan.edges.filter(e=>e.kind==='required_contact'&&plan.rooms.some(r=>r.key===(e.a==='stairs'?e.b:e.a)&&r.floor===f+1)&&!actual.has([e.a,e.b].sort().join('|'))).length;};
    let local=renderBins(),cost=penalty(local);
    // Repair by swapping complete rectangular pieces, not arbitrary voxel filling.
    for(let k=0;k<12&&cost>0;k++){
     const b=bins[Math.floor(random()*bins.length)];if(b.rooms.length<2)continue;const a=Math.floor(random()*b.rooms.length),j=Math.floor(random()*b.rooms.length);[b.rooms[a],b.rooms[j]]=[b.rooms[j],b.rooms[a]];const next=renderBins(),nextCost=penalty(next);
     if(nextCost<cost){local=next;cost=nextCost;repairs++;}else [b.rooms[a],b.rooms[j]]=[b.rooms[j],b.rooms[a]];
    }
    if(!local){failed=true;fail('stair_cap');break;}floorSpaces.push(toGrid(local));
   }
   if(failed)continue;
   const m={nx,ny,cell:300,voxelCell:[300,300,300],floorCount:2,floorHeight:3000,seed,spaces,floorSpaces,floors:floorSpaces.map(g=>g.map(id=>spaces[id]?.label??-1))},check=evaluate(m,plan);
   if(!check.accepted){fail(check.missing.length?'required_contacts':'rule_or_area');const now=[...check.validation.issues,...check.missing.map(e=>({rule:'TOPOLOGY',code:'missing_contact',instance:[e.a,e.b],expected:'shared face',actual:'not touching'})),...check.checks.filter(c=>!c.passed&&!/^R[1-6]$/.test(c.name)).map(c=>({rule:'PROGRAM',code:c.name}))];if(!best||now.length<best.length)best=now;continue;}
   m.validation={accepted:true,checks:check.checks,rules:check.validation};m.circulation={accepted:true,scope:'geometric contacts; doors and routes not verified'};m.programValidation={accepted:true};m.targetTopology=plan;m.actualTopology=[...Rules.contacts(m)];m.reserveFraction=0;
   m.generation={strategy:'full-partition-rectangular-pieces',score:check.score,candidateCount:attempts,selectedCandidate:attempt,neuralUsed:Object.keys(priors).length>0,validCandidateCount:0,areas:check.areas,softMissing:check.softMissing,localRepairs:repairs};candidates.push(m);
  }
  if(!candidates.length){const error=Error('本轮搜索未找到同时满足R1–R6和目标关系的方案。');error.report={version:Rules.VERSION,type:'search_exhausted',seed,budget:attempts,failures,issues:best||[{rule:'CAPACITY',code:'partition_capacity',expected:'place minimum-width rectangular pieces',actual:'no feasible sampled partition'}],local_repairs:repairs,scope:'bounded partition search; not proof of infeasibility'};throw error;}
  candidates.sort((a,b)=>a.generation.score-b.generation.score);const chosen=[],signatures=new Set();for(const m of candidates){const signature=JSON.stringify(m.floorSpaces);if(signatures.has(signature))continue;signatures.add(signature);chosen.push(m);if(chosen.length===3)break;}for(const m of chosen)m.generation.validCandidateCount=candidates.length;
  return {model:chosen[0],alternatives:chosen.slice(1)};
 }
 const api={generate,evaluate,contacts:Rules.contacts};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FreeCore=api;
})(globalThis);
