const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../generator-studio/layout-core.js');
const A = require('../generator-studio/area-prior.js');
const J = require('../generator-studio/joint-area.js');
const F = require('../generator-studio/functional-rules.js');
const T = require('../generator-studio/circulation.js');
const Neural = require('../generator-studio/inference.js');
const profile = require('../generator-studio/area-prior.json');
const joint = new J.JointAreaModel(require('../generator-studio/joint-area-model.json'));
const neural = new Neural(require('../generator-studio/model.json'));
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const d = {...require('../generator-studio/conditions.js').DEFAULTS,
  length:Number(arg('length',15000)),width:Number(arg('width',12000)),seed:Number(arg('seed',123)),
  bedrooms:Number(arg('bedrooms',3)),bathrooms:Number(arg('bathrooms',2)),
  bedrooms0:Number(arg('bedrooms0',1)),living1:Number(arg('living1',1)),utility1:Number(arg('utility1',1)),
  balconies0:Number(arg('balconies0',-1)),balconies1:Number(arg('balconies1',-1))};
const budget=Number(arg('budget',2400)), mode=arg('mode','all'),tag=arg('tag','current');
assert.match(tag,/^[a-z0-9-]+$/);
const base=A.apply(C.createRoomProgram(d.bedrooms,d.bathrooms,A.balconyCounts(d,profile),d),profile,d.length*d.width/1e6,d);
const allocated=J.allocate(base,joint,d.length,d.width,profile);
const start=Date.now();
let output;
try {
  const options={...d,roomProgram:allocated.program,searchMode:'free',candidateBudget:budget,
    neuralPrior:neural.predict(base,d.length,d.width).priors,influence:.65,
    onCandidateProgress:(...args)=>console.log('PROGRESS',...args)};
  const result=mode==='all'?C.buildLayoutOptions(options):{model:C.buildLayout({...options,anchorMode:mode})};
  const models=[result.model,...(result.model.alternatives||[])];
  for(const m of models) {
    for(const check of [C.validateLayout(m),C.validateProgram(m,allocated.program),C.validateCirculation(m),
      C.validateAnchors(m),m.organization,m.daylight,m.mealGeometry,m.kitchenDining,
      F.evaluate(m,allocated.program),F.relations(m,m.connections),T.evaluate(m,allocated.program),T.actualBudget(m,allocated.program)])
      assert.ok(check.accepted,JSON.stringify(check.issues||check));
  }
  output={passed:true,params:d,budget,seconds:(Date.now()-start)/1000,areaBudget:allocated.budget,...result};
  console.log('PASS',JSON.stringify({seconds:output.seconds,selected:models.length,valid:result.searchSummary?.validCandidateCount??result.model.generation.validCandidateCount,
    candidates:models.map(m=>({index:m.generation.selectedCandidate,strategy:m.generation.geometry.strategy,rooms:m.programValidation.reports.map(r=>({key:r.key,area:r.area,width:r.width}))}))}));
} catch(e) {
  output={passed:false,params:d,budget,seconds:(Date.now()-start)/1000,error:e.message,diagnostics:e.searchSummary||e.diagnostics};
  console.log('FAIL',JSON.stringify(output));process.exitCode=1;
}
const dir=path.join(__dirname,'../.qa/large-envelope');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,`${d.length}-${d.width}-${d.bedrooms}bed-${d.seed}-${mode}-${tag}.json`),JSON.stringify(output,(k,v)=>ArrayBuffer.isView(v)?Array.from(v):v));
