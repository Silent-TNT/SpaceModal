import * as THREE from '/vendor/three.module.js';

const names={entryway:'玄关',living_room:'客厅',dining_room:'餐厅',kitchen:'厨房',bedroom:'卧室',bathroom:'卫生间',corridor:'走道',stairs:'楼梯',utility:'家政',balcony:'阳台',multi_purpose:'多功能室'};
const colors={entryway:'#d5bca5',living_room:'#bac9af',dining_room:'#e2c6a0',kitchen:'#d9a98b',bedroom:'#c4ccd6',bathroom:'#b7d1ce',corridor:'#d9d6c7',stairs:'#8d9b83',utility:'#cebdc8',balcony:'#d3ddbb',multi_purpose:'#d8c6ab'};
const $=s=>document.querySelector(s);
const state={ids:[],data:null,original:null,id:null,selected:null,floor:1,review:false,record:null,volume:null};
const nice=n=>(n/1000).toFixed(1)+' m';
const roomFloor=r=>r.floors?.length?r.floors:(r.floor?[r.floor]:[Math.floor(r.box_min[2]/3000)+1]);
const roomName=r=>names[r.type]||r.type;
const key=()=>`spacemodal-review-${state.id}`;
const getRoom=id=>state.data?.rooms.find(r=>r.id===id);
const store=()=>localStorage.setItem(key(),JSON.stringify(state.record));
const svgEl=(tag,attrs={})=>{let e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e};
const color=r=>colors[r.type]||'#cccbbf';
const groupId=r=>r.functional_group_id||r.functional_id||r.id;
const selectedGroup=()=>{const r=getRoom(state.selected);return r?groupId(r):null};
const inSelectedGroup=r=>groupId(r)===selectedGroup();

function contact(a,b){
  const A=a.box_min,B=a.box_max,C=b.box_min,D=b.box_max;
  const ox=Math.min(B[0],D[0])-Math.max(A[0],C[0]);
  const oy=Math.min(B[1],D[1])-Math.max(A[1],C[1]);
  const oz=Math.min(B[2],D[2])-Math.max(A[2],C[2]);
  return (ox===0&&oy>0&&oz>0)||(oy===0&&ox>0&&oz>0)||(oz===0&&ox>0&&oy>0);
}
function edges(){const a=state.data.rooms,out=[];for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)if(contact(a[i],a[j]))out.push([a[i].id,a[j].id]);return out}
function related(id){return edges().flatMap(e=>e.includes(id)?[e.find(x=>x!==id)]:[])}
function bounds(){let b=state.data.metadata?.building_size;if(b?.x&&b?.y)return [b.x,b.y];return [Math.max(...state.data.rooms.map(r=>r.box_max[0])),Math.max(...state.data.rooms.map(r=>r.box_max[1]))]}

function setSelected(id){state.selected=id;const selectedRoom=getRoom(id);if(state.floor&&selectedRoom&&!roomFloor(selectedRoom).includes(state.floor)){state.floor=roomFloor(selectedRoom)[0];document.querySelectorAll('[data-floor]').forEach(b=>b.classList.toggle('active',Number(b.dataset.floor)===state.floor));}renderList();renderDetail();renderView();if(state.review)renderEditor()}
function renderMeta(){let [x,y]=bounds();$('#case-meta').innerHTML=`<span><strong>${state.data.house_id}</strong></span><span>${nice(x)} × ${nice(y)}</span><span>${state.data.rooms.length} 个体块</span><span>两层住宅</span>`;$('#room-count').textContent=state.data.rooms.length}
function renderList(){const q=$('#room-search').value.trim().toLowerCase();const target=$('#room-list');target.replaceChildren();for(const r of state.data.rooms){if(q&&!`${roomName(r)} ${r.id} ${r.type}`.toLowerCase().includes(q))continue;let b=document.createElement('button');b.className='room-row'+(r.id===state.selected?' selected':'');b.innerHTML=`<i class="swatch" style="background:${color(r)}"></i><span>${roomName(r)} · ${roomFloor(r).join('/')}F</span><span class="rid">${r.id}</span>`;b.onclick=()=>setSelected(r.id);target.append(b)}}
function renderDetail(){let r=getRoom(state.selected),d=$('#detail');if(!r){d.innerHTML='<p class="detail-empty">选择一个空间，查看它在三种视图中的对应位置。</p>';return}const w=r.box_max[0]-r.box_min[0],h=r.box_max[1]-r.box_min[1],rel=related(r.id);d.innerHTML=`<h2 class="detail-type">${roomName(r)}</h2><div class="detail-id">${r.id} · ${roomFloor(r).join('/')}F</div><div class="detail-grid"><div>平面尺寸 <strong>${nice(w)} × ${nice(h)}</strong></div><div>平面面积 <strong>${(w*h/1e6).toFixed(1)} m²</strong></div><div>高度 <strong>${nice(r.box_max[2]-r.box_min[2])}</strong></div><div>贴邻体块 <strong>${rel.length} 个</strong></div></div><div class="detail-related">几何贴邻<br>${rel.length?rel.map(id=>`<button data-related="${id}">${roomName(getRoom(id))} ${id}</button>`).join(''):'当前未检测到贴邻体块'}</div>`;d.querySelectorAll('[data-related]').forEach(b=>b.onclick=()=>setSelected(b.dataset.related));}
function renderLegend(){const seen=[...new Set(state.data.rooms.map(r=>r.type))];$('#legend').innerHTML=seen.map(t=>`<span class="legend-item"><span style="background:${colors[t]||'#ccc'}"></span>${names[t]||t}</span>`).join('')}
function renderPlan(){
  const host=$('#plan-canvas');host.replaceChildren();const [W,H]=bounds(),floors=state.floor?[state.floor]:[1,2],gap=1800;
  const svg=svgEl('svg',{viewBox:`-650 -1300 ${(W+gap)*floors.length-gap+1300} ${H+2500}`,preserveAspectRatio:'xMidYMid meet',role:'img','aria-label':'住宅功能体块平面'});
  floors.forEach((floor,index)=>{
    const offset=index*(W+gap),g=svgEl('g',{transform:`translate(${offset},0)`});
    const label=svgEl('text',{x:0,y:-730,'font-size':260,fill:'#7f8e6e','font-family':'monospace'});label.textContent=`0${floor} / ${floor===1?'一层':'二层'}`;g.append(label);
    const north=svgEl('text',{x:W,y:-730,'font-size':220,fill:'#829373','text-anchor':'end'});north.textContent='N ↑';g.append(north);
    g.append(svgEl('path',{d:`M0 ${H+350}v180 M${W} ${H+350}v180 M0 ${H+440}H${W}`,fill:'none',stroke:'#a7b599','stroke-width':15}));
    const size=svgEl('text',{x:W/2,y:H+800,'font-size':210,fill:'#91a280','text-anchor':'middle','font-family':'monospace'});size.textContent=`${nice(W)} × ${nice(H)}`;g.append(size);
    for(const r of state.data.rooms){
      if(!roomFloor(r).includes(floor))continue;
      const a=r.box_min,b=r.box_max,w=b[0]-a[0],h=b[1]-a[1],selected=inSelectedGroup(r);
      const rect=svgEl('rect',{x:a[0],y:H-b[1],width:w,height:h,fill:color(r),stroke:selected?'#526840':'#fcfcf7','stroke-width':selected?45:40,class:'plan-room'+(state.selected&&!selected?' dim':'')+(selected?' selected':''),tabindex:0,role:'button','aria-label':`${roomName(r)} ${r.id}`});
      rect.addEventListener('click',()=>setSelected(r.id));rect.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(r.id)}});g.append(rect);
      if(w>=1000&&h>=1100){const t=svgEl('text',{x:(a[0]+b[0])/2,y:H-(a[1]+b[1])/2,'text-anchor':'middle','dominant-baseline':'middle',class:'plan-label',opacity:state.selected && !selected ? .75 : 1});t.textContent=roomName(r);g.append(t);}
    }
    svg.append(g);
  });host.append(svg);
}
function graphModel(){
  const groups=new Map();
  for(const r of state.data.rooms){
    const id=groupId(r);
    if(!groups.has(id))groups.set(id,{id,type:r.type,parts:[],floors:new Set(),label:r.id});
    const g=groups.get(id);g.parts.push(r);roomFloor(r).forEach(f=>g.floors.add(f));
  }
  const contacts=new Map();
  for(const [a,b] of edges()){
    const ga=groupId(getRoom(a)),gb=groupId(getRoom(b));
    if(ga===gb)continue;
    const key=[ga,gb].sort().join('|');
    if(!contacts.has(key))contacts.set(key,{source:ga,target:gb,edge_type:'contact_observed'});
  }
  return {
    nodes:[{id:state.data.house_id,node_type:'house'},...([1,2].map(f=>({id:'floor_'+f,node_type:'floor',floor:f}))),...[...groups.values()].map(g=>({...g,node_type:'room_instance',floors:[...g.floors]}))],
    edges:[
      ...([1,2].map(f=>({source:state.data.house_id,target:'floor_'+f,edge_type:'contains'}))),
      ...[...groups.values()].flatMap(g=>[...g.floors].map(f=>({source:'floor_'+f,target:g.id,edge_type:'contains'}))),
      ...contacts.values()
    ]
  };
}
function graphPositions(model){
  const p={[state.data.house_id]:[300,40],floor_1:[155,127],floor_2:[445,127]};
  const rooms=model.nodes.filter(n=>n.node_type==='room_instance');
  const both=rooms.filter(n=>n.floors.length>1);
  const one=rooms.filter(n=>n.floors.length===1&&n.floors[0]===1);
  const two=rooms.filter(n=>n.floors.length===1&&n.floors[0]===2);
  for(const [list,xs] of [[one,[70,155,240]],[two,[360,445,530]]]){
    list.forEach((n,i)=>{p[n.id]=[xs[i%3],210+Math.floor(i/3)*85]});
  }
  both.forEach((n,i)=>{p[n.id]=[300,225+i*75]});
  return p;
}
function renderGraph(){
  const host=$('#graph-canvas');host.replaceChildren();
  const model=graphModel(),p=graphPositions(model),selected=selectedGroup();
  const nearby=new Set(model.edges.filter(e=>e.edge_type==='contact_observed'&&(e.source===selected||e.target===selected)).flatMap(e=>[e.source,e.target]));
  const svg=svgEl('svg',{viewBox:'0 0 600 590',role:'img','aria-label':'住宅、楼层与功能空间的异构拓扑图；空间连线为几何贴邻'});
  for(const edge of model.edges){
    const a=p[edge.source],b=p[edge.target];if(!a||!b)continue;
    const contact=edge.edge_type==='contact_observed',active=contact&&(edge.source===selected||edge.target===selected);
    const line=svgEl('path',{d:`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`,class:contact?'hetero-contact'+(active?' active':''):'hetero-contains','data-edge-type':edge.edge_type});
    svg.append(line);
  }
  const house=svgEl('g',{'class':'hetero-parent'});
  house.append(svgEl('rect',{x:257,y:19,width:86,height:42,rx:5,'data-node-type':'house'}));
  const ht=svgEl('text',{x:300,y:45,'text-anchor':'middle'});ht.textContent='住宅';house.append(ht);svg.append(house);
  for(const floor of [1,2]){const [x,y]=p['floor_'+floor],g=svgEl('g',{'class':'hetero-floor'});
    g.append(svgEl('rect',{x:x-42,y:y-20,width:84,height:40,rx:4,'data-node-type':'floor'}));
    const t=svgEl('text',{x,y:y+4,'text-anchor':'middle'});t.textContent=floor===1?'一层':'二层';g.append(t);svg.append(g);
  }
  for(const n of model.nodes.filter(n=>n.node_type==='room_instance')){
    const [x,y]=p[n.id],active=n.id===selected,dim=selected&&!active&&!nearby.has(n.id),g=svgEl('g',{class:'graph-node hetero-room'+(active?' selected':'')+(dim?' dim':''),tabindex:0,role:'button','aria-label':`${names[n.type]||n.type} ${n.parts.map(r=>r.id).join('、')}`});
    g.append(svgEl('circle',{cx:x,cy:y,r:21,fill:colors[n.type]||'#cccbbf','data-node-type':'room_instance'}));
    const number=svgEl('text',{x,y:y+4,'text-anchor':'middle','font-size':15});number.textContent=n.parts[0].id.replace('room_','');g.append(number);
    const label=svgEl('text',{x,y:y+36,'text-anchor':'middle','font-size':16});label.textContent=names[n.type]||n.type;g.append(label);
    g.onclick=()=>setSelected(n.parts[0].id);
    g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(n.parts[0].id)}};
    svg.append(g);
  }
  host.append(svg);
}function disposeVolume(){if(state.volume){state.volume.dispose();state.volume=null}}
function renderVolume(){
  const host=$('#volume-canvas');host.replaceChildren();const scene=new THREE.Scene(),[W,H]=bounds(),scale=.001,cx=W/2000,cz=H/2000;
  const pose=state.pose||{theta:.78,phi:.65,zoom:1};state.pose=pose;
  const camera=new THREE.OrthographicCamera(-15,15,15,-15,.1,200);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xf8f9f3,0);host.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x6f7864,2));const light=new THREE.DirectionalLight(0xffffff,2.2);light.position.set(-10,20,10);scene.add(light);
  const slab=new THREE.Mesh(new THREE.BoxGeometry(W*scale+.2,.05,H*scale+.2),new THREE.MeshLambertMaterial({color:0xe0e5d6,transparent:true,opacity:.55}));slab.position.set(0,-.09,0);scene.add(slab);
  const meshes=[];
  for(const r of state.data.rooms){const a=r.box_min,b=r.box_max,selected=inSelectedGroup(r),geometry=new THREE.BoxGeometry((b[0]-a[0])*scale,(b[2]-a[2])*scale,(b[1]-a[1])*scale);
    const material=new THREE.MeshLambertMaterial({color:color(r),transparent:true,opacity:state.selected && !selected ? .19 : .87,depthWrite:selected});
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set((a[0]+b[0])*scale/2-cx,(a[2]+b[2])*scale/2,(a[1]+b[1])*scale/2-cz);mesh.userData.id=r.id;scene.add(mesh);meshes.push(mesh);
    const outline=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:selected?0x627250:0x9aa88a,transparent:true,opacity:selected ? .9 : .2}));outline.position.copy(mesh.position);scene.add(outline);
  }
  const draw=()=>{camera.position.set(Math.sin(pose.theta)*Math.cos(pose.phi)*40,Math.sin(pose.phi)*40+2,Math.cos(pose.theta)*Math.cos(pose.phi)*40);camera.lookAt(0,2.5,0);renderer.render(scene,camera)};
  const resize=()=>{const width=host.clientWidth,height=host.clientHeight,span=Math.max(W,H)/1000*.77/pose.zoom;renderer.setSize(width,height,false);camera.left=-span*width/height;camera.right=span*width/height;camera.top=span;camera.bottom=-span;camera.updateProjectionMatrix();draw()};
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  let pointer=null,moved=false;
  renderer.domElement.addEventListener('pointerdown',e=>{pointer=[e.clientX,e.clientY];moved=false;renderer.domElement.setPointerCapture(e.pointerId)});
  renderer.domElement.addEventListener('pointermove',e=>{if(!pointer)return;const dx=e.clientX-pointer[0],dy=e.clientY-pointer[1];if(Math.abs(dx)+Math.abs(dy)>2)moved=true;pose.theta-=dx*.006;pose.phi=Math.max(.1,Math.min(1.4,pose.phi+dy*.006));pointer=[e.clientX,e.clientY];draw()});
  renderer.domElement.addEventListener('pointercancel',()=>{pointer=null});
  renderer.domElement.addEventListener('pointerup',e=>{pointer=null;if(moved)return;const box=renderer.domElement.getBoundingClientRect(),mouse=new THREE.Vector2((e.clientX-box.left)/box.width*2-1,-((e.clientY-box.top)/box.height*2-1)),ray=new THREE.Raycaster();ray.setFromCamera(mouse,camera);const hit=ray.intersectObjects(meshes)[0];if(hit)setSelected(hit.object.userData.id)});
  renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();pose.zoom=Math.max(.55,Math.min(2.5,pose.zoom-Math.sign(e.deltaY)*.08));resize()},{passive:false});
  const hint=document.createElement('div');hint.className='volume-hint';hint.textContent='拖动旋转 / 滚轮缩放 / 点击选择';host.append(hint);
  state.volume={dispose(){observer.disconnect();renderer.dispose();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose?.()});renderer.domElement.remove()}};
}

function renderView(){disposeVolume();renderPlan();renderVolume();renderGraph()}

function renderEditor(){const box=$('#edit-box'),r=getRoom(state.selected);if(!r){box.innerHTML='<p class="empty-note">先选择一个体块，再调整位置与尺寸。</p>';return}let a=r.box_min,b=r.box_max;box.innerHTML=`<div class="edit-field"><label>X 起点 mm<input type="number" step="300" data-coordinate="x" value="${a[0]}"></label><label>Y 起点 mm<input type="number" step="300" data-coordinate="y" value="${a[1]}"></label><label>宽度 mm<input type="number" step="300" data-coordinate="w" value="${b[0]-a[0]}"></label><label>深度 mm<input type="number" step="300" data-coordinate="h" value="${b[1]-a[1]}"></label></div><div class="edit-actions"><button id="apply-edit">应用调整</button><button id="reset-room">还原此体块</button></div><p class="small-note">只调整平面位置与尺寸；高度、类型与原始 Rhino 不变。</p>`;$('#apply-edit').onclick=applyEdit;$('#reset-room').onclick=()=>{let original=state.original.rooms.find(x=>x.id===r.id);if(!original)return;recordChange(r,original.box_min,original.box_max,'还原到原始 JSON');r.box_min=[...original.box_min];r.box_max=[...original.box_max];renderAll()}}
function recordChange(r,min,max,reason){state.record.changes.push({room_id:r.id,before:{box_min:[...r.box_min],box_max:[...r.box_max]},after:{box_min:[...min],box_max:[...max]},reason,time:new Date().toISOString()});store()}
function applyEdit(){let r=getRoom(state.selected),v={};document.querySelectorAll('[data-coordinate]').forEach(i=>v[i.dataset.coordinate]=Math.round(Number(i.value)/300)*300);let [W,H]=bounds();if(!Object.values(v).every(Number.isFinite)||v.w<=0||v.h<=0||v.x<0||v.y<0||v.x+v.w>W||v.y+v.h>H){alert('请输入有效尺寸，且体块需在当前建筑范围内。');return}let a=[v.x,v.y,r.box_min[2]],b=[v.x+v.w,v.y+v.h,r.box_max[2]];if(a.every((n,i)=>n===r.box_min[i])&&b.every((n,i)=>n===r.box_max[i]))return;let overlap=state.data.rooms.find(o=>o.id!==r.id&&roomFloor(o).some(f=>roomFloor(r).includes(f))&&Math.min(b[0],o.box_max[0])-Math.max(a[0],o.box_min[0])>0&&Math.min(b[1],o.box_max[1])-Math.max(a[1],o.box_min[1])>0&&Math.min(b[2],o.box_max[2])-Math.max(a[2],o.box_min[2])>0);if(overlap){alert(`与 ${overlap.id} 重叠，请先调整位置或尺寸。`);return}let reason=$('#review-note').value.trim();if(!reason){alert('请先写明修改依据或备注，再应用调整。');return}recordChange(r,a,b,reason);r.box_min=a;r.box_max=b;renderAll()}
function renderChecklist(){const labels=['一、二层图纸对应','功能类型与实例数量','尺寸与 300 mm 模数','楼梯和跨层空间','关键空间组织'];$('#review-checklist').innerHTML=labels.map((t,i)=>`<label class="check-row"><input type="checkbox" data-check="${i}" ${state.record.checks[i]?'checked':''}><span>${t}</span></label>`).join('');document.querySelectorAll('[data-check]').forEach(i=>i.onchange=()=>{state.record.checks[i.checked?Number(i.dataset.check):Number(i.dataset.check)]=i.checked;store()})}
function renderSuspects(){let e=edges(),deg=Object.fromEntries(state.data.rooms.map(r=>[r.id,0]));e.forEach(([a,b])=>{deg[a]++;deg[b]++});let isolated=Object.entries(deg).filter(([,n])=>n===0).map(([id])=>id);$('#suspects').innerHTML=`<strong>待复核提示</strong>${isolated.length?`检测到 ${isolated.length} 个无几何贴邻的体块：${isolated.slice(0,5).join('、')}。请对照原图判断。`:'暂未检测到完全孤立的体块。仍需对照原图检查入口、走道与房间的过渡。'}<br>此项仅按体块接触计算，不能证明真实可通行。`}
async function renderSources(){let host=$('#source-list');host.textContent='读取中…';try{let urls=await fetch(`/api/source/${state.id}`).then(r=>r.json());host.replaceChildren();urls.forEach((url,i)=>{let d=document.createElement('div');d.className='source-card';let img=document.createElement('img');img.src=url;img.alt=`原始图纸 ${i+1}`;img.onclick=()=>zoom(url);let select=document.createElement('select');select.innerHTML='<option value="unknown">待判定楼层</option><option value="1">一层</option><option value="2">二层</option><option value="other">其他</option>';select.value=state.record.sourceFloors[i]||'unknown';select.onchange=()=>{state.record.sourceFloors[i]=select.value;store()};let link=document.createElement('a');link.href=url;link.target='_blank';link.textContent='查看原图 ↗';d.append(img,select,link);host.append(d)})}catch{host.textContent='原图暂不可读取'}}
function zoom(url){let d=document.createElement('div');d.className='zoom-image';let img=document.createElement('img');img.src=url;let b=document.createElement('button');b.textContent='关闭 ×';b.onclick=()=>d.remove();d.onclick=e=>{if(e.target===d)d.remove()};d.append(img,b);document.body.append(d)}
function renderAll(){renderMeta();renderList();renderDetail();renderView();renderSuspects();if(state.review)renderEditor()}
async function loadCase(id){let response=await fetch(`/case-data/house_${id}.json`);if(!response.ok)throw Error('案例读取失败');let data=await response.json();state.id=id;state.original=structuredClone(data);let saved;try{saved=JSON.parse(localStorage.getItem(key()))}catch{}state.record=saved||{sourceFloors:{},checks:{},changes:[],scaleBasis:'unselected',status:'pending',note:''};state.record.changes ||= [];state.record.checks ||= {};state.record.sourceFloors ||= {};state.data=structuredClone(data);for(const change of state.record.changes){let r=getRoom(change.room_id);if(r){r.box_min=[...change.after.box_min];r.box_max=[...change.after.box_max]}}state.selected=state.data.rooms.find(r=>r.type==='living_room'&&roomFloor(r).includes(state.floor||1))?.id||state.data.rooms[0]?.id;document.querySelectorAll('[data-case]').forEach(b=>{b.classList.toggle('selected',b.dataset.case===id);b.setAttribute('aria-pressed',String(b.dataset.case===id))});$('#scale-basis').value=state.record.scaleBasis||'unselected';$('#review-status').value=state.record.status||'pending';$('#review-note').value=state.record.note||'';renderAll();renderLegend();renderChecklist();if(state.review)renderSources()}
function exportReview(){const payload={schema:'spacemodal_review_v1',house_id:state.data.house_id,exported_at:new Date().toISOString(),review:{...state.record},corrected_rooms:state.data.rooms.map(r=>({id:r.id,type:r.type,floors:roomFloor(r),box_min:r.box_min,box_max:r.box_max}))};let blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${state.data.house_id}_review.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function init(){state.ids=['house_1002','house_1003','house_1010'];let select=$('#case-select');select.innerHTML=state.ids.map(id=>`<option value="${id.slice(6)}">${id}</option>`).join('');select.onchange=()=>loadCase(select.value);document.querySelectorAll('[data-case]').forEach(b=>b.onclick=()=>{select.value=b.dataset.case;loadCase(select.value)});$('#room-search').oninput=renderList;document.querySelectorAll('[data-floor]').forEach(b=>b.onclick=()=>{state.floor=Number(b.dataset.floor);document.querySelectorAll('[data-floor]').forEach(x=>x.classList.toggle('active',x===b));renderPlan()});$('#review-toggle').onchange=e=>{state.review=e.target.checked;$('#review-panel').hidden=!state.review;if(state.review){renderEditor();renderSources()}};for(const [id,keyName] of [['scale-basis','scaleBasis'],['review-status','status'],['review-note','note']])$('#'+id).onchange=e=>{if(id==='review-status'&&e.target.value==='confirmed'){let floors=new Set(Object.values(state.record.sourceFloors));if([0,1,2,3,4].some(i=>!state.record.checks[i])||!floors.has('1')||!floors.has('2')||state.record.scaleBasis==='unselected'){alert('请先配对两层原图、选定定尺依据，并完成五项逐套核对。');e.target.value='pending';return}}state.record[keyName]=e.target.value;store()};$('#export-review').onclick=exportReview;const requested=new URLSearchParams(location.search).get('case');select.value=state.ids.includes('house_'+requested)?requested:state.ids[0].slice(6);await loadCase(select.value)}
init().catch(e=>{$('#plan-canvas').textContent=e.message});
