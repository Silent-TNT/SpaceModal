(function(root){
 'use strict';
 const Design=typeof module!=='undefined'&&module.exports?require('./design.js'):root.Design;
 async function run({conditions,plan,solve,revise,onEvent=()=>{},signal,maxRevisions=3,timeoutMs=180000}){
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason),timer=setTimeout(()=>controller.abort('total_timeout'),timeoutMs),history=[],started=Date.now();let current=structuredClone(plan);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{
   for(let round=0;round<=maxRevisions;round++){
    controller.signal.throwIfAborted();const attemptSeed=(conditions.seed+Math.imul(round,1597334677))>>>0;
    onEvent({phase:'generate',round,plan:current});
    try{
     const result=await solve({...conditions,seed:attemptSeed},current,controller.signal);controller.signal.throwIfAborted();
     history.push({round,attempt_seed:attemptSeed,plan:current,outcome:'accepted',rules:result.model.validation.rules,local_repairs:result.model.generation.localRepairs});
     return {...result,computeSeconds:result.elapsedSeconds,elapsedSeconds:(Date.now()-started)/1000,history};
    }catch(error){
     controller.signal.throwIfAborted();if(error.report?.type!=='search_exhausted')throw error;
     history.push({round,attempt_seed:attemptSeed,plan:current,outcome:'search_exhausted',report:error.report});onEvent({phase:'failure',round,report:error.report});
     if(!revise||round>=maxRevisions){error.history=history;throw error;}
     onEvent({phase:'revise',round:round+1});const updated=await revise(current,error.report,history,controller.signal);controller.signal.throwIfAborted();
     Design.assertRevision(plan,updated,conditions);
     history.push({round:round+1,outcome:'revision',changes:{mode:{before:current.mode,after:updated.mode},areas:updated.rooms.filter(r=>r.area!==current.rooms.find(o=>o.key===r.key)?.area).map(r=>({key:r.key,before:current.rooms.find(o=>o.key===r.key)?.area,after:r.area}))}});
     current=updated;
    }
   }
  }catch(error){if(typeof error!=='object'||error===null)error=Error(controller.signal.aborted?'协同生成已停止或达到总时间限制':String(error));error.history=history;throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 const api={run};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Cooperate=api;
})(globalThis);
