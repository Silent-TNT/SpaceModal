(function(root){
 'use strict';
 const VERSION='R1-R6-v1';
 function shape(grid,nx,ny,id){
  const cells=[];for(let i=0;i<grid.length;i++)if(grid[i]===id)cells.push(i);
  if(!cells.length)return 'absent';
  const xs=cells.map(i=>i%nx),ys=cells.map(i=>Math.floor(i/nx)),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const rows=[];for(let y=y0;y<=y1;y++){let row='';for(let x=x0;x<=x1;x++)row+=grid[y*nx+x]===id?'1':'0';rows.push(row);}
  if(rows.every(r=>!r.includes('0')))return 'rectangle';
  const empty=[];for(let y=0;y<rows.length;y++)for(let x=0;x<rows[0].length;x++)if(rows[y][x]==='0')empty.push([x,y]);
  const ex0=Math.min(...empty.map(p=>p[0])),ex1=Math.max(...empty.map(p=>p[0])),ey0=Math.min(...empty.map(p=>p[1])),ey1=Math.max(...empty.map(p=>p[1]));
  if(empty.length===(ex1-ex0+1)*(ey1-ey0+1)&&(ex0===0||ex1===x1-x0)&&(ey0===0||ey1===y1-y0)&&ex1-ex0<x1-x0&&ey1-ey0<y1-y0)return 'L';
  const uniqueRows=rows.filter((r,i)=>!i||r!==rows[i-1]),columns=[];
  for(let x=0;x<rows[0].length;x++){const column=uniqueRows.map(r=>r[x]).join('');if(!x||column!==columns[columns.length-1])columns.push(column);}
  const pattern=uniqueRows.map((r,y)=>columns.map(c=>c[y]).join('')).join('/');
  return ['111/010/111','101/111/101'].includes(pattern)?'I':'invalid';
 }
 function validate(m){
  const issues=[],checks=[],failedRules=new Set(),add=(rule,code,instance,expected,actual)=>{failedRules.add(rule);if(issues.length<60)issues.push({rule,code,instance,expected,actual});};
  const {nx,ny}=m,plane=nx*ny,dimensions=Number.isInteger(nx)&&nx>0&&Number.isInteger(ny)&&ny>0&&nx<=60&&ny<=60;
  if(!dimensions||m.cell!==300||(m.origin||[0,0,0]).some(v=>!Number.isInteger(v)||v%300))add('R2','module',null,'integer grid; 300mm module',[nx,ny,m.cell,m.origin]);
  if(m.floorCount!==2||m.floorHeight!==3000)add('R4','height',null,'2 floors × 3000mm',[m.floorCount,m.floorHeight]);
  if(m.cell!==300||(m.voxelCell||[300,300,300]).some(v=>v!==300))add('R5','voxel_size',null,[300,300,300],m.voxelCell||m.cell);
  const validArrays=dimensions&&m.floorSpaces?.length===2&&m.floors?.length===2&&m.floorSpaces.every(a=>a.length===plane)&&m.floors.every(a=>a.length===plane);
  if(!validArrays)add('R1','grid_shape',null,'two complete floor grids','invalid');
  const spaces=new Map((m.spaces||[]).map(s=>[s.id,s]));
  if((m.spaces||[]).some(s=>!Number.isInteger(s.id)||s.id<0||!Number.isInteger(s.label)||s.label<0||s.label>10||typeof s.key!=='string'||!s.key.length)||spaces.size!==(m.spaces||[]).length||new Set((m.spaces||[]).map(s=>s.key)).size!==spaces.size)add('R1','duplicate_instance',null,'unique IDs and keys','duplicate');
  if(validArrays){
   const count=plane*20,owners=new Int32Array(count),labels=new Int16Array(count),first=new Map(),totals=new Map();
   if(m.voxels&&(m.voxels.owners?.length!==count||m.voxels.labels?.length!==count))add('R5','voxel_count',null,count,'invalid explicit grid');
   for(let z=0;z<20;z++)for(let i=0;i<plane;i++){
    const at=z*plane+i,f=z<10?0:1,id=m.voxels?.owners?.[at]??m.floorSpaces[f][i],label=m.voxels?.labels?.[at]??m.floors[f][i],space=spaces.get(id);
    owners[at]=id;labels[at]=label;
    if(!Number.isInteger(id)||id<0||!space||!Number.isInteger(label)||label<0||label>10||space.label!==label)add('R1','ownership',space?.key||id,'legal function and matching instance',{voxel:at,id,label});
    if(id!==m.floorSpaces[f][i]||label!==m.floors[f][i])add('R6','non_prismatic',space?.key||id,'constant floor extrusion',at);
    if(!first.has(id))first.set(id,at);totals.set(id,(totals.get(id)||0)+1);
   }
   const seen=new Uint8Array(count),connected=new Map();
   for(let at=0;at<count;at++)if(!seen[at]){
    const id=owners[at],queue=[at];seen[at]=1;connected.set(id,(connected.get(id)||0)+1);
    for(let h=0;h<queue.length;h++){
     const q=queue[h],xy=q%plane,x=xy%nx,y=Math.floor(xy/nx),z=Math.floor(q/plane);
     const adjacent=[x>0?q-1:-1,x<nx-1?q+1:-1,y>0?q-nx:-1,y<ny-1?q+nx:-1,z>0?q-plane:-1,z<19?q+plane:-1];
     for(const n of adjacent)if(n>=0&&!seen[n]&&owners[n]===id){seen[n]=1;queue.push(n);}
    }
   }
   for(const s of spaces.values()){
    if(!totals.has(s.id))add('R1','unplaced',s.key,'occupied instance',0);
    if(connected.get(s.id)!==1)add('R6','components',s.key,1,connected.get(s.id)||0);
    for(let f=0;f<2;f++){
     const kind=shape(m.floorSpaces[f],nx,ny,s.id);
     if(kind!=='absent'&&!['rectangle','L',...(s.label===6?['I']:[])].includes(kind))add('R6','shape',s.key,s.label===6?'rectangle/L/I':'rectangle/L',{floor:f+1,shape:kind});
     if(kind!=='absent'&&s.label!==7&&s.floor!==f)add('R1','wrong_floor',s.key,s.floor,f);
    }
   }
   const stairs=[...spaces.values()].filter(s=>s.label===7);
   if(stairs.length!==1)add('R3','stairs_count',null,1,stairs.length);
   else{
    const id=stairs[0].id;let base=0,aligned=true,bridge=0;
    for(let i=0;i<plane;i++){if(m.floorSpaces[0][i]===id)base++;if((m.floorSpaces[0][i]===id)!==(m.floorSpaces[1][i]===id))aligned=false;if(owners[9*plane+i]===id&&owners[10*plane+i]===id)bridge++;}
    if(!base||!aligned||!bridge||connected.get(id)!==1)add('R3','stairs_alignment',stairs[0].key,'aligned face-connected 20-layer stair',{base,aligned,bridge,components:connected.get(id)});
   }
  }
  for(const rule of ['R1','R2','R3','R4','R5','R6'])checks.push({name:rule,passed:!failedRules.has(rule)});
  return {version:VERSION,accepted:checks.every(c=>c.passed),checks,issues,voxelEncoding:'floor_extrusion',layersPerFloor:10,nz:20};
 }
 function contacts(m){const out=new Set(),byId=new Map(m.spaces.map(s=>[s.id,s]));for(const grid of m.floorSpaces)for(let i=0;i<grid.length;i++)for(const j of [i%m.nx<m.nx-1?i+1:-1,i+m.nx<grid.length?i+m.nx:-1]){const a=byId.get(grid[i]),b=byId.get(grid[j]);if(j>=0&&grid[i]!==grid[j]&&a&&b)out.add([a.key,b.key].sort().join('|'));}return out;}
 const api={VERSION,shape,validate,contacts};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Rules=api;
})(globalThis);
