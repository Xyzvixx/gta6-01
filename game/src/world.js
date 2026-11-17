// The one authoritative game state and its fixed-tick update. Every system
// reads and writes this object; transitions that end a mission, bust or waste
// the player go through exactly one function each, in a fixed order, so two
// terminal outcomes can never fire in the same tick.
import { AVENUES, SHOP_DEFS, STREETS } from './data.js';
import { CLOCK, STEP } from './config.js';
import { buildCity } from './city.js';
import { createAudio } from './audio.js';
import { makeRng, clamp, range } from './random.js';
import { makePlayer, stepOnFoot, nearestBoardable, boardCar, leaveCar } from './player.js';
import { makeCar, spawnParked, maintainTraffic, stepVehicles } from './vehicles.js';
import { maintainPeds, stepPeds, scarePeds } from './pedestrians.js';
import { stepPolice } from './police.js';
import { stepCombat, reloadWeapon } from './combat.js';
import { activeWaypoint, currentStage, failMission, startJob, startStory, updateMissions } from './missions.js';
import { readSave, writeSave } from './save.js';

export function createGame(seed) {
  const rng = makeRng(seed);
  const city = buildCity(rng);
  const audio = createAudio();
  const g = {
    seed, rng, city,
    cityAvenues: AVENUES,
    cityStreets: STREETS,
    audio,
    time: 0,
    clock: CLOCK.startHour,
    weather: { rain: 0, target: 0, timer: 70 },
    settings: { music: true, traffic: 'high', freezeTime: false },
    player: makePlayer(city.spawn.x, city.spawn.y),
    cars: [],
    peds: [],
    cops: [],
    enemies: [],
    bullets: [],
    particles: [],
    pickups: [],
    rainDrops: [],
    wanted: { heat: 0, level: 0, calmT: 0 },
    missionIndex: 0,
    stageIndex: 0,
    missionData: {},
    missionTitle: '',
    missionsDone: [],
    job: null,
    stats: { stolen: 0, kills: 0, missions: 0, jobs: 0, topWanted: 0, playtime: 0 },
    camera: { x: city.spawn.x, y: city.spawn.y, shake: 0 },
    messages: [],
    screen: 'title',
    shopId: null,
    roadblock: null,
    aimAngle: null,
    waypoint: null,
    hasSave: false,
    saveSoon: false,
    saveT: 0,
    maintainT: 0,
    dead: false,
  };

  // Facade methods the subsystems call.
  g.toast = (text) => {
    g.messages.push({ text, t: g.time });
    if (g.messages.length > 4) g.messages.shift();
  };
  g.addHeat = (n, cause) => {
    if (g.wanted.heat >= 100) return;
    g.wanted.heat = clamp(g.wanted.heat + n, 0, 100);
    g.wanted.calmT = 6;
    if (cause === 'steal' || cause === 'kill') g.camera.shake = Math.max(g.camera.shake, 4);
  };
  g.burst = (x, y, n, color, speed) => {
    for (let i = 0; i < n; i += 1) {
      const a = range(g.rng, 0, Math.PI * 2);
      const s = range(g.rng, speed * 0.3, speed);
      g.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: range(g.rng, 0.3, 0.8), max: 0.8, size: range(g.rng, 2, 5), color, kind: 'spark',
      });
    }
  };
  g.scarePeds = scarePeds;
  g.dropPickup = (x, y) => {
    const roll = g.rng();
    const kind = roll < 0.4 ? 'health' : roll < 0.65 ? 'ammo' : roll < 0.85 ? 'cash' : 'armor';
    g.pickups.push({ kind, x: x + range(g.rng, -20, 20), y: y + range(g.rng, -20, 20) });
  };
  g.onWasted = () => {
    if (g.screen !== 'play') return;
    g.screen = 'dead';
    g.player.cash = Math.max(0, g.player.cash - 150);
    g.wanted.heat = 0;
    g.wanted.level = 0;
    g.cops = [];
    g.enemies = [];
    failMission(g, 'wasted');
    g.audio.fail();
  };
  g.onBusted = () => {
    if (g.screen !== 'play') return;
    g.screen = 'busted';
    g.player.cash = Math.max(0, g.player.cash - 100);
    g.wanted.heat = 0;
    g.wanted.level = 0;
    g.cops = [];
    failMission(g, 'busted');
    g.audio.fail();
  };

  // World population.
  spawnParked(g, 26);
  const taxi = makeCar(g, 'cabrio', 1100, 1020, Math.PI / 2, 'parked');
  g.cars.push(taxi);
  const sport = makeCar(g, 'comet', 1500, 1120, 0, 'parked');
  g.cars.push(sport);
  maintainTraffic(g);
  maintainPeds(g);
  // A couple of pickups lying around the spawn.
  g.pickups.push({ kind: 'health', x: city.spawn.x + 120, y: city.spawn.y - 60 });
  g.pickups.push({ kind: 'cash', x: city.spawn.x - 140, y: city.spawn.y + 80 });

  startStory(g, 0);
  return g;
}

export function respawnPlayer(g) {
  const p = g.player;
  const atHospital = g.screen === 'dead';
  const spot = atHospital ? g.city.hospital : g.city.policeStation;
  p.hp = 100;
  p.armor = 0;
  p.carId = null;
  p.x = spot.x;
  p.y = spot.y;
  p.angle = -Math.PI / 2;
  p.invuln = 2;
  g.camera.x = p.x;
  g.camera.y = p.y;
  g.screen = 'play';
  g.toast(atHospital ? 'Patched up at the hospital.' : 'Rosa let you walk. This time.');
}

// One fixed step. `axis` is the input axes, `edgeFlags` the edge flags for
// this frame (passed in by main.js — only the first substep of a frame gets
// them, so a press is never counted twice), `shooting` whether the mouse is
// held, `aim` the world-space aim angle.
export function stepGame(g, input, dt, edgeFlags = 0) {
  g.time += dt;
  g.stats.playtime += dt;
  if (!g.settings.freezeTime) {
    g.clock += dt / CLOCK.secondsPerHour;
    if (g.clock >= 24) g.clock -= 24;
  }

  // Weather: dry spells, then rain that fades in and out.
  const w = g.weather;
  w.timer -= dt;
  if (w.timer <= 0) {
    if (w.target === 0) {
      w.target = 1;
      w.timer = 28 + g.rng() * 27;
    } else {
      w.target = 0;
      w.timer = 55 + g.rng() * 75;
    }
  }
  const fade = dt / 9;
  w.rain += clamp(w.target - w.rain, -fade, fade);
  w.rain = clamp(w.rain, 0, 1);

  // Rain streaks inside the view.
  const wantDrops = Math.floor(w.rain * 90);
  while (g.rainDrops.length < wantDrops) {
    g.rainDrops.push({
      x: g.camera.x + range(g.rng, -640, 640),
      y: g.camera.y + range(g.rng, -360, 360),
    });
  }
  if (g.rainDrops.length > wantDrops) g.rainDrops.length = wantDrops;
  for (const d of g.rainDrops) {
    d.y += 620 * dt;
    d.x -= 60 * dt;
    if (d.y > g.camera.y + 380) {
      d.y = g.camera.y - 360;
      d.x = g.camera.x + range(g.rng, -640, 640);
    }
  }

  const axis = input.axis();
  const edges = edgeFlags;
  const mouse = input.mouse();
  const shooting = mouse.down;
  // Aim comes from main.js, which converts the mouse position to world space
  // before stepping; never overwrite it here.

  const p = g.player;
  const wasInCar = p.carId !== null;

  // E: a mission hand-in at this spot beats everything, then the shop, then
  // boarding a car. (M1's pickup and M2's report sit on shop doorsteps.)
  if (edges & 1) {
    const stage = currentStage(g);
    const atHandIn = stage && stage.pressE && stage.target &&
      Math.hypot(stage.target.x - p.x, stage.target.y - p.y) < (stage.radius || 70);
    if (atHandIn) {
      // Missions read the same press below; nothing else happens here.
    } else if (p.carId === null) {
      const shop = g.city.shops.find((s) => Math.hypot(s.x - p.x, s.y - p.y) < 78);
      if (shop) {
        g.shopId = shop.id;
        g.screen = 'shop';
        g.audio.blip();
      } else {
        const car = nearestBoardable(g, 66);
        if (car) boardCar(g, car);
      }
    } else {
      leaveCar(g);
    }
  }
  if (edges & 2) reloadWeapon(g);

  // Move.
  if (p.carId !== null) {
    // Driving: aim follows the car's heading; shooting is a drive-by.
    if (g.aimAngle === null || g.aimAngle === undefined) g.aimAngle = p.angle;
  } else {
    stepOnFoot(g, dt, axis, g.aimAngle);
  }
  stepVehicles(g, dt, axis);
  // While driving, Rico's position IS the car's (missions, HUD and combat
  // all read the player position).
  const driven = g.cars.find((c) => c.id === p.carId);
  if (driven) {
    p.x = driven.x;
    p.y = driven.y;
    p.angle = driven.angle;
  }
  stepCombat(g, dt, shooting, g.aimAngle === null || g.aimAngle === undefined ? p.angle : g.aimAngle);
  stepPeds(g, dt);
  stepPolice(g, dt);
  updateMissions(g, dt, Boolean(edges & 1));

  // Taxi jobs start themselves when Rico climbs into a cab.
  const carNow = g.cars.find((c) => c.id === p.carId);
  if (!wasInCar && carNow && carNow.type === 'cabrio' && !g.job) {
    startJob(g, 'taxi');
  }

  // Particles.
  for (const pt of g.particles) {
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vy += (pt.kind === 'puff' ? -30 : 60) * dt;
    pt.life -= dt;
  }
  g.particles = g.particles.filter((pt) => pt.life > 0);

  // Waypoint + camera follow.
  g.waypoint = activeWaypoint(g);
  const focus = carNow || p;
  const tx = clamp(focus.x, 640, 3200 - 640);
  const ty = clamp(focus.y, 360, 2400 - 360);
  g.camera.x += (tx - g.camera.x) * Math.min(1, dt * 5);
  g.camera.y += (ty - g.camera.y) * Math.min(1, dt * 5);
  g.camera.shake = Math.max(0, g.camera.shake - dt * 14);

  // Ambient upkeep, twice a second.
  g.maintainT -= dt;
  if (g.maintainT <= 0) {
    g.maintainT = 0.5;
    maintainTraffic(g);
    maintainPeds(g);
  }

  // Audio beds.
  const driving = carNow ? Math.abs(carNow.speed) / 470 : 0;
  g.audio.setEngine(driving, Boolean(carNow));
  g.audio.setSiren(g.wanted.level >= 2, g.time);
  g.audio.setRain(w.rain);

  // Autosave.
  g.saveT += dt;
  if ((g.saveSoon && g.saveT > 1) || g.saveT > 60) {
    g.saveSoon = false;
    g.saveT = 0;
    writeSave(g);
  }
}

export function buyShopItem(g, index) {
  const shop = SHOP_DEFS.find((d) => d.id === g.shopId);
  if (!shop) return false;
  const item = shop.goods[index];
  if (!item) return false;
  const p = g.player;
  if (p.cash < item.price) {
    g.toast('Not enough cash');
    return false;
  }
  p.cash -= item.price;
  // The car being serviced: the one Rico is in, or the nearest one beside
  // him (he usually parks, gets out, then walks into the shop).
  let car = g.cars.find((c) => c.id === p.carId);
  if (!car) {
    let best = Infinity;
    for (const c of g.cars) {
      if (c.dead) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < best) {
        best = d;
        car = c;
      }
    }
    if (best > 200) car = null;
  }
  switch (item.id) {
    case 'repair':
      if (car) {
        car.hp = car.maxHp;
        car.dead = false;
        g.toast('Car fully repaired');
      } else {
        g.toast('No car to repair — hop in one first');
        p.cash += item.price;
        return false;
      }
      break;
    case 'armorcar':
      if (car) {
        car.maxHp += 40;
        car.hp = car.maxHp;
        g.toast('Armored panels fitted (+40 max HP)');
      } else {
        g.toast('No car to armor — hop in one first');
        p.cash += item.price;
        return false;
      }
      break;
    case 'paint':
      if (car) {
        car.glow = true;
        g.toast('Neon underglow installed');
      } else {
        g.toast('No car to paint — hop in one first');
        p.cash += item.price;
        return false;
      }
      break;
    case 'ammo_pistol':
      p.ammo.pistol += 48;
      break;
    case 'buy_smg':
      p.ammo.smg += 90;
      if (!p.owned.includes('smg')) p.owned.push('smg');
      p.weapon = 'smg';
      p.mag = 30;
      break;
    case 'buy_shotgun':
      p.ammo.shotgun += 18;
      if (!p.owned.includes('shotgun')) p.owned.push('shotgun');
      p.weapon = 'shotgun';
      p.mag = 6;
      break;
    case 'vest':
      p.armor = clamp(p.armor + 50, 0, 100);
      break;
    case 'outfit_street':
    case 'outfit_neon':
    case 'outfit_suit':
      p.outfit = item.id.replace('outfit_', '');
      break;
    default:
      p.cash += item.price;
      return false;
  }
  g.audio.cash();
  g.toast(`Bought: ${item.label}`);
  return true;
}

export function applySave(g, save) {
  const p = g.player;
  p.cash = save.cash;
  p.hp = save.hp;
  p.armor = save.armor;
  p.weapon = save.weapon;
  p.ammo = { ...p.ammo, ...save.ammo };
  p.outfit = save.outfit || 'street';
  p.x = save.x;
  p.y = save.y;
  g.clock = save.clock;
  g.missionsDone = save.missionsDone.slice();
  g.stats = { ...g.stats, ...save.stats };
  g.missionIndex = save.missionIndex;
  g.stageIndex = 0;
  g.missionData = {};
  if (save.inCar && save.carType) {
    const car = makeCar(g, save.carType, p.x + 60, p.y, 0, 'player');
    g.cars.push(car);
    p.carId = car.id;
  }
  g.camera.x = p.x;
  g.camera.y = p.y;
  g.hasSave = true;
}

export function loadSaveIfAny(g) {
  const save = readSave();
  if (!save) return false;
  applySave(g, save);
  return true;
}
