/* Browser-only data adapter. Uploads never leave this browser. */
(()=>{
  const base=new URL('../',document.currentScript.src);
  const labels={entryway:'玄关',living_room:'客厅',dining_room:'餐厅',kitchen:'厨房',bedroom:'卧室',bathroom:'卫生间',corridor:'走道',stairs:'楼梯间',utility:'家政空间',balcony:'阳台',multi_purpose:'多功能室'};
  let manifest,db,activeURLs=[];
  const database=()=>db||(db=new Promise((resolve,reject)=>{
    const request=indexedDB.open('spacemodal-defense-demo',1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('drafts');request.result.createObjectStore('uploads');};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('浏览器存储不可用，请使用普通浏览模式'));
  }));
  async function read(store,key){const d=await database();return new Promise((resolve,reject)=>{
    const q=d.transaction(store).objectStore(store).get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
  });}
  async function all(store){const d=await database();return new Promise((resolve,reject)=>{
    const q=d.transaction(store).objectStore(store).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
  });}
  async function put(store,key,value){const d=await database();return new Promise((resolve,reject)=>{
    const tx=d.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}
  async function builtins(){if(!manifest){const r=await fetch(new URL('manifest.json',base));if(!r.ok)throw Error('示例列表加载失败');manifest=await r.json();}return manifest;}
  async function original(id){
    if((await builtins()).some(c=>c.id===id)){
      const r=await fetch(new URL(`cases/${id}/draft.json`,base));if(!r.ok)throw Error('示例加载失败');return r.json();
    }
    const item=await read('uploads',id);if(!item)throw Error('找不到本地案例');return structuredClone(item.draft);
  }
  async function attachImages(draft){
    // Revoke previous upload URLs only when changing the active document.
    for(const url of activeURLs)URL.revokeObjectURL(url);activeURLs=[];
    const item=await read('uploads',draft.case_id);
    for(const floor of draft.floors){
      if(item){const blob=item.images.find(x=>x.name===floor.image_name)?.blob;if(!blob)throw Error('本地图片缺失');
        floor.image_url=URL.createObjectURL(blob);activeURLs.push(floor.image_url);
      }else floor.image_url=new URL(`cases/${draft.case_id}/${floor.image_name}`,base).href;
    }
    return draft;
  }
  function clean(draft){const copy=structuredClone(draft);for(const f of copy.floors)delete f.image_url;return copy;}
  async function save(draft){
    const d=await database();return new Promise((resolve,reject)=>{
      const tx=d.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),q=store.get(draft.case_id);let result,error;
      q.onsuccess=()=>{
        if(draft.revision!==(q.result?.revision||0)){error=Object.assign(Error('浏览器版本已更新，请下载草稿并打开已保存版'),{status:409});tx.abort();return;}
        result=clean(draft);result.revision++;result.status='draft';store.put(result,draft.case_id);
      };
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||Error('保存失败'));tx.onerror=()=>reject(tx.error);
    });
  }
  function inside(x,y,polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const [xi,yi]=polygon[i],[xj,yj]=polygon[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)yes=!yes;
  }return yes;}
  function validate(draft){
    const issues=[],rooms=draft.rooms||[],size=draft.building_size||{},valid=[];
    const add=(code,detail)=>issues.push({level:'error',code,detail});
    if(draft.floors?.length!==2)add('two_floors','必须有两层图纸');
    if(!rooms.length)add('empty','尚未绘制任何体块');
    if(!['x','y'].every(k=>Number.isFinite(size[k])&&size[k]>0&&size[k]<=60000))add('building_size','建筑尺寸应在 300—60000 mm 内');
    rooms.forEach((room,index)=>{
      const prefix=`体块 ${index+1}`,lo=room.box_min,hi=room.box_max;
      if(!labels[room.type])add('room_type',`${prefix} 待分类`);
      if(![1,2].includes(room.floor))add('floor',`${prefix} 楼层无效`);
      if(!Array.isArray(lo)||!Array.isArray(hi)||lo.length!==3||hi.length!==3||![...lo,...hi].every(Number.isFinite)){add('box',`${prefix} 坐标无效`);return;}
      if(hi.some((v,i)=>v<=lo[i])){add('box',`${prefix} 长宽高必须大于零`);return;}
      if([...lo,...hi].some(v=>Math.abs(v/300-Math.round(v/300))>1e-6))add('modulus',`${prefix} 未对齐 300 mm`);
      const z=room.floor===1?0:3000;if(lo[2]!==z||![z+3000,6000].includes(hi[2]))add('height',`${prefix} 高度与楼层不一致`);
      if(room.type==='stairs'&&(lo[2]!==0||hi[2]!==6000))add('stairs',`${prefix} 楼梯应贯通两层`);
      if(lo[2]===0&&hi[2]===6000&&!['stairs','living_room'].includes(room.type))add('double_height',`${prefix} 类别不能贯通两层`);
      if(lo[0]<0||lo[1]<0||hi[0]>size.x||hi[1]>size.y)add('outside',`${prefix} 超出建筑范围`);
      valid.push(room);
    });
    for(let i=0;i<valid.length;i++)for(let j=i+1;j<valid.length;j++)if([0,1,2].every(k=>Math.min(valid[i].box_max[k],valid[j].box_max[k])>Math.max(valid[i].box_min[k],valid[j].box_min[k])))add('overlap',`${valid[i].id} 与 ${valid[j].id} 重叠`);
    if(!rooms.some(r=>r.type==='entryway'&&r.floor===1))add('entryway','一层缺少玄关体块');
    if(![1,2].every(f=>rooms.some(r=>r.floor===f)))add('floor_coverage','两层都必须有体块');
    if(size.x>0&&size.x<=60000&&size.y>0&&size.y<=60000)for(const floor of draft.floors||[]){
      if(!Array.isArray(floor.boundary)||floor.boundary.length<3){add('boundary',`${floor.floor} 层建筑边界未确认`);continue;}
      let empty=0,total=0;const z=floor.floor===1?1500:4500;
      for(let x=150;x<size.x;x+=300)for(let y=150;y<size.y;y+=300)if(inside(x,y,floor.boundary)){
        total++;if(!valid.some(r=>r.box_min[0]<=x&&r.box_max[0]>x&&r.box_min[1]<=y&&r.box_max[1]>y&&r.box_min[2]<=z&&r.box_max[2]>z))empty++;
      }
      if(empty)add('uncovered',`${floor.floor} 层建筑边界内 ${empty}/${total} 个网格未覆盖`);
    }
    return {valid:issues.length===0,issues};
  }
  function download(value,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function geometry(draft){
    const {x,y}=draft.building_size,q=draft.north_rotation_quadrants%4;
    const rotate=(a,b)=>q===1?[b,x-a]:q===2?[x-a,y-b]:q===3?[y-b,a]:[a,b];
    return {schema_version:'geometry_v1',house_id:draft.house_id,building_size:{x:q%2?y:x,y:q%2?x:y,z:6000},
      rooms:draft.rooms.map((r,i)=>{const lo=r.box_min,hi=r.box_max,corners=[rotate(lo[0],lo[1]),rotate(lo[0],hi[1]),rotate(hi[0],lo[1]),rotate(hi[0],hi[1])];
        return {id:`room_${i}`,type:r.type,floor:r.floor,floors:lo[2]===0&&hi[2]===6000?[1,2]:[r.floor],box_min:[Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),lo[2]],box_max:[Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1])),hi[2]]};}),
      review:{mode:'browser_demo',exported_at:new Date().toISOString(),source_images:draft.floors.map(f=>f.image_name),scale_source:draft.scale_source}};
  }
  async function request(path,options={}){
    if(path==='/api/session')return {name:'defense-demo',role:'admin'};
    if(path==='/api/health')return {types:Object.entries(labels).map(([id,label])=>({id,label})),providers:[{id:'prepared',model:'预置标注',available:true}],provider:'prepared'};
    if(path==='/api/cases'){
      const samples=await builtins(),imports=await all('uploads'),drafts=await all('drafts');
      return [...samples,...imports.map(x=>({id:x.draft.case_id,name:x.draft.case_name,status:'draft',builtin:false}))].map(c=>({...c,status:drafts.find(d=>d.case_id===c.id)?.status||c.status}));
    }
    const match=path.match(/^\/api\/cases\/(\d+)(?:\/(save|validate|approve|vision))?/);if(!match)throw Error('演示版不支持此操作');
    const id=Number(match[1]),action=match[2],draft=options.body?JSON.parse(options.body):null;
    if(!action)return attachImages(structuredClone(await read('drafts',id)||await original(id)));
    if(action==='save'){const saved=await save(draft);return {status:'draft',revision:saved.revision};}
    if(action==='validate')return validate(draft);
    if(action==='vision'){
      if(!(await builtins()).some(c=>c.id===id))throw Error('上传图纸请手动标注；当前演示版没有在线 AI 识别');
      const prepared=await original(id);prepared.revision=draft.revision;return attachImages(prepared);
    }
    if(action==='approve'){
      const result=validate(draft);if(!result.valid)throw Error('检测未通过，请修正后再导出');
      const saved=await save(draft);download(geometry(saved),`${saved.house_id}.geometry.json`);
      // Export does not seal an editable browser draft or write into the research dataset.
      return {status:'draft',revision:saved.revision,rooms:saved.rooms.length};
    }
  }
  async function upload(form){
    const files=[form.elements.floor1.files[0],form.elements.floor2.files[0]],width=Number(form.elements.width.value),depth=Number(form.elements.depth.value);
    if(!files.every(f=>f&&['image/jpeg','image/png','image/webp'].includes(f.type)&&f.size<=20*1024*1024))throw Error('每层请选择不超过 20 MB 的 JPG、PNG 或 WebP 图片');
    if(![width,depth].every(v=>Number.isFinite(v)&&v>=300&&v<=60000&&v%300===0))throw Error('尺寸须为 300 mm 的整数倍，范围 300—60000 mm');
    const bitmaps=[];
    try{for(const file of files){const bitmap=await createImageBitmap(file);bitmaps.push(bitmap);if(bitmap.width*bitmap.height>40000000)throw Error('图片分辨率过大，请使用不超过 4000 万像素的图纸');}
      const id=Date.now(),draft={schema_version:'review_draft_v1',case_id:id,house_id:`house_${id}`,case_name:form.elements.name.value.trim()||'本地图纸',source:'local_upload',status:'draft',revision:0,scale_source:'user_dimensions_needs_calibration',north_rotation_quadrants:0,building_size:{x:width,y:depth,z:6000},axes:[],rooms:[],guides:[],
        floors:files.map((file,i)=>({floor:i+1,image_name:`floor-${i+1}-${file.name}`,image_size:[bitmaps[i].width,bitmaps[i].height],bounds_px:[0,0,bitmaps[i].width,bitmaps[i].height],boundary:[[0,0],[width,0],[width,depth],[0,depth]]}))};
      await put('uploads',id,{draft,images:files.map((file,i)=>({name:`floor-${i+1}-${file.name}`,blob:file}))});return id;
    }finally{bitmaps.forEach(b=>b.close());}
  }
  window.REVIEW_DEMO={request,validate,geometry,upload,updateStatus(){document.getElementById('cloud-state').textContent='预置示例 · 本地标注';document.getElementById('vision-btn').disabled=false;},install(){
    const dialog=document.getElementById('upload-dialog'),form=document.getElementById('upload-form');
    document.getElementById('demo-show-rooms').onchange=()=>render();
    if(innerWidth>=1100&&!drawerPinned('inspector'))toggleDrawerPin('inspector');
    document.getElementById('upload-plans-btn').onclick=()=>dialog.showModal();
    document.getElementById('upload-cancel').onclick=()=>dialog.close();
    form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;document.getElementById('upload-error').textContent='';
      try{const id=await upload(form);await refreshCases();await openCase(id);dialog.close();msg('图纸已保存到此浏览器。先校准两层建筑范围，再画体块与分类。');}
      catch(error){document.getElementById('upload-error').textContent=error.message;}finally{button.disabled=false;}
    };
    document.getElementById('approve-btn').onclick=async()=>{
      try{
      if(!state.draft||persistence.pending)return;await validateCase();if(!state.qc?.valid)return;
      if(!await saveCase(true))return;
      const result=await request(`/api/cases/${state.draft.case_id}/approve`,{body:JSON.stringify(state.draft)});
      state.draft.revision=result.revision;state.draft.status='draft';persistence.baseline=draftContent();msg('几何 JSON 已下载，当前案例仍可继续编辑。');
      }catch(error){msg(`导出失败：${error.message}`);}
    };
    document.getElementById('case-filter').value='all';renderCaseList();
    openCase(2107);
  }};
})();
