import assert from 'node:assert/strict';
import parser from '../api/parse.js';
import health from '../api/health.js';
const savedKey=process.env.PARSER_API_KEY,savedModel=process.env.PARSER_MODEL,originalFetch=globalThis.fetch;
const current={length:10800,width:10800,bedrooms:3,bathrooms:2,seed:123,budget:2400};
let calls=0;
const req=(body={text:'卧室改为四间',current},origin='https://www.spacemodal.com',method='POST')=>new Request('https://deployment.test/api/parse',{method,headers:{Origin:origin,'Content-Type':'application/json','x-real-ip':'192.0.2.1'},...(['GET','HEAD','OPTIONS'].includes(method)?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
try{
  delete process.env.PARSER_API_KEY;
  let response=await health.fetch(new Request('https://deployment.test/api/health'));
  assert.deepEqual(await response.json(),{ok:true,configured:false,purpose:'requirement_parser'});
  assert.equal((await parser.fetch(req())).status,503);
  process.env.PARSER_API_KEY='test-secret-never-real';process.env.PARSER_MODEL='qwen-plus';
  globalThis.fetch=async(url,options)=>{
    calls++;assert.equal(url,'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    assert.equal(options.headers.Authorization,'Bearer test-secret-never-real');
    const payload=JSON.parse(options.body);assert.equal(payload.model,'qwen-plus');assert.equal(payload.messages[0].role,'system');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({patch:{bedrooms:4},unsupported:[]})}}]}));
  };
  response=await parser.fetch(req({},'https://www.spacemodal.com','OPTIONS'));
  assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://www.spacemodal.com');assert.equal(calls,0);
  assert.equal((await parser.fetch(req({},'https://evil.test','OPTIONS'))).status,403);
  assert.equal((await parser.fetch(req('{invalid'))).status,400);
  assert.equal((await parser.fetch(req({text:'四间卧室',current:{...current,length:10000}}))).status,400);
  assert.equal((await parser.fetch(req({text:'四间卧室',current:{bedrooms:3}}))).status,400);assert.equal(calls,0);
  response=await parser.fetch(req());assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{patch:{bedrooms:4},unsupported:[],source:'llm'});
  response=await parser.fetch(req({text:'四间卧室',current:{...current,balconies0:0,balconies1:2}},'https://spacemodal.com'));
  assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://spacemodal.com');
  response=await health.fetch(new Request('https://deployment.test/api/health'));
  const raw=await response.text();assert.equal(JSON.parse(raw).configured,true);assert.ok(!raw.includes('test-secret'));
  assert.equal(calls,2);
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({patch:{...current,bedrooms:4,seed:124,balconies0:-1,balconies1:-1},unsupported:[]})}}]}));
  response=await parser.fetch(req());assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{patch:{bedrooms:4},unsupported:[],source:'llm'});
  globalThis.fetch=async()=>new Response('unavailable',{status:401});
  assert.equal((await parser.fetch(req())).status,502);
  console.log('PASS Vercel handlers: health, CORS, key isolation, invalid input, legacy/current fields and upstream failure');
}finally{
  globalThis.fetch=originalFetch;
  if(savedKey===undefined)delete process.env.PARSER_API_KEY;else process.env.PARSER_API_KEY=savedKey;
  if(savedModel===undefined)delete process.env.PARSER_MODEL;else process.env.PARSER_MODEL=savedModel;
}
