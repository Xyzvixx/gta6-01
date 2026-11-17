// Cars: arcade driving physics for the player's car, plus the traffic that
// follows the road grid. Traffic cars drive along one avenue or street at a
// time and pick a new road at intersections, so they can never deadlock in
// a pile-up: each car only ever follows its own lane line.
import { AVENUES, CAR_DEFS, ROAD_HALF, STREETS } from './data.js';
import { CAR_PHYSICS } from './config.js';
import { chance, clamp, intRange, pick, range, turnDelta } from './random.js';
import { clampToWorld, collideBuildings } from './city.js';

let nextCarId = 1;

export function makeCar(g, type, x, y, angle, role) {
  const def = CAR_DEFS[type];
  const car = {
    id: nextCarId,
    type, x, y, angle, speed: 0, steer: 0,
    hp: 100, maxHp: 100, color: pick(g.rng, def.colors),
    role, driver: role === 'traffic',
    driverPedId: null, glow: false,
    // traffic brain: which road line it follows and which way along it
    road: null, line: 0, dir: 1, lane: 0, waitT: 0,
    smokeT: 0, dead: false,
  };
  nextCarId += 1;
  if (role === 'traffic') assignRoad(g, car);
  return car;
}

function assignRoad(g, car) {
  const rng = g.rng;
  if (chance(rng, 0.5)) {
    const av = pick(rng, AVENUES);
    car.road = 'v';
    car.line = av.x;
    car.dir = chance(rng, 0.5) ? 1 : -1;
    car.lane = car.dir > 0 ? 18 : -18;
    car.x = av.x + car.lane;
    car.y = range(rng, 60, 2340);
    car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    const st = pick(rng, STREETS);
    car.road = 'h';
    car.line = st.y;
    car.dir = chance(rng, 0.5) ? 1 : -1;
    car.lane = car.dir > 0 ? 18 : -18;
    car.x = range(rng, 60, 3140);
    car.y = st.y + car.lane;
    car.angle = car.dir > 0 ? 0 : Math.PI;
  }
  car.speed = range(rng, 90, 170);
}

export function damageTier(car) {
  if (car.hp > 65) return 0;
  if (car.hp > 35) return 1;
  if (car.hp > 0) return 2;
  return 3;
}

export function hurtCar(g, car, dmg, cause) {
  if (car.dead) return;
  car.hp -= dmg;
  if (car.hp <= 0) {
    car.hp = 0;
    car.dead = true;
    car.speed = 0;
    g.burst(car.x, car.y, 26, '#ff9a3d', 260);
    g.burst(car.x, car.y, 14, '#555', 140);
    g.audio.crash();
    if (car.role === 'player') {
      g.toast('Your car blew up!');
      g.player.carId = null;
      g.player.x = car.x + 50;
      g.player.y = car.y + 40;
    }
    if (cause === 'player') g.addHeat(8, 'crash');
  }
}

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

function stepTraffic(g, car, dt) {
  const def = CAR_DEFS[car.type];
  const ahead = carAhead(g, car, 95);
  let target = def.top * 0.55;
  if (ahead) target = Math.max(0, ahead.speed - 12);
  if (car.waitT > 0) {
    car.waitT -= dt;
    target = 0;
  }
  car.speed += clamp(target - car.speed, -260 * dt, 150 * dt);
  if (car.speed < 2 && ahead) car.waitT = 0.4;

  // Move along the road line; at an intersection maybe turn.
  if (car.road === 'v') {
    car.y += car.dir * car.speed * dt;
    car.x += (car.line + car.lane - car.x) * Math.min(1, dt * 3);
    car.angle += turnDelta(car.angle, car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) * Math.min(1, dt * 4);
    for (const st of STREETS) {
      if (Math.abs(car.y - st.y) < 6 && chance(g.rng, 0.3)) {
        car.road = 'h';
        car.line = st.y;
        car.dir = chance(g.rng, 0.5) ? 1 : -1;
        car.lane = car.dir > 0 ? 18 : -18;
        car.y = st.y + car.lane;
        break;
      }
    }
    if (car.y < 40 || car.y > 2360) {
      car.dir *= -1;
      car.lane = car.dir > 0 ? 18 : -18;
    }
  } else {
    car.x += car.dir * car.speed * dt;
    car.y += (car.line + car.lane - car.y) * Math.min(1, dt * 3);
    car.angle += turnDelta(car.angle, car.dir > 0 ? 0 : Math.PI) * Math.min(1, dt * 4);
    for (const av of AVENUES) {
      if (Math.abs(car.x - av.x) < 6 && chance(g.rng, 0.3)) {
        car.road = 'v';
        car.line = av.x;
        car.dir = chance(g.rng, 0.5) ? 1 : -1;
        car.lane = car.dir > 0 ? 18 : -18;
        car.x = av.x + car.lane;
        break;
      }
    }
    if (car.x < 40 || car.x > 3160) {
      car.dir *= -1;
      car.lane = car.dir > 0 ? 18 : -18;
    }
  }
}

export function stepPlayerCar(g, car, dt, axis) {
  const def = CAR_DEFS[car.type];
  const grip = g.weather.rain > 0.4 ? CAR_PHYSICS.gripWet : CAR_PHYSICS.gripDry;
  const top = def.top * (car.hp < 35 ? 0.55 : 1);
  if (axis.up) car.speed += CAR_PHYSICS.accel * dt;
  else if (axis.down) {
    if (car.speed > 8) car.speed -= CAR_PHYSICS.brake * dt;
    else car.speed -= CAR_PHYSICS.accel * 0.55 * dt;
  } else {
    car.speed -= car.speed * CAR_PHYSICS.drag * dt;
  }
  car.speed = clamp(car.speed, -CAR_PHYSICS.reverseMax, top);
  const steerInput = (axis.right ? 1 : 0) - (axis.left ? 1 : 0);
  const steerAuthority = clamp(Math.abs(car.speed) / 90, 0, 1);
  car.angle += steerInput * CAR_PHYSICS.turnRate * def.grip * grip * steerAuthority * dt * (car.speed < 0 ? -1 : 1);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  // Exhaust puffs while accelerating hard.
  if (axis.up && Math.abs(car.speed) > 60 && g.rng() < 0.35) {
    g.particles.push({
      x: car.x - Math.cos(car.angle) * 28, y: car.y - Math.sin(car.angle) * 28,
      vx: -Math.cos(car.angle) * 30 + range(g.rng, -12, 12), vy: -Math.sin(car.angle) * 30 - 22,
      life: 0.6, max: 0.6, size: 5, color: '#8a8d90', kind: 'puff',
    });
  }
  // Damage smoke / fire.
  const tier = damageTier(car);
  car.smokeT -= dt;
  if (tier === 1 && car.smokeT <= 0) {
    car.smokeT = 0.28;
    g.particles.push({ x: car.x, y: car.y - 8, vx: range(g.rng, -8, 8), vy: -46, life: 0.9, max: 0.9, size: 7, color: '#777', kind: 'puff' });
  } else if (tier === 2 && car.smokeT <= 0) {
    car.smokeT = 0.1;
    g.particles.push({ x: car.x, y: car.y - 8, vx: range(g.rng, -14, 14), vy: -70, life: 0.7, max: 0.7, size: 6, color: g.rng() < 0.5 ? '#ff7a2e' : '#666', kind: 'puff' });
  }
}

// Police cars are driven by police.js through this same steering helper.
export function stepChaseCar(g, car, dt, targetAngle, targetSpeed) {
  car.angle += turnDelta(car.angle, targetAngle) * Math.min(1, dt * 3.2);
  car.speed += clamp(targetSpeed - car.speed, -420 * dt, 300 * dt);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
}

export function collideCars(g, car) {
  // Buildings + world edge.
  const def = CAR_DEFS[car.type];
  const radius = def.len * 0.42;
  if (collideBuildings(g.city, car, radius)) {
    if (Math.abs(car.speed) > 120) {
      hurtCar(g, car, Math.abs(car.speed) * 0.045, car.role === 'player' ? 'player' : null);
      g.audio.crash();
      g.burst(car.x, car.y, 8, '#c8c8c8', 130);
      if (car.role === 'player') g.addHeat(4, 'crash');
    }
    car.speed *= -0.32;
  }
  clampToWorld(car, 26);
  if (car.x > g.city.waterX - 20) {
    car.x = g.city.waterX - 20;
    car.speed *= 0.4;
  }
  // Car vs car: simple push-apart + speed exchange.
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
      car.x -= nx * push;
      car.y -= ny * push;
      o.x += nx * push;
      o.y += ny * push;
      const impact = Math.abs(car.speed - o.speed);
      if (impact > 140) {
        hurtCar(g, car, impact * 0.03, car.role === 'player' ? 'player' : null);
        hurtCar(g, o, impact * 0.03, o.role === 'player' ? 'player' : null);
        if (car.role === 'player' || o.role === 'player') g.audio.crash();
      }
      const avg = (car.speed + o.speed) / 2;
      car.speed = avg;
      o.speed = avg;
    }
  }
}

export function spawnParked(g, count) {
  const spots = [];
  for (const av of AVENUES) {
    for (const st of STREETS) {
      // Curbside parking: inside the road's outer lane, clear of buildings
      // (blocks start 14px past the road edge).
      spots.push({ x: av.x + ROAD_HALF - 16, y: st.y + 60, angle: Math.PI / 2 });
      spots.push({ x: av.x - ROAD_HALF + 16, y: st.y - 60, angle: -Math.PI / 2 });
    }
  }
  for (let i = 0; i < count; i += 1) {
    const s = spots[intRange(g.rng, 0, spots.length - 1)];
    const type = pick(g.rng, ['marlin', 'marlin', 'vano', 'comet', 'hauler']);
    const car = makeCar(g, type, s.x + range(g.rng, -6, 6), s.y + range(g.rng, -8, 8), s.angle, 'parked');
    g.cars.push(car);
  }
}

export function maintainTraffic(g) {
  const want = g.settings.traffic === 'low' ? 8 : 16;
  let n = 0;
  for (const c of g.cars) if (c.role === 'traffic') n += 1;
  const p = g.player;
  // Despawn traffic far away, spawn fresh ones near the player.
  g.cars = g.cars.filter((c) => {
    if (c.role !== 'traffic') return true;
    return Math.hypot(c.x - p.x, c.y - p.y) < 1500;
  });
  n = 0;
  for (const c of g.cars) if (c.role === 'traffic') n += 1;
  while (n < want) {
    const car = makeCar(g, pick(g.rng, ['marlin', 'marlin', 'vano', 'cabrio', 'hauler']), 0, 0, 0, 'traffic');
    // Drop it on a road near the player.
    const av = pick(g.rng, AVENUES);
    car.road = 'v';
    car.line = av.x;
    car.dir = chance(g.rng, 0.5) ? 1 : -1;
    car.lane = car.dir > 0 ? 18 : -18;
    car.x = av.x + car.lane;
    car.y = clamp(p.y + range(g.rng, -600, 600), 80, 2320);
    car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.cars.push(car);
    n += 1;
  }
}

export function stepVehicles(g, dt, axis) {
  for (const car of g.cars) {
    if (car.dead) continue;
    if (car.role === 'player' && g.player.carId === car.id) stepPlayerCar(g, car, dt, axis);
    else if (car.role === 'traffic') stepTraffic(g, car, dt);
    else if (car.role === 'police') { /* driven by police.js */ }
    if (car.role !== 'police') collideCars(g, car);
  }
}
