import assert from 'node:assert/strict';
import worker from '../worker/index.js';
const current={length:10800,width:10800,bedrooms:3,bathrooms:2,seed:123,budget:2400};
const req=(text='卧室改为四间',origin='https://www.spacemodal.com')=>new Request('https://proxy.test/parse',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'test-ip'},body:JSON.stringify({current,text})});
const env={PARSER_API_KEY:'test-not-real',PARSER_MODEL:'qwen-plus'};
let calls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,options)=>{
 calls++;assert.equal(url,'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
 const body=JSON.parse(options.body);assert.equal(body.model,'qwen-plus');assert.equal(body.max_tokens,700);assert.equal(options.headers.Authorization,'Bearer test-not-real');
 return new Response(JSON.stringify({choices:[{message:{content:'{"patch":{"bedrooms":4},"unsupported":[]}'}}]}),{headers:{'Content-Type':'application/json'}});
};
try{
 assert.equal((await worker.fetch(req('四间卧室','https://evil.test'),env)).status,403);assert.equal(calls,0);
 assert.equal((await worker.fetch(req(),{})).status,503);assert.equal(calls,0);
 const oversized=await worker.fetch(req('字'.repeat(1501)),env);assert.equal(oversized.status,400);assert.equal(calls,0);
 let response=await worker.fetch(req(),env);assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://www.spacemodal.com');assert.deepEqual(await response.json(),{patch:{bedrooms:4},unsupported:[],source:'llm'});
 console.log('PASS CORS, no key exposure, configured state, payload bounds and upstream adapter');
 globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'{"patch":{"walls":5},"unsupported":[]}'}}]}));
 assert.equal((await worker.fetch(req(),env)).status,502);
 globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'{"patch":{"length":10000},"unsupported":[]}'}}]}));
 assert.equal((await worker.fetch(req(),env)).status,502);
 for(let i=0;i<2;i++)await worker.fetch(req(),env);
 assert.equal((await worker.fetch(req(),env)).status,429);
 console.log('PASS malformed model results, grid bounds and per-instance call throttle');
}finally{globalThis.fetch=originalFetch;}
