(function(root){
  'use strict';
  const REVISION='functional-joint-v1';
  const profile=()=>typeof require==='function'?require('./functional-prior.json'):root.FunctionalPriorProfile;
  const roles=Object.freeze(['service','laundry','entry-storage']);
  function evidence(room,floorArea){
    const p=profile(),key=`${room.floor}:${room.label}`,size=floorArea<120?'small':floorArea>180?'large':'medium';
    if(p?.schema!=='training_functional_prior_v1')throw Error('全功能训练统计未加载');
    return {stats:p.profiles[`${key}:${size}`]||p.profiles[key],key:p.profiles[`${key}:${size}`]?`${key}:${size}`:key,sourceSha256:p.sourceSha256};
  }
  function apply(program,floorArea){
    return program.map(room=>{
      const ev=evidence(room,floorArea),m=ev.stats?.metrics;
      const role=room.label===8?(room.functionalRole||(room.floor===0?'service':'laundry')):room.label===5?'public-bathroom':room.label===4?'bedroom':room.label===9?'hosted-balcony':room.label===0?'entry-and-hall':undefined;
      if(room.label===8&&!roles.includes(role))throw Error('家政用途无效');
      if(room.label===8&&room.floor!==0&&role==='entry-storage')throw Error('入户收纳用途仅适用于一层家政');
      // Engineering defaults are deliberately wider than the central training range.
      const width=room.label===5?1.5:room.label===8?1.5:room.minWidth;
      const minimum=room.label===5?3.6:room.label===8?2.7:room.minArea;
      return {...room,functionalRevision:REVISION,circulationRevision:'circulation-facade-joint-v1',functionalRole:role,minWidth:Math.max(room.minWidth,width),minArea:Math.max(room.minArea,minimum),targetArea:Math.max(room.targetArea,minimum),
        functionalEvidence:{key:ev.key,count:ev.stats?.count||0,sourceSha256:ev.sourceSha256},
        typicalAreaMin:m?.area.p25,typicalAreaMax:m?.area.p75,typicalAspectMax:m?.aspect.p90,
        functionalMaxAspect:room.label===8?2.5:room.label===5?2.7:undefined};
    });
  }
  function fits(room,w,h,area=w*h*.09){
    if(room.functionalRevision!==REVISION)return true;
    return Math.min(w,h)*.3+1e-8>=room.minWidth&&area+1e-8>=room.minArea&&Math.max(w,h)/Math.min(w,h)<=(room.functionalMaxAspect??Infinity)+1e-8&&area<=(room.resourceMaxArea??Infinity)+1e-8;
  }
  function evaluate(model,program=model.spaces){
    const maps=model.owners||model.floorSpaces,nx=model.nx,issues=[],reports=[],warnings=[];
    const active=program.filter(r=>r.functionalRevision===REVISION);
    for(const room of active){
      const space=model.spaces.find(s=>s.key===room.key);if(!space)continue;
      const cells=[];maps[room.floor].forEach((sid,i)=>{if(sid===space.id)cells.push(i);});
      if(!cells.length){issues.push(room.key+'缺少功能区域');continue;}
      const xs=cells.map(i=>i%nx),ys=cells.map(i=>Math.floor(i/nx)),w=Math.max(...xs)-Math.min(...xs)+1,h=Math.max(...ys)-Math.min(...ys)+1,area=cells.length*.09;
      if(!fits(room,w,h,area))issues.push(room.key+'未满足全功能尺寸或容量限制');
      const target=room.budgetTargetArea??room.targetArea,relativeDeviation=target?area/target-1:0;
      const below=Number.isFinite(room.preferredAreaMin)&&area<room.preferredAreaMin-1e-8,above=Number.isFinite(room.preferredAreaMax)&&area>room.preferredAreaMax+1e-8;
      if(below||above)warnings.push(room.key+(below?'低于':'高于')+'协调优选面积');
      reports.push({key:room.key,floor:room.floor,role:room.functionalRole,area,shortSide:Math.min(w,h)*.3,longSide:Math.max(w,h)*.3,aspect:Math.max(w,h)/Math.min(w,h),
        predictedArea:room.predictedArea,targetArea:target,relativeDeviation,typicalAreaMin:room.typicalAreaMin,typicalAreaMax:room.typicalAreaMax,preferredAreaMin:room.preferredAreaMin,preferredAreaMax:room.preferredAreaMax,evidence:room.functionalEvidence});
    }
    return {revision:active.length?REVISION:null,accepted:!issues.length,issues,warnings,reports,evaluation:'training envelopes and engineering gates; no verified furniture or building-code compliance'};
  }
  // Evaluate room pairs over planned portals; private rooms and stairs are endpoints.
  function relations(model,connections){
    const spaces=model.spaces,maps=model.owners||model.floorSpaces,nx=model.nx,issues=[],reports=[];let penalty=0;
    const publicLabel=label=>[0,1,2,6,10].includes(label);
    function route(start,targets,floor){
      const queue=[{at:start,path:[start],portals:[],length:0}],seen=new Set();
      while(queue.length){queue.sort((a,b)=>a.length-b.length);const state=queue.shift();if(seen.has(state.at))continue;seen.add(state.at);
        if(targets.includes(state.at))return state;
        for(const e of connections.filter(e=>e.floor===floor&&(e.a===state.at||e.b===state.at))){
          const next=e.a===state.at?e.b:e.a;if(seen.has(next)||!targets.includes(next)&&!publicLabel(spaces[next]?.label))continue;
          const last=state.portals.at(-1),length=state.length+(last?(Math.abs(last.x-e.x)+Math.abs(last.y-e.y))*.3:0);
          queue.push({at:next,path:[...state.path,next],portals:[...state.portals,e],length});
        }
      }return null;
    }
    for(let floor=0;floor<maps.length;floor++){
      const present=spaces.filter(s=>maps[floor].includes(s.id)),baths=present.filter(s=>s.label===5),utilities=present.filter(s=>s.label===8&&s.functionalRevision===REVISION);
      for(const u of utilities){
        const targets=present.filter(s=>u.functionalRole==='entry-storage'?s.label===0:u.functionalRole==='laundry'?s.label===5||s.label===9:s.label===3||s.label===5);
        const path=route(u.id,targets.map(s=>s.id),floor),labels=path?.path.map(id=>spaces[id].label)||[];
        const viaEntry=labels.slice(1,-1).includes(0),area=maps[floor].length*.09,maxLength=Math.max(4.8,Math.sqrt(area)*.6);
        const soleEntry=connections.filter(e=>e.floor===floor&&(e.a===u.id||e.b===u.id)).every(e=>spaces[e.a===u.id?e.b:e.a]?.label===0);
        const accepted=targets.length>0&&!!path&&(u.functionalRole==='entry-storage'||!soleEntry&&!viaEntry&&path.length<=maxLength+1e-8);
        if(!accepted)issues.push(u.key+'家政须通过服务区或短公共通路联系目标，不能只连接玄关');
        penalty+=!path&&targets.length?30:viaEntry?18:Math.max(0,(path?.length||0)-3)*2;
        const record={floor,key:u.key,role:u.functionalRole,accepted,targetCount:targets.length,path:path?.path.map(id=>spaces[id].key)||[],portalSpan:path?.length??null,maximumPortalSpan:maxLength,viaEntry};
        // Laundry balconies are preferred only when they can be reached publicly.
        if(u.functionalRole==='laundry'){
          const balconies=present.filter(s=>s.label===9),dry=route(u.id,balconies.map(s=>s.id),floor);
          record.balconyPath=dry?.path.map(id=>spaces[id].key)||[];record.balconyPortalSpan=dry?.length??null;
          if(balconies.length)penalty+=dry?Math.max(0,dry.length-4)*1.5:12;
        }
        reports.push(record);
      }
      for(const bed of present.filter(s=>s.label===4&&s.functionalRevision===REVISION)){
        const path=route(bed.id,baths.map(s=>s.id),floor);
        if(baths.length&&!path)issues.push(bed.key+'无法经公共通路联系同层卫生间');
        reports.push({floor,key:bed.key,role:'bedroom-to-bathroom',accepted:!baths.length||!!path,path:path?.path.map(id=>spaces[id].key)||[],portalSpan:path?.length??null});
        if(path)penalty+=Math.max(0,path.length-4);
      }
      for(const b of present.filter(s=>s.label===9&&s.functionalRevision===REVISION)){
        const neighbors=connections.filter(e=>e.floor===floor&&(e.a===b.id||e.b===b.id)).map(e=>spaces[e.a===b.id?e.b:e.a]);
        reports.push({floor,key:b.key,role:neighbors.some(s=>publicLabel(s.label))?'public-balcony':'private-balcony',hosts:neighbors.map(s=>s.key)});
      }
      for(const hall of present.filter(s=>s.generated&&s.key.includes(':shared-hall-'))){
        const hosts=connections.filter(e=>e.floor===floor&&(e.a===hall.id||e.b===hall.id)).map(e=>spaces[e.a===hall.id?e.b:e.a].key),accepted=new Set(hosts).size>=2;
        if(!accepted)issues.push(hall.key+'共享门厅须具有两个实际规划连接');
        reports.push({floor,key:hall.key,role:'shared-hall',accepted,hosts});
      }
    }
    return {revision:REVISION,accepted:!issues.length,issues,reports,penalty,evaluation:'planned portal Manhattan span, excludes endpoint interiors; no actual walking or plumbing verified'};
  }
  const api={REVISION,roles,profile,evidence,apply,fits,evaluate,relations};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FunctionalRules=api;
})(globalThis);
