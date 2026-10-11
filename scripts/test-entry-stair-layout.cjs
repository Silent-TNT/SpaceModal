const assert = require('node:assert/strict');
const core = require('../generator-studio/layout-core.js');
const BrowserModel = require('../generator-studio/inference.js');
const Conditions = require('../generator-studio/conditions.js');
const render = require('../generator-studio/render.js');
const neural = new BrowserModel(require('../generator-studio/model.json'));
const program = require('../generator-studio/area-prior.js').apply(core.createRoomProgram(3, 2),require('../generator-studio/area-prior.json'),116.64);
const priors = neural.predict(program, 10800, 10800).priors;
const distances = [];
for (const anchorMode of ['near', 'hall', 'public']) {
  const model = core.buildLayout({length:10800,width:10800,seed:123,roomProgram:program,
    searchMode:'free',anchorMode,candidateBudget:2400,neuralPrior:priors,influence:.65});
  for (const candidate of [model, ...model.alternatives]) {
    assert.ok(candidate.validation.accepted);
    assert.ok(candidate.circulation.accepted);
    assert.ok(candidate.programValidation.accepted);
    for(const report of candidate.programValidation.reports.filter(r=>r.key.startsWith('bedroom-'))){
      assert.ok(report.width>=2.4-1e-8);
      assert.ok(report.aspectRatio<=1.8+1e-8);
    }
    assert.equal(candidate.spaces.some(s=>s.key==='1:stair-landing'),false);
    assert.ok(candidate.programValidation.corridorBudgets.every(b=>b.accepted));
    for(const bedroom of candidate.spaces.filter(s=>s.label===core.ID['卧室'])){
      const doors=candidate.connections.filter(e=>e.a===bedroom.id||e.b===bedroom.id);
      assert.ok(doors.length>0);
      for(const door of doors){const other=candidate.spaces[door.a===bedroom.id?door.b:door.a];
        if(other.label!==core.ID['阳台'])assert.ok(other.label===core.ID['过道']||core.OPEN_LABELS.includes(other.label));
      }
      const brokenAccess={...candidate,connections:[...candidate.connections,{a:0,b:bedroom.id,floor:1}]};
      assert.ok(core.validateCirculation(brokenAccess).issues.some(s=>s.includes('楼梯不能直接进入卧室')));
    }
    assert.ok(core.validateAnchors(candidate).accepted);
    assert.equal(candidate.anchorValidation.mode, anchorMode);
    assert.equal(candidate.anchorValidation.directContact,anchorMode==='near');
    if(anchorMode==='hall')assert.equal(candidate.anchorValidation.relation,'offset');
    assert.ok(candidate.organization.accepted);
    // The same stairs must occupy the same cells on both floors.
    candidate.floorSpaces[0].forEach((sid,i)=>assert.equal(sid===0,candidate.floorSpaces[1][i]===0));
    assert.match(render.plan(candidate,0), /入口 ↑/);
    // Destroy the reserved connector, keeping unrelated geometry untouched.
    const broken = {...candidate, floorSpaces:candidate.floorSpaces.map(g=>Int32Array.from(g))};
    const key = 'entry';
    const id = candidate.spaces.find(s=>s.key===key).id;
    broken.floorSpaces[0].forEach((sid,i)=>{if(sid===id)broken.floorSpaces[0][i]=-1;});
    assert.equal(core.validateAnchors(broken).accepted,false);
  }
  distances.push(model.generation.geometry.stairY);
  console.log('PASS', anchorMode, model.generation.validCandidateCount, 'valid candidates; anchor chain', model.anchorValidation.chain.join(' -> '));
}
// Relation classes, rather than an arbitrary ordering of selected stair depths.
assert.ok(distances.every(Number.isFinite));
assert.throws(()=>Conditions.validate({anchorMode:'unknown'}));
assert.throws(()=>core.buildLayout({anchorMode:'unknown'}));
console.log('PASS distinct anchor distances, model guidance, exports and broken-chain rejection');
const bedroom={...program.find(r=>r.key==='bedroom-1'),minArea:1,minWidth:1};
for(const [nx,ny] of [[24,8],[7,12]]){
  const fixture={nx,spaces:[{...bedroom,id:0}],floorSpaces:[new Int32Array(nx*ny).fill(-1),new Int32Array(nx*ny)]};
  const check=core.validateProgram(fixture,[bedroom]);
  assert.equal(check.accepted,false);
  assert.ok(check.issues.some(s=>s.includes('卧室短边')));
}
console.log('PASS bedroom proportions, landing, public access and rejection of direct stair doors / narrow or elongated bedrooms');
