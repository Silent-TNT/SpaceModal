const assert=require('node:assert/strict'),fs=require('node:fs');
const core=require('../generator-studio/layout-core.js'),Daylight=require('../generator-studio/daylight.js');
function room(label,cells){
 const map=new Int32Array(100).fill(1);for(const i of cells)map[i]=0;
 return {nx:10,spaces:[{id:0,key:'subject',label},{id:1,key:'background',label:6}],owners:[map]};
}
for(const label of [5,8]){
 assert.equal(Daylight.evaluate(room(label,[0,10])).accepted,true,'0.6 m continuous exterior suffices for services');
 assert.equal(Daylight.evaluate(room(label,[0])).accepted,false,'0.3 m is insufficient');
 assert.equal(Daylight.evaluate(room(label,[0,20])).accepted,false,'fragmented frontage cannot be summed');
 assert.equal(Daylight.evaluate(room(label,[44,45,54,55])).accepted,false,'enclosed services must fail');
 const m=room(label,[44,45,54,55]);m.spaces[1].label=9;
 assert.equal(Daylight.evaluate(m).accepted,false,'services require their own exterior frontage');
}
for(const label of [1,2,3,4,10]){
 assert.equal(Daylight.evaluate(room(label,[0,10])).accepted,false,'primary rooms retain the higher requirement');
 assert.equal(Daylight.evaluate(room(label,[0,10,20,30])).accepted,true,'1.2 m frontage suffices');
}
const entry={key:'entry',label:0,floor:0,targetArea:12.061229184,preferredAreaMax:15.085278648,minArea:1.8,minWidth:.9};
assert.ok(Math.abs(core.entryMaxArea(entry,116.64)-13.9968)<1e-8);
assert.equal(core.entryMaxArea({...entry,preferredAreaMax:8},116.64),8,'statistical upper preference also bounds expansion');
function entryModel(w,h){return {nx:36,spaces:[{id:0,...entry}],owners:[Array.from({length:1296},(_,i)=>i%36<w&&Math.floor(i/36)<h?0:-1),new Array(1296).fill(-1)],publicShapePolicy:'activity-verified'};}
assert.ok(core.validateProgram(entryModel(9,6),[entry]).accepted);
assert.ok(core.validateProgram(entryModel(18,9),[entry]).issues.some(i=>i.includes('玄关面积不得超过')));
// Reconstruct geometry exports without trusting saved acceptance flags.
const geometryArg=process.argv.find(a=>a.startsWith('--geometry='));
if(geometryArg){
 const data=JSON.parse(fs.readFileSync(geometryArg.slice('--geometry='.length),'utf8'));
 const nx=data.condition_inputs.user_provided.length_mm/300,ny=data.condition_inputs.user_provided.width_mm/300;
 const spaces=[],owners=[new Int32Array(nx*ny).fill(-1),new Int32Array(nx*ny).fill(-1)];
 const labels=['entryway','living_room','dining_room','kitchen','bedroom','bathroom','corridor','stairs','utility','balcony','multi_purpose'];
 for(const r of data.rooms){
  let sid=spaces.findIndex(s=>s.key===r.functional_group_id);
  if(sid<0){sid=spaces.length;spaces.push({id:sid,key:r.functional_group_id,label:labels.indexOf(r.type)});}
  for(const floor of r.floors)for(let y=r.box_min[1]/300;y<r.box_max[1]/300;y++)for(let x=r.box_min[0]/300;x<r.box_max[0]/300;x++)owners[floor-1][y*nx+x]=sid;
 }
 const model={nx,spaces,owners,daylightPolicy:Daylight.RULES.revision,publicShapePolicy:'activity-verified'};
 const check=core.validateProgram(model,data.area_prior.program);
 assert.ok(check.issues.some(i=>i.includes('玄关面积不得超过')));
 for(const key of ['bathroom-1','utility'])assert.equal(Daylight.evaluate(model).reports.find(r=>r.key===key).accepted,false);
 console.log('PASS supplied geometry rejected: oversized entry, enclosed bathroom and utility');
}
console.log('PASS entry hard cap, lower service threshold, primary thresholds, continuous frontage and no borrowed service daylight');
