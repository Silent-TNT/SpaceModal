const assert=require('node:assert/strict');
const core=require('../generator-studio/layout-core.js');
const prior=require('../generator-studio/area-prior.js');
const profile=require('../generator-studio/area-prior.json');
assert.equal(profile.training_case_count,300);
assert.equal(profile.validation_cases_used,0);
assert.equal(profile.independent_cases_used,0);
assert.ok(profile.explicit_group_records>0);
const base=core.createRoomProgram(3,2);
const small=prior.apply(base,profile,10800*10800/1e6),large=prior.apply(base,profile,144);
assert.equal(base[0].targetArea,3); // No mutation of the legacy/model-reference program.
assert.notEqual(small[0].targetArea,base[0].targetArea);
assert.notDeepEqual(large,small);
assert.ok(small.some(r=>r.areaSource.conditioning!=='overall'));
const pooled={...profile,conditioning:undefined};
assert.ok(prior.apply(base,pooled,144)[0].targetArea>prior.apply(base,pooled,116.64)[0].targetArea);
const sparse={...profile,conditioning:{...profile.conditioning,minimum_instances:100000}};
assert.ok(prior.apply(base,sparse,144).every(r=>r.areaSource.conditioning==='overall'));
for(const room of small){assert.ok(room.preferredAreaMin<=room.preferredAreaMax);assert.ok(room.targetArea>=room.minArea);assert.ok(room.areaSource.count>=10);}
assert.ok(small.filter(r=>r.label===core.ID['卧室']).every(r=>r.minWidth===2.4));
const crowded=prior.apply(core.createRoomProgram(8,8),profile,144);
assert.ok(crowded.some(r=>r.capacityAdjusted));
assert.throws(()=>prior.apply(base,{...profile,categories:{}},144),/缺少有效面积统计/);
console.log('PASS training-only provenance, empirical targets, boundary/count adaptation, unchanged hard rules and missing-profile rejection');
