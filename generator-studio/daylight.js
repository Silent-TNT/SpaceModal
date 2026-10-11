(function(root){
  'use strict';
  // Concept-stage frontage allowance, not a code or measured daylight threshold.
  const RULES=Object.freeze({revision:'tiered-facade-v2',minContinuousFrontage:1.2,serviceMinContinuousFrontage:.6});
  const PRIMARY_LABELS=Object.freeze([1,2,3,4,10]),SERVICE_LABELS=Object.freeze([5,8]);
  function requiredFrontage(label){return PRIMARY_LABELS.includes(label)?RULES.minContinuousFrontage:SERVICE_LABELS.includes(label)?RULES.serviceMinContinuousFrontage:0;}
  function longest(values){let best=0,run=0,previous=-2;for(const n of [...new Set(values)].sort((a,b)=>a-b)){run=n===previous+1?run+1:1;best=Math.max(best,run);previous=n;}return best;}
  function evaluate(model){
    const maps=model.owners||model.floorSpaces,cell=(model.cell||300)/1000,reports=[],issues=[];
    for(let floor=0;floor<maps.length;floor++){
      const map=maps[floor],nx=model.nx,ny=map.length/nx,stats=new Map();
      for(let i=0;i<map.length;i++){
        const sid=map[i];if(!stats.has(sid))stats.set(sid,{cells:[],sides:{W:[],E:[],S:[],N:[]}});
        const a=stats.get(sid),x=i%nx,y=Math.floor(i/nx);a.cells.push(i);
        if(x===0)a.sides.W.push(y);if(x===nx-1)a.sides.E.push(y);if(y===0)a.sides.S.push(x);if(y===ny-1)a.sides.N.push(x);
      }
      const facade=a=>Object.fromEntries(Object.entries(a.sides).map(([side,values])=>[side,{length:values.length*cell,continuous:longest(values)*cell}]));
      const sufficient=(faces,minimum)=>Object.values(faces).some(face=>face.continuous+1e-8>=minimum);
      for(const room of model.spaces.filter(s=>requiredFrontage(s.label)>0)){
        const a=stats.get(room.id);if(!a)continue;
        const minimum=requiredFrontage(room.label),service=SERVICE_LABELS.includes(room.label),faces=facade(a),contacts=new Map();
        for(const i of a.cells){const x=i%nx,y=Math.floor(i/nx);for(const [j,side,position] of [[x?i-1:-1,'W',y],[x<nx-1?i+1:-1,'E',y],[y?i-nx:-1,'S',x],[y<ny-1?i+nx:-1,'N',x]]){
          const sid=map[j];if(j<0||model.spaces[sid]?.label!==9)continue;
          if(!contacts.has(sid))contacts.set(sid,{W:[],E:[],S:[],N:[]});contacts.get(sid)[side].push(position);
        }}
        const balconies=[...contacts].map(([sid,sides])=>({spaceId:sid,key:model.spaces[sid].key,
          sharedContinuousFrontage:Math.max(...Object.values(sides).map(longest))*cell,exterior:facade(stats.get(sid))}));
        const direct=sufficient(faces,minimum),viaBalcony=service?[]:balconies.filter(b=>b.sharedContinuousFrontage+1e-8>=minimum&&sufficient(b.exterior,minimum));
        const accepted=direct||viaBalcony.length>0;
        reports.push({floor,spaceId:room.id,key:room.key,accepted,minimumContinuousFrontage:minimum,tier:service?'service':'primary',source:direct?'direct-envelope':viaBalcony.length?'via-balcony':'none',facades:faces,balconies,qualifyingBalconies:viaBalcony.map(b=>b.key),windowVerified:false});
        if(!accepted)issues.push(`${room.key}缺少至少${minimum} m连续外墙${service?'':'或经阳台的'}采光位置`);
      }
    }
    return {revision:RULES.revision,accepted:!issues.length,issues,reports,minimumContinuousFrontage:RULES.minContinuousFrontage,serviceMinimumContinuousFrontage:RULES.serviceMinContinuousFrontage,evaluation:'rectangular-envelope-and-balcony-contact',orientationConvention:'+Y north; site orientation unverified',windowVerified:false};
  }
  const api={RULES,requiredFrontage,evaluate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BedroomDaylight=api;
})(globalThis);
