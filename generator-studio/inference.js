(function(root){
  'use strict';
  // Execute the original trained HGNN_CVA operations with its exported weights.
  const sigmoid = x => 1 / (1 + Math.exp(-x));
  const silu = x => x * sigmoid(x);
  class BrowserModel {
    constructor(payload) { this.meta=payload; this.weights=payload.weights; }
    linear(row,name) {
      const w=this.weights[name+'.weight'], b=this.weights[name+'.bias'].data;
      return b.map((v,i)=>{for(let j=0;j<row.length;j++)v+=w.data[i*row.length+j]*row[j];return Math.fround(v);});
    }
    norm(row,name) {
      const mean=row.reduce((a,b)=>a+b,0)/row.length;
      const variance=row.reduce((a,b)=>a+(b-mean)**2,0)/row.length;
      return row.map((v,i)=>Math.fround((v-mean)/Math.sqrt(variance+1e-5)*this.weights[name+'.weight'].data[i]+this.weights[name+'.bias'].data[i]));
    }
    predict(program,length,width) {
      const query=[{key:'stairs',label:7,floors:[0,1],targetArea:5.76},...program.map(r=>({...r,floors:[r.floor]}))];
      query.sort((a,b)=>a.label-b.label || a.floors[0]-b.floors[0] || (a.key<b.key?-1:a.key>b.key?1:0));
      const counts={};
      const x=query.map(r=>{
        const ordinal=counts[r.label]||0;counts[r.label]=ordinal+1;
        return [...Array.from({length:11},(_,i)=>Number(r.label===i)),Number(r.floors.includes(0)),Number(r.floors.includes(1)),ordinal/8,r.targetArea/(length*width/1e6),length/18000,width/18000].map(Math.fround);
      });
      const boundary=x[0].slice(15,17);
      let h=x.map(row=>this.linear(row,'room.0').map(silu));
      let house=this.linear(boundary,'house.0').map(silu);
      let floors=[0,1].map(f=>this.linear([...boundary,f],'floor.0').map(silu));
      for(let k=0;k<2;k++) {
        const pool=[0,1].map(f=>{
          const included=query.map((r,i)=>r.floors.includes(f)?i:-1).filter(i=>i>=0);
          return Array.from({length:48},(_,j)=>Math.fround(included.reduce((sum,i)=>sum+h[i][j],0)/Math.max(1,included.length)));
        });
        const houseMessage=this.linear(house,'house_to_floor.'+k);
        floors=floors.map((row,f)=>{const message=this.linear(pool[f],'room_to_floor.'+k);return row.map((v,j)=>Math.fround(silu(v+message[j]+houseMessage[j])));});
        const houseIncoming=this.linear(floors[0].map((v,j)=>(v+floors[1][j])/2),'floor_to_house.'+k);
        house=house.map((v,j)=>Math.fround(silu(v+houseIncoming[j])));
        const transformed=floors.map(row=>this.linear(row,'floor_to_room.'+k));
        h=h.map((row,i)=>{
          const fs=query[i].floors;
          const incoming=row.map((_,j)=>fs.reduce((s,f)=>s+transformed[f][j],0)/fs.length);
          const peers=row.map((_,j)=>fs.reduce((s,f)=>s+pool[f][j],0)/fs.length);
          const peer=this.linear(peers,'peer.'+k);
          return this.norm(row.map((v,j)=>Math.fround(v+incoming[j]+peer[j])),'norm.'+k);
        });
      }
      const raw=h.map(row=>this.linear(row,'head'));
      const center=raw.map(r=>r.slice(0,2).map(sigmoid));
      const scale=raw.map(r=>r.slice(2,4).map(v=>.035+.55*sigmoid(v)));
      const bias=raw.map(r=>r[4]);
      const empty=floors.map(row=>this.linear(this.linear(row,'empty.0').map(silu),'empty.2')[0]);
      const priors=Object.fromEntries(query.map((r,i)=>[r.key,{cx:center[i][0],cy:center[i][1],sx:scale[i][0],sy:scale[i][1],bias:bias[i]}]));
      const assignments=[0,1].map(f=>Array.from({length:24},(_,y)=>Array.from({length:24},(_,x)=>{
        let best=empty[f],id=0;
        query.forEach((r,i)=>{if(!r.floors.includes(f))return;
          const value=bias[i]-Math.min(100,(((x+.5)/24-center[i][0])/scale[i][0])**4)-Math.min(100,(((y+.5)/24-center[i][1])/scale[i][1])**4);
          if(value>best){best=value;id=i+1;}
        });return id;
      })));
      return {priors,center,scale,bias,empty,assignments,query,keys:query.map(r=>r.key)};
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=BrowserModel;else root.BrowserModel=BrowserModel;
})(globalThis);
