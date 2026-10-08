const $ = (id) => document.getElementById(id);
const MOD = 300;
const RULER = 23;
const colors = {
  entryway:'#82969b', living_room:'#ef8a3f', dining_room:'#e4c84e', kitchen:'#66bb77',
  bedroom:'#558ad1', bathroom:'#df6672', corridor:'#a5a4de', stairs:'#a05bc8',
  utility:'#62b09a', balcony:'#53c4cf', multi_purpose:'#e1a1c0', unassigned:'#8b9295'
};
const state = {
  cases:[], draft:null, images:{}, types:[], mode:'select', selectedRoomId:null, selectedAxisId:null,
  batchRoomIds:new Set(), alignmentPick:null,
  activeRoomType:'living_room',visibleRoomTypes:new Set(),
  selectedFloor:1, drag:null, drawing:null, zoom:1, pan:{x:0,y:0},
  yaw:0.7, pitch:0.55, previewDrag:null, qc:null, showAxes:false, showGrid:true,
  showGuides:true, guides:[], guideDrag:null, providers:[]
};
const persistence = {baseline:'', pending:null, blocked:false, user:'local', role:'admin', localError:false, switching:false, approving:false};
function draftContent(draft=state.draft){
  if(!draft)return '';
  const copy=structuredClone(draft);
  delete copy.revision;delete copy.status;delete copy.updated_by;
  for(const floor of copy.floors||[])delete floor.image_url;
  return JSON.stringify(copy);
}
function isDirty(){return !!state.draft && draftContent()!==persistence.baseline;}
function recoveryKey(id){return `plan-review-recovery:${persistence.user}:${id}`;}
function cacheDraft(){
  if(!state.draft||!isDirty()||persistence.blocked)return;
  try{localStorage.setItem(recoveryKey(state.draft.case_id),JSON.stringify(state.draft));persistence.localError=false;}
  catch{persistence.localError=true;$('save-state').textContent='本地恢复不可用，请下载草稿';}
}
function exportDraft(draft=state.draft){
  if(!draft)return;
  if(persistence.blocked){try{draft=JSON.parse(localStorage.getItem(recoveryKey(draft.case_id)))||draft;}catch{}}
  const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`house_${draft.case_id}.draft.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function reloadLatest(){
  if(!state.draft||persistence.approving)return;
  if(persistence.pending)await persistence.pending;
  if(!confirm('将打开浏览器最新版。当前未同步修改会先下载，请保留文件用于人工合并。'))return;
  if(isDirty()||persistence.blocked)exportDraft();
  try{localStorage.removeItem(recoveryKey(state.draft.case_id));}catch{}
  persistence.blocked=false;persistence.baseline=draftContent();
  await openCase(state.draft.case_id);
}
async function autosaveTick(){
  if(!state.draft||persistence.switching||persistence.approving||state.drag||state.drawing||state.guideDrag)return;
  if(!isDirty())return;
  cacheDraft();
  if(state.draft.status==='approved'){$('save-state').textContent='已导出版本不能覆盖，请下载修改';return;}
  if(!persistence.pending&&!persistence.blocked)await saveCase(true);
}
const history = {undo:[],redo:[],limit:100};
const snap = (n) => Math.round(n / MOD) * MOD;
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const msg = (text) => { $('message').textContent = text; };
const drawerPinned = (name) => document.body.classList.contains(`${name}-pinned`);
function syncPinButtons(){
  for(const name of ['queue','inspector']){
    const button=$(`${name}-pin`),pinned=drawerPinned(name);
    button.textContent=pinned?'取消固定':'固定';button.setAttribute('aria-pressed',String(pinned));
    button.title=pinned?'取消固定后可收起此面板':'固定后此面板将常驻工作区';
  }
  $('inspector-toggle').setAttribute('aria-pressed',String(drawerPinned('inspector')||document.body.classList.contains('inspector-open')));
}
function loadDrawerPins(){
  for(const name of ['queue','inspector']){
    try{if(localStorage.getItem(`plan-review:${name}-pinned`)==='true')document.body.classList.add(`${name}-pinned`)}catch{}
  }
  syncPinButtons();
}
function toggleDrawerPin(name){
  const className=`${name}-pinned`,pin=!drawerPinned(name);
  document.body.classList.toggle(className,pin);
  if(pin)document.body.classList.add(`${name}-open`);
  try{localStorage.setItem(`plan-review:${name}-pinned`,String(pin))}catch{}
  syncPinButtons();render();
}
function toggleDrawer(name){
  if(drawerPinned(name))return;
  const other=name==='queue'?'inspector':'queue';
  if(!drawerPinned(other))document.body.classList.remove(`${other}-open`);
  document.body.classList.toggle(`${name}-open`);
  $('inspector-toggle').setAttribute('aria-pressed',String(document.body.classList.contains('inspector-open')||drawerPinned('inspector')));
  render();
}
function captureWorkspace(){
  return {draft:state.draft?structuredClone(state.draft):null,guides:structuredClone(state.guides),selectedRoomId:state.selectedRoomId,selectedAxisId:state.selectedAxisId,selectedFloor:state.selectedFloor};
}
function refreshHistoryButtons(){
  $('undo-btn').disabled=history.undo.length===0;
  $('redo-btn').disabled=history.redo.length===0;
}
function pushHistorySnapshot(label,snapshot){
  history.undo.push({label,snapshot});
  if(history.undo.length>history.limit)history.undo.shift();
  history.redo.length=0;refreshHistoryButtons();
}
function recordHistory(label){pushHistorySnapshot(label,captureWorkspace());}
async function restoreWorkspace(snapshot){
  const oldUrls=state.draft?.floors?.map((floor)=>floor.image_url).join('|');
  const revision=state.draft?.revision,status=state.draft?.status;
  state.draft=structuredClone(snapshot.draft);if(state.draft){state.draft.revision=revision;state.draft.status=status;}state.guides=structuredClone(snapshot.guides);
  state.selectedRoomId=snapshot.selectedRoomId;state.selectedAxisId=snapshot.selectedAxisId;state.selectedFloor=snapshot.selectedFloor;state.alignmentPick=null;
  if(oldUrls!==state.draft?.floors?.map((floor)=>floor.image_url).join('|'))await loadImages();
  if(state.draft){$('size-x').value=state.draft.building_size.x;$('size-y').value=state.draft.building_size.y;saveGuides();updateFloorNames()}
  updateSelection();renderRoomList();render();
}
async function undoHistory(){
  const action=history.undo.pop();if(!action)return;
  history.redo.push({label:action.label,snapshot:captureWorkspace()});
  await restoreWorkspace(action.snapshot);refreshHistoryButtons();msg(`已撤回：${action.label}`);
}
async function redoHistory(){
  const action=history.redo.pop();if(!action)return;
  history.undo.push({label:action.label,snapshot:captureWorkspace()});
  await restoreWorkspace(action.snapshot);refreshHistoryButtons();msg(`已重做：${action.label}`);
}
const floorData = (floor) => state.draft?.floors.find((f) => f.floor === floor);
const currentRoom = () => state.draft?.rooms.find((r) => r.id === state.selectedRoomId);
const currentAxis = () => state.draft?.axes.find((a) => a.id === state.selectedAxisId);
const roomLayerVisible = (room) => room.type==='unassigned'||state.visibleRoomTypes.has(room.type);

async function api(path, options={}) {
  return window.REVIEW_DEMO.request(path, options);
  /* Backend branch retained for source parity. */
  const response = await fetch(path, {headers:{'Content-Type':'application/json'},...options});
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error=new Error(body.detail || `${response.status} ${response.statusText}`);error.status=response.status;throw error;
  }
  return response.json();
}

async function initialize() {
  loadDrawerPins();
  const session=await api('/api/session');persistence.user=session.name;persistence.role=session.role;
  $('approve-btn').hidden=session.role!=='admin';
  const health = await api('/api/health');
  state.types = health.types;
  state.visibleRoomTypes = new Set(health.types.map((t)=>t.id));
  state.activeRoomType = health.types.some((t)=>t.id==='living_room')?'living_room':health.types[0]?.id;
  renderFunctionLayers();
  state.providers = health.providers;
  $('vision-provider').innerHTML = state.providers.map((p)=>`<option value="${p.id}">${p.id==='alibaba'?'阿里百炼':'OpenAI'} · ${p.model}</option>`).join('');
  $('vision-provider').value = health.provider;
  updateVisionStatus();
  for (const id of ['new-room-type','room-type']) {
    $(id).innerHTML = health.types.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
  }
  $('new-room-type').insertAdjacentHTML('afterbegin','<option value="unassigned">待分类</option>');
  $('room-type').insertAdjacentHTML('afterbegin','<option value="unassigned">待分类</option>');
  $('new-room-type').value = 'unassigned';
  await refreshCases();
  installEvents();
  window.REVIEW_DEMO.install();
  setInterval(autosaveTick,2000);
  window.addEventListener('beforeunload',(event)=>{if(isDirty()){cacheDraft();event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',cacheDraft);
  window.addEventListener('online',()=>{if(!persistence.blocked)autosaveTick();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cacheDraft();});
  new ResizeObserver(render).observe(document.querySelector('.plans'));
  new ResizeObserver(render).observe($('preview-3d'));
  render();
}

function updateVisionStatus(){
  window.REVIEW_DEMO.updateStatus();return;
  const provider = state.providers.find((p)=>p.id===$('vision-provider').value);
  if(!provider)return;
  $('vision-btn').disabled = !provider.available;
  $('cloud-state').textContent = provider.available ? `${provider.id==='alibaba'?'阿里百炼':'OpenAI'} 已就绪` : '所选模型密钥待配置';
}

async function refreshCases() {
  state.cases = await api('/api/cases');
  renderCaseList();
}

function renderCaseList() {
  const filter = $('case-filter').value;
  const q = $('case-search').value.trim().toLowerCase();
  const filtered = state.cases.filter((item) => (filter === 'all' || item.status === filter) && (!q || item.name.toLowerCase().includes(q) || String(item.id).includes(q)));
  $('case-count').textContent = `${filtered.length} 套`;
  const list = $('case-list');
  list.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const item of filtered.slice(0, 80)) {
    const button = document.createElement('button');
    button.className = `case-item${state.draft?.case_id === item.id ? ' active' : ''}`;
    button.innerHTML = `<strong>ID${item.id} · ${item.image_pair_status === 'image_mismatch_needs_review' ? '配图待核' : statusName(item.status)}</strong><small></small>`;
    button.querySelector('small').textContent = item.name;
    button.onclick = () => openCase(item.id);
    fragment.append(button);
  }
  list.append(fragment);
}

function statusName(status) {
  return {new:'待处理',draft:'草稿',manual_existing:'预置示例',approved:'已导出'}[status] || status;
}

async function openCase(id) {
  if(persistence.switching||persistence.approving)return;
  persistence.switching=true;
  try {
    if(persistence.pending)await persistence.pending;
    if(isDirty()){
      cacheDraft();
      const saved=await saveCase(true);
      if(saved&&isDirty()){msg('保存期间仍有新修改，请稍后再切换。');return;}
      if(!saved&&!confirm('当前修改尚未保存到浏览器。切换后可在本浏览器恢复；仍要切换吗？'))return;
      if(!saved&&persistence.localError){exportDraft();msg('本地恢复不可用，已下载当前草稿；请保存文件后再切换。');return;}
    }
    msg(`正在打开 ID${id}…`);
    const draft = await api(`/api/cases/${id}`);
    persistence.baseline=draftContent(draft);persistence.blocked=false;
    let recovered=null;
    try{recovered=JSON.parse(localStorage.getItem(recoveryKey(id))||'null');}catch{}
    if(recovered&&draftContent(recovered)!==persistence.baseline){
      if(draft.status!=='approved'&&recovered.revision===draft.revision){
        if(confirm('发现此案例未同步的本地草稿，恢复继续编辑吗？')){
          recovered.floors.forEach((floor)=>{floor.image_url=draft.floors.find((f)=>f.image_name===floor.image_name)?.image_url||floor.image_url;});
          Object.assign(draft,recovered);
        }else localStorage.removeItem(recoveryKey(id));
      }else{
        persistence.blocked=true;
        msg('本地草稿与浏览器版本冲突，已保留；请先下载本地草稿，再打开最新版。');
        if(confirm('浏览器版本已更新。下载未同步的本地草稿以便人工合并吗？')){
          exportDraft(recovered);
        }
      }
    }
    state.draft = draft;
    document.querySelector('.workspace').inert=persistence.blocked;document.querySelector('.inspector').inert=persistence.blocked;
    $('save-state').textContent=persistence.blocked?'版本冲突 · 本地草稿已保留':isDirty()?'待同步':'已保存';
    history.undo.length=0;history.redo.length=0;refreshHistoryButtons();
    $('wall-review-btn').disabled = false;
    state.selectedRoomId = null;
    state.selectedAxisId = null;
    state.batchRoomIds.clear();state.alignmentPick=null;
    state.zoom = 1;
    state.pan = {x:0,y:0};
    state.guides = loadGuides(id);
    state.qc = null;
    await loadImages();
    $('case-title').textContent = draft.case_name;
    $('case-status').textContent = draft.image_pair_status === 'image_mismatch_needs_review'
      ? '图纸与人工数据配图不一致 · 需复核'
      : (draft.source === 'manual_v14' ? '人工原始数据' : statusName(draft.status));
    $('size-x').value = draft.building_size.x;
    $('size-y').value = draft.building_size.y;
    updateFloorNames();
    updateSelection();
    renderRoomList();
    renderCaseList();
    render();
    if(!drawerPinned('queue'))document.body.classList.remove('queue-open');
    msg(draft.image_pair_status === 'image_mismatch_needs_review'
      ? '警告：这套人工数据所附图纸与当前待处理图纸有一张不同。请核对并重新确认体块。'
      : `${draft.rooms.length} 个体块 · ${draft.axes.length} 条候选轴线。先确认上下层图序，再用参考线划分矩形空间。`);
  } catch (error) { msg(`打开失败：${error.message}`); }finally{persistence.switching=false;}
}

async function loadImages() {
  const pairs = await Promise.all(state.draft.floors.map((floor) => new Promise((resolve,reject) => {
    const image = new Image();
    image.onload = () => resolve([floor.floor,image]);
    image.onerror = () => reject(new Error(`无法加载 ${floor.image_name}`));
    image.src = floor.image_url;
  })));
  state.images = Object.fromEntries(pairs);
}

function updateFloorNames() {
  for (const floor of [1,2]) $('floor-'+floor+'-name').textContent = floorData(floor)?.image_name || '—';
}

function setCanvasSize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1,Math.round(rect.width*dpr));
  const h = Math.max(1,Math.round(rect.height*dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width=w; canvas.height=h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx,w:rect.width,h:rect.height};
}

function scene(floor) {
  const canvas = $('plan-canvas');
  const image = state.images[floor];
  if (!image) return null;
  const rect = canvas.getBoundingClientRect();
  const q = state.draft.north_rotation_quadrants % 4;
  const rotatedW = q%2 ? image.height : image.width;
  const rotatedH = q%2 ? image.width : image.height;
  const slotHeight = rect.height / 2;
  const size=state.draft.building_size;
  const sharedScale=sharedPixelsPerMm(rect,slotHeight);
  const bounds=floorData(floor).bounds_px;
  const densityX=(bounds[2]-bounds[0])/size.x,densityY=(bounds[3]-bounds[1])/size.y;
  const sourceScaleX=sharedScale/Math.max(.001,densityX),sourceScaleY=sharedScale/Math.max(.001,densityY);
  const scaleX=q%2?sourceScaleY:sourceScaleX,scaleY=q%2?sourceScaleX:sourceScaleY;
  const offset=(floor===2?-.5:.5)*slotHeight*state.zoom;
  return {canvas,image,q,scale:sharedScale,scaleX,scaleY,sourceScaleX,sourceScaleY,cx:rect.width/2+state.pan.x,cy:rect.height/2+offset+state.pan.y};
}

function sharedPixelsPerMm(rect,slotHeight){
  const size=state.draft.building_size;
  let scale=Infinity;
  for(const floor of [1,2]){
    const image=state.images[floor],data=floorData(floor);if(!image||!data)continue;
    const [left,top,right,bottom]=data.bounds_px;
    const totalX=image.width/Math.max(1,right-left)*size.x;
    const totalY=image.height/Math.max(1,bottom-top)*size.y;
    const q=state.draft.north_rotation_quadrants%4;
    scale=Math.min(scale,(rect.width-48)/(q%2?totalY:totalX),(slotHeight-28)/(q%2?totalX:totalY));
  }
  return (Number.isFinite(scale)?scale:1)*state.zoom;
}

function loadGuides(caseId){
  try{
    const stored=state.draft?.guides||JSON.parse(localStorage.getItem(`plan-review-guides:${caseId}`)||'[]');
    return Array.isArray(stored)?stored.filter((g)=>['x','y'].includes(g.axis)&&Number.isFinite(g.position)).map((g)=>({...g,floor:g.floor===1||g.floor===2?g.floor:2})):[];
  }catch{return []}
}

function saveGuides(){
  if(!state.draft)return;
  state.draft.guides=state.guides.map((g)=>({...g}));
  try{localStorage.setItem(`plan-review-guides:${state.draft.case_id}`,JSON.stringify(state.guides))}catch{}
}

function floorAt(point) {
  if (!state.draft) return null;
  let closest=null,score=Infinity;
  for (const floor of [2,1]) {
    const s=scene(floor);if(!s)continue;
    const halfW=(s.q%2?s.image.height*s.sourceScaleY:s.image.width*s.sourceScaleX)/2;
    const halfH=(s.q%2?s.image.width*s.sourceScaleX:s.image.height*s.sourceScaleY)/2;
    if(Math.abs(point.x-s.cx)>halfW+14||Math.abs(point.y-s.cy)>halfH+14)continue;
    const distance=Math.abs(point.y-s.cy)/Math.max(1,halfH);
    if(distance<score){closest=floor;score=distance;}
  }
  return closest;
}

function imageToScreen(floor,ix,iy) {
  const s=scene(floor); if(!s)return {x:0,y:0};
  const dx=ix-s.image.width/2,dy=iy-s.image.height/2;
  const pairs=[[dx,dy],[-dy,dx],[-dx,-dy],[dy,-dx]];
  return {x:s.cx+pairs[s.q][0]*s.scaleX,y:s.cy+pairs[s.q][1]*s.scaleY};
}

function screenToImage(floor,x,y) {
  const s=scene(floor); if(!s)return {x:0,y:0};
  const dx=(x-s.cx)/s.scaleX,dy=(y-s.cy)/s.scaleY;
  const pairs=[[dx,dy],[dy,-dx],[-dx,-dy],[-dy,dx]];
  return {x:pairs[s.q][0]+s.image.width/2,y:pairs[s.q][1]+s.image.height/2};
}

function worldToScreen(floor,x,y) {
  const f=floorData(floor),size=state.draft.building_size;
  const [left,top,right,bottom]=f.bounds_px;
  return imageToScreen(floor,left+x/size.x*(right-left),bottom-y/size.y*(bottom-top));
}

function screenToWorld(floor,x,y) {
  const f=floorData(floor),size=state.draft.building_size;
  const [left,top,right,bottom]=f.bounds_px;
  const p=screenToImage(floor,x,y);
  return {x:clamp((p.x-left)/Math.max(1,right-left)*size.x,0,size.x),y:clamp((bottom-p.y)/Math.max(1,bottom-top)*size.y,0,size.y)};
}

function alignFloorAtBasePoint(floor,point){
  const pick=state.alignmentPick;
  if(!pick){
    const world=screenToWorld(floor,point.x,point.y);
    state.alignmentPick={floor,world:{x:snap(world.x),y:snap(world.y)}};
    msg(`已记录${floor}层基准点（X${state.alignmentPick.world.x}，Y${state.alignmentPick.world.y}）。请在另一层点击同一个位置。`);return;
  }
  if(pick.floor===floor){msg('请切换到另一层，点击同一个墙角或柱网交点。');return;}
  const target=pick.world,imagePoint=screenToImage(floor,point.x,point.y),data=floorData(floor),size=state.draft.building_size;
  const [left,top,right,bottom]=data.bounds_px;
  const targetPx={x:left+target.x/size.x*(right-left),y:bottom-target.y/size.y*(bottom-top)};
  const dx=targetPx.x-imagePoint.x,dy=targetPx.y-imagePoint.y;
  recordHistory('对齐楼层图纸');
  data.bounds_px=[left+dx,top+dy,right+dx,bottom+dy].map((n)=>Math.round(n*100)/100);
  state.alignmentPick=null;render();
  msg(`两层图纸已按基准点对齐到 X${target.x}、Y${target.y} mm。保存草稿以保留调整。`);
}

function drawPolygon(ctx,points,fill,stroke,width=2,dashed=false) {
  if(points.length<2)return;
  ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
  for(const point of points.slice(1))ctx.lineTo(point.x,point.y);
  ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=width;
  ctx.setLineDash(dashed?[6,4]:[]);ctx.stroke();ctx.setLineDash([]);
}

function drawGrid(ctx,floor) {
  if(!state.showGrid)return;
  const size=state.draft.building_size;
  ctx.save();
  const cell=distanceToSegment(worldToScreen(floor,MOD,0),worldToScreen(floor,0,0),worldToScreen(floor,0,size.y));
  for(const major of [false,true]){
    if(!major&&cell<9)continue;
    ctx.strokeStyle=major?'rgba(98,62,190,.48)':'rgba(116,79,203,.32)';
    ctx.lineWidth=major?1.35:1;
    ctx.setLineDash(major?[5,4]:[2,4]);
    ctx.beginPath();
    for(let x=0;x<=size.x;x+=MOD){if((x%(MOD*5)===0)!==major)continue;const a=worldToScreen(floor,x,0),b=worldToScreen(floor,x,size.y);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y)}
    for(let y=0;y<=size.y;y+=MOD){if((y%(MOD*5)===0)!==major)continue;const a=worldToScreen(floor,0,y),b=worldToScreen(floor,size.x,y);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y)}
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function guideLine(floor,guide){
  const size=state.draft.building_size;
  return guide.axis==='x'
    ?[worldToScreen(floor,guide.position,0),worldToScreen(floor,guide.position,size.y)]
    :[worldToScreen(floor,0,guide.position),worldToScreen(floor,size.x,guide.position)];
}

function viewportGuideLine(guide,w,h){
  const floor=state.images[guide.floor]?guide.floor:(state.images[2]?2:1);
  const [a,b]=guideLine(floor,guide);
  return Math.abs(a.x-b.x)<Math.abs(a.y-b.y)
    ?[{x:a.x,y:RULER},{x:a.x,y:h}]
    :[{x:RULER,y:a.y},{x:w,y:a.y}];
}

function drawGuides(ctx,w,h){
  if(!state.showGuides||!state.draft)return;
  ctx.save();ctx.lineWidth=1.8;
  for(const guide of state.guides){
    const [a,b]=viewportGuideLine(guide,w,h);
    ctx.strokeStyle=guide.locked?'#bd623d':'rgba(4,173,205,.96)';ctx.lineWidth=guide.locked?2:1.8;ctx.setLineDash(guide.locked?[7,4]:[]);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    if(guide.locked){
      const x=(a.x+b.x)/2,y=(a.y+b.y)/2;
      ctx.setLineDash([]);ctx.fillStyle='#fffefa';ctx.strokeStyle='#bd623d';ctx.lineWidth=1.5;
      ctx.fillRect(x-8,y-8,16,16);ctx.strokeRect(x-8,y-8,16,16);
      ctx.beginPath();ctx.arc(x,y-2,4,Math.PI,0);ctx.stroke();ctx.strokeRect(x-4,y-2,8,6);
    }
  }
  ctx.setLineDash([]);
  if(state.guideDrag){
    const drag=state.guideDrag;
    const vertical=drag.axis===(state.draft.north_rotation_quadrants%2?'y':'x');
    ctx.strokeStyle='#00b6d6';ctx.setLineDash([7,4]);ctx.beginPath();
    if(vertical){ctx.moveTo(drag.point.x,RULER);ctx.lineTo(drag.point.x,h)}
    else{ctx.moveTo(RULER,drag.point.y);ctx.lineTo(w,drag.point.y)}
    ctx.stroke();ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawRulers(ctx,w,h){
  if(!state.showGuides)return;
  ctx.save();ctx.fillStyle='#263b43';ctx.fillRect(0,0,w,RULER);ctx.fillRect(0,0,RULER,h);
  ctx.strokeStyle='#d4e3e1';ctx.fillStyle='#d4e3e1';ctx.font='9px sans-serif';
  const floor=state.images[state.selectedFloor]?state.selectedFloor:2;
  if(state.draft&&state.images[floor]){
    const q=state.draft.north_rotation_quadrants%4;
    const topAxis=q%2?'y':'x',leftAxis=q%2?'x':'y';
    const size=state.draft.building_size;
    for(const [orientation,axis] of [['top',topAxis],['left',leftAxis]]){
      for(let value=0;value<=size[axis];value+=MOD){
        const p=axis==='x'?worldToScreen(floor,value,0):worldToScreen(floor,0,value);
        const coord=orientation==='top'?p.x:p.y;
        if(coord<RULER+3||coord>(orientation==='top'?w:h)-3)continue;
        const major=value%(MOD*5)===0;
        if(orientation==='top'){
          ctx.beginPath();ctx.moveTo(coord,major?9:16);ctx.lineTo(coord,RULER);ctx.stroke();
          if(major)ctx.fillText(String(value/1000),coord+2,9);
        }else{
          ctx.beginPath();ctx.moveTo(major?9:16,coord);ctx.lineTo(RULER,coord);ctx.stroke();
          if(major){ctx.save();ctx.translate(9,coord-2);ctx.rotate(-Math.PI/2);ctx.fillText(String(value/1000),0,0);ctx.restore()}
        }
      }
    }
  }
  ctx.fillStyle='#1a2d35';ctx.fillRect(0,0,RULER,RULER);
  ctx.fillStyle='#9fb6bf';ctx.font='9px sans-serif';ctx.fillText('m',6,15);
  ctx.restore();
}

function drawPlan(ctx,floor) {
  if(!state.images[floor])return;
  const s=scene(floor);
  const displayW=(s.q%2?s.image.height*s.sourceScaleY:s.image.width*s.sourceScaleX);
  const displayH=(s.q%2?s.image.width*s.sourceScaleX:s.image.height*s.sourceScaleY);
  ctx.fillStyle='#fff';ctx.fillRect(s.cx-displayW/2-3,s.cy-displayH/2-3,displayW+6,displayH+6);
  ctx.save();ctx.translate(s.cx,s.cy);ctx.rotate(s.q*Math.PI/2);ctx.scale(s.sourceScaleX,s.sourceScaleY);
  ctx.drawImage(s.image,-s.image.width/2,-s.image.height/2);ctx.restore();
  drawGrid(ctx,floor);
  const data=floorData(floor);
  const boundary=data.boundary.map(([x,y])=>worldToScreen(floor,x,y));
  drawPolygon(ctx,boundary,'rgba(37,169,139,.045)','#159c7e',2);
  const rooms=(document.getElementById("demo-show-rooms").checked?state.draft.rooms:[]).filter((r)=>(r.floor===floor||(floor===2&&r.box_min[2]===0&&r.box_max[2]===6000))&&roomLayerVisible(r));
  for(const room of rooms) {
    const [x0,y0]=room.box_min,[x1,y1]=room.box_max;
    const poly=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>worldToScreen(floor,x,y));
    const selected=room.id===state.selectedRoomId;
    const color=colors[room.type]||colors.unassigned;
    drawPolygon(ctx,poly,hexAlpha(color,selected ? .38 : .28),selected?'#bd623d':color,selected?2.5:1.5,selected||room.floor!==floor);
    if(selected)drawRoomHandles(ctx,floor,x0,y0,x1,y1);
    const mid=worldToScreen(floor,(x0+x1)/2,(y0+y1)/2);
    const label=state.types.find((t)=>t.id===room.type)?.label || '待分类';
    ctx.font=`bold ${room.type==='unassigned'?13:12}px "Microsoft YaHei UI",sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.lineJoin='round';ctx.lineWidth=4;ctx.strokeStyle='#fffefa';ctx.strokeText(label,mid.x,mid.y);
    ctx.fillStyle=room.type==='unassigned'?'#8b321d':'#20251f';ctx.fillText(label,mid.x,mid.y);
  }
  for(const axis of state.showAxes ? state.draft.axes.filter((a)=>a.floor===floor) : []) {
    const a=axis.axis==='x'?worldToScreen(floor,axis.position,0):worldToScreen(floor,0,axis.position);
    const b=axis.axis==='x'?worldToScreen(floor,axis.position,state.draft.building_size.y):worldToScreen(floor,state.draft.building_size.x,axis.position);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    ctx.strokeStyle=axis.id===state.selectedAxisId?'#fa4770':axis.kind==='virtual'?'#dc9534':'#1688cb';
    ctx.lineWidth=axis.id===state.selectedAxisId?3:1.25;
    ctx.setLineDash(axis.kind==='virtual'?[7,5]:[]);ctx.stroke();ctx.setLineDash([]);
  }
  if(state.drawing?.floor===floor&&state.drawing.current){
    const a=worldToScreen(floor,state.drawing.start.x,state.drawing.start.y);
    const b=worldToScreen(floor,state.drawing.current.x,state.drawing.current.y);
    ctx.strokeStyle='#ef4b75';ctx.lineWidth=2;ctx.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(a.x-b.x),Math.abs(a.y-b.y));
  }
  const labelY=Math.max(RULER+2,s.cy-displayH/2);
  ctx.fillStyle='#173c39';ctx.fillRect(s.cx-displayW/2,labelY,112,27);
  ctx.fillStyle='#fff';ctx.font='bold 12px "Microsoft YaHei UI",sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
  ctx.fillText(floor===2?'02  二层平面':'01  一层平面',s.cx-displayW/2+9,labelY+14);
}

function hexAlpha(hex,alpha){const v=parseInt(hex.slice(1),16);return `rgba(${v>>16},${(v>>8)&255},${v&255},${alpha})`;}

function draw3D() {
  const canvas=$('preview-3d'),{ctx,w,h}=setCanvasSize(canvas);ctx.clearRect(0,0,w,h);
  if(!state.draft)return;
  const size=state.draft.building_size;
  const scale=Math.min(w/(size.x+size.y),h/(size.x+size.y+size.z))*1.5;
  const cyaw=Math.cos(state.yaw),syaw=Math.sin(state.yaw),sp=Math.sin(state.pitch),cp=Math.cos(state.pitch);
  const project=(x,y,z)=>{
    const dx=x-size.x/2,dy=y-size.y/2;
    return {x:w/2+(dx*cyaw-dy*syaw)*scale,y:h*.67+((dx*syaw+dy*cyaw)*sp-z*cp)*scale};
  };
  const boxes=state.draft.rooms.filter(roomLayerVisible).map((room)=>({room,depth:(room.box_min[0]+room.box_max[0])*syaw+(room.box_min[1]+room.box_max[1])*cyaw})).sort((a,b)=>a.depth-b.depth);
  for(const {room} of boxes){
    const [x0,y0,z0]=room.box_min,[x1,y1,z1]=room.box_max;
    const p={a:project(x0,y0,z0),b:project(x1,y0,z0),c:project(x1,y1,z0),d:project(x0,y1,z0),e:project(x0,y0,z1),f:project(x1,y0,z1),g:project(x1,y1,z1),h:project(x0,y1,z1)};
    const base=colors[room.type]||colors.unassigned;
    const faces=[[p.a,p.b,p.f,p.e],[p.b,p.c,p.g,p.f],[p.c,p.d,p.h,p.g],[p.d,p.a,p.e,p.h]];
    for(const [i,face] of faces.entries())drawPolygon(ctx,face,hexAlpha(base,i%2?.50:.64),'rgba(8,22,28,.58)',.8);
    drawPolygon(ctx,[p.e,p.f,p.g,p.h],hexAlpha(base,room.id===state.selectedRoomId ? .94 : .8),'rgba(14,31,38,.8)',1);
  }
  ctx.fillStyle='#b8c9cb';ctx.font='11px sans-serif';ctx.textAlign='left';ctx.fillText('X →',10,h-10);ctx.fillText('Y ↗',52,h-10);ctx.fillText('Z ↑',90,h-10);
}

function render(){
  const {ctx,w,h}=setCanvasSize($('plan-canvas'));ctx.clearRect(0,0,w,h);
  if(state.draft){drawPlan(ctx,2);drawPlan(ctx,1);drawGuides(ctx,w,h)}
  else{ctx.fillStyle='#a5b9ba';ctx.font='15px "Microsoft YaHei UI",sans-serif';ctx.textAlign='center';ctx.fillText('选择一套图纸，开始在共享画布中编辑两层平面',w/2,h/2)}
  drawRulers(ctx,w,h);
  $('zoom-level').textContent=`${Math.round(state.zoom*100)}%`;
  draw3D();
}

function canvasPoint(event){const r=event.currentTarget.getBoundingClientRect();return {x:event.clientX-r.left,y:event.clientY-r.top};}
function distanceToSegment(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);}
function hitAxis(floor,p){let best=null,dist=7;for(const axis of state.showAxes ? state.draft.axes.filter((a)=>a.floor===floor) : []){
  const a=axis.axis==='x'?worldToScreen(floor,axis.position,0):worldToScreen(floor,0,axis.position);
  const b=axis.axis==='x'?worldToScreen(floor,axis.position,state.draft.building_size.y):worldToScreen(floor,state.draft.building_size.x,axis.position);
  const d=distanceToSegment(p,a,b);if(d<dist){dist=d;best=axis;}
}return best;}
function hitRoom(floor,world){return state.draft.rooms.filter((r)=>roomLayerVisible(r)&&(r.floor===floor||(floor===2&&r.box_min[2]===0&&r.box_max[2]===6000))&&world.x>=r.box_min[0]&&world.x<=r.box_max[0]&&world.y>=r.box_min[1]&&world.y<=r.box_max[1]).sort((a,b)=>(a.box_max[0]-a.box_min[0])*(a.box_max[1]-a.box_min[1])-(b.box_max[0]-b.box_min[0])*(b.box_max[1]-b.box_min[1]))[0];}
function roomDisplayedOnFloor(room,floor){return room.floor===floor||(floor===2&&room.box_min[2]===0&&room.box_max[2]===6000);}
function roomEdgeHandles(floor,room){
  const [x0,y0]=room.box_min,[x1,y1]=room.box_max;
  return [
    {axis:0,side:'min',a:worldToScreen(floor,x0,y0),b:worldToScreen(floor,x0,y1)},
    {axis:0,side:'max',a:worldToScreen(floor,x1,y0),b:worldToScreen(floor,x1,y1)},
    {axis:1,side:'min',a:worldToScreen(floor,x0,y0),b:worldToScreen(floor,x1,y0)},
    {axis:1,side:'max',a:worldToScreen(floor,x0,y1),b:worldToScreen(floor,x1,y1)}
  ].map((edge)=>({...edge,mid:{x:(edge.a.x+edge.b.x)/2,y:(edge.a.y+edge.b.y)/2}}));
}
function drawRoomHandles(ctx,floor,x0,y0,x1,y1){
  const room={box_min:[x0,y0],box_max:[x1,y1]};
  for(const {mid} of roomEdgeHandles(floor,room)){
    ctx.fillStyle='#fffefa';ctx.strokeStyle='#bd623d';ctx.lineWidth=2;
    ctx.fillRect(mid.x-7,mid.y-7,14,14);ctx.strokeRect(mid.x-7,mid.y-7,14,14);
  }
}
function hitRoomEdge(floor,point){
  const room=currentRoom();if(!room||!roomLayerVisible(room)||!roomDisplayedOnFloor(room,floor))return null;
  const edge=roomEdgeHandles(floor,room).find((item)=>Math.hypot(point.x-item.mid.x,point.y-item.mid.y)<=16);
  return edge?{room,axis:edge.axis,side:edge.side}:null;
}

function snapRoomPoint(floor,point){
  const world=screenToWorld(floor,point.x,point.y);
  const result={x:snap(world.x),y:snap(world.y)};
  if(!state.showGuides||!state.guides.length)return result;
  const rect=$('plan-canvas').getBoundingClientRect();
  const closest={x:12,y:12};
  for(const guide of state.guides){
    const [a,b]=viewportGuideLine(guide,rect.width,rect.height);
    const screenAxis=Math.abs(a.x-b.x)<Math.abs(a.y-b.y)?'x':'y';
    const distance=Math.abs(point[screenAxis]-a[screenAxis]);
    if(distance>=closest[guide.axis])continue;
    closest[guide.axis]=distance;
    const position=guide.floor===floor?guide.position:snap(screenToWorld(floor,a.x,a.y)[guide.axis]);
    result[guide.axis]=clamp(position,0,state.draft.building_size[guide.axis]);
  }
  return result;
}

function hitGuide(floor,point,includeLocked=false){
  if(!state.showGuides)return -1;
  const rect=$('plan-canvas').getBoundingClientRect();
  for(let index=state.guides.length-1;index>=0;index--){
    if(state.guides[index].locked&&!includeLocked)continue;
    const [a,b]=viewportGuideLine(state.guides[index],rect.width,rect.height);
    if(distanceToSegment(point,a,b)<9)return index;
  }
  return -1;
}

function finishGuideDrag(point){
  const drag=state.guideDrag;if(!drag)return;
  if(drag.index>=0&&state.guides[drag.index]?.locked){state.guideDrag=null;render();return;}
  const atRuler=point.x<RULER+2||point.y<RULER+2;
  const floor=atRuler?null:(drag.index>=0?drag.floor:(floorAt(point)||null));
  if(atRuler){
    if(drag.index>=0)state.guides.splice(drag.index,1);
  }else if(floor!==null){
    const value=snap(screenToWorld(floor,point.x,point.y)[drag.axis]);
    const position=clamp(value,0,state.draft.building_size[drag.axis]);
    if(drag.index>=0)state.guides[drag.index].position=position;
    else if(!state.guides.some((g)=>g.axis===drag.axis&&g.position===position&&g.floor===floor))state.guides.push({axis:drag.axis,position,floor});
    state.selectedFloor=floor;
  }
  state.guideDrag=null;saveGuides();
  if(JSON.stringify(drag.before)!==JSON.stringify(captureWorkspace()))pushHistorySnapshot(drag.index>=0?'移动参考线':'新增参考线',drag.before);
  render();
  msg(`${state.guides.length} 条分割参考线。绘制矩形体块时会优先吸附。`);
}

function pointerDown(event,floor){
  if(!state.draft)return;
  if(event.button===2)return;
  const p=canvasPoint(event);
  if(event.button===1||event.shiftKey){event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);state.drag={kind:'pan',start:p,origin:{...state.pan}};return;}
  if(event.button===0&&floor!==null&&(state.mode==='select'||state.mode==='assign')){
    const edge=hitRoomEdge(floor,p);
    if(edge){event.currentTarget.setPointerCapture(event.pointerId);state.drag={kind:'room_edge',floor,id:edge.room.id,axis:edge.axis,side:edge.side,historyRecorded:false};return;}
  }
  if(state.showGuides&&event.button===0){
    const q=state.draft.north_rotation_quadrants%4;
    const axis=p.y<RULER&&p.x>=RULER?(q%2?'x':'y'):p.x<RULER&&p.y>=RULER?(q%2?'y':'x'):null;
    const index=!axis&&state.mode==='select'?hitGuide(floor,p):-1;
    if(axis||index>=0){
      event.currentTarget.setPointerCapture(event.pointerId);
      state.guideDrag={axis:axis||state.guides[index].axis,index,point:p,floor:index>=0?state.guides[index].floor:null,before:captureWorkspace()};
      msg(index>=0?'拖动参考线；拖回标尺可删除。':'将参考线拖到图纸上。');
      render();return;
    }
  }
  if(floor===null)return;
  event.currentTarget.setPointerCapture(event.pointerId);
  const w=screenToWorld(floor,p.x,p.y);state.selectedFloor=floor;
  if(state.mode==='calibrate'){
    const imagePoint=screenToImage(floor,p.x,p.y);
    if(!state.calibration){state.calibration={floor,first:imagePoint};msg(`${floor} 层校准：请点击建筑图像的另一角。`)}
    else if(state.calibration.floor===floor){
      const a=state.calibration.first,b=imagePoint;
      if(Math.abs(a.x-b.x)>50&&Math.abs(a.y-b.y)>50){
        recordHistory('校准图纸边框');
        floorData(floor).bounds_px=[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)].map((n)=>Math.round(n*100)/100);
        msg(`${floor} 层图纸边框已重新校准，请核对体块叠加。`);render();
      }
      state.calibration=null;
    }return;
  }
  if(state.mode==='align'){alignFloorAtBasePoint(floor,p);return;}
  if(state.mode==='axis_x'||state.mode==='axis_y'){
    const axis=state.mode==='axis_x'?'x':'y',position=snap(w[axis]);
    const item={id:`axis_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,floor,axis,position,kind:$('axis-kind').value,confidence:'reviewer'};
    recordHistory('新增轴线');
    state.draft.axes.push(item);state.selectedAxisId=item.id;updateSelection();render();msg(`${floor} 层新增${item.kind==='wall'?'墙':'虚拟'}轴线 ${axis.toUpperCase()}=${position}`);return;
  }
  if(state.mode==='room'){const start=snapRoomPoint(floor,p);state.drawing={floor,start,current:{...start}};return;}
  if(state.mode==='assign'){
    const room=hitRoom(floor,w);if(room)attachLayerToRoom(room);else msg('请点击一个可见的待分类体块。');
    return;
  }
  const axis=hitAxis(floor,p);
  if(axis){state.selectedAxisId=axis.id;state.drag={kind:'axis',floor,id:axis.id,old:axis.position,historyRecorded:false};updateSelection();render();return;}
  const room=hitRoom(floor,w);
  state.selectedRoomId=room?.id||null;
  if(!room)state.selectedAxisId=null;updateSelection();render();
}

function moveSharedAxis(axis,newValue,oldValue){
  const index=axis.axis==='x'?0:1,limit=state.draft.building_size[axis.axis];
  newValue=clamp(newValue,0,limit);
  for(const candidate of state.draft.axes)if(candidate.axis===axis.axis&&candidate.position===oldValue)candidate.position=newValue;
  for(const room of state.draft.rooms)for(const key of ['box_min','box_max'])if(room[key][index]===oldValue)room[key][index]=newValue;
  for(const floor of state.draft.floors)for(const point of floor.boundary)if(point[index]===oldValue)point[index]=newValue;
}

function pointerMove(event,floor){
  if(!state.draft)return;
  const p=canvasPoint(event);
  if(state.guideDrag){state.guideDrag.point=p;render();return;}
  if(state.drag?.kind==='pan'){state.pan={x:state.drag.origin.x+p.x-state.drag.start.x,y:state.drag.origin.y+p.y-state.drag.start.y};render();return;}
  floor=state.drawing?.floor||state.drag?.floor||floor;
  if(!state.drag&&(state.mode==='select'||state.mode==='assign'))$('plan-canvas').style.cursor=floor!==null&&hitRoomEdge(floor,p)?'pointer':'crosshair';
  if(floor===null){$('position').textContent='—';return;}
  const w=screenToWorld(floor,p.x,p.y);
  $('position').textContent=`${floor}F · X ${snap(w.x)} / Y ${snap(w.y)} mm`;
  if(state.drawing?.floor===floor){state.drawing.current=snapRoomPoint(floor,p);render();return;}
  if(!state.drag)return;
  if(state.drag.floor!==floor)return;
  if(state.drag.kind==='axis'){
    const axis=state.draft.axes.find((a)=>a.id===state.drag.id);if(!axis)return;
    const value=snap(w[axis.axis]);if(value!==axis.position){if(!state.drag.historyRecorded){recordHistory('移动轴线');state.drag.historyRecorded=true;}moveSharedAxis(axis,value,axis.position);updateSelection();render();}
  }else if(state.drag.kind==='room_edge'){
    const room=state.draft.rooms.find((item)=>item.id===state.drag.id);if(!room)return;
    const axis=state.drag.axis,key=state.drag.side==='min'?'box_min':'box_max';
    const worldAxis=axis===0?'x':'y';
    const next=clamp(snap(w[worldAxis]),0,state.draft.building_size[worldAxis]);
    if(state.drag.side==='min'?room.box_max[axis]-next<MOD:next-room.box_min[axis]<MOD)return;
    if(room[key][axis]!==next){if(!state.drag.historyRecorded){recordHistory('调整体块边界');state.drag.historyRecorded=true;}room[key][axis]=next;updateSelection();renderRoomList();render();}
  }
}

function pointerUp(event,floor){
  if(state.guideDrag){finishGuideDrag(canvasPoint(event));return;}
  if(state.drag?.kind==='room_edge'){state.drag=null;render();msg('体块边界已按 300 mm 网格调整。');return;}
  floor=state.drawing?.floor||state.drag?.floor||floor;
  if(state.drawing?.floor===floor){
    const a=state.drawing.start,b=state.drawing.current||a;
    const x0=Math.min(a.x,b.x),x1=Math.max(a.x,b.x),y0=Math.min(a.y,b.y),y1=Math.max(a.y,b.y);
    if(x1-x0>=300&&y1-y0>=300){
      const z=floor===1?0:3000;
      const room={id:`room_${Date.now()}`,type:$('new-room-type').value,floor,box_min:[x0,y0,z],box_max:[x1,y1,z+3000],source:'reviewer'};
      if(room.type==='stairs'){room.floor=1;room.box_min[2]=0;room.box_max[2]=6000;}
      recordHistory('新增体块');
      state.draft.rooms.push(room);state.selectedRoomId=room.id;updateSelection();renderRoomList();msg('已添加矩形体块；可以继续绘制，之后在体块功能清单中统一分类。');
    }
    state.drawing=null;
  }
  state.drag=null;render();
}

function updateSelection(){
  const room=currentRoom(),axis=currentAxis();
  $('room-editor').hidden=!room;$('axis-editor').hidden=!axis;$('selection-empty').hidden=!!room||!!axis;
  $('selection-kind').textContent=[room?'体块':'',axis?'轴线':''].filter(Boolean).join(' + ')||'未选择';
  if(room){
    $('room-type').value=room.type;
    $('double-height').checked=room.box_min[2]===0&&room.box_max[2]===6000;
    $('double-height').disabled=!['living_room','stairs'].includes(room.type)||room.floor!==1;
    $('room-coords').textContent=`${room.floor}F · (${room.box_min[0]}, ${room.box_min[1]}, ${room.box_min[2]}) → (${room.box_max[0]}, ${room.box_max[1]}, ${room.box_max[2]})`;
    $('room-width').textContent=room.box_max[0]-room.box_min[0];
    $('room-depth').textContent=room.box_max[1]-room.box_min[1];
    $('resize-width').textContent=room.box_max[0]-room.box_min[0];
    $('resize-depth').textContent=room.box_max[1]-room.box_min[1];
  }
  if(axis){$('selected-axis-kind').value=axis.kind;$('axis-position').textContent=`${axis.floor}F · ${axis.axis.toUpperCase()} = ${axis.position} mm`}
}

function applyRoomType(room,type){
  room.type=type;
  if(type==='stairs'){room.floor=1;room.box_min[2]=0;room.box_max[2]=6000;}
  else if(room.box_max[2]-room.box_min[2]===6000&&type!=='living_room'){room.box_max[2]=3000;}
}

function openResizeDialog(){
  const room=currentRoom();if(!room){msg('先选中一个矩形体块，再打开尺寸调整。');return;}
  $('resize-width').textContent=room.box_max[0]-room.box_min[0];
  $('resize-depth').textContent=room.box_max[1]-room.box_min[1];
  updateResizeStepLabels();
  $('resize-dialog').hidden=false;$('close-resize-dialog').focus();
}

function updateResizeStepLabels(){
  const step=Number($('resize-step').value||300);
  document.querySelectorAll('[data-edge]').forEach((button)=>button.textContent=`${button.dataset.edgeLabel} ${step}`);
}

function closeResizeDialog(){$('resize-dialog').hidden=true;}

function moveRoomEdge(edge,operation){
  const room=currentRoom();if(!room)return;
  const mapping=[
    {left:[0,'min',-1],right:[0,'max',1],top:[1,'max',1],bottom:[1,'min',-1]},
    {left:[1,'min',-1],right:[1,'max',1],top:[0,'min',-1],bottom:[0,'max',1]},
    {left:[0,'max',1],right:[0,'min',-1],top:[1,'min',-1],bottom:[1,'max',1]},
    {left:[1,'max',1],right:[1,'min',-1],top:[0,'max',1],bottom:[0,'min',-1]}
  ][state.draft.north_rotation_quadrants%4][edge];
  if(!mapping)return;
  const [axis,side,outwardSign]=mapping;
  const delta=Number($('resize-step').value||300)*outwardSign*(operation==='out'?1:-1),key=side==='min'?'box_min':'box_max';
  const next=room[key][axis]+delta,min=room.box_min[axis],max=room.box_max[axis];
  if(side==='min'){
    if(next<0||max-next<MOD){msg('该边不能继续向外或向内调整：需保留至少 300 mm。');return;}
    recordHistory('调整体块边界');
    room.box_min[axis]=next;
  }else{
    if(next>state.draft.building_size[axis===0?'x':'y']||next-min<MOD){msg('该边不能继续向外或向内调整：需保留至少 300 mm，且不能超出建筑范围。');return;}
    recordHistory('调整体块边界');
    room.box_max[axis]=next;
  }
  updateSelection();renderRoomList();render();
}

function attachLayerToRoom(room){
  if(room.type!=='unassigned'){
    msg(`这个体块已分为${state.types.find((t)=>t.id===room.type)?.label||room.type}。可在功能清单中直接修改。`);return;
  }
  const type=state.types.find((item)=>item.id===state.activeRoomType);if(!type)return;
  recordHistory('附着功能图层');
  applyRoomType(room,type.id);state.selectedRoomId=room.id;state.selectedAxisId=null;
  updateSelection();renderRoomList();render();msg(`已将${type.label}图层附着到体块。`);
}

function closeRoomContextMenu(){document.querySelector('.room-context-menu')?.remove();}

function openGuideContextMenu(index,clientX,clientY){
  const guide=state.guides[index];if(!guide)return;
  closeRoomContextMenu();
  const menu=document.createElement('div');menu.className='room-context-menu';menu.setAttribute('role','menu');
  const title=document.createElement('div');title.className='room-context-title';title.textContent=`${guide.axis.toUpperCase()} 轴参考线 · ${guide.position} mm`;menu.append(title);
  const lock=document.createElement('button');lock.type='button';lock.className='guide-menu-item';lock.textContent=guide.locked?'解锁参考线':'锁定参考线';
  lock.onclick=()=>{recordHistory(guide.locked?'解锁参考线':'锁定参考线');guide.locked=!guide.locked;saveGuides();closeRoomContextMenu();render();msg(guide.locked?'参考线已锁定，仍可用于吸附。':'参考线已解锁，可以拖动或删除。')};menu.append(lock);
  const remove=document.createElement('button');remove.type='button';remove.className='guide-menu-item danger';remove.textContent=guide.locked?'先解锁后删除':'删除参考线';remove.disabled=!!guide.locked;
  remove.onclick=()=>{recordHistory('删除参考线');state.guides.splice(index,1);saveGuides();closeRoomContextMenu();render();msg('参考线已删除。')};menu.append(remove);
  document.body.append(menu);
  const bounds=menu.getBoundingClientRect();
  menu.style.left=`${Math.max(8,Math.min(clientX,window.innerWidth-bounds.width-8))}px`;
  menu.style.top=`${Math.max(8,Math.min(clientY,window.innerHeight-bounds.height-8))}px`;
}

function openRoomContextMenu(room,clientX,clientY){
  closeRoomContextMenu();
  const menu=document.createElement('div');menu.className='room-context-menu';menu.setAttribute('role','menu');
  const title=document.createElement('div');title.className='room-context-title';title.textContent='切换功能图层';menu.append(title);
  for(const type of state.types){
    const item=document.createElement('button');item.type='button';item.className='room-context-item';item.setAttribute('role','menuitem');
    const swatch=document.createElement('span');swatch.className='layer-swatch';swatch.style.background=colors[type.id]||colors.unassigned;
    const label=document.createElement('span');label.textContent=type.label;
    const mark=document.createElement('span');mark.className='room-context-current';mark.textContent=room.type===type.id?'✓':'';
    item.append(swatch,label,mark);
    item.onclick=()=>{if(room.type!==type.id){recordHistory('修改体块功能');applyRoomType(room,type.id)}state.selectedRoomId=room.id;state.selectedAxisId=null;state.selectedFloor=room.floor;closeRoomContextMenu();updateSelection();renderRoomList();render();msg(`已将体块功能切换为${type.label}。`)};
    menu.append(item);
  }
  document.body.append(menu);
  const bounds=menu.getBoundingClientRect();
  menu.style.left=`${Math.max(8,Math.min(clientX,window.innerWidth-bounds.width-8))}px`;
  menu.style.top=`${Math.max(8,Math.min(clientY,window.innerHeight-bounds.height-8))}px`;
}

function renderRoomList(){
  const list=$('room-list');if(!list)return;
  const rooms=state.draft?.rooms||[],filter=$('room-list-filter')?.value||'all';
  const visible=rooms.filter((room)=>filter==='all'||(filter==='unassigned'&&room.type==='unassigned')||(filter==='1'&&room.floor===1)||(filter==='2'&&room.floor===2));
  $('room-count').textContent=`${rooms.length} 个 · ${rooms.filter((r)=>r.type==='unassigned').length} 待分类`;
  renderFunctionLayers();
  list.replaceChildren();
  if(!visible.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=rooms.length?'当前筛选下没有体块。':'画完体块后，可在这里快速分配功能。';list.append(empty);return;}
  visible.forEach((room)=>{
    const row=document.createElement('div');row.className='room-list-row';
    const check=document.createElement('input');check.type='checkbox';check.checked=state.batchRoomIds.has(room.id);check.setAttribute('aria-label',`勾选${room.floor}层体块`);
    check.onchange=()=>{check.checked?state.batchRoomIds.add(room.id):state.batchRoomIds.delete(room.id);updateBatchCount()};
    const pick=document.createElement('button');pick.type='button';pick.className=`room-list-pick${room.id===state.selectedRoomId?' active':''}`;
    pick.textContent=`${room.floor}层 · 体块 ${String(rooms.indexOf(room)+1).padStart(2,'0')}`;
    pick.title=`X ${room.box_min[0]}–${room.box_max[0]}，Y ${room.box_min[1]}–${room.box_max[1]} mm`;
    pick.onclick=()=>{if(state.mode==='assign'){attachLayerToRoom(room);return;}state.selectedRoomId=room.id;state.selectedAxisId=null;state.selectedFloor=room.floor;updateSelection();renderRoomList();render()};
    const type=document.createElement('select');type.className='room-list-type';type.setAttribute('aria-label',`${room.floor}层体块功能`);
    type.innerHTML='<option value="unassigned">待分类</option>'+state.types.map((item)=>`<option value="${item.id}">${item.label}</option>`).join('');type.value=room.type;
    type.onchange=()=>{if(room.type===type.value)return;recordHistory('修改体块功能');applyRoomType(room,type.value);updateSelection();renderRoomList();render()};
    row.append(check,pick,type);list.append(row);
  });
  updateBatchCount();
}

function updateBatchCount(){
  const button=$('apply-batch-room-type');if(button)button.textContent=`附着当前图层到勾选体块（${state.batchRoomIds.size}）`;
}

function renderFunctionLayers(){
  const host=$('function-layers');if(!host)return;
  const active=state.types.find((type)=>type.id===state.activeRoomType);
  $('active-layer-name').textContent=`当前：${active?.label||'未选择'}`;
  host.replaceChildren();
  for(const type of state.types){
    const row=document.createElement('div');row.className=`function-layer${type.id===state.activeRoomType?' active':''}`;
    const choose=document.createElement('input');choose.type='radio';choose.name='active-function-layer';choose.checked=type.id===state.activeRoomType;choose.setAttribute('aria-label',`选择${type.label}图层`);
    choose.onchange=()=>selectFunctionLayer(type.id);
    const swatch=document.createElement('span');swatch.className='layer-swatch';swatch.style.background=colors[type.id]||colors.unassigned;
    const detail=document.createElement('span');detail.className='layer-name';detail.textContent=type.label;
    const count=document.createElement('small');count.className='layer-count';count.textContent=String((state.draft?.rooms||[]).filter((room)=>room.type===type.id).length);
    const visible=document.createElement('input');visible.type='checkbox';visible.checked=state.visibleRoomTypes.has(type.id);visible.setAttribute('aria-label',`${visible.checked?'隐藏':'显示'}${type.label}图层`);visible.title=visible.checked?'隐藏此功能图层':'显示此功能图层';
    visible.onchange=()=>{visible.checked?state.visibleRoomTypes.add(type.id):state.visibleRoomTypes.delete(type.id);renderFunctionLayers();render()};
    row.onclick=(event)=>{if(event.target!==visible&&event.target!==choose)selectFunctionLayer(type.id)};
    row.append(choose,swatch,detail,count,visible);host.append(row);
  }
  updateBatchCount();
}

function selectFunctionLayer(typeId){
  state.activeRoomType=typeId;state.mode='assign';state.alignmentPick=null;
  if(!drawerPinned('inspector'))document.body.classList.remove('inspector-open');$('inspector-toggle').setAttribute('aria-pressed',String(drawerPinned('inspector')));
  document.querySelectorAll('[data-mode]').forEach((button)=>button.classList.toggle('active',button.dataset.mode==='assign'));
  renderFunctionLayers();
  const label=state.types.find((type)=>type.id===typeId)?.label||'当前';
  msg(`已选${label}图层。点击待分类体块即可附着，或勾选体块后批量附着。`);
}

function applySize(){
  if(!state.draft)return;
  const old=state.draft.building_size;
  const width=snap(Number($('size-x').value)),depth=snap(Number($('size-y').value));
  if(width<300||depth<300){msg('尺寸无效');return;}
  if(width===old.x&&depth===old.y)return;
  const fx=width/old.x,fy=depth/old.y;
  recordHistory('缩放项目尺寸');
  for(const room of state.draft.rooms){for(const key of ['box_min','box_max']){room[key][0]=snap(room[key][0]*fx);room[key][1]=snap(room[key][1]*fy)}}
  for(const axis of state.draft.axes)axis.position=snap(axis.position*(axis.axis==='x'?fx:fy));
  for(const floor of state.draft.floors)for(const point of floor.boundary){point[0]=snap(point[0]*fx);point[1]=snap(point[1]*fy)}
  old.x=width;old.y=depth;state.draft.scale_source='reviewer';updateSelection();render();msg('尺寸和所有几何坐标已按比例缩放到 300 mm 模数。');
}

function pointInPolygon(x,y,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
  if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;
}return inside;}

function gridFromAxes(){
  if(!state.draft)return;
  if(state.draft.rooms.length&&!confirm('这会替换当前体块，仅保留轴线。继续吗？'))return;
  const rooms=[];
  for(const floor of [1,2]){
    const xs=[...new Set(state.draft.axes.filter((a)=>a.floor===floor&&a.axis==='x').map((a)=>a.position))].sort((a,b)=>a-b);
    const ys=[...new Set(state.draft.axes.filter((a)=>a.floor===floor&&a.axis==='y').map((a)=>a.position))].sort((a,b)=>a-b);
    if((xs.length-1)*(ys.length-1)>150){msg(`${floor} 层轴线太多。先删除误识别的家具线再生成，最多 150 格。`);return;}
    for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++){
      if(xs[i+1]-xs[i]<300||ys[j+1]-ys[j]<300)continue;
      const midX=(xs[i]+xs[i+1])/2,midY=(ys[j]+ys[j+1])/2;
      if(!pointInPolygon(midX,midY,floorData(floor).boundary))continue;
      const z=floor===1?0:3000;
      rooms.push({id:`cell_${floor}_${i}_${j}`,type:'unassigned',floor,box_min:[xs[i],ys[j],z],box_max:[xs[i+1],ys[j+1],z+3000],source:'axis_grid'});
    }
  }
  recordHistory('按轴线生成体块');
  state.draft.rooms=rooms;state.selectedRoomId=null;updateSelection();renderRoomList();render();msg(`已生成 ${rooms.length} 个矩形候选，请合并同一功能区域并分类。`);
}

function mergeSameType(){
  if(!state.draft)return;
  const before=captureWorkspace();
  let merges=0,changed=true;
  while(changed){
    changed=false;
    outer:for(let i=0;i<state.draft.rooms.length;i++)for(let j=i+1;j<state.draft.rooms.length;j++){
      const a=state.draft.rooms[i],b=state.draft.rooms[j];
      if(a.type!==b.type||a.floor!==b.floor||a.box_min[2]!==b.box_min[2]||a.box_max[2]!==b.box_max[2])continue;
      const sameX=a.box_min[0]===b.box_min[0]&&a.box_max[0]===b.box_max[0];
      const sameY=a.box_min[1]===b.box_min[1]&&a.box_max[1]===b.box_max[1];
      const touchY=a.box_max[1]===b.box_min[1]||b.box_max[1]===a.box_min[1];
      const touchX=a.box_max[0]===b.box_min[0]||b.box_max[0]===a.box_min[0];
      if((sameX&&touchY)||(sameY&&touchX)){
        a.box_min[0]=Math.min(a.box_min[0],b.box_min[0]);a.box_min[1]=Math.min(a.box_min[1],b.box_min[1]);
        a.box_max[0]=Math.max(a.box_max[0],b.box_max[0]);a.box_max[1]=Math.max(a.box_max[1],b.box_max[1]);
        state.draft.rooms.splice(j,1);merges++;changed=true;break outer;
      }
    }
  }
  if(merges)pushHistorySnapshot('合并相邻体块',before);
  updateSelection();renderRoomList();render();msg(`合并了 ${merges} 对相邻同类矩形。`);
}

function splitSelected(){
  const room=currentRoom(),axis=currentAxis();
  if(!room||!axis){msg('先选体块，再选穿过该体块的轴线。');return;}
  if(axis.floor!==room.floor){msg('轴线和体块不在同一层。');return;}
  const index=axis.axis==='x'?0:1,p=axis.position;
  if(p<=room.box_min[index]||p>=room.box_max[index]){msg('轴线没有穿过体块内部。');return;}
  const second=structuredClone(room);second.id=`room_${Date.now()}`;
  recordHistory('切分体块');
  room.box_max[index]=p;second.box_min[index]=p;
  state.draft.rooms.push(second);updateSelection();renderRoomList();render();msg('体块已按轴线切为两个矩形。');
}

function deleteSelectedRoom(){const id=state.selectedRoomId;if(!id)return;recordHistory('删除体块');state.draft.rooms=state.draft.rooms.filter((r)=>r.id!==id);state.selectedRoomId=null;updateSelection();renderRoomList();render();}
function deleteSelectedAxis(){const id=state.selectedAxisId;if(!id)return;recordHistory('删除轴线');state.draft.axes=state.draft.axes.filter((a)=>a.id!==id);state.selectedAxisId=null;updateSelection();render();}

async function validateCase(){if(!state.draft)return;try{
  const result=await api(`/api/cases/${state.draft.case_id}/validate`,{method:'POST',body:JSON.stringify(state.draft)});
  state.qc=result;renderQc();msg(result.valid?'几何检测通过，可人工确认导出。':`发现 ${result.issues.filter((i)=>i.level==='error').length} 项需要修正。`);
}catch(error){msg(`检测失败：${error.message}`)}}

function renderQc(){
  const result=state.qc;
  if(!result){$('qc-count').textContent='未运行';$('qc-list').innerHTML='<p class="muted">保存前检查体块类别、300 mm 模数、两层高度与重叠。</p>';return;}
  $('qc-count').textContent=result.valid?'通过':`${result.issues.length} 项`;
  $('qc-list').innerHTML=result.issues.length?result.issues.map((i)=>`<div class="qc-item ${i.level}"></div>`).join(''):'<div class="qc-item">全部规则通过</div>';
  [...$('qc-list').children].forEach((node,i)=>{if(result.issues[i])node.textContent=result.issues[i].detail});
}

async function saveCase(automatic=false){
  if(persistence.approving)return false;
  if(!state.draft)return true;
  if(persistence.pending)return persistence.pending;
  if(persistence.blocked){$('save-state').textContent='版本冲突 · 请下载草稿并打开最新版';return false;}
  if(state.draft.status==='approved')return !isDirty();
  cacheDraft();
  const draft=structuredClone(state.draft),content=draftContent(draft);
  $('save-state').textContent='保存中…';
  persistence.pending=(async()=>{
    try{
      const r=await api(`/api/cases/${draft.case_id}/save`,{method:'POST',body:JSON.stringify(draft)});
      if(state.draft?.case_id===draft.case_id){
        state.draft.status='draft';state.draft.revision=r.revision;persistence.baseline=content;
        $('case-status').textContent='草稿';$('save-state').textContent=isDirty()?'待同步':'已保存';
        if(isDirty())cacheDraft();else try{localStorage.removeItem(recoveryKey(draft.case_id));}catch{}
      }
      if(!automatic){msg(`草稿已保存 · 第 ${r.revision} 版`);refreshCases().catch(()=>{});}
      return true;
    }catch(error){
      if(error.status===409){cacheDraft();persistence.blocked=true;document.querySelector('.workspace').inert=true;document.querySelector('.inspector').inert=true;}
      $('save-state').textContent=error.status===409?'版本冲突 · 修改已保留':persistence.localError?'保存失败 · 请下载草稿':'保存失败 · 本地已暂存';
      msg(`保存失败：${error.message}`);return false;
    }
  })();
  try{return await persistence.pending;}finally{persistence.pending=null;}
}

async function approveCase(){
  if(!state.draft||persistence.approving||persistence.blocked)return;
  if(!await saveCase(true))return;
  persistence.approving=true;$('approve-btn').disabled=true;
  document.querySelector('.workspace').inert=true;document.querySelector('.inspector').inert=true;
  try{
    await validateCase();if(!state.qc?.valid){msg('检测未通过，不能导出。');return;}
    if(!confirm(`确认 ID${state.draft.case_id} 的两层图纸、轴线、功能类别和三维体块均已人工检查？`))return;
    const r=await api(`/api/cases/${state.draft.case_id}/approve`,{method:'POST',body:JSON.stringify({...state.draft,_reviewer_confirmed:true})});
    state.draft.status='approved';state.draft.revision=r.revision;persistence.baseline=draftContent();
    try{localStorage.removeItem(recoveryKey(state.draft.case_id));}catch{}
    $('save-state').textContent='已导出';$('case-status').textContent='已导出';msg(`已导出：${r.rooms} 个体块`);await refreshCases();
  }catch(error){
    if(error.status===409){cacheDraft();persistence.blocked=true;$('save-state').textContent='版本冲突 · 请打开最新版';}
    msg(`导出失败：${error.message}`);
  }finally{
    persistence.approving=false;$('approve-btn').disabled=false;
    document.querySelector('.workspace').inert=persistence.blocked;document.querySelector('.inspector').inert=persistence.blocked;
  }
}

async function visionCase(){if(!state.draft||persistence.blocked||persistence.approving)return;
  if(state.draft.rooms.length&&!confirm('载入预置标注会替换当前体块。建议先保存草稿。继续吗？'))return;
  const button=$('vision-btn');button.disabled=true;msg('正在载入预先制备的示例标注…');
  const requested=structuredClone(state.draft),before=draftContent();
  try{const result=await api(`/api/cases/${requested.case_id}/vision?provider=${encodeURIComponent($('vision-provider').value)}`,{method:'POST',body:JSON.stringify(requested)});
    if(state.draft?.case_id!==requested.case_id||draftContent()!==before){msg('识别期间案例或体块已改变，未覆盖当前编辑。请在保存后重新识别。');return;}
    recordHistory('视觉识别候选');result.revision=state.draft.revision;state.draft=result;cacheDraft();
    state.selectedRoomId=null;state.selectedAxisId=null;state.qc=null;state.batchRoomIds.clear();await loadImages();updateFloorNames();updateSelection();renderRoomList();renderQc();render();msg(`预置标注已载入：${state.draft.rooms.length} 个体块。请检查图纸层序、尺寸、建筑边界与开放空间。`);
  }catch(error){msg(`视觉识别失败：${error.message}`)}finally{button.disabled=false}
}

function installEvents(){
  $('case-search').oninput=renderCaseList;$('case-filter').onchange=renderCaseList;
  $('vision-provider').onchange=updateVisionStatus;
  $('show-grid').onchange=(e)=>{state.showGrid=e.target.checked;render()};
  $('show-guides').onchange=(e)=>{state.showGuides=e.target.checked;render()};
  $('room-list-filter').onchange=renderRoomList;
  $('select-unassigned').onclick=()=>{for(const room of state.draft?.rooms||[])if(room.type==='unassigned')state.batchRoomIds.add(room.id);renderRoomList()};
  $('clear-room-checks').onclick=()=>{state.batchRoomIds.clear();renderRoomList()};
  $('apply-batch-room-type').onclick=()=>{
    if(!state.batchRoomIds.size){msg('先勾选要分类的体块。');return;}
    const type=state.activeRoomType;
    const pending=(state.draft?.rooms||[]).filter((room)=>state.batchRoomIds.has(room.id)&&room.type==='unassigned');
    let changed=0;if(pending.length)recordHistory('批量附着功能图层');
    for(const room of pending){applyRoomType(room,type);changed++}
    state.batchRoomIds.clear();updateSelection();renderRoomList();render();msg(changed?`已将 ${changed} 个待分类体块设为${state.types.find((t)=>t.id===type)?.label||'所选功能'}。`:'勾选项中没有待分类体块；已分类体块可在清单中直接修改。');
  };
  $('clear-guides-btn').onclick=()=>{if(!state.draft)return;const removable=state.guides.filter((guide)=>!guide.locked);if(!removable.length){msg('没有可清除的未锁定参考线。');return;}recordHistory('清除参考线');state.guides=state.guides.filter((guide)=>guide.locked);state.guideDrag=null;saveGuides();render();msg(`已清除 ${removable.length} 条未锁定参考线；锁定的参考线已保留。`)};
  $('show-axes').onchange=(e)=>{state.showAxes=e.target.checked;render()};
  $('queue-toggle').onclick=()=>toggleDrawer('queue');
  $('inspector-toggle').onclick=()=>toggleDrawer('inspector');
  $('queue-pin').onclick=()=>toggleDrawerPin('queue');
  $('inspector-pin').onclick=()=>toggleDrawerPin('inspector');
  $('undo-btn').onclick=undoHistory;$('redo-btn').onclick=redoHistory;refreshHistoryButtons();
  $('drawer-backdrop').onclick=()=>{if(!drawerPinned('queue'))document.body.classList.remove('queue-open');if(!drawerPinned('inspector'))document.body.classList.remove('inspector-open');$('inspector-toggle').setAttribute('aria-pressed',String(drawerPinned('inspector')));render()};
  $('open-resize-dialog').onclick=openResizeDialog;
  $('close-resize-dialog').onclick=closeResizeDialog;
  $('resize-dialog').onclick=(event)=>{if(event.target.id==='resize-dialog')closeResizeDialog()};
  document.querySelectorAll('[data-edge]').forEach((button)=>button.onclick=()=>moveRoomEdge(button.dataset.edge,button.dataset.edgeOperation));
  $('resize-step').onchange=updateResizeStepLabels;
  document.querySelectorAll('[data-mode]').forEach((button)=>button.onclick=()=>{
    state.mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach((b)=>b.classList.toggle('active',b===button));
    if(state.mode==='axis_x'||state.mode==='axis_y'){state.showAxes=true;$('show-axes').checked=true}
    if(state.mode!=='align')state.alignmentPick=null;
    msg({select:'选择体块或移动轴线。',calibrate:'依次点击建筑图像边框的两角。',axis_x:'点击图纸增加竖向轴线。',axis_y:'点击图纸增加横向轴线。',room:'拖动绘制矩形体块；靠近参考线时优先吸附。',assign:`点击待分类体块，附着${state.types.find((t)=>t.id===state.activeRoomType)?.label||'当前'}功能图层。`,align:'先点击一层或二层的墙角／柱网交点，再到另一层点击同一点。'}[state.mode]);
  });
  const canvas=$('plan-canvas');
  canvas.addEventListener('pointerdown',(e)=>pointerDown(e,floorAt(canvasPoint(e))));
  canvas.addEventListener('pointermove',(e)=>pointerMove(e,floorAt(canvasPoint(e))));
  canvas.addEventListener('pointerup',(e)=>pointerUp(e,floorAt(canvasPoint(e))));
  canvas.addEventListener('pointercancel',(e)=>pointerUp(e,floorAt(canvasPoint(e))));
  canvas.addEventListener('contextmenu',(e)=>{
    e.preventDefault();if(!state.draft)return;
    const p=canvasPoint(e),floor=floorAt(p),guideIndex=hitGuide(floor,p,true);
    if(guideIndex>=0){openGuideContextMenu(guideIndex,e.clientX,e.clientY);return;}
    const room=floor===null?null:hitRoom(floor,screenToWorld(floor,p.x,p.y));
    if(room){state.selectedRoomId=room.id;state.selectedFloor=room.floor;state.selectedAxisId=null;updateSelection();render();openRoomContextMenu(room,e.clientX,e.clientY);return;}
  });
  document.addEventListener('pointerdown',(event)=>{if(!event.target.closest('.room-context-menu'))closeRoomContextMenu()});
  canvas.addEventListener('wheel',(e)=>{
    e.preventDefault();if(!state.draft)return;
    const p=canvasPoint(e),floor=floorAt(p)||state.selectedFloor||2;
    const imagePoint=screenToImage(floor,p.x,p.y);
    state.zoom=clamp(state.zoom*(e.deltaY<0?1.12:1/1.12),.7,8);
    const after=imageToScreen(floor,imagePoint.x,imagePoint.y);
    state.pan.x+=p.x-after.x;state.pan.y+=p.y-after.y;render();
  },{passive:false});
  const preview=$('preview-3d');preview.addEventListener('pointerdown',(e)=>{preview.setPointerCapture(e.pointerId);state.previewDrag={x:e.clientX,y:e.clientY,yaw:state.yaw,pitch:state.pitch}});
  preview.addEventListener('pointermove',(e)=>{if(!state.previewDrag)return;state.yaw=state.previewDrag.yaw+(e.clientX-state.previewDrag.x)*.008;state.pitch=clamp(state.previewDrag.pitch+(e.clientY-state.previewDrag.y)*.006,.1,1.25);draw3D()});
  preview.addEventListener('pointerup',()=>state.previewDrag=null);
  $('room-type').onchange=(e)=>{const r=currentRoom();if(!r||r.type===e.target.value)return;recordHistory('修改体块功能');applyRoomType(r,e.target.value);updateSelection();renderRoomList();render()};
  $('double-height').onchange=(e)=>{const r=currentRoom();if(!r)return;recordHistory('修改体块高度');r.box_max[2]=e.target.checked?6000:3000;updateSelection();render()};
  $('selected-axis-kind').onchange=(e)=>{const a=currentAxis();if(a&&a.kind!==e.target.value){recordHistory('修改轴线类型');a.kind=e.target.value;render()}};
  $('split-btn').onclick=splitSelected;$('delete-room-btn').onclick=deleteSelectedRoom;$('delete-axis-btn').onclick=deleteSelectedAxis;
  $('apply-size-btn').onclick=applySize;$('grid-btn').onclick=gridFromAxes;$('merge-btn').onclick=mergeSameType;
  $('save-btn').onclick=()=>saveCase();$('export-draft-btn').onclick=()=>exportDraft();$('reload-latest-btn').onclick=reloadLatest;$('validate-btn').onclick=validateCase;$('approve-btn').onclick=approveCase;$('vision-btn').onclick=visionCase;
  $('wall-review-btn').onclick=()=>{if(state.draft)window.open(`/wall-review/${state.draft.case_id}`,'_blank')};
  $('swap-btn').onclick=async()=>{if(!state.draft)return;recordHistory('交换楼层图纸');const [a,b]=state.draft.floors;state.draft.floors=[b,a];state.draft.floors[0].floor=1;state.draft.floors[1].floor=2;
    for(const axis of state.draft.axes)axis.floor=3-axis.floor;await loadImages();updateFloorNames();render();msg('已交换上下层原图，请核对体块叠加位置。')};
  $('rotate-btn').onclick=()=>{if(!state.draft)return;recordHistory('旋转图纸');state.draft.north_rotation_quadrants=(state.draft.north_rotation_quadrants+1)%4;render();msg(`图纸显示方向已旋转 ${state.draft.north_rotation_quadrants*90}°，请核对北向。`)};
  $('reset-view-btn').onclick=()=>{state.zoom=1;state.pan={x:0,y:0};render()};
  window.addEventListener('keydown',(e)=>{
    if(e.key==='Escape'){closeRoomContextMenu();closeResizeDialog();if(!drawerPinned('queue'))document.body.classList.remove('queue-open');if(!drawerPinned('inspector'))document.body.classList.remove('inspector-open');$('inspector-toggle').setAttribute('aria-pressed',String(drawerPinned('inspector')));render()}
  });
}

initialize().catch((error)=>msg(`应用启动失败：${error.message}`));
