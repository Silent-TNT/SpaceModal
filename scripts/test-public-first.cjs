const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Exercise routing independently from the randomized architectural search.
const sandbox = {module:{exports:{}},Organization:require('../generator-studio/organization.js')};
vm.runInNewContext(fs.readFileSync(require.resolve('../generator-studio/layout-core.js'),'utf8')
  .replace('const api = Object.freeze({', 'const api = Object.freeze({routeAndFill, publicNetwork,'), sandbox);
const core = sandbox.module.exports, ID=core.ID;
const room=(id,key,label)=>({id,key,label:ID[label],floor:0,targetArea:10,minArea:1,minWidth:.6});
function fixture(nx,ny,spaces) {
  return {nx,ny,spaces, corridorWidth:1.2,publicShapePolicy:'rect-or-L',
    floors:[new Int16Array(nx*ny).fill(-1),new Int16Array(nx*ny).fill(ID['楼梯间'])],
    owners:[new Int32Array(nx*ny).fill(-1),new Int32Array(nx*ny)]};
}
function fill(c,sid,x,y,w,h) {
  for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){
    c.owners[0][yy*c.nx+xx]=sid;c.floors[0][yy*c.nx+xx]=c.spaces[sid].label;
  }
}
const stairs=()=>room(0,'stairs','楼梯间');
{
  const c=fixture(12,12,[stairs(),room(1,'entry','玄关'),room(2,'dining','餐厅')]);
  fill(c,1,0,0,4,12);fill(c,2,8,0,4,12);fill(c,2,4,5,4,1);
  assert.equal(core.publicNetwork(c.floors[0],c.owners[0],12,4,1)[5*12+10],0);
  fill(c,2,4,4,4,4);
  assert.equal(core.publicNetwork(c.floors[0],c.owners[0],12,4,1)[5*12+10],1);
}
console.log('PASS public network rejects a narrow bottleneck and accepts the required width');
{
  const c=fixture(12,12,[stairs(),room(1,'entry','玄关'),room(2,'kitchen','厨房')]);
  fill(c,1,0,0,8,12);fill(c,2,8,0,4,12);
  assert.equal(core.routeAndFill(c,c.spaces.slice(1)),true);
  assert.equal(c.spaces.some(s=>s.generated),false);
  assert.equal(c.routingEvidence[0].repairs.length,0);
}
console.log('PASS reachable functions do not create a corridor');
{
  const c=fixture(12,12,[stairs(),room(1,'entry','玄关'),room(2,'kitchen','厨房')]);
  fill(c,1,0,0,4,12);fill(c,2,4,0,8,12);
  for(let y=5;y<7;y++)for(let x=8;x<10;x++){c.owners[0][y*12+x]=-1;c.floors[0][y*12+x]=-1;}
  assert.equal(core.routeAndFill(c,c.spaces.slice(1)),false);
  assert.equal(c.spaces.some(s=>s.generated),false);
}
console.log('PASS unused enclosed land cannot be renamed as a corridor');
{
  const c=fixture(16,16,[stairs(),room(1,'entry','玄关'),room(2,'dining','餐厅'),
    room(3,'kitchen','厨房'),room(4,'bathroom','卫生间'),room(5,'bedroom','卧室')]);
  fill(c,1,0,0,4,4);fill(c,2,0,4,4,12);fill(c,2,4,12,12,4);
  fill(c,3,4,0,12,4);fill(c,4,4,8,12,4);fill(c,5,12,4,4,4);
  assert.equal(core.routeAndFill(c,c.spaces.slice(1)),true);
  assert.ok(c.spaces.some(s=>s.generated));
  assert.ok(c.routingEvidence[0].repairs.some(r=>r.target==='bedroom'&&r.addedArea>0));
}
console.log('PASS a disconnected bedroom receives a corridor after public room absorption fails');
{
  const c=fixture(40,30,[room(0,'entry','玄关'),{id:1,key:'0:corridor-1',label:ID['过道'],floor:0,generated:true}]);
  fill(c,1,0,0,40,10);fill(c,0,0,10,40,20);
  const program=[{...c.spaces[0],targetArea:72,corridorLimitFraction:.08392915}];
  const check=core.validateProgram({...c,floorSpaces:c.owners},program);
  assert.equal(check.corridorBudgets[0].area,36);
  assert.equal(check.corridorBudgets[0].accepted,true);assert.equal(check.corridorBudgets[0].withinPreference,false);
  assert.ok(check.corridorBudgets[0].excessArea>0);assert.equal(check.issues.includes('1层走道总面积超过统计预算'),false);
}
console.log('PASS a 36 square metre corridor is reported as excess statistical preference, not an automatic rejection');
