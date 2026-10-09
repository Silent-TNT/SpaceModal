importScripts('../generator-studio/inference.js','design.js','rules.js','partition-core.js');
let weights;
self.onmessage=async({data})=>{try{
 const {conditions,plan}=data;Design.validate(plan,conditions);
 postMessage({phase:'正在核对房间数量、所在楼层和必须相邻的关系'});
 weights ||= fetch('../generator-studio/model.json').then(r=>r.json()).then(j=>new BrowserModel(j));
 const neural=await weights,program=Design.compile(plan),start=performance.now();
 const forecast=neural.predict(program,conditions.length,conditions.width);
 postMessage({phase:'正在填满两层空间，分配各房间并逐一检查楼梯、尺寸和房间连通性'});
 const generated=FreeCore.generate({...conditions,budget:conditions.budget,plan,program,priors:forecast.priors});
 postMessage({done:true,...generated,forecast:{assignments:forecast.assignments,query:forecast.query,priors:forecast.priors},
  meta:{architecture:neural.meta.architecture,epoch:neural.meta.epoch,source_sha256:neural.meta.source_sha256,scope:'Topology-first prototype with existing model preferences; no graph-conditioned retraining',project_accepted:null},elapsedSeconds:(performance.now()-start)/1000});
}catch(e){postMessage({error:e.message,report:e.report});}};
