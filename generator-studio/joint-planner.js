(function(root){
  'use strict';
  const Rules=typeof require==='function'?require('./planning-rules.js'):root.PlanningRules;
  const Organization=typeof require==='function'?require('./organization.js'):root.Organization;
  const sum=xs=>xs.reduce((a,b)=>a+b,0);
  const keep=(list,item,n)=>{list.push(item);list.sort((a,b)=>a.score-b.score);if(list.length>n)list.pop();};
  const deviation=(r,area)=>Math.abs(area-r.targetArea)/Math.max(.09,r.targetArea);
  function plan(program,nx,ny,q,stairProfile){
    if(!program.length||program.some(r=>!Number.isFinite(r.resourceMaxArea)))return [];
    const fp=nx*ny*.09,main=[0,1].map(f=>program.find(r=>r.floor===f&&r.label===1)||program.find(r=>r.floor===f&&r.label===10));
    if(main.some(r=>!r))return [];
    const templates=[...new Map(stairProfile.observations.map(o=>[o.stair.slice(2).join(':'),o])).values()];
    const specs=[];
    for(const source of templates){const [left,sh]=source.stair.slice(2);
      for(let spine=8;spine<=14;spine++){
        const right=nx-left-spine,rule=Organization.ACTIVITY_RULES[main[0].label],short=Math.min(rule.w,rule.h),long=Math.max(rule.w,rule.h),branch=Math.max(0,short+q-spine);
        if(right-branch<5||left<8||ny-sh-q<8)continue;
        if(main.some((r,f)=>!Rules.rectangle(r,spine,f&&r.label===10?ny-sh-q:ny,fp)))continue;
        specs.push({left,sh,spine,right,branch,minimumTail:branch?long+q:0,source,
          score:sum(main.map(r=>deviation(r,spine*ny*.09)))+Math.abs(left-right)/nx});
      }
    }
    specs.sort((a,b)=>a.score-b.score);
    const packedCache=new Map();
    function pack(rooms,w,height,entryFirst,frontMin=0,lastHost=false,startsSouth=true){
      const key=JSON.stringify([rooms.map(r=>r.key),w,height,entryFirst,frontMin,lastHost,startsSouth]);
      if(packedCache.has(key))return packedCache.get(key);
      const all=(1<<rooms.length)-1;
      if(!rooms.length)return height===0?{score:0,rects:[]}:null;
      if(rooms.length>12)return null;
      const heights=rooms.map(r=>Array.from({length:height},(_,i)=>i+1).filter(h=>Rules.rectangle(r,w,h,fp)));
      if(heights.some(a=>!a.length))return null;
      const kitchen=rooms.findIndex(r=>r.label===3),dining=rooms.findIndex(r=>r.label===2),entry=rooms.findIndex(r=>r.key==='entry');
      let states=[{mask:0,y:0,score:0,rects:[]}];
      for(let depth=0;depth<rooms.length;depth++){
        const next=new Map();
        for(const state of states)for(let i=0;i<rooms.length;i++){
          if(startsSouth&&depth===0&&rooms[i].label===5)continue;
          if(state.mask&(1<<i)||entryFirst&&entry>=0&&depth===0&&i!==entry)continue;
          if(kitchen>=0&&dining>=0){
            if(i===dining&&!(state.mask&(1<<kitchen)))continue;
            if(state.mask&(1<<kitchen)&&!(state.mask&(1<<dining))&&i!==dining)continue;
          }
          for(const h of heights[i]){
            if(depth===0&&h<frontMin||depth===rooms.length-1&&lastHost&&![1,2,4,10].includes(rooms[i].label))continue;
            const y=state.y+h,mask=state.mask|(1<<i);if(y>height||mask===all&&y!==height)continue;
            const remaining=rooms.map((_,j)=>j).filter(j=>!(mask&(1<<j)));
            if(y+sum(remaining.map(j=>heights[j][0]))>height||y+sum(remaining.map(j=>heights[j].at(-1)))<height)continue;
            const proposal={mask,y,score:state.score+deviation(rooms[i],w*h*.09)+(startsSouth&&depth===0&&rooms[i].label===8?12:0),rects:[...state.rects,{room:rooms[i],y:state.y,w,h}]};
            const k=mask+':'+y;if(!next.has(k)||proposal.score<next.get(k).score)next.set(k,proposal);
          }
        }
        states=[...next.values()].sort((a,b)=>a.score-b.score).slice(0,128);
        if(!states.length)break;
      }
      const result=states.find(s=>s.mask===all&&s.y===height)||null;
      packedCache.set(key,result);return result;
    }
    function upperWithoutLiving(spec){
      const {left,sh,spine,right}=spec,arrival=ny-sh-q;
      const others=program.filter(r=>r.floor===1&&r!==main[1]),plans=[];
      for(const cap of others.filter(r=>[9,4].includes(r.label)))for(let h=3;h<=sh;h++){
        if(!Rules.rectangle(cap,spine+right,h,fp)||sh+q-h<q)continue;
        const corridorArea=(left*q+spine*(sh+q-h))*.09;
        const traffic=typeof require==='function'?require('./circulation.js'):root.CirculationRules;
        const size=fp<120?'small':fp>180?'large':'medium',stats=traffic.profile().profiles['1:'+size]||traffic.profile().profiles['1:all'];
        if(corridorArea>stats.metrics.areaFraction.p75*fp+1e-8)continue;
        const rest=others.filter(r=>r!==cap);
        // The front activity is a terminal use; both front rooms extend past it.
        const front=Math.min(Organization.ACTIVITY_RULES[10].w,Organization.ACTIVITY_RULES[10].h)+3;
        const count=Math.min(1<<rest.length,4096);
        for(let mask=1;mask<count-1;mask++){
          const a=rest.filter((_,i)=>mask&(1<<i)),b=rest.filter((_,i)=>!(mask&(1<<i)));
          const pa=pack(a,left,arrival,false,front),pb=pack(b,right,ny-h,false,front,cap.label===9);
          if(!pa||!pb)continue;
          const hall={key:'1:joint-hall',label:6,floor:1,generated:true};
          const rects=[{room:main[1],x:left,y:0,w:spine,h:arrival},{room:hall,x:left,y:arrival,w:spine,h:ny-h-arrival},
            {room:cap,x:left,y:ny-h,w:spine+right,h},...pa.rects.map(r=>({...r,x:0})),...pb.rects.map(r=>({...r,x:left+spine}))];
          keep(plans,{rects,score:pa.score+pb.score+deviation(cap,(spine+right)*h*.09)+deviation(main[1],spine*arrival*.09)},4);
        }
      }
      return plans;
    }
    function floorPlans(floor,spec){
      if(floor===1&&main[1].label===10)return upperWithoutLiving(spec);
      const {left,sh,spine,right,branch,minimumTail}=spec,leftHeight=ny-sh-(floor?q:0),others=program.filter(r=>r.floor===floor&&r!==main[floor]);
      const assignments=[];
      // Assignment beam depends on the requested functions, never fixed room keys.
      let beam=[{groups:[[],[],[]],targets:[0,0,0]}];
      const expected=[left*leftHeight*.09,right*(ny-minimumTail)*.09,(right-branch)*minimumTail*.09];
      for(const room of [...others].sort((a,b)=>Number(b.key==='entry')-Number(a.key==='entry')||b.targetArea-a.targetArea)){
        const next=[];
        for(const state of beam)for(let group=0;group<3;group++){
          if(room.key==='entry'&&group!==1||floor===0&&[2,3].includes(room.label)&&group!==0||!branch&&group===2)continue;
          const groups=state.groups.map(a=>[...a]);groups[group].push(room);const targets=[...state.targets];targets[group]+=room.targetArea;
          const score=sum(targets.map((a,i)=>Math.max(0,a-expected[i])/Math.max(1,expected[i])));
          next.push({groups,targets,score});
        }
        beam=next.sort((a,b)=>a.score-b.score).slice(0,512);
      }
      const feasible=(rooms,w,h)=>rooms.length&&sum(rooms.map(r=>Rules.bounds(r,fp).minimum))<=w*h*.09+1e-8&&sum(rooms.map(r=>Rules.bounds(r,fp).maximum))+1e-8>=w*h*.09;
      for(const state of beam){const [a,b,c]=state.groups;
        if(!feasible(a,left,leftHeight))continue;
        for(let tail=minimumTail;tail<ny;tail++){
          if(!branch&&tail>0)break;
          if(!feasible(b,right,ny-tail)||branch&&!feasible(c,right-branch,tail))continue;
          const area=(spine*ny+branch*tail)*.09;
          if(!Rules.rectangle(main[floor],spine+branch,ny,fp,{area,activity:false}))continue;
          keep(assignments,{groups:state.groups,tail,score:sum([left*leftHeight*.09,right*(ny-tail)*.09,(right-branch)*tail*.09].map((a,i)=>Math.abs(a-state.targets[i])/Math.max(1,a)))+deviation(main[floor],area)},32);
        }
      }
      const plans=[];
      for(const assignment of assignments){const [a,b,c]=assignment.groups;
        const pa=pack(a,left,leftHeight,false),pb=pack(b,right,ny-assignment.tail,floor===0),pc=branch?pack(c,right-branch,assignment.tail,false,0,false,false):{rects:[],score:0};
        if(!pa||!pb||!pc)continue;
        const rects=[{room:main[floor],x:left,y:0,w:spine,h:ny},
          ...pa.rects.map(r=>({...r,x:0})),...pb.rects.map(r=>({...r,x:left+spine})),...pc.rects.map(r=>({...r,x:left+spine+branch,y:r.y+ny-assignment.tail}))];
        if(branch)rects.push({room:main[floor],x:left+spine,y:ny-assignment.tail,w:branch,h:assignment.tail});
        const areas=new Map();for(const r of rects)areas.set(r.room.key,(areas.get(r.room.key)||0)+r.w*r.h*.09);
        if(!Rules.groups(program.filter(r=>r.floor===floor),areas))continue;
        keep(plans,{rects,score:pa.score+pb.score+pc.score+deviation(main[floor],areas.get(main[floor].key))},4);
      }
      return plans;
    }
    const plans=[];
    for(const spec of specs.slice(0,48)){
      const lower=floorPlans(0,spec);if(!lower.length)continue;
      const upper=floorPlans(1,spec);if(!upper.length)continue;
      for(const a of lower)for(const b of upper)keep(plans,{spec,floors:[a.rects,b.rects],main:main.map(r=>r.key),score:a.score+b.score},64);
    }
    return plans;
  }
  const api={plan};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.JointPlanner=api;
})(globalThis);
