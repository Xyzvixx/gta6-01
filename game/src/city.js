// Vice Bay, built from a seed: a road grid, city blocks full of extruded
// buildings, parks, a beach and harbour water, shops and landmarks. The city
// is data only — render.js draws it, vehicles.js drives on its roads.
import { AVENUES, DISTRICTS, ROAD_HALF, STREETS } from './data.js';
import { chance, intRange, pick, range } from './random.js';
import { WORLD } from './config.js';

const ROOFS = ['#5a6b7d', '#7d6a5a', '#4a5a6b', '#6b5a7d', '#7d7a5a', '#3f4a3a', '#8a6a4a', '#54606e'];
const NEON_SIGNS = ['VICE BAY', 'NEON', 'TACOS', 'HOTEL', '24H', 'PIER', 'CLUB', 'BAR'];

export function buildCity(rng) {
  const buildings = [];
  const trees = [];
  const lamps = [];
  const parks = [];

  // Buildings fill every block between two avenues and two streets.
  for (let ai = 0; ai < AVENUES.length - 1; ai += 1) {
    for (let si = 0; si < STREETS.length - 1; si += 1) {
      const x0 = AVENUES[ai].x + ROAD_HALF + 14;
      const x1 = AVENUES[ai + 1].x - ROAD_HALF - 14;
      const y0 = STREETS[si].y + ROAD_HALF + 14;
      const y1 = STREETS[si + 1].y - ROAD_HALF - 14;
      const downtown = AVENUES[ai].x >= 1100 && AVENUES[ai].x < 1900 && STREETS[si].y >= 600 && STREETS[si].y < 1300;
      if (chance(rng, downtown ? 0.06 : 0.2)) {
        parks.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 });
        for (let t = 0; t < 7; t += 1) trees.push({ x: range(rng, x0 + 20, x1 - 20), y: range(rng, y0 + 20, y1 - 20), r: range(rng, 9, 15) });
        continue;
      }
      const cols = downtown ? 2 : intRange(rng, 1, 2);
      const rows = intRange(rng, 1, 2);
      const cw = (x1 - x0) / cols;
      const ch = (y1 - y0) / rows;
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          const bx = x0 + c * cw + 8;
          const by = y0 + r * ch + 8;
          const bw = cw - 20 - rng() * 14;
          const bh = ch - 20 - rng() * 14;
          if (bw < 34 || bh < 30) continue;
          const tall = downtown ? intRange(rng, 26, 64) : intRange(rng, 8, 26);
          buildings.push({
            x: bx, y: by, w: bw, h: bh, hgt: tall,
            roof: pick(rng, ROOFS),
            neon: downtown && chance(rng, 0.45) ? pick(rng, NEON_SIGNS) : null,
            windows: intRange(rng, 2, 5),
          });
        }
      }
      if (chance(rng, 0.6)) trees.push({ x: range(rng, x0 + 16, x1 - 16), y: range(rng, y0 + 16, y1 - 16), r: range(rng, 8, 13) });
    }
  }

  // Street lamps along every avenue / street corner.
  for (const av of AVENUES) {
    for (const st of STREETS) {
      lamps.push({ x: av.x + ROAD_HALF + 6, y: st.y - ROAD_HALF - 6 });
      lamps.push({ x: av.x - ROAD_HALF - 6, y: st.y + ROAD_HALF + 6 });
    }
  }

  const shops = [
    { id: 'dex', x: 700, y: 1300, angle: 0 },
    { id: 'arms', x: 1500, y: 950, angle: 0 },
    { id: 'thread', x: 1900, y: 600, angle: 0 },
  ];
  const landmarks = [
    { x: 1500, y: 950, label: 'Mara', kind: 'person' },
    { x: 420, y: 1850, label: 'Dock Warehouse', kind: 'warehouse' },
    { x: 2740, y: 600, label: 'Beach Cafe', kind: 'cafe' },
    { x: 2700, y: 2000, label: 'Safehouse', kind: 'house' },
    { x: 1500, y: 250, label: 'Bay Tower', kind: 'tower' },
    { x: 300, y: 2000, label: 'Harbor Crane', kind: 'crane' },
  ];

  return {
    buildings, trees, lamps, parks, shops, landmarks,
    beachX: 2830, waterX: 2980,
    spawn: { x: 1500, y: 1020 },
    hospital: { x: 1100, y: 600 },
    policeStation: { x: 1900, y: 1300 },
  };
}

export function districtAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d.name;
  }
  return 'Vice Bay';
}

// Nearest road name for the HUD ("Neon Ave & Flamingo St").
export function roadNameAt(x, y) {
  let bestA = null;
  let bestAd = Infinity;
  for (const a of AVENUES) {
    const d = Math.abs(x - a.x);
    if (d < bestAd) { bestAd = d; bestA = a; }
  }
  let bestS = null;
  let bestSd = Infinity;
  for (const s of STREETS) {
    const d = Math.abs(y - s.y);
    if (d < bestSd) { bestSd = d; bestS = s; }
  }
  if (bestAd < ROAD_HALF + 30 && bestSd < ROAD_HALF + 30) return `${bestA.name} & ${bestS.name}`;
  if (bestAd < bestSd) return bestA.name;
  return bestS.name;
}

export function isOnRoad(x, y) {
  for (const a of AVENUES) if (Math.abs(x - a.x) < ROAD_HALF) return true;
  for (const s of STREETS) if (Math.abs(y - s.y) < ROAD_HALF) return true;
  return false;
}

export function isWater(city, x) {
  return x > city.waterX;
}

// Push a circle out of every building it overlaps. Returns true on a hit.
export function collideBuildings(city, body, radius) {
  let hit = false;
  for (const b of city.buildings) {
    const cx = Math.max(b.x, Math.min(body.x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(body.y, b.y + b.h));
    const dx = body.x - cx;
    const dy = body.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < radius * radius) {
      hit = true;
      if (d2 > 0.01) {
        const d = Math.sqrt(d2);
        body.x = cx + (dx / d) * radius;
        body.y = cy + (dy / d) * radius;
      } else {
        body.y = b.y - radius;
      }
    }
  }
  return hit;
}

export function clampToWorld(body, margin) {
  body.x = Math.max(margin, Math.min(WORLD.w - margin, body.x));
  body.y = Math.max(margin, Math.min(WORLD.h - margin, body.y));
}
