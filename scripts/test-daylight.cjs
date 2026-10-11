const assert=require('node:assert/strict'),fs=require('node:fs');
const Daylight=require('../generator-studio/daylight.js'),core=require('../generator-studio/layout-core.js');
function fixture(){return {nx:16,ny:16,cell:300,spaces:[{id:0,key:'bedroom-1',label:4},{id:1,key:'balcony-1',label:9},{id:2,key:'bathroom',label:5},{id:3,key:'bedroom-2',label:4}],owners:[new Int32Array(256).fill(2),new Int32Array(256).fill(2)]};}
function rect(m,f,id,x,y,w,h){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)m.owners[f][yy*16+xx]=id;}
let m=fixture();rect(m,1,0,4,4,8,8);
assert.equal(Daylight.evaluate(m).reports.find(r=>r.key==='bedroom-1'&&r.floor===1).source,'none','enclosed bedroom must fail despite adjacency to an exterior bathroom');
rect(m,1,1,12,4,4,8);let r=Daylight.evaluate(m);assert.ok(r.accepted);assert.equal(r.reports.find(r=>r.key==='bedroom-1'&&r.floor===1).source,'via-balcony');assert.deepEqual(r.reports.find(r=>r.key==='bedroom-1'&&r.floor===1).qualifyingBalconies,['balcony-1']);
m=fixture();rect(m,1,0,4,4,8,8);rect(m,0,1,12,4,4,8);assert.equal(Daylight.evaluate(m).reports.find(r=>r.key==='bedroom-1'&&r.floor===1).accepted,false,'downstairs balcony cannot light upstairs bedroom');
m=fixture();rect(m,1,0,4,4,8,8);rect(m,1,1,12,4,4,3);assert.equal(Daylight.evaluate(m).reports.find(r=>r.key==='bedroom-1'&&r.floor===1).accepted,false,'0.9m contact is below conceptual frontage allowance');
m=fixture();rect(m,1,0,4,4,8,8);rect(m,1,3,12,4,4,8);assert.ok(Daylight.evaluate(m).reports.find(r=>r.key==='bedroom-2').accepted);assert.equal(Daylight.evaluate(m).reports.find(r=>r.key==='bedroom-1').accepted,false,'another exterior bedroom cannot provide the enclosed room its own frontage');
m=fixture();rect(m,1,0,0,4,8,8);assert.equal(Daylight.evaluate(m).reports.find(r=>r.key==='bedroom-1'&&r.floor===1).source,'direct-envelope');
// Fragmented perimeter touches cannot be summed into one usable frontage.
m=fixture();for(const y of [0,2,4,6])rect(m,1,0,0,y,1,1);assert.equal(Daylight.evaluate(m).reports.find(r=>r.key==='bedroom-1'&&r.floor===1).accepted,false);
const old=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../.qa/meal-joint-result.json'),'utf8')).model;
const check=Daylight.evaluate(old);assert.ok(check.reports.some(r=>!r.accepted));
assert.ok(check.reports.find(r=>r.key==='bedroom-2'&&r.floor===1)?.source==='none');
const program=require('../generator-studio/area-prior.js').apply(core.createRoomProgram(3,2,[0,2]),require('../generator-studio/area-prior.json'),116.64,{length:10800,width:10800});
assert.ok(core.validateProgram({...old,daylightPolicy:Daylight.RULES.revision},program).issues.some(i=>i.includes('采光位置')),'final program validation must reject historical enclosed bedroom');
console.log('PASS enclosed-bedroom regression, direct frontage, balcony access, floor isolation, other-room borrowing and continuous width');
