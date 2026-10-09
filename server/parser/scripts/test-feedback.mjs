import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import D from '../../../generator-lab/design.js';
const current={length:7200,width:12000,bedrooms:3,bathrooms:2,seed:123,budget:32},base=D.defaults(current,'central',{multi_purpose:0});
let output={patch:{},unsupported:[],strategies:[{...structuredClone(base),mode:'edge'}]};
const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{const request=JSON.parse(options.body),body=JSON.parse(request.messages[1].content);assert.equal(body.feedback.type,'search_exhausted');return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));};
const request=()=>new Request('https://proxy.test/design',{method:'POST',headers:{Origin:'https://www.spacemodal.com','Content-Type':'application/json','CF-Connecting-IP':'feedback-tests'},body:JSON.stringify({text:'根据失败报告修订',current,current_plan:base,round:1,feedback:{type:'search_exhausted',issues:[{rule:'CAPACITY',code:'room_band_capacity'}]}})});
const env={PARSER_API_KEY:'test-not-real'};
try{
 let response=await worker.fetch(request(),env);assert.equal(response.status,200);assert.equal((await response.json()).strategies[0].requirements.counts.multi_purpose,0);
 output.patch={length:15000};assert.equal((await worker.fetch(request(),env)).status,502);output.patch={};
 let changed=structuredClone(base);changed.rooms.find(r=>r.key==='bedroom-1').floor=1;changed.edges=changed.edges.map(e=>e.b==='bedroom-1'?{...e,a:'corridor-1'}:e);output.strategies=[changed];assert.equal((await worker.fetch(request(),env)).status,502);
 changed=structuredClone(base);changed.edges=changed.edges.filter(e=>e.b!=='bedroom-1');changed.edges.push({a:'bedroom-2',b:'bedroom-1',kind:'required_contact'});output.strategies=[changed];assert.equal((await worker.fetch(request(),env)).status,502);
 changed=structuredClone(base);changed.rooms.find(r=>r.type==='bedroom').area=1;output.strategies=[changed];assert.equal((await worker.fetch(request(),env)).status,502);
 console.log('PASS proxy rejects changed inputs, floors, required edges and below-minimum area; preserves explicit zero counts');
}finally{globalThis.fetch=original;}
