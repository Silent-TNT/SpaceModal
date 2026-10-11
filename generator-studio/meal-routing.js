(function(root){
  'use strict';
  const PUBLIC=new Set([0,1,2,6,10]);
  // Distances are portal-to-portal grid estimates, not verified walking routes.
  function evaluate(candidate,connections){
    const spaces=candidate.spaces,reports=[],issues=[];
    const maps=candidate.owners||candidate.floorSpaces;
    for(let floor=0;floor<2;floor++){
      const map=maps[floor],kitchens=spaces.filter(s=>s.label===3&&map.includes(s.id)),dining=new Set(spaces.filter(s=>s.label===2&&map.includes(s.id)).map(s=>s.id));
      for(const kitchen of kitchens){
        if(!dining.size){reports.push({floor,kitchenId:kitchen.id,status:'no-same-floor-dining',penalty:0});continue;}
        const edges=connections.filter(e=>e.floor===floor&&
          (e.a===kitchen.id||PUBLIC.has(spaces[e.a]?.label))&&
          (e.b===kitchen.id||PUBLIC.has(spaces[e.b]?.label)));
        const queue=[{sid:kitchen.id,edge:-1,cost:0,length:0,chain:[kitchen.id]}],best=new Map();let selected=null;
        while(queue.length){
          queue.sort((a,b)=>b.cost-a.cost);const state=queue.pop(),key=state.sid+':'+state.edge;
          if(best.has(key)&&best.get(key)<state.cost)continue;
          if(dining.has(state.sid)){selected=state;break;}
          for(let i=0;i<edges.length;i++){
            const e=edges[i];if(e.a!==state.sid&&e.b!==state.sid)continue;
            const next=e.a===state.sid?e.b:e.a;if(state.chain.includes(next))continue;
            const previous=state.edge<0?null:edges[state.edge];
            const distance=previous?(Math.abs(e.x-previous.x)+Math.abs(e.y-previous.y))*.3:0;
            const length=state.length+distance,cost=length*.7+(state.chain.length-1)*1.2;
            const nextKey=next+':'+i;if(best.has(nextKey)&&best.get(nextKey)<=cost)continue;
            best.set(nextKey,cost);queue.push({sid:next,edge:i,cost,length,chain:[...state.chain,next]});
          }
        }
        if(!selected){issues.push(`${floor+1}层 ${kitchen.key} 与餐厅缺少不穿越楼梯或独立房间的公共联系`);reports.push({floor,kitchenId:kitchen.id,status:'unreachable',penalty:0});continue;}
        const direct=selected.chain.length===2;
        if(candidate.mealPolicy&&!direct&&(selected.chain.length!==3||spaces[selected.chain[1]]?.label!==6||selected.length>3.6+1e-8))issues.push(`${floor+1}层餐厨应直接连接，或仅经过一段不超过3.6 m估算长度的公共走廊`);
        reports.push({floor,kitchenId:kitchen.id,diningId:selected.sid,status:direct?'direct':'public-route',chain:selected.chain,
          types:selected.chain.map(id=>spaces[id].label),lengthEstimate:selected.length,penalty:direct?0:3+selected.cost});
      }
    }
    return {revision:'meal-public-route-v1',accepted:!issues.length,issues,reports,penalty:reports.reduce((sum,r)=>sum+r.penalty,0),
      evaluation:'same-floor planned portals; direct preferred; public-only intermediate rooms; length is a Manhattan estimate, not verified doors or walking distance'};
  }
  const api={evaluate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MealRouting=api;
})(globalThis);
