(function(root){
  'use strict';
  const sigmoid=x=>1/(1+Math.exp(-x)),silu=x=>x*sigmoid(x),sum=xs=>xs.reduce((a,b)=>a+b,0);
  class JointAreaModel {
    constructor(payload){if(payload?.schema!=='joint_area_model_v1')throw Error('联合面积模型格式无效');this.meta=payload;this.weights=payload.weights;}
    linear(row,name){const w=this.weights[name+'.weight'],b=this.weights[name+'.bias'].data;return b.map((v,i)=>{for(let j=0;j<row.length;j++)v+=w.data[i*row.length+j]*row[j];return v;});}
    norm(row,name){const mean=sum(row)/row.length,v=sum(row.map(x=>(x-mean)**2))/row.length;return row.map((x,i)=>(x-mean)/Math.sqrt(v+1e-5)*this.weights[name+'.weight'].data[i]+this.weights[name+'.bias'].data[i]);}
    predict(program,length,width){
      if(!program.length||program.some(r=>![0,1].includes(r.floor)||!Number.isInteger(r.label)||r.label<0||r.label>10)||![length,width].every(n=>Number.isFinite(n)&&n>0))throw Error('联合面积输入无效');
      const counts=[0,1].map(f=>program.filter(r=>r.floor===f).length),boundary=[length/18000,width/18000];
      let h=program.map(r=>this.linear([...Array.from({length:11},(_,i)=>+(r.label===i)),+(r.floor===0),+(r.floor===1),...boundary,program.filter(s=>s.floor===r.floor&&s.label===r.label).length/8,counts[r.floor]/20,program.length/40],'room').map(silu));
      let house=this.linear(boundary,'house').map(silu),floors=[0,1].map(f=>this.linear([...boundary,f],'floor').map(silu));
      for(let k=0;k<2;k++){
        const pool=[0,1].map(f=>Array.from({length:48},(_,j)=>sum(h.map((row,i)=>program[i].floor===f?row[j]:0))/Math.max(1,counts[f])));
        const hm=this.linear(house,'house_to_floor.'+k);
        floors=floors.map((row,f)=>{const m=this.linear(pool[f],'room_to_floor.'+k);return row.map((v,j)=>silu(v+m[j]+hm[j]));});
        const fm=this.linear(floors[0].map((v,j)=>(v+floors[1][j])/2),'floor_to_house.'+k);
        house=house.map((v,j)=>silu(v+fm[j]));
        const incoming=floors.map(row=>this.linear(row,'floor_to_room.'+k));
        h=h.map((row,i)=>this.norm(row.map((v,j)=>v+incoming[program[i].floor][j]),'norm.'+k));
      }
      return {fractions:h.map(row=>.6*sigmoid(this.linear(row,'head')[0])),coverage:floors.map(row=>sigmoid(this.linear(row,'coverage')[0]))};
    }
  }
  // Water filling with lower/upper bounds. The full floor shares a single multiplier;
  // saturation of one function automatically redistributes resources to the others.
  function project(desired,lower,upper,total){
    if(!desired.length||desired.length!==lower.length||lower.length!==upper.length||![...desired,...lower,...upper,total].every(Number.isFinite)||desired.some(x=>x<0)||lower.some((x,i)=>x<0||x>upper[i]))throw Error('面积预算参数无效');
    const minimum=sum(lower),maximum=sum(upper);
    if(total<minimum-1e-7||total>maximum+1e-7){const e=Error(total<minimum?'功能最低面积超过可用面积':'空间富余超过全部功能的合理容量，请增加功能、调整楼层安排或缩小包络');e.code='AREA_PROGRAM_MISMATCH';e.details={available:total,minimum,maximum,unallocated:Math.max(0,total-maximum)};throw e;}
    const weights=desired.map((a,i)=>Math.max(.09,a-lower[i]));
    let lo=0,hi=Math.max(1,...upper.map((a,i)=>(a-lower[i])/weights[i]));
    for(let k=0;k<80;k++){const mid=(lo+hi)/2,area=sum(lower.map((a,i)=>Math.min(upper[i],a+mid*weights[i])));if(area<total)lo=mid;else hi=mid;}
    return lower.map((a,i)=>Math.min(upper[i],a+(lo+hi)/2*weights[i]));
  }
  function allocate(program,model,length,width,profile,options={}){
    const fp=length*width/1e6;
    if(model.meta.source_sha256!==profile.source_sha256)throw Error('联合面积模型与几何统计来源不一致');
    const query=[...program,...[0,1].flatMap(floor=>[{key:'budget-stairs-'+floor,label:7,floor},{key:'budget-corridor-'+floor,label:6,floor}])];
    const forecast=model.predict(query,length,width),rooms=program.map((r,i)=>{
      const stats=model.meta.bounds[`${r.floor}:${r.label}`];if(!stats)throw Error('缺少功能容量统计');
      const predicted=forecast.fractions[i]*fp;
      // These are engineering comfort ceilings derived exclusively from training.
      // Neither the predicted annotation coverage nor missing labels become living area.
      let maximum=Math.max(r.minArea,Math.min(stats.area_p95*1.35,stats.fraction_p95*fp*1.35));
      // A complete-edge bedroom resize is discrete: at 300 mm resolution a
      // single strip can span its full long side. Allow one such rounding strip,
      // bounded by the existing 1.8 aspect rule, rather than producing thin slivers.
      if(r.label===4)maximum+=.3*Math.sqrt(maximum*1.8);
      if(r.key==='entry')maximum=Math.min(maximum,Math.max(12,fp*.12));
      if(r.label===5||r.label===8)maximum=Math.min(maximum,r.label===5?16:14);
      const explicit=options.areas?.[r.key];
      if(explicit!==undefined&&(!Number.isFinite(explicit)||explicit<r.minArea||explicit>maximum))throw Error(r.key+'指定面积超出可行容量');
      const groupKey=[2,3].includes(r.label)?'meal':r.floor===1&&[1,10].includes(r.label)?'upper-public':null;
      return {...r,placementTargetArea:r.targetArea,placementPreferredAreaMin:r.preferredAreaMin,placementPreferredAreaMax:r.preferredAreaMax,predictedArea:predicted,resourceMinArea:explicit??r.minArea,resourceMaxArea:explicit??Math.floor((maximum+1e-8)/.09)*.09,resourceGroupKey:groupKey,resourceGroupMaxArea:groupKey==='meal'?fp*.28:groupKey==='upper-public'?fp*.4:undefined,areaBudgetRevision:'joint-area-v1'};
    });
    const floors=[0,1].map(floor=>{
      const indices=rooms.flatMap((r,i)=>r.floor===floor?[i]:[]),rs=indices.map(i=>rooms[i]);
      const stair=options.stairArea??Math.max(3.24,profile.floor_reserved_fractions[`${floor+1}:stairs`].median*fp);
      const passage=options.corridorAreas?.[floor]??Math.max(floor===1?4.32:0,profile.floor_reserved_fractions[`${floor+1}:corridor`].median*fp);
      const available=fp-stair-passage;
      let targets;
      try{
        const groups=[];
        for(const r of rs){const key=[2,3].includes(r.label)?'meal':floor===1&&[1,10].includes(r.label)?'upper-public':r.key;let g=groups.find(g=>g.key===key);if(!g){g={key,rooms:[]};groups.push(g);}g.rooms.push(r);}
        const lower=groups.map(g=>sum(g.rooms.map(r=>r.resourceMinArea))),upper=groups.map(g=>Math.min(sum(g.rooms.map(r=>r.resourceMaxArea)),g.key==='meal'?fp*.28:g.key==='upper-public'?fp*.4:Infinity));
        const groupTargets=project(groups.map(g=>sum(g.rooms.map(r=>Math.max(r.resourceMinArea,r.predictedArea)))),lower,upper,available);
        const byKey={};groups.forEach((g,i)=>{const assigned=project(g.rooms.map(r=>Math.max(r.resourceMinArea,r.predictedArea)),g.rooms.map(r=>r.resourceMinArea),g.rooms.map(r=>r.resourceMaxArea),groupTargets[i]);g.rooms.forEach((r,j)=>{byKey[r.key]=assigned[j];});});targets=rs.map(r=>byKey[r.key]);
      }
      catch(e){e.message=`${floor+1}层：${e.message}（可分配${available.toFixed(1)}㎡，功能容量${(e.details?.maximum??sum(rs.map(r=>r.resourceMaxArea))).toFixed(1)}㎡）`;e.details={floor,...e.details};throw e;}
      for(let j=0;j<rs.length;j++)Object.assign(rs[j],{targetArea:targets[j],preferredAreaMin:Math.max(rs[j].minArea,targets[j]*.85),preferredAreaMax:Math.min(rs[j].resourceMaxArea,targets[j]*1.15),resourceFloorAvailable:available,resourceReservedArea:stair+passage});
      return {floor,footprint:fp,stairArea:stair,passageArea:passage,available,totalTarget:sum(targets),capacity:sum(rs.map(r=>r.resourceMaxArea)),predictedAnnotationCoverage:forecast.coverage[floor],coverageMeaning:'annotation coverage only; not buildable footprint'};
    });
    return {program:rooms,budget:{revision:'joint-area-v1',checkpointSha256:model.meta.checkpoint_sha256,floors,policy:'joint predictions + bounded allocation; actual staircase/passage geometry validated separately'}};
  }
  const api={JointAreaModel,project,allocate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.JointArea=api;
})(globalThis);
