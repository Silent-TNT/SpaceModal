(function (root) {
  'use strict';
  const Organization=typeof require==='function'?require('./organization.js'):root.Organization;
  const MealRouting=typeof require==='function'?require('./meal-routing.js'):root.MealRouting;
  const MealGeometry=typeof require==='function'?require('./meal-geometry.js'):root.MealGeometry;
  const BedroomDaylight=typeof require==='function'?require('./daylight.js'):root.BedroomDaylight;
  const Functional=typeof require==='function'?require('./functional-rules.js'):root.FunctionalRules;
  const Traffic=typeof require==='function'?require('./circulation.js'):root.CirculationRules;

  // Result constraints remain separate from generation and circulation preferences.
  const RULES = Object.freeze({ cell: 300, floorCount: 2, floorHeight: 3000 });
  const FLOOR_CELLS = RULES.floorHeight / RULES.cell;
  const TOTAL_CELLS = FLOOR_CELLS * RULES.floorCount;
  const LABELS = Object.freeze([
    ['玄关', '#f6b55c'], ['客厅', '#63aee6'], ['餐厅', '#ffd36a'], ['厨房', '#e88172'],
    ['卧室', '#aa9af3'], ['卫生间', '#69cabb'], ['过道', '#8294aa'], ['楼梯间', '#e3a5c2'],
    ['家政空间', '#c1d780'], ['阳台', '#66d2dc'], ['多功能室', '#bb97d8']
  ].map(Object.freeze));
  const ID = Object.freeze(Object.fromEntries(LABELS.map(([name], index) => [name, index])));

  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SEARCH_BUDGET = 24;
  // Relative area preferences are scoring targets, not minimum-area requirements.
  const AREA_TARGETS = Object.freeze([
    { '玄关': .025, '客厅': .38, '餐厅': .20, '厨房': .15, '卫生间': .09, '家政空间': .06, '阳台': .065 },
    { '卧室': .49, '卫生间': .11, '多功能室': .30, '阳台': .07 }
  ]);
  const RELATIONS = Object.freeze([
    ['厨房', '餐厅', 5], ['客厅', '餐厅', 2],
    ['家政空间', '厨房', 2], ['家政空间', '卫生间', 1], ['卧室', '卫生间', 2]
  ]);

  const OPEN_LABELS = Object.freeze(['玄关', '客厅', '餐厅', '多功能室'].map(name => ID[name]));
  const BEDROOM_RULES = Object.freeze({minWidth:2.4,maxAspect:1.8,preferredAspect:1.5});
  // Engineering limits; the minimum cap accommodates the largest initial anchor.
  const ENTRY_RULES=Object.freeze({revision:'entry-cap-v1',maxFloorFraction:.12,minCapArea:4.86,targetMultiplier:1.5});
  function entryMaxArea(room,floorArea){return Math.min(Math.max(ENTRY_RULES.minCapArea,room.preferredAreaMax||room.targetArea*ENTRY_RULES.targetMultiplier),Math.max(ENTRY_RULES.minCapArea,floorArea*ENTRY_RULES.maxFloorFraction));}
  const isTransit = label => OPEN_LABELS.includes(label) || label === ID['过道'];
  function areaDeviation(room,area){
    const target=room.budgetTargetArea??room.targetArea;
    if(Number.isFinite(room.preferredAreaMin)&&Number.isFinite(room.preferredAreaMax)){
      const outside=Math.max(0,room.preferredAreaMin-area,area-room.preferredAreaMax);
      // Quartiles remain soft preferences. A growing marginal cost prevents a
      // single room (especially the entry) from becoming the leftover collector.
      const deviation=outside/target;
      return deviation+deviation*deviation+.25*Math.abs(area-target)/target;
    }
    return Math.abs(area-target)/target;
  }

  function partitionCandidate(nx, ny, seed, plan, index) {
    const r = rng((seed + Math.imul(index + 1, 0x9E3779B9)) >>> 0);
    const mirror = plan ? plan.publicSide === 'right' : r() < .5;
    const back = plan ? plan.balconyEnd === 'back' : r() < .5;
    const bathPublic = plan ? plan.bathroomSide === 'public' : r() < .5;
    const multiFirst = plan ? plan.upperRight === 'multifunction_first' : r() < .5;
    const cutX = Math.round(nx * (.42 + r() * .08));
    const middleStart = Math.round(ny * (.32 + r() * .08));
    const middleEnd = Math.round(ny * (.62 + r() * .08));
    const stairRatio = plan ? { narrow: .12, standard: .15, wide: .18 }[plan.coreWidth] : .12 + r() * .06;
    const stairW = Math.max(2, Math.round(nx * stairRatio));
    const stairH = Math.max(2, Math.min(middleEnd - middleStart - 2, Math.round(ny * (.13 + r() * .05))));
    // Each seed explores all placement families instead of only jittering an
    // interior core. Exterior contact indicates potential daylight, not a window.
    const stairPlacement = ['public-wall', 'service-wall', 'public-corner', 'interior'][index % 4];
    const jointY = middleStart + Math.floor((middleEnd - middleStart - stairH) / 2);
    const stairX = stairPlacement === 'service-wall' ? nx - stairW :
      stairPlacement === 'interior' ? cutX - Math.floor(stairW / 2) : 0;
    const stairY = stairPlacement === 'public-corner' ? (back ? 0 : ny - stairH) : jointY;
    const balconyH = Math.max(2, Math.round(ny * (.10 + r() * .06)));
    const entryW = Math.max(2, Math.round(nx * .12)), entryH = Math.max(2, Math.round(ny * .10));
    const kitchenEnd = Math.min(jointY - 1, Math.round(ny * (.23 + r() * .07)));
    const serviceEnd = Math.max(jointY + stairH + 1, Math.round(ny * (.70 + r() * .05)));
    const floors = [], owners = [], spaces = [], keys = new Map();
    function identity(name, key) {
      if (!keys.has(key)) {
        keys.set(key, spaces.length);
        spaces.push({ id: spaces.length, label: ID[name], key });
      }
      return keys.get(key);
    }
    for (let f = 0; f < 2; f++) {
      const grid = new Int16Array(nx * ny).fill(-1), map = new Int32Array(nx * ny).fill(-1);
      function paint(x, y, w, h, name, slot = name) {
        const sid = identity(name, slot === 'stairs' ? slot : `${f}:${slot}`);
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
          const at = yy * nx + (mirror ? nx - 1 - xx : xx);
          grid[at] = ID[name]; map[at] = sid;
        }
      }
      // Jointly choose room boundaries, the open gathering area and aligned stairs.
      // No corridor strips are reserved. The living/dining/multifunction areas have
      // substantial depth and remain usable spaces with circulation shared inside them.
      if (f === 0) {
        paint(0, 0, cutX, ny, '客厅');
        paint(0, back ? ny - balconyH : 0, cutX, balconyH, '阳台');
        paint(cutX, 0, nx - cutX, kitchenEnd, '厨房');
        paint(cutX, kitchenEnd, nx - cutX, serviceEnd - kitchenEnd, '餐厅');
        if (bathPublic) {
          paint(cutX, serviceEnd, nx - cutX, ny - serviceEnd, '家政空间');
          const bathW = Math.max(2, Math.round(cutX * (.44 + r() * .10)));
          const bathH = Math.max(2, Math.round(ny * .20));
          // A corner stair and the public-side bathroom keep distinct areas.
          const inset = stairPlacement === 'public-corner' ? stairH : 0;
          paint(0, back ? inset : ny - inset - bathH, bathW, bathH, '卫生间');
        } else {
          const utilityW = Math.max(2, Math.round((nx - cutX) * (.32 + r() * .12)));
          paint(cutX, serviceEnd, utilityW, ny - serviceEnd, '家政空间');
          paint(cutX + utilityW, serviceEnd, nx - cutX - utilityW, ny - serviceEnd, '卫生间');
        }
        paint(cutX - entryW, back ? 0 : ny - entryH, entryW, entryH, '玄关');
      } else {
        // A broad multifunction space connects the upper rooms. Bedrooms remain leaves.
        paint(0, middleStart, nx, middleEnd - middleStart, '多功能室');
        const nearY = back ? middleEnd : 0, nearH = back ? ny - middleEnd : middleStart;
        const farY = back ? 0 : middleEnd, farH = back ? middleStart : ny - middleEnd;
        paint(0, nearY, cutX, nearH, '卧室', 'bedroom-public');
        paint(0, back ? ny - balconyH : 0, cutX, balconyH, '阳台');
        paint(0, farY, cutX, farH, multiFirst ? '卧室' : '多功能室', multiFirst ? 'bedroom-service' : '多功能室');
        paint(cutX, 0, nx - cutX, middleStart, multiFirst ? '多功能室' : '卧室', multiFirst ? '多功能室' : 'bedroom-service');
        paint(cutX, middleEnd, nx - cutX, ny - middleEnd, '卫生间');
        if (stairPlacement === 'public-corner' && multiFirst) {
          // Jointly extend the upper open room to the corner. This is a wide
          // functional wing, not a path through the secondary bedroom.
          const wingW = Math.min(cutX - 2, stairW + Math.max(2, Math.round(nx * .06)));
          paint(0, farY, wingW, farH, '多功能室');
        }
      }
      paint(stairX, stairY, stairW, stairH, '楼梯间', 'stairs');
      floors.push(grid); owners.push(map);
    }
    return { nx, ny, floors, owners, spaces,
      geometry: { cutX, middleStart, middleEnd, stairX, stairY, stairW, stairH, stairPlacement, mirror, back, multiFirst } };
  }

  // Reachability expands only through spaces that are allowed to carry circulation.
  // Private rooms may serve their own balcony; they cannot connect unrelated rooms.
  function validateCirculation(model) {
    const { spaces, connections } = model;
    const graph = spaces.map(() => []), issues = [];
    for (const edge of connections) {
      if (!spaces[edge.a] || !spaces[edge.b]) { issues.push('规划连接引用了无效空间'); continue; }
      if([spaces[edge.a].label,spaces[edge.b].label].includes(ID['卧室'])&&[spaces[edge.a].label,spaces[edge.b].label].includes(ID['楼梯间'])){issues.push('楼梯不能直接进入卧室，须经走道或公共区域');continue;}
      if (model.floorSpaces) {
        const map = model.floorSpaces[edge.floor], at = edge.y * model.nx + edge.x;
        const before = at - (edge.axis === 'x' ? 1 : model.nx);
        const valid = map && ['x','y'].includes(edge.axis) && Number.isInteger(edge.x) && Number.isInteger(edge.y) &&
          edge.x >= (edge.axis === 'x' ? 1 : 0) && edge.x < model.nx &&
          edge.y >= (edge.axis === 'y' ? 1 : 0) && edge.y < model.ny &&
          ((map[before]===edge.a && map[at]===edge.b) || (map[before]===edge.b && map[at]===edge.a));
        if (!valid) { issues.push('规划出入口不位于对应空间的共享面'); continue; }
      }
      graph[edge.a].push(edge.b); graph[edge.b].push(edge.a);
    }
    const entry=spaces.find(space=>space.label===ID['玄关']);
    if(!entry)return {accepted:false,reachable:false,issues:['缺少玄关'],inaccessible:spaces.map(s=>s.id)};
    const stair=spaces.find(s=>s.label===ID['楼梯间']),landing=spaces.find(s=>s.key==='1:stair-landing');
    const reached=new Set(),transit=new Set(),floorReports=[];
    const visit=(floor,root)=>{
      const local=spaces.map(()=>[]);
      for(const edge of connections.filter(e=>(e.floor??0)===floor))if(graph[edge.a]?.includes(edge.b)){
        local[edge.a].push(edge.b);local[edge.b].push(edge.a);
      }
      const seen=new Set(root===undefined?[]:[root]),queue=[...seen];
      for(let head=0;head<queue.length;head++)for(const next of local[queue[head]])if(!seen.has(next)&&isTransit(spaces[next]?.label)){seen.add(next);queue.push(next);}
      for(const id of seen){transit.add(id);reached.add(id);for(const next of local[id])reached.add(next);}
      for(const id of [...reached])for(const next of local[id]||[])if(spaces[next].label===ID['阳台']&&[...OPEN_LABELS,ID['卧室']].includes(spaces[id].label)||spaces[next].label===ID['家政空间']&&spaces[id].label===ID['厨房'])reached.add(next);
      const stairNeighbors=stair?[...new Set(local[stair.id])]:[];
      if(stairNeighbors.length>1)issues.push(`${floor+1}层楼梯只能连接一个到达空间，不能作为同层穿行通路`);
      floorReports.push({floor,root,publicReachable:[...seen],stairNeighbors});
      return stairNeighbors;
    };
    visit(0,entry.id);
    const upper=stair?connections.filter(e=>e.floor===1&&(e.a===stair.id||e.b===stair.id)).map(e=>e.a===stair.id?e.b:e.a):[];
    if(stair&&reached.has(stair.id)&&upper.length){
      const root=landing?.id??upper.find(id=>isTransit(spaces[id]?.label));
      if(model.organizationPolicy&&(!landing||upper.some(id=>id!==landing.id)))issues.push('二层楼梯须只连接独立到达走道');
      visit(1,root);
    }
    const inaccessible=spaces.filter(s=>!reached.has(s.id)).map(s=>s.id);
    if(inaccessible.length)issues.push('存在只能穿过楼梯或独立房间才能到达的空间');
    return {accepted:issues.length===0,reachable:issues.length===0,issues,inaccessible,transit:[...transit],floors:floorReports};
  }

  function assessCandidate(candidate) {
    const { nx, ny, floors, owners, spaces } = candidate, slab = nx * ny;
    const areas = new Map(), boundary = new Set(), contacts = new Map(), exteriorFaces = new Map();
    const contact = (a, b, f, x, y, axis) => {
      if (a === b) return;
      const key = `${f}:${Math.min(a, b)}:${Math.max(a, b)}`;
      if (!contacts.has(key)) contacts.set(key, { a: Math.min(a, b), b: Math.max(a, b), floor: f, faces: [] });
      contacts.get(key).faces.push({ x, y, axis });
    };
    for (let f = 0; f < 2; f++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const at = y * nx + x, sid = owners[f][at], key = `${f}:${sid}`;
      if (!areas.has(key)) areas.set(key, { sid, floor: f, count: 0, minX: x, maxX: x, minY: y, maxY: y });
      const a = areas.get(key); a.count++; a.minX = Math.min(a.minX, x); a.maxX = Math.max(a.maxX, x); a.minY = Math.min(a.minY, y); a.maxY = Math.max(a.maxY, y);
      if (x === 0 || y === 0 || x === nx - 1 || y === ny - 1) boundary.add(sid);
      if (!exteriorFaces.has(key)) exteriorFaces.set(key, { left: 0, right: 0, front: 0, back: 0 });
      const facade = exteriorFaces.get(key);
      if (x === 0) facade.left++; if (x === nx - 1) facade.right++;
      if (y === 0) facade.front++; if (y === ny - 1) facade.back++;
      if (x + 1 < nx) contact(sid, owners[f][at + 1], f, x + 1, y, 'x');
      if (y + 1 < ny) contact(sid, owners[f][at + nx], f, x, y + 1, 'y');
    }
    let areaPenalty = 0, shapePenalty = 0, exteriorPenalty = 0, adjacencyPenalty = 0;
    const reports = [];
    for (const a of areas.values()) {
      const name = LABELS[spaces[a.sid].label][0], target = spaces[a.sid].targetArea ? spaces[a.sid].targetArea/(slab*.09) : AREA_TARGETS[a.floor][name];
      const fraction = a.count / slab;
      if (target) {
        const roomTarget = name === '卧室' && !spaces[a.sid].targetArea ? target / 2 : target;
        areaPenalty += Math.abs(fraction - roomTarget);
        const w = a.maxX - a.minX + 1, h = a.maxY - a.minY + 1;
        shapePenalty += Math.max(0, Math.max(w / h, h / w) - 2.5);
        if(OPEN_LABELS.includes(spaces[a.sid].label)){
          const metrics=spaceShapeMetrics(owners[a.floor],nx,a.sid);
          shapePenalty+=metrics.concaveCorners*3+(1-a.count/(w*h))*8;
        }
        if(name==='卧室')shapePenalty+=Math.max(0,Math.max(w/h,h/w)-BEDROOM_RULES.preferredAspect)*10;
        reports.push({ spaceId: a.sid, floor: a.floor, area: a.count * .09, targetArea: roomTarget * slab * .09 });
      }
      if (['客厅', '卧室', '阳台'].includes(name) && !boundary.has(a.sid)) exteriorPenalty++;
    }
    const stair = spaces.find(s => s.label === ID['楼梯间']);
    const stairFloors = [0,1].map(f => {
      const facade = exteriorFaces.get(`${f}:${stair?.id}`) || {left:0,right:0,front:0,back:0};
      return { floor:f, sides:Object.keys(facade).filter(side=>facade[side]>0),
        contactLengthMm:Object.values(facade).reduce((sum,n)=>sum+n,0)*RULES.cell };
    });
    const stairArea = stair ? areas.get(`0:${stair.id}`) : null;
    const referenceLengthMm = stairArea ? Math.max(stairArea.maxX-stairArea.minX+1, stairArea.maxY-stairArea.minY+1)*RULES.cell : RULES.cell;
    const stairDaylight = { potential:stairFloors.every(f=>f.contactLengthMm>0),
      floors:stairFloors, referenceLengthMm, evaluation:'exterior-contact-only', windowVerified:false };
    const stairDaylightPenalty = stairFloors.reduce((sum,f)=>sum+1-Math.min(1,f.contactLengthMm/referenceLengthMm),0)/2;
    // Balance stair facade use against the remaining exterior contact of primary rooms.
    let facadeCompetition = 0;
    for (const a of areas.values()) {
      if (![ID['客厅'],ID['卧室']].includes(spaces[a.sid].label)) continue;
      const facade=exteriorFaces.get(`${a.floor}:${a.sid}`);
      const frontage=Object.values(facade).reduce((sum,n)=>sum+n,0);
      facadeCompetition += Math.max(0, .6-frontage/Math.sqrt(a.count));
    }
    const edges = [...contacts.values()];
    const hasPair = (f, a, b) => edges.some(e => e.floor === f &&
      ((spaces[e.a].label === ID[a] && spaces[e.b].label === ID[b]) || (spaces[e.a].label === ID[b] && spaces[e.b].label === ID[a])));
    const relationReports = [];
    for (let f = 0; f < 2; f++) for (const [a, b, weight] of RELATIONS) {
      if (!areas.size || !floors[f].includes(ID[a]) || !floors[f].includes(ID[b])) continue;
      const met = hasPair(f, a, b); if (!met) adjacencyPenalty += weight;
      relationReports.push({ floor: f, a, b, met });
    }
    let wetOverlap = 0, wet0 = 0, wet1 = 0;
    for (let i = 0; i < slab; i++) {
      const a = floors[0][i] === ID['卫生间'], b = floors[1][i] === ID['卫生间'];
      wet0 += a; wet1 += b; wetOverlap += a && b;
    }
    const wetAlignment = wetOverlap / Math.max(1, Math.min(wet0, wet1));
    // Open spaces form the circulation network. Independent rooms attach to that
    // network, rather than becoming bridges in a generic adjacency spanning tree.
    function portalFace(e){
      if(!candidate.organizationPolicy)return e.faces[Math.floor(e.faces.length/2)];
      const groups=new Map();
      for(const face of e.faces){const key=`${face.axis}:${face.axis==='x'?face.x:face.y}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(face);}
      for(const faces of groups.values()){
        const position=face=>face.axis==='x'?face.y:face.x;faces.sort((a,b)=>position(a)-position(b));
        const face=faces.find((face,k)=>k>0&&k+1<faces.length&&position(faces[k-1])+1===position(face)&&position(face)+1===position(faces[k+1]));
        if(face)return face;
      }
      return null;
    }
    function portal(e, kind) {
      const face = portalFace(e);
      return { a: e.a, b: e.b, floor: e.floor, ...face, kind };
    }
    const doors = edges.filter(e => portalFace(e)&&isTransit(spaces[e.a].label) && isTransit(spaces[e.b].label))
      .map(e => portal(e, OPEN_LABELS.includes(spaces[e.a].label) && OPEN_LABELS.includes(spaces[e.b].label) ? 'open' : 'access'));
    const circulation = validateCirculation({ spaces, connections: doors });
    const accessibleTransit = new Set(circulation.transit || []);
    for (const room of spaces) {
      if (isTransit(room.label)) continue;
      const adjacent = edges.filter(e => e.a === room.id || e.b === room.id);
      const opposite = e => e.a === room.id ? e.b : e.a;
      let options;
      if (room.label === ID['阳台']) {
        options = adjacent.filter(e => [...OPEN_LABELS,ID['卧室']].includes(spaces[opposite(e)].label));
      } else options = adjacent.filter(e => accessibleTransit.has(opposite(e))&&!(room.label===ID['卧室']&&spaces[opposite(e)].label===ID['楼梯间']));
      const preference = e => {
        const label = spaces[opposite(e)].label;
        if(room.label===ID['阳台']){
          const types=['entryway','living_room','dining_room','kitchen','bedroom','bathroom','corridor','stairs','utility','balcony','multi_purpose'];
          return -(room.balconyContactCounts?.[types[label]]||0);
        }
        if (room.label===ID['厨房'] && label===ID['餐厅']) return 0;
        return OPEN_LABELS.includes(label) ? 1 : label===ID['过道'] ? 2 : 3;
      };
      options=options.filter(e=>portalFace(e));
      options.sort((a,b) => preference(a)-preference(b) || b.faces.length - a.faces.length || a.a - b.a || a.b - b.b);
      if (options.length) doors.push(portal(options[0], 'door'));
    }
    const organization=candidate.organizationPolicy?(candidate.organization||Organization.evaluate(candidate)):null;
    if(organization){
      candidate.organization=organization;
      const balconyDoors=doors.filter(e=>spaces[e.a].label===ID['阳台']||spaces[e.b].label===ID['阳台']);
      doors.splice(0,doors.length,...organization.connections,...balconyDoors);
    }
    // A balcony lobby needs both its public approach and its balcony portal.
    // Use an actual continuous shared face rather than leaving a renamed dead end.
    for(const hall of spaces.filter(s=>s.generated&&s.key.includes(':shared-hall-'))){
      const incident=doors.filter(e=>e.a===hall.id||e.b===hall.id);
      if(incident.length!==1)continue;
      const face=edges.find(e=>(e.a===hall.id||e.b===hall.id)&&spaces[e.a===hall.id?e.b:e.a].label===ID['阳台']&&portalFace(e));
      if(face)doors.push(portal(face,'door'));
    }
    const kitchenDining=MealRouting.evaluate(candidate,doors);
    const access = validateCirculation({...candidate,floorSpaces:owners,spaces,connections:doors});
    // A proxy for through-traffic in open rooms: span between planned entry points
    // relative to room size, weighted by the number of destinations. No furniture
    // or real pedestrian simulation is implied by this preference.
    let openTraversal = 0;
    for (const a of areas.values()) {
      if (!OPEN_LABELS.includes(spaces[a.sid].label)) continue;
      const points = doors.filter(d => d.floor === a.floor && (d.a === a.sid || d.b === a.sid));
      if (points.length < 3) continue;
      const span = Math.max(...points.map(d=>d.x))-Math.min(...points.map(d=>d.x)) +
        Math.max(...points.map(d=>d.y))-Math.min(...points.map(d=>d.y));
      openTraversal += span / (nx + ny) * (points.length - 2);
    }
    const corridorFraction = [...areas.values()].filter(a=>spaces[a.sid].label===ID['过道']).reduce((sum,a)=>sum+a.count,0)/(slab*2);
    const openFraction = [...areas.values()].filter(a=>OPEN_LABELS.includes(spaces[a.sid].label)).reduce((sum,a)=>sum+a.count,0)/(slab*2);
    const traffic=organization?(organization.publicTrafficArea+organization.corridorArea)/(slab*.09*2):corridorFraction;
    const routeCost=organization?organization.meanRouteLength/(Math.sqrt(slab)*.3):0;
    const score = areaPenalty * 40 + shapePenalty * 2 + exteriorPenalty * 20 +
      traffic * 35 + routeCost*12 + adjacencyPenalty * 2 + (1 - wetAlignment) * 5 + openTraversal * 2 + stairDaylightPenalty * 12 + facadeCompetition * 8 + kitchenDining.penalty;
    const functionalRelations=Functional.relations(candidate,doors);
    return { score:score+functionalRelations.penalty, reachable: access.accepted&&organization?.accepted!==false&&kitchenDining.accepted&&functionalRelations.accepted, access, doors, organization,kitchenDining,functionalRelations,areaReports: reports, relations: relationReports, wetAlignment,
      corridorFraction, openFraction, openTraversal, stairDaylight,
      penalties: { area: areaPenalty, shape: shapePenalty, exterior: exteriorPenalty,
        circulation: traffic,routeLength:routeCost, adjacency: adjacencyPenalty, openTraversal,
        stairDaylight: stairDaylightPenalty, facadeCompetition,kitchenDining:kitchenDining.penalty } };
  }

  function roomConnectivity(candidate) {
    const { nx, ny, owners, spaces } = candidate;
    for (let f = 0; f < 2; f++) {
      const map = owners[f], visited = new Uint8Array(map.length), counts = new Map();
      for (const sid of map) counts.set(sid, (counts.get(sid) || 0) + 1);
      for (const [sid, count] of counts) {
        const start = map.indexOf(sid), queue = [start]; visited[start] = 1;
        for (let head=0;head<queue.length;head++) for (const next of neighbors(queue[head],nx,ny,1)) {
          if (!visited[next] && map[next]===sid) { visited[next]=1;queue.push(next); }
        }
        if (queue.length!==count || count<2) return false;
      }
    }
    return spaces.every(s=>owners.some(map=>map.includes(s.id)));
  }

  function repairAccess(candidate) {
    let repairs = 0; const repairBudget = candidate.spaces.length;
    for (let attempt = 0; attempt < repairBudget; attempt++) {
      const quality = assessCandidate(candidate);
      if (quality.reachable) return { repairs, quality };
      const target = quality.access.inaccessible[0];
      const f = candidate.owners.findIndex(map=>map.includes(target));
      if (f < 0) return null;
      const map = candidate.owners[f], grid = candidate.floors[f], n = map.length;
      const accessible = new Set(quality.access.transit), distance = new Float64Array(n).fill(Infinity);
      const previous = new Int32Array(n).fill(-1), done = new Uint8Array(n);
      for (let i=0;i<n;i++) if (accessible.has(map[i])) distance[i]=0;
      let end = -1;
      // Dijkstra prefers short paths along existing room boundaries; it never
      // carves into stairs or balconies, and it cannot silently split a room.
      for (let step=0;step<n;step++) {
        let at=-1,best=Infinity;
        for (let i=0;i<n;i++) if (!done[i]&&distance[i]<best) {at=i;best=distance[i];}
        if (at<0) break;
        done[at]=1;
        if (neighbors(at,candidate.nx,candidate.ny,1).some(i=>map[i]===target)) {end=at;break;}
        for (const next of neighbors(at,candidate.nx,candidate.ny,1)) {
          if (done[next] || map[next]===target || [ID['楼梯间'],ID['阳台']].includes(grid[next])) continue;
          const edge=neighbors(next,candidate.nx,candidate.ny,1).some(i=>map[i]!==map[next]) ||
            next%candidate.nx===0 || next%candidate.nx===candidate.nx-1 || next<candidate.nx || next>=n-candidate.nx;
          const cost=isTransit(grid[next])?.01:edge?1:4;
          if (best+cost<distance[next]) {distance[next]=best+cost;previous[next]=at;}
        }
      }
      if (end<0) return null;
      const path=[];
      for (let at=end;at>=0&&!accessible.has(map[at]);at=previous[at]) path.push(at);
      if (!path.length) return null;
      const saved=path.map(i=>[i,grid[i],map[i]]), sid=candidate.spaces.length;
      candidate.spaces.push({id:sid,label:ID['过道'],key:`${f}:repair-corridor-${repairs}`});
      for (const i of path) {grid[i]=ID['过道'];map[i]=sid;}
      if (!roomConnectivity(candidate)) {
        for (const [i,label,owner] of saved) {grid[i]=label;map[i]=owner;}
        candidate.spaces.pop();return null;
      }
      repairs++;
    }
    return null;
  }

  function neighbors(index, nx, ny, nz) {
    const slab = nx * ny, x = index % nx, y = Math.floor(index / nx) % ny;
    const z = Math.floor(index / slab), result = [];
    if (x > 0) result.push(index - 1);
    if (x + 1 < nx) result.push(index + 1);
    if (y > 0) result.push(index - nx);
    if (y + 1 < ny) result.push(index + nx);
    if (z > 0) result.push(index - slab);
    if (z + 1 < nz) result.push(index + slab);
    return result;
  }

  function validateLayout(model) {
    const { nx, ny, nz, cell, floorCount, floorHeight, voxels, spaceIds, spaces } = model;
    const checks = [
      { id: 'R1', name: '矩形体块满铺', passed: true, issues: [] },
      { id: 'R2', name: '功能边界符合300 mm模数', passed: true, issues: [] },
      { id: 'R3', name: '楼梯贯通上下两层', passed: true, issues: [] },
      { id: 'R4', name: '两层·每层3000 mm', passed: true, issues: [] },
      { id: 'R5', name: '300×300×300 mm三维网格', passed: true, issues: [] },
      { id: 'R6', name: '独立空间面连通·无游离体素', passed: true, issues: [] }
    ];
    function fail(rule, message) {
      const check = checks[rule - 1]; check.passed = false; check.issues.push(message);
    }
    const dimensionsValid = [nx, ny, nz].every(n => Number.isInteger(n) && n > 0);
    if (!dimensionsValid || cell !== RULES.cell) fail(2, '尺寸必须由整数个300 mm网格组成');
    if (floorCount !== 2 || floorHeight !== 3000 || nz !== TOTAL_CELLS) fail(4, '必须为两层，每层10格，总高6000 mm');
    if (cell !== 300 || nz !== TOTAL_CELLS) fail(5, '基本单元必须为300 mm立方体，总高度20格');
    const total = nx * ny * nz;
    if (!dimensionsValid || !voxels || !spaceIds || !Array.isArray(spaces) ||
        voxels.length !== total || spaceIds.length !== total) {
      fail(1, '体素数组和空间归属必须完整覆盖矩形体量');
      fail(3, '网格不完整，无法验证楼梯'); fail(6, '网格不完整，无法验证空间连通');
      return { accepted: false, checks };
    }
    const counts = new Map(), starts = new Map();
    let validOwnership = true;
    for (let i = 0; i < total; i++) {
      const label = voxels[i], sid = spaceIds[i], owner = spaces[sid];
      if (!Number.isInteger(label) || label < 0 || label >= LABELS.length ||
          !Number.isInteger(sid) || !owner || owner.id !== sid || owner.label !== label) {
        validOwnership = false; continue;
      }
      counts.set(sid, (counts.get(sid) || 0) + 1);
      if (!starts.has(sid)) starts.set(sid, i);
    }
    if (!validOwnership) fail(1, '存在空白、无效功能或不一致的空间归属');

    const visited = new Uint8Array(total);
    for (const owner of spaces) {
      if (!owner || !starts.has(owner.id)) { fail(6, '存在未分配体素的空间'); continue; }
      const queue = [starts.get(owner.id)]; visited[queue[0]] = 1;
      for (let head = 0; head < queue.length; head++) {
        for (const next of neighbors(queue[head], nx, ny, nz)) {
          if (!visited[next] && spaceIds[next] === owner.id) { visited[next] = 1; queue.push(next); }
        }
      }
      if (queue.length !== counts.get(owner.id) || queue.length < 2) {
        fail(6, `${owner.key}存在断开的空间碎片或孤立体素`);
      }
    }
    // All stair-labelled voxels, across BOTH floors, must form one six-face component.
    const stairs = [];
    for (let i = 0; i < total; i++) if (voxels[i] === ID['楼梯间']) stairs.push(i);
    if (!stairs.length) fail(3, '缺少楼梯功能空间');
    else {
      const seen = new Uint8Array(total), queue = [stairs[0]]; seen[stairs[0]] = 1;
      for (let head = 0; head < queue.length; head++) {
        for (const next of neighbors(queue[head], nx, ny, nz)) {
          if (!seen[next] && voxels[next] === ID['楼梯间']) { seen[next] = 1; queue.push(next); }
        }
      }
      const slab = nx * ny;
      if (queue.length !== stairs.length || !stairs.some(i => i < slab * FLOOR_CELLS) ||
          !stairs.some(i => i >= slab * FLOOR_CELLS) ||
          !stairs.some(i => i < slab) || !stairs.some(i => i >= slab * (TOTAL_CELLS - 1))) {
        fail(3, '楼梯必须面连通，并连续覆盖两层高度');
      }
    }
    return { accepted: checks.every(check => check.passed), checks };
  }

  function createRoomProgram(bedrooms = 2, bathrooms = 2, balconyCounts = [1,1], floorOptions = {}) {
    if (!Number.isInteger(bedrooms) || bedrooms < 1 || bedrooms > 8 || !Number.isInteger(bathrooms) || bathrooms < 0 || bathrooms > 8)
      throw new Error('卧室数量须为1–8，卫生间数量须为0–8。');
    const rooms = [];
    const bedrooms0=floorOptions.bedrooms0??0,living1=floorOptions.living1??0,utility1=floorOptions.utility1??0;
    if(!Number.isInteger(bedrooms0)||bedrooms0<0||bedrooms0>bedrooms)throw Error('一层卧室数量须为0至卧室总数；二层采用剩余数量。');
    if(![living1,utility1].every(n=>Number.isInteger(n)&&n>=0&&n<=1))throw Error('二层客厅和家政用房须为0或1间。');
    if(!Array.isArray(balconyCounts)||balconyCounts.length!==2||balconyCounts.some(n=>!Number.isInteger(n)||n<0||n>4))throw Error('每层阳台数量须为0–4');
    const add = (key, label, floor, targetArea, minArea, minWidth) => rooms.push({key,label:ID[label],floor,targetArea,minArea,minWidth});
    add('entry','玄关',0,3,1.8,.9); add('living','客厅',0,30,12,2.4);
    add('dining','餐厅',0,20,8,1.8); add('kitchen','厨房',0,12,5,1.5);
    add('utility','家政空间',0,5,2,1.2);rooms.at(-1).functionalRole=floorOptions.utilityRole0||'service';
    add('multi','多功能室',1,25,8,1.8);
    if(living1)add('living-1','客厅',1,25,12,2.4);
    if(utility1){add('utility-1','家政空间',1,5,2,1.2);rooms.at(-1).functionalRole=floorOptions.utilityRole1||'laundry';}
    for(let f=0;f<2;f++)for(let i=0;i<balconyCounts[f];i++)add(i===0?`balcony-${f}`:`balcony-${f}-${i+1}`,'阳台',f,6,2,.9);
    for(let i=0;i<bedrooms;i++) add(`bedroom-${i+1}`,'卧室',i<bedrooms0?0:1,16,9,BEDROOM_RULES.minWidth);
    for(let i=0;i<bathrooms;i++) add(`bathroom-${i+1}`,'卫生间',i%2,5,3,1.2);
    return rooms;
  }

  function spaceShapeMetrics(map,nx,sid) {
    const ny=map.length/nx,at=(x,y)=>x>=0&&y>=0&&x<nx&&y<ny&&map[y*nx+x]===sid;
    let convex=0,concave=0,pinch=false,count=0;
    for(const owner of map)count+=owner===sid;
    for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++) {
      const a=at(x-1,y-1),b=at(x,y-1),c=at(x,y),d=at(x-1,y),n=Number(a)+Number(b)+Number(c)+Number(d);
      if(n===1)convex++;if(n===3)concave++;
      if(n===2&&a===c&&b===d)pinch=true;
    }
    const shape=count&&!pinch&&convex-concave===4?(concave===0?'rectangle':concave===1?'L':'complex'):'complex';
    return {shape,convexCorners:convex,concaveCorners:concave,pinch};
  }
  function classifySpaceShape(map,nx,sid){return spaceShapeMetrics(map,nx,sid).shape;}

  function corridorCoverage(grid,nx,width) {
    const ny=grid.length/nx,stride=nx+1,prefix=new Int32Array((nx+1)*(ny+1)),covered=new Uint8Array(grid.length);
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)prefix[(y+1)*stride+x+1]=prefix[y*stride+x+1]+prefix[(y+1)*stride+x]-prefix[y*stride+x]+(!isTransit(grid[y*nx+x]));
    for(let y=0;y<=ny-width;y++)for(let x=0;x<=nx-width;x++) {
      const bad=prefix[(y+width)*stride+x+width]-prefix[y*stride+x+width]-prefix[(y+width)*stride+x]+prefix[y*stride+x];
      if(!bad)for(let yy=y;yy<y+width;yy++)for(let xx=x;xx<x+width;xx++)covered[yy*nx+xx]=1;
    }
    return covered;
  }

  function hasRoomHole(map,nx,sid){
    const ny=map.length/nx,seen=new Uint8Array(map.length),queue=[];
    for(let i=0;i<map.length;i++)if(map[i]!==sid&&(i<nx||i>=map.length-nx||i%nx===0||i%nx===nx-1)){seen[i]=1;queue.push(i);}
    for(let h=0;h<queue.length;h++)for(const j of neighbors(queue[h],nx,ny,1))if(!seen[j]&&map[j]!==sid){seen[j]=1;queue.push(j);}
    return Array.from(map).some((owner,i)=>owner!==sid&&!seen[i]);
  }

  function validateProgram(model, program) {
    const maps=model.floorSpaces||model.owners;
    const issues=[], reports=[];
    for(const room of program) {
      const matching=model.spaces.filter(s=>s.key===room.key && s.label===room.label);
      if(matching.length!==1) {issues.push(`${room.key}数量或功能不符`);continue;}
      const sid=matching[0].id, cells=[];
      for(let f=0;f<2;f++) for(let i=0;i<maps[f].length;i++) if(maps[f][i]===sid) {
        if(f!==room.floor) issues.push(`${room.key}楼层不符`);
        cells.push(i);
      }
      const xs=cells.map(i=>i%model.nx),ys=cells.map(i=>Math.floor(i/model.nx));
      const w=Math.max(...xs)-Math.min(...xs)+1,h=Math.max(...ys)-Math.min(...ys)+1;
      let minRun=Infinity;
      const map=maps[room.floor];
      for(let axis=0;axis<2;axis++) {
        const lines=axis===0?map.length/model.nx:model.nx, span=axis===0?model.nx:map.length/model.nx;
        for(let line=0;line<lines;line++) {
          let run=0;
          for(let step=0;step<=span;step++) {
            const at=axis===0?line*model.nx+step:step*model.nx+line;
            if(step<span&&map[at]===sid)run++;
            else if(run){minRun=Math.min(minRun,run);run=0;}
          }
        }
      }
      const area=cells.length*.09, width=minRun*.3;
      const aspectRatio=Math.max(w,h)/Math.min(w,h);
      if(!Functional.fits({...room,resourceMaxArea:undefined},w,h,area))issues.push(`${room.key}未满足全功能尺寸限制`);
      const maxArea=Number.isFinite(room.resourceMaxArea)?Math.min(room.resourceMaxArea,room.key==='entry'?entryMaxArea(room,map.length*.09):Infinity):room.key==='entry'?entryMaxArea(room,map.length*.09):undefined;
      if(room.key==='entry'&&maxArea!==undefined&&area>maxArea+1e-8)issues.push(`${room.key}玄关面积不得超过${maxArea.toFixed(2)}㎡`);
      if(Number.isFinite(room.resourceMaxArea)&&area>room.resourceMaxArea+1e-8)issues.push(`${room.key}超过联合面积容量${room.resourceMaxArea.toFixed(2)}㎡（实际${area.toFixed(2)}㎡，超出${(area-room.resourceMaxArea).toFixed(2)}㎡）`);
      if(room.label===ID['卧室']&&(width+1e-8<BEDROOM_RULES.minWidth||aspectRatio>BEDROOM_RULES.maxAspect+1e-8))issues.push(`${room.key}卧室短边须至少2.4 m且长宽比不超过1.8`);
      // A bounding box alone cannot prove usable width after carving an open room.
      const minimumFailures=[];
      if(cells.length!==w*h && !OPEN_LABELS.includes(room.label))minimumFailures.push('须保持完整矩形');
      if(area+1e-8<(room.resourceMinArea??room.minArea))minimumFailures.push(`面积${area.toFixed(2)}㎡，至少需要${(room.resourceMinArea??room.minArea).toFixed(2)}㎡`);
      if(width+1e-8<room.minWidth)minimumFailures.push(`局部宽度${width.toFixed(2)}m，至少需要${room.minWidth.toFixed(2)}m`);
      if(minimumFailures.length)issues.push(`${room.key}未满足最小面积或宽度（${minimumFailures.join('；')}）`);
      const shape=cells.length===w*h?'rectangle':classifySpaceShape(map,model.nx,sid);
      const shapeMetrics=spaceShapeMetrics(map,model.nx,sid);
      if(model.publicShapePolicy&&OPEN_LABELS.includes(room.label)){
        if(shapeMetrics.pinch||shapeMetrics.concaveCorners>2)issues.push(`${room.key}公共空间最多允许两处凹角，不能多处分叉`);
        if(room.key==='entry'&&width+1e-8<1.2)issues.push('entry玄关局部宽度须至少1.2 m');
      }
      if(model.publicShapePolicy==='rect-or-L'&&OPEN_LABELS.includes(room.label)&&!['rectangle','L'].includes(shape))issues.push(`${room.key}必须为矩形或L型，不能有孔洞或多处分叉`);
      if(model.publicShapePolicy==='activity-verified'&&OPEN_LABELS.includes(room.label)&&hasRoomHole(map,model.nx,sid))issues.push(`${room.key}不能包围孔洞`);
      if(room.label===ID['阳台']&&!cells.some(i=>i%model.nx===0||i%model.nx===model.nx-1||i<model.nx||i>=map.length-model.nx))issues.push(`${room.key}须接建筑外边界`);
      reports.push({key:room.key,spaceId:sid,floor:room.floor,area,maxArea,width,shape,shapeMetrics,boundingBoxFill:cells.length/(w*h),aspectRatio,targetArea:room.targetArea,preferredAreaMin:room.preferredAreaMin,preferredAreaMax:room.preferredAreaMax,areaSource:room.areaSource,areaBudgetRevision:room.areaBudgetRevision,resourceMaxArea:room.resourceMaxArea,predictedArea:room.predictedArea});
    }
    const resourceGroups=[];
    for(const room of program.filter(r=>r.resourceGroupKey))if(!resourceGroups.some(g=>g.floor===room.floor&&g.key===room.resourceGroupKey)){
      const members=program.filter(r=>r.floor===room.floor&&r.resourceGroupKey===room.resourceGroupKey),area=reports.filter(r=>members.some(m=>m.key===r.key)).reduce((s,r)=>s+r.area,0),maximum=room.resourceGroupMaxArea;
      resourceGroups.push({floor:room.floor,key:room.resourceGroupKey,area,maximum,accepted:area<=maximum+1e-8});
      if(area>maximum+1e-8)issues.push(`${room.floor+1}层${room.resourceGroupKey}超过联合面积容量${maximum.toFixed(2)}㎡（实际${area.toFixed(2)}㎡，超出${(area-maximum).toFixed(2)}㎡）`);
    }
    if(model.mealPolicy)issues.push(...MealGeometry.evaluate(model).issues);
    if(model.daylightPolicy)issues.push(...BedroomDaylight.evaluate(model).issues);
    const corridors=[],coverage=new Map();
    for(const s of model.spaces.filter(s=>s.label!==ID['楼梯间']&&!program.some(r=>r.key===s.key))) {
      if(!model.publicShapePolicy||s.label!==ID['过道']||!s.generated||![0,1].includes(s.floor)){issues.push('存在清单外房间');continue;}
      const width=Math.round(model.corridorWidth/.3);
      if(!Number.isFinite(model.corridorWidth)||model.corridorWidth<.6||model.corridorWidth>3||Math.abs(width*.3-model.corridorWidth)>1e-8){issues.push('走道通行带宽参数无效');continue;}
      if(!coverage.has(s.floor))coverage.set(s.floor,corridorCoverage(maps[s.floor].map(sid=>model.spaces[sid]?.label??-1),model.nx,width));
      const covered=coverage.get(s.floor);
      const cells=Array.from(maps[s.floor]).flatMap((sid,i)=>sid===s.id?[i]:[]);
      if(!cells.length||maps[1-s.floor].includes(s.id)||cells.some(i=>!covered[i]))issues.push(`${s.key}未满足走道通行带宽或楼层要求`);
      corridors.push({key:s.key,spaceId:s.id,floor:s.floor,area:cells.length*.09,width:model.corridorWidth});
    }
    const corridorBudgets=[0,1].map(floor=>{
      const limitFraction=program.find(r=>r.floor===floor)?.corridorLimitFraction??.12;
      const area=corridors.filter(r=>r.floor===floor).reduce((s,r)=>s+r.area,0),limit=model.nx*(maps[floor].length/model.nx)*.09*limitFraction;
      return {floor,area,limit,limitFraction,accepted:true,withinPreference:area<=limit+1e-8,excessArea:Math.max(0,area-limit),policy:'soft-p75-preference'};
    });
    return {accepted:issues.length===0,issues,reports,corridors,corridorBudgets,resourceGroups};
  }

  function programCandidate(nx,ny,seed,plan,index,program) {
    const r=rng((seed+Math.imul(index+1,0x9E3779B9))>>>0);
    const spine=Math.max(6,Math.round(nx*((plan?{narrow:.20,standard:.26,wide:.32}[plan.coreWidth]:.20)+r()*.08)));
    const left=Math.round((nx-spine)*(.42+r()*.16)),right=nx-left-spine;
    const stairH=Math.max(6,Math.round(ny*(.17+r()*.06)));
    const mirror=plan?plan.publicSide==='right':r()<.5;
    const back=plan?plan.balconyEnd==='back':r()<.5;
    const floors=[],owners=[],spaces=[];
    const stairId=0;spaces.push({id:0,label:ID['楼梯间'],key:'stairs'});
    const paint=(f,x,y,w,h,room)=>{
      let sid=spaces.find(s=>s.key===room.key)?.id;
      if(sid===undefined) {sid=spaces.length;spaces.push({id:sid,...room});}
      for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++) {
        const at=(back?ny-1-yy:yy)*nx+(mirror?nx-1-xx:xx);
        floors[f][at]=room.label;owners[f][at]=sid;
      }
    };
    // Recursively split each side strip by room weights. Every leaf touches the shared open room.
    const split=(f,x,y,w,h,rooms)=>{
      if(!rooms.length)return false;
      const need=room=>Math.max(Math.ceil(room.minWidth/.3-1e-9),Math.ceil(room.minArea/(w*.09)-1e-9));
      if(w<Math.max(...rooms.map(room=>Math.ceil(room.minWidth/.3-1e-9))) || rooms.reduce((sum,room)=>sum+need(room),0)>h)return false;
      if(rooms.length===1){paint(f,x,y,w,h,rooms[0]);return true;}
      const half=Math.ceil(rooms.length/2),a=rooms.slice(0,half),b=rooms.slice(half);
      const sum=rs=>rs.reduce((s,room)=>s+room.targetArea,0);
      const cut=Math.max(a.reduce((s,room)=>s+need(room),0),Math.min(h-b.reduce((s,room)=>s+need(room),0),Math.round(h*sum(a)/sum(rooms))));
      return split(f,x,y,w,cut,a)&&split(f,x,y+cut,w,h-cut,b);
    };
    for(let f=0;f<2;f++) {
      floors.push(new Int16Array(nx*ny).fill(-1));owners.push(new Int32Array(nx*ny).fill(-1));
      const rooms=program.filter(room=>room.floor===f),open=rooms.find(room=>room.key===(f===0?'dining':'multi'));
      paint(f,left,0,spine,stairH,{key:'stairs',label:ID['楼梯间']});
      paint(f,left,stairH,spine,ny-stairH,open);
      let a,b;
      if(f===0) {
        a=['balcony-0','living','entry'].map(key=>rooms.find(room=>room.key===key)).filter(Boolean);
        b=rooms.filter(room=>!a.includes(room)&&room!==open);
        if(plan?.bathroomSide==='public') {const baths=b.filter(room=>room.label===ID['卫生间']);b=b.filter(room=>!baths.includes(room));a.splice(2,0,...baths);}
      } else {
        const bedrooms=rooms.filter(room=>room.label===ID['卧室']);
        a=[rooms.find(room=>room.key==='balcony-1'),bedrooms[0]].filter(Boolean);b=[];
        const rest=rooms.filter(room=>room!==open&&!a.includes(room));
        for(let i=rest.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[rest[i],rest[j]]=[rest[j],rest[i]];}
        for(const room of rest) {
          const sum=rs=>rs.reduce((s,item)=>s+item.targetArea,0);
          (sum(a)/left<sum(b)/right?a:b).push(room);
        }
        // Extend the same open-room identity onto an otherwise unused side.
        if(!b.length) {
          b.push(open);
        }
        if(plan?.upperRight==='multifunction_first' && !b.includes(open))b.unshift(open);
        if(plan?.upperRight==='bedroom_first')b.sort((u,v)=>(v.label===ID['卧室'])-(u.label===ID['卧室']));
      }
      if(!split(f,0,0,left,ny,a)||!split(f,left+spine,0,right,ny,b))return null;
    }
    return {nx,ny,floors,owners,spaces,geometry:{stairPlacement:'front-wall',mirror,back,stairX:left,stairY:0,stairW:spine,stairH}};
  }

  function routeAndFill(candidate,program) {
    const {nx,ny,spaces,floors,owners}=candidate,width=Math.round(candidate.corridorWidth/.3);
    candidate.routingEvidence=[];
    for(let f=0;f<2;f++) {
      const grid=floors[f],map=owners[f],claimed=new Uint8Array(grid.length);
      const canAbsorb=(room,count)=>{
        const area=Array.from(map).filter(sid=>sid===room.id).length*.09+count*.09;
        if(area>(room.resourceMaxArea??Infinity)+1e-8)return false;
        if(room.resourceGroupKey){
          const members=new Set(program.filter(r=>r.floor===f&&r.resourceGroupKey===room.resourceGroupKey).map(r=>spaces.find(s=>s.key===r.key)?.id));
          const groupArea=Array.from(map).filter(sid=>members.has(sid)).length*.09+count*.09;
          if(groupArea>room.resourceGroupMaxArea+1e-8)return false;
        }
        return true;
      };
      if(!Array.from(map).some(id=>id>=0&&spaces[id]?.label!==ID['楼梯间']))continue;
      const root=spaces.find(s=>s.key===(f===0?'entry':'1:stair-landing'))?.id;if(root===undefined)return false;
      const network=()=>{
        return publicNetwork(grid,map,nx,width,root);
      };
      const absorbUnused=()=>{
      // Absorb unused land into actual rooms. Unroutable pockets are never renamed corridors.
      for(let pass=0;pass<nx+ny;pass++) {
        let changed=false;
        const rooms=program.filter(room=>room.floor===f).map(room=>spaces.find(s=>s.key===room.key));
        rooms.sort((a,b)=>{
          const area=s=>Array.from(map).filter(sid=>sid===s.id).length*.09;
          const deficit=s=>(s.targetArea-area(s))/(s.areaBudgetRevision?Math.max(.09,s.targetArea-s.minArea):1);
          return deficit(a)-deficit(b);
        }).reverse();
        for(const room of rooms) {
          const cells=Array.from(map).flatMap((sid,i)=>sid===room.id?[i]:[]),xs=cells.map(i=>i%nx),ys=cells.map(i=>Math.floor(i/nx));
          const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
          if(cells.length!==(x1-x0+1)*(y1-y0+1))continue;
          const strips=[Array.from({length:x1-x0+1},(_,i)=>(y0-1)*nx+x0+i),Array.from({length:x1-x0+1},(_,i)=>(y1+1)*nx+x0+i),
            Array.from({length:y1-y0+1},(_,i)=>(y0+i)*nx+x0-1),Array.from({length:y1-y0+1},(_,i)=>(y0+i)*nx+x1+1)];
          const valid=[y0>0,y1+1<ny,x0>0,x1+1<nx];
          for(let d=0;d<4;d++)if(valid[d]&&strips[d].every(i=>map[i]<0&&!claimed[i])) {
            const newW=x1-x0+1+Number(d>=2),newH=y1-y0+1+Number(d<2);
            if(room.key==='entry'&&newW*newH*.09>entryMaxArea(room,nx*ny*.09)+1e-8)continue;
            if(room.label===ID['卧室']&&Math.max(newW,newH)/Math.min(newW,newH)>BEDROOM_RULES.maxAspect+1e-8)continue;
            if(candidate.mealPolicy&&!MealGeometry.fits(room,newW,newH))continue;
            if(!Functional.fits(room,newW,newH)||!canAbsorb(room,strips[d].length))continue;
            for(const i of strips[d]){map[i]=room.id;grid[i]=room.label;}changed=true;break;
          }
        }
        // An unused rectangular block may extend a public room, but only into a rectangle or L.
        const seen=new Uint8Array(map.length);
        for(let start=0;start<map.length;start++)if(map[start]<0&&!claimed[start]&&!seen[start]) {
          const block=[start];seen[start]=1;
          for(let head=0;head<block.length;head++)for(const next of neighbors(block[head],nx,ny,1))if(map[next]<0&&!claimed[next]&&!seen[next]){seen[next]=1;block.push(next);}
          const xs=block.map(i=>i%nx),ys=block.map(i=>Math.floor(i/nx));
          if(candidate.publicShapePolicy!=='activity-verified'&&block.length!==(Math.max(...xs)-Math.min(...xs)+1)*(Math.max(...ys)-Math.min(...ys)+1))continue;
          const recipients=rooms.filter(s=>OPEN_LABELS.includes(s.label));
          const marginal=room=>{const area=Array.from(map).filter(sid=>sid===room.id).length*.09;return areaDeviation(room,area+block.length*.09)-areaDeviation(room,area);};
          recipients.sort((a,b)=>marginal(a)-marginal(b));
          for(const room of recipients) {
            if(!block.some(i=>neighbors(i,nx,ny,1).some(j=>map[j]===room.id)))continue;
            if(room.key==='entry'&&Array.from(map).filter(sid=>sid===room.id).length*.09+block.length*.09>entryMaxArea(room,nx*ny*.09)+1e-8)continue;
            if(candidate.mealPolicy&&room.label===2&&Array.from(map).filter(sid=>sid===room.id).length*.09+block.length*.09>MealGeometry.maxArea(room)+1e-8)continue;
            if(!canAbsorb(room,block.length))continue;
            for(const i of block)map[i]=room.id;
            const shape=classifySpaceShape(map,nx,room.id);
            if(room.key==='living-1'?shape==='rectangle':['rectangle','L'].includes(shape)||candidate.publicShapePolicy==='activity-verified'&&!hasRoomHole(map,nx,room.id)) {
              for(const i of block)grid[i]=room.label;changed=true;break;
            }
            for(const i of block)map[i]=-1;
          }
          // A real shared hall must have continuous width and connect distinct
          // spaces. Isolated leftover pockets still cannot be renamed corridors.
          if(block.every(i=>map[i]<0)&&program.some(r=>r.functionalRevision===Functional.REVISION)){
            const w=Math.max(...xs)-Math.min(...xs)+1,h=Math.max(...ys)-Math.min(...ys)+1;
            const adjacentIds=new Set(block.flatMap(i=>neighbors(i,nx,ny,1).map(j=>map[j])).filter(id=>id>=0&&spaces[id].label!==7));
            if(block.length===w*h&&Math.min(w,h)>=width&&block.length*.09<=nx*ny*.09*.18&&adjacentIds.size>=2&&[...adjacentIds].some(id=>isTransit(spaces[id].label))){
              const sid=spaces.length;spaces.push({id:sid,key:`${f}:shared-hall-${sid}`,label:6,floor:f,generated:true});
              for(const i of block){map[i]=sid;grid[i]=6;}changed=true;
            }
          }
        }
        if(!changed)break;
      }
      };
      absorbUnused();
      const targets=[...new Set([0,...map])].filter(sid=>sid>=0&&spaces[sid].label!==ID['阳台']&&map.includes(sid));
      const evidence={floor:f,publicAdjustedBeforeRouting:true,repairs:[]};candidate.routingEvidence.push(evidence);
      for(const sid of targets) {
        const connected=network(),touches=(target)=>Array.from(map).some((owner,i)=>owner===target&&(connected[i]||neighbors(i,nx,ny,1).some(j=>connected[j]&&!(spaces[target].label===ID['卧室']&&grid[j]===ID['楼梯间']))));
        if(touches(sid))continue;
        if(spaces[sid].label===ID['家政空间']) {
          const kitchen=spaces.find(s=>s.key==='kitchen');
          if(kitchen&&touches(kitchen.id)&&Array.from(map).some((owner,i)=>owner===sid&&neighbors(i,nx,ny,1).some(j=>map[j]===kitchen.id)))continue;
        }
        const allowed=new Uint8Array(grid.length),previous=new Int32Array(grid.length).fill(-2),queue=[];
        for(let y=0;y<=ny-width;y++)for(let x=0;x<=nx-width;x++) {
          let valid=true,source=false;
          for(let yy=y;yy<y+width&&valid;yy++)for(let xx=x;xx<x+width;xx++) {
            const at=yy*nx+xx;
            if(grid[at]>=0&&(!isTransit(grid[at])||spaces[sid].label===ID['卧室']&&grid[at]===ID['楼梯间'])){valid=false;break;}
            source ||= !!connected[at];
          }
          const at=y*nx+x;allowed[at]=Number(valid);
          if(valid&&source){previous[at]=-1;queue.push(at);}
        }
        let end=-1;
        for(let head=0;head<queue.length;head++) {
          const at=queue[head],x=at%nx,y=Math.floor(at/nx);
          let target=false;
          for(let d=0;d<width;d++)target ||= (x>0&&map[(y+d)*nx+x-1]===sid)||(x+width<nx&&map[(y+d)*nx+x+width]===sid)||
            (y>0&&map[(y-1)*nx+x+d]===sid)||(y+width<ny&&map[(y+width)*nx+x+d]===sid)||map[(y+d)*nx+x]===sid;
          if(target){end=at;break;}
          for(const next of neighbors(at,nx,ny,1))if(allowed[next]&&previous[next]===-2){previous[next]=at;queue.push(next);}
        }
        if(end<0)return false;
        const before=claimed.reduce((s,n)=>s+n,0);
        for(let at=end;at>=0;at=previous[at]) {
          const x=at%nx,y=Math.floor(at/nx);
          for(let yy=y;yy<y+width;yy++)for(let xx=x;xx<x+width;xx++) {
            const i=yy*nx+xx;if(map[i]<0){claimed[i]=1;grid[i]=ID['过道'];}
          }
        }
        const added=claimed.reduce((s,n)=>s+n,0)-before;
        if(added)evidence.repairs.push({target:spaces[sid].key,addedArea:added*.09,reason:'not-accessible-from-width-checked-public-network'});
      }
      absorbUnused();
      if(Array.from(map).some((sid,i)=>sid<0&&!claimed[i]))return false;
      let number=0;
      for(let i=0;i<map.length;i++)if(claimed[i]&&map[i]<0) {
        const id=spaces.length;spaces.push({id,key:`${f}:corridor-${++number}`,label:ID['过道'],floor:f,generated:true});
        const queue=[i];map[i]=id;
        for(let head=0;head<queue.length;head++)for(const next of neighbors(queue[head],nx,ny,1))if(claimed[next]&&map[next]<0){map[next]=id;queue.push(next);}
      }
    }
    return true;
  }

  function publicNetwork(grid,map,nx,width,root){
    const ny=grid.length/nx,allowed=new Uint8Array(grid.length),seen=new Uint8Array(grid.length),covered=new Uint8Array(grid.length),queue=[];
    for(let y=0;y<=ny-width;y++)for(let x=0;x<=nx-width;x++){
      let valid=true,source=false;
      for(let yy=y;yy<y+width&&valid;yy++)for(let xx=x;xx<x+width;xx++){
        const i=yy*nx+xx;if(!isTransit(grid[i])){valid=false;break;}source ||= map[i]===root;
      }
      const i=y*nx+x;allowed[i]=Number(valid);if(valid&&source){seen[i]=1;queue.push(i);}
    }
    for(let head=0;head<queue.length;head++){
      const i=queue[head],x=i%nx,y=Math.floor(i/nx);
      for(let yy=y;yy<y+width;yy++)for(let xx=x;xx<x+width;xx++)covered[yy*nx+xx]=1;
      for(const next of neighbors(i,nx,ny,1))if(allowed[next]&&!seen[next]){seen[next]=1;queue.push(next);}
    }
    return covered;
  }

  function repairOrganization(candidate,program,diagnostics){
    candidate.organization=Organization.evaluate(candidate);
    if(candidate.organization.accepted)return candidate;
    if(diagnostics){diagnostics.rejectionChecks.activity++;
      if(diagnostics.examples.length<5)diagnostics.examples.push({stage:'activity-routing',issues:candidate.organization.issues});}
    if(candidate.organization.issues.some(issue=>issue.includes('无法容纳')))return null;
    let current=candidate;
    for(let depth=0;depth<2;depth++){
      const choices=[],width=Math.round(candidate.corridorWidth/.3);
      for(const room of program.filter(r=>[ID['卧室'],ID['厨房'],ID['卫生间'],ID['家政空间']].includes(r.label))){
        const sid=current.spaces.find(s=>s.key===room.key)?.id,map=current.owners[room.floor];
        const cells=Array.from(map).flatMap((owner,i)=>owner===sid?[i]:[]);
        const xs=cells.map(i=>i%current.nx),ys=cells.map(i=>Math.floor(i/current.nx));
        const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x+1,h=Math.max(...ys)-y+1;
        if(cells.length!==w*h)continue;
        for(const side of ['left','right','front','back']){
          const vertical=['left','right'].includes(side),rw=w-(vertical?width:0),rh=h-(vertical?0:width);
          if(Math.min(rw,rh)*.3<room.minWidth-1e-8||rw*rh*.09<room.minArea-1e-8||room.label===ID['卧室']&&Math.max(rw,rh)/Math.min(rw,rh)>BEDROOM_RULES.maxAspect)continue;
          const strip={x:side==='right'?x+w-width:x,y:side==='back'?y+h-width:y,w:vertical?width:w,h:vertical?h:width};
          const adjacentRooms=new Set();
          for(let yy=strip.y;yy<strip.y+strip.h;yy++)for(let xx=strip.x;xx<strip.x+strip.w;xx++)for(const j of neighbors(yy*current.nx+xx,current.nx,current.ny,1)){
            if(map[j]!==sid&&isTransit(current.spaces[map[j]]?.label))adjacentRooms.add(map[j]);
          }
          if(!adjacentRooms.size)continue;
          choices.push({room,strip,priority:adjacentRooms.size*10-strip.w*strip.h*.09});
        }
      }
      choices.sort((a,b)=>b.priority-a.priority);
      let best=null,bestCost=Infinity;
      for(const {room,strip} of choices.slice(0,10)){
        if(diagnostics)diagnostics.corridorTrials++;
        const trial={...current,spaces:current.spaces.map(s=>({...s})),floors:current.floors.map(g=>Int16Array.from(g)),owners:current.owners.map(g=>Int32Array.from(g)),routingEvidence:current.routingEvidence.map(e=>({...e,repairs:[...e.repairs]}))};
        const sid=trial.spaces.length;trial.spaces.push({id:sid,key:`${room.floor}:protected-corridor-${sid}`,floor:room.floor,label:ID['过道'],generated:true});
        for(let y=strip.y;y<strip.y+strip.h;y++)for(let x=strip.x;x<strip.x+strip.w;x++){trial.owners[room.floor][y*trial.nx+x]=sid;trial.floors[room.floor][y*trial.nx+x]=ID['过道'];}
        if(!validateProgram(trial,program).accepted)continue;
        trial.organization=Organization.evaluate(trial);
        const cost=trial.organization.unreachable.length*100+trial.organization.issues.filter(i=>i.includes('无法容纳')).length*100+trial.organization.corridorArea*.1+trial.organization.meanRouteLength;
        if(cost<bestCost&&trial.organization.unreachable.length<current.organization.unreachable.length){best=trial;bestCost=cost;
          trial.routingEvidence[room.floor].repairs.push({target:current.organization.unreachable.filter(t=>t.floor===room.floor).map(t=>t.key).join(', '),fromRoom:room.key,addedArea:strip.w*strip.h*.09,reason:'public-only-route-blocked-by-protected-activity; boundary-adjustment-restores-access'});}
      }
      if(!best)break;
      current=best;if(current.organization.accepted){if(diagnostics)diagnostics.corridorRepairs++;return current;}
    }
    return null;
  }

  // Public rooms have their own leaves; only verified circulation repairs become corridors.
  function rebalancePublic(candidate,program,preference,accepted){
    let current=candidate;
    for(let step=0;step<6;step++){
      const proposals=[];
      for(let floor=0;floor<2;floor++){
        const map=current.owners[floor],rooms=current.spaces.filter(s=>s.floor===floor&&(OPEN_LABELS.includes(s.label)||s.areaBudgetRevision)),areas=new Map(rooms.map(s=>[s.id,Array.from(map).filter(sid=>sid===s.id).length*.09]));
        for(const donor of rooms)for(const receiver of rooms)if(donor!==receiver){
          const faces=new Map();
          for(let i=0;i<map.length;i++)if(map[i]===donor.id)for(const j of neighbors(i,current.nx,current.ny,1))if(map[j]===receiver.id){
            const vertical=Math.abs(i-j)===1,direction=j-i,key=`${direction}:${vertical?i%current.nx:Math.floor(i/current.nx)}`;
            if(!faces.has(key))faces.set(key,[]);faces.get(key).push({i,direction,position:vertical?Math.floor(i/current.nx):i%current.nx});
          }
          for(const group of faces.values()){
            group.sort((a,b)=>a.position-b.position);let start=0;
            while(start<group.length){let end=start+1;while(end<group.length&&group[end].position===group[end-1].position+1)end++;
              const run=group.slice(start,end);start=end;if(run.length<3)continue;
              // A transferred wing must also be deep enough to remain a usable
              // part of the receiving room, rather than a thin renamed strip.
              for(const depth of [...new Set([1,3,Math.ceil(receiver.minWidth/.3),Math.ceil(receiver.minWidth/.3)+3])]){
                const cells=run.flatMap(face=>Array.from({length:depth},(_,k)=>{const i=face.i-k*face.direction;return Math.abs(face.direction)===1&&Math.floor(i/current.nx)!==Math.floor(face.i/current.nx)?-1:i;}));
                if(!cells.every(i=>i>=0&&i<map.length&&map[i]===donor.id))continue;
                const g=current.geometry;
                if(donor.key==='entry'&&cells.some(i=>i%current.nx>=g.entryX&&i%current.nx<g.entryX+g.entryW&&Math.floor(i/current.nx)>=(g.entryY||0)&&Math.floor(i/current.nx)<(g.entryY||0)+g.entryH))continue;
                const area=cells.length*.09,delta=areaDeviation(donor,areas.get(donor.id)-area)+areaDeviation(receiver,areas.get(receiver.id)+area)-areaDeviation(donor,areas.get(donor.id))-areaDeviation(receiver,areas.get(receiver.id));
                if(delta<-.001)proposals.push({floor,donor,receiver,cells,area,delta});
              }
            }
          }
        }
      }
      proposals.sort((a,b)=>a.delta-b.delta);let best=null,bestScore=preference(current);
      for(const move of proposals.slice(0,12)){
        const trial={...current,organization:null,owners:current.owners.map(g=>Int32Array.from(g)),floors:current.floors.map(g=>Int16Array.from(g)),geometry:{...current.geometry}};
        for(const i of move.cells){trial.owners[move.floor][i]=move.receiver.id;trial.floors[move.floor][i]=move.receiver.label;}
        if(!accepted(trial))continue;
        const score=preference(trial);
        if(score<bestScore){trial.geometry.publicAdjustments=[...(current.geometry.publicAdjustments||[]),{floor:move.floor,from:move.donor.key,to:move.receiver.key,area:move.area,beforeScore:preference(current),afterScore:score}];best=trial;bestScore=score;}
      }
      if(!best)break;current=best;
    }
    return current;
  }

  // Joint moves alter room envelopes and circulation together; never relabel an
  // isolated strip as a usable room. All accepted moves retain activity/access.
  function coordinateCirculation(candidate,program){
    const enabled=program.some(r=>r.circulationRevision===Traffic.REVISION);
    if(!enabled)return candidate;
    const clone=m=>({...m,floorSpaces:undefined,connections:undefined,organization:null,quality:null,owners:(m.owners||m.floorSpaces).map(g=>Int32Array.from(g)),floors:m.floors.map(g=>Int16Array.from(g)),spaces:m.spaces.map(s=>({...s})),geometry:{...(m.geometry||m.generation?.geometry)}});
    const compact=m=>{
      const used=new Set(m.owners.flatMap(g=>Array.from(g))),ids=new Map(),spaces=[];
      for(const s of m.spaces)if(used.has(s.id)||!s.generated){ids.set(s.id,spaces.length);spaces.push({...s,id:spaces.length});}
      m.spaces=spaces;m.owners=m.owners.map(g=>Int32Array.from(g,id=>ids.get(id)));return m;
    };
    const rectangle=(map,nx,id)=>{const cells=Array.from(map).flatMap((v,i)=>v===id?[i]:[]);if(!cells.length)return null;const xs=cells.map(i=>i%nx),ys=cells.map(i=>Math.floor(i/nx)),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x+1,h=Math.max(...ys)-y+1;return cells.length===w*h?{x,y,w,h,cells}:null;};
    const objective=m=>{const budget=Traffic.actualBudget(m,program),check=validateProgram(m,budget.program);return Traffic.evaluate(m,program).penalty+(budget.accepted?0:1000)+check.reports.reduce((s,r)=>s+areaDeviation(r,r.area)*2,0);};
    const feasible=m=>roomConnectivity(m)&&validateProgram(m,program).accepted&&validateAnchors(m).accepted&&assessCandidate(m).reachable;
    let current=clone(candidate);
    for(let step=0;step<8;step++){
      const proposals=[],before=objective(current);
      const add=(trial,move)=>{compact(trial);const score=objective(trial);if(score<before-.001)proposals.push({trial,move,score});};
      for(let floor=0;floor<2;floor++){
        const map=current.owners[floor],nx=current.nx,ny=map.length/nx;
        const traffic=current.spaces.filter(s=>s.floor===floor&&s.label===6&&s.key!=='1:stair-landing');
        for(const hall of traffic){
          const b=rectangle(map,nx,hall.id);if(!b)continue;
          const adjacent=[...new Set(b.cells.flatMap(i=>neighbors(i,nx,ny,1).map(j=>map[j])))].filter(id=>id!==hall.id&&program.some(r=>r.key===current.spaces[id]?.key));
          for(const receiver of adjacent){
            const s=current.spaces[receiver];
            // Remove the whole hall, or transfer a complete boundary band.
            const bands=[b,...[1,2,3,4,6].flatMap(d=>[{x:b.x,y:b.y,w:Math.min(d,b.w),h:b.h},{x:b.x+b.w-Math.min(d,b.w),y:b.y,w:Math.min(d,b.w),h:b.h},{x:b.x,y:b.y,w:b.w,h:Math.min(d,b.h)},{x:b.x,y:b.y+b.h-Math.min(d,b.h),w:b.w,h:Math.min(d,b.h)}])];
            for(const band of bands){const trial=clone(current);for(let y=band.y;y<band.y+band.h;y++)for(let x=band.x;x<band.x+band.w;x++){trial.owners[floor][y*nx+x]=receiver;trial.floors[floor][y*nx+x]=s.label;}add(trial,{type:'hall-to-room-boundary',floor,from:hall.key,to:s.key,area:band.w*band.h*.09});}
          }
        }
        // Translate a complete service/bedroom envelope into traffic space and
        // give its vacated edge to an adjacent public room in the SAME move.
        for(const room of program.filter(r=>r.floor===floor&&[4,5,8].includes(r.label))){
          const sid=current.spaces.find(s=>s.key===room.key)?.id,b=rectangle(map,nx,sid);if(!b)continue;
          for(const depth of [1,2,3,4,6,8])for(const [dx,dy] of [[depth,0],[-depth,0],[0,depth],[0,-depth]]){
            if(b.x+dx<0||b.y+dy<0||b.x+dx+b.w>nx||b.y+dy+b.h>ny)continue;
            const moved=[];for(let y=b.y+dy;y<b.y+dy+b.h;y++)for(let x=b.x+dx;x<b.x+dx+b.w;x++)moved.push(y*nx+x);
            const additions=moved.filter(i=>map[i]!==sid);if(!additions.length||additions.some(i=>current.spaces[map[i]]?.label!==6||current.spaces[map[i]]?.key==='1:stair-landing'))continue;
            const kept=new Set(moved),vacated=b.cells.filter(i=>!kept.has(i));
            const recipients=[...new Set(vacated.flatMap(i=>neighbors(i,nx,ny,1).map(j=>map[j])))].filter(id=>id!==sid&&[1,2,10].includes(current.spaces[id]?.label));
            for(const receiver of recipients){const trial=clone(current);for(const i of vacated){trial.owners[floor][i]=receiver;trial.floors[floor][i]=current.spaces[receiver].label;}for(const i of moved){trial.owners[floor][i]=sid;trial.floors[floor][i]=room.label;}add(trial,{type:'shift-room-and-reclaim-traffic',floor,room:room.key,shiftMm:[dx*300,dy*300],to:current.spaces[receiver].key,area:additions.length*.09});}
          }
        }
      }
      proposals.sort((a,b)=>a.score-b.score);let best=null;
      for(const p of proposals.slice(0,30))if(feasible(p.trial)){best=p;break;}
      if(!best)break;
      best.trial.geometry.circulationAdjustments=[...(current.geometry.circulationAdjustments||[]),{...best.move,beforeCost:before,afterCost:best.score}];current=best.trial;
    }
    current.geometry.circulationRevision=Traffic.REVISION;current.geometry.actualAreaCoordination=Traffic.actualBudget(current,program);delete current.geometry.actualAreaCoordination.program;current.traffic=Traffic.evaluate(current,program);return current;
  }

  function coordinateResources(candidate,program){
    if(!program.some(r=>r.areaBudgetRevision))return candidate;
    const score=m=>{
      const c=validateProgram(m,program);
      return c.issues.length*1000+c.reports.reduce((s,r)=>s+Math.max(0,r.area-(r.resourceMaxArea??Infinity))*200+areaDeviation(r,r.area)*20,0);
    };
    const clone=m=>({...m,organization:null,owners:m.owners.map(g=>Int32Array.from(g)),floors:m.floors.map(g=>Int16Array.from(g)),geometry:{...m.geometry}});
    const rect=(m,room)=>{
      const sid=m.spaces.find(s=>s.key===room.key)?.id,map=m.owners[room.floor],cells=Array.from(map).flatMap((s,i)=>s===sid?[i]:[]);
      if(!cells.length)return null;
      const xs=cells.map(i=>i%m.nx),ys=cells.map(i=>Math.floor(i/m.nx)),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x+1,h=Math.max(...ys)-y+1;
      return cells.length===w*h?{sid,x,y,w,h,cells}:null;
    };
    const indices=(m,r)=>{const a=[];for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++){if(x<0||y<0||x>=m.nx||y>=m.ny)return null;a.push(y*m.nx+x);}return a;};
    let current=candidate;
    for(let step=0;step<8;step++){
      const before=score(current),proposals=[];let best=null,bestScore=before;
      const consider=(trial,move)=>{
        const counts=new Map();for(const map of trial.owners)for(const sid of map)counts.set(sid,(counts.get(sid)||0)+1);
        for(const room of program.filter(r=>!OPEN_LABELS.includes(r.label)))if(!rect(trial,room))return;
        const estimate=program.reduce((s,r)=>{const sid=trial.spaces.find(x=>x.key===r.key)?.id,area=(counts.get(sid)||0)*.09;return s+Math.max(0,area-(r.resourceMaxArea??Infinity))*200+Math.max(0,r.minArea-area)*200+areaDeviation(r,area)*20;},0);
        proposals.push({trial,move,estimate});
      };
      for(const room of program){
        if(room.key==='entry')continue;
        const box=rect(current,room);if(!box)continue;
        const {sid,x,y,w,h}=box,map=current.owners[room.floor];
        // Expand or contract a complete edge, so private rooms remain rectangles.
        for(const depth of [1,2,3,4,6])for(const grow of [true,false]){
          const bands=grow?[{x:x-depth,y,w:depth,h},{x:x+w,y,w:depth,h},{x,y:y-depth,w,h:depth},{x,y:y+h,w,h:depth}]:
            [{x,y,w:depth,h},{x:x+w-depth,y,w:depth,h},{x,y,w,h:depth},{x,y:y+h-depth,w,h:depth}];
          for(const band of bands){
            if(!grow&&(band.w>=w&&band.h>=h))continue;
            const cells=indices(current,band);if(!cells||!grow&&cells.some(i=>map[i]!==sid))continue;
            if(grow){
              if(cells.some(i=>!OPEN_LABELS.includes(current.spaces[map[i]]?.label)||current.spaces[map[i]]?.key==='entry'))continue;
              if((box.cells.length+cells.length)*.09>room.resourceMaxArea+1e-8)continue;
              const trial=clone(current);for(const i of cells){trial.owners[room.floor][i]=sid;trial.floors[room.floor][i]=room.label;}
              consider(trial,{floor:room.floor,type:'expand-complete-edge',to:room.key,area:cells.length*.09});
            }else{
              const receivers=[...new Set(cells.flatMap(i=>neighbors(i,current.nx,current.ny,1).map(j=>map[j])))].filter(id=>id!==sid&&program.some(r=>r.key===current.spaces[id]?.key)&&current.spaces[id]?.key!=='entry');
              for(const receiver of receivers){
                const trial=clone(current);for(const i of cells){trial.owners[room.floor][i]=receiver;trial.floors[room.floor][i]=current.spaces[receiver].label;}
                consider(trial,{floor:room.floor,type:'contract-complete-edge',from:room.key,to:current.spaces[receiver].key,area:cells.length*.09});
              }
            }
          }
        }
        // Move a service rectangle and let a neighbouring bedroom absorb the
        // freed complete band in the same proposal; temporary intermediate states
        // are never admitted as layouts.
        if(![ID['卫生间'],ID['家政空间']].includes(room.label))continue;
        for(const depth of [1,2,3,4,6])for(const [dx,dy] of [[depth,0],[-depth,0],[0,depth],[0,-depth]]){
          const moved=indices(current,{x:x+dx,y:y+dy,w,h});if(!moved)continue;
          const additions=moved.filter(i=>map[i]!==sid),donors=[...new Set(additions.map(i=>map[i]))];
          if(donors.length!==1||!OPEN_LABELS.includes(current.spaces[donors[0]]?.label)||current.spaces[donors[0]].key==='entry')continue;
          const trial=clone(current),kept=new Set(moved),vacated=box.cells.filter(i=>!kept.has(i));
          for(const i of vacated){trial.owners[room.floor][i]=donors[0];trial.floors[room.floor][i]=current.spaces[donors[0]].label;}
          for(const i of moved){trial.owners[room.floor][i]=sid;trial.floors[room.floor][i]=room.label;}
          for(const bed of program.filter(r=>r.floor===room.floor&&r.label===ID['卧室'])){
            const b=rect(trial,bed);if(!b)continue;
            const bands=dx?[{x:b.x-depth,y:b.y,w:depth,h:b.h},{x:b.x+b.w,y:b.y,w:depth,h:b.h}]:[{x:b.x,y:b.y-depth,w:b.w,h:depth},{x:b.x,y:b.y+b.h,w:b.w,h:depth}];
            for(const band of bands){const cells=indices(trial,band);if(!cells||!cells.some(i=>vacated.includes(i))||cells.some(i=>trial.owners[room.floor][i]!==donors[0]))continue;
              const bundle=clone(trial);for(const i of cells){bundle.owners[room.floor][i]=b.sid;bundle.floors[room.floor][i]=bed.label;}
              consider(bundle,{floor:room.floor,type:'shift-service-and-expand-bedroom',service:room.key,shiftMm:[dx*300,dy*300],to:bed.key,area:cells.length*.09});
            }
          }
        }
      }
      proposals.sort((a,b)=>a.estimate-b.estimate);
      for(const {trial,move} of proposals.slice(0,24)){
        if(!roomConnectivity(trial))continue;
        const after=score(trial);
        if(after<bestScore-1e-7){trial.geometry.resourceAdjustments=[...(current.geometry.resourceAdjustments||[]),{...move,beforeCost:before,afterCost:after}];best=trial;bestScore=after;}
      }
      if(!best)break;current=best;
    }
    return current;
  }

  function repairPublicIntegrity(candidate,program){
    let current=candidate;
    const cost=trial=>{const check=validateProgram(trial,program);return check.issues.length*1000+check.reports.reduce((sum,r)=>sum+(OPEN_LABELS.includes(trial.spaces[r.spaceId].label)?Math.max(0,r.shapeMetrics.concaveCorners-1)*10:0)+areaDeviation(r,r.area),0);};
    for(let step=0;step<6;step++){
      const before=cost(current);if(validateProgram(current,program).accepted)return current;
      let best=null,bestCost=before;
      for(const room of program){
        const sid=current.spaces.find(s=>s.key===room.key)?.id,map=current.owners[room.floor],cells=Array.from(map).flatMap((id,i)=>id===sid?[i]:[]);
        if(!cells.length)continue;
        const xs=cells.map(i=>i%current.nx),ys=cells.map(i=>Math.floor(i/current.nx)),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x+1,h=Math.max(...ys)-y+1;
        if(cells.length!==w*h)continue;
        for(const depth of [1,2,3,4])for(const rect of [{x:x-depth,y,w:depth,h},{x:x+w,y,w:depth,h},{x,y:y-depth,w,h:depth},{x,y:y+h,w,h:depth}]){
          if(rect.x<0||rect.y<0||rect.x+rect.w>current.nx||rect.y+rect.h>current.ny)continue;
          const moved=[];for(let yy=rect.y;yy<rect.y+rect.h;yy++)for(let xx=rect.x;xx<rect.x+rect.w;xx++)moved.push(yy*current.nx+xx);
          if(!MealGeometry.fits(room,Math.max(x+w,rect.x+rect.w)-Math.min(x,rect.x),Math.max(y+h,rect.y+rect.h)-Math.min(y,rect.y),(cells.length+moved.length)*.09))continue;
          if(moved.some(i=>!OPEN_LABELS.includes(current.spaces[map[i]]?.label)||current.spaces[map[i]].key==='entry'))continue;
          const trial={...current,owners:current.owners.map(g=>Int32Array.from(g)),floors:current.floors.map(g=>Int16Array.from(g))};
          for(const i of moved){trial.owners[room.floor][i]=sid;trial.floors[room.floor][i]=room.label;}
          if(!roomConnectivity(trial))continue;
          const after=cost(trial);if(after<bestCost){trial.geometry={...current.geometry,integrityAdjustments:[...(current.geometry.integrityAdjustments||[]),{floor:room.floor,to:room.key,area:moved.length*.09,beforeCost:before,afterCost:after}]};best=trial;bestCost=after;}
        }
      }
      if(!best)break;current=best;
    }
    return current;
  }
  function sampleStairAnchor(nx,ny,mode,r){
    const profile=typeof require==='function'?require('./stair-prior.json'):root.StairPriorProfile;
    if(profile?.schema!=='training_stair_joint_prior_v1')throw Error('楼梯联合统计未加载');
    const area=nx*ny*.09,aspect=Math.max(nx,ny)/Math.min(nx,ny);
    const pool=profile.observations.filter(o=>!mode||o.mode===mode).map(o=>({o,d:Math.abs(Math.log(o.houseArea/area))+Math.abs(o.houseAspect-aspect)})).sort((a,b)=>a.d-b.d).slice(0,40);
    if(!pool.length)throw Error('缺少楼梯关系样本');
    const sample=pool[Math.floor(r()*pool.length)].o;
    const [sx,sy,stairW,stairH]=sample.stair;
    const snap=(size,extent,position,edge)=>edge===-1?0:edge===1?extent-size:Math.max(0,Math.min(extent-size,Math.round(position*extent)));
    let stairX=snap(stairW,nx,sx,sample.edgeX),stairY=snap(stairH,ny,sy,sample.edgeY);
    const side=8;
    if(stairX>0&&stairX<side)stairX=0;
    if(nx-stairX-stairW>0&&nx-stairX-stairW<side)stairX=nx-stairW;
    const entryW=6+Math.floor(r()*4),entryH=6;
    let entryX=Math.max(0,Math.min(nx-entryW,Math.round(sample.entry[0]*nx))),entryY=r()<.25?Math.max(0,Math.min(ny-entryH,Math.round(sample.entry[1]*ny))):0;
    if(mode==='near'){
      entryX=Math.max(0,Math.min(nx-entryW,stairX));entryY=stairY-entryH;
      if(entryY<0){entryY=stairY+stairH;if(entryY+entryH>ny)return null;}
    }else{
      entryY=Math.min(entryY,stairY-entryH-4);
      if(mode==='public')entryX=Math.max(0,Math.min(nx-entryW,stairX));
      if(mode==='hall'&&entryX<stairX+stairW&&entryX+entryW>stairX)entryX=stairX>=entryW?0:nx-entryW;
      if(entryY<0||mode==='hall'&&entryX<stairX+stairW&&entryX+entryW>stairX)return null;
    }
    if(stairW>nx||stairH>ny)return null;
    return {stairX,stairY,stairW,stairH,entryX,entryY,entryW,entryH,stairEvidence:{revision:profile.revision,sourceSha256:profile.sourceSha256,trainingCaseCount:profile.trainingCaseCount,sourceCase:sample.case,templateMm:[stairW*300,stairH*300],sampleMode:sample.mode}};
  }
  function freePartitionCandidate(nx,ny,seed,index,program,corridorWidth,neuralPrior=null,influence=0,anchorMode=null,diagnostics=null,anchorOverride=null,refine=true){
    if(refine&&!anchorOverride&&index%12===0&&program.some(r=>r.circulationRevision===Traffic.REVISION)){
      const topology=interiorTopologyCandidate(nx,ny,seed,index,program,corridorWidth,anchorMode);
      if(topology)return topology;
      const dimensions=boundedTopologyDimensions(nx,ny,program,corridorWidth);
      if(dimensions.length){
        const start=(Math.floor(index/12)+seed)>>>0;
        // A bounded number of joint proposals shares this candidate's budget.
        for(let offset=0;offset<2;offset++){
          if(diagnostics)diagnostics.jointTopologyTrials=(diagnostics.jointTopologyTrials||0)+1;
          const joint=interiorTopologyCandidate(nx,ny,seed,index,program,corridorWidth,anchorMode,null,dimensions[(start+offset)%dimensions.length]);
          if(joint)return joint;
        }
      }
      if(nx<38||ny<34){
        const compact=compactSpineCandidate(nx,ny,seed,index,program,corridorWidth,anchorMode);
        if(compact)return compact;
      }
    }
    const args=[nx,ny,seed,index,program,corridorWidth,neuralPrior,influence,anchorMode,diagnostics,anchorOverride,refine];
    const first=freePartitionAttempt(...args);if(first||!refine)return first;
    if(diagnostics)diagnostics.mealRepartitions=(diagnostics.mealRepartitions||0)+1;
    const second=freePartitionAttempt(...args,0,index%4===2);if(second)return second;
    if(diagnostics)diagnostics.publicRepartitions=(diagnostics.publicRepartitions||0)+1;
    return freePartitionAttempt(...args,0,true,true);
  }

  const topologyDimensionCache=new Map();
  // Compact envelopes use two exterior room bands and one continuous public
  // spine. Every occupied cell belongs to a planned room, stair or arrival.
  function compactSpineCandidate(nx,ny,seed,index,program,corridorWidth,anchorMode,diagnostics=null){
    const keys=['entry','living','dining','kitchen','utility','multi','living-1','utility-1','bedroom-1','bedroom-2','bedroom-3','bathroom-1','bathroom-2','balcony-1','balcony-1-2'];
    if(program.length!==keys.length||keys.some(k=>!program.some(r=>r.key===k))||program.some(r=>r.floor!==(['entry','living','dining','kitchen','utility','bedroom-1','bathroom-1'].includes(r.key)?0:1)))return null;
    const rooms=Object.fromEntries(program.map(r=>[r.key,r])),q=Math.round(corridorWidth/.3);
    const activity=Organization.ACTIVITY_RULES[ID['客厅']],activityShort=Math.min(activity.w,activity.h),activityLong=Math.max(activity.w,activity.h);
    const profile=typeof require==='function'?require('./stair-prior.json'):root.StairPriorProfile;
    const cacheKey=JSON.stringify(['compact',nx,ny,q,program]);
    let choices=topologyDimensionCache.get(cacheKey);
    if(!choices){
      const fit=(key,w,h,area=w*h*.09)=>{
        const room=rooms[key];
        return w>0&&h>0&&Math.min(w,h)*.3+1e-8>=room.minWidth&&area+1e-8>=(room.resourceMinArea??room.minArea)&&area<=(room.resourceMaxArea??Infinity)+1e-8&&Functional.fits(room,w,h,area)&&MealGeometry.fits(room,w,h,area)&&(room.label!==4||Math.max(w,h)/Math.min(w,h)<=BEDROOM_RULES.maxAspect+1e-8);
      };
      const score=(key,w,h)=>areaDeviation(rooms[key],w*h*.09);
      const keep=(list,item)=>{list.push(item);list.sort((a,b)=>a.score-b.score);if(list.length>24)list.pop();};
      choices=[];
      const templates=[...new Map(profile.observations.map(o=>[o.stair.slice(2).join(':'),o.stair.slice(2)])).values()];
      for(const [sw,sh] of templates)for(let spine=8;spine<=14;spine++){
        const right=nx-sw-spine,branch=Math.max(0,activityShort+q-spine),serviceWidth=right-branch;
        if(right<8||serviceWidth<5||sw<8||sh<activityLong||!fit('living',spine,ny)||!fit('living-1',spine,ny))continue;
        const meals=[],lower=[],upperLeft=[],upperRight=[];
        for(let kitchen=7;kitchen<=ny-sh-6;kitchen++){
          const dining=ny-sh-kitchen;
          if(!fit('kitchen',sw,kitchen)||!fit('dining',sw,dining)||sw*(ny-sh)*.09>rooms.dining.resourceGroupMaxArea+1e-8)continue;
          keep(meals,{kitchen,dining,score:score('kitchen',sw,kitchen)+score('dining',sw,dining)});
        }
        if(!meals.length)continue;
        for(let entry=4;entry<=Math.floor(rooms.entry.resourceMaxArea/(right*.09)+1e-8);entry++)for(let bedroom=8;bedroom<=ny-entry-10;bedroom++){
          if(!fit('entry',right,entry)||right*entry*.09>entryMaxArea(rooms.entry,nx*ny*.09)+1e-8||!fit('bedroom-1',right,bedroom))continue;
          for(let utility=5;utility<=ny-entry-bedroom-5;utility++){
            const bath=ny-entry-bedroom-utility;
            if(branch&&utility+bath<activityLong+q)continue;
            const living=(spine*ny+branch*(utility+bath))*.09;
            if(fit('utility',serviceWidth,utility)&&fit('bathroom-1',serviceWidth,bath)&&fit('living',spine+branch,ny,living))keep(lower,{entry,bedroom,utility,bath,score:score('entry',right,entry)+score('bedroom-1',right,bedroom)+score('utility',serviceWidth,utility)+score('bathroom-1',serviceWidth,bath)});
          }
        }
        if(!lower.length)continue;
        for(let multi=8;multi<=ny-sh-q-8;multi++){
          const bedroom=ny-sh-q-multi;
          if(!fit('multi',sw,multi)||!fit('bedroom-3',sw,bedroom)||(spine*ny+sw*multi)*.09>rooms.multi.resourceGroupMaxArea+1e-8)continue;
          keep(upperLeft,{multi,bedroom,score:score('multi',sw,multi)+score('bedroom-3',sw,bedroom)});
        }
        if(!upperLeft.length)continue;
        for(let balcony=3;balcony<=ny-8-10-3;balcony++)for(let bedroom=8;bedroom<=ny-balcony-10-3;bedroom++){
          if(!fit('balcony-1',right,balcony)||!fit('bedroom-2',right,bedroom))continue;
          for(let utility=5;utility<=ny-balcony-bedroom-5-3;utility++)for(let bath=5;bath<=ny-balcony-bedroom-utility-3;bath++){
            const upperBalcony=ny-balcony-bedroom-utility-bath;
            if(branch&&utility+bath<activityLong+q)continue;
            const living=(spine*ny+branch*(utility+bath))*.09;
            if(!fit('utility-1',serviceWidth,utility)||!fit('bathroom-2',serviceWidth,bath)||!fit('balcony-1-2',right,upperBalcony)||!fit('living-1',spine+branch,ny,living))continue;
            keep(upperRight,{balcony,bedroom,utility,bath,upperBalcony,score:score('balcony-1',right,balcony)+score('bedroom-2',right,bedroom)+score('utility-1',serviceWidth,utility)+score('bathroom-2',serviceWidth,bath)+score('balcony-1-2',right,upperBalcony)});
          }
        }
        for(let n=0;n<Math.min(meals.length,lower.length,upperLeft.length,upperRight.length);n++){
          if((spine*ny+branch*(upperRight[n].utility+upperRight[n].bath)+sw*upperLeft[n].multi)*.09>rooms.multi.resourceGroupMaxArea+1e-8)continue;
          keep(choices,{sw,sh,spine,right,branch,meal:meals[n],lower:lower[n],upperLeft:upperLeft[n],upperRight:upperRight[n],score:meals[n].score+lower[n].score+upperLeft[n].score+upperRight[n].score});
        }
      }
      if(topologyDimensionCache.size>=8)topologyDimensionCache.delete(topologyDimensionCache.keys().next().value);
      topologyDimensionCache.set(cacheKey,choices);
    }
    for(let trial=0;trial<Math.min(4,choices.length);trial++){
      const dims=choices[(((seed+Math.floor(index/12))>>>0)+trial)%choices.length];
      const {sw,sh,spine,right,branch,meal,lower,upperLeft,upperRight}=dims;
      const spaces=[{id:0,key:'stairs',label:7}],floors=[new Int16Array(nx*ny).fill(-1),new Int16Array(nx*ny).fill(-1)],owners=[new Int32Array(nx*ny).fill(-1),new Int32Array(nx*ny).fill(-1)];
      const put=(floor,key,x,y,w,h)=>{
        let room=spaces.find(s=>s.key===key);if(!room){room={id:spaces.length,...(rooms[key]||{key,label:6,floor,generated:true})};spaces.push(room);}
        for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const at=yy*nx+xx;owners[floor][at]=room.id;floors[floor][at]=room.label;}
      };
      put(0,'kitchen',0,0,sw,meal.kitchen);put(0,'dining',0,meal.kitchen,sw,meal.dining);put(0,'stairs',0,ny-sh,sw,sh);put(0,'living',sw,0,spine,ny);
      let y=0;for(const [key,h] of [['entry',lower.entry],['bedroom-1',lower.bedroom]]){put(0,key,sw+spine,y,right,h);y+=h;}
      if(branch)put(0,'living',sw+spine,y,branch,ny-y);
      for(const [key,h] of [['utility',lower.utility],['bathroom-1',lower.bath]]){put(0,key,sw+spine+branch,y,right-branch,h);y+=h;}
      put(1,'multi',0,0,sw,upperLeft.multi);put(1,'bedroom-3',0,upperLeft.multi,sw,upperLeft.bedroom);put(1,'1:stair-landing',0,ny-sh-q,sw,q);put(1,'stairs',0,ny-sh,sw,sh);put(1,'living-1',sw,0,spine,ny);
      y=0;for(const [key,h] of [['balcony-1',upperRight.balcony],['bedroom-2',upperRight.bedroom],['balcony-1-2',upperRight.upperBalcony]]){put(1,key,sw+spine,y,right,h);y+=h;}
      if(branch)put(1,'living-1',sw+spine,y,branch,ny-y);
      for(const [key,h] of [['utility-1',upperRight.utility],['bathroom-2',upperRight.bath]]){put(1,key,sw+spine+branch,y,right-branch,h);y+=h;}
      const source=profile.observations.find(o=>o.stair[2]===sw&&o.stair[3]===sh);
      const candidate={nx,ny,spaces,floors,owners,corridorWidth,anchorMode,daylightPolicy:BedroomDaylight.RULES.revision,mealPolicy:MealGeometry.RULES.revision,organizationPolicy:'activity-protected-v5',publicShapePolicy:'rect-or-L',geometry:{strategy:'compact-public-spine',jointDimensionPlanning:{revision:'compact-joint-geometry-v1',...dims},stairX:0,stairY:ny-sh,stairW:sw,stairH:sh,entryX:sw+spine,entryY:0,entryW:right,entryH:lower.entry,freeAnchors:true,publicHub:'living',publicHubs:['living','dining'],functionalRevision:Functional.REVISION,stairEvidence:{revision:'stair-joint-v1',sourceCase:source.case,sourceSha256:profile.sourceSha256,templateMm:[sw*300,sh*300]},functionalStages:[]},routingEvidence:[{floor:0,repairs:[],method:'compact-room-and-public-spine'},{floor:1,repairs:[],method:'compact-room-and-stair-arrival'}]};
      const programCheck=validateProgram(candidate,program),anchors=validateAnchors(candidate);
      if(diagnostics)diagnostics.push({dims,candidate,program:programCheck,anchors});
      if(!roomConnectivity(candidate)||!programCheck.accepted||!anchors.accepted)continue;
      candidate.organization=Organization.evaluate(candidate);
      const quality=assessCandidate(candidate),traffic=Traffic.evaluate(candidate,program);
      if(diagnostics)Object.assign(diagnostics[diagnostics.length-1],{organization:candidate.organization,quality,traffic});
      if(!candidate.organization.accepted||!quality.reachable||!traffic.accepted)continue;
      candidate.geometry.functionalStages.push({stage:'joint-topology',issues:[],rooms:Functional.evaluate(candidate,program).reports.map(r=>({key:r.key,area:r.area,aspect:r.aspect}))});
      return coordinateCirculation(candidate,program);
    }
    return null;
  }
  function boundedTopologyDimensions(nx,ny,program,corridorWidth){
    const keys=['entry','living','dining','kitchen','utility','multi','living-1','utility-1','bedroom-1','bedroom-2','bedroom-3','bathroom-1','bathroom-2','balcony-1','balcony-1-2'];
    if(nx<38||ny<34||program.length!==keys.length||keys.some(k=>!program.some(r=>r.key===k))||program.find(r=>r.key==='bedroom-1').floor!==0||program.find(r=>r.key==='bedroom-2').floor!==1)return [];
    const q=Math.round(corridorWidth/.3),rooms=Object.fromEntries(program.map(r=>[r.key,r]));
    const cacheKey=JSON.stringify([nx,ny,q,program]);
    if(topologyDimensionCache.has(cacheKey))return topologyDimensionCache.get(cacheKey);
    const fit=(key,w,h,area=w*h*.09)=>{
      const room=rooms[key];
      return w>0&&h>0&&area+1e-8>=(room.resourceMinArea??room.minArea)&&area<=(room.resourceMaxArea??Infinity)+1e-8&&Math.min(w,h)*.3+1e-8>=room.minWidth&&Functional.fits(room,w,h,area)&&MealGeometry.fits(room,w,h,area)&&(room.label!==4||Math.max(w,h)/Math.min(w,h)<=BEDROOM_RULES.maxAspect+1e-8);
    };
    const score=(key,area)=>areaDeviation(rooms[key],area);
    const keep=(list,item)=>{list.push(item);list.sort((a,b)=>a.score-b.score);if(list.length>16)list.pop();};
    const profile=typeof require==='function'?require('./stair-prior.json'):root.StairPriorProfile;
    const templates=[...new Map(profile.observations.map(o=>[o.stair.slice(2).join(':'),o.stair.slice(2)])).values()];
    const result=[];
    // Solve complete bands against the same capacities used by final validation.
    // The public spine and its side branch exist before any residual allocation.
    for(const [sw,sh] of templates){
      const y5=ny-sh-q;if(y5<22)continue;
      const lower=[];
      for(let a=sw+5;a<=Math.min(nx-16,Math.floor(rooms.dining.resourceGroupMaxArea/((ny-sh)*.09)+1e-8));a++){
        if(!fit('bathroom-1',a-sw,sh))continue;
        for(let k=7;k<=ny-sh-6;k++){
          if(!fit('kitchen',a,k)||!fit('dining',a,ny-sh-k))continue;
          for(let b=8;b<=Math.min(nx-a-8,Math.floor(rooms.living.resourceMaxArea/(ny*.09)));b++){
            const right=nx-a-b;
            for(let c=4;c<=Math.floor(rooms.entry.resourceMaxArea/(right*.09)+1e-8);c++){
              if(!fit('entry',right,c)||right*c*.09>entryMaxArea(rooms.entry,nx*ny*.09)+1e-8)continue;
              for(let d=8;d<=Math.floor(rooms['bedroom-1'].resourceMaxArea/(right*.09)+1e-8);d++){
                const h=ny-c-d;if(h<8||ny-8-c-d<q||!fit('bedroom-1',right,d))continue;
                for(let e=5;e<=nx-a-b-q-8;e++){
                  if(!fit('utility',e,h))continue;
                  const living=(b*ny+(nx-e-a-b-q)*h+q*8)*.09;
                  if(!fit('living',nx-a-e,ny,living))continue;
                  const cost=score('entry',right*c*.09)+score('bedroom-1',right*d*.09)+score('utility',e*h*.09)+score('living',living)+score('kitchen',a*k*.09)+score('dining',a*(ny-sh-k)*.09);
                  keep(lower,{sw,sh,a,b,c,d,e,k,score:cost});
                }
              }
            }
          }
        }
      }
      if(!lower.length)continue;
      const bands=[];
      for(let x4=sw+8;x4<nx-8;x4++)for(let x5=x4+5;x5<nx-2;x5++){
        if(!fit('bedroom-2',x4-sw,sh+q)||!fit('utility-1',x5-x4,sh+q)||!fit('balcony-1-2',nx-x5,sh+q))continue;
        keep(bands,{x4,x5,score:score('bedroom-2',(x4-sw)*(sh+q)*.09)+score('utility-1',(x5-x4)*(sh+q)*.09)+score('balcony-1-2',(nx-x5)*(sh+q)*.09)});
      }
      if(!bands.length)continue;
      const upper=[];
      for(let x1=8;x1<nx-13;x1++)for(let y1=6;y1<=y5-16;y1++)for(let y4=y1+8;y4<=y5-8;y4++){
        if(!fit('bedroom-3',x1,y4-y1))continue;
        for(let x2=x1+6;x2<nx-7;x2++)for(let y2=y1+1;y2<=y5-8;y2++){
          const multi=(x2*y1+(x2-x1)*(y2-y1))*.09;
          if(!fit('multi',x2,y2,multi))continue;
          for(let x3=x2+5;x3<nx-2;x3++){
            if(x3-x1<8||!fit('bathroom-2',x3-x2,y2))continue;
            for(let y3=y2;y3<=y5-8;y3++){
              if(!fit('balcony-1',nx-x3,y3))continue;
              const living=((x3-x1)*(y3-y2)+(nx-x1)*(y5-y3)+x1*(y5-y4))*.09;
              if(!fit('living-1',nx,y5-y2,living)||living+multi>rooms.multi.resourceGroupMaxArea+1e-8)continue;
              keep(upper,{x1,x2,x3,y1,y2,y3,y4,score:score('multi',multi)+score('living-1',living)+score('bedroom-3',x1*(y4-y1)*.09)+score('bathroom-2',(x3-x2)*y2*.09)+score('balcony-1',(nx-x3)*y3*.09)});
            }
          }
        }
      }
      for(let i=0;i<Math.min(lower.length,upper.length,bands.length);i++)result.push({...lower[i],...upper[i],...bands[i],score:lower[i].score+upper[i].score+bands[i].score});
    }
    result.sort((a,b)=>a.score-b.score);
    if(topologyDimensionCache.size>=8)topologyDimensionCache.delete(topologyDimensionCache.keys().next().value);
    topologyDimensionCache.set(cacheKey,result);
    return result;
  }

  // An explicit engineering topology family, not a learned floorplan/template.
  // It jointly reserves room envelopes, a short interior spine and upper arrival.
  // Unsupported programs continue through the ordinary partition search.
  function interiorTopologyCandidate(nx,ny,seed,index,program,corridorWidth,anchorMode='hall',diagnostics=null,dimensions=null){
    const keys=['entry','living','dining','kitchen','utility','multi','living-1','utility-1','bedroom-1','bedroom-2','bedroom-3','bathroom-1','bathroom-2','balcony-1','balcony-1-2'];
    if(program.length!==keys.length||keys.some(k=>!program.some(r=>r.key===k))||program.find(r=>r.key==='bedroom-1').floor!==0||program.find(r=>r.key==='bedroom-2').floor!==1||program.some(r=>r.key==='balcony-0'))return null;
    const profile=typeof require==='function'?require('./stair-prior.json'):root.StairPriorProfile;
    const stairSource=profile.observations.filter(o=>o.stair[2]===(dimensions?.sw??8)&&o.stair[3]===(dimensions?.sh??10)).sort((a,b)=>Math.abs(a.houseArea-nx*ny*.09)-Math.abs(b.houseArea-nx*ny*.09))[0];
    if(!stairSource||nx<38||ny<34)return null;
    const sw=dimensions?.sw??8,sh=dimensions?.sh??10,q=Math.round(corridorWidth/.3),r=rng(seed+index*103),variant=Math.floor(index/12);
    const jitter=()=>variant?Math.floor(r()*3)-1:0;
    const a=dimensions?.a??Math.min(Math.floor(.28*nx*ny/(ny-sh)),Math.round(nx*17/45)+jitter()),b=dimensions?.b??Math.max(8,Math.round(nx*8/45)+jitter()),c=dimensions?.c??Math.max(4,Math.round(ny*7/38)+jitter()),d=dimensions?.d??Math.max(8,Math.round(ny*14/38)+jitter()),e=dimensions?.e??Math.max(5,Math.round(nx*7/45)+jitter()),top=c+d,bridge=ny-8,k=dimensions?.k??Math.round((ny-sh)/2)+jitter();
    const spaces=[{id:0,key:'stairs',label:7}],floors=[new Int16Array(nx*ny).fill(-1),new Int16Array(nx*ny).fill(-1)],owners=[new Int32Array(nx*ny).fill(-1),new Int32Array(nx*ny).fill(-1)];
    const put=(floor,key,x,y,w,h,label)=>{
      if(x<0||y<0||w<=0||h<=0||x+w>nx||y+h>ny)throw Error('bounds');
      let s=spaces.find(s=>s.key===key);if(!s){const room=program.find(r=>r.key===key);s={id:spaces.length,...(room||{key,label:label??6,floor,generated:true})};spaces.push(s);}
      for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=yy*nx+xx;if(owners[floor][i]!==-1)throw Error('overlap');owners[floor][i]=s.id;floors[floor][i]=s.label;}
    };
    try{
      put(0,'stairs',0,ny-sh,sw,sh);put(0,'bathroom-1',sw,ny-sh,a-sw,sh);
      put(0,'kitchen',0,0,a,k);put(0,'dining',0,k,a,ny-sh-k);
      put(0,'entry',a+b,0,nx-a-b,c);put(0,'bedroom-1',a+b,c,nx-a-b,d);
      put(0,'utility',nx-e,top,e,ny-top);
      put(0,'0:interior-spine',a+b,top,q,bridge-top,6);
      put(0,'living',a,0,b,ny);put(0,'living',a+b+q,top,nx-e-a-b-q,ny-top);put(0,'living',a+b,bridge,q,ny-bridge);
      // Upper public room wraps two private wings; the south facade belongs to
      // multifunction/bath/balcony, with no south corridor or leftover lobby.
      const x1=dimensions?.x1??Math.round(nx*15/45)+jitter(),x2=dimensions?.x2??Math.max(x1+8,Math.round(nx*23/45)+jitter()),x3=dimensions?.x3??Math.max(x2+7,Math.round(nx*30/45)+jitter()),x4=dimensions?.x4??Math.min(sw+Math.floor(program.find(r=>r.key==='bedroom-2').resourceMaxArea/((sh+q)*.09)),Math.round(nx*28/45)+jitter()),x5=dimensions?.x5??x4+8+jitter();
      const y5=ny-sh-q,y1=dimensions?.y1??Math.round(ny*6/38),y2=dimensions?.y2??Math.round(ny*12/38),y3=dimensions?.y3??Math.round(ny*13/38),y4=dimensions?.y4??Math.min(y5-8,Math.round(ny*16/38));
      put(1,'stairs',0,ny-sh,sw,sh);put(1,'1:stair-landing',0,y5,sw,q,6);
      put(1,'bedroom-2',sw,y5,x4-sw,ny-y5);put(1,'utility-1',x4,y5,x5-x4,ny-y5);put(1,'balcony-1-2',x5,y5,nx-x5,ny-y5);
      put(1,'bedroom-3',0,y1,x1,y4-y1);put(1,'multi',0,0,x2,y1);put(1,'multi',x1,y1,x2-x1,y2-y1);
      put(1,'bathroom-2',x2,0,x3-x2,y2);put(1,'balcony-1',x3,0,nx-x3,y3);
      put(1,'living-1',x1,y2,x3-x1,y3-y2);put(1,'living-1',x1,y3,nx-x1,y5-y3);put(1,'living-1',0,y4,x1,y5-y4);
    }catch(e){if(diagnostics)diagnostics.error=e.message;return null;}
    if(owners.some(m=>m.some(id=>id<0)))return null;
    const candidate={nx,ny,floors,owners,spaces,corridorWidth,anchorMode,daylightPolicy:BedroomDaylight.RULES.revision,mealPolicy:MealGeometry.RULES.revision,organizationPolicy:'activity-protected-v5',publicShapePolicy:'activity-verified',geometry:{strategy:'engineering-interior-spine-family',topologyVariant:variant,jointDimensionPlanning:dimensions?{revision:'bounded-joint-geometry-v1',...dimensions}:undefined,stairX:0,stairY:ny-sh,stairW:sw,stairH:sh,entryX:a+b,entryY:0,entryW:nx-a-b,entryH:c,publicHub:'living',publicHubs:['living','dining'],freeAnchors:true,circulationRevision:Traffic.REVISION,stairEvidence:{sourceCase:stairSource.case,sourceSha256:profile.sourceSha256,templateMm:[sw*300,sh*300],revision:'stair-joint-v1'},functionalStages:[]},routingEvidence:[{floor:0,repairs:[],method:'room-and-interior-spine-joint-topology'},{floor:1,repairs:[],method:'room-and-landing-joint-topology'}]};
    const check=validateProgram(candidate,program);if(diagnostics){diagnostics.model=candidate;diagnostics.program=check;}
    if(!roomConnectivity(candidate)||!check.accepted||!validateAnchors(candidate).accepted)return null;
    candidate.organization=Organization.evaluate(candidate);
    const quality=assessCandidate(candidate);if(diagnostics){diagnostics.organization=candidate.organization;diagnostics.quality=quality;diagnostics.traffic=Traffic.evaluate(candidate,program);}
    if(!candidate.organization.accepted||!quality.reachable||!Traffic.evaluate(candidate,program).accepted)return null;
    candidate.geometry.functionalStages.push({stage:'joint-topology',issues:[],rooms:Functional.evaluate(candidate,program).reports.map(r=>({key:r.key,area:r.area,aspect:r.aspect}))});
    return coordinateCirculation(candidate,program);
  }
  function freePartitionAttempt(nx,ny,seed,index,program,corridorWidth,neuralPrior=null,influence=0,anchorMode=null,diagnostics=null,anchorOverride=null,refine=true,upperVariant=0,pairedOverride=null,protectLiving=false) {
    let r=rng((seed+Math.imul(index+1,0x85EBCA6B))>>>0);const trees=[];
    // Leave geometric packing slack: the budget is a final allocation goal, not
    // a demand that every initial rectangle consumes its full share before routing.
    const resourceProgram=program.some(room=>room.areaBudgetRevision)?program:null;
    if(resourceProgram)program=program.map(room=>{
      const reference=room.placementTargetArea??room.targetArea;
      // Explore packing slack around the joint allocation, while retaining a
      // reference-sized branch for compact programs. Final targets stay frozen.
      const fraction=[0,.55,.8,1][index%4];
      return {...room,budgetTargetArea:room.budgetTargetArea??room.targetArea,
        targetArea:Math.min(room.resourceMaxArea,Math.max(room.minArea,reference+fraction*((room.budgetTargetArea??room.targetArea)-reference)))};
    });
    const evaluationProgram=program;
    const hubKey=index%2===0?'dining':'living',hub=program.find(room=>room.key===hubKey);
    const hubs=anchorMode==='public'&&index%3===2?[hub,program.find(room=>room.key===(hubKey==='dining'?'living':'dining'))]:[hub];
    const anchor=sampleStairAnchor(nx,ny,anchorMode||'public',r);if(!anchor)return null;
    const {stairW,stairH,entryW,entryH,entryY}=anchor;
    let {stairX,stairY,entryX}=anchor;
    const gap=0;
    const sideMinimum=Math.ceil(BEDROOM_RULES.minWidth/.3);
    const corePositions=Array.from({length:nx-stairW+1},(_,x)=>x).filter(x=>(x===0||x>=sideMinimum)&&(x+stairW===nx||nx-x-stairW>=sideMinimum));
    const freeAnchors=true;
    if(anchorOverride?.stairX!==undefined)stairX=anchorOverride.stairX;
    if(anchorOverride?.stairY!==undefined)stairY=anchorOverride.stairY;
    if(anchorOverride?.entryX!==undefined)entryX=anchorOverride.entryX;
    if(stairY+stairH>ny)return null;
    const stair={key:'stairs',label:ID['楼梯间']};
    const divide=(node,axis,cut)=>{
      node.axis=axis;node.cut=cut;
      node.children=axis==='x'?[{x:node.x,y:node.y,w:cut,h:node.h},{x:node.x+cut,y:node.y,w:node.w-cut,h:node.h}]:
        [{x:node.x,y:node.y,w:node.w,h:cut},{x:node.x,y:node.y+cut,w:node.w,h:node.h-cut}];
      return node.children;
    };
    const leaves=node=>node.children?node.children.flatMap(leaves):[node];
    const fits=(node,room)=>Math.min(node.w,node.h)*.3+1e-8>=room.minWidth&&node.w*node.h*.09+1e-8>=room.minArea;
    // Reserve the entry-to-stair skeleton before allocating other rooms.
    const reserve=(root,x,y,w,h,room)=>{
      if(x<0||y<0||x+w>nx||y+h>ny)return false;
      const nodes=leaves(root).filter(n=>n.x<x+w&&n.x+n.w>x&&n.y<y+h&&n.y+n.h>y);
      if(nodes.some(n=>n.room))return false;
      for(const node of nodes){const left=Math.max(x,node.x),bottom=Math.max(y,node.y),right=Math.min(x+w,node.x+node.w),top=Math.min(y+h,node.y+node.h);let patch=node;
        if(left>patch.x)patch=divide(patch,'x',left-patch.x)[1];
        if(bottom>patch.y)patch=divide(patch,'y',bottom-patch.y)[1];
        if(right<patch.x+patch.w)patch=divide(patch,'x',right-patch.x)[0];
        if(top<patch.y+patch.h)patch=divide(patch,'y',top-patch.y)[0];
        patch.room=room;
      }return true;
    };
    let mealEvidence=null;const serviceEvidence=[];const pairedBands=pairedOverride??index%4!==2;
    const reserveMeals=(tree,besideStair)=>{
      const profile=typeof require==='function'?require('./meal-prior.json'):root.MealPriorProfile;
      if(!profile?.observations?.length)throw Error('缺少餐厨联合统计');
      const kitchen=program.find(s=>s.key==='kitchen'),dining=program.find(s=>s.key==='dining');
      const available=leaves(tree),free=rect=>rect.x>=0&&rect.y>=0&&rect.x+rect.w<=nx&&rect.y+rect.h<=ny&&!available.some(n=>n.room&&n.x<rect.x+rect.w&&n.x+n.w>rect.x&&n.y<rect.y+rect.h&&n.y+n.h>rect.y);
      const touches=(a,b)=>((a.x+a.w===b.x||b.x+b.w===a.x)&&a.y<b.y+b.h&&a.y+a.h>b.y)||((a.y+a.h===b.y||b.y+b.h===a.y)&&a.x<b.x+b.w&&a.x+a.w>b.x);
      const pool=profile.observations.map(o=>({o,d:Math.abs(Math.log(nx*ny/(o.house[0]*o.house[1])))+Math.abs(Math.log((nx/ny)/(o.house[0]/o.house[1])))})).sort((a,b)=>a.d-b.d).slice(0,40);
      const choices=[];
      for(let trial=0;trial<6;trial++){
        const o=pool[Math.floor(r()*pool.length)].o,scale=Math.sqrt((kitchen.targetArea+dining.targetArea)/((o.kitchen[0]*o.kitchen[1]+o.dining[0]*o.dining[1])*.09));
        let kw=Math.max(7,Math.round(o.kitchen[0]*scale)),kh=Math.max(7,Math.round(o.kitchen[1]*scale)),dw=Math.max(8,Math.round(o.dining[0]*scale)),dh=Math.max(8,Math.round(o.dining[1]*scale)),side=o.side;
        if(r()<.5)side=({E:'W',W:'E',N:'S',S:'N'})[side];
        if(r()<.25){[kw,kh]=[kh,kw];[dw,dh]=[dh,dw];side=({E:'N',W:'S',N:'E',S:'W'})[side];}
        // Align the paired rectangles on a shared band in most proposals.
        // Preserve the sampled areas while avoiding thin residual strips.
        const aligned=pairedBands&&trial<4,kitchenCells=kw*kh;
        if(aligned){if(side==='E'||side==='W'){kh=dh;kw=Math.max(7,Math.round(kitchenCells/kh));}else{kw=dw;kh=Math.max(7,Math.round(kitchenCells/kw));}}
        if(!MealGeometry.fits(kitchen,kw,kh)||!MealGeometry.fits(dining,dw,dh)||kw*kh*.09<kitchen.minArea||dw*dh*.09<dining.minArea)continue;
        const offset=aligned?0:Math.round(o.offset*(side==='E'||side==='W'?dh:dw));
        const kRelative=side==='E'?{x:dw,y:offset}:side==='W'?{x:-kw,y:offset}:side==='N'?{x:offset,y:dh}:{x:offset,y:-kh};
        const positions=[];
        for(const n of available.filter(n=>!n.room))for(const x of [n.x,n.x+n.w-dw])for(const y of [n.y,n.y+n.h-dh])positions.push({x,y});
        for(const x of [stairX,stairX+stairW-dw])for(const y of [stairY-dh,stairY+stairH])positions.push({x,y});
        for(const y of [stairY,stairY+stairH-dh])for(const x of [stairX-dw,stairX+stairW])positions.push({x,y});
        for(let j=0;j<6;j++)positions.push({x:Math.floor(r()*(nx-dw+1)),y:Math.floor(r()*(ny-dh+1))});
        for(const p of positions){
          const d={...p,w:dw,h:dh},k={x:p.x+kRelative.x,y:p.y+kRelative.y,w:kw,h:kh};
          if(!touches(k,d)||!free(k)||!free(d)||besideStair&&!touches(d,{x:stairX,y:stairY,w:stairW,h:stairH}))continue;
          const facade=k.x===0||k.y===0||k.x+kw===nx||k.y+kh===ny;
          const living=available.filter(n=>n.room?.key==='living');
          const contactLiving=living.some(n=>touches(n,d));
          const x0=Math.min(k.x,d.x),y0=Math.min(k.y,d.y),x1=Math.max(k.x+kw,d.x+dw),y1=Math.max(k.y+kh,d.y+dh);
          const corner=(x0===0||x1===nx)&&(y0===0||y1===ny);
          const score=(facade?0:5)+(living.length&&!contactLiving?3:0)+(pairedBands?(aligned?0:1)+(corner?0:1):0)+Math.abs(kw*kh*.09-kitchen.targetArea)/kitchen.targetArea+Math.abs(dw*dh*.09-dining.targetArea)/dining.targetArea+r()*.7;
          choices.push({k,d,o,score});
        }
      }
      choices.sort((a,b)=>a.score-b.score);const best=choices[0];if(!best)return false;
      if(!reserve(tree,best.d.x,best.d.y,best.d.w,best.d.h,dining)||!reserve(tree,best.k.x,best.k.y,best.k.w,best.k.h,kitchen))return false;
      mealEvidence={revision:profile.revision,sourceSha256:profile.sourceSha256,sourceCase:best.o.case,trainingCaseCount:profile.trainingCaseCount,initialKitchen:{...best.k,area:best.k.w*best.k.h*.09},initialDining:{...best.d,area:best.d.w*best.d.h*.09},placement:'paired-before-remaining-rooms'};
      return true;
    };
    for(let f=0;f<2;f++) {
      // Keep upstairs exploration independent of the number of downstairs proposals.
      if(f===1&&(pairedBands||upperVariant))r=rng((seed+Math.imul(index+1,0x85EBCA6B)+Math.imul(upperVariant+1,0x27D4EB2D))>>>0);
      const root={x:0,y:0,w:nx,h:ny};trees.push(root);
      if(anchorMode&&f===0) {
        if(!reserve(root,entryX,entryY,entryW,entryH,program.find(room=>room.key==='entry')))return null;
        if(gap&&!freeAnchors){
          if(anchorMode==='public'){
            let y=entryH;
            for(const h of hubs){const depth=Math.max(6,Math.ceil(h.minArea/(stairW*.09)));if(!reserve(root,stairX,y,stairW,depth,h))return null;y+=depth;}
          }else if(!reserve(root,stairX,entryH,stairW,gap,program.find(room=>room.key==='entry')))return null;
        }
      }
      if(!reserve(root,stairX,stairY,stairW,stairH,stair))return null;
      const landingDepth=Math.round(corridorWidth/.3);let landingRect=null;
      if(f===1){
        const landing={key:'1:stair-landing',label:ID['过道'],floor:1,generated:true};
        const options=[{x:stairX,y:stairY+stairH,w:stairW,h:landingDepth},{x:stairX,y:stairY-landingDepth,w:stairW,h:landingDepth},
          {x:stairX+stairW,y:stairY,w:landingDepth,h:stairH},{x:stairX-landingDepth,y:stairY,w:landingDepth,h:stairH}];
        for(const rect of options)if(rect.x>=0&&rect.y>=0&&rect.x+rect.w<=nx&&rect.y+rect.h<=ny&&reserve(root,rect.x,rect.y,rect.w,rect.h,landing)){landingRect=rect;break;}
        if(!landingRect)return null;
      }
      const rooms=program.filter(room=>room.floor===f),open=rooms.find(room=>room.key===(f===0?hubKey:'multi'));
      // Keep the additional upper living room intact before flexible public fill.
      // Otherwise it can acquire disconnected bands while competing with multi.
      const upperLiving=f===1?rooms.find(room=>room.key==='living-1'):null;
      if(upperLiving){
        const options=[],rule=Organization.ACTIVITY_RULES[upperLiving.label];
        const nodes=leaves(root),minimum=Math.max(Math.ceil(upperLiving.minWidth/.3),Math.min(rule.w,rule.h));
        for(let w=minimum;w<=Math.min(nx,20);w++){
          const h=Math.max(minimum,Math.ceil(upperLiving.targetArea/(w*.09)));
          if(h>ny||Math.max(w,h)/Math.min(w,h)>2.2)continue;
          for(const node of nodes.filter(n=>!n.room))for(const x of [node.x,node.x+node.w-w])for(const y of [node.y,node.y+node.h-h]){
            if(x<0||y<0||x+w>nx||y+h>ny||nodes.some(n=>n.room&&n.x<x+w&&n.x+n.w>x&&n.y<y+h&&n.y+n.h>y))continue;
            if(x>0&&y>0&&x+w<nx&&y+h<ny)continue;
            if(!((w>=rule.w&&h>=rule.h)||(w>=rule.h&&h>=rule.w)))continue;
            const prior=neuralPrior?.[upperLiving.key],cx=(x+w/2)/nx,cy=(y+h/2)/ny;
            const location=prior?Math.min(10,((cx-prior.cx)/prior.sx)**2+((cy-prior.cy)/prior.sy)**2):0;
            options.push({x,y,w,h,score:Math.abs(w*h*.09-upperLiving.targetArea)/upperLiving.targetArea+Math.max(w,h)/Math.min(w,h)+influence*location+r()});
          }
        }
        options.sort((a,b)=>a.score-b.score);const chosen=options[0];
        if(!chosen||!reserve(root,chosen.x,chosen.y,chosen.w,chosen.h,upperLiving))return null;
      }
      if(f===0&&hubKey==='dining'&&!reserveMeals(root,true))return null;
      if(f===0&&hubKey!=='dining'){
        const landingAfter=landingRect?.y===stairY+stairH?landingDepth:0,landingBefore=landingRect&&landingRect.y+landingRect.h===stairY?landingDepth:0;
        const minH=Math.ceil(open.minArea/(stairW*.09)),after=ny-stairY-stairH-landingAfter,before=stairY-(f===0&&anchorMode&&entryX<stairX+stairW&&entryX+entryW>stairX?entryY+entryH:0)-landingBefore;
        const below=after>=minH&&(after>=before||before<minH)&&!(f===0&&anchorMode==='hall'&&before>=minH),available=below?after:before;
        const openH=Math.min(available,Math.max(minH,Math.round(open.targetArea/(stairW*.09))));
        const rule=Organization.ACTIVITY_RULES[open.label];
        const alternatives=leaves(root).filter(node=>!node.room&&node.w>=Math.min(rule.w,rule.h)&&node.h>=Math.min(rule.w,rule.h)&&
          ((node.x+node.w===stairX||node.x===stairX+stairW)&&node.y<stairY+stairH&&node.y+node.h>stairY||
           (node.y+node.h===stairY||node.y===stairY+stairH)&&node.x<stairX+stairW&&node.x+node.w>stairX));
        let placed=false;
        for(const node of alternatives){
          const short=Math.max(Math.min(rule.w,rule.h),Math.ceil(open.minWidth/.3));
          const ow=Math.min(node.w,Math.max(short,Math.round(Math.sqrt(open.targetArea/.09))));
          const oh=Math.min(node.h,Math.max(short,Math.ceil(open.targetArea/(ow*.09))));
          if(ow*oh*.09<open.minArea)continue;
          const ox=node.x+node.w===stairX?node.x+node.w-ow:node.x,oy=node.y+node.h===stairY?node.y+node.h-oh:Math.max(node.y,Math.min(stairY,node.y+node.h-oh));
          if(reserve(root,ox,oy,ow,oh,open)){placed=true;break;}
        }
        if(!placed&&(available<minH||!reserve(root,stairX,below?stairY+stairH+landingAfter:stairY-openH-landingBefore,stairW,openH,open)))return null;
      }
      if(f===0&&hubKey!=='dining'&&!reserveMeals(root,false))return null;
      if(f===0&&hubKey==='dining'&&protectLiving){
        const living=rooms.find(room=>room.key==='living'),nodes=leaves(root),diningNodes=nodes.filter(n=>n.room?.key==='dining'),options=[];
        for(let w=Math.ceil(living.minWidth/.3);w<=Math.min(nx,20);w++){
          const h=Math.max(Math.ceil(living.minWidth/.3),Math.ceil(living.targetArea/(w*.09)));
          if(h>ny||Math.max(w,h)/Math.min(w,h)>2.2)continue;
          for(const n of nodes.filter(n=>!n.room))for(const x of [n.x,n.x+n.w-w])for(const y of [n.y,n.y+n.h-h]){
            if(x<0||y<0||x+w>nx||y+h>ny||nodes.some(q=>q.room&&q.x<x+w&&q.x+q.w>x&&q.y<y+h&&q.y+q.h>y))continue;
            const contact=diningNodes.some(q=>((x+w===q.x||q.x+q.w===x)&&y<q.y+q.h&&y+h>q.y)||((y+h===q.y||q.y+q.h===y)&&x<q.x+q.w&&x+w>q.x));
            options.push({x,y,w,h,score:(contact?0:3)+Math.max(w,h)/Math.min(w,h)+r()*.3});
          }
        }
        options.sort((a,b)=>a.score-b.score);const best=options[0];
        if(!best||!reserve(root,best.x,best.y,best.w,best.h,living))return null;
      }
      // Reserve a compact service room beside its kitchen before it becomes a leftover.
      if(f===0&&index%3!==2){
        const utility=rooms.find(room=>room.label===8&&room.functionalRevision===Functional.REVISION&&room.functionalRole!=='entry-storage');
        if(utility){
          const nodes=leaves(root),kitchens=nodes.filter(n=>n.room?.label===3),choices=[];
          const pool=Functional.profile().observations.filter(o=>o.floor===f&&o.label===8).sort((a,b)=>Math.abs(a.shape[0]*a.shape[1]*.09-utility.targetArea)-Math.abs(b.shape[0]*b.shape[1]*.09-utility.targetArea)).slice(0,12);
          for(const o of pool)for(const shape of [o.shape,[...o.shape].reverse()]){
            const scale=Math.sqrt(utility.targetArea/(shape[0]*shape[1]*.09)),w=Math.max(5,Math.round(shape[0]*scale)),h=Math.max(5,Math.round(shape[1]*scale));
            if(!Functional.fits(utility,w,h))continue;
            for(const k of kitchens)for(const [x,y] of [[k.x-w,k.y],[k.x-w,k.y+k.h-h],[k.x+k.w,k.y],[k.x+k.w,k.y+k.h-h],[k.x,k.y-h],[k.x+k.w-w,k.y-h],[k.x,k.y+k.h],[k.x+k.w-w,k.y+k.h]]){
              if(x<0||y<0||x+w>nx||y+h>ny||nodes.some(n=>n.room&&n.x<x+w&&n.x+n.w>x&&n.y<y+h&&n.y+n.h>y))continue;
              if(x!==0&&y!==0&&x+w!==nx&&y+h!==ny)continue;
              choices.push({x,y,w,h,o,score:Math.abs(w*h*.09-utility.targetArea)/utility.targetArea+Math.max(w,h)/Math.min(w,h)+r()*.3});
            }
          }
          choices.sort((a,b)=>a.score-b.score);const best=choices[0];
          if(best&&reserve(root,best.x,best.y,best.w,best.h,utility))serviceEvidence.push({key:utility.key,sourceCase:best.o.case,sourceSha256:Functional.profile().sourceSha256,placement:'kitchen-service-pair',initial:{x:best.x,y:best.y,w:best.w,h:best.h,area:best.w*best.h*.09}});
        }
      }
      const balcony=rooms.find(room=>room.label===ID['阳台']);
      // Pairing is an optional placement aid, with a variable host. Other balconies
      // are placed independently; the final access check chooses their actual host.
      const reserved=room=>leaves(root).some(n=>n.room?.key===room.key)||(f===0&&room===open)||(f===0&&anchorMode==='public'&&!freeAnchors&&hubs.includes(room));
      const hosts=rooms.filter(room=>!reserved(room)&&[ID['客厅'],ID['餐厅'],ID['卧室']].includes(room.label));
      const primary=balcony&&hosts.length&&r()<.7?hosts[Math.floor(r()*hosts.length)]:null;
      const reservedArea=leaves(root).filter(n=>n.room).reduce((sum,n)=>sum+n.w*n.h*.09,0);
      const unplaced=rooms.filter(room=>!leaves(root).some(n=>n.room?.key===room.key));
      const scale=Math.min(1,(nx*ny*.09-reservedArea)/Math.max(.09,unplaced.reduce((sum,room)=>sum+room.targetArea,0)));
      const pair=primary?{key:'pair',targetArea:primary.targetArea+balcony.targetArea,minArea:primary.minArea+balcony.minArea,minWidth:primary.minWidth}:null;
      const pending=[...(pair?[pair]:[]),...rooms.filter(room=>!reserved(room)&&(!pair||![primary,balcony].includes(room))&&!(anchorMode&&f===0&&room.key==='entry'))];
      for(let i=pending.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[pending[i],pending[j]]=[pending[j],pending[i]];}
      // Allocate scarce exterior positions before service rooms and the flexible hub.
      if(f===1||protectLiving||rooms.some(room=>room.label===ID['卧室']))pending.sort((a,b)=>{
        const priority=room=>{
          if(room.label===ID['卧室']||room.key==='pair')return 0;
          if(!protectLiving)return room===open?2:1;
          if([ID['客厅'],ID['餐厅'],ID['厨房'],ID['多功能室']].includes(room.label))return 1;
          return [ID['卫生间'],ID['家政空间']].includes(room.label)?2:3;
        };
        return priority(a)-priority(b);
      });
      // Allocate a room at a corner of any unassigned leaf; split directions and leaf choices vary.
      for(const room of pending) {
        const choices=leaves(root).filter(node=>!node.room&&fits(node,room));
        for(let i=choices.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[choices[i],choices[j]]=[choices[j],choices[i]];}
        let placed=false;
        const prior=neuralPrior?.[room.key==='pair'?primary.key:room.key];
        const energy=(x,y)=>prior?Math.min(100,Math.pow((x/nx-prior.cx)/prior.sx,4)+Math.pow((y/ny-prior.cy)/prior.sy,4)):0;
        if(prior && r()<influence)choices.sort((a,b)=>energy(a.x+a.w/2,a.y+a.h/2)-energy(b.x+b.w/2,b.y+b.h/2));
        for(const node of choices) {
          const min=Math.ceil(room.minWidth/.3-1e-9),publicMin=Math.ceil(open.minWidth/.3-1e-9);
          const area=Math.max(room.minArea,room.targetArea*scale*(.85+r()*.25))/.09;
          const w=Math.min(node.w,Math.max(min,Math.round(Math.sqrt(area)*(.75+r()*.55))));
          const h=Math.min(node.h,Math.max(min,Math.ceil(area/w)));
          if(room.label===ID['卧室']&&Math.max(w,h)/Math.min(w,h)>BEDROOM_RULES.maxAspect+1e-8)continue;
          if(!Functional.fits(room,w,h))continue;
          if(w*h*.09+1e-8<room.minArea || (node.w-w>0&&node.w-w<publicMin)||(node.h-h>0&&node.h-h<publicMin))continue;
          let xHigh=r()<.5,yHigh=r()<.5;
          if(prior && r()<influence) {
            const corners=[[false,false],[true,false],[false,true],[true,true]];
            corners.sort((a,b)=>energy(node.x+(a[0]?node.w-w:0)+w/2,node.y+(a[1]?node.h-h:0)+h/2)-energy(node.x+(b[0]?node.w-w:0)+w/2,node.y+(b[1]?node.h-h:0)+h/2));
            [xHigh,yHigh]=corners[0];
          }
          const frontage=BedroomDaylight.requiredFrontage(room.label);
          if(frontage){
            const corners=[[false,false],[true,false],[false,true],[true,true]].filter(([xh,yh])=>{
              const x=node.x+(xh?node.w-w:0),y=node.y+(yh?node.h-h:0);
              return ((x===0||x+w===nx)&&h*.3+1e-8>=frontage)||((y===0||y+h===ny)&&w*.3+1e-8>=frontage);
            });
            if(!corners.length)continue;
            const servicePosition=corner=>{
              const x=node.x+(corner[0]?node.w-w:0),y=node.y+(corner[1]?node.h-h:0);
              const targets=leaves(root).filter(n=>n.room&&(room.label===8?[3,5].includes(n.room.label):room.label===5?[5,8].includes(n.room.label):false));
              const distance=targets.length?Math.min(...targets.map(n=>Math.max(0,n.x-x-w,x-n.x-n.w)+Math.max(0,n.y-y-h,y-n.y-n.h))):0;
              return distance+(prior?influence*energy(x+w/2,y+h/2)*.15:0);
            };
            if(room.functionalRevision&&[5,8].includes(room.label))corners.sort((a,b)=>servicePosition(a)-servicePosition(b));
            else if(prior&&r()<influence)corners.sort((a,b)=>energy(node.x+(a[0]?node.w-w:0)+w/2,node.y+(a[1]?node.h-h:0)+h/2)-energy(node.x+(b[0]?node.w-w:0)+w/2,node.y+(b[1]?node.h-h:0)+h/2));
            [xHigh,yHigh]=corners[0];
          }
          const xFirst=r()<.5;
          const patchX=node.x+(xHigh?node.w-w:0),patchY=node.y+(yHigh?node.h-h:0);
          if((['entry','pair'].includes(room.key)||room.label===ID['阳台']||room.label===ID['卧室'])&&patchX>0&&patchY>0&&patchX+w<nx&&patchY+h<ny)continue;
          let patch=node;
          for(const axis of xFirst?['x','y']:['y','x']) {
            const size=axis==='x'?w:h,full=axis==='x'?patch.w:patch.h,high=axis==='x'?xHigh:yHigh;
            if(size<full)patch=divide(patch,axis,high?full-size:size)[high?1:0];
          }
          if(room.key==='pair') {
            const axis=patch.x===0||patch.x+patch.w===nx?'x':'y',full=axis==='x'?patch.w:patch.h,cross=axis==='x'?patch.h:patch.w;
            const bMin=Math.max(Math.ceil(balcony.minWidth/.3),Math.ceil(balcony.minArea/(cross*.09)));
            const pMin=Math.max(Math.ceil(primary.minWidth/.3),Math.ceil(primary.minArea/(cross*.09)),primary.label===ID['卧室']?Math.ceil(cross/BEDROOM_RULES.maxAspect):0);
            if(full<bMin+pMin)return null;
            const lower=Math.max(bMin,primary.label===ID['卧室']?full-Math.floor(cross*BEDROOM_RULES.maxAspect):0);
            if(lower>full-pMin)return null;
            const cut=Math.max(lower,Math.min(full-pMin,Math.round(full*balcony.targetArea/room.targetArea)));
            const high=axis==='x'?patch.x!==0:patch.y!==0;
            const pairLeaves=divide(patch,axis,high?full-cut:cut);pairLeaves[high?1:0].room=balcony;pairLeaves[high?0:1].room=primary;
          } else if(room===open&&patch.w>=min+4&&patch.h>=min+4&&r()<.5) {
            const gapW=Math.max(4,Math.floor((patch.w-min)*r())),gapH=Math.max(4,Math.floor((patch.h-min)*r()));
            const parts=divide(patch,'x',gapW),bite=divide(parts[0],'y',gapH);
            parts[1].room=open;bite[1].room=open;
          } else patch.room=room;
          placed=true;break;
        }
        if(!placed)return null;
      }
    }
    let retryUpper=false;
    const materialize=()=>{
      const floors=[],owners=[],spaces=[{id:0,...stair}];
      for(let f=0;f<2;f++) {
        const grid=new Int16Array(nx*ny).fill(-1),map=new Int32Array(nx*ny).fill(-1);
        for(const node of leaves(trees[f])) {
          if(!node.room)continue;
          let sid=spaces.find(room=>room.key===node.room.key)?.id;
          if(sid===undefined){sid=spaces.length;spaces.push({id:sid,...node.room});}
          for(let y=node.y;y<node.y+node.h;y++)for(let x=node.x;x<node.x+node.w;x++){const at=y*nx+x;grid[at]=node.room.label;map[at]=sid;}
        }
        floors.push(grid);owners.push(map);
      }
      let candidate={nx,ny,floors,owners,spaces,daylightPolicy:BedroomDaylight.RULES.revision,mealPolicy:MealGeometry.RULES.revision,organizationPolicy:'activity-protected-v5',publicShapePolicy:'rect-or-L',corridorWidth,anchorMode,geometry:{upperPlacement:'bedrooms-before-service-and-multi',freeAnchors,mealEvidence,stairEvidence:anchor.stairEvidence,publicHubs:hubs.map(s=>s.key),publicHub:hubKey,stairX,stairY,stairW,stairH,entryX:anchorMode?entryX:null,entryW,entryY:anchorMode?entryY:null,entryH:anchorMode?entryH:null,anchorMode,stairPlacement:stairX===0||stairY===0||stairX+stairW===nx||stairY+stairH===ny?'boundary':'interior',localMoves:0,globalAdjustments:[]}};
      candidate.geometry.functionalRevision=Functional.REVISION;candidate.geometry.serviceEvidence=serviceEvidence;
      const record=stage=>{const check=Functional.evaluate(candidate,evaluationProgram);candidate.geometry.functionalStages=[...(candidate.geometry.functionalStages||[]),{stage,issues:check.issues,rooms:check.reports.map(r=>({key:r.key,area:r.area,aspect:r.aspect}))}];};
      const relaxed={...candidate,publicShapePolicy:'activity-verified',floors:floors.map(g=>Int16Array.from(g)),owners:owners.map(g=>Int32Array.from(g)),spaces:spaces.map(s=>({...s}))};
      if(!routeAndFill(candidate,program)){candidate=relaxed;if(!routeAndFill(candidate,program)&&candidate.owners.some(map=>Array.from(map).some(id=>id<0))){if(diagnostics)diagnostics.rejectionChecks.fill++;return null;}}
      record('after-routing-and-fill');
      if(!validateProgram(candidate,evaluationProgram).accepted)candidate=repairPublicIntegrity(candidate,evaluationProgram);
      record('after-public-integrity');
      if(resourceProgram&&!validateProgram(candidate,evaluationProgram).accepted){
        candidate=coordinateResources(candidate,evaluationProgram);
        if(!validateProgram(candidate,evaluationProgram).accepted)candidate=repairPublicIntegrity(candidate,evaluationProgram);
      }
      record('after-resource-coordination');
      const programCheck=validateProgram(candidate,evaluationProgram);
      const lowerKeys=program.filter(room=>room.floor===0).map(room=>room.key);
      retryUpper=!programCheck.issues.some(issue=>lowerKeys.some(key=>issue.startsWith(key)))&&candidate.owners[0].every(id=>id>=0);
      if(!roomConnectivity(candidate)||!programCheck.accepted){if(diagnostics){diagnostics.rejectionChecks.dimensions++;if(diagnostics.examples.length<5)diagnostics.examples.push({stage:'program',issues:programCheck.issues});}return null;}
      const organized=repairOrganization(candidate,evaluationProgram,diagnostics);
      return organized?coordinateCirculation(organized,evaluationProgram):null;
    };
    const accepted=candidate=>{
      if(!candidate||!roomConnectivity(candidate)||!validateProgram(candidate,evaluationProgram).accepted)return false;
      if(!assessCandidate(candidate).reachable){if(diagnostics)diagnostics.rejectionChecks.access++;return false;}
      if(!validateAnchors(candidate).accepted){if(diagnostics)diagnostics.rejectionChecks.anchors++;return false;}
      return true;
    };
    const preference=candidate=>{const actual=program.some(r=>r.circulationRevision===Traffic.REVISION)?Traffic.actualBudget(candidate,evaluationProgram):{program:evaluationProgram};const check=validateProgram(candidate,actual.program);return assessCandidate(candidate).score+(program.some(r=>r.circulationRevision===Traffic.REVISION)?Traffic.evaluate(candidate,evaluationProgram).penalty:0)+MealGeometry.evaluate(candidate).penalty+check.reports.reduce((sum,room)=>sum+areaDeviation(room,room.area)*20,0)+check.corridorBudgets.reduce((sum,b)=>sum+b.excessArea/(nx*ny*.09)*30,0)+influence*50*neuralEnergy(candidate,neuralPrior);};
    let candidate=materialize();
    if(!accepted(candidate)){
      // Preserve a usable downstairs meal arrangement while locally resampling
      // upstairs, rather than throwing away both floors for one failed bedroom.
      if(refine&&retryUpper&&upperVariant<3){if(diagnostics)diagnostics.upperRepartitions=(diagnostics.upperRepartitions||0)+1;return freePartitionAttempt(nx,ny,seed,index,evaluationProgram,corridorWidth,neuralPrior,influence,anchorMode,diagnostics,anchorOverride,refine,upperVariant+1,pairedOverride,protectLiving);}
      return null;
    }
    // Repartition sibling leaves locally; reject moves that break sizes, access or identities.
    const parents=node=>node.children?[node,...node.children.flatMap(parents)]:[];
    for(let step=0;step<12;step++) {
      const fixedKeys=anchorMode?['stairs','entry',...(anchorMode==='public'?hubs.map(s=>s.key):[])]:['stairs'];
      const choices=trees.flatMap(parents).filter(node=>node.children.every(child=>!child.children&&!fixedKeys.includes(child.room?.key))&&node.children[0].room?.key!==node.children[1].room?.key);
      if(!choices.length)break;
      const node=choices[Math.floor(r()*choices.length)],saved=node.children,oldCut=node.cut;
      const cut=oldCut+Math.floor(r()*7)-3,full=node.axis==='x'?node.w:node.h;
      if(cut<=0||cut>=full||cut===oldCut)continue;
      const children=divide(node,node.axis,cut);children[0].room=saved[0].room;children[1].room=saved[1].room;
      const next=materialize();
      if(accepted(next)&&preference(next)<preference(candidate)){next.geometry.localMoves=candidate.geometry.localMoves+1;candidate=next;}
      else {node.children=saved;node.cut=oldCut;}
    }
    if(refine){
      candidate=rebalancePublic(candidate,evaluationProgram,preference,accepted);
      const axial=entryX===stairX;
      const nearby=corePositions.filter(x=>x!==stairX).sort((a,b)=>Math.abs(a-stairX)-Math.abs(b-stairX)).slice(0,2);
      const shifts=[...nearby.map(x=>({stairX:x,...(axial?{entryX:x}:{})})),
        ...(anchorMode==='near'?[]:[{stairY:stairY+3}]),{entryX:entryX===0?Math.min(3,stairX-entryW):Math.max(0,entryX-3)}];
      for(const change of shifts){
        if(Object.values(change).some(v=>v<0)||change.stairX+stairW>nx||change.stairY+stairH>ny)continue;
        if(diagnostics)diagnostics.globalTrials++;
        const next=freePartitionCandidate(nx,ny,seed,index,program,corridorWidth,neuralPrior,influence,anchorMode,diagnostics,{stairX,stairY,entryX,...change},false);
        if(accepted(next)&&preference(next)<preference(candidate)){
          next.geometry.globalAdjustments=[...candidate.geometry.globalAdjustments,{change,beforeScore:preference(candidate),afterScore:preference(next)}];candidate=next;
        }
      }
      // A coupled whole-house reflection preserves both floors and room identities,
      // while letting model/facade preferences revise the original anchor side.
      const mirrored={...candidate,organization:null,
        owners:candidate.owners.map(map=>Int32Array.from(map,(_,i)=>map[Math.floor(i/nx)*nx+nx-1-i%nx])),
        floors:candidate.floors.map(map=>Int16Array.from(map,(_,i)=>map[Math.floor(i/nx)*nx+nx-1-i%nx])),
        geometry:{...candidate.geometry,stairX:nx-candidate.geometry.stairX-stairW,entryX:nx-candidate.geometry.entryX-entryW}};
      if(diagnostics)diagnostics.globalTrials++;
      if(accepted(mirrored)&&preference(mirrored)<preference(candidate)){
        mirrored.geometry.globalAdjustments=[...candidate.geometry.globalAdjustments,{change:{wholeHouse:'horizontal-reflection'},beforeScore:preference(candidate),afterScore:preference(mirrored)}];candidate=mirrored;
      }
    }
    return candidate;
  }

  function validateAnchors(candidate) {
    const mode=candidate.anchorMode||candidate.generation?.geometry?.anchorMode;
    if(!mode)return {accepted:true,mode:null};
    const map=(candidate.owners||candidate.floorSpaces)[0],nx=candidate.nx;
    const sid=key=>candidate.spaces.find(s=>s.key===key)?.id;
    const geometry=candidate.geometry||candidate.generation?.geometry;
    const hub=geometry?.publicHub||'dining';
    const entry=sid('entry'),stairs=sid('stairs'),via=sid(hub);
    const touching=(a,b)=>a!==undefined&&b!==undefined&&Array.from(map).some((s,i)=>s===a&&neighbors(i,nx,map.length/nx,1).some(j=>map[j]===b));
    const entrance=geometry?.stairEvidence?map.includes(entry):Array.from(map.slice(0,nx)).some(s=>s===entry);
    const hubs=candidate.geometry?.publicHubs||candidate.generation?.geometry?.publicHubs||[hub];
    const chain=mode==='near'||mode==='hall'?['entry','stairs']:['entry',...hubs,'stairs'];
    let connected=chain.slice(1).every((key,i)=>touching(sid(chain[i]),sid(key)));
    const direct=touching(entry,stairs);
    const xRange=id=>{const cells=Array.from(map).flatMap((owner,i)=>owner===id?[i%nx]:[]);return [Math.min(...cells),Math.max(...cells)+1];};
    const [ex0,ex1]=xRange(entry),[sx0,sx1]=xRange(stairs),xOverlap=ex0<sx1&&ex1>sx0;
    if(geometry?.freeAnchors)connected=(mode==='near'?direct:!direct)&&map.includes(stairs)&&(mode!=='hall'||!xOverlap)&&(mode!=='public'||xOverlap);
    // A sampled relation is a preference. Boundary balancing may improve it;
    // actual doors and per-floor reachability remain the acceptance gates.
    if(geometry?.stairEvidence)connected=map.includes(stairs)&&map.includes(entry);
    const doors=candidate.organization?.connections||candidate.connections;
    let actualChain=chain;
    if(doors){
      const queue=[entry],previous=new Map([[entry,null]]);
      for(let head=0;head<queue.length;head++)for(const edge of doors.filter(e=>e.floor===0&&(e.a===queue[head]||e.b===queue[head]))){const next=edge.a===queue[head]?edge.b:edge.a;if(queue[head]!==stairs&&!previous.has(next)&&(next===stairs||isTransit(candidate.spaces[next]?.label))){previous.set(next,queue[head]);queue.push(next);}}
      if(previous.has(stairs)){actualChain=[];for(let at=stairs;at!==null;at=previous.get(at))actualChain.unshift(candidate.spaces[at].key);}else connected=false;
    }
    const relation=direct?'direct':!xOverlap?'offset':'separated';
    return {accepted:entrance&&connected,mode,relation,directContact:direct,publicHub:hub,publicHubs:hubs,entranceSide:geometry?.entryY?'unspecified':'front',chain:actualChain,issues:entrance&&connected?[]:['玄关位置、玄关—楼梯关系或受保护公共通路检查失败']};
  }

  function neuralEnergy(candidate,priors) {
    if(!priors)return 0;
    let sum=0,count=0;
    for(let f=0;f<2;f++)for(const room of candidate.spaces) {
      const p=priors[room.key];if(!p)continue;
      const cells=[];for(let i=0;i<candidate.owners[f].length;i++)if(candidate.owners[f][i]===room.id)cells.push(i);
      if(!cells.length)continue;
      const cx=cells.reduce((s,i)=>s+(i%candidate.nx+.5)/candidate.nx,0)/cells.length;
      const cy=cells.reduce((s,i)=>s+(Math.floor(i/candidate.nx)+.5)/candidate.ny,0)/cells.length;
      sum+=Math.abs(cx-p.cx)+Math.abs(cy-p.cy);count++;
    }
    return sum/Math.max(1,count);
  }

  function diverseCandidates(candidates) {
    if(!candidates.length)return [];
    const contacts=candidate=>{
      const pairs=new Map();
      for(let f=0;f<2;f++)for(let i=0;i<candidate.owners[f].length;i++) {
        const map=candidate.owners[f];
        for(const j of [i%candidate.nx<candidate.nx-1?i+1:-1,i+candidate.nx<map.length?i+candidate.nx:-1])
          if(j>=0&&map[i]!==map[j])pairs.set(`${f}:${[map[i],map[j]].sort((a,b)=>a-b).join(':')}`,`${f}:`+[candidate.spaces[map[i]].label,candidate.spaces[map[j]].label].sort((a,b)=>a-b).join(':'));
      }
      // Count contacts by function, so exchanging two identical bedrooms is not diversity.
      const counts=new Map(),edges=new Set();
      for(const type of pairs.values()){const count=counts.get(type)||0;edges.add(`${type}#${count}`);counts.set(type,count+1);}
      return edges;
    };
    const pool=candidates.filter(candidate=>candidate.quality.score<=candidates[0].quality.score*1.3+10).map(candidate=>({candidate,edges:contacts(candidate)}));
    const selected=[pool.shift()];
    const distance=(a,b)=>1-[...a.edges].filter(edge=>b.edges.has(edge)).length/new Set([...a.edges,...b.edges]).size;
    while(selected.length<4&&pool.length) {
      const best=pool.findIndex(item=>selected.every(previous=>distance(item,previous)>.20));
      if(best<0)break;
      selected.push(pool.splice(best,1)[0]);
    }
    return selected.map(item=>item.candidate);
  }

  function selectPortfolio(models,limit=4){
    if(!models.length)return [];
    const sorted=[...models].sort((a,b)=>a.generation.score-b.generation.score);
    const eligible=sorted.filter(m=>m.generation.score<=sorted[0].generation.score*1.35+15);
    const signature=m=>{
      const edges=new Map();
      for(const e of m.connections){const labels=[m.spaces[e.a].label,m.spaces[e.b].label].sort((a,b)=>a-b),key=`${e.floor}:${labels.join(':')}`;edges.set(key,(edges.get(key)||0)+1);}
      return [...edges].sort().map(([key,n])=>`${key}:${n}`).join('|');
    };
    const different=(a,b)=>a.anchorValidation.relation!==b.anchorValidation.relation||
      (a.generation.corridorFraction>0)!==(b.generation.corridorFraction>0)||signature(a)!==signature(b);
    const selected=[eligible[0]];
    // First preserve real entrance/stair relations, then meaningful circulation alternatives.
    for(const relation of [...new Set(eligible.map(m=>m.anchorValidation.relation))]){
      const model=eligible.find(m=>m.anchorValidation.relation===relation);
      if(selected.length<limit&&!selected.includes(model))selected.push(model);
    }
    for(const model of eligible)if(selected.length<limit&&!selected.includes(model)&&selected.every(m=>different(m,model)))selected.push(model);
    return selected.sort((a,b)=>a.generation.score-b.generation.score);
  }

  function buildLayout({ length, width, seed, plan = null, roomProgram = null, searchMode = 'classic', corridorWidth = 1.2, neuralPrior=null, influence=0, candidateBudget=null, anchorMode=null, onCandidateProgress=null, onFirstLayout=null }) {
    if(anchorMode!==null&&(!['near','hall','public'].includes(anchorMode)||searchMode!=='free'))throw new Error('入口—楼梯模式须用于自由分割，支持 near、hall、public。');
    if (![length, width].every(n => Number.isInteger(n) && n >= 6000 && n <= 18000 && n % RULES.cell === 0)) {
      throw new Error('请输入6000–18000 mm且可被300 mm整除的长度和宽度。');
    }
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('随机种子须为0–4294967295的整数。');
    if (plan) {
      const options = { publicSide: ['left', 'right'], balconyEnd: ['front', 'back'], bathroomSide: ['public', 'service'], upperRight: ['bedroom_first', 'multifunction_first'], coreWidth: ['narrow', 'standard', 'wide'] };
      if (Object.entries(options).some(([key, values]) => !values.includes(plan[key]))) throw new Error('需求中存在不支持的布局参数。');
    }
    const nx = length / RULES.cell, ny = width / RULES.cell, slab = nx * ny;
    if(roomProgram) {
      if(!Array.isArray(roomProgram)||!roomProgram.length || roomProgram.length>30 || new Set(roomProgram.map(room=>room.key)).size!==roomProgram.length ||
        roomProgram.some(room=>typeof room.key!=='string'||!Number.isInteger(room.label)||!LABELS[room.label]||![0,1].includes(room.floor)||![room.targetArea,room.minArea,room.minWidth].every(n=>Number.isFinite(n)&&n>0)||room.targetArea<room.minArea)) throw new Error('房间清单无效：目标面积不得小于最小面积，面积和宽度须为正数。');
      const required=createRoomProgram(1,0,[0,0]).filter(room=>room.label!==ID['卧室']);
      if(required.some(room=>!roomProgram.some(p=>p.key===room.key&&p.label===room.label&&p.floor===room.floor)) || !roomProgram.some(room=>room.label===ID['卧室'])) throw new Error('房间清单缺少基本功能或卧室。');
      const optional=room=>room.label===ID['卧室']&&/^bedroom-\d+$/.test(room.key)||room.label===ID['卫生间']&&/^bathroom-\d+$/.test(room.key)||room.label===ID['阳台']&&new RegExp(`^balcony-${room.floor}(?:-[2-4])?$`).test(room.key)||room.floor===1&&(room.key==='living-1'&&room.label===ID['客厅']||room.key==='utility-1'&&room.label===ID['家政空间']);
      if(roomProgram.some(room=>!required.some(base=>base.key===room.key) && !optional(room)))throw new Error('房间清单包含不支持的功能或标识');
      for(let f=0;f<2;f++) {
        const minimum=roomProgram.filter(room=>room.floor===f).reduce((sum,room)=>sum+room.minArea,0)+3.24;
        if(minimum>slab*.09) throw new Error(`${f+1}层最低需要${minimum.toFixed(1)} m²（含楼梯），当前仅${(slab*.09).toFixed(1)} m²。请减少房间或增大体块。`);
      }
    }
    if(!['classic','free'].includes(searchMode)||searchMode==='free'&&(!roomProgram||plan))throw new Error('自由分割试验需要房间清单，暂不支持自然语言位置计划。');
    if(searchMode==='free'&&(!Number.isFinite(corridorWidth)||corridorWidth<.6||corridorWidth>3||Math.abs(corridorWidth/.3-Math.round(corridorWidth/.3))>1e-8))throw new Error('走道通行带宽须为0.6–3 m且符合0.3 m网格。');
    if(!Number.isFinite(influence)||influence<0||influence>1)throw new Error('引导强度须为0–1');
    if(influence===0)neuralPrior=null;
    if(candidateBudget!==null && (!Number.isInteger(candidateBudget)||candidateBudget<1||candidateBudget>4800))throw new Error('候选预算须为1–4800整数');
    const budget=candidateBudget??(searchMode==='free'?2400:roomProgram?Math.min(240,48+roomProgram.length*8):SEARCH_BUDGET);
    const diagnostics={attempts:budget,rejectionChecks:{partition:0,fill:0,dimensions:0,activity:0,access:0,anchors:0},globalTrials:0,corridorTrials:0,corridorRepairs:0,examples:[]};
    const candidates = [];
    function validatedModel(c) {
      const voxels = new Int16Array(slab * TOTAL_CELLS), spaceIds = new Int32Array(voxels.length);
      for (let z = 0; z < TOTAL_CELLS; z++) {
        const f = Math.floor(z / FLOOR_CELLS);
        voxels.set(c.floors[f], z * slab); spaceIds.set(c.owners[f], z * slab);
      }
      const actualCoordination=roomProgram?.some(r=>r.circulationRevision===Traffic.REVISION)?Traffic.actualBudget(c,roomProgram):null;
      const model = { nx, ny, nz: TOTAL_CELLS, cell: RULES.cell, floorCount: RULES.floorCount,
        floorHeight: RULES.floorHeight, seed, voxels, spaceIds, spaces: c.spaces, floors: c.floors,
        floorSpaces: c.owners, traffic:roomProgram?.some(r=>r.circulationRevision===Traffic.REVISION)?Traffic.evaluate(c,roomProgram):undefined,functional:Functional.evaluate(c,actualCoordination?.program||roomProgram||[]),functionalRelations:c.quality.functionalRelations,daylightPolicy:c.daylightPolicy,daylight:c.daylightPolicy?BedroomDaylight.evaluate(c):undefined,mealPolicy:c.mealPolicy,mealGeometry:c.mealPolicy?MealGeometry.evaluate(c):undefined,kitchenDining:c.quality.kitchenDining, connections: c.quality.doors, organization:c.organization,organizationPolicy:c.organizationPolicy,publicShapePolicy:c.publicShapePolicy, corridorWidth:c.corridorWidth,
        generation: { functionalRevision:roomProgram?.some(r=>r.functionalRevision)?Functional.REVISION:undefined,areaBudgetRevision:roomProgram?.some(r=>r.areaBudgetRevision)?'joint-area-v1':undefined,floorProgramRevision:'floor-program-v1',ruleRevision:'stair-terminal-v6',shapeRevision:'public-shape-v1',entryRevision:ENTRY_RULES.revision,stairRevision:searchMode==='free'?'stair-joint-v1':undefined,diagnostics,organization:c.organization,routingEvidence:c.routingEvidence,bedroomRules:BEDROOM_RULES,strategy: searchMode==='free'?'free-bsp-local':roomProgram?'room-program-partition':'shared-open-circulation', candidateCount: budget,
          selectedCandidate: c.index, geometry: c.geometry, score: c.quality.score,
          neuralEnergy:c.quality.neuralEnergy, neuralUsed:!!neuralPrior, influence,
          validCandidateCount:candidates.length,
          candidateScores: candidates.map(candidate => ({ index: candidate.index, score: candidate.quality.score,
            stairPlacement: candidate.geometry.stairPlacement, stairDaylightPenalty: candidate.quality.penalties.stairDaylight, stairDaylightPotential: candidate.quality.stairDaylight.potential })),
          reachable: c.quality.reachable, corridorFraction: c.quality.corridorFraction,
          openFraction: c.quality.openFraction, stairDaylight: c.quality.stairDaylight, openTraversal: c.quality.openTraversal, repairCount: c.repairs, wetAlignment: c.quality.wetAlignment,
          areaReports: c.quality.areaReports, relations: c.quality.relations, penalties: c.quality.penalties } };
      if(actualCoordination){const {program:actualProgram,...budgetReport}=actualCoordination;model.generation.geometry.actualAreaCoordination=budgetReport;}
      model.validation = validateLayout(model);
      if(roomProgram?.some(r=>r.functionalRevision))model.generation.geometry={...model.generation.geometry,functionalStages:[...(model.generation.geometry.functionalStages||[]),{stage:'final-export-check',issues:model.functional.issues,rooms:model.functional.reports.map(r=>({key:r.key,area:r.area,aspect:r.aspect}))}]};
      model.anchorValidation=validateAnchors(model);
      model.circulation = validateCirculation(model);
      if(roomProgram)model.programValidation=validateProgram(model,roomProgram);
      return model.validation.accepted && model.circulation.accepted && model.programValidation?.accepted!==false && model.anchorValidation.accepted && model.functional.accepted && model.functionalRelations.accepted && model.traffic?.accepted!==false && actualCoordination?.accepted!==false ? model : null;
    }
    let firstLayoutSent=false;
    for (let index = 0; index < budget; index++) {
      if(index%100===0)onCandidateProgress?.(index,budget);
      const candidate = searchMode==='free'?freePartitionCandidate(nx,ny,seed,index,roomProgram,corridorWidth,neuralPrior,influence,anchorMode,diagnostics):roomProgram?programCandidate(nx,ny,seed,plan,index,roomProgram):partitionCandidate(nx, ny, seed, plan, index);
      if(!candidate){diagnostics.rejectionChecks.partition++;continue;}
      if(roomProgram?.some(r=>r.circulationRevision===Traffic.REVISION)&&!Traffic.evaluate(candidate,roomProgram).accepted){diagnostics.rejectionChecks.traffic=(diagnostics.rejectionChecks.traffic||0)+1;continue;}
      if (!roomConnectivity(candidate)) continue;
      const result = roomProgram?{quality:assessCandidate(candidate),repairs:0}:repairAccess(candidate);
      if(roomProgram) {
        const actual=roomProgram.some(r=>r.circulationRevision===Traffic.REVISION)?Traffic.actualBudget(candidate,roomProgram):{program:roomProgram};
        const check=validateProgram(candidate,actual.program);
        if(!result.quality.reachable || !check.accepted)continue;
        result.quality.score+=check.reports.reduce((sum,room)=>sum+areaDeviation(room,room.area)*20,0)+check.corridorBudgets.reduce((sum,b)=>sum+b.excessArea/(slab*.09)*30,0);
        if(candidate.mealPolicy)result.quality.score+=MealGeometry.evaluate(candidate).penalty;
      }
      if (result) { result.quality.neuralEnergy=neuralEnergy(candidate,neuralPrior);
        result.quality.score+=influence*50*result.quality.neuralEnergy;
        candidate.quality = result.quality; candidate.repairs = result.repairs; candidate.index = index; candidates.push(candidate);
        if(onFirstLayout&&!firstLayoutSent){const model=validatedModel(candidate);if(model){firstLayoutSent=true;onFirstLayout(model,index+1,budget);}}
      }
    }
    candidates.sort((a, b) => a.quality.score - b.quality.score || a.index - b.index);
    const choices=searchMode==='free'?diverseCandidates(candidates):candidates,models=[];
    for (const c of choices) {
      const model=validatedModel(c);
      if(model) {
        if(searchMode!=='free')return model;
        models.push(model);
      }
    }
    if(models.length) {
      for(const model of models)model.generation.comparisonScores=models.map(item=>item.generation.score);
      models[0].alternatives=models.slice(1);return models[0];
    }
    const error=new Error(`当前${budget}个候选内未找到满足空间连通、尺寸与通行要求的方案。可调整面积、数量、体块或种子；搜索失败不代表需求不可实现。`);error.diagnostics=diagnostics;throw error;
  }

  function buildLayoutOptions(options,onProgress=()=>{}) {
    const modes=['near','hall','public'],budget=options.candidateBudget??2400;
    if(!Number.isInteger(budget)||budget<1||budget>4800)throw new Error('候选预算须为1–4800整数');
    const profile=typeof require==='function'?require('./stair-prior.json'):root.StairPriorProfile;
    const area=options.length*options.width/1e6,aspect=Math.max(options.length,options.width)/Math.min(options.length,options.width);
    const peers=profile.observations.slice().sort((a,b)=>(Math.abs(Math.log(a.houseArea/area))+Math.abs(a.houseAspect-aspect))-(Math.abs(Math.log(b.houseArea/area))+Math.abs(b.houseAspect-aspect))).slice(0,80);
    const counts=modes.map(mode=>peers.filter(o=>o.mode===mode).length),near=Math.max(.1,counts[0]/peers.length),other=Math.max(1,counts[1]+counts[2]);
    const weights=[near,(1-near)*counts[1]/other,(1-near)*counts[2]/other],shares=weights.map(w=>Math.floor(budget*w));
    for(let left=budget-shares.reduce((a,b)=>a+b,0),i=0;left>0;left--,i++)shares[[1,2,0][i%3]]++;
    const searches=[],pool=[],representatives=[];
    for(let i=0;i<modes.length;i++){
      const mode=modes[i],share=shares[i];
      onProgress(mode,i+1,modes.length);
      if(!share){searches.push({mode,budget:0,validCandidateCount:0,status:'skipped'});continue;}
      let model;
      try{model=buildLayout({...options,anchorMode:mode,candidateBudget:share,onCandidateProgress:(done,total)=>options.onCandidateProgress?.(mode,done,total),onFirstLayout:options.onLayout?(first,done)=>{
        const chosen=selectPortfolio([...pool,first]);
        options.onLayout(chosen,{policy:'all-anchor-modes',budget,partial:true,validCandidateCount:searches.reduce((sum,s)=>sum+s.validCandidateCount,0)+first.generation.validCandidateCount,selectedCount:chosen.length,searches:[...searches,{mode,budget:share,completedCandidates:done,validCandidateCount:first.generation.validCandidateCount,status:'running'}]});
      }:null});}
      catch(e){if(!e.message.startsWith('当前')||!e.message.includes('个候选内未找到'))throw e;
        searches.push({mode,budget:share,validCandidateCount:0,status:'not_found',diagnostics:e.diagnostics});continue;}
      searches.push({mode,budget:share,validCandidateCount:model.generation.validCandidateCount,status:'found',diagnostics:model.generation.diagnostics});
      representatives.push(model);pool.push(model,...(model.alternatives||[]));
      if(options.onLayout){const chosen=selectPortfolio(pool);options.onLayout(chosen,{policy:'all-anchor-modes',budget,partial:true,validCandidateCount:searches.reduce((sum,s)=>sum+s.validCandidateCount,0),selectedCount:chosen.length,searches:[...searches]});}
    }
    if(!representatives.length){const error=new Error(`当前总预算${budget}个候选内，各布局模式均未找到合格方案。请增加预算、换种子或调整尺寸与房间数量。`);error.searchSummary={policy:'all-anchor-modes',budget,validCandidateCount:0,selectedCount:0,searches};throw error;}
    // Keep quality-comparable, structurally different options; never pad to four.
    const compare=(a,b)=>a.generation.score-b.generation.score;
    pool.sort(compare);
    const chosen=selectPortfolio(pool);
    chosen.sort(compare);
    for(const search of searches){
      search.selectedCount=chosen.filter(m=>m.anchorValidation.mode===search.mode).length;
      const scores=pool.filter(m=>m.anchorValidation.mode===search.mode).map(m=>m.generation.score);
      if(scores.length){search.bestScore=Math.min(...scores);search.selectionNote=search.selectedCount?'selected':search.bestScore>chosen[0].generation.score*1.35+15?'outside-comparable-quality':'duplicate-access-structure-or-portfolio-limit';}
    }
    for(const model of chosen){delete model.alternatives;model.generation.comparisonScores=chosen.map(m=>m.generation.score);}
    chosen[0].alternatives=chosen.slice(1);
    return {model:chosen[0],searchSummary:{policy:'all-anchor-modes',budget,validCandidateCount:searches.reduce((sum,s)=>sum+s.validCandidateCount,0),selectedCount:chosen.length,selectedRelations:[...new Set(chosen.map(m=>m.anchorValidation.relation))],selectionPolicy:'protected-activity-quality-first; comparable-score; distinct-relations-and-access-graphs',searches}};
  }

  const api = Object.freeze({ RULES, ENTRY_RULES, entryMaxArea, BEDROOM_RULES, FLOOR_CELLS, TOTAL_CELLS, LABELS, ID, SEARCH_BUDGET, OPEN_LABELS, createRoomProgram, sampleStairAnchor, classifySpaceShape, validateProgram, buildLayout, buildLayoutOptions, selectPortfolio,validateLayout, validateCirculation, validateAnchors, repairAccess, coordinateResources, coordinateCirculation, interiorTopologyCandidate });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LayoutCore = api;
})(globalThis);
