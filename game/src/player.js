// Rico Vale on foot: walking, running, aiming, entering and leaving cars.
// The player object lives on the game state; this module only moves it.
import { WALK } from './config.js';
import { clamp, dist2 } from './random.js';
import { clampToWorld, collideBuildings, isWater } from './city.js';
import { CAR_DEFS } from './data.js';

export function makePlayer(x, y) {
  return {
    x, y, angle: -Math.PI / 2, hp: 100, armor: 0, cash: 250,
    weapon: 'pistol', mag: 12, ammo: { pistol: 96, smg: 0, shotgun: 0 },
    owned: ['fists', 'pistol'], fireT: 0,
    outfit: 'street', carId: null, moving: false, stepT: 0,
    arrestT: 0, invuln: 0,
  };
}

export function playerCar(g) {
  if (g.player.carId === null) return null;
  return g.cars.find((c) => c.id === g.player.carId) || null;
}

export function stepOnFoot(g, dt, axis, aimAngle) {
  const p = g.player;
  const speed = axis.run ? WALK.run : WALK.speed;
  const mx = axis.x;
  const my = axis.y;
  const len = Math.hypot(mx, my);
  p.moving = len > 0;
  if (len > 0) {
    const nx = (mx / len) * speed * dt;
    const ny = (my / len) * speed * dt;
    p.x += nx;
    p.y += ny;
    p.angle = aimAngle !== null && aimAngle !== undefined ? aimAngle : Math.atan2(my, mx);
    p.stepT += dt;
  }
  collideBuildings(g.city, p, WALK.radius);
  clampToWorld(p, 20);
  if (isWater(g.city, p.x)) p.x = g.city.waterX - 24;
  if (p.invuln > 0) p.invuln -= dt;
}

// Nearest car the player could get into (parked, traffic or empty).
export function nearestBoardable(g, maxDist = 64) {
  const p = g.player;
  let best = null;
  let bestD = maxDist * maxDist;
  for (const c of g.cars) {
    if (c.role === 'police' && c.driver) continue;
    const d = dist2(p.x, p.y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// Try to get into `car`. Returns a short event string for the HUD/toast.
export function boardCar(g, car) {
  const p = g.player;
  if (!car) return null;
  if (car.role === 'parked' || car.role === 'traffic') {
    // Stealing: the driver (if any) bails out and runs.
    if (car.driver) {
      const d = g.peds.find((pd) => pd.id === car.driverPedId);
      if (d) {
        d.x = car.x + 40;
        d.y = car.y + 30;
        d.panic = 3;
        d.state = 'flee';
      }
      car.driver = false;
      car.driverPedId = null;
    }
    g.addHeat(26, 'steal');
    g.stats.stolen += 1;
    car.role = 'player';
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
  const car = playerCar(g);
  if (!car) return;
  p.carId = null;
  p.x = car.x + Math.cos(car.angle + Math.PI / 2) * 34;
  p.y = car.y + Math.sin(car.angle + Math.PI / 2) * 34;
  p.angle = car.angle;
  collideBuildings(g.city, p, WALK.radius);
  clampToWorld(p, 20);
}

export function hurtPlayer(g, dmg) {
  const p = g.player;
  if (p.invuln > 0 || p.hp <= 0) return;
  let rest = dmg;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, rest * 0.6);
    p.armor -= absorbed;
    rest -= absorbed;
  }
  p.hp -= rest;
  p.invuln = 0.25;
  if (p.hp <= 0) {
    p.hp = 0;
    g.onWasted();
  }
}

export function healPlayer(g, amount) {
  const p = g.player;
  p.hp = clamp(p.hp + amount, 0, 100);
}
