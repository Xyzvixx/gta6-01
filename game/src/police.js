// Wanted level + police. Heat (0-100) maps to 1-5 stars; crimes add heat,
// hiding cools it. Foot cops chase and try to arrest; patrol cars ram and
// block. At 3+ stars roadblocks appear ahead of the player. Getting busted
// or wasted is a clean, recoverable reset — never a dead end.
import { WANTED } from './config.js';
import { angleTo, clamp, range, turnDelta } from './random.js';
import { makeCar, stepChaseCar } from './vehicles.js';

let nextCopId = 1;

export function wantedLevel(heat) {
  if (heat <= 0) return 0;
  return Math.min(5, 1 + Math.floor(heat / 20));
}

export function stepPolice(g, dt) {
  const w = g.wanted;
  const level = wantedLevel(w.heat);
  w.level = level;
  if (level > g.stats.topWanted) g.stats.topWanted = level;

  // Calm down when no cop can see the player and no crime just happened.
  w.calmT -= dt;
  let nearestCop = Infinity;
  for (const c of g.cops) nearestCop = Math.min(nearestCop, Math.hypot(c.x - g.player.x, c.y - g.player.y));
  if (w.heat > 0 && w.calmT <= 0 && nearestCop > 380) {
    w.heat = Math.max(0, w.heat - WANTED.decayPerSec * dt);
  }

  // Spawn to match the wanted level.
  const wantFoot = level >= 1 ? Math.min(level, 3) : 0;
  const wantCars = level >= 2 ? Math.min(level - 1, 3) : 0;
  let foot = 0;
  let cars = 0;
  for (const c of g.cops) {
    if (c.kind === 'foot') foot += 1;
    else cars += 1;
  }
  const p = g.player;
  while (foot < wantFoot) {
    const a = range(g.rng, 0, Math.PI * 2);
    g.cops.push({
      id: nextCopId, kind: 'foot',
      x: clamp(p.x + Math.cos(a) * 420, 40, 3160),
      y: clamp(p.y + Math.sin(a) * 420, 40, 2360),
      angle: 0, speed: 0, arrestT: 0,
    });
    nextCopId += 1;
    foot += 1;
  }
  while (cars < wantCars) {
    const a = range(g.rng, 0, Math.PI * 2);
    const car = makeCar(g, 'interceptor', clamp(p.x + Math.cos(a) * 520, 60, 3140), clamp(p.y + Math.sin(a) * 520, 60, 2340), 0, 'police');
    g.cars.push(car);
    g.cops.push({ id: nextCopId, kind: 'car', carId: car.id, x: car.x, y: car.y, angle: 0, speed: 0, arrestT: 0 });
    nextCopId += 1;
    cars += 1;
  }

  // Roadblocks at 3+ stars: two parked patrol cars ahead on the player's road.
  if (level >= 3 && !g.roadblock && g.rng() < dt * 0.25) {
    const car = g.cars.find((c) => c.id === g.player.carId);
    const heading = car ? car.angle : p.angle;
    const bx = clamp(p.x + Math.cos(heading) * 560, 80, 3120);
    const by = clamp(p.y + Math.sin(heading) * 560, 80, 2320);
    for (const off of [-34, 34]) {
      const px = bx + Math.cos(heading + Math.PI / 2) * off;
      const py = by + Math.sin(heading + Math.PI / 2) * off;
      const block = makeCar(g, 'interceptor', px, py, heading + Math.PI / 2, 'police');
      block.speed = 0;
      g.cars.push(block);
    }
    g.roadblock = { x: bx, y: by, t: 14 };
    g.toast('Roadblock ahead!');
  }
  if (g.roadblock) {
    g.roadblock.t -= dt;
    if (g.roadblock.t <= 0 || Math.hypot(p.x - g.roadblock.x, p.y - g.roadblock.y) > 1600) g.roadblock = null;
  }

  // Move the cops.
  for (const c of g.cops) {
    if (c.kind === 'foot') {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      const target = angleTo(c.x, c.y, p.x, p.y);
      c.angle += turnDelta(c.angle, target) * Math.min(1, dt * 5);
      const sp = d > 300 ? 235 : 200;
      c.x += Math.cos(c.angle) * sp * dt;
      c.y += Math.sin(c.angle) * sp * dt;
      if (d < 26 && p.carId === null) {
        c.arrestT += dt;
        if (c.arrestT > 1.1) {
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
      const target = angleTo(car.x, car.y, p.x, p.y);
      const playerCar = g.cars.find((cc) => cc.id === p.carId);
      const top = playerCar ? Math.min(430, 300 + level * 28) : 330;
      stepChaseCar(g, car, dt, target, top);
      c.x = car.x;
      c.y = car.y;
      // Ram the player's car: shove it and chip its health, never insta-kill.
      if (playerCar && Math.hypot(car.x - playerCar.x, car.y - playerCar.y) < 46) {
        playerCar.speed *= 0.94;
        playerCar.hp = Math.max(0, playerCar.hp - 9 * dt);
        const push = angleTo(playerCar.x, playerCar.y, car.x, car.y);
        playerCar.x -= Math.cos(push) * 26 * dt;
        playerCar.y -= Math.sin(push) * 26 * dt;
      }
    }
  }
  // Drop cops that are hopelessly far or whose car died; clear heat when done.
  g.cops = g.cops.filter((c) => {
    if (c.gone) return false;
    if (c.kind === 'car') {
      const car = g.cars.find((cc) => cc.id === c.carId);
      if (!car) return false;
    }
    return Math.hypot(c.x - p.x, c.y - p.y) < 1700 || level > 0;
  });
  if (level === 0) {
    for (const c of g.cops) {
      if (c.kind === 'car') {
        const car = g.cars.find((cc) => cc.id === c.carId);
        if (car) car.role = 'traffic';
      }
    }
    g.cops = [];
    g.roadblock = null;
  }
}
