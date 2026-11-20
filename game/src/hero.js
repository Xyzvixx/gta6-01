// Rico Vale, on foot — stride, sprint, aim, and climbing in and out of
// cars. This file only ever moves the player record that lives on the
// game state. Driving itself belongs to traffic.js, and the wanted level
// belongs to cops.js.
import { CAR_DEFS } from './content.js';
import { clamp } from './dice.js';

// On-foot feel, all in one place so the walk/run balance can be tuned
// without touching any other system.
const WALK_SPEED = 175;
const RUN_SPEED = 265;
const BODY_RADIUS = 13;
const MAP_WIDTH = 3200;
const MAP_HEIGHT = 2400;
const EDGE_MARGIN = 20;
const WATER_KEEPOUT = 24;

// Squared distance, so proximity checks never pay for a square root.
function squaredDistance(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

// Resolve a circular body against every building rectangle. Rectangles
// are stored by centre: [x - w/2, x + w/2] by [y - h/2, y + h/2], the
// convention buildTown uses when it generates them. Returns true when
// any wall actually pushed the body.
function resolveWalls(g, body, radius) {
  const city = g.city;
  if (!city || !city.buildings) return false;
  let collided = false;
  for (const b of city.buildings) {
    const left = b.x - b.w / 2;
    const right = b.x + b.w / 2;
    const top = b.y - b.h / 2;
    const bottom = b.y + b.h / 2;
    const nearestX = clamp(body.x, left, right);
    const nearestY = clamp(body.y, top, bottom);
    const offX = body.x - nearestX;
    const offY = body.y - nearestY;
    const distSq = offX * offX + offY * offY;
    if (distSq >= radius * radius) continue;
    collided = true;
    if (distSq > 0.01) {
      const dist = Math.sqrt(distSq);
      body.x = nearestX + (offX / dist) * radius;
      body.y = nearestY + (offY / dist) * radius;
    } else {
      // Dead-centre inside the rect: shove straight up out of it.
      body.y = top - radius;
    }
  }
  return collided;
}

function confineToMap(body, margin) {
  body.x = clamp(body.x, margin, MAP_WIDTH - margin);
  body.y = clamp(body.y, margin, MAP_HEIGHT - margin);
}

export function makeHero(x, y) {
  return {
    x, y,
    angle: -Math.PI / 2,
    hp: 100,
    armor: 0,
    cash: 250,
    weapon: 'pistol',
    mags: { pistol: 12, smg: 0, shotgun: 0, rifle: 0 },
    ammo: { pistol: 96, smg: 0, shotgun: 0, rifle: 0 },
    owned: ['fists', 'pistol'],
    fireT: 0,
    outfit: 'street',
    carId: null,
    moving: false,
    stepT: 0,
    arrestT: 0,
    invuln: 0,
  };
}

// The car Rico is sitting in right now, or null while he is on foot.
export function heroCar(g) {
  if (g.player.carId === null || g.player.carId === undefined) return null;
  for (const c of g.cars) {
    if (c.id === g.player.carId) return c;
  }
  return null;
}

export function stepOnFoot(g, dt, axis, aimAngle) {
  const p = g.player;
  // Axes carry x/y plus a run flag; when x/y are absent, rebuild them
  // from the four direction flags.
  const hasVector = axis.x !== undefined;
  const ix = hasVector ? axis.x : (axis.right ? 1 : 0) - (axis.left ? 1 : 0);
  const iy = hasVector ? axis.y : (axis.down ? 1 : 0) - (axis.up ? 1 : 0);
  const len = Math.hypot(ix, iy);
  p.moving = len > 0;
  if (len > 0) {
    const pace = axis.run ? RUN_SPEED : WALK_SPEED;
    const nx = ix / len;
    const ny = iy / len;
    p.x += nx * pace * dt;
    p.y += ny * pace * dt;
    // Aim direction wins while aiming; otherwise face the walk direction.
    p.angle = (aimAngle !== null && aimAngle !== undefined)
      ? aimAngle
      : Math.atan2(ny, nx);
    p.stepT += dt;
  }
  resolveWalls(g, p, BODY_RADIUS);
  confineToMap(p, EDGE_MARGIN);
  // The harbour water is out of bounds on foot.
  const waterX = g.city ? g.city.waterX : undefined;
  if (waterX !== undefined && p.x > waterX - WATER_KEEPOUT) p.x = waterX - WATER_KEEPOUT;
  if (p.invuln > 0) p.invuln -= dt;
}

// Closest car Rico could climb into. A police car with its driver still
// inside is never boardable, and neither is a wreck.
export function nearestBoardable(g, maxDist = 64) {
  const p = g.player;
  let best = null;
  let bestD2 = maxDist * maxDist;
  for (const c of g.cars) {
    if (c.dead) continue;
    if (c.role === 'police' && c.driver) continue;
    const d2 = squaredDistance(p.x, p.y, c.x, c.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = c;
    }
  }
  return best;
}

// A traffic driver whose car is being taken bails out and runs.
function ejectDriver(g, car) {
  if (!car.driver) return;
  const driver = g.peds.find((pd) => pd.id === car.driverPedId);
  if (driver) {
    driver.x = car.x + 40;
    driver.y = car.y + 30;
    driver.panic = 3;
    driver.state = 'flee';
  }
  car.driver = false;
  car.driverPedId = null;
}

// Try to get into `car`. Returns 'stole' for a fresh theft, 'entered'
// for climbing back into a car that is already ours, or null when
// boarding is impossible (police car, wreck, already driving).
export function boardCar(g, car) {
  const p = g.player;
  if (!car || car.dead) return null;
  if (p.carId !== null) return null;
  if (car.role === 'parked' || car.role === 'traffic') {
    ejectDriver(g, car);
    g.addHeat(26, 'steal');
    g.stats.stolen += 1;
    car.role = 'player';
    // A stolen mission-target car must not stay invulnerable: hurtCar
    // returns early while missionTarget is set, so a target Rico steals
    // mid-chase would be indestructible. The armour only protects the
    // target while Rico is NOT driving it; the stage-end cleanup
    // (story.js clearStageTarget) already assumes the driven car loses
    // the flag.
    car.missionTarget = false;
    car.chaseTarget = false;
    car.tailTarget = false;
    p.carId = car.id;
    g.toast(`Stole a ${CAR_DEFS[car.type].label} — the cops noticed!`);
    g.audio.crash();
    return 'stole';
  }
  if (car.role === 'player') {
    p.carId = car.id;
    return 'entered';
  }
  return null;
}

export function leaveCar(g) {
  const p = g.player;
  const car = heroCar(g);
  if (!car) return;
  p.carId = null;
  // Remember when Rico stepped out: the point-blank board in main.js
  // must not fire for the next couple of seconds, or the E press that
  // was meant for the garage/shop at Dex re-boards a car parked right
  // next to the exit spot instead. The guard is time-based, not
  // distance-based, because a parked car can sit anywhere around Dex.
  g.lastExitAt = g.stats ? g.stats.playtime : 0;
  // Step out on the car's left side so Rico never spawns inside the body.
  // The step is 44 px on purpose: the point-blank board in main.js
  // grabs any car within 34 px, and the old 34 px step put Rico exactly
  // on that boundary — the next E after getting out re-boarded the car
  // instead of opening the garage/shop at Dex, a coin flip that made
  // the shop tests flaky. 44 px clears the radius with margin, and the
  // engine's normal 66 px board range still lets Rico climb back in.
  const side = car.angle + Math.PI / 2;
  p.x = car.x + Math.cos(side) * 44;
  p.y = car.y + Math.sin(side) * 44;
  p.angle = car.angle;
  resolveWalls(g, p, BODY_RADIUS);
  confineToMap(p, EDGE_MARGIN);
}

export function hurtHero(g, dmg) {
  const p = g.player;
  if (p.invuln > 0 || p.hp <= 0) return;
  // A vest soaks 60% of each hit until it is shredded.
  let remaining = dmg;
  if (p.armor > 0) {
    const soaked = Math.min(p.armor, remaining * 0.6);
    p.armor -= soaked;
    remaining -= soaked;
  }
  p.hp -= remaining;
  p.invuln = 0.25;
  if (p.hp <= 0) {
    p.hp = 0;
    g.onWasted();
  }
}

export function healHero(g, amount) {
  const p = g.player;
  p.hp = clamp(p.hp + amount, 0, 100);
}
