import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {upstreamFetch} from '../lib/upstream.js';

const savedFetch=globalThis.fetch,savedRequest=https.request;
const signal=AbortSignal.timeout(1000);
try{
  let attempts=0;
  globalThis.fetch=async()=>{throw new TypeError('fetch failed');};
  https.request=(url,options,callback)=>{
    attempts++;assert.equal(options.family,4);assert.equal(options.signal,signal);
    assert.equal(options.headers.Authorization,'Bearer test-only');
    const request=new EventEmitter();
    request.end=body=>{
      assert.equal(body,'{}');
      const response=new EventEmitter();response.statusCode=200;
      callback(response);response.emit('data',Buffer.from('{"ok":true}'));response.emit('end');
    };
    return request;
  };
  const options={method:'POST',headers:{Authorization:'Bearer test-only'},body:'{}',signal};
  assert.deepEqual(await (await upstreamFetch('https://upstream.test',options)).json(),{ok:true});
  assert.equal(attempts,1);
  globalThis.fetch=async()=>new Response('unavailable',{status:503});
  assert.equal((await upstreamFetch('https://upstream.test',options)).status,503);
  assert.equal(attempts,1);
  globalThis.fetch=async()=>{throw new TypeError('fetch failed');};
  await assert.rejects(upstreamFetch('https://upstream.test',{...options,signal:AbortSignal.abort()}),TypeError);
  assert.equal(attempts,1);
  console.log('PASS upstream: IPv4 recovery, shared deadline, no retry after HTTP response or cancellation');
}finally{globalThis.fetch=savedFetch;https.request=savedRequest;}
