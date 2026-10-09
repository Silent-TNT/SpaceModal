(function(root){
 'use strict';
 const base=SpatialRender.geometry;
 SpatialRender.geometry=function(model){const data=base(model);data.review.mode='topology_voxel_experiment';data.undefined_reserve_regions=[];for(let f=0;f<2;f++)for(const r of SpatialRender.rects(model,f,-1))data.undefined_reserve_regions.push({floor:f+1,box_min:[r.x*300,r.y*300,f*3000],box_max:[(r.x+r.w)*300,(r.y+r.h)*300,(f+1)*3000]});data.target_topology=model.targetTopology;data.actual_topology=model.actualTopology;return data;};
 function graph(plan,actual){
  const nodes=plan.rooms.map((r,i)=>({...r,x:180+Math.cos(i/plan.rooms.length*Math.PI*2)*130,y:190+Math.sin(i/plan.rooms.length*Math.PI*2)*130})),byKey=new Map(nodes.map(n=>[n.key,n]));let out='<svg class="topology-svg" viewBox="0 0 360 430"><text x="180" y="18" text-anchor="middle" font-size="13">目标关系与实际几何贴邻</text>';
  for(const e of plan.edges){const a=byKey.get(e.a),b=byKey.get(e.b),realized=actual?.includes([e.a,e.b].sort().join('|'));out+=`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${actual?(realized?'#3a8154':'#c27648'):'#738578'}" stroke-width="${e.kind==='required_contact'?2:1}" stroke-dasharray="${e.kind==='required_contact'?'':'4 4'}"/>`;}
  for(const n of nodes)out+=`<circle cx="${n.x}" cy="${n.y}" r="17" fill="${SpatialRender.LABELS[Design.TYPES.indexOf(n.type)][1]}"/><text x="${n.x}" y="${n.y+3}" text-anchor="middle" font-size="8">${SpatialRender.LABELS[Design.TYPES.indexOf(n.type)][0]}</text><text x="${n.x}" y="${n.y+28}" text-anchor="middle" font-size="8">${n.type==='stairs'?'1–2F':n.floor+'F'} ${SpatialRender.escape(n.key)}</text>`;
  return out+'<text x="180" y="375" text-anchor="middle" font-size="9">实线：必需贴邻；虚线：偏好</text><text x="180" y="394" text-anchor="middle" font-size="9">生成后绿色为已实现，橙色为未实现；不代表门或通行。</text></svg>';
 }
 root.LabRender={graph};
})(globalThis);
