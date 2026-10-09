(function(root){
 'use strict';
 const TYPES=['entryway','living_room','dining_room','kitchen','bedroom','bathroom','corridor','stairs','utility','balcony','multi_purpose'];
 const WIDTH=[1.8,3.6,2.7,2.4,2.7,1.5,1.2,2.4,1.8,1.5,2.7];
 const AREA=[3.24,12.96,8.1,5.76,9,3,1.44,5.76,3.24,2.25,8.1];
 function validate(plan,conditions){
  if(!plan||typeof plan.name!=='string'||plan.name.length>80||!Array.isArray(plan.rooms)||plan.rooms.length<6||plan.rooms.length>30)throw Error('设计策略格式无效');
  if(plan.reserveFraction!==0)throw Error('R1要求矩形满铺，保留比例必须为0');
  const keys=new Set();
  if(!['central','edge','split'].includes(plan.mode))throw Error('未知的空间组织模式');if(plan.requirements?.lockedMode!==undefined&&plan.requirements.lockedMode!==plan.mode)throw Error('策略不能改变明确要求的楼梯组织位置');
  for(const room of plan.rooms){
   if(typeof room.key!=='string'||!/^[-_a-z0-9]{1,40}$/.test(room.key)||keys.has(room.key)||!TYPES.includes(room.type)||![1,2].includes(room.floor)||!Number.isFinite(room.area)||room.area<=0||room.area>conditions.length*conditions.width/1e6)throw Error('房间实例、楼层或面积无效');
   if(room.area+1e-8<AREA[TYPES.indexOf(room.type)])throw Error('面积偏好不能低于该功能最低面积');
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
  const capacity=conditions.length*conditions.width/1e6;
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
  return validate({name:{central:'中心联系 · 两层组团',edge:'边部楼梯 · 分支联系',split:'一层卧室 · 公私分组'}[mode]||mode,mode,rooms,edges,reserveFraction:0,source:'system_strategy',requirements:{counts:{...Object.fromEntries(Object.entries(overrides).filter(([type])=>TYPES.includes(type))),bedroom:conditions.bedrooms,bathroom:conditions.bathrooms},...(overrides.lockedMode?{lockedMode:overrides.lockedMode}:{})}},conditions);
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
 function assertRevision(base,next,conditions){
  validate(next,conditions);
  if(base.rooms.length!==next.rooms.length)throw Error('调整不能增删已确认实例');
  for(const r of base.rooms){const n=next.rooms.find(s=>s.key===r.key);if(!n||n.type!==r.type||n.floor!==r.floor)throw Error('调整不能改变已确认的功能、实例或楼层');}
  const edgeKey=e=>[e.a,e.b].sort().join('|');const required=new Set(base.edges.filter(e=>e.kind==='required_contact').map(edgeKey));if(next.edges.some(e=>e.kind==='required_contact'&&!required.has(edgeKey(e))))throw Error('调整不能新增未确认的必需关系');
  for(const e of base.edges.filter(e=>e.kind==='required_contact'))if(!next.edges.some(n=>n.kind==='required_contact'&&edgeKey(n)===edgeKey(e)))throw Error('调整不能删除已确认的必需关系');
  for(const [type,count] of Object.entries(base.requirements?.counts||{}))if(next.requirements?.counts?.[type]!==count||next.rooms.filter(r=>r.type===type).length!==count)throw Error('调整不能改变明确功能数量');
  if(base.requirements?.lockedMode!==undefined&&next.requirements?.lockedMode!==base.requirements.lockedMode)throw Error('调整不能删除明确的组织位置约束');
  return next;
 }
 function completeInitialContacts(input,explicitCounts={},organizePublic=false){
  const plan=structuredClone(input),notes=[];
  if(!Array.isArray(plan.rooms)||!Array.isArray(plan.edges)||!plan.edges.length||plan.rooms.length>30)return {plan,notes};
  if(plan.rooms.some(r=>!TYPES.includes(r.type)||![1,2].includes(r.floor))||new Set(plan.rooms.map(r=>r.key)).size!==plan.rooms.length)return {plan,notes};
  const hubs=[];const connect=(a,b)=>{if(!plan.edges.some(e=>e.kind==='required_contact'&&[e.a,e.b].includes(a)&&[e.a,e.b].includes(b))){plan.edges.push({a,b,kind:'required_contact'});notes.push('系统补齐公共联系：'+a+' ↔ '+b);}};
  for(const floor of [1,2]){
   let hub=plan.rooms.find(r=>r.floor===floor&&r.type==='corridor')||plan.rooms.find(r=>r.floor===floor&&['living_room','dining_room','entryway','multi_purpose'].includes(r.type));
   if(!hub&&plan.rooms.filter(r=>r.type==='corridor').length<(explicitCounts.corridor??2)){
    let key='public-corridor-'+floor;while(plan.rooms.some(r=>r.key===key))key+='x';hub={key,type:'corridor',floor,area:8};plan.rooms.push(hub);plan.requirements={...plan.requirements,counts:{...plan.requirements?.counts,corridor:plan.rooms.filter(r=>r.type==='corridor').length}};notes.push('系统补齐'+floor+'层公共走道；用户确认前可审阅');
   }
   if(!hub)continue;hubs.push({floor,key:hub.key});connect('stairs',hub.key);
   const reached=new Set(['stairs']);for(let i=0;i<plan.rooms.length;i++)for(const e of plan.edges.filter(e=>e.kind==='required_contact')){if(reached.has(e.a))reached.add(e.b);if(reached.has(e.b))reached.add(e.a);}
   for(const r of plan.rooms.filter(r=>r.floor===floor&&r.type!=='stairs'&&!reached.has(r.key)))connect(hub.key,r.key);
  }
  if(organizePublic&&hubs.length===2){
   const required=new Set();for(const hub of hubs){required.add(['stairs',hub.key].sort().join('|'));for(const r of plan.rooms.filter(r=>r.floor===hub.floor&&r.type!=='stairs'&&r.key!==hub.key)){required.add([hub.key,r.key].sort().join('|'));connect(hub.key,r.key);}}
   let softened=0;for(const e of plan.edges)if(e.kind==='required_contact'&&!required.has([e.a,e.b].sort().join('|'))){e.kind='preferred_contact';softened++;}if(softened)notes.push('用户未指定贴邻：系统按公共联系规则整理推断关系，其他联系保留为偏好，确认后才生成');
  }
  if(notes.length){plan.originalName=plan.name;plan.name='公共联系校正 · '+({central:'中部联系',edge:'边部楼梯',split:'分层组团'}[plan.mode]||'设计策略');plan.source='llm_with_rule_completion';}
  return {plan,notes};
 }
 function normalizeCounts(input){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('功能数量格式无效');const out={};for(const [key,value] of Object.entries(input)){const canonical=({bedrooms:'bedroom',bathrooms:'bathroom'})[key]||key;if(Object.hasOwn(out,canonical)&&out[canonical]!==value)throw Error('功能数量字段冲突');out[canonical]=value;}return out;}
 function explicitMode(text,previous){if(/(?:不要|不需要|不要求)(?:把)?楼梯[^，,。；;]{0,5}(?:居中|靠边)|楼梯(?:不要|不需要|不要求)[^，,。；;]{0,5}(?:居中|靠边)/.test(text))return previous;if(/楼梯.{0,8}(?:居中|中央|中部|中间)|(?:中央|中部).{0,3}楼梯/.test(text))return 'central';if(/楼梯.{0,8}(?:靠边|边部|边缘|侧边)|(?:边部|边缘).{0,3}楼梯/.test(text))return 'edge';return previous;}
 const api={TYPES,WIDTH,AREA,validate,defaults,compile,explicitCounts,assertRevision,explicitMode,normalizeCounts,completeInitialContacts};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Design=api;
})(globalThis);
