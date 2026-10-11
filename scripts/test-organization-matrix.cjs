const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../generator-studio/layout-core.js'),prior=require('../generator-studio/area-prior.js'),profile=require('../generator-studio/area-prior.json');
const BrowserModel=require('../generator-studio/inference.js'),neural=new BrowserModel(require('../generator-studio/model.json'));
const cases=[
 {length:10800,width:10800,bedrooms:3,bathrooms:2,seed:123},
 {length:10800,width:10800,bedrooms:3,bathrooms:2,seed:42},
 {length:12000,width:12000,bedrooms:4,bathrooms:2,seed:123},
 {length:12000,width:12000,bedrooms:4,bathrooms:2,seed:42},
 {length:9600,width:12000,bedrooms:2,bathrooms:2,seed:123},
 {length:9600,width:12000,bedrooms:2,bathrooms:2,seed:42}
];
const rows=[];
for(const params of cases){
 const program=prior.apply(core.createRoomProgram(params.bedrooms,params.bathrooms,prior.balconyCounts(params,profile)),profile,params.length*params.width/1e6,params),start=Date.now();
 try{
  const {model,searchSummary}=core.buildLayoutOptions({...params,roomProgram:program,searchMode:'free',candidateBudget:2400,neuralPrior:neural.predict(program,params.length,params.width).priors,influence:.65});
  const models=[model,...model.alternatives];
  assert.ok(models.length>=1&&models.length<=4);
  for(const m of models){
   assert.ok(m.validation.accepted&&m.circulation.accepted&&m.programValidation.accepted&&m.organization.accepted&&m.anchorValidation.accepted);
   assert.ok(core.validateLayout(m).accepted&&core.validateProgram(m,program).accepted&&core.validateCirculation(m).accepted);
   for(const route of m.organization.routes)for(const square of route.squares)for(let y=square.y;y<square.y+square.h;y++)for(let x=square.x;x<square.x+square.w;x++)assert.equal(m.organization.activities.some(a=>a.floor===route.floor&&x>=a.x&&x<a.x+a.w&&y>=a.y&&y<a.y+a.h),false);
   m.floorSpaces[0].forEach((sid,i)=>assert.equal(sid===0,m.floorSpaces[1][i]===0));
  }
  rows.push({...params,accepted:true,seconds:(Date.now()-start)/1000,valid:searchSummary.validCandidateCount,relations:searchSummary.selectedRelations,
   options:models.map(m=>({corridor:m.organization.corridorArea,publicTraffic:m.organization.publicTrafficArea,meanRoute:m.organization.meanRouteLength,entryArea:m.programValidation.reports.find(r=>r.key==='entry').area,score:m.generation.score,publicBoundaryMoves:m.generation.geometry.publicAdjustments?.length||0,globalAdjustments:m.generation.geometry.globalAdjustments.length})),
   searches:searchSummary.searches.map(s=>({mode:s.mode,valid:s.validCandidateCount,diagnostics:s.diagnostics}))});
  console.log('PASS matrix',params.bedrooms,params.length,params.width,'seed',params.seed,'relations',searchSummary.selectedRelations.join('/'),'corridors',models.map(m=>m.organization.corridorArea.toFixed(1)).join('/'));
 }catch(e){rows.push({...params,accepted:false,error:e.message,seconds:(Date.now()-start)/1000});console.log('FAIL matrix',params,e.message);}
}
const accepted=rows.filter(r=>r.accepted).length;
fs.writeFileSync(path.join(__dirname,'organization-qa.json'),JSON.stringify({revision:'global-organization-v5',accepted,total:rows.length,rows},null,2)+'\n');
console.log('PASS matrix summary',accepted+'/'+rows.length,'see organization-qa.json');
assert.equal(accepted,cases.length,'all feasible regression conditions should produce accepted layouts');
assert.ok(rows.some(r=>r.relations?.length>1));
assert.ok(rows.some(r=>r.options?.some(o=>o.corridor>0)),'necessary corridors must remain possible');
assert.ok(rows.some(r=>r.options?.some(o=>o.corridor===0)),'public-only circulation must remain possible');
