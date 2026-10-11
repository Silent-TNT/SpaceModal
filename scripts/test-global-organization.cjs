const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Organization=require('../generator-studio/organization.js');
const sandbox={module:{exports:{}},Organization};
vm.runInNewContext(fs.readFileSync(require.resolve('../generator-studio/layout-core.js'),'utf8').replace('const api = Object.freeze({','const api = Object.freeze({repairOrganization,areaDeviation,rebalancePublic,roomConnectivity,'),sandbox);
const core=sandbox.module.exports;
function fixture(ny){
 const nx=27,spaces=[{id:0,key:'stairs',label:7},{id:1,key:'entry',label:0,floor:0,minArea:1.8,minWidth:.9,targetArea:4},
  {id:2,key:'dining',label:2,floor:0,minArea:8,minWidth:1.8,targetArea:10},
  ...[3,4].map(id=>({id,key:`bedroom-${id-2}`,label:4,floor:0,minArea:9,minWidth:2.4,targetArea:12}))];
 const owners=[new Int32Array(nx*ny),new Int32Array(nx*ny)],floors=[new Int16Array(nx*ny),new Int16Array(nx*ny).fill(7)];
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const id=x<4?1:x<11?2:y<ny/2?3:4;owners[0][y*nx+x]=id;floors[0][y*nx+x]=spaces[id].label;}
 return {nx,ny,spaces,owners,floors,corridorWidth:1.2,publicShapePolicy:'rect-or-L',routingEvidence:[{floor:0,repairs:[]},{floor:1,repairs:[]}]};
}
const publicOnly=fixture(22),direct=Organization.evaluate(publicOnly);
assert.ok(direct.accepted);
assert.equal(direct.corridorArea,0);
assert.ok(direct.publicTrafficArea>0,'public traffic is counted even without corridors');
function verifyRoutes(candidate,report){
 for(const route of report.routes)for(const square of route.squares)for(let y=square.y;y<square.y+square.h;y++)for(let x=square.x;x<square.x+square.w;x++){
  assert.ok([0,1,2,6,7,10].includes(candidate.spaces[candidate.owners[route.floor][y*candidate.nx+x]].label));
  assert.equal(report.activities.some(a=>a.floor===route.floor&&x>=a.x&&x<a.x+a.w&&y>=a.y&&y<a.y+a.h),false);
 }
}
verifyRoutes(publicOnly,direct);
const blocked=fixture(18),before=Organization.evaluate(blocked);
assert.equal(before.accepted,false);
assert.ok(before.unreachable.some(r=>r.key.startsWith('bedroom')));
const repaired=core.repairOrganization(blocked,blocked.spaces.slice(1));
assert.ok(repaired,'boundary adjustment should recover a route');
assert.ok(repaired.organization.accepted);
assert.ok(repaired.organization.corridorArea>0);
assert.ok(core.validateProgram(repaired,blocked.spaces.slice(1)).accepted);
assert.ok(repaired.routingEvidence[0].repairs.some(r=>r.reason.includes('protected-activity')));
verifyRoutes(repaired,repaired.organization);
console.log('PASS public-only circulation, hidden traffic accounting, protected activity, blocked route and necessary corridor repair');
const model=(score,corridor,relation)=>({generation:{score,corridorFraction:corridor},anchorValidation:{relation},connections:[],spaces:[]});
const goodCorridor=model(10,.03,'direct'),poorZero=model(20,0,'direct'),separated=model(11,0,'separated');
const portfolio=core.selectPortfolio([poorZero,goodCorridor,separated]);
assert.equal(portfolio[0],goodCorridor,'zero corridor must not outrank better usability');
assert.ok(portfolio.includes(separated));
assert.equal(core.selectPortfolio([goodCorridor,{...goodCorridor,generation:{...goodCorridor.generation,score:11}}]).length,1,'do not pad duplicate plans to four');
console.log('PASS whole-plan quality before corridor minimization and distinct portfolio without forced padding');
const preference={targetArea:12,preferredAreaMin:9,preferredAreaMax:15};
assert.ok(core.areaDeviation(preference,40)+core.areaDeviation(preference,12)>2*core.areaDeviation(preference,26),'distribute spare area instead of dumping it into a single room');
assert.ok(Number.isFinite(core.areaDeviation(preference,40)),'statistical oversize remains a soft cost');
console.log('PASS growing statistical excess cost without a hard quartile cap');
const excessEntry=fixture(22);excessEntry.geometry={entryX:0,entryW:3,entryH:4};
const excessProgram=excessEntry.spaces.slice(1),areaScore=c=>core.validateProgram(c,excessProgram).reports.reduce((sum,r)=>sum+core.areaDeviation(r,r.area),0);
const acceptable=c=>core.roomConnectivity(c)&&core.validateProgram(c,excessProgram).accepted&&(c.organization=Organization.evaluate(c)).accepted;
const balanced=core.rebalancePublic(excessEntry,excessProgram,areaScore,acceptable);
assert.ok(acceptable(balanced));
assert.ok(areaScore(balanced)<areaScore(excessEntry));
assert.ok(balanced.owners[0].filter(sid=>sid===1).length<excessEntry.owners[0].filter(sid=>sid===1).length,'oversized entry can yield real boundary area to the dining room');
for(let y=0;y<4;y++)for(let x=0;x<3;x++)assert.equal(balanced.owners[0][y*balanced.nx+x],1,'original entrance area stays intact');
verifyRoutes(balanced,balanced.organization);
console.log('PASS public boundary redistribution preserves entry, activity space and width-safe access');
