(function(root){
  'use strict';
  // Adjustable demo activity envelopes, not building-code limits or furniture plans.
  const ACTIVITY_RULES=Object.freeze({1:{w:10,h:8,name:'客厅活动区'},2:{w:7,h:7,name:'用餐活动区'},10:{w:8,h:8,name:'多功能活动区'}});
  const transit=label=>[0,1,2,6,10].includes(label);
  function adjacent(i,nx,ny){const x=i%nx,y=Math.floor(i/nx);return [x?i-1:-1,x+1<nx?i+1:-1,y?i-nx:-1,y+1<ny?i+nx:-1].filter(j=>j>=0);}
  function integral(nx,ny,valid){
    const a=new Int32Array((nx+1)*(ny+1));
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)a[(y+1)*(nx+1)+x+1]=Number(valid(y*nx+x))+a[y*(nx+1)+x+1]+a[(y+1)*(nx+1)+x]-a[y*(nx+1)+x];
    return (x,y,w,h)=>a[(y+h)*(nx+1)+x+w]-a[y*(nx+1)+x+w]-a[(y+h)*(nx+1)+x]+a[y*(nx+1)+x];
  }
  function walk(map,spaces,nx,width,rootId,blocked){
    const ny=map.length/nx,sum=integral(nx,ny,i=>transit(spaces[map[i]]?.label)&&!blocked[i]);
    const rootCells=Array.from(map).flatMap((sid,i)=>sid===rootId?[i]:[]),front=rootCells.filter(i=>i<nx);
    const sources=spaces[rootId]?.label===0?front:rootCells;
    const sourceX=sources.reduce((sum,i)=>sum+i%nx,0)/Math.max(1,sources.length),sourceY=spaces[rootId]?.label===0?0:sources.reduce((sum,i)=>sum+Math.floor(i/nx),0)/Math.max(1,sources.length);
    const allowed=new Uint8Array(map.length),previous=new Int32Array(map.length).fill(-2),cover=new Int32Array(map.length).fill(-1),distance=new Int32Array(map.length),queue=[];
    for(let y=0;y<=ny-width;y++)for(let x=0;x<=nx-width;x++){
      const at=y*nx+x;if(sum(x,y,width,width)!==width*width)continue;allowed[at]=1;
      if(sources.length&&x<=sourceX&&sourceX<x+width&&y<=sourceY&&sourceY<y+width){previous[at]=-1;queue.push(at);}
    }
    for(let head=0;head<queue.length;head++){
      const at=queue[head],x=at%nx,y=Math.floor(at/nx);
      for(let yy=y;yy<y+width;yy++)for(let xx=x;xx<x+width;xx++)if(cover[yy*nx+xx]<0)cover[yy*nx+xx]=at;
      for(const next of adjacent(at,nx,ny))if(allowed[next]&&previous[next]===-2){previous[next]=at;distance[next]=distance[at]+1;queue.push(next);}
    }
    return {previous,cover,distance};
  }
  function endpoint(map,spaces,nx,net,sid){
    let result=null;const faces=new Map();
    const preferred=end=>spaces[sid].label===3&&spaces[map[end.outside]]?.label===2?0:1;
    const better=end=>!result||preferred(end)<preferred(result)||preferred(end)===preferred(result)&&end.cost<result.cost;
    for(let i=0;i<map.length;i++)if(map[i]===sid){
      if(transit(spaces[sid].label)&&net.cover[i]>=0){const square=net.cover[i],cost=net.distance[square];const end={square,cost,inside:i,outside:i};if(better(end))result=end;}
      for(const j of adjacent(i,nx,map.length/nx).filter(j=>map[j]!==sid&&net.cover[j]>=0&&!(spaces[sid].label===4&&spaces[map[j]].label===7))){
        const vertical=Math.abs(i-j)===1,key=`${vertical?'x':'y'}:${vertical?Math.max(i%nx,j%nx):Math.max(Math.floor(i/nx),Math.floor(j/nx))}:${map[j]}`;
        if(!faces.has(key))faces.set(key,[]);faces.get(key).push({inside:i,outside:j,position:vertical?Math.floor(i/nx):i%nx});
      }
    }
    // A 0.9 m proxy portal must fit on a continuous shared boundary.
    for(const group of faces.values()){
      group.sort((a,b)=>a.position-b.position);
      for(let k=1;k<group.length-1;k++)if(group[k-1].position+1===group[k].position&&group[k].position+1===group[k+1].position){
        const face=group[k],square=net.cover[face.outside],cost=net.distance[square];const end={square,cost,...face};if(better(end))result=end;
      }
    }
    return result;
  }
  function rectangles(map,nx,sid,rule){
    const ny=map.length/nx,sum=integral(nx,ny,i=>map[i]===sid),result=[];
    for(const [w,h] of [[rule.w,rule.h],[rule.h,rule.w]]){
      const choices=[];
      for(let y=0;y<=ny-h;y++)for(let x=0;x<=nx-w;x++)if(sum(x,y,w,h)===w*h)choices.push({x,y,w,h});
      // Wall/corner placements leave an edge available for circulation.
      for(const order of [(a,b)=>a.y-b.y||a.x-b.x,(a,b)=>a.y-b.y||b.x-a.x,(a,b)=>b.y-a.y||a.x-b.x,(a,b)=>b.y-a.y||b.x-a.x]){
        choices.sort(order);if(choices[0]&&!result.some(r=>JSON.stringify(r)===JSON.stringify(choices[0])))result.push(choices[0]);
      }
    }
    return result;
  }
  function portal(a,b,floor,i,j,nx,kind='access'){
    return {a,b,floor,x:Math.max(i%nx,j%nx),y:Math.max(Math.floor(i/nx),Math.floor(j/nx)),axis:Math.abs(i-j)===1?'x':'y',kind,width:.9};
  }
  function evaluate(candidate){
    const maps=candidate.owners||candidate.floorSpaces,{spaces,nx}=candidate,width=Math.round((candidate.corridorWidth||1.2)/.3);
    const activities=[],routes=[],connections=[],issues=[],unreachable=[],floorReports=[];
    const keys=new Set();
    const addDoor=door=>{const key=`${door.floor}:${Math.min(door.a,door.b)}:${Math.max(door.a,door.b)}`;if(!keys.has(key)){keys.add(key);connections.push(door);}};
    for(let floor=0;floor<2;floor++){
      const map=maps[floor],ny=map.length/nx,rootId=spaces.find(s=>s.key===(floor===0?'entry':'1:stair-landing'))?.id;
      const present=spaces.filter(s=>map.includes(s.id)),targets=present.filter(s=>s.label!==9);
      if(!present.some(s=>s.label!==7))continue;
      if(rootId===undefined||!map.includes(rootId)){issues.push(`${floor+1}层缺少独立公共通行起点`);continue;}
      const cores=present.filter(s=>ACTIVITY_RULES[s.label]).map(s=>({sid:s.id,key:s.key,options:rectangles(map,nx,s.id,ACTIVITY_RULES[s.label])}));
      for(const core of cores)if(!core.options.length)issues.push(`${floor+1}层 ${core.key} 无法容纳完整活动区`);
      const chosen=new Map();
      const block=()=>{const mask=new Uint8Array(map.length);for(const rect of chosen.values())for(let y=rect.y;y<rect.y+rect.h;y++)for(let x=rect.x;x<rect.x+rect.w;x++)mask[y*nx+x]=1;return mask;};
      // Two coordinate passes allow a later activity choice to revise earlier choices.
      for(let pass=0;pass<2;pass++)for(const core of cores){
        let best=null,bestCost=Infinity;
        for(const rect of core.options){
          chosen.set(core.sid,rect);const net=walk(map,spaces,nx,width,rootId,block());
          const ends=targets.map(s=>endpoint(map,spaces,nx,net,s.id));
          const cost=ends.reduce((sum,e)=>sum+(e?e.cost/1000:100),0);
          if(cost<bestCost){best=rect;bestCost=cost;}
        }
        if(best)chosen.set(core.sid,best);
      }
      const blocked=block(),net=walk(map,spaces,nx,width,rootId,blocked),used=new Uint8Array(map.length);
      for(const core of cores)if(chosen.has(core.sid))activities.push({floor,spaceId:core.sid,key:core.key,...chosen.get(core.sid),area:chosen.get(core.sid).w*chosen.get(core.sid).h*.09});
      for(const room of targets){
        const end=endpoint(map,spaces,nx,net,room.id);
        if(floor===1&&room.label===7){
          const landingNet={...net,cover:Int32Array.from(net.cover,(at,i)=>map[i]===rootId?at:-1)};
          const landingEnd=endpoint(map,spaces,nx,landingNet,room.id);
          if(landingEnd)addDoor(portal(room.id,rootId,floor,landingEnd.inside,landingEnd.outside,nx,'stair-access'));
          else unreachable.push({floor,key:room.key,spaceId:room.id});
          continue;
        }
        if(!end){if(room.label!==8)unreachable.push({floor,key:room.key,spaceId:room.id});continue;}
        const squares=[];
        for(let at=end.square;at>=0;at=net.previous[at]){
          const x=at%nx,y=Math.floor(at/nx);squares.push({x,y,w:width,h:width});
          for(let yy=y;yy<y+width;yy++)for(let xx=x;xx<x+width;xx++)used[yy*nx+xx]=1;
        }
        squares.reverse();
        if(room.id!==rootId)routes.push({floor,target:room.key,spaceId:room.id,length:end.cost*.3,squares,reason:'protected-public-network'});
        if(end.inside!==end.outside)addDoor(portal(room.id,map[end.outside],floor,end.inside,end.outside,nx,room.label===7?'stair-access':transit(room.label)?'open':'door'));
      }
      const sharedFaces=new Map();
      for(let i=0;i<map.length;i++)if(used[i])for(const j of [i%nx+1<nx?i+1:-1,i+nx<map.length?i+nx:-1]){
        if(j>=0&&used[j]&&map[i]!==map[j]&&transit(spaces[map[i]]?.label)&&transit(spaces[map[j]]?.label)){
          const vertical=j===i+1,key=`${Math.min(map[i],map[j])}:${Math.max(map[i],map[j])}:${vertical?'x':'y'}:${vertical?j%nx:Math.floor(j/nx)}`;
          if(!sharedFaces.has(key))sharedFaces.set(key,[]);sharedFaces.get(key).push({i,j,position:vertical?Math.floor(i/nx):i%nx});
        }
      }
      for(const faces of sharedFaces.values()){
        faces.sort((a,b)=>a.position-b.position);
        const face=faces.find((f,k)=>k>0&&k+1<faces.length&&faces[k-1].position+1===f.position&&f.position+1===faces[k+1].position);
        if(face)addDoor(portal(map[face.i],map[face.j],floor,face.i,face.j,nx,'open'));
      }
      // Utility may be reached through its kitchen, without treating a kitchen as a through-route.
      for(const room of present.filter(s=>s.label===8)){
        const direct=endpoint(map,spaces,nx,net,room.id);
        if(direct){addDoor(portal(room.id,map[direct.outside],floor,direct.inside,direct.outside,nx,'door'));continue;}
        const kitchen=present.find(s=>s.label===3),groups=new Map();
        if(kitchen)for(let i=0;i<map.length;i++)if(map[i]===room.id)for(const j of adjacent(i,nx,ny).filter(j=>map[j]===kitchen.id)){
          const vertical=Math.abs(i-j)===1,key=`${vertical?'x':'y'}:${vertical?Math.max(i%nx,j%nx):Math.max(Math.floor(i/nx),Math.floor(j/nx))}`;
          if(!groups.has(key))groups.set(key,[]);groups.get(key).push({i,j,position:vertical?Math.floor(i/nx):i%nx});
        }
        let face=null;
        for(const faces of groups.values()){
          faces.sort((a,b)=>a.position-b.position);face=faces.find((f,k)=>k>0&&k+1<faces.length&&faces[k-1].position+1===f.position&&f.position+1===faces[k+1].position);if(face)break;
        }
        if(face&&endpoint(map,spaces,nx,net,kitchen.id))addDoor(portal(room.id,kitchen.id,floor,face.i,face.j,nx,'door'));
        else unreachable.push({floor,key:room.key,spaceId:room.id});
      }
      const publicCells=Array.from(used).reduce((sum,n,i)=>sum+Number(n&&[0,1,2,10].includes(spaces[map[i]]?.label)),0);
      const corridorCells=Array.from(map).filter(sid=>spaces[sid]?.label===6).length;
      floorReports.push({floor,publicTrafficArea:publicCells*.09,corridorArea:corridorCells*.09,activityArea:activities.filter(a=>a.floor===floor).reduce((sum,a)=>sum+a.area,0)});
    }
    for(const room of unreachable)issues.push(`${room.floor+1}层 ${room.key} 无法避开活动区接入公共网络`);
    return {revision:'stair-terminal-routing-v2',accepted:!issues.length,issues,unreachable,activities,routes,connections,floors:floorReports,
      publicTrafficArea:floorReports.reduce((s,f)=>s+f.publicTrafficArea,0),corridorArea:floorReports.reduce((s,f)=>s+f.corridorArea,0),
      meanRouteLength:routes.reduce((s,r)=>s+r.length,0)/Math.max(1,routes.length),maxRouteLength:Math.max(0,...routes.map(r=>r.length)),
      activityRules:ACTIVITY_RULES,evaluation:'adjustable-activity-envelope-and-grid-route-proxy; not verified furniture, doors or stair flights'};
  }
  const api={evaluate,ACTIVITY_RULES};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Organization=api;
})(globalThis);
