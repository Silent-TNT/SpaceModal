(function(root){
  'use strict';
  const RULES=Object.freeze({revision:'meal-joint-v1',minKitchenWidth:2.1,maxKitchenAspect:2.5,maxDiningAspect:2.5,preferredKitchenWidth:2.4,preferredAspect:1.8,maxCombinedFraction:.28});
  function maxArea(room){return Math.max(room.minArea,room.targetArea*1.5,(room.preferredAreaMax||room.targetArea)*1.25);}
  function fits(room,w,h,area=w*h*.09){
    if(![2,3].includes(room.label))return true;
    return area<=maxArea(room)+1e-8&&Math.max(w,h)/Math.min(w,h)<=2.5+1e-8&&(room.label!==3||Math.min(w,h)*.3>=RULES.minKitchenWidth-1e-8);
  }
  function evaluate(candidate){
    const maps=candidate.owners||candidate.floorSpaces,reports=[],issues=[];let penalty=0;
    for(let floor=0;floor<maps.length;floor++){
      const map=maps[floor],stats=label=>candidate.spaces.filter(s=>s.label===label).flatMap(s=>{
        const cells=Array.from(map).flatMap((sid,i)=>sid===s.id?[i]:[]);if(!cells.length)return [];
        const xs=cells.map(i=>i%candidate.nx),ys=cells.map(i=>Math.floor(i/candidate.nx)),w=Math.max(...xs)-Math.min(...xs)+1,h=Math.max(...ys)-Math.min(...ys)+1;
        return [{space:s,cells,w,h,positionMm:[Math.min(...xs)*300,Math.min(...ys)*300],area:cells.length*.09,shortSide:Math.min(w,h)*.3,longSide:Math.max(w,h)*.3,aspect:Math.max(w,h)/Math.min(w,h),facade:cells.some(i=>i%candidate.nx===0||i%candidate.nx===candidate.nx-1||i<candidate.nx||i>=map.length-candidate.nx)}];
      });
      const kitchens=stats(3),dinings=stats(2),livings=new Set(candidate.spaces.filter(s=>s.label===1).map(s=>s.id));
      const neighbors=i=>[i%candidate.nx?i-1:-1,i%candidate.nx<candidate.nx-1?i+1:-1,i>=candidate.nx?i-candidate.nx:-1,i+candidate.nx<map.length?i+candidate.nx:-1].filter(j=>j>=0);
      for(const k of kitchens){
        if(!dinings.length)continue;
        const boundary=d=>k.cells.reduce((sum,i)=>sum+neighbors(i).filter(j=>map[j]===d.space.id).length,0)*.3;
        const d=[...dinings].sort((a,b)=>boundary(b)-boundary(a)||b.area-a.area)[0];
        const combinedFraction=(k.area+d.area)/(map.length*.09),ratio=k.area/d.area,contactLength=boundary(d),diningLivingContact=d.cells.some(i=>neighbors(i).some(j=>livings.has(map[j])));
        const ratioPenalty=Math.max(0,.5-ratio,ratio-1.12)*10;
        penalty+=Math.max(0,k.aspect-1.8)*8+Math.max(0,d.aspect-1.8)*4+Math.max(0,2.4-k.shortSide)*8+ratioPenalty+(k.facade?0:5)+(contactLength?0:10)+(diningLivingContact?0:3)+Math.max(0,combinedFraction-.22)*60;
        if(!fits(k.space,k.w,k.h,k.area))issues.push('厨房尺寸、长宽比或面积超过餐厨生成范围');
        if(!fits(d.space,d.w,d.h,d.area))issues.push('餐厅长宽比或面积超过餐厨生成范围');
        if(combinedFraction>RULES.maxCombinedFraction+1e-8)issues.push('餐厨合计面积超过本层28%');
        reports.push({floor,kitchenId:k.space.id,diningId:d.space.id,kitchen:{positionMm:k.positionMm,area:k.area,shortSide:k.shortSide,longSide:k.longSide,aspect:k.aspect,maxArea:maxArea(k.space),facade:k.facade},dining:{positionMm:d.positionMm,area:d.area,shortSide:d.shortSide,longSide:d.longSide,aspect:d.aspect,maxArea:maxArea(d.space)},areaRatio:ratio,combinedFraction,contactLength,diningLivingContact});
      }
    }
    return {revision:RULES.revision,accepted:!issues.length,issues,reports,penalty,evaluation:'Envelope dimensions and geometric contact; not net dimensions, verified exterior walls or walking routes.'};
  }
  const api={RULES,maxArea,fits,evaluate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MealGeometry=api;
})(globalThis);
