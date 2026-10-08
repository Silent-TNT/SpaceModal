(function (root) {
  'use strict';

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
    ['厨房', '餐厅', 5], ['客厅', '餐厅', 2], ['客厅', '阳台', 3],
    ['家政空间', '厨房', 2], ['家政空间', '卫生间', 1], ['卧室', '卫生间', 2]
  ]);

  const OPEN_LABELS = Object.freeze(['玄关', '客厅', '餐厅', '多功能室'].map(name => ID[name]));
  const isTransit = label => OPEN_LABELS.includes(label) || label === ID['楼梯间'] || label === ID['过道'];

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
    const entry = spaces.find(space => space.label === ID['玄关']);
    if (!entry) return { accepted: false, reachable: false, issues: ['缺少玄关'], inaccessible: spaces.map(s => s.id) };
    const transit = new Set([entry.id]), queue = [entry.id];
    for (let head = 0; head < queue.length; head++) for (const next of graph[queue[head]]) {
      if (!transit.has(next) && isTransit(spaces[next].label)) { transit.add(next); queue.push(next); }
    }
    const reached = new Set(transit);
    for (const sid of transit) for (const next of graph[sid]) reached.add(next);
    for (const sid of [...reached]) for (const next of graph[sid]) {
      if (spaces[next].label === ID['阳台'] && [ID['客厅'], ID['卧室']].includes(spaces[sid].label) ||
          spaces[next].label === ID['家政空间'] && spaces[sid].label === ID['厨房']) reached.add(next);
    }
    const inaccessible = spaces.filter(s => !reached.has(s.id)).map(s => s.id);
    if (inaccessible.length) issues.push('存在只能穿过独立房间才能到达的空间');
    return { accepted: issues.length === 0, reachable: issues.length === 0, issues, inaccessible, transit: [...transit] };
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
    function portal(e, kind) {
      const face = e.faces[Math.floor(e.faces.length / 2)];
      return { a: e.a, b: e.b, floor: e.floor, ...face, kind };
    }
    const doors = edges.filter(e => isTransit(spaces[e.a].label) && isTransit(spaces[e.b].label))
      .map(e => portal(e, OPEN_LABELS.includes(spaces[e.a].label) && OPEN_LABELS.includes(spaces[e.b].label) ? 'open' : 'access'));
    const circulation = validateCirculation({ spaces, connections: doors });
    const accessibleTransit = new Set(circulation.transit || []);
    for (const room of spaces) {
      if (isTransit(room.label)) continue;
      const adjacent = edges.filter(e => e.a === room.id || e.b === room.id);
      const opposite = e => e.a === room.id ? e.b : e.a;
      let options;
      if (room.label === ID['阳台']) {
        options = adjacent.filter(e => [ID['客厅'], ID['卧室']].includes(spaces[opposite(e)].label));
      } else options = adjacent.filter(e => accessibleTransit.has(opposite(e)));
      const preference = e => {
        const label = spaces[opposite(e)].label;
        if (room.label===ID['厨房'] && label===ID['餐厅']) return 0;
        return OPEN_LABELS.includes(label) ? 1 : label===ID['过道'] ? 2 : 3;
      };
      options.sort((a,b) => preference(a)-preference(b) || b.faces.length - a.faces.length || a.a - b.a || a.b - b.b);
      if (options.length) doors.push(portal(options[0], 'door'));
    }
    const access = validateCirculation({ spaces, connections: doors });
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
    const score = areaPenalty * 40 + shapePenalty * 2 + exteriorPenalty * 20 +
      corridorFraction * 100 + adjacencyPenalty * 2 + (1 - wetAlignment) * 5 + openTraversal * 2 + stairDaylightPenalty * 12 + facadeCompetition * 8;
    return { score, reachable: access.accepted, access, doors, areaReports: reports, relations: relationReports, wetAlignment,
      corridorFraction, openFraction, openTraversal, stairDaylight,
      penalties: { area: areaPenalty, shape: shapePenalty, exterior: exteriorPenalty,
        circulation: corridorFraction, adjacency: adjacencyPenalty, openTraversal,
        stairDaylight: stairDaylightPenalty, facadeCompetition } };
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

  function createRoomProgram(bedrooms = 2, bathrooms = 2) {
    if (!Number.isInteger(bedrooms) || bedrooms < 1 || bedrooms > 8 || !Number.isInteger(bathrooms) || bathrooms < 0 || bathrooms > 8)
      throw new Error('卧室数量须为1–8，卫生间数量须为0–8。');
    const rooms = [];
    const add = (key, label, floor, targetArea, minArea, minWidth) => rooms.push({key,label:ID[label],floor,targetArea,minArea,minWidth});
    add('entry','玄关',0,3,1.8,.9); add('living','客厅',0,30,12,2.4);
    add('dining','餐厅',0,20,8,1.8); add('kitchen','厨房',0,12,5,1.5);
    add('utility','家政空间',0,5,2,1.2); add('balcony-0','阳台',0,6,2, .9);
    add('multi','多功能室',1,25,8,1.8); add('balcony-1','阳台',1,6,2,.9);
    for(let i=0;i<bedrooms;i++) add(`bedroom-${i+1}`,'卧室',1,16,9,2.1);
    for(let i=0;i<bathrooms;i++) add(`bathroom-${i+1}`,'卫生间',i%2,5,3,1.2);
    return rooms;
  }

  function classifySpaceShape(map,nx,sid) {
    const ny=map.length/nx,at=(x,y)=>x>=0&&y>=0&&x<nx&&y<ny&&map[y*nx+x]===sid;
    let convex=0,concave=0,pinch=false,count=0;
    for(const owner of map)count+=owner===sid;
    for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++) {
      const a=at(x-1,y-1),b=at(x,y-1),c=at(x,y),d=at(x-1,y),n=Number(a)+Number(b)+Number(c)+Number(d);
      if(n===1)convex++;if(n===3)concave++;
      if(n===2&&a===c&&b===d)pinch=true;
    }
    return count&&!pinch&&convex-concave===4?(concave===0?'rectangle':concave===1?'L':'complex'):'complex';
  }

  function corridorCoverage(grid,nx,width) {
    const ny=grid.length/nx,stride=nx+1,prefix=new Int32Array((nx+1)*(ny+1)),covered=new Uint8Array(grid.length);
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)prefix[(y+1)*stride+x+1]=prefix[y*stride+x+1]+prefix[(y+1)*stride+x]-prefix[y*stride+x]+(!isTransit(grid[y*nx+x]));
    for(let y=0;y<=ny-width;y++)for(let x=0;x<=nx-width;x++) {
      const bad=prefix[(y+width)*stride+x+width]-prefix[y*stride+x+width]-prefix[(y+width)*stride+x]+prefix[y*stride+x];
      if(!bad)for(let yy=y;yy<y+width;yy++)for(let xx=x;xx<x+width;xx++)covered[yy*nx+xx]=1;
    }
    return covered;
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
      // A bounding box alone cannot prove usable width after carving an open room.
      if((cells.length!==w*h && !OPEN_LABELS.includes(room.label)) || area+1e-8<room.minArea || width+1e-8<room.minWidth) issues.push(`${room.key}未满足最小面积或宽度`);
      const shape=cells.length===w*h?'rectangle':classifySpaceShape(map,model.nx,sid);
      if(model.publicShapePolicy&&[ID['餐厅'],ID['多功能室']].includes(room.label)&&!['rectangle','L'].includes(shape))issues.push(`${room.key}必须为矩形或L型，不能有孔洞或多处分叉`);
      reports.push({key:room.key,spaceId:sid,floor:room.floor,area,width,shape,targetArea:room.targetArea});
    }
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
    return {accepted:issues.length===0,issues,reports,corridors};
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
        a=['balcony-0','living','entry'].map(key=>rooms.find(room=>room.key===key));
        b=rooms.filter(room=>!a.includes(room)&&room!==open);
        if(plan?.bathroomSide==='public') {const baths=b.filter(room=>room.label===ID['卫生间']);b=b.filter(room=>!baths.includes(room));a.splice(2,0,...baths);}
      } else {
        const bedrooms=rooms.filter(room=>room.label===ID['卧室']);
        a=[rooms.find(room=>room.key==='balcony-1'),bedrooms[0]];b=[];
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
    for(let f=0;f<2;f++) {
      const grid=floors[f],map=owners[f],claimed=new Uint8Array(grid.length);
      const root=spaces.find(s=>s.key===(f===0?'entry':'stairs')).id;
      const network=()=>{
        const seen=new Uint8Array(grid.length),queue=[];
        for(let i=0;i<map.length;i++)if(map[i]===root){seen[i]=1;queue.push(i);}
        for(let head=0;head<queue.length;head++)for(const next of neighbors(queue[head],nx,ny,1))if(!seen[next]&&isTransit(grid[next])){seen[next]=1;queue.push(next);}
        return seen;
      };
      const targets=[...new Set([0,...map])].filter(sid=>sid>=0&&spaces[sid].label!==ID['阳台']&&map.includes(sid));
      for(const sid of targets) {
        const connected=network(),touches=(target)=>Array.from(map).some((owner,i)=>owner===target&&(connected[i]||neighbors(i,nx,ny,1).some(j=>connected[j])));
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
            if(grid[at]>=0&&!isTransit(grid[at])){valid=false;break;}
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
        for(let at=end;at>=0;at=previous[at]) {
          const x=at%nx,y=Math.floor(at/nx);
          for(let yy=y;yy<y+width;yy++)for(let xx=x;xx<x+width;xx++) {
            const i=yy*nx+xx;if(map[i]<0){claimed[i]=1;grid[i]=ID['过道'];}
          }
        }
      }
      // Absorb unused land into actual rooms. Unroutable pockets are never renamed corridors.
      for(let pass=0;pass<nx+ny;pass++) {
        let changed=false;
        const rooms=program.filter(room=>room.floor===f).map(room=>spaces.find(s=>s.key===room.key));
        rooms.sort((a,b)=>{
          const area=s=>Array.from(map).filter(sid=>sid===s.id).length*.09;
          return (a.targetArea-area(a))-(b.targetArea-area(b));
        }).reverse();
        for(const room of rooms) {
          const cells=Array.from(map).flatMap((sid,i)=>sid===room.id?[i]:[]),xs=cells.map(i=>i%nx),ys=cells.map(i=>Math.floor(i/nx));
          const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
          if(cells.length!==(x1-x0+1)*(y1-y0+1))continue;
          const strips=[Array.from({length:x1-x0+1},(_,i)=>(y0-1)*nx+x0+i),Array.from({length:x1-x0+1},(_,i)=>(y1+1)*nx+x0+i),
            Array.from({length:y1-y0+1},(_,i)=>(y0+i)*nx+x0-1),Array.from({length:y1-y0+1},(_,i)=>(y0+i)*nx+x1+1)];
          const valid=[y0>0,y1+1<ny,x0>0,x1+1<nx];
          for(let d=0;d<4;d++)if(valid[d]&&strips[d].every(i=>map[i]<0&&!claimed[i])) {
            for(const i of strips[d]){map[i]=room.id;grid[i]=room.label;}changed=true;break;
          }
        }
        // An unused rectangular block may extend a public room, but only into a rectangle or L.
        const seen=new Uint8Array(map.length);
        for(let start=0;start<map.length;start++)if(map[start]<0&&!claimed[start]&&!seen[start]) {
          const block=[start];seen[start]=1;
          for(let head=0;head<block.length;head++)for(const next of neighbors(block[head],nx,ny,1))if(map[next]<0&&!claimed[next]&&!seen[next]){seen[next]=1;block.push(next);}
          const xs=block.map(i=>i%nx),ys=block.map(i=>Math.floor(i/nx));
          if(block.length!==(Math.max(...xs)-Math.min(...xs)+1)*(Math.max(...ys)-Math.min(...ys)+1))continue;
          for(const room of rooms.filter(s=>[ID['餐厅'],ID['多功能室']].includes(s.label))) {
            if(!block.some(i=>neighbors(i,nx,ny,1).some(j=>map[j]===room.id)))continue;
            for(const i of block)map[i]=room.id;
            if(['rectangle','L'].includes(classifySpaceShape(map,nx,room.id))) {
              for(const i of block)grid[i]=room.label;changed=true;break;
            }
            for(const i of block)map[i]=-1;
          }
        }
        if(!changed)break;
      }
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

  // Public rooms have their own leaves; only routed strips can become corridors.
  function freePartitionCandidate(nx,ny,seed,index,program,corridorWidth,neuralPrior=null,influence=0) {
    const r=rng((seed+Math.imul(index+1,0x85EBCA6B))>>>0),trees=[];
    const stairW=6+Math.floor(r()*3),stairH=6+Math.floor(r()*3);
    const stairPrior=neuralPrior?.stairs;
    const place=(size,extent,center)=>Math.max(0,Math.min(extent-size,Math.round((1-influence)*(r()*(extent-size))+influence*((center??.5)*extent-size/2))));
    const stairX=stairPrior?place(stairW,nx,stairPrior.cx):Math.floor(r()*(nx-stairW+1));
    const stairY=stairPrior?place(stairH,ny,stairPrior.cy):Math.floor(r()*(ny-stairH+1));
    const stair={key:'stairs',label:ID['楼梯间']};
    const divide=(node,axis,cut)=>{
      node.axis=axis;node.cut=cut;
      node.children=axis==='x'?[{x:node.x,y:node.y,w:cut,h:node.h},{x:node.x+cut,y:node.y,w:node.w-cut,h:node.h}]:
        [{x:node.x,y:node.y,w:node.w,h:cut},{x:node.x,y:node.y+cut,w:node.w,h:node.h-cut}];
      return node.children;
    };
    const leaves=node=>node.children?node.children.flatMap(leaves):[node];
    const fits=(node,room)=>Math.min(node.w,node.h)*.3+1e-8>=room.minWidth&&node.w*node.h*.09+1e-8>=room.minArea;
    for(let f=0;f<2;f++) {
      const root={x:0,y:0,w:nx,h:ny};trees.push(root);
      let core=root;
      if(stairX)core=divide(core,'x',stairX)[1];
      if(stairY)core=divide(core,'y',stairY)[1];
      if(core.w>stairW)core=divide(core,'x',stairW)[0];
      if(core.h>stairH)core=divide(core,'y',stairH)[0];
      core.room=stair;
      const rooms=program.filter(room=>room.floor===f),open=rooms.find(room=>room.key===(f===0?'dining':'multi'));
      const primary=rooms.find(room=>room.key===(f===0?'living':'bedroom-1')),balcony=rooms.find(room=>room.key===`balcony-${f}`);
      const scale=(nx*ny-stairW*stairH)*.09*.85/rooms.reduce((sum,room)=>sum+room.targetArea,0);
      const pair={key:'pair',targetArea:primary.targetArea+balcony.targetArea,minArea:primary.minArea+balcony.minArea,minWidth:primary.minWidth};
      const pending=[pair,...rooms.filter(room=>![primary,balcony].includes(room))];
      for(let i=pending.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[pending[i],pending[j]]=[pending[j],pending[i]];}
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
          if(w*h*.09+1e-8<room.minArea || (node.w-w>0&&node.w-w<publicMin)||(node.h-h>0&&node.h-h<publicMin))continue;
          let xHigh=r()<.5,yHigh=r()<.5;
          if(prior && r()<influence) {
            const corners=[[false,false],[true,false],[false,true],[true,true]];
            corners.sort((a,b)=>energy(node.x+(a[0]?node.w-w:0)+w/2,node.y+(a[1]?node.h-h:0)+h/2)-energy(node.x+(b[0]?node.w-w:0)+w/2,node.y+(b[1]?node.h-h:0)+h/2));
            [xHigh,yHigh]=corners[0];
          }
          const xFirst=r()<.5;
          const patchX=node.x+(xHigh?node.w-w:0),patchY=node.y+(yHigh?node.h-h:0);
          if(['entry','pair'].includes(room.key)&&patchX>0&&patchY>0&&patchX+w<nx&&patchY+h<ny)continue;
          let patch=node;
          for(const axis of xFirst?['x','y']:['y','x']) {
            const size=axis==='x'?w:h,full=axis==='x'?patch.w:patch.h,high=axis==='x'?xHigh:yHigh;
            if(size<full)patch=divide(patch,axis,high?full-size:size)[high?1:0];
          }
          if(room.key==='pair') {
            const axis=patch.x===0||patch.x+patch.w===nx?'x':'y',full=axis==='x'?patch.w:patch.h,cross=axis==='x'?patch.h:patch.w;
            const bMin=Math.max(Math.ceil(balcony.minWidth/.3),Math.ceil(balcony.minArea/(cross*.09)));
            const pMin=Math.max(Math.ceil(primary.minWidth/.3),Math.ceil(primary.minArea/(cross*.09)));
            if(full<bMin+pMin)return null;
            const cut=Math.max(bMin,Math.min(full-pMin,Math.round(full*balcony.targetArea/room.targetArea)));
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
      const candidate={nx,ny,floors,owners,spaces,publicShapePolicy:'rect-or-L',corridorWidth,geometry:{stairX,stairY,stairW,stairH,stairPlacement:stairX===0||stairY===0||stairX+stairW===nx||stairY+stairH===ny?'boundary':'interior',localMoves:0}};
      return routeAndFill(candidate,program)?candidate:null;
    };
    const accepted=candidate=>candidate&&roomConnectivity(candidate)&&validateProgram(candidate,program).accepted&&assessCandidate(candidate).reachable;
    const preference=candidate=>assessCandidate(candidate).score+validateProgram(candidate,program).reports.reduce((sum,room)=>sum+Math.abs(room.area-room.targetArea)/room.targetArea*20,0)+influence*50*neuralEnergy(candidate,neuralPrior);
    let candidate=materialize();
    if(!accepted(candidate))return null;
    // Repartition sibling leaves locally; reject moves that break sizes, access or identities.
    const parents=node=>node.children?[node,...node.children.flatMap(parents)]:[];
    for(let step=0;step<12;step++) {
      const choices=trees.flatMap(parents).filter(node=>node.children.every(child=>!child.children&&child.room?.key!=='stairs')&&node.children[0].room?.key!==node.children[1].room?.key);
      if(!choices.length)break;
      const node=choices[Math.floor(r()*choices.length)],saved=node.children,oldCut=node.cut;
      const cut=oldCut+Math.floor(r()*7)-3,full=node.axis==='x'?node.w:node.h;
      if(cut<=0||cut>=full||cut===oldCut)continue;
      const children=divide(node,node.axis,cut);children[0].room=saved[0].room;children[1].room=saved[1].room;
      const next=materialize();
      if(accepted(next)&&preference(next)<=preference(candidate)){next.geometry.localMoves=candidate.geometry.localMoves+1;candidate=next;}
      else {node.children=saved;node.cut=oldCut;}
    }
    return candidate;
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

  function buildLayout({ length, width, seed, plan = null, roomProgram = null, searchMode = 'classic', corridorWidth = 1.2, neuralPrior=null, influence=0, candidateBudget=null }) {
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
      const required=createRoomProgram(1,0).filter(room=>room.label!==ID['卧室']);
      if(required.some(room=>!roomProgram.some(p=>p.key===room.key&&p.label===room.label&&p.floor===room.floor)) || !roomProgram.some(room=>room.label===ID['卧室']&&room.floor===1)) throw new Error('房间清单缺少基本功能或二层卧室。');
      if(roomProgram.some(room=>!required.some(base=>base.key===room.key) && !(room.label===ID['卧室']&&room.floor===1&&/^bedroom-\d+$/.test(room.key)) && !(room.label===ID['卫生间']&&/^bathroom-\d+$/.test(room.key))))throw new Error('当前版本仅开放卧室和卫生间数量，其余基本功能保持固定。');
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
    const candidates = [];
    for (let index = 0; index < budget; index++) {
      const candidate = searchMode==='free'?freePartitionCandidate(nx,ny,seed,index,roomProgram,corridorWidth,neuralPrior,influence):roomProgram?programCandidate(nx,ny,seed,plan,index,roomProgram):partitionCandidate(nx, ny, seed, plan, index);
      if(!candidate)continue;
      if (!roomConnectivity(candidate)) continue;
      const result = roomProgram?{quality:assessCandidate(candidate),repairs:0}:repairAccess(candidate);
      if(roomProgram) {
        const check=validateProgram(candidate,roomProgram);
        if(!result.quality.reachable || !check.accepted)continue;
        result.quality.score+=check.reports.reduce((sum,room)=>sum+Math.abs(room.area-room.targetArea)/room.targetArea*20,0);
      }
      if (result) { result.quality.neuralEnergy=neuralEnergy(candidate,neuralPrior);
        result.quality.score+=influence*50*result.quality.neuralEnergy;
        candidate.quality = result.quality; candidate.repairs = result.repairs; candidate.index = index; candidates.push(candidate); }
    }
    candidates.sort((a, b) => a.quality.score - b.quality.score || a.index - b.index);
    const choices=searchMode==='free'?diverseCandidates(candidates):candidates,models=[];
    for (const c of choices) {
      const voxels = new Int16Array(slab * TOTAL_CELLS), spaceIds = new Int32Array(voxels.length);
      for (let z = 0; z < TOTAL_CELLS; z++) {
        const f = Math.floor(z / FLOOR_CELLS);
        voxels.set(c.floors[f], z * slab); spaceIds.set(c.owners[f], z * slab);
      }
      const model = { nx, ny, nz: TOTAL_CELLS, cell: RULES.cell, floorCount: RULES.floorCount,
        floorHeight: RULES.floorHeight, seed, voxels, spaceIds, spaces: c.spaces, floors: c.floors,
        floorSpaces: c.owners, connections: c.quality.doors, publicShapePolicy:c.publicShapePolicy, corridorWidth:c.corridorWidth,
        generation: { strategy: searchMode==='free'?'free-bsp-local':roomProgram?'room-program-partition':'shared-open-circulation', candidateCount: budget,
          selectedCandidate: c.index, geometry: c.geometry, score: c.quality.score,
          neuralEnergy:c.quality.neuralEnergy, neuralUsed:!!neuralPrior, influence,
          validCandidateCount:candidates.length,
          candidateScores: candidates.map(candidate => ({ index: candidate.index, score: candidate.quality.score,
            stairPlacement: candidate.geometry.stairPlacement, stairDaylightPenalty: candidate.quality.penalties.stairDaylight, stairDaylightPotential: candidate.quality.stairDaylight.potential })),
          reachable: c.quality.reachable, corridorFraction: c.quality.corridorFraction,
          openFraction: c.quality.openFraction, stairDaylight: c.quality.stairDaylight, openTraversal: c.quality.openTraversal, repairCount: c.repairs, wetAlignment: c.quality.wetAlignment,
          areaReports: c.quality.areaReports, relations: c.quality.relations, penalties: c.quality.penalties } };
      model.validation = validateLayout(model);
      model.circulation = validateCirculation(model);
      if(roomProgram)model.programValidation=validateProgram(model,roomProgram);
      if (model.validation.accepted && model.circulation.accepted && model.programValidation?.accepted!==false) {
        if(searchMode!=='free')return model;
        models.push(model);
      }
    }
    if(models.length) {
      for(const model of models)model.generation.comparisonScores=models.map(item=>item.generation.score);
      models[0].alternatives=models.slice(1);return models[0];
    }
    throw new Error(`当前${budget}个候选内未找到满足空间连通、尺寸与通行要求的方案。可调整面积、数量、体块或种子；搜索失败不代表需求不可实现。`);
  }

  const api = Object.freeze({ RULES, FLOOR_CELLS, TOTAL_CELLS, LABELS, ID, SEARCH_BUDGET, OPEN_LABELS, createRoomProgram, classifySpaceShape, validateProgram, buildLayout, validateLayout, validateCirculation, repairAccess });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LayoutCore = api;
})(globalThis);
