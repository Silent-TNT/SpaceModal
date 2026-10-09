(function(root){
 'use strict';
 const TYPES=['entryway','living_room','dining_room','kitchen','bedroom','bathroom','corridor','stairs','utility','balcony','multi_purpose'];
 const WIDTH=[1.8,3.6,2.7,2.4,2.7,1.5,1.2,2.4,1.8,1.5,2.7];
 const AREA=[3.24,12.96,8.1,5.76,9,3,1.44,5.76,3.24,2.25,8.1];
 function validate(plan,conditions){
  if(!plan||typeof plan.name!=='string'||plan.name.length>80||!Array.isArray(plan.rooms)||plan.rooms.length<6||plan.rooms.length>30)throw Error('设计策略格式无效');
  if(!Number.isFinite(plan.reserveFraction)||plan.reserveFraction<0||plan.reserveFraction>.35)throw Error('保留空间比例须为0–35%');
  const keys=new Set();
  if(!['central','edge','split'].includes(plan.mode))throw Error('未知的空间组织模式');
  for(const room of plan.rooms){
   if(typeof room.key!=='string'||!/^[-_a-z0-9]{1,40}$/.test(room.key)||keys.has(room.key)||!TYPES.includes(room.type)||![1,2].includes(room.floor)||!Number.isFinite(room.area)||room.area<=0||room.area>conditions.length*conditions.width/1e6)throw Error('房间实例、楼层或面积无效');
   keys.add(room.key);
  }
  for(const type of ['entryway','living_room','dining_room','bedroom','bathroom','stairs'])if(!plan.rooms.some(r=>r.type===type))throw Error('策略缺少必需功能：'+type);
  if(plan.rooms.filter(r=>r.type==='stairs').length!==1||plan.rooms.find(r=>r.type==='stairs').key!=='stairs')throw Error('当前试验需要一个贯通两层的 stairs 实例');
  if(plan.rooms.find(r=>r.type==='stairs').floor!==1)throw Error('贯通楼梯以一层实例记录');
  if(plan.rooms.some(r=>r.type==='entryway'&&r.floor!==1))throw Error('玄关需要位于一层');
  for(const [type,key] of [['bedroom','bedrooms'],['bathroom','bathrooms']])if(plan.rooms.filter(r=>r.type===type).length!==conditions[key])throw Error('策略改变了用户确认的房间数量');
  for(const [type,count] of Object.entries(plan.requirements?.counts||{}))if(!TYPES.includes(type)||!Number.isInteger(count)||count<0||count>8||plan.rooms.filter(r=>r.type===type).length!==count)throw Error('策略改变了明确指定的功能数量：'+type);
  if(!Array.isArray(plan.edges)||plan.edges.length>100)throw Error('目标关系格式无效');
  for(const e of plan.edges){if(!keys.has(e.a)||!keys.has(e.b)||e.a===e.b||!['required_contact','preferred_contact'].includes(e.kind))throw Error('目标关系包含未知实例或无效类型');const a=plan.rooms.find(r=>r.key===e.a),b=plan.rooms.find(r=>r.key===e.b);if(a.type!=='stairs'&&b.type!=='stairs'&&a.floor!==b.floor)throw Error('普通房间不能跨楼层贴邻');}
  const reached=new Set(['stairs']);for(let i=0;i<plan.rooms.length;i++)for(const e of plan.edges.filter(e=>e.kind==='required_contact')){if(reached.has(e.a))reached.add(e.b);if(reached.has(e.b))reached.add(e.a);}if(reached.size!==keys.size)throw Error('目标硬关系需要连接所有房间与楼梯');
  for(const floor of [1,2])if(!plan.edges.some(e=>e.kind==='required_contact'&&[e.a,e.b].includes('stairs')&&plan.rooms.some(r=>r.key===(e.a==='stairs'?e.b:e.a)&&r.floor===floor&&['corridor','living_room','dining_room','entryway','multi_purpose'].includes(r.type))))throw Error('每层楼梯需要直接联系公共功能，不能以卧室或卫生间组织交通');
  const minimum=[0,0];for(const r of plan.rooms){const label=TYPES.indexOf(r.type);if(r.type==='stairs'){minimum[0]+=AREA[label];minimum[1]+=AREA[label];}else minimum[r.floor-1]+=AREA[label];}
  const capacity=conditions.length*conditions.width/1e6*(1-plan.reserveFraction);
  if(minimum.some(area=>area>capacity))throw Error('目标拓扑的最低面积超过生成边界容量，请减少房间或保留比例');
  return plan;
 }
 function defaults(conditions,mode='central',overrides={}){
  const rooms=[];const add=(key,type,floor,area)=>rooms.push({key,type,floor,area});
  add('stairs','stairs',1,5.76);add('entry','entryway',1,5);add('living','living_room',1,28);add('dining','dining_room',1,16);
  for(const [type,area] of [['kitchen',10],['utility',5],['balcony',5],['multi_purpose',14]]){
   const count=overrides[type]??(['utility','balcony'].includes(type)?0:1);
   for(let i=0;i<count;i++)add(type+'-'+(i+1),type,type==='multi_purpose'?2:1,area);
  }
  for(let i=0;i<conditions.bedrooms;i++)add('bedroom-'+(i+1),'bedroom',overrides.bedroomFloors?.[i]??(mode==='split'&&i===0&&conditions.bedrooms>1?1:2),16);
  for(let i=0;i<conditions.bathrooms;i++)add('bathroom-'+(i+1),'bathroom',i%2+1,5);
  const edges=[];
  for(let f=1;f<=2;f++){
   const zero=overrides.corridor===0;
   const hub=zero?(rooms.find(r=>r.floor===f&&r.type===(f===1?'living_room':'multi_purpose')))?.key:'corridor-'+f;
   if(!hub)throw Error('该楼层没有可用公共组织空间');
   if(!zero)add(hub,'corridor',f,8);
   edges.push({a:'stairs',b:hub,kind:'required_contact'});
   for(const r of rooms.filter(r=>r.floor===f&&r.type!=='stairs'&&r.key!==hub))edges.push({a:hub,b:r.key,kind:'required_contact'});
  }
  const kitchen=rooms.find(r=>r.type==='kitchen');if(kitchen)edges.push({a:'dining',b:kitchen.key,kind:'preferred_contact'});
  const living=rooms.find(r=>r.type==='living_room'),dining=rooms.find(r=>r.type==='dining_room');edges.push({a:living.key,b:dining.key,kind:'preferred_contact'});
  return validate({name:{central:'中心联系 · 两层组团',edge:'边部楼梯 · 分支联系',split:'一层卧室 · 公私分组'}[mode]||mode,mode,rooms,edges,reserveFraction:overrides.reserveFraction??.12,source:'system_strategy',requirements:{counts:Object.fromEntries(Object.entries(overrides).filter(([type])=>TYPES.includes(type)))}},conditions);
 }
 function compile(plan){return plan.rooms.filter(r=>r.type!=='stairs').map(r=>({key:r.key,label:TYPES.indexOf(r.type),floor:r.floor-1,targetArea:r.area,minArea:AREA[TYPES.indexOf(r.type)],minWidth:WIDTH[TYPES.indexOf(r.type)]}));}
 function explicitCounts(text,previous={}){
  const counts={...previous},names={厨房:'kitchen',家政:'utility',阳台:'balcony',多功能室:'multi_purpose',过道:'corridor',走道:'corridor'};
  for(const [name,type] of Object.entries(names)){
   const found=text.match(new RegExp('([0-9]+|[零一两二三四五六七八])\\s*(?:个|间)?'+name));
   if(found)counts[type]=/^[0-9]+$/.test(found[1])?Number(found[1]):({'零':0,'一':1,'两':2,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8}[found[1]]);
   if(new RegExp('(?:不要|取消|去掉|不需要)\\s*'+name).test(text))counts[type]=0;
  }return counts;
 }
 const api={TYPES,WIDTH,AREA,validate,defaults,compile,explicitCounts};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Design=api;
})(globalThis);
