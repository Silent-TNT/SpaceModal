// Opt-in: calls the configured paid model through the local secret-holding proxy.
if(process.env.RUN_LIVE_MODEL!=='1'){console.log('SKIP: set RUN_LIVE_MODEL=1 for the real proxy test');process.exit(0);}
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAN_PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAN_CHROMIUM_PATH||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8898/generator-lab/');
  await page.evaluate(async()=>{GeneratorState.mode='remote';const c={length:7200,width:12000,bedrooms:3,bathrooms:2,seed:123,budget:32};await generate(c,Object.fromEntries(Object.keys(c).map(k=>[k,'user_explicit'])),Design.defaults(c,'central',{multi_purpose:0}));});
  const summary=await page.evaluate(()=>({accepted:GeneratorState.result?.model.validation.rules.accepted,history:GeneratorState.result?.history,messages:document.getElementById('messages').innerText}));
  fs.mkdirSync('qa-artifacts',{recursive:true});fs.writeFileSync('qa-artifacts/live-cooperation.json',JSON.stringify(summary,null,2));
  assert.ok(summary.accepted,summary.messages);assert.ok(summary.history.some(h=>h.outcome==='search_exhausted'));assert.ok(summary.history.some(h=>h.outcome==='revision'));assert.deepEqual(errors,[]);
  await page.screenshot({path:'qa-artifacts/live-cooperation.png',fullPage:true});console.log('PASS actual browser generation failure → real model revision → protected plan → accepted full partition');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
