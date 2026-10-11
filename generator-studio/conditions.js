(function(root){
  'use strict';
  const DEFAULTS={length:10800,width:10800,bedrooms:3,bedrooms0:1,living1:1,utility1:1,bathrooms:2,balconies0:-1,balconies1:-1,seed:123,budget:2400};
  const keys=Object.keys(DEFAULTS);
  const num=s=>/^\d+(?:\.\d+)?$/.test(s)?Number(s):({'零':0,'一':1,'两':2,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}[s]);
  function validate(patch) {
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('需求解析没有返回有效字段');
    for(const [k,v] of Object.entries(patch)) {
      if(k==='anchorMode'){if(!['near','hall','public'].includes(v))throw Error('入口—楼梯模式无效');continue;}
      if(!keys.includes(k))throw Error('解析返回了未支持的条件：'+k);
      if(typeof v!=='number'||!Number.isFinite(v)||!Number.isInteger(v))throw Error(k+' 必须为整数');
      if(['length','width'].includes(k)&&(v<6000||v>18000||v%300))throw Error('长宽须在 6–18 米内，并符合 0.3 米模数；请修改尺寸。');
      if(['bedrooms','bathrooms'].includes(k)&&(v<1||v>8))throw Error('当前 demo 支持 1–8 间卧室、1–8 间卫生间。');
      if(k==='bedrooms0'&&(v<0||v>8))throw Error('一层卧室数量须为0–8间。');
      if(['living1','utility1'].includes(k)&&(v<0||v>1))throw Error('二层客厅和家政用房须为0或1间。');
      if(['balconies0','balconies1'].includes(k)&&(v< -1||v>4))throw Error('每层阳台支持0–4个；-1表示采用训练集统计默认值');
      if(k==='seed'&&(v<0||v>4294967295))throw Error('种子须为 0–4294967295 的整数');
      if(k==='budget'&&(v<1||v>4800))throw Error('搜索预算须为 1–4800 的整数');
    }
    if(patch.bedrooms0!==undefined&&patch.bedrooms!==undefined&&patch.bedrooms0>patch.bedrooms)throw Error('一层卧室数量不能超过卧室总数。');
    return patch;
  }
  function local(text,current) {
    const patch={},unsupported=[];
    const n='([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十])';
    let upperBedrooms;
    const general=text.replace(/(一层|一楼|首层|1层|二层|二楼|2层)([^，。；;\n]*?)(?=(?:一层|一楼|首层|1层|二层|二楼|2层)|[，。；;\n]|$)/g,(match,floor,description)=>{
      const lower=/^(一|首|1)/.test(floor);let rest=description,recognized=false;
      const bedroom=new RegExp('(?:卧室\\s*(?:数量)?\\s*(?:改为|改成|为|是|=|：|:)?\\s*'+n+'\\s*(?:个|间)?|'+n+'\\s*(?:个|间)?\\s*卧室)');
      rest=rest.replace(bedroom,(m,a,b)=>{if(lower)patch.bedrooms0=num(a||b);else upperBedrooms=num(a||b);recognized=true;return '';});
      rest=rest.replace(/(?:不要|不需要|取消|去掉|不设)\s*卧室/g,()=>{if(lower)patch.bedrooms0=0;else upperBedrooms=0;recognized=true;return '';});
      if(!lower)for(const [key,term] of [['living1','客厅'],['utility1','家政用房|家政空间|家政间|家政房|家政']]){
        rest=rest.replace(new RegExp('(?:不要|不需要|取消|去掉|不设)\\s*(?:'+term+')'),()=>{patch[key]=0;recognized=true;return '';});
        rest=rest.replace(new RegExp('(?:'+term+')\\s*(?:数量)?\\s*(?:改为|改成|为|是|=|：|:)?\\s*'+n+'\\s*(?:个|间)?|'+n+'\\s*(?:个|间)?\\s*(?:'+term+')'),(m,a,b)=>{patch[key]=num(a||b);recognized=true;return '';});
        rest=rest.replace(new RegExp('(?:'+term+')'),()=>{patch[key]=/^\s*(?:不要|不需要|取消|去掉|不设)/.test(description)&&!/(?:但|仍|保留)/.test(description)?0:1;recognized=true;return '';});
      }
      return recognized?rest:match;
    });
    const dims=text.match(/(\d+(?:\.\d+)?)\s*(毫米|mm|米|m)?\s*[×xX*乘]\s*(\d+(?:\.\d+)?)\s*(毫米|mm|米|m)?/i);
    const mm=(v,unit)=>Number(v)*(unit==='毫米'||unit?.toLowerCase()==='mm'?1:unit==='米'||unit?.toLowerCase()==='m'?1000:Number(v)<=100?1000:1);
    if(dims){const unit=dims[2]||dims[4];patch.length=mm(dims[1],unit);patch.width=mm(dims[3],dims[4]||unit);}
    for(const [k,label] of [['length','长'],['width','宽']]) {
      const m=text.match(new RegExp(label+'(?:度)?\\s*(?:改为|改成|为|是|=|：|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*(毫米|mm|米|m)?','i'));
      if(m)patch[k]=mm(m[1],m[2]);
    }
    for(const [key,term] of [['bedrooms','卧室'],['bathrooms','卫生间|浴室']]) {
      const before=general.match(new RegExp(n+'\\s*(?:个|间)?\\s*(?:'+term+')'));
      const after=general.match(new RegExp('(?:'+term+')\\s*(?:数量)?\\s*(?:改为|改成|为|是|=|：|:)?\\s*'+n+'\\s*(?:个|间)?'));
      if(before||after)patch[key]=num((before||after)[1]);
      if(new RegExp('(?:增加|加|多)\\s*(?:一|1)\\s*(?:间|个)?\\s*(?:'+term+')').test(general))patch[key]=current[key]+1;
      if(new RegExp('(?:减少|减|少)\\s*(?:一|1)\\s*(?:间|个)?\\s*(?:'+term+')').test(general))patch[key]=current[key]-1;
    }
    const seed=text.match(/(?:种子|seed)\s*(?:改为|为|=|：|:)?\s*(\d+)/i);if(seed)patch.seed=Number(seed[1]);
    if(upperBedrooms!==undefined){const total=(patch.bedrooms0??current.bedrooms0??0)+upperBedrooms;if(patch.bedrooms!==undefined&&patch.bedrooms!==total)throw Error('各层卧室数量之和与卧室总数不一致。');patch.bedrooms=total;}
    let remaining=general;
    remaining=remaining.replace(/(一层|一楼|首层|1层|二层|二楼|2层)\s*(?:不要|不需要|取消|去掉)\s*阳台/g,(match,floor)=>{
      patch[/^(一|首|1)/.test(floor)?'balconies0':'balconies1']=0;return '';
    });
    const floorBalcony=new RegExp('(一层|一楼|首层|1层|二层|二楼|2层)\\s*(?:阳台\\s*(?:数量)?\\s*(?:改为|改成|为|是|=|：|:)?\\s*'+n+'\\s*(?:个|间)?|'+n+'\\s*(?:个|间)?\\s*阳台)','g');
    remaining=remaining.replace(floorBalcony,(match,floor,a,b)=>{patch[/^(一|首|1)/.test(floor)?'balconies0':'balconies1']=num(a||b);return '';});
    if(/(?:不要|不需要|取消|去掉)\s*(?:所有|全部)?阳台|无阳台/.test(remaining)){
      patch.balconies0=0;patch.balconies1=0;remaining=remaining.replace(/(?:不要|不需要|取消|去掉)\s*(?:所有|全部)?阳台|无阳台/g,'');
    }
    if(/阳台(?:数量)?(?:恢复|采用|使用)?(?:统计|默认)/.test(remaining)){patch.balconies0=-1;patch.balconies1=-1;}
    if(/换(?:一|个|一套|一个)|再来|另一个|新方案/.test(text)&&!seed)patch.seed=(current.seed+1)>>>0;
    const floors=remaining.match(/(?:共|总共|总计|生成|建造|建)\s*([零一二两三四五六七八九十0-9]+)\s*层|([三四五六七八九十3-9])\s*层(?:住宅|建筑|房)/);
    if(floors&&num(floors[1]||floors[2])!==2)unsupported.push('固定为两层，当前不能生成其他层数');
    if(/一楼|二楼|一层.*卧室|二层.*卧室|楼上|楼下/.test(remaining))unsupported.push('请明确一层卧室数量；二层客厅、家政用房可设0或1间，其他楼层分配尚未接入');
    if(/朝|向南|向北|邻|靠|相接|挑空|层高|高度|墙|窗|门|车库|不要|不需要|取消|去掉|面积|平方米|㎡|客厅.*大|厨房.*大/.test(remaining))unsupported.push('位置、朝向、挑空、面积及其他功能增减尚未接入本 demo');
    if(!Object.keys(patch).length&&!unsupported.length)unsupported.push('本地解析未识别到尺寸、卧室数、卫生间数或换方案；复杂表述请连接大模型');
    return {patch:validate(patch),unsupported:[...new Set(unsupported)]};
  }
  const SYSTEM=`你是二层住宅需求解析器，只输出 JSON，不生成几何。格式：{"patch":{},"unsupported":[]}。
patch 只包含用户本轮明确修改的字段：length,width（毫米，6000–18000 且300整除）、bedrooms,bathrooms（1–8整数）、bedrooms0（一层卧室数量，0至卧室总数；二层采用剩余数量）、living1,utility1（二层客厅、家政用房数量，0或1整数）、seed（0–4294967295整数）、budget（1–4800整数）。balconies0,balconies1（一、二层阳台数量，0–4整数，-1采用统计默认值）。一层一间卧室只改变bedrooms0，不把卧室总数改成1；两层卧室数量均明确时合计为bedrooms。二层设客厅或家政用房设对应字段1，不设则0。不要阳台时均设0，未指定楼层的阳台数量写入unsupported要求按层指定。不得补写未修改字段，不得将不合模数尺寸擅自四舍五入。允许参考当前条件理解增加/减少。换方案时 seed 加1。
生成边界是矩形范围，固定二层，每层3000mm。支持长宽、卧室总数及一层卧室数、二层客厅和家政用房、卫生间总数、每层阳台数量、种子、预算。位置、朝向、面积、挑空及其他功能增减不支持，原样列入unsupported，不能承诺实现。非住宅生成或无法理解的请求也写入unsupported。中文数字转整数。`;
  async function remote(text,current,config,signal) {
    const url=new URL(config.endpoint);
    const localEndpoint=typeof location!=='undefined'&&location.origin==='http://127.0.0.1:8080'&&url.href===location.origin+'/api/generator/parse';
    if(url.protocol!=='https:'&&!localEndpoint)throw Error('大模型接口需要 HTTPS 地址或本机同源解析服务');
    let response;
    const {anchorMode,...numericCurrent}=current;
    let legacyParser=false;
    const request=fields=>fetch(url,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({current:fields,text})});
    try{
      response=await request(numericCurrent);
      // Older hosted parsers reject new current fields before making an LLM call.
      if(response.status===400&&['bedrooms0','living1','utility1'].some(k=>k in numericCurrent)){
        const legacy={...numericCurrent};for(const k of ['bedrooms0','living1','utility1'])delete legacy[k];
        response=await request(legacy);legacyParser=true;
      }
    }
    catch(e){if(e.name==='AbortError')throw e;
      if(typeof location!=='undefined'&&location.hostname==='127.0.0.1'&&location.port!=='8080')throw Error('当前本地预览地址不在大模型代理允许的来源内。请打开本机大模型工作台（8080 端口），或使用本地规则继续。');
      throw Error('当前网络无法连接大模型代理，可能被网络或托管平台拦截。可点击“使用本地规则继续”，或稍后重试。');}
    let data;try{data=await response.json();}catch{throw Error('大模型代理返回了非预期页面，可能被托管平台拦截。可使用本地规则继续。');}
    if(!response.ok)throw Error(data.error||('需求解析接口返回 '+response.status));
    const parsed=data;
    if(!Array.isArray(parsed.unsupported)||parsed.unsupported.some(s=>typeof s!=='string'))throw Error('大模型返回的限制说明格式无效');
    const patch=validate(parsed.patch);
    if(legacyParser){
      const floor=local(text,current),floorKeys=['bedrooms0','living1','utility1'];
      for(const k of floorKeys)if(k in floor.patch)patch[k]=floor.patch[k];
      if('bedrooms0' in floor.patch||'living1' in floor.patch||'utility1' in floor.patch){
        if('bedrooms0' in floor.patch&&floor.patch.bedrooms===undefined)delete patch.bedrooms;
        if(floor.patch.bedrooms!==undefined)patch.bedrooms=floor.patch.bedrooms;
        if(!floor.unsupported.length)parsed.unsupported=parsed.unsupported.filter(t=>!/楼层|一层.*卧室|二层.*(?:客厅|家政)/.test(t));
      }
    }
    // Some models echo current values despite being asked for a patch. Do not
    // attribute an unmentioned, unchanged default to an explicit user request.
    const mentions={bedrooms0:/卧|bedroom/i,living1:/客厅|living/i,utility1:/家政|utility/i,balconies0:/阳台|balcon/i,balconies1:/阳台|balcon/i,length:/长|宽|尺寸|边界|范围|尺度|×|[xX*]|米|mm|length/i,width:/长|宽|尺寸|边界|范围|尺度|×|[xX*]|米|mm|width/i,bedrooms:/卧|bedroom/i,bathrooms:/卫|浴|bathroom/i,seed:/种子|seed|换|另一|再来|新方案/i,budget:/预算|搜索|候选|budget/i};
    for(const k of Object.keys(patch))if(patch[k]===current[k]&&mentions[k]&&!mentions[k].test(text))delete patch[k];
    return {patch,unsupported:parsed.unsupported};
  }
  const api={DEFAULTS,validate,local,remote};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Conditions=api;
})(globalThis);
