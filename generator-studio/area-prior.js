(function(root){
  'use strict';
  const Functional=typeof require==='function'?require('./functional-rules.js'):root.FunctionalRules;
  const TYPES=['entryway','living_room','dining_room','kitchen','bedroom','bathroom','corridor','stairs','utility','balcony','multi_purpose'];
  function apply(program,profile,floorArea,dimensions={}){
    if(profile?.schema!=='training_area_prior_v1'||profile.training_case_count<1||!Number.isFinite(floorArea)||floorArea<=0)throw Error('面积统计配置无效');
    const result=program.map(room=>{
      const key=`${room.floor+1}:${TYPES[room.label]}`,overall=profile.categories[key];
      const count=program.filter(r=>r.floor===room.floor&&r.label===room.label).length,number=count<3?String(count):count<5?'3-4':'5+';
      const size=floorArea<profile.conditioning?.footprint_p25?'small':floorArea>profile.conditioning?.footprint_p75?'large':'medium';
      const aspect=dimensions.length&&dimensions.width?Math.max(dimensions.length,dimensions.width)/Math.min(dimensions.length,dimensions.width):null;
      const shape=aspect===null?'*':aspect>=1.4?'elongated':'compact';
      const contexts=[`${size}|${shape}|${number}`,`${size}|*|${number}`,`${size}|*|*`];
      const used=contexts.find(context=>{
        const stats=profile.conditioning?.profiles[`${context}|${key}`];
        return stats&&stats.count>=profile.conditioning.minimum_instances&&stats.house_count>=profile.conditioning.minimum_houses;
      });
      const conditional=used?profile.conditioning.profiles[`${used}|${key}`]:null,stats=conditional||overall;
      if(!stats||stats.count<10||![stats.fraction.p25,stats.fraction.median,stats.fraction.p75].every(v=>Number.isFinite(v)&&v>0))throw Error('缺少有效面积统计：'+key);
      return {...room,targetArea:Math.max(room.minArea,stats.fraction.median*floorArea),
        preferredAreaMin:Math.max(room.minArea,stats.fraction.p25*floorArea),preferredAreaMax:Math.max(room.minArea,stats.fraction.p75*floorArea),
        areaSource:{category:key,count:stats.count,houseCount:stats.house_count,sourceSha256:profile.source_sha256,conditioning:used||'overall',requestedConditioning:contexts[0],conditioningFallback:used!==contexts[0]},
        datasetMedianArea:stats.area.median,corridorLimitFraction:profile.floor_reserved_fractions[`${room.floor+1}:corridor`].p75,
        ...(room.label===9?{balconyContactCounts:profile.balcony_statistics?.by_floor[String(room.floor+1)]?.contact_counts}:{})};
    });
    for(let floor=0;floor<2;floor++){
      const rooms=result.filter(r=>r.floor===floor),total=rooms.reduce((s,r)=>s+r.targetArea,0),minimum=rooms.reduce((s,r)=>s+r.minArea,0);
      const reserved=['stairs','corridor'].reduce((s,t)=>s+(profile.floor_reserved_fractions[`${floor+1}:${t}`]?.median||0),0);
      const available=Math.max(minimum,floorArea*(1-Math.min(.5,reserved)));
      if(total>available&&total>minimum){const factor=Math.max(0,(available-minimum)/(total-minimum));
        for(const room of rooms){for(const key of ['targetArea','preferredAreaMin','preferredAreaMax'])room[key]=room.minArea+(room[key]-room.minArea)*factor;room.capacityAdjusted=true;}
      }
    }
    return Functional.apply(result,floorArea);
  }
  function balconyCounts(conditions,profile){
    return [0,1].map(f=>{
      const value=conditions[`balconies${f}`]??-1;
      if(!Number.isInteger(value)||value < -1||value>4)throw Error('每层阳台数量须为0–4，-1表示采用统计默认值');
      if(value>=0)return value;
      const median=profile.balcony_statistics?.by_floor[String(f+1)]?.median_count;
      if(!Number.isFinite(median))throw Error('缺少阳台数量统计');
      return Math.min(4,Math.max(0,Math.round(median)));
    });
  }
  const api={apply,balconyCounts};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AreaPrior=api;
})(globalThis);
