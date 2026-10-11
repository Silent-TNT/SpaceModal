importScripts('organization.js?v=spatial-topology-1','layout-core.js?v=spatial-topology-1','inference.js','area-prior.js?v=spatial-topology-1');
let modelPromise,areaPromise;
self.onmessage=async ({data})=>{
  try {
    modelPromise ||= fetch('model.json').then(r=>{if(!r.ok)throw Error('模型加载失败，请刷新重试');return r.json();}).then(j=>new BrowserModel(j));
    postMessage({phase:'正在加载模型与预测空间偏好'});
    areaPromise ||= fetch('area-prior.json').then(r=>{if(!r.ok)throw Error('面积统计加载失败');return r.json();});
    const [neural,areaProfile]=await Promise.all([modelPromise,areaPromise]);
    const balconyCounts=AreaPrior.balconyCounts(data,areaProfile);
    const program=AreaPrior.apply(LayoutCore.createRoomProgram(data.bedrooms,data.bathrooms,balconyCounts),areaProfile,data.length*data.width/1e6,data);
    const start=performance.now();
    const forecast=neural.predict(program,data.length,data.width);
    postMessage({phase:'正在搜索并检查两层功能布局'});
    const names={near:'入门近梯',hall:'侧向错位',public:'前后分离'};
    const {model,searchSummary}=LayoutCore.buildLayoutOptions({...data,roomProgram:program,searchMode:'free',plan:null,corridorWidth:1.2,candidateBudget:data.budget,neuralPrior:forecast.priors,influence:.65},(mode,index,total)=>postMessage({phase:`正在搜索 ${index}/${total}：${names[mode]}`}));
    // Typed grids are retained; bulky voxel arrays and candidate lists are not needed for display.
    const pack=m=>({nx:m.nx,ny:m.ny,cell:m.cell,floorCount:2,floorHeight:3000,seed:m.seed,
      floors:m.floors.map(g=>Array.from(g)),floorSpaces:m.floorSpaces.map(g=>Array.from(g)),spaces:m.spaces,connections:m.connections,
      validation:m.validation,circulation:m.circulation,programValidation:m.programValidation,anchorValidation:m.anchorValidation,organization:m.organization,organizationPolicy:m.organizationPolicy,publicShapePolicy:m.publicShapePolicy,corridorWidth:m.corridorWidth,
      generation:{...m.generation,candidateScores:undefined}});
    postMessage({done:true,model:pack(model),alternatives:(model.alternatives||[]).map(pack),searchSummary,areaPrior:{schema:areaProfile.schema,trainingCaseCount:areaProfile.training_case_count,sourceSha256:areaProfile.source_sha256,grouping:areaProfile.grouping,balconyStatistics:areaProfile.balcony_statistics,balconyCounts,program},
      forecast:{assignments:forecast.assignments,query:forecast.query,priors:forecast.priors},
      meta:{architecture:neural.meta.architecture,epoch:neural.meta.epoch,source_sha256:neural.meta.source_sha256},
      elapsedSeconds:(performance.now()-start)/1000});
  }catch(e){postMessage({error:e.message,searchSummary:e.searchSummary});}
};
