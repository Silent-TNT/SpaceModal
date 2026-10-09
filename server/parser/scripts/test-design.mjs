import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import Design from '../../../generator-lab/design.js';
const current={length:12000,width:12000,bedrooms:3,bathrooms:2,seed:123,budget:32};
const env={PARSER_API_KEY:'test-not-real'};
let output={patch:{},unsupported:[],strategies:[Design.defaults(current,'edge',{kitchen:0})]};
const original=globalThis.fetch;
globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));
const request=(text,previous=null)=>new Request('https://proxy.test/design',{method:'POST',headers:{Origin:'https://www.spacemodal.com','Content-Type':'application/json','CF-Connecting-IP':'design-tests'},body:JSON.stringify({text,current,current_plan:previous})});
try{
 let response=await worker.fetch(request('不要厨房'),env);assert.equal(response.status,200);assert.equal((await response.json()).strategies[0].requirements.counts.kitchen,0);
 output.strategies=[Design.defaults(current)];assert.equal((await worker.fetch(request('不要厨房'),env)).status,502);
 assert.equal((await worker.fetch(request('换方案',{requirements:{counts:{kitchen:0}}}),env)).status,502);
 output.strategies=[Design.defaults(current)];output.strategies[0].edges=[];assert.equal((await worker.fetch(request('三间卧室'),env)).status,502);
 output.strategies.push(Design.defaults(current,'edge'));response=await worker.fetch(request('三间卧室'),env);assert.equal(response.status,200);const filtered=await response.json();assert.equal(filtered.strategies.length,1);assert.equal(filtered.validation_notes.length,1);
 console.log('PASS /design validates topology connectivity, rejects explicit zero violations and preserves previous counts');
}finally{globalThis.fetch=original;}
