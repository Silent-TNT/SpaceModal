const assert=require('node:assert/strict');
const Rules=require('../generator-lab/rules.js'),D=require('../generator-lab/design.js'),F=require('../generator-lab/partition-core.js'),Cooperate=require('../generator-lab/cooperate.js');
const copy=x=>structuredClone(x);
const baseline={nx:3,ny:3,cell:300,voxelCell:[300,300,300],floorCount:2,floorHeight:3000,spaces:[{id:0,key:'stairs',label:7},{id:1,key:'bed',label:4,floor:0},{id:2,key:'living',label:1,floor:1}],floorSpaces:[[0,1,1,0,1,1,0,1,1],[0,2,2,0,2,2,0,2,2]],floors:[[7,4,4,7,4,4,7,4,4],[7,1,1,7,1,1,7,1,1]]};
assert.ok(Rules.validate(baseline).accepted);
function rejects(rule,change){const model=copy(baseline);change(model);const report=Rules.validate(model);assert.equal(report.checks.find(c=>c.name===rule).passed,false,rule);if(model.voxels)assert.ok(report.issues.some(i=>i.code==='components'&&i.instance==='bed'&&i.actual===2));}
rejects('R1',m=>{m.floorSpaces[0][1]=-1;m.floors[0][1]=-1;});
rejects('R1',m=>m.floors[0][1]=10);
rejects('R1',m=>m.floorSpaces[0][1]=99);
rejects('R1',m=>m.spaces.push({...m.spaces[1]}));
rejects('R2',m=>m.origin=[100,0,0]);
rejects('R2',m=>m.nx=3.5);
rejects('R3',m=>{m.floorSpaces[1][0]=2;m.floors[1][0]=1;});
rejects('R4',m=>m.floorHeight=3300);
rejects('R4',m=>m.floorCount=3);
rejects('R5',m=>m.voxelCell=[300,300,600]);
rejects('R6',m=>{
 m.voxels={owners:[],labels:[]};for(let z=0;z<20;z++){m.voxels.owners.push(...m.floorSpaces[z<10?0:1]);m.voxels.labels.push(...m.floors[z<10?0:1]);}
 for(let i=0;i<9;i++)if(m.voxels.owners[5*9+i]===1){m.voxels.owners[5*9+i]=2;m.voxels.labels[5*9+i]=1;}
});
const shape=rows=>Rules.shape(rows.flatMap(r=>r.split('').map(v=>v==='1'?1:0)),rows[0].length,rows.length,1);
assert.equal(shape(['111','111']),'rectangle');assert.equal(shape(['110','110','111']),'L');assert.equal(shape(['111','010','111']),'I');assert.equal(shape(['101','111','101']),'I');
for(const rows of [['111','010','010'],['101','101','111'],['111','101','111'],['100','010','001']])assert.equal(shape(rows),'invalid');
const draft=D.defaults({length:12000,width:12000,bedrooms:3,bathrooms:2});draft.rooms=draft.rooms.filter(r=>r.type!=='corridor'&&r.type!=='multi_purpose');draft.edges=draft.rooms.filter(r=>r.type!=='stairs').map(r=>({a:'stairs',b:r.key,kind:'required_contact'}));draft.requirements.counts={bedroom:3,bathroom:2};const organized=D.completeInitialContacts(draft,{},true);assert.ok(organized.plan.edges.some(e=>e.a==='stairs'&&e.b==='bedroom-1'&&e.kind==='preferred_contact'));const preserved=D.completeInitialContacts(draft,{},false);assert.ok(preserved.plan.edges.some(e=>e.a==='stairs'&&e.b==='bedroom-1'&&e.kind==='required_contact'));const completed=D.completeInitialContacts(draft);assert.ok(completed.notes.length);D.validate(completed.plan,{length:12000,width:12000,bedrooms:3,bathrooms:2});const cancelled=D.completeInitialContacts(draft,{corridor:0});assert.equal(cancelled.plan.rooms.filter(r=>r.type==='corridor').length,0);assert.throws(()=>D.validate(cancelled.plan,{length:12000,width:12000,bedrooms:3,bathrooms:2}));
const forbidden=copy(baseline);forbidden.floorSpaces[0]=[0,1,0,0,1,0,1,1,1];forbidden.floors[0]=forbidden.floorSpaces[0].map(id=>forbidden.spaces[id].label);assert.equal(Rules.validate(forbidden).checks.find(c=>c.name==='R6').passed,false);
const corridorI={...copy(baseline),nx:4,spaces:[...copy(baseline.spaces),{id:3,key:'bath',label:5,floor:0},{id:4,key:'utility',label:8,floor:0}],floorSpaces:[[0,1,1,1,0,3,1,4,0,1,1,1],[0,2,2,2,0,2,2,2,0,2,2,2]]};corridorI.spaces[1].label=6;corridorI.floors=corridorI.floorSpaces.map(g=>g.map(id=>corridorI.spaces[id].label));assert.ok(Rules.validate(corridorI).accepted);corridorI.spaces[1].label=4;corridorI.floors=corridorI.floorSpaces.map(g=>g.map(id=>corridorI.spaces[id].label));assert.equal(Rules.validate(corridorI).checks.find(c=>c.name==='R6').passed,false);
assert.deepEqual(D.normalizeCounts({bedrooms:3,bathrooms:2}),{bedroom:3,bathroom:2});assert.equal(D.defaults({length:12000,width:12000,bedrooms:4,bathrooms:2},'edge',{bedroom:3}).requirements.counts.bedroom,4);
assert.equal(D.explicitMode('楼梯放在中间'),'central');assert.equal(D.explicitMode('楼梯靠边'),'edge');assert.equal(D.explicitMode('不要厨房，楼梯靠边'),'edge');const locked=D.defaults({length:12000,width:12000,bedrooms:3,bathrooms:2},'central',{lockedMode:'central'});assert.throws(()=>D.assertRevision(locked,{...copy(locked),mode:'edge'},{length:12000,width:12000,bedrooms:3,bathrooms:2}),/位置/);
console.log('PASS R1–R6 negative fixtures, legal shape grammar, non-prismatic/split 3D components');

const c={length:7200,width:12000,bedrooms:3,bathrooms:2,seed:123,budget:32},plan=D.defaults(c,'central',{multi_purpose:0});
const solve=(conditions,p)=>Promise.resolve().then(()=>F.generate({...conditions,plan:p,program:D.compile(p)}));
(async()=>{
 let calls=0;
 const result=await Cooperate.run({conditions:c,plan,solve,revise:async(p,report)=>{calls++;assert.equal(report.type,'search_exhausted');assert.ok(report.issues[0].instance);return {...copy(p),mode:'edge'};}});
 assert.ok(result.model.validation.rules.accepted);assert.equal(calls,1);assert.equal(result.history.filter(h=>h.outcome==='search_exhausted').length,1);assert.equal(result.model.targetTopology.requirements.counts.multi_purpose,0);
 const fail=()=>{const e=Error('no solution sampled');e.report={type:'search_exhausted',issues:[]};throw e;};let revisions=0;
 await assert.rejects(()=>Cooperate.run({conditions:c,plan,solve:fail,revise:async p=>{revisions++;return copy(p);}}));assert.equal(revisions,3);
 let solves=0;await assert.rejects(()=>Cooperate.run({conditions:c,plan,solve:()=>{solves++;return fail();},revise:async p=>{const changed=copy(p);changed.rooms.find(r=>r.type==='bedroom').floor=1;return changed;}}),/楼层/);assert.equal(solves,1);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>Cooperate.run({conditions:c,plan,signal:controller.signal,solve}),e=>e.name==='AbortError');
 await assert.rejects(()=>Cooperate.run({conditions:c,plan,timeoutMs:10,solve:(conditions,p,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout'))))}));
 console.log('PASS real failed partition → structured feedback → revised strategy → R1–R6 pass; revision cap, lock protection, cancellation and deadline');
})().catch(e=>{console.error(e);process.exitCode=1;});
