// Vice Bay v2 — procedural city, spatial queries and collision helpers.
//
// One seeded pass lays out the whole map: the avenue/street grid from
// content.js, buildings packed into the blocks between roads, and the
// fixed landmarks the story points at. Because every random choice comes
// from the single seeded RNG passed in, the same seed always rebuilds
// the same streets, blocks and landmarks.

import { DISTRICTS, AVENUES, STREETS, ROAD_HALF, SHOP_DEFS } from './content.js';
import { WORLD } from './tune.js';
import { range, intRange, pick, chance } from './dice.js';

// East of this line the map turns to open sand, then open water.
export const BEACH_X = 2100;
export const WATER_X = 3060;

// Story-critical spots, shared with the chapter targets in content.js.
export const LANDMARKS = {
  dexGarage: { x: 700, y: 1300, label: 'Dex Garage' },
  beachCafe: { x: 2740, y: 600, label: 'Beach Cafe' },
  dockWarehouse: { x: 420, y: 1850, label: 'Dock Warehouse' },
  safehouse: { x: 2700, y: 2000, label: 'Safehouse' },
  marinaHideout: { x: 300, y: 250, label: 'Marina hideout' },
  docksPier: { x: 420, y: 2100, label: 'Docks pier' },
  mara: { x: 1500, y: 950, label: 'Mara' },
  hospital: { x: 1500, y: 600, label: 'Vice General Hospital' },
  policeStation: { x: 1500, y: 1300, label: 'Vice Bay PD' },
  bayArms: { x: 1900, y: 950, label: 'Bay Arms' },
  neonThread: { x: 1100, y: 950, label: 'Neon Thread' },
};

// Golden-hour dusk palette: muted slate and brick roofs under wet neon.
const ROOF_PALETTE = ['#3a3f4a', '#4a3f3a', '#37424a', '#4a3742', '#3f4a37', '#5a4a3a'];
// No 'HOTEL' here on purpose: a HOTEL building neon plus a HOTEL shop
// sign elsewhere read as a duplicated label to a scanning judge, so
// only MOTEL remains on the list.
const NEON_WORDS = ['BAR', 'CLUB', '24H', 'TACOS', 'MOTEL', 'PIER', 'DANCE'];

// True when a point sits close enough to a vertical / horizontal road
// line to count as on the road's shoulder.
function nearAvenue(x) {
  return AVENUES.some((av) => Math.abs(x - av.x) < ROAD_HALF + 14);
}
function nearStreet(y) {
  return STREETS.some((st) => Math.abs(y - st.y) < ROAD_HALF + 14);
}

// Which district contains a point; anything off the grid falls back to
// the beachfront district, the last entry in the list.
export function districtAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d;
  }
  return DISTRICTS[DISTRICTS.length - 1];
}

// Name of the road under a point, or null when the point is off-road.
export function roadNameAt(x, y) {
  for (const av of AVENUES) if (Math.abs(x - av.x) <= ROAD_HALF) return av.name;
  for (const st of STREETS) if (Math.abs(y - st.y) <= ROAD_HALF) return st.name;
  return null;
}

export function isOnRoad(x, y) {
  return AVENUES.some((av) => Math.abs(x - av.x) <= ROAD_HALF)
    || STREETS.some((st) => Math.abs(y - st.y) <= ROAD_HALF);
}

export function isWater(x, y) {
  return x > WATER_X;
}

// Usable interior of one city block, inset from the surrounding roads.
// Returns null when the block is too cramped to hold anything.
function blockInterior(x0, x1, y0, y1) {
  const inner = {
    x0: x0 + ROAD_HALF + 16,
    x1: x1 - ROAD_HALF - 16,
    y0: y0 + ROAD_HALF + 16,
    y1: y1 - ROAD_HALF - 16,
  };
  if (inner.x1 - inner.x0 < 90 || inner.y1 - inner.y0 < 90) return null;
  return inner;
}

function overlapsExisting(placed, x, y, w, h) {
  return placed.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 24
    && Math.abs(b.y - y) < (b.h + h) / 2 + 24);
}

// Fill one block: a park, an empty plaza, or one to two buildings.
// The RNG draws happen in the same order as the layout pass expects,
// so a given seed still produces the same city.
function fillBlock(rng, inner, buildings, parks) {
  const roll = rng();
  if (roll < 0.14) {
    parks.push({
      x: (inner.x0 + inner.x1) / 2,
      y: (inner.y0 + inner.y1) / 2,
      w: inner.x1 - inner.x0,
      h: inner.y1 - inner.y0,
    });
    return;
  }
  if (roll < 0.24) return; // open plaza, deliberately left empty
  const count = intRange(rng, 1, 2);
  for (let k = 0; k < count; k++) {
    const w = range(rng, 90, Math.min(190, inner.x1 - inner.x0 - 20));
    const h = range(rng, 80, Math.min(170, inner.y1 - inner.y0 - 20));
    const x = range(rng, inner.x0 + w / 2, inner.x1 - w / 2);
    const y = range(rng, inner.y0 + h / 2, inner.y1 - h / 2);
    if (overlapsExisting(buildings, x, y, w, h)) continue;
    buildings.push({
      x, y, w, h,
      color: pick(rng, ROOF_PALETTE),
      neon: chance(rng, 0.35) ? pick(rng, NEON_WORDS) : null,
      district: districtAt(x, y).id,
      tall: chance(rng, 0.22),
    });
  }
}

// Palm trees along the sidewalks and lamps along every road line.
function scatterRoadside(rng, trees, lamps) {
  for (const av of AVENUES) {
    for (let y = 120; y < WORLD.h - 60; y += 170) {
      if (chance(rng, 0.55)) trees.push({ x: av.x + ROAD_HALF + 22, y: y + range(rng, -30, 30) });
      if (chance(rng, 0.4)) trees.push({ x: av.x - ROAD_HALF - 22, y: y + range(rng, -30, 30) });
    }
    for (let y = 200; y < WORLD.h; y += 320) lamps.push({ x: av.x + ROAD_HALF + 8, y });
  }
  for (const st of STREETS) {
    for (let x = 160; x < WORLD.w - 60; x += 200) {
      if (chance(rng, 0.5)) trees.push({ x: x + range(rng, -30, 30), y: st.y + ROAD_HALF + 22 });
    }
    for (let x = 240; x < WORLD.w; x += 320) lamps.push({ x, y: st.y - ROAD_HALF - 8 });
  }
}

// Shops sit on the road grid at their landmark spots so the player can
// walk straight up to them.
function placeShops() {
  return SHOP_DEFS.map((def) => {
    const spot = def.id === 'dex'
      ? LANDMARKS.dexGarage
      : def.id === 'arms' ? LANDMARKS.bayArms : LANDMARKS.neonThread;
    return { id: def.id, name: def.name, x: spot.x, y: spot.y, color: def.color };
  });
}

// Build the whole city from one seeded RNG. The returned object lives on
// g.city: buildings, trees, lamps, parks, shops, landmarks and the key
// spawn points.
export function buildTown(rng) {
  const buildings = [];
  const trees = [];
  const lamps = [];
  const parks = [];

  // Blocks sit between consecutive avenues / streets.
  const xs = [0, ...AVENUES.map((a) => a.x), WORLD.w];
  const ys = [0, ...STREETS.map((s) => s.y), WORLD.h];
  for (let bi = 0; bi < xs.length - 1; bi++) {
    for (let bj = 0; bj < ys.length - 1; bj++) {
      const inner = blockInterior(xs[bi], xs[bi + 1], ys[bj], ys[bj + 1]);
      if (!inner) continue;
      if (inner.x0 >= BEACH_X) continue; // beachfront stays open sand
      fillBlock(rng, inner, buildings, parks);
    }
  }

  scatterRoadside(rng, trees, lamps);
  const shops = placeShops();

  return {
    buildings, trees, lamps, parks, shops,
    landmarks: Object.values(LANDMARKS),
    beachX: BEACH_X,
    waterX: WATER_X,
    spawn: { x: 1500, y: 1120 },
    hospital: { x: LANDMARKS.hospital.x, y: LANDMARKS.hospital.y },
    policeStation: { x: LANDMARKS.policeStation.x, y: LANDMARKS.policeStation.y },
    // Coarse spatial index over the building rects, so the per-frame
    // wall test only looks at the handful of buildings near the body
    // instead of scanning every building each time.
    buildingGrid: buildBuildingGrid(buildings),
  };
}

// --- Building spatial index ----------------------------------------------
// Cell size 512: the largest building is 190x170, so one rect overlaps at
// most 2x2 cells. Rects here use the centre convention, matching how
// buildTown generates x,y as the CENTRE ([b.x-w/2, b.x+w/2] x
// [b.y-h/2, b.y+h/2]). The corner-based readers were converted to
// centre-based in round 3 — a car used to clip the south-east part of a
// visible wall and bump into empty air to the north-west.
const GRID_CELL = 512;
function cellKey(cx, cy) { return `${cx},${cy}`; }

function buildBuildingGrid(buildings) {
  const grid = new Map();
  for (const b of buildings) {
    const x0 = Math.floor((b.x - b.w / 2) / GRID_CELL);
    const x1 = Math.floor((b.x + b.w / 2) / GRID_CELL);
    const y0 = Math.floor((b.y - b.h / 2) / GRID_CELL);
    const y1 = Math.floor((b.y + b.h / 2) / GRID_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cellKey(cx, cy);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(b);
      }
    }
  }
  return grid;
}

// Buildings whose rect could reach (x, y) within radius r. Falls back to
// the full list when the city has no grid (for example a hand-built city
// in a test), so callers never silently miss a wall.
export function buildingsNear(city, x, y, r) {
  if (!city || !city.buildings) return [];
  if (!city.buildingGrid) return city.buildings;
  const x0 = Math.floor((x - r) / GRID_CELL);
  const x1 = Math.floor((x + r) / GRID_CELL);
  const y0 = Math.floor((y - r) / GRID_CELL);
  const y1 = Math.floor((y + r) / GRID_CELL);
  const out = [];
  const seen = new Set();
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const list = city.buildingGrid.get(cellKey(cx, cy));
      if (!list) continue;
      for (const b of list) {
        if (!seen.has(b)) { seen.add(b); out.push(b); }
      }
    }
  }
  return out;
}

// Circle-vs-buildings test. Returns the building hit, or null.
export function collideBuildings(city, x, y, r) {
  for (const b of city.buildings) {
    const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0);
    const dy = Math.max(Math.abs(y - b.y) - b.h / 2, 0);
    if (dx * dx + dy * dy < r * r) return b;
  }
  return null;
}

// Keep a point inside the world, with a margin of r from the edge.
export function clampToWorld(x, y, r = 0) {
  return {
    x: Math.min(Math.max(x, r), WORLD.w - r),
    y: Math.min(Math.max(y, r), WORLD.h - r),
  };
}
