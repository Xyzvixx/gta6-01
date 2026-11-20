// Police pressure: heat turns into stars, stars turn into foot cops,
// patrol cars, roadblocks, and — at four stars and up — the Air One
// helicopter. Heat sits on a 0-100 scale and cools down only when the
// player is out of sight and has not just committed a crime. Air One
// is a hunt, not a leash: it must find the player, it can be shaken
// off, and ducking behind cover is a real way out.
import { clamp } from './dice.js';
import { hurtCar, makeCar, snapCarToRoad, stepChaseCar } from './traffic.js';
import { buildingsNear } from './town.js';

const WORLD_W = 3200;
const WORLD_H = 2400;
const HEAT_COOL_PER_SEC = 3.2;
const SPOT_ACQUIRE_RANGE = 260;
const SPOT_LOSE_RANGE = 500;
const SPOT_LOSE_DELAY = 4;

let nextCopId = 1;

// Uniform random value inside [lo, hi).
function randIn(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

// Shortest signed turn from one heading to another, wrapped to [-PI, PI].
function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function bearing(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

// Shove a round body out of any building rect it overlaps. Rects are
// centre-based, [b.x - w/2, b.x + w/2] by [b.y - h/2, b.y + h/2], the
// same convention the hero, pedestrians and cars all use. Without this
// step, foot cops would walk through walls and arrest the player
// through solid cover.
function pushOutOfWalls(g, body, radius) {
  const city = g.city;
  if (!city || !city.buildings) return false;
  let collided = false;
  for (const b of buildingsNear(city, body.x, body.y, radius)) {
    const left = b.x - b.w / 2;
    const right = b.x + b.w / 2;
    const top = b.y - b.h / 2;
    const bottom = b.y + b.h / 2;
    const nearX = Math.max(left, Math.min(body.x, right));
    const nearY = Math.max(top, Math.min(body.y, bottom));
    const offX = body.x - nearX;
    const offY = body.y - nearY;
    const dist2 = offX * offX + offY * offY;
    if (dist2 < radius * radius) {
      collided = true;
      if (dist2 > 0.01) {
        const dist = Math.sqrt(dist2);
        body.x = nearX + (offX / dist) * radius;
        body.y = nearY + (offY / dist) * radius;
      } else {
        body.y = top - radius;
      }
    }
  }
  return collided;
}

function confineToWorld(body, margin) {
  body.x = clamp(body.x, margin, WORLD_W - margin);
  body.y = clamp(body.y, margin, WORLD_H - margin);
}

// True when a point sits inside any building rect, expanded by margin.
function pointInsideBuilding(g, x, y, margin) {
  const city = g.city;
  if (!city || !city.buildings) return false;
  for (const b of buildingsNear(city, x, y, margin)) {
    if (x > b.x - b.w / 2 - margin && x < b.x + b.w / 2 + margin
      && y > b.y - b.h / 2 - margin && y < b.y + b.h / 2 + margin) return true;
  }
  return false;
}

// Pick a spawn point `dist` away from the player in a random direction,
// inside the world and clear of buildings. Tries several angles and
// gives up with null when none fits (player backed into a corner);
// the caller simply retries on the next tick instead of dropping a
// cop on top of the player.
function spawnPointAt(g, p, dist, margin) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const a = randIn(g.rng, 0, Math.PI * 2);
    const x = p.x + Math.cos(a) * dist;
    const y = p.y + Math.sin(a) * dist;
    if (x >= margin && x <= WORLD_W - margin && y >= margin && y <= WORLD_H - margin
      && !pointInsideBuilding(g, x, y, 20)) {
      return { x, y };
    }
  }
  return null;
}

// Heat 0 means clean. The first star arrives with any heat at all,
// then one more star per 20 heat, capped at five.
export function wantedLevel(heat) {
  if (heat <= 0) return 0;
  return Math.min(5, 1 + Math.floor(heat / 20));
}

// Slab test: does the segment (x1,y1)-(x2,y2) cross the centre-based
// rect b? Used for the helicopter's line of sight and shared with the
// combat module, so bullets and the spotlight agree on what counts
// as a wall.
export function segmentHitsRect(x1, y1, x2, y2, b) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tLow = 0;
  let tHigh = 1;
  const axes = [
    { d: dx, lo: b.x - b.w / 2 - x1, hi: b.x + b.w / 2 - x1 },
    { d: dy, lo: b.y - b.h / 2 - y1, hi: b.y + b.h / 2 - y1 },
  ];
  for (const a of axes) {
    if (Math.abs(a.d) < 1e-9) {
      if (a.lo > 0 || a.hi < 0) return false;
    } else {
      let t1 = a.lo / a.d;
      let t2 = a.hi / a.d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tLow) tLow = t1;
      if (t2 < tHigh) tHigh = t2;
      if (tLow > tHigh) return false;
    }
  }
  return true;
}

// Can the helicopter actually see the player right now? Beyond the
// lose range the answer is no, and any building whose footprint the
// heli-to-player segment crosses breaks the view — so alleys, tunnels
// and rooftops are genuine escape routes. A building sitting directly
// under the helicopter itself does not count: the heli flies above
// the roofs, and without that carve-out it went blind while orbiting
// over a rooftop.
function heliSeesPlayer(g) {
  const h = g.heli;
  const p = g.player;
  const dist = Math.hypot(p.x - h.x, p.y - h.y);
  if (dist > SPOT_LOSE_RANGE) return false;
  const city = g.city;
  if (!city || !city.buildings) return true;
  const minX = Math.min(h.x, p.x);
  const maxX = Math.max(h.x, p.x);
  const minY = Math.min(h.y, p.y);
  const maxY = Math.max(h.y, p.y);
  for (const b of city.buildings) {
    if (b.x + b.w / 2 < minX || b.x - b.w / 2 > maxX || b.y + b.h / 2 < minY || b.y - b.h / 2 > maxY) continue;
    if (Math.abs(h.x - b.x) < b.w / 2 && Math.abs(h.y - b.y) < b.h / 2) continue;
    if (segmentHitsRect(h.x, h.y, p.x, p.y, b)) return false;
  }
  return true;
}

// Take the roadblock's two interceptor cars out of the world with the
// block itself, otherwise they stay behind as frozen police cars.
// Exported because the bust / wasted handlers need the same cleanup.
export function clearRoadblock(g) {
  if (!g.roadblock) return;
  const ids = g.roadblock.cars || [];
  if (ids.length) g.cars = g.cars.filter((c) => !ids.includes(c.id));
  g.roadblock = null;
}

// Two parked interceptors straddling the road ahead of the player.
function spawnRoadblock(g) {
  const p = g.player;
  const ride = g.cars.find((c) => c.id === p.carId);
  const heading = ride ? ride.angle : p.angle;
  const bx = clamp(p.x + Math.cos(heading) * 560, 80, 3120);
  const by = clamp(p.y + Math.sin(heading) * 560, 80, 2320);
  const cars = [];
  for (const off of [-34, 34]) {
    const px = bx + Math.cos(heading + Math.PI / 2) * off;
    const py = by + Math.sin(heading + Math.PI / 2) * off;
    const block = makeCar(g, 'interceptor', px, py, heading + Math.PI / 2, 'police');
    block.speed = 0;
    block.roadblock = true;
    g.cars.push(block);
    cars.push(block.id);
  }
  g.roadblock = { x: bx, y: by, t: 14, cars };
  g.toast('Roadblock ahead!');
}

// The helicopter runs a small state machine: search, track, lost.
// In search it circles the last known position with its spotlight
// sweeping. In track it chases with a lag — fast, but trailing the
// player rather than glued on top, so a quick car can pull away —
// and while the spotlight holds, heat cannot cool. Lose the line of
// sight for a few seconds and it drops to lost, flies back to where
// it last saw the player, and starts searching again.
function stepHelicopter(g, dt) {
  const h = g.heli;
  const p = g.player;
  const sees = heliSeesPlayer(g);
  const gap = Math.hypot(p.x - h.x, p.y - h.y);

  if (h.state === 'search') {
    h.searchT += dt;
    h.orbitA = (h.orbitA || 0) + dt * 0.55;
    const tx = h.lx + Math.cos(h.orbitA) * 190;
    const ty = h.ly + Math.sin(h.orbitA) * 190;
    h.x += (tx - h.x) * Math.min(1, dt * 1.6);
    h.y += (ty - h.y) * Math.min(1, dt * 1.6);
    h.angle += angleDelta(h.angle, Math.atan2(ty - h.y, tx - h.x)) * Math.min(1, dt * 2);
    if (sees && gap < SPOT_ACQUIRE_RANGE) {
      h.state = 'track';
      h.spotT = 0;
      h.losT = 0;
      g.toast('Air One has eyes on you — break line of sight!');
    }
  } else if (h.state === 'track') {
    if (sees) {
      const chaseSpeed = 250;
      const want = bearing(h.x, h.y, p.x, p.y);
      h.angle += angleDelta(h.angle, want) * Math.min(1, dt * 3);
      h.x += Math.cos(h.angle) * chaseSpeed * dt;
      h.y += Math.sin(h.angle) * chaseSpeed * dt;
      h.losT = 0;
      h.spotT += dt;
      h.lx = p.x;
      h.ly = p.y;
      // Spotlight on the player: the heat clock freezes.
      g.wanted.calmT = 6;
    } else {
      h.losT += dt;
      const want = bearing(h.x, h.y, h.lx, h.ly);
      h.angle += angleDelta(h.angle, want) * Math.min(1, dt * 3);
      h.x += Math.cos(h.angle) * 210 * dt;
      h.y += Math.sin(h.angle) * 210 * dt;
      if (h.losT >= SPOT_LOSE_DELAY) {
        h.state = 'lost';
        h.searchT = 0;
        g.toast('Air One lost you — stay hidden!');
      }
    }
  } else {
    // 'lost': return to the last known spot, then resume the search.
    h.searchT += dt;
    const d = Math.hypot(h.lx - h.x, h.ly - h.y);
    const want = bearing(h.x, h.y, h.lx, h.ly);
    h.angle += angleDelta(h.angle, want) * Math.min(1, dt * 3);
    h.x += Math.cos(h.angle) * 210 * dt;
    h.y += Math.sin(h.angle) * 210 * dt;
    if (sees && gap < SPOT_ACQUIRE_RANGE) {
      h.state = 'track';
      h.spotT = 0;
      h.losT = 0;
    } else if (d < 90 || h.searchT > 6) {
      h.state = 'search';
      h.searchT = 0;
    }
  }
  h.x = clamp(h.x, 40, WORLD_W - 40);
  h.y = clamp(h.y, 40, WORLD_H - 40);
}

// Hand every cop car back to ordinary traffic when the heat clears.
// The car is re-roled to traffic and snapped onto the nearest road
// without teleporting it, so it does not get dragged off the map by
// a null road. Both the level-0 cleanup and the bust / wasted
// handlers need this, or the cars sit frozen as police forever.
export function releaseCopCars(g) {
  for (const c of g.cops) {
    if (c.kind === 'car') {
      const car = g.cars.find((cc) => cc.id === c.carId);
      if (car) {
        car.role = 'traffic';
        snapCarToRoad(g, car);
      }
    }
  }
}

export function stepCops(g, dt) {
  const w = g.wanted;
  const level = wantedLevel(w.heat);
  w.level = level;
  if (level > g.stats.topWanted) g.stats.topWanted = level;
  // The ram crush and shove apply once per tick in total, not once
  // per cop in contact; the flag is armed here at the top of the tick.
  g.ramAppliedThisTick = false;

  // ---- Helicopter: a single unit, only at 4-5 stars. ----
  // Stepped before the heat-cool check below, so a spotlight that is
  // holding the player can freeze the heat in the very same tick.
  const p = g.player;
  if (level >= 4 && !g.heli) {
    // Preferred spawn: 380 east and 260 north of the player, about
    // 461px away. At a map edge that offset can land out of bounds
    // or inside a building, so fall back to a random point at the
    // same distance (which is building-checked), and if even that
    // fails — player wedged in a corner — skip this tick and retry
    // on the next one while the level stays at 4+.
    let spawn = null;
    const ox = p.x + 380;
    const oy = p.y - 260;
    if (ox >= 60 && ox <= WORLD_W - 60 && oy >= 60 && oy <= WORLD_H - 60 && !pointInsideBuilding(g, ox, oy, 20)) spawn = { x: ox, y: oy };
    else spawn = spawnPointAt(g, p, 461, 60);
    if (spawn) {
      g.heli = {
        x: spawn.x,
        y: spawn.y,
        angle: 0,
        state: 'search',
        spotT: 0,
        searchT: 0,
        lx: p.x,
        ly: p.y,
        losT: 0,
        orbitA: 0,
      };
      g.toast('Air One is overhead — break line of sight!');
    }
  }
  if (g.heli) {
    if (level < 4) {
      g.heli = null;
    } else {
      stepHelicopter(g, dt);
    }
  }

  // Heat cools only while nobody can see the player and no crime has
  // just happened. The helicopter holds calmT up while its spotlight
  // is on the player, so this branch stays shut for as long as it tracks.
  w.calmT -= dt;
  let nearestCop = Infinity;
  for (const c of g.cops) {
    nearestCop = Math.min(nearestCop, Math.hypot(c.x - g.player.x, c.y - g.player.y));
  }
  if (w.heat > 0 && w.calmT <= 0 && nearestCop > 380) {
    w.heat = Math.max(0, w.heat - HEAT_COOL_PER_SEC * dt);
  }

  // A clean slate resets the crew driver's once-per-episode repair.
  if (level === 0 && g.crew) g.crew.driverUsedEp = false;

  // ---- Spawn foot cops and patrol cars to match the level. ----
  const wantFoot = level >= 1 ? Math.min(level, 3) : 0;
  const wantCars = level >= 2 ? Math.min(level - 1, 3) : 0;
  let foot = 0;
  let cars = 0;
  for (const c of g.cops) {
    if (c.kind === 'foot') foot += 1;
    else cars += 1;
  }
  let spawnTries = 0;
  while (foot < wantFoot && spawnTries < 4) {
    spawnTries += 1;
    // Foot cops arrive on foot, so they start a good run away (650px):
    // any closer and they close the gap and arrest a stationary
    // player before a mission gunfight has time to finish. At 650px
    // the run takes about 2.8s, and the arrest hold below adds more
    // time — enough for a fighting player to finish and move, while
    // a player who just stands there still gets busted. Patrol cars
    // keep their shorter 520px spawn; they drive.
    const pt = spawnPointAt(g, p, 650, 40);
    if (!pt) continue;
    g.cops.push({
      id: nextCopId, kind: 'foot',
      x: pt.x,
      y: pt.y,
      angle: 0, speed: 0, arrestT: 0,
    });
    nextCopId += 1;
    foot += 1;
  }
  spawnTries = 0;
  while (cars < wantCars && spawnTries < 4) {
    spawnTries += 1;
    const pt = spawnPointAt(g, p, 520, 60);
    if (!pt) continue;
    const car = makeCar(
      g, 'interceptor',
      pt.x,
      pt.y,
      0, 'police',
    );
    g.cars.push(car);
    g.cops.push({
      id: nextCopId, kind: 'car', carId: car.id,
      x: car.x, y: car.y, angle: 0, speed: 0, arrestT: 0,
    });
    nextCopId += 1;
    cars += 1;
  }

  // ---- Roadblocks at 3+ stars. ----
  // A recruited lookout warns five seconds before one appears; with
  // no lookout the block just shows up when the timer runs out.
  if (level >= 3 && !g.roadblock) {
    g.rbT = (g.rbT === undefined ? 8 : g.rbT) - dt;
    if (g.rbT <= 0) {
      if (g.crew && g.crew.lookout && !g.rbWarned) {
        g.toast('Lookout: roadblock ahead — 5 seconds!');
        g.rbWarned = true;
        g.rbT = 5;
      } else {
        spawnRoadblock(g);
        g.rbWarned = false;
        g.rbT = 12 + g.rng() * 8;
      }
    }
  }
  if (g.roadblock) {
    g.roadblock.t -= dt;
    if (g.roadblock.t <= 0 || Math.hypot(p.x - g.roadblock.x, p.y - g.roadblock.y) > 1600) {
      clearRoadblock(g);
    }
  }

  // ---- Move the cops. ----
  for (const c of g.cops) {
    if (c.kind === 'foot') {
      let d = Math.hypot(p.x - c.x, p.y - c.y);
      const target = bearing(c.x, c.y, p.x, p.y);
      c.angle += angleDelta(c.angle, target) * Math.min(1, dt * 5);
      // A cop already on top of the player holds position instead of
      // running past — that hold is what lets the arrest timer fill.
      // The hold distance sits inside the arrest radius (26px): a
      // wider hold parked the cop in a dead zone where it neither
      // moved nor arrested, so a stationary player could never be
      // busted at all.
      if (d > 24) {
        const pace = d > 300 ? 235 : 200;
        c.x += Math.cos(c.angle) * pace * dt;
        c.y += Math.sin(c.angle) * pace * dt;
      }
      // Wall collision runs on every tick, not only while moving:
      // a cop inside a building footprint within the hold distance
      // used to arrest through the wall and never get ejected.
      // Recompute the distance after the push-out so the arrest
      // test uses the corrected position.
      pushOutOfWalls(g, c, 13);
      confineToWorld(c, 20);
      d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < 26 && p.carId === null) {
        c.arrestT += dt;
        // Two seconds of contact before the bust lands. The arrest
        // has to be a readable window the player can break by moving
        // away, not an instant fail the moment a cop closes the last
        // step — a shorter window busted players mid-gunfight for
        // doing what the mission asked.
        if (c.arrestT > 2.0) {
          g.onBusted();
          return;
        }
      } else {
        c.arrestT = Math.max(0, c.arrestT - dt * 2);
      }
    } else {
      const car = g.cars.find((cc) => cc.id === c.carId);
      if (!car || car.dead) {
        c.gone = true;
        continue;
      }
      const target = bearing(car.x, car.y, p.x, p.y);
      const playerCar = g.cars.find((cc) => cc.id === p.carId);
      const top = playerCar ? Math.min(430, 300 + level * 28) : 330;
      stepChaseCar(g, car, dt, target, top);
      c.x = car.x;
      c.y = car.y;
      // Ram the player's car: shove it and chip its health, never
      // insta-kill — a chase has to stay survivable.
      if (playerCar && Math.hypot(car.x - playerCar.x, car.y - playerCar.y) < 46) {
        if (!g.ramAppliedThisTick) {
          // Frame-rate-independent speed crush: Math.pow(0.94, dt*60)
          // is exactly 0.94 per tick at 60 FPS and the equivalent
          // crush at any other rate, instead of a flat per-tick
          // multiplier that punished low frame rates.
          playerCar.speed *= Math.pow(0.94, dt * 60);
          const shove = bearing(playerCar.x, playerCar.y, car.x, car.y);
          playerCar.x -= Math.cos(shove) * 26 * dt;
          playerCar.y -= Math.sin(shove) * 26 * dt;
          // The shove writes position directly, so keep it in-world;
          // wall correction happens on the next tick.
          confineToWorld(playerCar, 26);
          g.ramAppliedThisTick = true;
        }
        // Ram damage is capped at 9 HP/s in total — one 4.5 HP bill
        // per half second — on its own cooldown (lastRamT), separate
        // from the traffic impact cooldown, so the two cannot
        // interfere and several ramming cops cannot stack bills in
        // the same tick. Damage goes through hurtCar so armour soak
        // applies and the fuse lights at 0 HP.
        if (g.time - (playerCar.lastRamT || 0) > 0.5) {
          hurtCar(g, playerCar, 4.5, null);
          playerCar.lastRamT = g.time;
        }
      }
    }
  }

  // Drop cops that are hopelessly far away or whose car died. A cop
  // 1700px out is always safe to drop: the spawn loop tops the force
  // back up near the player every tick, so nothing is lost. Dropping
  // a car cop also removes its car from g.cars, or an orphaned police
  // car sits frozen in traffic forever.
  const droppedCarIds = [];
  g.cops = g.cops.filter((c) => {
    if (c.gone) {
      if (c.kind === 'car') droppedCarIds.push(c.carId);
      return false;
    }
    if (c.kind === 'car') {
      const car = g.cars.find((cc) => cc.id === c.carId);
      if (!car) return false;
    }
    if (Math.hypot(c.x - p.x, c.y - p.y) >= 1700) {
      if (c.kind === 'car') droppedCarIds.push(c.carId);
      return false;
    }
    return true;
  });
  if (droppedCarIds.length) {
    g.cars = g.cars.filter((c) => !droppedCarIds.includes(c.id));
  }
  if (level === 0) {
    releaseCopCars(g);
    g.cops = [];
    clearRoadblock(g);
  }
}
