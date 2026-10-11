import https from 'node:https';

// The provider's dual-stack route can time out from serverless networks.
// Retry connection failures once over IPv4, within the same overall deadline.
export async function upstreamFetch(url,options){
  try{return await fetch(url,options);}
  catch(error){
    if(options.signal.aborted||error.name!=='TypeError')throw error;
    return new Promise((resolve,reject)=>{
      const request=https.request(url,{method:options.method,headers:options.headers,signal:options.signal,family:4},response=>{
        const chunks=[];let size=0;
        response.on('data',chunk=>{
          size+=chunk.length;
          if(size>131072){response.destroy(new Error('Upstream response too large'));return;}
          chunks.push(chunk);
        });
        response.on('error',reject);
        response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:{'Content-Type':'application/json'}})));
      });
      request.on('error',reject);request.end(options.body);
    });
  }
}
