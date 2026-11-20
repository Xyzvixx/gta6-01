// Traffic and driving: player handling, road-following AI cars, parked
// cars, crashes, damage stages, and the delayed blast that finishes a
// car once its health reaches zero. A car at the worst damage stage
// does not disappear at once — it smoulders briefly on a fuse, then
// detonates, and only after that is it removed from the world.
import { AVENUES, CAR_DEFS, ROAD_HALF, STREETS } from './content.js';
import { clamp } from './dice.js';
import { hurtHero } from './hero.js';
import { buildingsNear } from './town.js';

// Local driving and explosion tuning for this module only.
const ACCEL = 430;
const BRAKE = 620;
const REVERSE_MAX = 150;
const DRAG = 0.55;
const TURN_RATE = 2.55;
const GRIP_DRY = 1;
const GRIP_WET = 0.88;
const FUSE_SECONDS = 0.9;
const EXPLOSION_RADIUS = 130;
const WORLD_W = 3200;
const WORLD_H = 2400;

let nextCarId = 1;

// --- Seeded random helpers ---------------------------------------------
// Every draw goes through g.rng so a seeded run stays reproducible.
// Call order inside each routine is part of that determinism, so the
// helpers below are thin wrappers and nothing here reorders draws.

function randBetween(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function randPick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function randChance(rng, p) {
  return rng() < p;
}

// --- Angles ------------------------------------------------------------

// Smallest signed rotation from one heading to another, in (-PI, PI].
function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function bearingTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

// --- World bounds and walls --------------------------------------------

// Push a circular body out of any nearby building rectangle.
// Returns true when a wall was touched. Only buildings close to the
// body are examined (the spatial lookup in town.js); scanning the
// whole city per body per frame would be wasted work, since a wall
// far away cannot overlap this body. Building rects are centred on
// b.x / b.y, so each edge is centre +/- half size.
function resolveWallCollision(g, body, radius) {
  const city = g.city;
  if (!city || !city.buildings) return false;
  let hit = false;
  for (const b of buildingsNear(city, body.x, body.y, radius)) {
    const left = b.x - b.w / 2;
    const right = b.x + b.w / 2;
    const top = b.y - b.h / 2;
    const bottom = b.y + b.h / 2;
    const cx = Math.max(left, Math.min(body.x, right));
    const cy = Math.max(top, Math.min(body.y, bottom));
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
        body.y = top - radius;
      }
    }
  }
  return hit;
}

function clampToWorld(body, margin) {
  body.x = clamp(body.x, margin, WORLD_W - margin);
  body.y = clamp(body.y, margin, WORLD_H - margin);
}

// --- Damage stages ------------------------------------------------------

// 0 clean, 1 dented, 2 smoking / on fire, 3 wrecked (no health left).
export function damageTier(car) {
  if (car.hp > 65) return 0;
  if (car.hp > 35) return 1;
  if (car.hp > 0) return 2;
  return 3;
}

// Apply damage to a car. Armour upgrades absorb a slice of each hit.
// Dropping to zero health only lights the fuse; the blast itself is
// handled by stepVehicles once the fuse has burned down, never here.
export function hurtCar(g, car, dmg, cause) {
  if (!car || car.dead || car.fuseT > 0) return;
  // Cars flagged as mission targets (courier, van, vault car) are
  // effectively armoured while a chase or tail stage is running: stray
  // police shots or a sideswipe must not be able to destroy them and
  // make a long escort unwinnable through no fault of the player.
  if (car.missionTarget) return;
  const armorTier = (car.upgrades && car.upgrades.armor) || 0;
  const soaked = dmg * (1 - 0.12 * armorTier);
  car.hp -= soaked;
  if (car.hp <= 0) {
    car.hp = 0;
    car.fuseT = FUSE_SECONDS;
    car.speed *= 0.3;
    if (cause === 'player') g.addHeat(8, 'crash');
  }
}

// Smoke for a dented car, flames for a burning one. Rate-limited by
// the car's smoke timer so emission stays steady per second.
function emitDamageSmoke(g, car, dt) {
  const tier = damageTier(car);
  car.smokeT -= dt;
  if (tier === 1 && car.smokeT <= 0) {
    car.smokeT = 0.28;
    g.particles.push({
      x: car.x, y: car.y - 8,
      vx: randBetween(g.rng, -8, 8), vy: -46,
      life: 0.9, max: 0.9, size: 7, color: '#777777', kind: 'puff',
    });
  } else if (tier === 2 && car.smokeT <= 0) {
    car.smokeT = 0.1;
    g.particles.push({
      x: car.x, y: car.y - 8,
      vx: randBetween(g.rng, -14, 14), vy: -70,
      life: 0.7, max: 0.7, size: 6,
      color: g.rng() < 0.5 ? '#ff7a2e' : '#666666', kind: 'puff',
    });
  } else if (tier === 3 && car.smokeT <= 0) {
    car.smokeT = 0.06;
    g.particles.push({
      x: car.x, y: car.y - 8,
      vx: randBetween(g.rng, -20, 20), vy: -90,
      life: 0.5, max: 0.5, size: 8,
      color: g.rng() < 0.6 ? '#ff5a1e' : '#222222', kind: 'puff',
    });
  }
}

// The fuse has burned down: burst particles, screen shake, splash
// damage, and the car is finally dead. Garage upgrades on a
// player-owned car are lost along with it.
function explodeCar(g, car) {
  g.burst(car.x, car.y, 34, '#ff9a3d', 320);
  g.burst(car.x, car.y, 20, '#ffd76a', 240);
  g.burst(car.x, car.y, 16, '#555555', 150);
  g.camera.shake = Math.max(g.camera.shake, 10);
  g.audio.crash();
  // Splash: nearby cars catch the blast and light their own fuses,
  // nearby pedestrians are knocked down, and a hero on foot who is
  // too close takes damage.
  for (const other of g.cars) {
    if (other === car || other.dead) continue;
    const d = Math.hypot(other.x - car.x, other.y - car.y);
    if (d < EXPLOSION_RADIUS) hurtCar(g, other, 55, null);
  }
  for (const pd of g.peds) {
    if (pd.state === 'down') continue;
    if (Math.hypot(pd.x - car.x, pd.y - car.y) < 110) {
      pd.state = 'down';
      pd.downT = 0;
    }
  }
  g.scarePeds(car.x, car.y, 420);
  const p = g.player;
  if (p.carId === car.id) {
    // The hero is thrown clear of his own wreck onto open street,
    // not inside a wall or into the water.
    p.carId = null;
    p.x = car.x + 50;
    p.y = car.y + 40;
    clampToWorld(p, 20);
    resolveWallCollision(g, p, 14);
    p.invuln = Math.max(p.invuln, 0.5);
    g.toast('Your car blew up!');
  } else if (Math.hypot(p.x - car.x, p.y - car.y) < 90 && p.carId === null) {
    hurtHero(g, 20);
  }
  // A blast in view is a crime somebody reports.
  if (Math.hypot(p.x - car.x, p.y - car.y) < 600) g.addHeat(10, 'explosion');
  if (car.ownedBy === 'player') {
    if (g.garage) delete g.garage[car.id];
    g.toast('Upgrades lost with the car');
  }
  car.dead = true;
  car.speed = 0;
}

// --- Car creation -------------------------------------------------------

export function makeCar(g, type, x, y, angle, role) {
  const def = CAR_DEFS[type] || CAR_DEFS.marlin;
  const car = {
    id: nextCarId,
    type,
    x, y, angle,
    speed: 0,
    steer: 0,
    hp: 100,
    maxHp: 100,
    color: randPick(g.rng, def.colors),
    role,
    driver: role === 'traffic',
    driverPedId: null,
    glow: false,
    road: null,
    line: 0,
    dir: 1,
    lane: 0,
    waitT: 0,
    smokeT: 0,
    dead: false,
    fuseT: 0,
    ownedBy: null,
    upgrades: { engine: 0, armor: 0, nitro: 0 },
    // Nitro runtime state (not saved): remaining boost + cooldown.
    nitroT: 0,
    nitroCd: 0,
  };
  nextCarId += 1;
  if (role === 'traffic') giveTrafficRoad(g, car);
  return car;
}

// Place a traffic car on a random road line, heading a random way
// along it, at a cruising speed.
function giveTrafficRoad(g, car) {
  const rng = g.rng;
  if (randChance(rng, 0.5)) {
    const av = randPick(rng, AVENUES);
    car.road = 'v';
    car.line = av.x;
    car.dir = randChance(rng, 0.5) ? 1 : -1;
    car.lane = car.dir > 0 ? 18 : -18;
    car.x = av.x + car.lane;
    car.y = randBetween(rng, 60, 2340);
    car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    const st = randPick(rng, STREETS);
    car.road = 'h';
    car.line = st.y;
    car.dir = randChance(rng, 0.5) ? 1 : -1;
    car.lane = car.dir > 0 ? 18 : -18;
    car.x = randBetween(rng, 60, 3140);
    car.y = st.y + car.lane;
    car.angle = car.dir > 0 ? 0 : Math.PI;
  }
  car.speed = randBetween(rng, 90, 170);
}

// Attach a car to its nearest road WITHOUT moving it: road, line,
// direction and lane are derived from the car's current position and
// heading, so the traffic stepper eases it onto the lane instead of
// teleporting it or dragging it off the map. Used for chase / tail
// target cars, whose spawn spot must be honoured (assigning a random
// road would overwrite it), and for ex-police cars released by the
// bust / wasted / escape handlers. The lane keeps the car's current
// offset (clamped), so it eases in rather than jumping; the turn
// logic resets it to +/-18 at the next intersection.
export function snapCarToRoad(g, car) {
  let bestAv = null;
  let bestAvD = Infinity;
  for (const av of AVENUES) {
    const d = Math.abs(car.x - av.x);
    if (d < bestAvD) { bestAvD = d; bestAv = av; }
  }
  let bestSt = null;
  let bestStD = Infinity;
  for (const st of STREETS) {
    const d = Math.abs(car.y - st.y);
    if (d < bestStD) { bestStD = d; bestSt = st; }
  }
  if (bestAvD <= bestStD) {
    car.road = 'v';
    car.line = bestAv.x;
    car.dir = Math.sin(car.angle) >= 0 ? 1 : -1;
    car.lane = clamp(car.x - bestAv.x, -30, 30);
  } else {
    car.road = 'h';
    car.line = bestSt.y;
    car.dir = Math.cos(car.angle) >= 0 ? 1 : -1;
    car.lane = clamp(car.y - bestSt.y, -30, 30);
  }
  car.turnAt = undefined;
}

// --- Traffic lookahead --------------------------------------------------

// The car directly ahead in our lane, if any, within `look` pixels.
function carAhead(g, car, look) {
  for (const o of g.cars) {
    if (o === car || o.dead) continue;
    const dx = o.x - car.x;
    const dy = o.y - car.y;
    const forward = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    const side = Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle));
    if (forward > 0 && forward < look && side < 30) return o;
  }
  return null;
}

// Is the lane `shift` px to the side clear ahead? This is the
// overtake check: a traffic car swinging around a parked car must not
// pull into an oncoming car. `shift` is signed in the car's own
// lateral frame, so the test is |side - shift| < 30 on the shifted
// line. `except` is the car being overtaken: it sits in OUR lane, not
// the oncoming one, so it must never fail the test.
function laneClearAhead(g, car, shift, look, except) {
  for (const o of g.cars) {
    if (o === car || o === except || o.dead) continue;
    const dx = o.x - car.x;
    const dy = o.y - car.y;
    const forward = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    const side = -dx * Math.sin(car.angle) + dy * Math.cos(car.angle);
    if (forward > 0 && forward < look && Math.abs(side - shift) < 30) return false;
  }
  return true;
}

// --- Traffic AI ---------------------------------------------------------

// One traffic car following its road line. It only ever follows its
// own lane and turns at intersections, so traffic can never deadlock
// in a pile-up.
function stepTrafficCar(g, car, dt) {
  const def = CAR_DEFS[car.type] || CAR_DEFS.marlin;
  const ahead = carAhead(g, car, 95);
  let target = def.top * 0.55;
  // Overtake a parked car instead of queueing behind it forever: the
  // old behaviour treated it as stopped traffic (target 0), so the
  // follower sat ~30px behind it mid-block, outside the 6px turn
  // band, and never turned away or passed. The 36px shift puts
  // lateral separation at ~48px, past the 44px car-vs-car minimum,
  // and the overtake only starts when the oncoming lane is clear
  // ahead. The lateral ease is dt*6: at ~181 px/s the 95px window
  // gives the shift 0.52s, and a slower ease only completed ~80% of
  // it, so every overtake clipped once; dt*6 completes ~96% (~47px
  // separation). The lookahead stays 95px and the clear check stays
  // 110px: lengthening them made traffic stop far more often (a
  // blocked overtake sets target 0), and the chase / tail stages need
  // the target car MOVING (speed > 5) for their timers to accumulate.
  let lineShift = 0;
  if (ahead) {
    if (ahead.role === 'parked') {
      // The lane shift is a WORLD-axis offset (the lane coordinate is
      // x on avenues, y on streets), but laneClearAhead tests it in
      // the car's LATERAL frame — the sign flips with heading, so
      // passing the world shift straight in made the parked car
      // itself fail the test southbound / westbound: the deadlock
      // survived in half the city. Convert to the lateral frame for
      // the TEST, and exclude the parked car itself. But the shift
      // APPLIED to the position must stay the WORLD shift: storing
      // the lateral value and adding it to the world coordinate
      // steered southbound / westbound cars to the curb side (line+54,
      // 26px past the road edge) instead of the oncoming lane — a
      // scrape that damaged both cars. The two coincide only when the
      // frame factor is +1 (eastbound, northbound).
      const shift = -Math.sign(car.lane || 1) * 36;
      const latShift = (car.road === 'v' ? -Math.sin(car.angle) : Math.cos(car.angle)) * shift;
      if (car.overtaking && car.overtakeId === ahead.id) {
        lineShift = car.overtakeShift;
      } else if (laneClearAhead(g, car, latShift, 110, ahead)) {
        car.overtaking = true;
        car.overtakeId = ahead.id;
        car.overtakeShift = shift;
        lineShift = shift;
      } else {
        target = 0;
      }
    } else {
      target = Math.max(0, ahead.speed - 12);
    }
  }
  // Hold the shift until the parked car is behind us: once shifted,
  // the parked car is ~48px lateral — past carAhead's 30px threshold —
  // so without the latch the car steers back into its own lane mid-pass
  // and swerves. A turn or U-turn clears the latch: the shift belongs
  // to the old heading's frame.
  if (car.overtaking) {
    const block = g.cars.find((o) => o.id === car.overtakeId);
    if (!block || block.dead) {
      car.overtaking = false;
    } else {
      const dx = block.x - car.x;
      const dy = block.y - car.y;
      const fwd = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
      // Clear only once the parked car is 60px behind — past the car
      // length (~44px) with margin. Clearing earlier, while the
      // follower was still alongside the parked car's rear, made it
      // steer back into its own lane and clip the rear; the clip was
      // on the RETURN, not the approach.
      if (fwd < -60) car.overtaking = false;
      else lineShift = car.overtakeShift;
    }
  }
  if (car.waitT > 0) {
    car.waitT -= dt;
    target = 0;
  }
  car.speed += clamp(target - car.speed, -260 * dt, 150 * dt);
  if (car.speed < 2 && ahead && ahead.role !== 'parked') car.waitT = 0.4;

  if (car.road === 'v') {
    car.y += car.dir * car.speed * dt;
    car.x += (car.line + car.lane + lineShift - car.x) * Math.min(1, dt * 6);
    car.angle += angleDelta(car.angle, car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) * Math.min(1, dt * 4);
    for (const st of STREETS) {
      // One roll per intersection, not one per frame: while the car sits
      // inside the 6px band it would otherwise re-roll 30% every frame
      // (near-certain at 60 FPS, and frame-rate dependent). `turnAt`
      // records the crossing where the last decision was made (road type
      // + coordinate, so a street and an avenue that share a number do
      // not collide); it clears once the car leaves the band, so the
      // next crossing rolls again. The 0.8 keeps the OLD effective rate:
      // at 60 FPS a car spent ~5 frames in the band, so 30%/frame meant
      // ~82% per crossing; 0.3 once per crossing made traffic drive
      // straight for too long and wander to the map edge (the courier
      // got stuck at the beach and the tail stage could never complete).
      if (Math.abs(car.y - st.y) < 6) {
        if (car.turnAt !== `s:${st.y}` && randChance(g.rng, 0.8)) {
          car.road = 'h';
          car.line = st.y;
          car.dir = randChance(g.rng, 0.5) ? 1 : -1;
          car.lane = car.dir > 0 ? 18 : -18;
          car.y = st.y + car.lane;
          car.overtaking = false;
        }
        car.turnAt = `s:${st.y}`;
        break;
      }
    }
    if (car.turnAt !== undefined && !STREETS.some((st) => Math.abs(car.y - st.y) < 6)) car.turnAt = undefined;
    if (car.y < 40 || car.y > 2360) {
      car.dir *= -1;
      car.lane = car.dir > 0 ? 18 : -18;
      car.overtaking = false;
    }
  } else {
    car.x += car.dir * car.speed * dt;
    car.y += (car.line + car.lane + lineShift - car.y) * Math.min(1, dt * 6);
    car.angle += angleDelta(car.angle, car.dir > 0 ? 0 : Math.PI) * Math.min(1, dt * 4);
    for (const av of AVENUES) {
      // Same once-per-crossing rule as the street turn above.
      if (Math.abs(car.x - av.x) < 6) {
        if (car.turnAt !== `a:${av.x}` && randChance(g.rng, 0.8)) {
          car.road = 'v';
          car.line = av.x;
          car.dir = randChance(g.rng, 0.5) ? 1 : -1;
          car.lane = car.dir > 0 ? 18 : -18;
          car.x = av.x + car.lane;
          car.overtaking = false;
        }
        car.turnAt = `a:${av.x}`;
        break;
      }
    }
    if (car.turnAt !== undefined && !AVENUES.some((av) => Math.abs(car.x - av.x) < 6)) car.turnAt = undefined;
    if (car.x < 40 || car.x > 3160) {
      car.dir *= -1;
      car.lane = car.dir > 0 ? 18 : -18;
      car.overtaking = false;
    }
  }
}

// --- Player driving -----------------------------------------------------

export function stepPlayerCar(g, car, dt, axis) {
  const def = CAR_DEFS[car.type] || CAR_DEFS.marlin;
  const up = axis.up || (axis.y !== undefined && axis.y < -0.1);
  const down = axis.down || (axis.y !== undefined && axis.y > 0.1);
  const left = axis.left || (axis.x !== undefined && axis.x < -0.1);
  const right = axis.right || (axis.x !== undefined && axis.x > 0.1);
  const grip = g.weather.rain > 0.4 ? GRIP_WET : GRIP_DRY;
  const engineTier = (car.upgrades && car.upgrades.engine) || 0;
  const nitroTier = (car.upgrades && car.upgrades.nitro) || 0;

  // Nitro: one burst per cooldown, stronger with higher tiers.
  if (car.nitroCd > 0) car.nitroCd -= dt;
  if (axis.nitro && nitroTier > 0 && car.nitroCd <= 0 && car.nitroT <= 0) {
    car.nitroT = 1.0 + 0.4 * nitroTier;
    car.nitroCd = 7;
  }
  const boosting = car.nitroT > 0;
  if (boosting) car.nitroT -= dt;

  // A hurt car loses top speed; the crew driver adds 15% while active
  // (object form: { kind: 'driver', t } — the engine's post-step nudge
  // pushes toward the same raised cap).
  let top = def.top * (1 + 0.08 * engineTier) * (car.hp < 35 ? 0.55 : 1);
  if (g.crew && g.crew.active && g.crew.active.kind === 'driver') top *= 1.15;
  if (boosting) top *= 1.35;

  const accel = boosting ? ACCEL * 1.6 : ACCEL;
  if (up) car.speed += accel * dt;
  else if (down) {
    if (car.speed > 8) car.speed -= BRAKE * dt;
    else car.speed -= ACCEL * 0.55 * dt;
  } else {
    car.speed -= car.speed * DRAG * dt;
  }
  car.speed = clamp(car.speed, -REVERSE_MAX, top);
  const steerInput = (right ? 1 : 0) - (left ? 1 : 0);
  const authority = clamp(Math.abs(car.speed) / 90, 0, 1);
  car.steer = steerInput;
  car.angle += steerInput * TURN_RATE * def.grip * grip * authority * dt * (car.speed < 0 ? -1 : 1);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;

  // Exhaust puffs on hard acceleration, flames while nitro burns.
  // Rates are per-second (dt-scaled): a bare per-frame probability
  // would emit twice as many particles at 120 FPS as at 60.
  if (up && Math.abs(car.speed) > 60 && g.rng() < 0.35 * dt * 60) {
    g.particles.push({
      x: car.x - Math.cos(car.angle) * 28, y: car.y - Math.sin(car.angle) * 28,
      vx: -Math.cos(car.angle) * 30 + randBetween(g.rng, -12, 12),
      vy: -Math.sin(car.angle) * 30 - 22,
      life: 0.6, max: 0.6, size: 5, color: '#8a8d90', kind: 'puff',
    });
  }
  if (boosting && g.rng() < 0.6 * dt * 60) {
    g.particles.push({
      x: car.x - Math.cos(car.angle) * 30, y: car.y - Math.sin(car.angle) * 30,
      vx: -Math.cos(car.angle) * 120, vy: -Math.sin(car.angle) * 120,
      life: 0.35, max: 0.35, size: 6, color: '#37e6ff', kind: 'puff',
    });
  }
  // Damage smoke / fire for the player's car.
  emitDamageSmoke(g, car, dt);
}

// Police cars are steered by cops.js through this helper: turn toward a
// heading and chase a target speed.
export function stepChaseCar(g, car, dt, targetAngle, targetSpeed) {
  car.angle += angleDelta(car.angle, targetAngle) * Math.min(1, dt * 3.2);
  car.speed += clamp(targetSpeed - car.speed, -420 * dt, 300 * dt);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
}

// --- Collisions ---------------------------------------------------------

export function collideCars(g, car, dt) {
  const def = CAR_DEFS[car.type] || CAR_DEFS.marlin;
  const radius = def.len * 0.42;
  if (resolveWallCollision(g, car, radius)) {
    if (Math.abs(car.speed) > 120) {
      // Wall damage is gated on the same per-car impact cooldown as
      // car-vs-car hits: without it a car re-accelerating past 120
      // after the bounce billed again on every re-contact. The *-0.32
      // bounce below is what used to save it, and it only buys
      // ~0.4-0.5s.
      if (g.time - (car.lastImpactT || 0) > 0.5) {
        hurtCar(g, car, Math.abs(car.speed) * 0.045, car.role === 'player' ? 'player' : null);
        car.lastImpactT = g.time;
        g.audio.crash();
        g.burst(car.x, car.y, 8, '#c8c8c8', 130);
        if (car.role === 'player') g.addHeat(4, 'crash');
      }
    }
    // Bounce off the wall, keeping a third of the speed, reversed.
    car.speed *= -0.32;
  }
  clampToWorld(car, 26);
  const waterX = g.city ? g.city.waterX : undefined;
  if (waterX !== undefined && car.x > waterX - 20) {
    car.x = waterX - 20;
    // Beach sand drag, frame-rate independent: halve the speed per
    // second in the shallows. The old per-frame factor ran EVERY
    // frame, so a car on the beach stopped dead in ~0.1s and the
    // slowdown varied with FPS.
    car.speed *= Math.pow(0.5, dt);
  }
  // Car vs car: push apart, share the impact, exchange speeds.
  for (const o of g.cars) {
    if (o === car || o.dead) continue;
    const dx = o.x - car.x;
    const dy = o.y - car.y;
    const d = Math.hypot(dx, dy);
    const min = 44;
    if (d > 0.01 && d < min) {
      const push = (min - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      // A parked car is anchored: it never moves and never takes the
      // other car's speed. The old code shoved parked cars off the curb
      // into the lane on a sideswipe. Only the moving car is pushed,
      // by the full gap; two parked cars overlapping (a spawn overlap)
      // still separate by half each.
      if (car.role === 'parked' && o.role === 'parked') {
        car.x -= nx * push;
        car.y -= ny * push;
        o.x += nx * push;
        o.y += ny * push;
      } else if (car.role === 'parked') {
        o.x += nx * push * 2;
        o.y += ny * push * 2;
      } else if (o.role === 'parked') {
        car.x -= nx * push * 2;
        car.y -= ny * push * 2;
      } else {
        car.x -= nx * push;
        car.y -= ny * push;
        o.x += nx * push;
        o.y += ny * push;
      }
      const impact = Math.abs(car.speed - o.speed);
      if (impact > 140) {
        // One impact, one bill: this loop runs every tick, so a car
        // grinding against an anchored parked car used to take
        // impact*0.03 EVERY tick (~5 HP/frame, ~300 HP/s) and die in
        // 0.2s from a single sideswipe. A pair may only bill once per
        // 0.5s, tracked PER PAIR in lastImpacts (other-car-id -> last
        // bill time): per-car alone under-billed a fresh distinct crash
        // 0.2s after another, and a single lastImpactWith was defeated
        // by alternating pairs (A-B, A-C, A-B re-billed B inside 0.5s).
        // The per-pair map caps each pair independently, so a fresh
        // crash bills while a grind does not. The map is bounded by the
        // car count (~30 entries max) and dies with the car. A parked
        // car is only damaged by the PLAYER's rams, never by traffic
        // sideswipes: traffic at 0.55*top (143-181 px/s) exceeds the
        // 140 threshold, so every sideswipe billed ~5 HP and ~20 passes
        // totalled a parked car mid-street. The crash sound is gated on
        // a billed hit for the same reason. lastImpactT is still set
        // (the wall branch reads it for its own cooldown).
        let billed = false;
        const carBillable = car.role !== 'parked' || o.role === 'player';
        const oBillable = o.role !== 'parked' || car.role === 'player';
        if (carBillable && g.time - ((car.lastImpacts && car.lastImpacts[o.id]) || 0) > 0.5) {
          hurtCar(g, car, impact * 0.03, car.role === 'player' ? 'player' : null);
          car.lastImpactT = g.time;
          if (!car.lastImpacts) car.lastImpacts = {};
          car.lastImpacts[o.id] = g.time;
          billed = true;
        }
        if (oBillable && g.time - ((o.lastImpacts && o.lastImpacts[car.id]) || 0) > 0.5) {
          hurtCar(g, o, impact * 0.03, o.role === 'player' ? 'player' : null);
          o.lastImpactT = g.time;
          if (!o.lastImpacts) o.lastImpacts = {};
          o.lastImpacts[car.id] = g.time;
          billed = true;
        }
        if (billed && (car.role === 'player' || o.role === 'player')) g.audio.crash();
      }
      // Speed is exchanged only between two moving cars: a parked
      // car's speed stays 0.
      if (car.role !== 'parked' && o.role !== 'parked') {
        const avg = (car.speed + o.speed) / 2;
        car.speed = avg;
        o.speed = avg;
      }
    }
  }
}

// --- Spawning and upkeep -----------------------------------------------

export function spawnParked(g, count) {
  const spots = [];
  for (const av of AVENUES) {
    for (const st of STREETS) {
      // Curbside parking: inside the road's outer lane, clear of the
      // blocks (which start a few pixels past the road edge).
      spots.push({ x: av.x + ROAD_HALF - 16, y: st.y + 60, angle: Math.PI / 2 });
      spots.push({ x: av.x - ROAD_HALF + 16, y: st.y - 60, angle: -Math.PI / 2 });
    }
  }
  const pool = ['marlin', 'marlin', 'vano', 'comet', 'hauler', 'pickup', 'limo', 'moto'];
  for (let i = 0; i < count; i += 1) {
    const s = spots[randInt(g.rng, 0, spots.length - 1)];
    const type = randPick(g.rng, pool);
    const car = makeCar(
      g, type,
      s.x + randBetween(g.rng, -6, 6), s.y + randBetween(g.rng, -8, 8),
      s.angle, 'parked',
    );
    g.cars.push(car);
  }
}

export function maintainTraffic(g) {
  const want = g.settings.traffic === 'low' ? 8 : 16;
  const p = g.player;
  // Despawn traffic far from the player, but never a car a chapter is
  // actively using as a chase / tail target.
  g.cars = g.cars.filter((c) => {
    if (c.role !== 'traffic') return true;
    if (c.chaseTarget || c.tailTarget) return true;
    return Math.hypot(c.x - p.x, c.y - p.y) < 1500;
  });
  let n = 0;
  for (const c of g.cars) if (c.role === 'traffic') n += 1;
  const pool = ['marlin', 'marlin', 'vano', 'cabrio', 'hauler', 'pickup'];
  // Never drop a car on top of the player or another car: retry a few
  // positions, else skip the spawn this tick (the maintainer runs
  // again in 0.5 s). The attempt cap keeps a saturated street from
  // spinning the loop.
  let attempts = 0;
  while (n < want && attempts < 64) {
    attempts += 1;
    const car = makeCar(g, randPick(g.rng, pool), 0, 0, 0, 'traffic');
    // Drop it on a road near the player.
    const av = randPick(g.rng, AVENUES);
    car.road = 'v';
    car.line = av.x;
    car.dir = randChance(g.rng, 0.5) ? 1 : -1;
    car.lane = car.dir > 0 ? 18 : -18;
    car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    let placed = false;
    for (let tries = 0; tries < 6 && !placed; tries += 1) {
      car.x = av.x + car.lane;
      car.y = clamp(p.y + randBetween(g.rng, -600, 600), 80, 2320);
      const nearPlayer = Math.hypot(car.x - p.x, car.y - p.y) < 140;
      const nearCar = g.cars.some((o) => !o.dead && Math.hypot(o.x - car.x, o.y - car.y) < 70);
      if (!nearPlayer && !nearCar) placed = true;
    }
    if (!placed) continue;
    g.cars.push(car);
    n += 1;
  }
}

// --- Main per-frame step ------------------------------------------------

export function stepVehicles(g, dt, axis) {
  for (const car of g.cars) {
    if (car.dead) continue;
    // A wrecked car burns on its fuse, then explodes.
    if (car.fuseT > 0) {
      car.fuseT -= dt;
      car.speed *= Math.max(0, 1 - 3 * dt);
      // A burning car keeps rolling while it decelerates: freezing it
      // in place for the whole fuse looked wrong and blocked the road.
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      emitDamageSmoke(g, car, dt);
      if (car.fuseT <= 0) explodeCar(g, car);
      else collideCars(g, car, dt);
      continue;
    }
    if (car.role === 'player' && g.player.carId === car.id) {
      stepPlayerCar(g, car, dt, axis);
    } else if (car.role === 'traffic') {
      stepTrafficCar(g, car, dt);
      emitDamageSmoke(g, car, dt);
    } else if (car.role === 'police') {
      // Driven by cops.js; roadblock cars sit still. They still run
      // collideCars below: patrol cars used to phase through buildings
      // while chasing, with no wall push-out or world clamp. A hard
      // crash can light their fuse now; the cop loop already tolerates
      // a missing or dead car.
    }
    collideCars(g, car, dt);
  }
  // A car is removed once it is dead and its explosion has fired.
  if (g.cars.some((c) => c.dead)) {
    g.cars = g.cars.filter((c) => !c.dead);
  }
}
