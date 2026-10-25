(function(root){
  'use strict';
  const Functional=typeof require==='function'?require('./functional-rules.js'):root.FunctionalRules;
  const Meal=typeof require==='function'?require('./meal-geometry.js'):root.MealGeometry;
  const Organization=typeof require==='function'?require('./organization.js'):root.Organization;
  const ENTRY_RULES=Object.freeze({revision:'entry-cap-v1',maxFloorFraction:.12,minCapArea:4.86,targetMultiplier:1.5});
  const BEDROOM_RULES=Object.freeze({minWidth:2.4,maxAspect:1.8,preferredAspect:1.5});
  const entryMaximum=(room,floorArea)=>Math.min(Math.max(ENTRY_RULES.minCapArea,room.preferredAreaMax||room.targetArea*ENTRY_RULES.targetMultiplier),Math.max(ENTRY_RULES.minCapArea,floorArea*ENTRY_RULES.maxFloorFraction));
  function bounds(room,floorArea){
    const entry=room.key==='entry'?entryMaximum(room,floorArea):Infinity;
    return {minimum:room.resourceMinArea??room.minArea,maximum:Math.min(room.resourceMaxArea??Infinity,entry),
      width:Math.max(room.minWidth,room.label===4?BEDROOM_RULES.minWidth:room.key==='entry'?1.2:0),aspect:room.label===4?BEDROOM_RULES.maxAspect:room.functionalMaxAspect??Infinity};
  }
  function rectangle(room,w,h,floorArea,{area=w*h*.09,activity=true}={}){
    const b=bounds(room,floorArea),rule=activity?Organization.ACTIVITY_RULES[room.label]:null;
    return w>0&&h>0&&area+1e-8>=b.minimum&&area<=b.maximum+1e-8&&Math.min(w,h)*.3+1e-8>=b.width&&
      Math.max(w,h)/Math.min(w,h)<=b.aspect+1e-8&&Functional.fits(room,w,h,area)&&Meal.fits(room,w,h,area)&&
      (!rule||(w>=rule.w&&h>=rule.h)||(w>=rule.h&&h>=rule.w));
  }
  function groups(program,areas){
    const groups=new Map();
    for(const r of program)if(r.resourceGroupKey){const key=r.floor+':'+r.resourceGroupKey,g=groups.get(key)||{area:0,maximum:r.resourceGroupMaxArea};g.area+=areas.get(r.key)||0;groups.set(key,g);}
    return [...groups.values()].every(g=>g.area<=g.maximum+1e-8);
  }
  const api={ENTRY_RULES,BEDROOM_RULES,entryMaximum,bounds,rectangle,groups};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PlanningRules=api;
})(globalThis);
