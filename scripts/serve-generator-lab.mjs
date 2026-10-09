import http from 'node:http';
import {readFileSync,existsSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../server/parser/worker/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const envFile=process.env.SPACEMODAL_ENV_FILE||path.join(root,'..','.env.local');
const env={...process.env};if(existsSync(envFile))for(const line of readFileSync(envFile,'utf8').split(/\r?\n/)){if(line.trim().startsWith('#')||!line.includes('='))continue;const index=line.indexOf('='),key=line.slice(0,index).trim();if(!env[key])env[key]=line.slice(index+1).trim().replace(/^["']|["']$/g,'');}
env.PARSER_API_KEY ||= env.DASHSCOPE_API_KEY;env.PARSER_MODEL ||= 'qwen-plus';
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(['/parse','/design'].includes(url.pathname)){
   const allowed=new Set([`http://127.0.0.1:${server.address().port}`,`http://localhost:${server.address().port}`]);
   if(req.headers.origin&&!allowed.has(req.headers.origin)){res.writeHead(403);res.end('Origin rejected');return;}
   if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(415);res.end('JSON POST required');return;}
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>12000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const result=await worker.fetch(new Request('https://www.spacemodal.com'+url.pathname,{method:req.method,headers:{Origin:'https://www.spacemodal.com','Content-Type':'application/json','CF-Connecting-IP':'local-demo'},body:req.method==='POST'?Buffer.concat(chunks):undefined}),env);
   res.writeHead(result.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(await result.text());return;
  }
  const name=path.resolve(root,'.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
  if(!name.startsWith(root+path.sep)||name.includes(path.sep+'.git'+path.sep)||name.includes('.env')||!existsSync(name)||!statSync(name).isFile()){res.writeHead(404);res.end();return;}
  const type=name.endsWith('.html')?'text/html':name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(readFileSync(name));
 }catch{res.writeHead(500);res.end('Preview request failed');}
});
server.listen(Number(process.env.PORT||8898),'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/generator-lab/ (parser configured: ${Boolean(env.PARSER_API_KEY)})`));
