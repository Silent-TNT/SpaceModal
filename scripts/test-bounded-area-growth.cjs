const assert=require('node:assert/strict');
const fs=require('node:fs'),Module=require('node:module');
const file=require.resolve('../generator-studio/layout-core.js'),compiled=new Module(file,module);
compiled.filename=file;compiled.paths=module.paths;
compiled._compile(fs.readFileSync(file,'utf8').replace('const api = Object.freeze({','const api = Object.freeze({routeAndFill, boundedTopologyDimensions, compactSpineCandidate,'),file);
const C=compiled.exports;
function fixture(grouped){
  const nx=16,ny=12;
  const spaces=[{id:0,key:'stairs',label:7},{id:1,key:'entry',label:0,floor:0,minArea:1,minWidth:.6,targetArea:4.32,resourceMaxArea:4.32},
    {id:2,key:'dining',label:2,floor:0,minArea:1,minWidth:.6,targetArea:8,resourceMaxArea:grouped?20:5.4},
    {id:3,key:'kitchen',label:3,floor:0,minArea:1,minWidth:.6,targetArea:4,resourceMaxArea:4.32}];
  if(grouped)for(const r of spaces.slice(2))Object.assign(r,{resourceGroupKey:'meal',resourceGroupMaxArea:9.72});
  const map=new Int32Array(nx*ny).fill(-1),grid=new Int16Array(nx*ny).fill(-1);
  for(let y=0;y<ny;y++)for(let x=0;x<12;x++){
    // Free land borders dining, so a whole-edge growth can consume it.
    const id=x<4?1:x<8?3:2;map[y*nx+x]=id;grid[y*nx+x]=spaces[id].label;
  }
  return {nx,ny,spaces,corridorWidth:1.2,publicShapePolicy:'rect-or-L',
    owners:[map,new Int32Array(nx*ny)],floors:[grid,new Int16Array(nx*ny).fill(7)]};
}
for(const grouped of [false,true]){
  const c=fixture(grouped),program=c.spaces.slice(1);
  C.routeAndFill(c,program);
  const area=id=>Array.from(c.owners[0]).filter(sid=>sid===id).length*.09;
  assert.ok(area(2)<=c.spaces[2].resourceMaxArea+1e-8,'residual absorption must respect the room capacity');
  if(grouped)assert.ok(area(2)+area(3)<=9.72+1e-8,'residual absorption must respect the shared capacity');
}
const A=require('../generator-studio/area-prior.js'),J=require('../generator-studio/joint-area.js');
const profile=require('../generator-studio/area-prior.json');
const d={...require('../generator-studio/conditions.js').DEFAULTS,length:15000,width:12000};
const base=A.apply(C.createRoomProgram(3,2,[0,2],d),profile,180,d);
const program=J.allocate(base,new J.JointAreaModel(require('../generator-studio/joint-area-model.json')),15000,12000,profile).program;
const before=JSON.stringify(program),dimensions=C.boundedTopologyDimensions(50,40,program,1.2);
assert.ok(dimensions.length>1,'bounded joint planning must offer multiple dimension proposals');
assert.equal(JSON.stringify(program),before,'planning must preserve the allocated program');
assert.deepEqual(C.boundedTopologyDimensions(50,40,program.filter(r=>r.key!=='living-1'),1.2),[],'unsupported programs must use ordinary search');
console.log('PASS individual/shared residual-growth capacities, joint dimension alternatives, input preservation and unsupported-program fallback');
const compact={...d,length:10800,width:10200};
const compactBase=A.apply(C.createRoomProgram(3,2,[0,2],compact),profile,110.16,compact);
const compactProgram=J.allocate(compactBase,new J.JointAreaModel(require('../generator-studio/joint-area-model.json')),10800,10200,profile).program;
for(const seed of [123,42,999]){
  const candidate=C.compactSpineCandidate(36,34,seed,0,compactProgram,1.2,'hall');
  assert.ok(candidate,'compact default program must fit without rule relaxation');
  assert.ok(C.validateProgram(candidate,compactProgram).accepted);
  assert.ok(require('../generator-studio/organization.js').evaluate(candidate).accepted);
  assert.ok(require('../generator-studio/circulation.js').evaluate(candidate,compactProgram).accepted);
  assert.ok(candidate.geometry.jointDimensionPlanning.branch>0,'activity and through-route need jointly reserved width');
}
assert.equal(C.compactSpineCandidate(36,34,123,0,compactProgram.filter(r=>r.key!=='living-1'),1.2,'hall'),null);
console.log('PASS compact activity/route coexistence, capacities, facade and traffic rules across three seeds; unsupported programs fall back');
