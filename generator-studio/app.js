'use strict';
const $=id=>document.getElementById(id),esc=SpatialRender.escape;
const LOCAL_ENDPOINT=location.origin+'/api/generator/parse';
const DEFAULT_ENDPOINT=location.origin==='http://127.0.0.1:8080'?LOCAL_ENDPOINT:(window.SpaceModalParser?.endpoint||'https://spacemodal-parser.silent-tnt.chatgpt.site/parse');
const ANCHOR_MODES={near:'入门近梯',hall:'侧向错位',public:'前后分离'};
const anchorLabel=m=>({direct:'入门近梯',offset:'侧向错位',separated:'前后分离'})[m.anchorValidation?.relation]||ANCHOR_MODES[m.anchorValidation?.mode]||'原布局';
const state=window.GeneratorState={conditions:{...Conditions.DEFAULTS},sources:Object.fromEntries(Object.keys(Conditions.DEFAULTS).map(k=>[k,'demo_default'])),result:null,models:[],busy:false,worker:null,abort:null,volume:null,selected:null,view:'all',mode:'remote',endpoint:DEFAULT_ENDPOINT};
try{const preferences=JSON.parse(localStorage.getItem('spacemodal-generator-preferences')||'null');if(preferences){state.mode=preferences.mode==='local'?'local':'remote';state.endpoint=preferences.endpoint||DEFAULT_ENDPOINT;state.conditions.budget=Conditions.validate({budget:preferences.budget}).budget;}}catch{}
if(location.origin==='http://127.0.0.1:8080'&&state.endpoint==='https://spacemodal-parser.silent-tnt.chatgpt.site/parse')state.endpoint=LOCAL_ENDPOINT;
const parserRevision=window.SpaceModalParser?.revision||'defense-1';
try{
  const previous=JSON.parse(localStorage.getItem('spacemodal-generator-preferences')||'null');
  if(previous?.parserRevision!==parserRevision&&(!previous?.endpoint||['https://spacemodal-parser.silent-tnt.chatgpt.site/parse','https://spacemodal-parser-silent-tnts-projects.vercel.app/parse'].includes(previous.endpoint)))state.endpoint=DEFAULT_ENDPOINT;
}catch{}
// Public proxies reject loopback origins; use the local same-origin proxy even
// when a previous browser preference points to an older public deployment.
if(location.origin==='http://127.0.0.1:8080'&&[
  window.SpaceModalParser?.endpoint,
  'https://spacemodal-parser.silent-tnt.chatgpt.site/parse',
  'https://spacemodal-parser-silent-tnts-projects.vercel.app/parse'
].includes(state.endpoint))state.endpoint=LOCAL_ENDPOINT;
if(new URLSearchParams(location.search).get('parser')==='local')state.mode='local';
function useLocalParser(text){
  if(state.busy)return;
  state.mode='local';modeLabel();
  try{localStorage.setItem('spacemodal-generator-preferences',JSON.stringify({endpoint:state.endpoint,mode:state.mode,budget:state.conditions.budget,parserRevision}));}catch{}
  if(text)send(text);else message('已切换为本地规则解析，未调用大模型。请输入尺寸、卧室数和卫生间数；生成仍使用浏览器中的训练模型。');
}
$('local-parser').onclick=()=>useLocalParser();
function modeLabel(){$('mode-label').textContent=state.mode==='remote'?'大模型需求解析':'本地规则解析 · 无大模型调用';}
function openConversation(open){$('conversation-body').hidden=!open;$('conversation-toggle').setAttribute('aria-expanded',String(open));document.querySelector('.conversation').classList.toggle('is-open',open);$('conversation-toggle').textContent='收起 ↓';}
function message(text,kind='assistant'){const el=document.createElement('article');el.className='message '+kind;const label=document.createElement('span');label.className='speaker';label.textContent=kind==='user'?'YOU':'SPACEMODAL';const p=document.createElement('p');p.textContent=text;el.append(label,p);$('messages').append(el);if(kind==='error')openConversation(true);$('messages').scrollTop=$('messages').scrollHeight;return el;}
function status(text){$('result-status').textContent=text;$('dock-status').textContent=text;}
function setBusy(value){state.busy=value;document.querySelector('.conversation').classList.toggle('is-busy',value);$('send').disabled=value;$('prompt').disabled=value;$('reset').disabled=value;$('settings-open').disabled=value;$('local-parser').disabled=value;$('cancel').hidden=!value;document.querySelectorAll('.generate-button,.examples button').forEach(b=>b.disabled=value);}
function showCard(parsed,mode){
  openConversation(true);
  const next={...state.conditions,...parsed.patch};next.utilityRole0??='service';next.utilityRole1??='laundry';const source={utilityRole0:'demo_default',utilityRole1:'demo_default',...state.sources};Object.keys(parsed.patch).forEach(k=>source[k]='user_explicit');delete next.anchorMode;delete source.anchorMode;
  const el=message(mode==='remote'?'大模型已整理需求。确认下面的条件后，开始生成。':'本地规则已整理需求（未调用大模型）。确认条件后，开始生成。');
  const card=document.createElement('div');card.className='condition-card';
  const labels={length:'生成长度 / mm',width:'生成宽度 / mm',bedrooms:'卧室总数',bedrooms0:'一层卧室数',living1:'二层客厅',utility1:'二层家政用房',utilityRole0:'一层家政用途',utilityRole1:'二层家政用途',bathrooms:'卫生间总数',balconies0:'一层阳台（-1采用统计）',balconies1:'二层阳台（-1采用统计）',seed:'随机种子'};
  card.innerHTML='<h3>本次生成条件</h3><div class="condition-fields">'+Object.entries(labels).map(([k,label])=>`<label>${label}`+(['utilityRole0','utilityRole1'].includes(k)?`<select name="${k}">${[['service','综合服务（联系厨房或卫生间）'],['laundry','洗衣家政（联系湿区与阳台）'],['entry-storage','入户收纳（允许靠玄关）']].filter(([value])=>k!=='utilityRole1'||value!=='entry-storage').map(([value,title])=>`<option value="${value}" ${next[k]===value?'selected':''}>${title}</option>`).join('')}</select>`:['living1','utility1'].includes(k)?`<select name="${k}"><option value="1" ${next[k]===1?'selected':''}>设置</option><option value="0" ${next[k]===0?'selected':''}>不设</option></select>`:`<input name="${k}" type="number" value="${next[k]}" step="${['length','width'].includes(k)?300:1}">`)+'</label>').join('')+'</div><p class="muted">固定两层，每层 3 m。一层卧室数可设0至卧室总数，二层采用剩余数量；二层客厅、家政用房可选择设置或不设。一层保留客厅、餐厨与家政，二层保留多功能室。家政可选综合服务、洗衣或入户收纳；综合服务和洗衣模式避免仅从玄关进入。阳台可按层设置0–4个，-1采用训练集统计；卫生间按清单分配。</p>';
  if(parsed.unsupported.length){const warning=document.createElement('p');warning.className='warning';warning.textContent='尚未支持：'+parsed.unsupported.join('；')+'。以下生成只采用卡片中的条件。';card.append(warning);}
  const note=document.createElement('p');note.className='muted';note.textContent='比较入门近梯、侧向错位和前后分离，生成后按整体质量选方案。保护客厅、餐厅和多功能室的活动区，公共通路无法合理接通时再比较必要短走道。阳台连接对象按贴邻统计与实际可达性选择。面积偏好来自训练集统计。入口位于图面下侧；卧室短边≥2.4米、长宽比≤1.8，经公共区域进入。';card.append(note);
  const details=document.createElement('details');details.innerHTML='<summary>查看结构化数据与条件来源</summary>';const pre=document.createElement('pre');pre.textContent=JSON.stringify({conditions:next,sources:source,unsupported:parsed.unsupported},null,2);details.append(pre);card.append(details);
  const button=document.createElement('button');button.className='primary generate-button';button.textContent=parsed.unsupported.length?'只采用卡片条件生成 →':'确认并生成 →';
  button.onclick=()=>{
    try{const edited={...next};for(const k of Object.keys(labels)){const input=card.querySelector(`[name="${k}"]`).value;const v=k.startsWith('utilityRole')?input:Number(input);if(v!==next[k])source[k]='user_explicit';edited[k]=v;}Conditions.validate(edited);openConversation(false);generate(edited,source);}catch(e){message(e.message,'error');}
  };
  card.append(button);el.append(card);$('messages').scrollTop=$('messages').scrollHeight;
}
async function send(text){
  if(state.busy||!text.trim())return;
  openConversation(true);message(text,'user');$('prompt').value='';$('prompt').style.height='';setBusy(true);status('正在整理需求');
  const controller=new AbortController();state.abort=controller;const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const mode=state.mode;
    const parsed=mode==='remote'?await Conditions.remote(text,state.conditions,{endpoint:state.endpoint},controller.signal):Conditions.local(text,state.conditions);
    showCard(parsed,mode);status('等待确认条件');
  }catch(e){
    const el=message(e.name==='AbortError'?'需求解析已停止或超时，可以重新发送。':e.message,'error');status('需求解析未完成');$('prompt').value=text;
    if(state.mode==='remote'){
      if(location.hostname==='127.0.0.1'&&location.port!=='8080'){
        const link=document.createElement('a');link.href='http://127.0.0.1:8080/generator-studio/';link.className='local-service-link';link.textContent='打开本机大模型工作台 →';el.append(link);
      }
      const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent='使用本地规则继续（不调用大模型）';button.dataset.localRetry='true';
      button.onclick=()=>{if(state.busy)return;button.disabled=true;useLocalParser(text);};el.append(button);
    }
  }
  finally{clearTimeout(timer);state.abort=null;setBusy(false);}
}
function generate(conditions,sources){
  if(state.busy)return;state.conditions={...conditions};state.sources={...sources};setBusy(true);status('正在启动浏览器生成');
  state.generationPhase='正在启动浏览器生成';state.receivedPreview=false;
  const worker=new Worker('worker.js?v=bounded-joint-geometry-v1');state.worker=worker;
  message('开始生成：首个合格方案会立即显示，随后继续优化并补充可比较的方案。');
  let timeout;
  const watchProgress=()=>{clearTimeout(timeout);timeout=setTimeout(()=>{if(state.worker===worker){worker.terminate();state.worker=null;setBusy(false);retainPreview('计算超时');message(state.receivedPreview?'后续计算连续三分钟没有报告进度，已停止；已生成方案已保留。':'计算连续三分钟没有报告进度，已停止。可以减少搜索预算或调整需求。','error');}},180000);};
  watchProgress();
  worker.onmessage=({data})=>{
    if(state.worker!==worker)return;
    if(data.phase){watchProgress();state.generationPhase=data.phase;showGenerationProgress();return;}
    if(data.partial){
      watchProgress();const first=!state.receivedPreview;state.receivedPreview=true;
      acceptGeneratedResult(data,conditions,sources,first);showGenerationProgress();
      if(first)message('首个方案已通过检查，可以查看、切换视图或下载。正在继续优化，点击停止可保留当前结果。');
      return;
    }
    clearTimeout(timeout);worker.terminate();state.worker=null;setBusy(false);
    if(data.error){message(data.error+(state.receivedPreview?' 已保留先前通过检查的方案。':''),'error');retainPreview('本次生成未成功');if(data.searchSummary&&!state.receivedPreview)presentSearchSummary(data.searchSummary);return;}
    acceptGeneratedResult(data,conditions,sources,!state.receivedPreview);const missing=data.searchSummary.searches.filter(s=>s.status!=='found');if(missing.length)message('本次未找到以下模式的合格方案：'+missing.map(s=>ANCHOR_MODES[s.mode]).join('、')+'。仍可比较其余方案，也可增加预算或换种子。');message(`已生成 ${state.models.length} 个候选方案，用时 ${data.elapsedSeconds.toFixed(1)} 秒。两层功能体块通过原 demo 的几何、连通与房间清单检查。你可以继续输入“卧室改为四间”或“换一个方案”。`);
  };
  worker.onerror=()=>{if(state.worker!==worker)return;clearTimeout(timeout);worker.terminate();state.worker=null;setBusy(false);message(state.receivedPreview?'后续生成失败，已保留通过检查的方案。':'浏览器生成程序运行失败，请刷新重试。','error');retainPreview('生成失败');};
  worker.postMessage(conditions);
}
function saveGeneratedResult(){try{localStorage.setItem('spacemodal-generator-last',JSON.stringify(state.result));}catch{message('结果已生成，但浏览器存储空间不足。请下载保存。');}}
function modelKey(model){return model?`${model.seed}:${model.anchorValidation.mode}:${model.generation.selectedCandidate}`:null;}
function acceptGeneratedResult(data,conditions,sources,first){
  const previous=first?null:modelKey(activeModel());
  state.result={...data,conditions:{...conditions},sources:{...sources}};state.models=[data.model,...data.alternatives];
  saveGeneratedResult();if(first)$('visible-floors').value='2';
  const index=Math.max(0,state.models.findIndex(m=>modelKey(m)===previous));
  if(!first&&modelKey(state.models[index])===previous){
    // Preserve the camera, drawing zoom and room selection while the same layout remains available.
    $('alternatives').innerHTML=state.models.map((m,i)=>`<option value="${i}">方案 ${String(i+1).padStart(2,'0')} · ${anchorLabel(m)}</option>`).join('');$('alternatives').value=index;
    $('metrics').firstElementChild.querySelector('strong').textContent=data.elapsedSeconds.toFixed(1)+' s';
    $('metrics').children[1].querySelector('strong').textContent=data.searchSummary.validCandidateCount;
    presentOrganization(state.models[index]);
    status(data.partial?'已找到合格方案，继续优化':'浏览器生成完成');
  }else present(index);
}
function showGenerationProgress(){status(state.receivedPreview?`已提供 ${state.models.length} 个合格方案 · 继续优化 · ${state.generationPhase}`:state.generationPhase);}
function retainPreview(reason){
  if(state.receivedPreview&&state.result?.partial){state.result.stopped=true;saveGeneratedResult();status(`${reason} · 已保留 ${state.models.length} 个合格方案`);}
  else status(reason);
}
function activeModel(){return state.models[Number($('alternatives').value)||0];}
function present(index){
  const model=state.models[index];if(!model)return;
  $('empty').hidden=true;$('metrics').hidden=false;$('legend').hidden=false;$('download-json').disabled=false;$('download-review').disabled=false;$('download-showcase').disabled=false;$('area-info-open').disabled=!state.result.areaPrior;
  const c=state.result.conditions;$('result-title').textContent=`${(c.length/1000).toFixed(1)} × ${(c.width/1000).toFixed(1)} m · ${c.bedrooms} 卧 ${c.bathrooms} 卫`;
  status(model.daylightPolicy!=='tiered-facade-v2'?'上次结果 · 重新生成应用玄关面积上限与分级采光规则':model.mealPolicy!=='meal-joint-v1'?'上次结果 · 重新生成应用餐厨尺度与位置规则':model.generation.stairRevision!=='stair-joint-v1'?'上次结果 · 重新生成应用楼梯尺寸与位置规则':model.generation.shapeRevision!=='public-shape-v1'?'上次结果 · 重新生成应用空间完整性规则':model.generation.ruleRevision!=='stair-terminal-v6'?'上次结果 · 重新生成应用楼梯通行规则':model.kitchenDining?.revision==='meal-public-route-v1'?'浏览器生成完成':'上次结果 · 重新生成应用餐厨联系规则');
  $('plans').innerHTML=[1,0].map(f=>`<div class="plan-panel"><h3>${f+1}F</h3>${SpatialRender.plan(model,f,$('show-circulation').checked)}</div>`).join('');
  $('topology').innerHTML=SpatialRender.topology(model);
  $('metrics').innerHTML=[[(state.result.elapsedSeconds).toFixed(1)+' s','本次计算'],[state.result.searchSummary?.validCandidateCount??model.generation.validCandidateCount,'通过检查的候选'],[model.generation.score.toFixed(1),'综合评分 / 越低越好'],['300 mm','体块网格']].map(([v,k])=>`<div class="metric"><strong>${esc(v)}</strong>${k}</div>`).join('');
  $('legend').innerHTML=[...new Set(model.spaces.map(s=>s.label))].map(i=>`<span title="${SpatialRender.LABELS[i][0]}" aria-label="${SpatialRender.LABELS[i][0]}" tabindex="0"><i style="background:${SpatialRender.LABELS[i][1]}"></i></span>`).join('');
  $('alternatives').innerHTML=state.models.map((m,i)=>`<option value="${i}">方案 ${String(i+1).padStart(2,'0')} · ${anchorLabel(m)}</option>`).join('');$('alternatives').value=index;$('alternatives').hidden=false;
  presentOrganization(model);
  const forecast=state.result.forecast;
  $('forecast').innerHTML=forecast.assignments.map((rows,f)=>{let svg='<svg viewBox="0 0 240 240" role="img" aria-label="模型占位预测">';rows.forEach((row,y)=>row.forEach((id,x)=>{const r=forecast.query[id-1];svg+=`<rect x="${x*10}" y="${(23-y)*10}" width="10" height="10" fill="${r?SpatialRender.LABELS[r.label][1]:'#e7e8df'}"/>`;}));return `<div class="forecast-panel">${svg}</svg><p>${f+1}F / 模型原始占位预测</p><p>尚未经过网格布局和几何检查</p></div>`;}).join('');
  state.selected=null;$('selection-info').hidden=true;$('selection-info').textContent='';$('topology').classList.remove('has-selection');installDrawingNavigation();state.volume?.dispose();state.volume=SpatialRender.volume($('volume-canvas'),model);state.volume.setFloors(Number($('visible-floors').value));showView(state.view);
  if(state.worker&&state.receivedPreview)showGenerationProgress();
  else if(state.result.partial)status(`已保留 ${state.models.length} 个合格方案 · 后续优化未完成`);
}
function showView(view){
  state.view=view;$('drawing-board').hidden=!state.result;$('drawing-board').classList.toggle('focus',view!=='all');
  for(const v of ['plans','volume','topology','forecast'])(v==='plans'?$('plan-view'):$(v)).hidden=!state.result||(view!=='all'&&v!==view)||(view==='all'&&v==='forecast');
  document.querySelectorAll('[data-view]').forEach(b=>{const selected=b.dataset.view===view;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
  if(view==='forecast')document.querySelector('.tools-menu').open=false;
  requestAnimationFrame(()=>state.volume?.draw());
}
function selectSpace(id,floor){
  const space=activeModel()?.spaces.find(s=>s.id===id);if(!space)return;
  state.selected={id,floor};if(floor===1&&$('visible-floors').value==='1'){$('visible-floors').value='2';state.volume?.setFloors(2);}state.volume?.select(state.selected);
  document.querySelectorAll('#plans [data-space-id],#topology [data-space-id]').forEach(e=>e.classList.toggle('space-selected',Number(e.dataset.spaceId)===id&&Number(e.dataset.floor)===floor));
  document.querySelectorAll('.topology-edge').forEach(e=>e.classList.toggle('edge-selected',e.dataset.a===`${floor}:${id}`||e.dataset.b===`${floor}:${id}`));$('topology').classList.add('has-selection');
  const related=new Set();document.querySelectorAll('.topology-edge.edge-selected').forEach(e=>{related.add(e.dataset.a);related.add(e.dataset.b);});document.querySelectorAll('.topology-node').forEach(e=>e.classList.toggle('node-related',related.has(`${e.dataset.floor}:${e.dataset.spaceId}`)));
  const area=Array.from(activeModel().floorSpaces[floor]).filter(value=>value===id).length*.09;$('selection-info').hidden=false;$('selection-info').textContent=`${floor+1}F · ${SpatialRender.LABELS[space.label][0]} · ${area.toFixed(1)} ㎡`;
}
function installDrawingNavigation(){
  for(const svg of document.querySelectorAll('#plans svg,#topology svg')){
    const original=svg.getAttribute('viewBox').split(/\s+/).map(Number);let box=[...original],drag=null,moved=false;
    const update=()=>svg.setAttribute('viewBox',box.join(' '));
    svg.addEventListener('wheel',e=>{e.preventDefault();const rect=svg.getBoundingClientRect(),factor=e.deltaY>0?1.12:.89;const width=Math.min(original[2]*2,Math.max(original[2]*.3,box[2]*factor)),height=width*original[3]/original[2],px=(e.clientX-rect.left)/rect.width,py=(e.clientY-rect.top)/rect.height;box=[box[0]+(box[2]-width)*px,box[1]+(box[3]-height)*py,width,height];update();},{passive:false});
    svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;moved=false;drag={x:e.clientX,y:e.clientY,box:[...box]};});
    svg.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5){moved=true;svg.setPointerCapture(e.pointerId);const r=svg.getBoundingClientRect();box=[drag.box[0]-dx/r.width*drag.box[2],drag.box[1]-dy/r.height*drag.box[3],box[2],box[3]];update();}});
    svg.addEventListener('pointerup',()=>drag=null);svg.addEventListener('pointercancel',()=>drag=null);
    svg.addEventListener('click',e=>{if(moved)return;const hit=e.target.closest('[data-space-id]');if(hit)selectSpace(Number(hit.dataset.spaceId),Number(hit.dataset.floor));});
    svg.addEventListener('dblclick',()=>{box=[...original];update();});
    svg.addEventListener('keydown',e=>{const hit=e.target.closest('[data-space-id]');if(hit&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectSpace(Number(hit.dataset.spaceId),Number(hit.dataset.floor));}});
  }
  document.querySelectorAll('[data-edge-toggle]').forEach(input=>input.onchange=()=>{document.querySelectorAll(`[data-edge-type="${input.dataset.edgeToggle}"]`).forEach(e=>e.toggleAttribute('hidden',!input.checked));if(input.dataset.edgeToggle==='access')document.querySelector('.topology-svg').classList.toggle('access-hidden',!input.checked);});
}
$('volume-canvas').addEventListener('space-select',e=>selectSpace(e.detail.id,e.detail.floor));
$('volume-home').onclick=()=>{$('visible-floors').value='2';state.volume?.home();};
$('conversation-toggle').onclick=()=>openConversation(false);
$('prompt').addEventListener('focus',()=>openConversation(true));
$('prompt').addEventListener('click',()=>openConversation(true));
$('conversation-open').onclick=()=>{document.querySelector('.tools-menu').open=false;openConversation(true);$('prompt').focus();};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.conversation')&&!e.target.closest('#conversation-open'))openConversation(false);if(!e.target.closest('.tools-menu'))document.querySelector('.tools-menu').open=false;});
document.addEventListener('click',e=>{const button=e.target.closest('[data-focus]');if(button)showView(button.dataset.focus);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){openConversation(false);document.querySelector('.tools-menu').open=false;}});
$('prompt').oninput=()=>{$('prompt').style.height='auto';$('prompt').style.height=Math.min($('prompt').scrollHeight,110)+'px';};
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('download-json').onclick=()=>{const geometry={...SpatialRender.geometry(activeModel()),functional_validation:activeModel().functional,functional_relations:activeModel().functionalRelations,anchor_validation:activeModel().anchorValidation,bedroom_rules:activeModel().generation.bedroomRules,rule_revision:activeModel().generation.ruleRevision,floor_program_revision:activeModel().generation.floorProgramRevision,area_budget_revision:activeModel().generation.areaBudgetRevision,shape_revision:activeModel().generation.shapeRevision,stair_revision:activeModel().generation.stairRevision,organization:activeModel().organization,kitchen_dining:activeModel().kitchenDining,routing_evidence:activeModel().generation.routingEvidence,corridor_budgets:activeModel().programValidation.corridorBudgets,area_prior:state.result.areaPrior,generation:{...state.result.meta,search_summary:state.result.searchSummary,conditions:state.result.conditions,anchor_geometry:activeModel().generation.geometry,condition_sources:state.result.sources,elapsed_seconds:state.result.elapsedSeconds,selected_candidate:activeModel().generation.selectedCandidate}};download(`spacemodal-seed${activeModel().seed}.json`,JSON.stringify(geometry,null,2),'application/json');};
$('download-review').onclick=()=>{try{const bundle=SpatialRender.reviewBundle(state.result,Number($('alternatives').value));download(`spacemodal-review-seed${activeModel().seed}.json`,JSON.stringify(bundle,null,2),'application/json');document.querySelector('.tools-menu').open=false;}catch(e){message(e.message,'error');}};
$('download-showcase').onclick=async()=>{
  try{const [vendor,source]=await Promise.all(['vendor/three-0.172.0.min.js','render.js'].map(url=>fetch(url).then(r=>{if(!r.ok)throw Error('展示文件加载失败');return r.text();})));const model=activeModel(),data=JSON.stringify({...model,floorSpaces:model.floorSpaces.map(g=>Array.from(g)),floors:model.floors.map(g=>Array.from(g))}).replace(/</g,'\\u003c');const endScript='</script>';
    const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SpaceModal · 两层体块展示</title><style>body{font-family:"Microsoft YaHei",sans-serif;background:#f4f3ee;color:#243b30;margin:4vw}.plans{display:flex;gap:20px}.plans>div{width:50%}svg{width:100%;max-height:620px}canvas{width:100%;height:600px;touch-action:none}.graph{max-width:800px;margin:auto}h1{font-size:24px;font-weight:500}p{font-size:12px}.topology-svg{aspect-ratio:210/297}.view-expand{display:none}.topology-svg:not(.access-hidden) [data-overlap-access]{display:none}@media print{section{break-after:page}canvas{height:400px}.graph{width:190mm}}</style><h1>SpaceModal · ${(model.nx*.3).toFixed(1)} × ${(model.ny*.3).toFixed(1)} m · Seed ${model.seed}</h1><p>HGNN + CVA 浏览器推理；通过原 demo 检查，尚未经过项目完整验收。功能体块贴邻不等于真实门或通行路径。</p><section><h2>两层平面</h2><div id="plans" class="plans"></div></section><section><h2>交互三维</h2><label>显示楼层 <select id="floors"><option value="2">两层</option><option value="1">一层</option></select></label><canvas id="volume"></canvas></section><section class="graph"><h2>几何贴邻拓扑 / A4</h2><div id="topology"></div></section><script>${vendor.replace(/<\/script/gi,'<\\/script')}${endScript}<script>${source.replace(/<\/script/gi,'<\\/script')}${endScript}<script>const model=${data};document.getElementById('plans').innerHTML=[0,1].map(f=>'<div>'+SpatialRender.plan(model,f)+'</div>').join('');document.getElementById('topology').innerHTML=SpatialRender.topology(model);const view=SpatialRender.volume(document.getElementById('volume'),model);document.getElementById('floors').onchange=e=>view.setFloors(Number(e.target.value));document.querySelectorAll('[data-edge-toggle]').forEach(input=>input.onchange=()=>{document.querySelectorAll('[data-edge-type=\"'+input.dataset.edgeToggle+'\"]').forEach(edge=>edge.style.display=input.checked?'':'none');if(input.dataset.edgeToggle==='access')document.querySelector('.topology-svg').classList.toggle('access-hidden',!input.checked);});${endScript}</html>`;
    download(`spacemodal-seed${model.seed}-showcase.html`,html,'text/html');
  }catch(e){message(e.message,'error');}
};
$('chat-form').onsubmit=e=>{e.preventDefault();send($('prompt').value);};$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send($('prompt').value);}};
document.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>send(b.dataset.example));document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$('show-circulation').onchange=()=>present(Number($('alternatives').value));$('alternatives').onchange=()=>present(Number($('alternatives').value));$('visible-floors').onchange=e=>state.volume?.setFloors(Number(e.target.value));
$('cancel').onclick=()=>{if(state.worker){state.worker.terminate();state.worker=null;setBusy(false);message(state.receivedPreview?'已停止后续优化，已生成的合格方案已保留，可以继续查看和下载。':'本次生成已停止，可调整条件后重试。');retainPreview('已停止');}else state.abort?.abort();};
$('settings-open').onclick=()=>{$('parser-mode').value=state.mode;$('proxy-endpoint').value=state.endpoint;$('budget').value=state.conditions.budget;$('settings').showModal();};$('settings-close').onclick=()=>$('settings').close();
$('settings-form').onsubmit=e=>{e.preventDefault();try{const budget=Conditions.validate({budget:Number($('budget').value)}).budget;const url=new URL($('proxy-endpoint').value);if(url.protocol!=='https:'&&url.href!==LOCAL_ENDPOINT)throw Error('代理地址需要 HTTPS；本机可使用同源解析服务');state.endpoint=url.href;state.mode=$('parser-mode').value;state.conditions.budget=budget;localStorage.setItem('spacemodal-generator-preferences',JSON.stringify({endpoint:state.endpoint,mode:state.mode,budget,parserRevision}));modeLabel();$('settings').close();}catch(e){message(e.message,'error');}};
$('reset').onclick=()=>{if(state.busy)return;document.querySelector('.tools-menu').open=false;state.volume?.dispose();state.volume=null;state.result=null;state.models=[];state.conditions={...Conditions.DEFAULTS,budget:state.conditions.budget};state.sources=Object.fromEntries(Object.keys(state.conditions).map(k=>[k,'demo_default']));localStorage.removeItem('spacemodal-generator-last');$('messages').replaceChildren();message('新的设计对话已开始。请输入生成范围、卧室和卫生间数量。');$('empty').hidden=false;$('metrics').hidden=true;$('legend').hidden=true;$('alternatives').hidden=true;$('result-title').textContent='空间预览';$('download-json').disabled=true;$('download-review').disabled=true;$('download-showcase').disabled=true;$('area-info-open').disabled=true;$('organization-summary').hidden=true;$('search-info').hidden=true;state.selected=null;$('visible-floors').value='2';showView('all');$('selection-info').textContent='';$('selection-info').hidden=true;status('等待需求');openConversation(false);};
modeLabel();
try{const saved=JSON.parse(localStorage.getItem('spacemodal-generator-last')||'null');if(saved){Conditions.validate(saved.conditions);state.result=saved;state.conditions={...Conditions.DEFAULTS,bedrooms0:0,living1:0,utility1:0,...saved.conditions};delete state.conditions.anchorMode;state.sources={...saved.sources};delete state.sources.anchorMode;state.models=[saved.model,...saved.alternatives];present(0);message(saved.model.traffic?.revision!=='circulation-facade-joint-v1'?'已恢复旧方案；重新生成后应用交通面积、外围采光面和房间联合调整规则。':saved.model.functional?.revision!=='functional-joint-v1'?'已恢复旧方案；重新生成后应用全功能尺度、服务联系和面积协调规则。':saved.model.generation.floorProgramRevision!=='floor-program-v1'?'已恢复旧方案；重新生成时可设置一层卧室、二层客厅和家政用房。旧方案保留原楼层分配。':saved.model.generation.areaBudgetRevision!=='joint-area-v1'?'已恢复旧方案；重新生成后应用联合面积协调和功能容量限制。':saved.model.daylightPolicy!=='tiered-facade-v2'?'已恢复上次结果；重新生成后应用玄关面积上限与分级采光规则。':saved.model.mealPolicy!=='meal-joint-v1'?'已恢复上次结果；重新生成后应用餐厨成组安排、尺寸和面积控制。':saved.model.generation.stairRevision!=='stair-joint-v1'?'已恢复上次结果；重新生成后应用数据集楼梯尺寸、位置和玄关关系。':saved.model.generation.shapeRevision!=='public-shape-v1'?'已恢复上次结果；重新生成后应用公共空间凹角限制、玄关宽度和完整性评分。':saved.model.generation.ruleRevision==='stair-terminal-v6'?'已恢复上次生成的方案，优先通过公共区域组织通行。':'已恢复上次结果；重新生成后应用楼梯不作同层通路、二层独立到达走道的新规则。');}}catch{}

$('area-info-open').onclick=()=>{
 const prior=state.result.areaPrior,model=activeModel();if(!prior)return;
 $('area-info-note').textContent=`统计使用 ${prior.trainingCaseCount} 套训练案例，未使用验证和独立评估案例。先合并已有人工功能分组；未分组的记录保留原标注实例。目标与区间按建筑面积、长宽比及同层功能数量分组；样本不足回退到较大样本组。${prior.balconyCounts?`本次阳台数量：一层 ${prior.balconyCounts[0]} 个，二层 ${prior.balconyCounts[1]} 个；统计默认分别为 ${prior.balconyStatistics.by_floor[1].median_count}、${prior.balconyStatistics.by_floor[2].median_count} 个。数量来自标注实例，尚未确认缺失标注与真实无阳台的区别；连接偏好采用同层贴邻统计，不代表真实门。`:""}单位：平方米。${model.programValidation.corridorBudgets?model.programValidation.corridorBudgets.map(b=>`${b.floor+1}层走道 ${b.area.toFixed(1)}㎡，P75参考 ${b.limit.toFixed(1)}㎡${b.withinPreference===false?"（超出参考，按整体质量评估）":""}。`).join(""):""}`;
 if(prior.areaBudget)$('area-info-note').textContent+=' 本次面积目标由联合模型和全层预算共同分配；联合模型使用'+prior.jointTrainingCases+'套核查合格训练案例。功能容量是演示器的舒适度范围。';
 if(model.traffic)$('area-info-note').textContent+=' 当前设计条件另设交通检查：南侧不布置走廊，交通空间外墙接触合计不超过1.2m；'+model.traffic.reports.map(r=>`${r.floor+1}层交通${r.area.toFixed(2)}㎡，限值${r.maximumArea.toFixed(2)}㎡，外墙接触${r.facadeLength.toFixed(1)}m。`).join('');
 if(model.generation.geometry.actualAreaCoordination)$('area-info-note').textContent+=' 下表目标已按本方案实际楼梯及交通占地重新协调，模型预测值保留在下载数据中。';
 const rows=model.programValidation.reports.map(r=>{const coordinated=model.functional?.reports.find(s=>s.key===r.key);return coordinated?{...r,targetArea:coordinated.targetArea,preferredAreaMin:coordinated.preferredAreaMin,preferredAreaMax:coordinated.preferredAreaMax}:r;});
 $('area-info-table').innerHTML='<thead><tr><th>空间</th><th>实际</th><th>目标</th><th>偏好区间</th><th>样本数</th><th>统计分组</th></tr></thead><tbody>'+rows.map(r=>{const room=model.spaces[r.spaceId];return `<tr><td>${r.floor+1}F ${esc(SpatialRender.LABELS[room.label][0])}</td><td>${r.area.toFixed(1)}</td><td>${r.targetArea.toFixed(1)}</td><td>${r.preferredAreaMin.toFixed(1)}–${r.preferredAreaMax.toFixed(1)}</td><td>${r.areaSource.count} / ${r.areaSource.houseCount}宅</td><td>${esc(r.areaSource.conditioning||"总体")}${r.areaSource.conditioningFallback?"（回退）":""}</td></tr>`;}).join('')+'</tbody>';
 if(model.functional)$('area-info-note').textContent+=' 已检查家政和卫生间比例、功能容量、家政服务联系及卧室到卫生间的公共路径；'+model.functional.warnings.length+'项面积偏离优选范围。路径仍为概念规划估算。';
 $('area-info').showModal();
};
$('area-info-close').onclick=()=>$('area-info').close();

function presentOrganization(model){
 const o=model.organization;$('organization-summary').hidden=!o;$('search-info').hidden=!state.result.searchSummary;
 if(o){const repairs=(model.generation.routingEvidence||[]).flatMap(f=>f.repairs||[]);
  $('organization-summary').textContent=`活动区与公共通路检查通过 · 独立走道 ${o.corridorArea.toFixed(1)}㎡ · 公共空间通行占用 ${o.publicTrafficArea.toFixed(1)}㎡ · 平均通路 ${o.meanRouteLength.toFixed(1)}m。${o.corridorArea?'走道用于连接受阻功能；展开查看补路原因。':'保留活动区后仍可通过公共空间接通。'}`;
 }
 presentSearchSummary(state.result.searchSummary,model);
}
function presentSearchSummary(summary,model=null){
 if(!summary)return;$('search-info').hidden=false;
 const labels={partition:'候选未通过生成或后续检查',fill:'余地与连通',dimensions:'面积、宽度与形状',activity:'活动区及公共通路',access:'有效出入口及到达',anchors:'玄关与楼梯关系'};
 const repairs=(model?.generation.routingEvidence||[]).flatMap(f=>f.repairs||[]);
 const readable=issue=>issue.replace(/upper-public/g,'客厅与多功能室合计').replace(/meal/g,'餐厨合计').replace(/bedroom-(\d+)/g,'卧室$1').replace(/bathroom-(\d+)/g,'卫生间$1').replace(/\b(entry|living|dining|multi|utility|kitchen)\b/g,key=>({entry:'玄关',living:'客厅',dining:'餐厅',multi:'多功能室',utility:'家政',kitchen:'厨房'})[key]);
 const selectedNote=s=>s.selectedCount===undefined?'':`选入 ${s.selectedCount} 个。${s.selectionNote==='outside-comparable-quality'?'通过基本检查，但整体评分未进入可比质量范围。':s.selectionNote==='duplicate-access-structure-or-portfolio-limit'?'与已选方案组织重复或超过展示数量。':''}`;
 $('search-info-content').innerHTML=(model?'':'<p>本次未找到合格方案；以下记录本次搜索失败原因。</p>')+'<p>先检查活动区与有效通行，再比较面积、路程及交通占用；只展示质量接近且关系不同的方案，不强行补足四个。</p>'+summary.searches.map(s=>`<p>${esc(ANCHOR_MODES[s.mode])}：${s.budget} 个候选，${s.validCandidateCount} 个通过。${selectedNote(s)}${s.diagnostics?Object.entries(s.diagnostics.rejectionChecks).filter(([k,n])=>n&&labels[k]).map(([k,n])=>esc(labels[k])+': '+n+' 次').join('；'):''}${s.diagnostics?.examples?.length?'。例如：'+[...new Set(s.diagnostics.examples.slice(0,2).flatMap(e=>e.issues))].map(issue=>esc(readable(issue))).join('；'):''}</p>`).join('')+repairs.map(r=>`<p>补路 ${r.addedArea.toFixed(1)}㎡：${esc(r.reason.includes('protected-activity')?'保留活动区后公共通路受阻，通过房间边界调整接通':'公共网络未能接通')}；服务 ${esc(r.target)}${r.fromRoom?'；调整 '+esc(r.fromRoom)+' 边界':''}。</p>`).join('')+'<p>失败计数包含局部调整检查，不能相加当作被淘汰的候选数。活动区及通路是可调整的几何近似，尚未模拟真实家具、门扇及楼梯踏步。</p>';
}
