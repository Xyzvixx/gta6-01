// Pedestrians: they stroll the sidewalks, cross at crosswalks now and
// then, and run for cover when shots ring out or a chase screams past.
// Kept cheap — a fixed pool, spawned near the player, despawned far away.
import { AVENUES, PED_COLORS, ROAD_HALF, STREETS } from './content.js';
import { clamp } from './dice.js';

const WORLD_W = 3200;
const WORLD_H = 2400;

let nextPedId = 1;

function randRange(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

function randPick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function randChance(rng, p) {
  return rng() < p;
}

// Circle-vs-building-rectangle resolution for a walking body.
// Rects are CENTRE-based ([b.x-w/2, b.x+w/2] x [b.y-h/2, b.y+h/2]):
// buildTown generates x,y as the centre (round 3, J5).
function pushOutOfWalls(g, body, radius) {
  const city = g.city;
  if (!city || !city.buildings) return false;
  let hit = false;
  for (const b of city.buildings) {
    const left = b.x - b.w / 2;
    const right = b.x + b.w / 2;
    const top = b.y - b.h / 2;
    const bottom = b.y + b.h / 2;
    const nearestX = Math.max(left, Math.min(body.x, right));
    const nearestY = Math.max(top, Math.min(body.y, bottom));
    const dx = body.x - nearestX;
    const dy = body.y - nearestY;
    const dist2 = dx * dx + dy * dy;
    if (dist2 < radius * radius) {
      hit = true;
      if (dist2 > 0.01) {
        const dist = Math.sqrt(dist2);
        body.x = nearestX + (dx / dist) * radius;
        body.y = nearestY + (dy / dist) * radius;
      } else {
        body.y = top - radius;
      }
    }
  }
  return hit;
}

export function makePed(g, x, y) {
  const ped = {
    id: nextPedId,
    x, y,
    angle: randRange(g.rng, 0, Math.PI * 2),
    speed: randRange(g.rng, 32, 62),
    color: randPick(g.rng, PED_COLORS),
    state: 'walk', // walk | cross | flee | down
    panic: 0,
    dirT: randRange(g.rng, 2, 7),
    legT: 0,
    downT: 0,
  };
  nextPedId += 1;
  return ped;
}

// A sidewalk point: just off a road line, near the player.
function sidewalkPoint(g) {
  const p = g.player;
  if (randChance(g.rng, 0.5)) {
    const av = randPick(g.rng, AVENUES);
    const side = randChance(g.rng, 0.5) ? 1 : -1;
    return {
      x: av.x + side * (ROAD_HALF + 16),
      y: clamp(p.y + randRange(g.rng, -500, 500), 60, 2340),
    };
  }
  const st = randPick(g.rng, STREETS);
  const side = randChance(g.rng, 0.5) ? 1 : -1;
  return {
    x: clamp(p.x + randRange(g.rng, -500, 500), 60, 3100),
    y: st.y + side * (ROAD_HALF + 16),
  };
}

export function maintainPeds(g) {
  const want = g.settings.traffic === 'low' ? 14 : 30;
  const p = g.player;
  // Downed peds stay where they fell for a while (stepPeds clears them),
  // so only the far-away living ones are recycled here.
  g.peds = g.peds.filter((pd) => {
    if (pd.state === 'down') return true;
    return Math.hypot(pd.x - p.x, pd.y - p.y) < 1300;
  });
  while (g.peds.length < want) {
    const spot = sidewalkPoint(g);
    g.peds.push(makePed(g, spot.x, spot.y));
  }
}

export function scarePeds(g, x, y, radius) {
  for (const pd of g.peds) {
    if (pd.state === 'down') continue;
    if (Math.hypot(pd.x - x, pd.y - y) < radius) {
      pd.panic = 3;
      pd.state = 'flee';
    }
  }
}

// Pick a fresh heading: mostly along the nearest road, sometimes across it.
function chooseHeading(g, pd) {
  const cardinals = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  if (randChance(g.rng, 0.75)) {
    pd.state = 'walk';
    pd.angle = randPick(g.rng, cardinals) + randRange(g.rng, -0.3, 0.3);
  } else {
    pd.state = 'cross';
    pd.angle = randPick(g.rng, cardinals);
  }
}

// The player's car hitting a pedestrian at speed: they go down, and it
// counts as a crime if anyone is around to see it.
function checkCarHits(g) {
  const car = g.cars.find((c) => c.id === g.player.carId);
  if (!car || Math.abs(car.speed) <= 60) return;
  for (const pd of g.peds) {
    if (pd.state === 'down') continue;
    if (Math.hypot(pd.x - car.x, pd.y - car.y) < 30) {
      pd.state = 'down';
      pd.downT = 0;
      g.burst(pd.x, pd.y, 10, '#c23b3b', 120);
      g.addHeat(16, 'hitPed');
      g.stats.kills += 1;
      scarePeds(g, pd.x, pd.y, 300);
      g.audio.crash();
    }
  }
}

export function stepPeds(g, dt) {
  for (const pd of g.peds) {
    if (pd.state === 'down') {
      pd.downT = (pd.downT || 0) + dt;
      continue;
    }
    if (pd.panic > 0) {
      pd.panic -= dt;
      pd.state = 'flee';
    } else if (pd.state === 'flee') {
      pd.state = 'walk';
    }
    pd.dirT -= dt;
    if (pd.dirT <= 0) {
      pd.dirT = randRange(g.rng, 3, 8);
      chooseHeading(g, pd);
    }
    const pace = pd.state === 'flee' ? 210 : pd.speed;
    pd.x += Math.cos(pd.angle) * pace * dt;
    pd.y += Math.sin(pd.angle) * pace * dt;
    pd.legT += dt * (pd.state === 'flee' ? 2 : 1);
    pushOutOfWalls(g, pd, 12);
    pd.x = clamp(pd.x, 16, WORLD_W - 16);
    pd.y = clamp(pd.y, 16, WORLD_H - 16);
    const waterX = g.city ? g.city.waterX : undefined;
    if (waterX !== undefined && pd.x > waterX - 16) pd.x = waterX - 16;
    if (pd.state === 'cross' && pd.dirT < 1.2) pd.state = 'walk';
  }

  checkCarHits(g);

  // Clear the fallen after a while, so the scene reads but the pool frees.
  g.peds = g.peds.filter((pd) => !(pd.state === 'down' && (pd.downT || 0) > 14));
}
