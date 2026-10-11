const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const sandbox={module:{exports:{}},Organization:require('../generator-studio/organization.js')};
vm.runInNewContext(fs.readFileSync(require.resolve('../generator-studio/layout-core.js'),'utf8').replace('const api = Object.freeze({','const api = Object.freeze({assessCandidate,freePartitionCandidate,'),sandbox);
const core=sandbox.module.exports,ID=core.ID;
const prior=require('../generator-studio/area-prior.js'),profile=require('../generator-studio/area-prior.json'),conditions=require('../generator-studio/conditions.js');
assert.deepEqual(prior.balconyCounts({},profile),[0,2]);
assert.deepEqual(prior.balconyCounts({balconies0:1,balconies1:0},profile),[1,0]);
assert.deepEqual(prior.balconyCounts({balconies0:0,balconies1:0},profile),[0,0]);
assert.equal(core.createRoomProgram(3,2,[0,0]).filter(r=>r.label===ID['阳台']).length,0);
assert.equal(core.createRoomProgram(3,2,[1,3]).filter(r=>r.label===ID['阳台']).length,4);
assert.throws(()=>prior.balconyCounts({balconies0:5},profile));
for(const [text,expected] of [['不要阳台',{balconies0:0,balconies1:0}],['一层两个阳台，二层阳台0个',{balconies0:2,balconies1:0}],['一层不要阳台',{balconies0:0}]]){
  const parsed=conditions.local(text,conditions.DEFAULTS);assert.deepEqual(parsed.patch,expected);assert.deepEqual(parsed.unsupported,[]);
}
console.log('PASS statistical balcony defaults, independent per-floor counts, zero balconies and local condition edits');
// A balcony touches both living and dining. Actual training contacts for floor 1
// favour dining (4) over living (3); no fixed living-room relation may override it.
const nx=12,ny=12,spaces=[{id:0,key:'stairs',label:ID['楼梯间']},{id:1,key:'entry',label:ID['玄关']},
  {id:2,key:'living',label:ID['客厅']},{id:3,key:'dining',label:ID['餐厅']},
  {id:4,key:'balcony-0',label:ID['阳台'],balconyContactCounts:profile.balcony_statistics.by_floor[1].contact_counts}];
const owners=[new Int32Array(nx*ny),new Int32Array(nx*ny)],floors=[new Int16Array(nx*ny),new Int16Array(nx*ny).fill(ID['楼梯间'])];
for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const sid=y>=8?(x<4?0:3):x<4?1:x<8?2:y<4?4:3;
  owners[0][y*nx+x]=sid;floors[0][y*nx+x]=spaces[sid].label;
}
const result=core.assessCandidate({nx,ny,owners,floors,spaces});
assert.ok(result.reachable);
const door=result.doors.find(e=>e.a===4||e.b===4);
assert.equal(spaces[door.a===4?door.b:door.a].key,'dining');
console.log('PASS balcony access can choose dining using real geometric-contact statistics');
