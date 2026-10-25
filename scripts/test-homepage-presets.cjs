const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const C=require('../generator-studio/layout-core.js'),A=require('../generator-studio/area-prior.js'),J=require('../generator-studio/joint-area.js');
const Conditions=require('../generator-studio/conditions.js'),Neural=require('../generator-studio/inference.js');
const profile=require('../generator-studio/area-prior.json'),joint=new J.JointAreaModel(require('../generator-studio/joint-area-model.json'));
const neural=new Neural(require('../generator-studio/model.json'));
const html=fs.readFileSync(path.join(__dirname,'../generator-studio/index.html'),'utf8');
const examples=[...html.matchAll(/data-example="([^"]+)"/g)].map(m=>m[1]);
assert.equal(examples.length,4);
const budget=Number(process.env.GENERATOR_BUDGET||80),reports=[];
function verify(model,program,d){
  assert.equal(model.spaces.filter(s=>s.label===4).length,d.bedrooms);
  assert.equal(model.spaces.filter(s=>s.label===5).length,d.bathrooms);
  for(const f of model.floorSpaces)assert.ok(Array.from(f).every(id=>id>=0));
  for(const check of [C.validateLayout(model),C.validateProgram(model,program),C.validateCirculation(model),C.validateAnchors(model),model.organization,model.daylight,model.traffic,model.functional,model.functionalRelations,model.mealGeometry,model.kitchenDining])
    assert.ok(check?.accepted,JSON.stringify(check));
  assert.deepEqual(model.programValidation.reports.map(r=>r.key).sort(),program.map(r=>r.key).sort());
}
for(const text of examples)for(const seed of [123,42,999]){
  const d={...Conditions.DEFAULTS,...Conditions.local(text,Conditions.DEFAULTS).patch,seed,budget};
  const base=A.apply(C.createRoomProgram(d.bedrooms,d.bathrooms,A.balconyCounts(d,profile),d),profile,d.length*d.width/1e6,d);
  const program=J.allocate(base,joint,d.length,d.width,profile).program,before=JSON.stringify(program);
  const options={...d,searchMode:'free',roomProgram:program,candidateBudget:budget,neuralPrior:neural.predict(base,d.length,d.width).priors,influence:.65};
  const {model,searchSummary}=C.buildLayoutOptions(options);
  for(const m of [model,...model.alternatives])verify(m,program,d);
  assert.equal(JSON.stringify(program),before);
  reports.push({text,seed,budget,valid:searchSummary.validCandidateCount,selected:searchSummary.selectedCount});
  console.log('PASS',JSON.stringify(reports.at(-1)));
  if(d.bedrooms===4&&seed===123){
    const a=C.buildLayout({...options,anchorMode:'hall',candidateBudget:1}),b=C.buildLayout({...options,anchorMode:'hall',candidateBudget:1});
    assert.deepEqual(a.floorSpaces,b.floorSpaces,'same seed and complete program must reproduce geometry');
    const impossible=program.map(r=>r.key==='bedroom-4'?{...r,targetArea:999,resourceMinArea:999,resourceMaxArea:999}:r);
    assert.throws(()=>C.buildLayout({...options,anchorMode:'hall',candidateBudget:1,roomProgram:impossible}),/未找到/,'incomplete three-bedroom seeds must never satisfy four-bedroom demand');
  }
}
fs.mkdirSync(path.join(__dirname,'../.qa'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'../.qa/homepage-presets.json'),JSON.stringify(reports,null,2));
console.log('PASS actual homepage texts, full room lists and existing quality gates across three seeds; deterministic insertion and impossible-demand rejection');
