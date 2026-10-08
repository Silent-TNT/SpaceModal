'use strict';
const $=id=>document.getElementById(id),esc=SpatialRender.escape;
const DEFAULT_ENDPOINT='https://spacemodal-parser.silent-tnt.chatgpt.site/parse';
const state=window.GeneratorState={conditions:{...Conditions.DEFAULTS},sources:Object.fromEntries(Object.keys(Conditions.DEFAULTS).map(k=>[k,'demo_default'])),result:null,models:[],busy:false,worker:null,abort:null,volume:null,view:'plans',mode:'remote',endpoint:DEFAULT_ENDPOINT};
try{const preferences=JSON.parse(localStorage.getItem('spacemodal-generator-preferences')||'null');if(preferences){state.mode=preferences.mode==='local'?'local':'remote';state.endpoint=preferences.endpoint||DEFAULT_ENDPOINT;state.conditions.budget=Conditions.validate({budget:preferences.budget}).budget;}}catch{}
function modeLabel(){$('mode-label').textContent=state.mode==='remote'?'大模型需求解析':'本地规则解析 · 无大模型调用';}
function message(text,kind='assistant'){const el=document.createElement('article');el.className='message '+kind;const label=document.createElement('span');label.className='speaker';label.textContent=kind==='user'?'YOU':'SPACEMODAL';const p=document.createElement('p');p.textContent=text;el.append(label,p);$('messages').append(el);el.scrollIntoView({block:'nearest'});return el;}
function status(text){$('result-status').textContent=text;}
function setBusy(value){state.busy=value;$('send').disabled=value;$('prompt').disabled=value;$('reset').disabled=value;$('settings-open').disabled=value;$('cancel').hidden=!value;document.querySelectorAll('.generate-button,.examples button').forEach(b=>b.disabled=value);}
function showCard(parsed,mode){
  const next={...state.conditions,...parsed.patch};const source={...state.sources};Object.keys(parsed.patch).forEach(k=>source[k]='user_explicit');
  const el=message(mode==='remote'?'大模型已整理需求。确认下面的条件后，开始生成。':'本地规则已整理需求（未调用大模型）。确认条件后，开始生成。');
  const card=document.createElement('div');card.className='condition-card';
  const labels={length:'生成长度 / mm',width:'生成宽度 / mm',bedrooms:'卧室总数',bathrooms:'卫生间总数',seed:'随机种子'};
  card.innerHTML='<h3>本次生成条件</h3><div class="condition-fields">'+Object.entries(labels).map(([k,label])=>`<label>${label}<input name="${k}" type="number" value="${next[k]}" step="${['length','width'].includes(k)?300:1}"></label>`).join('')+'</div><p class="muted">固定两层，每层 3 m。厨房、阳台、家政与多功能室等沿用原 demo 默认清单；卧室位于二层，卫生间按清单分配。</p>';
  if(parsed.unsupported.length){const warning=document.createElement('p');warning.className='warning';warning.textContent='尚未支持：'+parsed.unsupported.join('；')+'。以下生成只采用卡片中的条件。';card.append(warning);}
  const details=document.createElement('details');details.innerHTML='<summary>查看结构化数据与条件来源</summary>';const pre=document.createElement('pre');pre.textContent=JSON.stringify({conditions:next,sources:source,unsupported:parsed.unsupported},null,2);details.append(pre);card.append(details);
  const button=document.createElement('button');button.className='primary generate-button';button.textContent=parsed.unsupported.length?'只采用卡片条件生成 →':'确认并生成 →';
  button.onclick=()=>{
    try{const edited={...next};for(const k of Object.keys(labels)){const v=Number(card.querySelector(`[name="${k}"]`).value);if(v!==next[k])source[k]='user_explicit';edited[k]=v;}Conditions.validate(edited);generate(edited,source);}catch(e){message(e.message,'error');}
  };
  card.append(button);el.append(card);el.scrollIntoView({block:'nearest'});
}
async function send(text){
  if(state.busy||!text.trim())return;
  message(text,'user');$('prompt').value='';setBusy(true);status('正在整理需求');
  const controller=new AbortController();state.abort=controller;const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const mode=state.mode;
    const parsed=mode==='remote'?await Conditions.remote(text,state.conditions,{endpoint:state.endpoint},controller.signal):Conditions.local(text,state.conditions);
    showCard(parsed,mode);status('等待确认条件');
  }catch(e){message(e.name==='AbortError'?'需求解析已停止或超时，可以重新发送。':e.message,'error');status('需求解析未完成');}
  finally{clearTimeout(timer);state.abort=null;setBusy(false);}
}
function generate(conditions,sources){
  if(state.busy)return;state.conditions={...conditions};state.sources={...sources};setBusy(true);status('正在启动浏览器生成');
  const worker=new Worker('worker.js');state.worker=worker;
  message('开始计算。模型先预测空间偏好，生成器再搜索满足原 demo 检查规则的布局。');
  const timeout=setTimeout(()=>{if(state.worker===worker){worker.terminate();state.worker=null;setBusy(false);message('本次计算超过三分钟，已停止。可以减少搜索预算或调整需求。','error');status('计算超时');}},180000);
  worker.onmessage=({data})=>{
    if(state.worker!==worker)return;
    if(data.phase){status(data.phase);return;}
    clearTimeout(timeout);worker.terminate();state.worker=null;setBusy(false);
    if(data.error){message(data.error,'error');status('本次搜索未成功');return;}
    state.result={...data,conditions:{...conditions},sources:{...sources}};state.models=[data.model,...data.alternatives];
    try{localStorage.setItem('spacemodal-generator-last',JSON.stringify(state.result));}catch{message('结果已生成，但浏览器存储空间不足。请下载保存。');}
    present(0);message(`已生成 ${state.models.length} 个候选方案，用时 ${data.elapsedSeconds.toFixed(1)} 秒。两层功能体块通过原 demo 的几何、连通与房间清单检查。你可以继续输入“卧室改为四间”或“换一个方案”。`);
  };
  worker.onerror=()=>{clearTimeout(timeout);worker.terminate();state.worker=null;setBusy(false);message('浏览器生成程序运行失败，请刷新重试。','error');status('生成失败');};
  worker.postMessage(conditions);
}
function activeModel(){return state.models[Number($('alternatives').value)||0];}
function present(index){
  const model=state.models[index];if(!model)return;
  $('empty').hidden=true;$('metrics').hidden=false;$('legend').hidden=false;$('download-json').disabled=false;$('download-showcase').disabled=false;
  const c=state.result.conditions;$('result-title').textContent=`${(c.length/1000).toFixed(1)} × ${(c.width/1000).toFixed(1)} m · ${c.bedrooms} 卧 ${c.bathrooms} 卫`;
  status('浏览器生成完成');
  $('plans').innerHTML=[0,1].map(f=>`<div class="plan-panel"><h3>${f+1}F / ${f===0?'一层':'二层'}</h3>${SpatialRender.plan(model,f)}</div>`).join('');
  $('topology').innerHTML=SpatialRender.topology(model);
  $('metrics').innerHTML=[[(state.result.elapsedSeconds).toFixed(1)+' s','本次计算'],[model.generation.validCandidateCount,'通过检查的候选'],[model.generation.score.toFixed(1),'原 demo 评分 / 越低越好'],['300 mm','体块网格']].map(([v,k])=>`<div class="metric"><strong>${esc(v)}</strong>${k}</div>`).join('');
  $('legend').innerHTML=[...new Set(model.spaces.map(s=>s.label))].map(i=>`<span><i style="background:${SpatialRender.LABELS[i][1]}"></i>${SpatialRender.LABELS[i][0]}</span>`).join('');
  $('alternatives').innerHTML=state.models.map((m,i)=>`<option value="${i}">方案 ${i+1} · 评分 ${m.generation.score.toFixed(1)}</option>`).join('');$('alternatives').value=index;$('alternatives').hidden=state.models.length<2;
  const forecast=state.result.forecast;
  $('forecast').innerHTML=forecast.assignments.map((rows,f)=>{let svg='<svg viewBox="0 0 240 240" role="img" aria-label="模型占位预测">';rows.forEach((row,y)=>row.forEach((id,x)=>{const r=forecast.query[id-1];svg+=`<rect x="${x*10}" y="${(23-y)*10}" width="10" height="10" fill="${r?SpatialRender.LABELS[r.label][1]:'#e7e8df'}"/>`;}));return `<div class="forecast-panel">${svg}</svg><p>${f+1}F / 模型原始占位预测</p><p>尚未经过网格布局和几何检查</p></div>`;}).join('');
  state.volume?.dispose();state.volume=SpatialRender.volume($('volume-canvas'),model);state.volume.setFloors(Number($('visible-floors').value));showView(state.view);
}
function showView(view){state.view=view;for(const v of ['plans','volume','topology','forecast'])$(v).hidden=!state.result||v!==view;document.querySelectorAll('[data-view]').forEach(b=>{const selected=b.dataset.view===view;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected));});if(view==='volume')requestAnimationFrame(()=>state.volume?.draw());}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('download-json').onclick=()=>{const geometry={...SpatialRender.geometry(activeModel()),generation:{...state.result.meta,conditions:state.result.conditions,condition_sources:state.result.sources,elapsed_seconds:state.result.elapsedSeconds,selected_candidate:activeModel().generation.selectedCandidate}};download(`spacemodal-seed${activeModel().seed}.json`,JSON.stringify(geometry,null,2),'application/json');};
$('download-showcase').onclick=async()=>{
  try{const source=await fetch('render.js').then(r=>{if(!r.ok)throw Error('展示文件加载失败');return r.text();});const model=activeModel(),data=JSON.stringify({...model,floorSpaces:model.floorSpaces.map(g=>Array.from(g)),floors:model.floors.map(g=>Array.from(g))}).replace(/</g,'\\u003c');const endScript='</script>';
    const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SpaceModal · 两层体块展示</title><style>body{font-family:"Microsoft YaHei",sans-serif;background:#f4f3ee;color:#243b30;margin:4vw}.plans{display:flex;gap:20px}.plans>div{width:50%}svg{width:100%;max-height:620px}canvas{width:100%;height:600px;touch-action:none}.graph{max-width:800px;margin:auto}h1{font-size:24px;font-weight:500}p{font-size:12px}.topology-svg{aspect-ratio:210/297}@media print{section{break-after:page}canvas{height:400px}.graph{width:190mm}}</style><h1>SpaceModal · ${(model.nx*.3).toFixed(1)} × ${(model.ny*.3).toFixed(1)} m · Seed ${model.seed}</h1><p>HGNN + CVA 浏览器推理；通过原 demo 检查，尚未经过项目完整验收。功能体块贴邻不等于真实门或通行路径。</p><section><h2>两层平面</h2><div id="plans" class="plans"></div></section><section><h2>交互三维</h2><label>显示楼层 <select id="floors"><option value="2">两层</option><option value="1">一层</option></select></label><canvas id="volume"></canvas></section><section class="graph"><h2>几何贴邻拓扑 / A4</h2><div id="topology"></div></section><script>${source.replace(/<\/script/gi,'<\\/script')}${endScript}<script>const model=${data};document.getElementById('plans').innerHTML=[0,1].map(f=>'<div>'+SpatialRender.plan(model,f)+'</div>').join('');document.getElementById('topology').innerHTML=SpatialRender.topology(model);const view=SpatialRender.volume(document.getElementById('volume'),model);document.getElementById('floors').onchange=e=>view.setFloors(Number(e.target.value));${endScript}</html>`;
    download(`spacemodal-seed${model.seed}-showcase.html`,html,'text/html');
  }catch(e){message(e.message,'error');}
};
$('chat-form').onsubmit=e=>{e.preventDefault();send($('prompt').value);};$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send($('prompt').value);}};
document.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>send(b.dataset.example));document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$('alternatives').onchange=()=>present(Number($('alternatives').value));$('visible-floors').onchange=e=>state.volume?.setFloors(Number(e.target.value));
$('cancel').onclick=()=>{if(state.worker){state.worker.terminate();state.worker=null;setBusy(false);message('本次生成已停止，可调整条件后重试。');status('已停止');}else state.abort?.abort();};
$('settings-open').onclick=()=>{$('parser-mode').value=state.mode;$('proxy-endpoint').value=state.endpoint;$('budget').value=state.conditions.budget;$('settings').showModal();};$('settings-close').onclick=()=>$('settings').close();
$('settings-form').onsubmit=e=>{e.preventDefault();try{const budget=Conditions.validate({budget:Number($('budget').value)}).budget;const url=new URL($('proxy-endpoint').value);if(url.protocol!=='https:')throw Error('代理地址需要 HTTPS');state.endpoint=url.href;state.mode=$('parser-mode').value;state.conditions.budget=budget;localStorage.setItem('spacemodal-generator-preferences',JSON.stringify({endpoint:state.endpoint,mode:state.mode,budget}));modeLabel();$('settings').close();}catch(e){message(e.message,'error');}};
$('reset').onclick=()=>{if(state.busy)return;state.volume?.dispose();state.volume=null;state.result=null;state.models=[];state.conditions={...Conditions.DEFAULTS,budget:state.conditions.budget};state.sources=Object.fromEntries(Object.keys(state.conditions).map(k=>[k,'demo_default']));localStorage.removeItem('spacemodal-generator-last');$('messages').replaceChildren();message('新的设计对话已开始。请输入生成范围、卧室和卫生间数量。');$('empty').hidden=false;$('metrics').hidden=true;$('legend').hidden=true;$('alternatives').hidden=true;$('result-title').textContent='空间预览';$('download-json').disabled=true;$('download-showcase').disabled=true;showView('plans');status('等待需求');};
modeLabel();
try{const saved=JSON.parse(localStorage.getItem('spacemodal-generator-last')||'null');if(saved){Conditions.validate(saved.conditions);state.result=saved;state.conditions={...saved.conditions};state.sources=saved.sources;state.models=[saved.model,...saved.alternatives];present(0);message('已恢复当前浏览器上次生成的结果。继续描述需求即可调整。');}}catch{}
