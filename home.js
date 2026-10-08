const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const palette = ['#d9dfcf', '#d89a78', '#e8dfce', '#e8dfce', '#d9dfcf', '#d89a78'];
const shapes = [
  {x:0,y:0,w:140,d:100,z:0}, {x:150,y:0,w:110,d:100,z:0}, {x:0,y:110,w:260,d:100,z:0},
  {x:0,y:0,w:110,d:210,z:175}, {x:120,y:0,w:140,d:100,z:175}, {x:120,y:110,w:140,d:100,z:175}
];
const mix=(a,b,t)=>a+(b-a)*t;
const project=(x,y,z)=>[376+(x-y)*.91,370+(x+y)*.43-z];
const fmt=p=>p.map(v=>v.toFixed(2)).join(',');
const path=pts=>pts.map(fmt).join(' ');
function isoArt(dimensional=1, graph=0) {
  const map=(i,x,y,z)=>{
    const r=shapes[i],u=(x-r.x)/r.w,v=(y-r.y)/r.d;
    const flat=[158+(i%3)*147+u*130,208+Math.floor(i/3)*122+v*104];
    const spatial=project(x,y,z);
    return [mix(flat[0],spatial[0],dimensional),mix(flat[1],spatial[1],dimensional)];
  };
  const originalCenters=shapes.map((r,i)=>map(i,r.x+r.w/2,r.y+r.d/2,r.z+52));
  const centers=originalCenters.map(c=>[mix(c[0],380+(c[0]-380)*1.75,graph),mix(c[1],325+(c[1]-325)*1.35,graph)]);
  let out='<defs><filter id="soft-shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="13"/></filter><pattern id="dot-grid" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#c5c5ba" opacity=".55"/></pattern></defs>';
  out+='<rect x="32" y="46" width="674" height="522" fill="url(#dot-grid)" opacity=".34"/>';
  const corners=[[-22,-22],[282,-22],[282,232],[-22,232]];
  const plane=(z)=>corners.map(([x,y])=>project(x,y,z));
  out+=`<polygon points="${path(plane(-12).map(([x,y])=>[x+8,y+19]))}" fill="#797c6c" filter="url(#soft-shadow)" opacity="${dimensional*(1-graph)*.14}"/>`;
  if(dimensional>0){
    out+=`<g opacity="${dimensional*(1-graph)}">`;
    for(const [x,y] of corners) { const a=project(x,y,0),b=project(x,y,218);out+=`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#aeb4a6" stroke-width=".8" stroke-dasharray="3 6"/>`;}
    out+='</g>';
  }
  for(const floor of [0,1]) {
    if(dimensional>0){const z=floor*175-4;out+=`<g opacity="${dimensional*(1-graph)}"><polygon points="${path(plane(z-5))}" fill="#d7d9ce" stroke="#a8ae9f" stroke-width=".7"/><polygon points="${path(plane(z))}" fill="#f0f0e8" stroke="#9da694" stroke-width=".8"/></g>`;}
    shapes.forEach((r,i)=>{
      if(Math.floor(i/3)!==floor)return;
      const c=centers[i],shrink=p=>[mix(p[0],c[0]+Math.sign(p[0]-originalCenters[i][0])*12,graph),mix(p[1],c[1]+Math.sign(p[1]-originalCenters[i][1])*12,graph)];
      const top=[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.d],[r.x,r.y+r.d]].map(([x,y])=>shrink(map(i,x,y,r.z+52)));
      const base=[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.d],[r.x,r.y+r.d]].map(([x,y])=>map(i,x,y,r.z));
      out+=`<g class="art-block"><g opacity="${dimensional*(1-graph)}"><polygon points="${path([top[1],top[2],base[2],base[1]])}" fill="${palette[i]}" stroke="#7d8275" stroke-width=".85"/><polygon points="${path([top[2],top[3],base[3],base[2]])}" fill="${palette[i]}" stroke="#7d8275" stroke-width=".85"/><polygon points="${path([top[2],top[3],base[3],base[2]])}" fill="#5c6755" opacity=".12"/></g><polygon points="${path(top)}" fill="${palette[i]}" stroke="#6f7966" stroke-width="${mix(.9,1.4,graph)}"/>`;
      if(graph<.6) out+=`<text x="${c[0]}" y="${c[1]+4}" font-size="9" fill="#68705f" text-anchor="middle" font-family="monospace" opacity="${(1-graph)*.65}">0${i+1}</text>`;
      out+='</g>';
    });
  }
  if(graph>0){
    const es=[[0,1],[0,2],[1,4],[2,5],[3,4],[4,5],[0,3]];
    out+=`<g opacity="${graph}" stroke="#77886a" fill="none" stroke-width="1.25">`;
    for(const [a,b] of es){let A=centers[a],B=centers[b];out+=`<path d="M${fmt(A)} C${fmt([A[0],mix(A[1],B[1],.5)])} ${fmt([B[0],mix(A[1],B[1],.5)])} ${fmt(B)}"/>`;}
    out+='</g>';
    centers.forEach((c,i)=>{out+=`<g opacity="${graph}"><circle cx="${c[0]}" cy="${c[1]}" r="11" fill="${palette[i]}" stroke="#617456" stroke-width="1.5"/><text x="${c[0]+22}" y="${c[1]+4}" font-size="12" fill="#5c6658" font-family="monospace">0${i+1}</text></g>`;});
  }
  out+=`<g opacity="${dimensional*(1-graph)*.7}" font-size="9" font-family="monospace" fill="#82897a"><path d="M112 296h64M176 296l17-10M569 484h54" stroke="#a0a695" stroke-width=".8" fill="none"/><text x="112" y="287">LAYER 02</text><text x="582" y="475">LAYER 01</text></g>`;
  out+='<g transform="translate(615 565)" stroke="#999f91" fill="none" stroke-width=".8"><path d="M0 0l26 12M0 0l-26 12M0 0v-28"/><g font-family="monospace" font-size="8" fill="#8b9381" stroke="none"><text x="31" y="17">x</text><text x="-36" y="17">y</text><text x="-2" y="-34">z</text></g></g>';
  return out;
}
const hero=document.querySelector('#hero-svg');
if(hero){
  let current=[0,0],raf=0,timers=[];
  const modes={plan:[0,0],volume:[1,0],graph:[1,1]};
  const buttons=[...document.querySelectorAll('[data-scene]')];
  function setScene(name,animate=true){
    const target=modes[name],from=[...current],start=performance.now();cancelAnimationFrame(raf);
    buttons.forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.scene===name));b.classList.toggle('selected',b.dataset.scene===name)});
    document.querySelector('#art-state').textContent={plan:'01 / 平面',volume:'02 / 三维',graph:'03 / 关系'}[name];
    const tick=now=>{let p=animate&&!reducedMotion?Math.min(1,(now-start)/1050):1;let t=p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;current=[mix(from[0],target[0],t),mix(from[1],target[1],t)];hero.innerHTML=isoArt(...current);if(p<1)raf=requestAnimationFrame(tick)};
    raf=requestAnimationFrame(tick);
  }
  buttons.forEach(b=>b.onclick=()=>{timers.forEach(clearTimeout);setScene(b.dataset.scene)});
  if(reducedMotion)setScene('volume',false);
  else {setScene('plan',false);timers=[setTimeout(()=>setScene('volume'),950),setTimeout(()=>setScene('graph'),2450),setTimeout(()=>setScene('volume'),3950)];}
}
const about=document.querySelector('#about-svg');if(about)about.innerHTML=isoArt(1,0);
const diagramTemplates={
 geometry:'<g stroke="#7b806e" stroke-width="1.2" fill="none"><path d="M99 81l73-34 83 37-72 36z" fill="#e2e5d9"/><path d="M99 81v74l84 40v-75" fill="#d9dfcf"/><path d="M183 120l72-36v75l-72 36" fill="#bec9b3"/><path d="M82 173l92 43m14 5l79-37M82 168v10m91 31v12m22 2l-7-5m85-39l-7-5" stroke="#a2a797" stroke-width=".7"/><path d="M99 155l72-34 84 38M171 121V47" stroke-dasharray="3 4" opacity=".5"/></g><text x="92" y="213" font-size="9" fill="#939988" font-family="monospace">X / Y / Z</text>',
 topology:'<g fill="none" stroke="#a6ad9b" stroke-width="1.2"><path d="M94 83L182 58L265 127L181 189L94 154Z M94 83L181 189M182 58L181 189M94 154L265 127"/></g><g stroke="#6d7a62" stroke-width="1.2"><circle cx="94" cy="83" r="14" fill="#d9dfcf"/><circle cx="182" cy="58" r="14" fill="#e8dfce"/><circle cx="265" cy="127" r="14" fill="#d9dfcf"/><circle cx="181" cy="189" r="14" fill="#d89a78"/><circle cx="94" cy="154" r="14" fill="#e8dfce"/></g><circle cx="181" cy="189" r="24" fill="none" stroke="#d89a78" opacity=".45"/>',
 semantics:'<g font-family="sans-serif" font-size="12"><rect x="81" y="57" width="203" height="46" fill="#d9dfcf"/><rect x="81" y="111" width="149" height="46" fill="#e8dfce"/><rect x="81" y="165" width="181" height="46" fill="#d89a78"/><g fill="#44503c"><text x="101" y="85">客厅</text><text x="101" y="139">卧室</text><text x="101" y="193">走道</text></g><g font-family="monospace" font-size="9" fill="#6f7765"><text x="263" y="85" text-anchor="end">LIVING</text><text x="210" y="139" text-anchor="end">BEDROOM</text><text x="241" y="193" text-anchor="end">CORRIDOR</text></g></g>'
};
for(const el of document.querySelectorAll('[data-diagram]'))el.innerHTML=`<svg viewBox="0 0 360 260" aria-hidden="true">${diagramTemplates[el.dataset.diagram]}</svg>`;
const roomColors={entryway:'#d5bca5',living_room:'#bac9af',dining_room:'#e2c6a0',kitchen:'#d9a98b',bedroom:'#c4ccd6',bathroom:'#b7d1ce',corridor:'#d9d6c7',stairs:'#8d9b83',utility:'#cebdc8',balcony:'#d3ddbb',multi_purpose:'#d8c6ab'};
for(const el of document.querySelectorAll('[data-house]')){
  fetch('/case-data/house_'+el.dataset.house+'.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{
    let W=d.metadata.building_size.x,H=d.metadata.building_size.y;
    let content=d.rooms.filter(r=>(r.floors||[r.floor]).includes(1)).map(r=>`<rect x="${r.box_min[0]}" y="${H-r.box_max[1]}" width="${r.box_max[0]-r.box_min[0]}" height="${r.box_max[1]-r.box_min[1]}" fill="${roomColors[r.type]||'#ddd'}" stroke="#fcfbf8" stroke-width="60"/>`).join('');
    el.querySelector('.case-drawing').innerHTML=`<svg viewBox="-300 -300 ${W+600} ${H+600}" aria-label="house_${el.dataset.house} 一层体块平面" role="img">${content}</svg>`;
  }).catch(()=>{el.querySelector('.case-drawing').innerHTML='<span class="load-note">图像暂不可用</span>'});
}
const scramble=document.querySelector('#scramble');
if(scramble&&!reducedMotion){const value='SPATIAL MODALITY',chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';let frame=0;const interval=setInterval(()=>{frame++;scramble.textContent=[...value].map((c,i)=>c===' '||i<frame?c:chars[Math.floor(Math.random()*chars.length)]).join('');if(frame>=value.length){clearInterval(interval);scramble.textContent=value}},32);}
