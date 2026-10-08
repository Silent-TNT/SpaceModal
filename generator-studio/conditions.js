(function(root){
  'use strict';
  const DEFAULTS={length:10800,width:10800,bedrooms:3,bathrooms:2,seed:123,budget:2400};
  const keys=Object.keys(DEFAULTS);
  const num=s=>/^\d+(?:\.\d+)?$/.test(s)?Number(s):({'零':0,'一':1,'两':2,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}[s]);
  function validate(patch) {
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('需求解析没有返回有效字段');
    for(const [k,v] of Object.entries(patch)) {
      if(!keys.includes(k))throw Error('解析返回了未支持的条件：'+k);
      if(typeof v!=='number'||!Number.isFinite(v)||!Number.isInteger(v))throw Error(k+' 必须为整数');
      if(['length','width'].includes(k)&&(v<6000||v>18000||v%300))throw Error('长宽须在 6–18 米内，并符合 0.3 米模数；请修改尺寸。');
      if(['bedrooms','bathrooms'].includes(k)&&(v<1||v>8))throw Error('当前 demo 支持 1–8 间卧室、1–8 间卫生间。');
      if(k==='seed'&&(v<0||v>4294967295))throw Error('种子须为 0–4294967295 的整数');
      if(k==='budget'&&(v<1||v>4800))throw Error('搜索预算须为 1–4800 的整数');
    }
    return patch;
  }
  function local(text,current) {
    const patch={},unsupported=[];
    const n='([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十])';
    const dims=text.match(/(\d+(?:\.\d+)?)\s*(毫米|mm|米|m)?\s*[×xX*乘]\s*(\d+(?:\.\d+)?)\s*(毫米|mm|米|m)?/i);
    const mm=(v,unit)=>Number(v)*(unit==='毫米'||unit?.toLowerCase()==='mm'?1:unit==='米'||unit?.toLowerCase()==='m'?1000:Number(v)<=100?1000:1);
    if(dims){const unit=dims[2]||dims[4];patch.length=mm(dims[1],unit);patch.width=mm(dims[3],dims[4]||unit);}
    for(const [k,label] of [['length','长'],['width','宽']]) {
      const m=text.match(new RegExp(label+'(?:度)?\\s*(?:改为|改成|为|是|=|：|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*(毫米|mm|米|m)?','i'));
      if(m)patch[k]=mm(m[1],m[2]);
    }
    for(const [key,term] of [['bedrooms','卧室'],['bathrooms','卫生间|浴室']]) {
      const before=text.match(new RegExp(n+'\\s*(?:个|间)?\\s*(?:'+term+')'));
      const after=text.match(new RegExp('(?:'+term+')\\s*(?:数量)?\\s*(?:改为|改成|为|是|=|：|:)?\\s*'+n+'\\s*(?:个|间)?'));
      if(before||after)patch[key]=num((before||after)[1]);
      if(new RegExp('(?:增加|加|多)\\s*(?:一|1)\\s*(?:间|个)?\\s*(?:'+term+')').test(text))patch[key]=current[key]+1;
      if(new RegExp('(?:减少|减|少)\\s*(?:一|1)\\s*(?:间|个)?\\s*(?:'+term+')').test(text))patch[key]=current[key]-1;
    }
    const seed=text.match(/(?:种子|seed)\s*(?:改为|为|=|：|:)?\s*(\d+)/i);if(seed)patch.seed=Number(seed[1]);
    if(/换(?:一|个|一套|一个)|再来|另一个|新方案/.test(text)&&!seed)patch.seed=(current.seed+1)>>>0;
    const floors=text.match(/([零一二两三四五六七八九十0-9]+)\s*层/);
    if(floors&&num(floors[1])!==2)unsupported.push('固定为两层，当前不能生成其他层数');
    if(/一楼|二楼|一层.*卧室|二层.*卧室|楼上|楼下/.test(text))unsupported.push('当前 demo 的房间楼层由原生成器安排，不能指定');
    if(/朝|向南|向北|邻|靠|相接|挑空|层高|高度|墙|窗|门|车库|不要|不需要|取消|去掉|面积|平方米|㎡|客厅.*大|厨房.*大/.test(text))unsupported.push('位置、朝向、挑空、面积及其他功能增减尚未接入本 demo');
    if(!Object.keys(patch).length&&!unsupported.length)unsupported.push('本地解析未识别到尺寸、卧室数、卫生间数或换方案；复杂表述请连接大模型');
    return {patch:validate(patch),unsupported:[...new Set(unsupported)]};
  }
  const SYSTEM=`你是二层住宅需求解析器，只输出 JSON，不生成几何。格式：{"patch":{},"unsupported":[]}。
patch 只包含用户本轮明确修改的字段：length,width（毫米，6000–18000 且300整除）、bedrooms,bathrooms（1–8整数）、seed（0–4294967295整数）、budget（1–4800整数）。不得补写未修改字段，不得将不合模数尺寸擅自四舍五入。允许参考当前条件理解增加/减少。换方案时 seed 加1。
生成边界是矩形范围，固定二层，每层3000mm。当前demo只支持长宽、卧室总数、卫生间总数、种子、预算；房间楼层、位置、朝向、面积、挑空以及厨房/客厅/阳台等其他功能的增减均不支持。把所有这些要求原样列入unsupported，不能承诺实现。非住宅生成或无法理解的请求也写入unsupported。中文数字转整数。`;
  async function remote(text,current,config,signal) {
    const url=new URL(config.endpoint);
    if(url.protocol!=='https:')throw Error('大模型接口需要 HTTPS 地址');
    let response;
    try{response=await fetch(url,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({current,text})});}
    catch(e){if(e.name==='AbortError')throw e;throw Error('大模型连接失败。请检查网络和接口是否允许网页跨域访问；也可改用本地解析。');}
    const data=await response.json();
    if(!response.ok)throw Error(data.error||('需求解析接口返回 '+response.status));
    const parsed=data;
    if(!Array.isArray(parsed.unsupported)||parsed.unsupported.some(s=>typeof s!=='string'))throw Error('大模型返回的限制说明格式无效');
    return {patch:validate(parsed.patch),unsupported:parsed.unsupported};
  }
  const api={DEFAULTS,validate,local,remote};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Conditions=api;
})(globalThis);
