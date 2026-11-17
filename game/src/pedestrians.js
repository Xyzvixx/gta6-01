// Pedestrians: they stroll the sidewalks, cross at crosswalks now and then,
// and run for cover when shots ring out or a chase screams past. Kept cheap:
// a fixed pool, spawned near the player, despawned far away.
import { AVENUES, PED_COLORS, ROAD_HALF, STREETS } from './data.js';
import { chance, clamp, pick, range } from './random.js';
import { clampToWorld, collideBuildings } from './city.js';

let nextPedId = 1;

export function makePed(g, x, y) {
  const ped = {
    id: nextPedId,
    x, y,
    angle: range(g.rng, 0, Math.PI * 2),
    speed: range(g.rng, 32, 62),
    color: pick(g.rng, PED_COLORS),
    state: 'walk', // walk | cross | flee | down
    panic: 0,
    dirT: range(g.rng, 2, 7),
    legT: 0,
  };
  nextPedId += 1;
  return ped;
}

// A sidewalk point: just off a road line.
function sidewalkPoint(g) {
  const p = g.player;
  if (chance(g.rng, 0.5)) {
    const av = pick(g.rng, AVENUES);
    const side = chance(g.rng, 0.5) ? 1 : -1;
    return { x: av.x + side * (ROAD_HALF + 16), y: clamp(p.y + range(g.rng, -500, 500), 60, 2340) };
  }
  const st = pick(g.rng, STREETS);
  const side = chance(g.rng, 0.5) ? 1 : -1;
  return { x: clamp(p.x + range(g.rng, -500, 500), 60, 3100), y: st.y + side * (ROAD_HALF + 16) };
}

export function maintainPeds(g) {
  const want = g.settings.traffic === 'low' ? 14 : 30;
  const p = g.player;
  g.peds = g.peds.filter((pd) => pd.state !== 'down' && Math.hypot(pd.x - p.x, pd.y - p.y) < 1300);
  while (g.peds.length < want) {
    const s = sidewalkPoint(g);
    g.peds.push(makePed(g, s.x, s.y));
  }
}

export function scarePeds(g, x, y, radius) {
  for (const pd of g.peds) {
    if (Math.hypot(pd.x - x, pd.y - y) < radius) {
      pd.panic = 3;
      pd.state = 'flee';
    }
  }
}

export function stepPeds(g, dt) {
  const p = g.player;
  for (const pd of g.peds) {
    if (pd.state === 'down') continue;
    if (pd.panic > 0) {
      pd.panic -= dt;
      pd.state = 'flee';
    } else if (pd.state === 'flee') {
      pd.state = 'walk';
    }
    pd.dirT -= dt;
    if (pd.dirT <= 0) {
      pd.dirT = range(g.rng, 3, 8);
      // Mostly walk along the nearest road; sometimes cross it.
      if (chance(g.rng, 0.75)) {
        pd.angle = pick(g.rng, [0, Math.PI / 2, Math.PI, -Math.PI / 2]) + range(g.rng, -0.3, 0.3);
      } else {
        pd.state = 'cross';
        pd.angle = pick(g.rng, [0, Math.PI / 2, Math.PI, -Math.PI / 2]);
      }
    }
    const speed = pd.state === 'flee' ? 210 : pd.speed;
    const nx = Math.cos(pd.angle) * speed * dt;
    const ny = Math.sin(pd.angle) * speed * dt;
    pd.x += nx;
    pd.y += ny;
    pd.legT += dt * (pd.state === 'flee' ? 2 : 1);
    collideBuildings(g.city, pd, 12);
    clampToWorld(pd, 16);
    if (pd.x > g.city.waterX - 16) pd.x = g.city.waterX - 16;
    if (pd.state === 'cross' && pd.dirT < 1.2) pd.state = 'walk';
  }
  // Player car hitting a pedestrian: they go down, and it counts if seen.
  const car = g.cars.find((c) => c.id === g.player.carId);
  if (car && Math.abs(car.speed) > 60) {
    for (const pd of g.peds) {
      if (pd.state === 'down') continue;
      if (Math.hypot(pd.x - car.x, pd.y - car.y) < 30) {
        pd.state = 'down';
        g.burst(pd.x, pd.y, 10, '#c23b3b', 120);
        g.addHeat(16, 'hitPed');
        g.stats.kills += 1;
        scarePeds(g, pd.x, pd.y, 300);
        g.audio.crash();
      }
    }
  }
  // Remove 'down' peds after a while (they stay a bit so the scene reads).
  for (const pd of g.peds) {
    if (pd.state === 'down') pd.downT = (pd.downT || 0) + dt;
  }
  g.peds = g.peds.filter((pd) => !(pd.state === 'down' && (pd.downT || 0) > 14));
}
