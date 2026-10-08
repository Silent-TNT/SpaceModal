importScripts('layout-core.js','inference.js');
let modelPromise;
self.onmessage=async ({data})=>{
  try {
    modelPromise ||= fetch('model.json').then(r=>{if(!r.ok)throw Error('模型加载失败，请刷新重试');return r.json();}).then(j=>new BrowserModel(j));
    postMessage({phase:'正在加载模型与预测空间偏好'});
    const neural=await modelPromise;
    const program=LayoutCore.createRoomProgram(data.bedrooms,data.bathrooms);
    const start=performance.now();
    const forecast=neural.predict(program,data.length,data.width);
    postMessage({phase:'正在搜索并检查两层功能布局'});
    const model=LayoutCore.buildLayout({...data,roomProgram:program,searchMode:'free',plan:null,corridorWidth:1.2,candidateBudget:data.budget,neuralPrior:forecast.priors,influence:.65});
    // Typed grids are retained; bulky voxel arrays and candidate lists are not needed for display.
    const pack=m=>({nx:m.nx,ny:m.ny,cell:m.cell,floorCount:2,floorHeight:3000,seed:m.seed,
      floors:m.floors.map(g=>Array.from(g)),floorSpaces:m.floorSpaces.map(g=>Array.from(g)),spaces:m.spaces,connections:m.connections,
      validation:m.validation,circulation:m.circulation,programValidation:m.programValidation,
      generation:{...m.generation,candidateScores:undefined}});
    postMessage({done:true,model:pack(model),alternatives:(model.alternatives||[]).map(pack),
      forecast:{assignments:forecast.assignments,query:forecast.query,priors:forecast.priors},
      meta:{architecture:neural.meta.architecture,epoch:neural.meta.epoch,source_sha256:neural.meta.source_sha256},
      elapsedSeconds:(performance.now()-start)/1000});
  }catch(e){postMessage({error:e.message});}
};
