(function(root){
 'use strict';
 const REVISION='circulation-facade-joint-v1';
 const profile=()=>typeof require==='function'?require('./circulation-prior.json'):root.CirculationPriorProfile;
 function actualBudget(model,program){
  const project=(typeof require==='function'?require('./joint-area.js'):root.JointArea).project,maps=model.owners||model.floorSpaces,fp=maps[0].length*.09,rooms=program.map(r=>({...r})),floors=[];
  for(let floor=0;floor<2;floor++){
   const counts=new Map();for(const id of maps[floor])counts.set(model.spaces[id]?.label,(counts.get(model.spaces[id]?.label)||0)+1);
   const stairs=(counts.get(7)||0)*.09,traffic=(counts.get(6)||0)*.09,available=fp-stairs-traffic,rs=rooms.filter(r=>r.floor===floor),groups=[];
   for(const r of rs){const key=r.resourceGroupKey||r.key;let g=groups.find(g=>g.key===key);if(!g){g={key,rooms:[]};groups.push(g);}g.rooms.push(r);}
   const sum=xs=>xs.reduce((a,b)=>a+b,0),lo=r=>r.resourceMinArea??r.minArea,hi=r=>r.resourceMaxArea;
   if(rs.some(r=>!Number.isFinite(hi(r))))return {accepted:true,program,revision:REVISION,floors:[],policy:'no joint-area capacities; original targets retained'};
   try{
    const target=project(groups.map(g=>sum(g.rooms.map(r=>r.predictedArea??r.targetArea))),groups.map(g=>sum(g.rooms.map(lo))),groups.map(g=>Math.min(sum(g.rooms.map(hi)),g.rooms[0].resourceGroupMaxArea??Infinity)),available);
    groups.forEach((g,i)=>{const t=project(g.rooms.map(r=>r.predictedArea??r.targetArea),g.rooms.map(lo),g.rooms.map(hi),target[i]);g.rooms.forEach((r,j)=>{r.preGeometryTargetArea=r.targetArea;r.targetArea=t[j];r.preferredAreaMin=Math.max(lo(r),t[j]*.85);r.preferredAreaMax=Math.min(hi(r),t[j]*1.15);});});
    floors.push({floor,footprint:fp,actualStairArea:stairs,actualTrafficArea:traffic,available,totalTarget:sum(rs.map(r=>r.targetArea)),targets:rs.map(r=>({key:r.key,predictedArea:r.predictedArea,preGeometryTargetArea:r.preGeometryTargetArea,targetArea:r.targetArea}))});
   }catch(e){return {revision:REVISION,accepted:false,issues:[`${floor+1}层实际交通预算无法协调：${e.message}`],program,floors};}
  }
  return {revision:REVISION,accepted:true,program:rooms,floors,policy:'same frozen area predictions; bounded joint redistribution after measured stair/corridor geometry; no retraining'};
 }
 function evaluate(model,program=model.spaces){
  const p=profile(),maps=model.owners||model.floorSpaces,fp=model.nx*maps[0].length/model.nx*.09,reports=[],issues=[];
  if(!p||p.schema!=='training_circulation_prior_v1')throw Error('交通统计未加载');
  for(let floor=0;floor<2;floor++){
   const map=maps[floor],nx=model.nx,ny=map.length/nx,size=fp<120?'small':fp>180?'large':'medium',stats=p.profiles[`${floor}:${size}`]||p.profiles[`${floor}:all`];
   const sides={W:[],E:[],S:[],N:[]},areas=new Map();let area=0,landingArea=0;
   for(let i=0;i<map.length;i++){
    const s=model.spaces[map[i]];if(s?.label!==6)continue;
    area+=.09;areas.set(s.id,(areas.get(s.id)||0)+.09);if(s.key==='1:stair-landing')landingArea+=.09;
    const x=i%nx,y=Math.floor(i/nx);if(x===0)sides.W.push(i);if(x===nx-1)sides.E.push(i);if(y===0)sides.S.push(i);if(y===ny-1)sides.N.push(i);
   }
   const sideLengths=Object.fromEntries(Object.entries(sides).map(([k,v])=>[k,v.length*.3])),facadeLength=Object.values(sideLengths).reduce((a,b)=>a+b,0);
   const preferred=stats.metrics.areaFraction.p75*fp;
   // Product constraints for this brief. Statistical quantiles are references, not laws.
   const maximum=Math.floor((preferred+1e-8)/.09)*.09,maximumFacade=1.2;
   const width=Math.round((model.corridorWidth||1.2)/.3),covered=new Uint8Array(map.length);
   for(let y=0;y<=ny-width;y++)for(let x=0;x<=nx-width;x++){
    let full=true;for(let dy=0;dy<width&&full;dy++)for(let dx=0;dx<width;dx++)if(model.spaces[map[(y+dy)*nx+x+dx]]?.label!==6){full=false;break;}
    if(full)for(let dy=0;dy<width;dy++)for(let dx=0;dx<width;dx++)covered[(y+dy)*nx+x+dx]=1;
   }
   const narrowCells=Array.from(map).filter((id,i)=>model.spaces[id]?.label===6&&!covered[i]).length;
   const floorIssues=[];if(narrowCells)floorIssues.push(`${floor+1}层交通空间存在不足${width*.3}m独立宽度的余条`);
   const connections=model.connections||model.organization?.connections,hosts=connections?[...areas].map(([id])=>({key:model.spaces[id].key,hosts:[...new Set(connections.filter(e=>e.floor===floor&&(e.a===id||e.b===id)).map(e=>model.spaces[e.a===id?e.b:e.a]?.key))]})):[];
   for(const h of hosts)if(h.hosts.length<2)floorIssues.push(h.key+'交通空间须有两个实际规划连接，不能是补余量的尽端');
   if(area>maximum+1e-7)floorIssues.push(`${floor+1}层交通总面积${area.toFixed(2)}㎡超过${maximum.toFixed(2)}㎡`);
   if(facadeLength>maximumFacade+1e-7)floorIssues.push(`${floor+1}层走廊占用外墙${facadeLength.toFixed(2)}m超过1.20m`);
   if(sideLengths.S>1e-7)floorIssues.push(`${floor+1}层走廊占用南侧采光面`);
   issues.push(...floorIssues);
   reports.push({floor,area,areaFraction:area/fp,landingArea,narrowCells,connectionHosts:hosts,preferredArea:preferred,maximumArea:maximum,facadeLength,sideLengths,maximumFacadeLength:maximumFacade,maximumSouthLength:0,accepted:!floorIssues.length,spaces:[...areas].map(([id,area])=>({key:model.spaces[id].key,area})),evidence:{key:`${floor}:${stats===p.profiles[`${floor}:${size}`]?size:'all'}`,count:stats.count,sourceSha256:p.sourceSha256}});
  }
  const penalty=reports.reduce((sum,r)=>sum+Math.max(0,r.area-r.maximumArea)*8+r.facadeLength*12+r.sideLengths.S*20+r.narrowCells*.5+r.area*.15,0);
  return {revision:REVISION,accepted:!issues.length,issues,reports,penalty,policy:'brief-specific: P75 area cap, <=1.2m total exterior frontage, zero south frontage; all corridor/landing/hall labels counted',evaluation:'envelope contact proxy, orientation uses -Y; no measured windows or site survey'};
 }
 const api={REVISION,profile,evaluate,actualBudget};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CirculationRules=api;
})(globalThis);
