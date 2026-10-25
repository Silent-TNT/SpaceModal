importScripts('circulation.js?v=circulation-facade-joint-v1','functional-rules.js?v=circulation-facade-joint-v1','meal-routing.js?v=meal-public-route-v1','meal-geometry.js?v=meal-joint-v1','daylight.js?v=tiered-facade-v2','organization.js?v=circulation-facade-joint-v1','planning-rules.js?v=demand-program-v1','joint-planner.js?v=demand-program-v1','layout-core.js?v=demand-program-v1','inference.js','area-prior.js?v=circulation-facade-joint-v1','joint-area.js?v=circulation-facade-joint-v1');
let modelPromise,areaPromise,stairPromise,mealPromise,jointPromise,functionalPromise,trafficPromise;
self.onmessage=async ({data})=>{
  try {
    modelPromise ||= fetch('model.json').then(r=>{if(!r.ok)throw Error('模型加载失败，请刷新重试');return r.json();}).then(j=>new BrowserModel(j));
    postMessage({phase:'正在加载模型与预测空间偏好'});
    areaPromise ||= fetch('area-prior.json').then(r=>{if(!r.ok)throw Error('面积统计加载失败');return r.json();});
    stairPromise ||= fetch('stair-prior.json?v=stair-joint-v1').then(r=>{if(!r.ok)throw Error('楼梯联合统计加载失败');return r.json();});
    mealPromise ||= fetch('meal-prior.json?v=meal-joint-v1').then(r=>{if(!r.ok)throw Error('餐厨联合统计加载失败');return r.json();});
    jointPromise ||= fetch('joint-area-model.json?v=joint-area-v1').then(r=>{if(!r.ok)throw Error('联合面积模型加载失败');return r.json();}).then(j=>new JointArea.JointAreaModel(j));
    functionalPromise ||= fetch('functional-prior.json?v=circulation-facade-joint-v1').then(r=>{if(!r.ok)throw Error('全功能训练统计加载失败');return r.json();});
    trafficPromise ||= fetch('circulation-prior.json?v=circulation-facade-joint-v1').then(r=>{if(!r.ok)throw Error('交通统计加载失败');return r.json();});
    const [neural,areaProfile,stairProfile,mealProfile,joint,functionalProfile,trafficProfile]=await Promise.all([modelPromise,areaPromise,stairPromise,mealPromise,jointPromise,functionalPromise,trafficPromise]);
    self.CirculationPriorProfile=trafficProfile;
    if(trafficProfile.sourceSha256!==areaProfile.source_sha256||trafficProfile.trainingCaseCount!==300)throw Error('交通统计来源不一致');
    self.FunctionalPriorProfile=functionalProfile;
    if(functionalProfile.sourceSha256!==areaProfile.source_sha256||functionalProfile.trainingCaseCount!==300)throw Error('全功能统计与面积模型来源不一致');
    self.StairPriorProfile=stairProfile;
    self.MealPriorProfile=mealProfile;
    if(stairProfile.sourceSha256!==areaProfile.source_sha256)throw Error('楼梯统计与面积统计来源不一致');
    if(mealProfile.sourceSha256!==areaProfile.source_sha256||mealProfile.trainingCaseCount!==300)throw Error('餐厨统计与面积统计来源不一致');
    const balconyCounts=AreaPrior.balconyCounts(data,areaProfile);
    const referenceProgram=AreaPrior.apply(LayoutCore.createRoomProgram(data.bedrooms,data.bathrooms,balconyCounts,data),areaProfile,data.length*data.width/1e6,data);
    const {program,budget:areaBudget}=JointArea.allocate(referenceProgram,joint,data.length,data.width,areaProfile);
    const start=performance.now();
    const forecast=neural.predict(referenceProgram,data.length,data.width);
    postMessage({phase:'正在生成并校验两层功能布局'});
    const names={near:'入门近梯',hall:'侧向错位',public:'前后分离'};
    // Typed grids are retained; bulky voxel arrays and candidate lists are not needed for display.
    const pack=m=>({nx:m.nx,ny:m.ny,cell:m.cell,floorCount:2,floorHeight:3000,seed:m.seed,
      floors:m.floors.map(g=>Array.from(g)),floorSpaces:m.floorSpaces.map(g=>Array.from(g)),spaces:m.spaces,connections:m.connections,kitchenDining:m.kitchenDining,mealPolicy:m.mealPolicy,mealGeometry:m.mealGeometry,daylightPolicy:m.daylightPolicy,daylight:m.daylight,
      validation:m.validation,traffic:m.traffic,functional:m.functional,functionalRelations:m.functionalRelations,circulation:m.circulation,programValidation:m.programValidation,anchorValidation:m.anchorValidation,organization:m.organization,organizationPolicy:m.organizationPolicy,publicShapePolicy:m.publicShapePolicy,corridorWidth:m.corridorWidth,
      generation:{...m.generation,candidateScores:undefined}});
    const metadata={areaPrior:{schema:areaProfile.schema,trainingCaseCount:areaProfile.training_case_count,sourceSha256:areaProfile.source_sha256,grouping:areaProfile.grouping,balconyStatistics:areaProfile.balcony_statistics,balconyCounts,program,areaBudget,jointTrainingCases:joint.meta.provenance.usable_counts.training},
      forecast:{assignments:forecast.assignments,query:forecast.query,priors:forecast.priors},
      meta:{architecture:neural.meta.architecture,epoch:neural.meta.epoch,source_sha256:neural.meta.source_sha256,areaArchitecture:joint.meta.architecture,areaEpoch:joint.meta.epoch,areaCheckpointSha256:joint.meta.checkpoint_sha256}};
    const publish=(models,searchSummary,done)=>postMessage({...metadata,done,partial:!done,model:pack(models[0]),alternatives:models.slice(1).map(pack),searchSummary,elapsedSeconds:(performance.now()-start)/1000});
    const {model,searchSummary}=LayoutCore.buildLayoutOptions({...data,roomProgram:program,searchMode:'free',plan:null,corridorWidth:1.2,candidateBudget:data.budget,neuralPrior:forecast.priors,influence:.65,
      onLayout:(models,summary)=>publish(models,summary,false),
      onCandidateProgress:(mode,done,total)=>postMessage({phase:`正在生成并校验布局：${names[mode]} · ${done}/${total}`})},(mode,index,total)=>postMessage({phase:`正在生成并校验布局 ${index}/${total}：${names[mode]}`}));
    publish([model,...(model.alternatives||[])],searchSummary,true);
  }catch(e){postMessage({error:e.message,searchSummary:e.searchSummary});}
};
