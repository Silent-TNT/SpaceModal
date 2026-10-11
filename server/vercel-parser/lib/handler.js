import worker from './worker.js';

export function handle(request,pathname){
  const url=new URL(request.url);url.pathname=pathname;url.search='';
  const forwarded=new Request(url,request);
  // Vercel supplies x-real-ip; never trust a visitor's CF-Connecting-IP.
  forwarded.headers.set('CF-Connecting-IP',request.headers.get('x-real-ip')||'unknown');
  return worker.fetch(forwarded,{
    PARSER_API_KEY:process.env.PARSER_API_KEY,
    PARSER_MODEL:process.env.PARSER_MODEL||'qwen-plus'
  });
}
