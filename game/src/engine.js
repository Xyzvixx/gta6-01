// Vice Bay v2 — the single game state object and the fixed-timestep tick.
// Everything in the game reads or writes this one state. Wasted, busted
// and chapter-complete are terminal outcomes, and each one passes through
// exactly one function, in one fixed order, so no tick can fire two of
// them at once.

import * as Tune from './tune.js';
import * as Dice from './dice.js';
import { AVENUES, CAR_TYPES, DISTRICTS, FINALE_REWARD, SHOP_DEFS, STREETS } from './content.js';
import { buildTown } from './town.js';
import { boardCar, heroCar, leaveCar, makeHero, nearestBoardable, stepOnFoot } from './hero.js';
import { makeCar, maintainTraffic, spawnParked, stepVehicles } from './traffic.js';
import { clearRoadblock, releaseCopCars, stepCops, wantedLevel } from './cops.js';
import { reloadWeapon, setMag, stepFight } from './fight.js';
import { maintainPeds, scarePeds, stepPeds } from './crowd.js';
import { activeWaypoint, availableJobs, buyUpgrade, currentStage, failChapter, finaleRank, respectRank, startChapter, startJob, updateChapters } from './story.js';
import { createSound } from './sound.js';
import { hasSave, readSave, writeSave } from './store.js';
import { shopPrice } from './overlay.js';

// One-shot input flags (contract section 11). They live here rather than
// in the input module so the tick never depends on how keys are wired.
const EDGE_ENTER = 1;
const EDGE_RELOAD = 2;

const STEP = Tune.STEP || 1 / 60;
const CLOCK_START = (Tune.CLOCK && Tune.CLOCK.startHour) || 9.5;
const CLOCK_SPH = (Tune.CLOCK && Tune.CLOCK.secondsPerHour) || 100;

// The seeded-RNG helpers come from dice.js and nowhere else. There are
// no local copies or fallback bodies in this file: duplicated helpers
// made the "single source" claim false, so dice.js owns them outright.
const makeRng = Dice.makeRng;
const clamp = Dice.clamp;
const range = Dice.range;

// Hard ceiling for any car's max HP, shared by the shop armour and the
// garage armour. Both upgrade paths clamp to it, so neither can push a
// car past it and neither can silently undo the other's work.
const CAR_MAX_HP_CEILING = 220;
// What one garage armour tier adds on top of the car's current max HP
// (rather than replacing it outright — see buyGarageItem).
const GARAGE_ARMOR_HP_PER_TIER = 25;

export function createGame(seed) {
  const rng = makeRng(seed);
  const city = buildTown(rng);
  const audio = createSound();
  const g = {
    seed,
    rng,
    city,
    avenues: AVENUES,
    streets: STREETS,
    audio,
    time: 0,
    clock: CLOCK_START,
    weather: { rain: 0, target: 0, timer: 70 },
    settings: { music: true, traffic: 'high', freezeTime: false },
    player: makeHero(city.spawn.x, city.spawn.y),
    cars: [],
    peds: [],
    cops: [],
    enemies: [],
    bullets: [],
    particles: [],
    pickups: [],
    rainDrops: [],
    heli: null,
    wanted: { heat: 0, level: 0, calmT: 0 },
    chapter: 0,
    stage: 0,
    chapterData: {},
    chapterTitle: '',
    chaptersDone: [],
    respect: { points: 0, rank: 0 },
    standing: {},
    crew: { driver: false, lookout: false, driverCd: 0, lookoutCd: 0, active: null, pingT: 0, driverUsedEp: false },
    garage: {},
    wheel: { open: false, slot: 0 },
    job: null,
    stats: { stolen: 0, kills: 0, chapters: 0, jobs: 0, topWanted: 0, playtime: 0, deaths: 0 },
    camera: { x: city.spawn.x, y: city.spawn.y, shake: 0 },
    messages: [],
    screen: 'title',
    shopId: null,
    garageId: null,
    jobPicker: null,
    roadblock: null,
    aimAngle: null,
    waypoint: null,
    hasSave: false,
    saveSoon: false,
    saveT: 0,
    saveWarned: false,
    maintainT: 0,
    dead: false,
    results: null,
  };
  // Every district starts with zero standing.
  for (const d of DISTRICTS) g.standing[d.id] = 0;

  // Facade helpers the subsystems call on the state object.
  g.toast = (text) => {
    g.messages.push({ text, t: g.time });
    if (g.messages.length > 4) g.messages.shift();
  };
  g.addHeat = (n, cause) => {
    g.wanted.heat = clamp(g.wanted.heat + n, 0, 100);
    g.wanted.level = wantedLevel(g.wanted.heat);
    g.wanted.calmT = 6;
    if (cause === 'steal' || cause === 'kill') g.camera.shake = Math.max(g.camera.shake, 4);
  };
  g.burst = (x, y, n, color, speed) => {
    for (let i = 0; i < n; i += 1) {
      const a = range(g.rng, 0, Math.PI * 2);
      const s = range(g.rng, speed * 0.3, speed);
      g.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: range(g.rng, 0.3, 0.8),
        max: 0.8,
        size: range(g.rng, 2, 5),
        color,
        kind: 'spark',
      });
    }
  };
  g.scarePeds = (x, y, radius) => scarePeds(g, x, y, radius);
  g.dropPickup = (x, y) => {
    const roll = g.rng();
    const kind = roll < 0.4 ? 'health' : roll < 0.65 ? 'ammo' : roll < 0.85 ? 'cash' : 'armor';
    g.pickups.push({ kind, x: x + range(g.rng, -20, 20), y: y + range(g.rng, -20, 20) });
  };
  g.onWasted = () => {
    if (g.screen !== 'play') return;
    g.dead = true;
    g.stats.deaths = (g.stats.deaths || 0) + 1;
    g.screen = 'dead';
    g.player.cash = Math.max(0, g.player.cash - 150);
    g.wanted.heat = 0;
    g.wanted.level = 0;
    // Hand the cops' cars back to traffic and drop the roadblock before
    // clearing the cop records: the old code emptied g.cops first and
    // left up to three police-role cars frozen in place, which traffic
    // then queued behind forever because maintainTraffic kept them.
    // The level-0 path inside stepCops does the same release; this is
    // the wasted/busted path, which never reaches it.
    releaseCopCars(g);
    clearRoadblock(g);
    g.cops = [];
    g.enemies = [];
    g.heli = null;
    g.crew.active = null;
    failChapter(g, 'wasted');
    g.audio.fail();
  };
  g.onBusted = () => {
    if (g.screen !== 'play') return;
    // An arrest is not a death: it must not count towards the finale
    // rank. Only onWasted increments the death counter.
    g.screen = 'busted';
    g.player.cash = Math.max(0, g.player.cash - 100);
    g.wanted.heat = 0;
    g.wanted.level = 0;
    // Same orphan cleanup as onWasted: cop cars and the roadblock must
    // not be left behind by the arrest.
    releaseCopCars(g);
    clearRoadblock(g);
    g.cops = [];
    g.heli = null;
    g.crew.active = null;
    failChapter(g, 'busted');
    g.audio.fail();
  };

  // Populate the world: parked cars, a cab by the hospital corner, a
  // Comet GT downtown, then traffic and pedestrians around the player.
  spawnParked(g, 26);
  const taxi = makeCar(g, 'cabrio', 1100, 1020, Math.PI / 2, 'parked');
  g.cars.push(taxi);
  const sport = makeCar(g, 'comet', 1500, 1120, 0, 'parked');
  g.cars.push(sport);
  maintainTraffic(g);
  maintainPeds(g);
  g.pickups.push({ kind: 'health', x: city.spawn.x + 120, y: city.spawn.y - 60 });
  g.pickups.push({ kind: 'cash', x: city.spawn.x - 140, y: city.spawn.y + 80 });

  g.hasSave = hasSave();
  startChapter(g, 0);
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
  p.arrestT = 0;
  g.dead = false;
  g.camera.x = p.x;
  g.camera.y = p.y;
  g.camera.shake = 0;
  g.screen = 'play';
  g.toast(atHospital ? 'Patched up at the hospital. -$150.' : 'Rosa let you walk. This time. -$100.');
}

// The car the player drives, if any — and the only car the garage or the
// shop will ever service. Only the player's OWN cars qualify: an earlier
// version fell back to the nearest car inside 200px no matter who owned
// it, so buying repair, armour or paint on foot next to a stranger's car
// tuned THAT car instead. Repairing the player's own wreck is still fine.
function serviceCar(g) {
  const p = g.player;
  let car = heroCar(g);
  if (car) return car;
  let best = Infinity;
  for (const c of g.cars) {
    if (c.dead || c.ownedBy !== 'player') continue;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < best) {
      best = d;
      car = c;
    }
  }
  return best <= 200 ? car : null;
}

function dexShop(g) {
  return (g.city.shops || []).find((s) => s.id === 'dex') || null;
}

function ownedCarNearDex(g) {
  const shop = dexShop(g);
  if (!shop) return null;
  const p = g.player;
  if (Math.hypot(shop.x - p.x, shop.y - p.y) > 110) return null;
  const driven = heroCar(g);
  if (driven && driven.ownedBy === 'player') return driven;
  // Nearest owned car wins; on a tie the most recently acquired car
  // wins, because that is the one the player just drove to Dex. Two
  // owned cars can share a parking spot, and first-in-list order would
  // service the stale one instead.
  let best = null;
  let bestD = Infinity;
  for (const c of g.cars) {
    if (c.ownedBy !== 'player' || c.dead) continue;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d >= 150) continue;
    if (d < bestD - 1 || (Math.abs(d - bestD) <= 1 && (!best || c.id > best.id))) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

// The car the garage screen is open for, resolved the same way the
// upgrade purchase resolves it: the garage id first, then the car being
// driven, then the nearest owned car. Used by the garage-armour guard in
// buyGarageItem so its pre-purchase checks look at the exact car that
// will be charged.
function garageTargetCar(g) {
  if (g.garageId !== null && g.garageId !== undefined) {
    return (g.cars || []).find((c) => String(c.id) === String(g.garageId)) || null;
  }
  const driven = heroCar(g);
  if (driven) return driven;
  let best = null;
  let bestD = Infinity;
  for (const c of g.cars) {
    if (c.ownedBy !== 'player' || c.dead) continue;
    const d = Math.hypot(c.x - g.player.x, c.y - g.player.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= 200 ? best : null;
}

// Garage ownership rules (design section 8), enforced every tick:
//   DESTROYED — a car that blows up loses its upgrades with it. The
//     explosion already drops the record in traffic.js; this sweep
//     catches any record whose car has since left g.cars, so a stale
//     garage entry can never be re-applied to a different car id.
//   ABANDONED — walking away from a car costs nothing: the record stays
//     with the car while it still exists in the world, and driving it
//     again picks the upgrades back up.
//   REPLACED — boarding a different car never moves upgrades across.
//     Each car keeps its own record, keyed by car id; the garage simply
//     starts serving the new car instead.
//   TRADE-OFF — engine, armour and nitro cannot all be maxed cheaply:
//     every tier costs cash up front, and repair costs 80 + 40 per
//     fitted tier, so a fully maxed car is expensive to keep alive.
function pruneGarageRecords(g) {
  if (!g.garage) return;
  for (const id of Object.keys(g.garage)) {
    const alive = (g.cars || []).some((c) => String(c.id) === id && !c.dead);
    if (!alive) delete g.garage[id];
  }
  if (g.garageId !== null && g.garageId !== undefined && !g.garage[g.garageId]) {
    // The garage screen was open for a car that no longer exists; clear
    // the stale id so a later purchase cannot land on the wrong car.
    const stillThere = (g.cars || []).some((c) => String(c.id) === String(g.garageId) && !c.dead);
    if (!stillThere) g.garageId = null;
  }
}

// One fixed step. `input` is the keys object (axis(), mouse());
// `edgeFlags` carry one-shot presses and are only passed on the first
// substep of a frame, so a press is never counted twice.
export function stepGame(g, input, dt, edgeFlags = 0) {
  g.time += dt;
  g.stats.playtime += dt;
  if (!g.settings.freezeTime) {
    g.clock += dt / CLOCK_SPH;
    if (g.clock >= 24) g.clock -= 24;
  }

  // Weather: a dry spell, then rain that fades in and out.
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

  // Rain streaks inside the current view.
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
  const shooting = mouse.down && !(g.wheel && g.wheel.open) && g.screen === 'play';
  const p = g.player;
  const wasInCar = p.carId !== null;

  // E, in priority order: a mission hand-in at this spot beats
  // everything; then leaving the car (when driving) — the garage must
  // never swallow the leave action; then the garage (Dex plus an owned
  // car nearby, opening FOR that car's id), then the shop, then boarding.
  if (g.screen === 'play' && (edges & EDGE_ENTER)) {
    const stage = currentStage(g);
    const atHandIn = stage && stage.pressE && stage.target
      && Math.hypot(stage.target.x - p.x, stage.target.y - p.y) < (stage.radius || 70);
    if (atHandIn) {
      // updateChapters reads the same press below; nothing else happens.
    } else if (p.carId !== null) {
      leaveCar(g);
    } else {
      const dexCar = ownedCarNearDex(g);
      if (dexCar) {
        g.garageId = dexCar.id;
        g.screen = 'garage';
        g.audio.blip();
      } else {
        const shop = (g.city.shops || []).find((s) => Math.hypot(s.x - p.x, s.y - p.y) < 78);
        if (shop) {
          g.shopId = shop.id;
          g.screen = 'shop';
          g.audio.blip();
        } else {
          const car = nearestBoardable(g, 66);
          if (car) boardCar(g, car);
        }
      }
    }
  }
  if (g.screen === 'play' && (edges & EDGE_RELOAD)) reloadWeapon(g);

  // Movement.
  if (g.screen === 'play') {
    if (p.carId !== null) {
      if (g.aimAngle === null || g.aimAngle === undefined) g.aimAngle = p.angle;
    } else {
      stepOnFoot(g, dt, axis, g.aimAngle);
    }
  }
  stepVehicles(g, dt, axis);
  // While driving, Rico's position IS the car's.
  const driven = g.cars.find((c) => c.id === p.carId);
  if (driven) {
    p.x = driven.x;
    p.y = driven.y;
    p.angle = driven.angle;
  }
  // A car Rico just climbed into becomes his, so the garage can tune
  // it. Its upgrades stay its own: boarding a new car never strips the
  // old car's record (replaced-car rule), it just stops being the car
  // the garage serves until Rico drives it again.
  if (!wasInCar && driven && driven.ownedBy !== 'player') {
    driven.ownedBy = 'player';
    if (!g.garage[driven.id]) g.garage[driven.id] = { engine: 0, armor: 0, nitro: 0 };
  }
  // Driver crew ability: +15% top speed while active. The nudge is
  // capped at 1.15x the car's tuned top speed so it can never run away.
  if (g.crew.active && g.crew.active.kind === 'driver' && driven && axis.up) {
    const up = driven.upgrades || { engine: 0, armor: 0, nitro: 0 };
    const top = 470 * (1 + 0.08 * (up.engine || 0));
    const dir = driven.speed >= 0 ? 1 : -1;
    const cap = top * 1.15;
    if (Math.abs(driven.speed) < cap) {
      driven.speed = clamp(driven.speed + dir * 420 * dt, -cap, cap);
    }
  }
  stepFight(g, dt, shooting, g.aimAngle === null || g.aimAngle === undefined ? p.angle : g.aimAngle);
  stepPeds(g, dt);
  stepCops(g, dt);
  if (g.screen === 'play') updateChapters(g, dt, Boolean(edges & EDGE_ENTER));

  // Taxi jobs start themselves when Rico climbs into a cab — but only
  // once the taxi job is actually unlocked here (standing of 25 or
  // more). A new player boarding the spawn cab used to get a refusal
  // toast every time, because standing starts at zero. Boarding is
  // just driving until the job unlocks.
  const carNow = g.cars.find((c) => c.id === p.carId);
  if (g.screen === 'play' && !wasInCar && carNow && carNow.type === 'cabrio' && !g.job && availableJobs(g).includes('taxi')) {
    startJob(g, 'taxi');
  }

  // Crew cooldowns and active-ability timers.
  if (g.crew.driverCd > 0) g.crew.driverCd = Math.max(0, g.crew.driverCd - dt);
  if (g.crew.lookoutCd > 0) g.crew.lookoutCd = Math.max(0, g.crew.lookoutCd - dt);
  if (g.crew.pingT > 0) g.crew.pingT = Math.max(0, g.crew.pingT - dt);
  if (g.crew.active) {
    g.crew.active.t -= dt;
    if (g.crew.active.t <= 0) g.crew.active = null;
  }
  if (g.wanted.level === 0) g.crew.driverUsedEp = false;

  // Particles.
  for (const pt of g.particles) {
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vy += (pt.kind === 'puff' ? -30 : 60) * dt;
    pt.life -= dt;
  }
  g.particles = g.particles.filter((pt) => pt.life > 0);

  // Waypoint, camera follow and shake decay.
  if (g.screen === 'play') g.waypoint = activeWaypoint(g);
  const focus = carNow || p;
  const tx = clamp(focus.x, 640, 3200 - 640);
  const ty = clamp(focus.y, 360, 2400 - 360);
  g.camera.x += (tx - g.camera.x) * Math.min(1, dt * 5);
  g.camera.y += (ty - g.camera.y) * Math.min(1, dt * 5);
  g.camera.shake = Math.max(0, g.camera.shake - dt * 14);

  // Finale results: once chapter 8 is DONE, the rank panel appears.
  // Keyed off chaptersDone, never off the chapter index alone: a save
  // with chapter index 8 but no c8 in chaptersDone must not display an
  // S-rank plus $3,000 and +800 respect it never earned. The rank is
  // recomputed live from deaths every time (a c8 replay with more
  // deaths shows the rank it actually earned), and the amounts are the
  // single FINALE_REWARD constant — the payout itself happened in
  // completeChapter on first completion; this block only displays it.
  if (g.chaptersDone.includes('c8') && !g.results) {
    const score = 1000 * g.chaptersDone.length + g.stats.kills * 25 + g.stats.jobs * 100 + g.stats.topWanted * 200;
    const rank = finaleRank(g);
    g.results = { rank, score, reward: FINALE_REWARD.cash, respect: FINALE_REWARD.respect };
    g.toast(`The Last Job complete — ${rank}-rank!`);
  }

  // Ambient upkeep, twice a second — including the garage sweep, so a
  // destroyed car's upgrades are gone the moment the wreck leaves the
  // world instead of lingering as a stale record.
  g.maintainT -= dt;
  if (g.maintainT <= 0) {
    g.maintainT = 0.5;
    maintainTraffic(g);
    maintainPeds(g);
    pruneGarageRecords(g);
  }

  // Audio beds.
  const driving = carNow ? Math.abs(carNow.speed) / 470 : 0;
  g.audio.setEngine(driving, Boolean(carNow));
  g.audio.setSiren(g.wanted.level >= 2, g.time);
  g.audio.setRain(w.rain);

  // Autosave — PLAY screen only. Death sets screen to 'dead' and the
  // title screen runs this same tick in attract mode, so an autosave
  // here must never serialise a dead state or a fresh chapter-0 game
  // over the player's real save. The screen check below is the whole
  // guard: on 'dead', 'busted' or 'title' the timer keeps running but
  // no write happens, and the pending save fires once play resumes. A
  // failed write toasts once per session instead of failing silently
  // every 60 seconds.
  g.saveT += dt;
  if (g.screen === 'play' && ((g.saveSoon && g.saveT > 1) || g.saveT > 60)) {
    g.saveSoon = false;
    g.saveT = 0;
    if (writeSave(g)) {
      // A later failure must report again: the flag resets on every
      // successful write instead of silencing failures forever after
      // the first one.
      g.saveWarned = false;
    } else if (!g.saveWarned) {
      g.saveWarned = true;
      g.toast('Autosave failed — storage unavailable');
    }
  }
}

export function buyShopItem(g, index) {
  const shop = SHOP_DEFS.find((d) => d.id === g.shopId);
  if (!shop) return false;
  const item = shop.goods[index];
  if (!item) return false;
  const p = g.player;
  const car = serviceCar(g);
  const carNeeded = item.id === 'repair' || item.id === 'armorcar' || item.id === 'paint';
  if (carNeeded && !car) {
    g.toast('No car to service — hop in one first');
    return false;
  }
  // Repair gets pricier the more the car has been tuned: 80 + 40 per
  // fitted upgrade tier. A maxed car costs real money to keep alive.
  let base = item.price;
  if (item.id === 'repair' && car) {
    const up = car.upgrades || { engine: 0, armor: 0, nitro: 0 };
    base = 80 + 40 * ((up.engine || 0) + (up.armor || 0) + (up.nitro || 0));
  }
  // The rifle is rank-gated: Hustler (rank 1) unlocks it at Bay Arms.
  if (item.id === 'buy_rifle' && respectRank(g) < 1) {
    g.toast('Reach Hustler rank to buy the rifle');
    return false;
  }
  // A vest at full armour buys nothing: charging $96 for +0 armour is
  // a dead purchase, and the garage repair already refuses at full HP.
  // Refuse BEFORE the cash is taken.
  if (item.id === 'vest' && p.armor >= 100) {
    g.toast('Armor already full — save your cash');
    return false;
  }
  // Shop armour is capped at the 220 ceiling: unbounded +40 buys made
  // a rich player near-invulnerable. Refuse BEFORE the cash is taken,
  // exactly like the vest refusal above.
  if (item.id === 'armorcar' && car && car.maxHp >= CAR_MAX_HP_CEILING) {
    g.toast('Armor already maxed — save your cash');
    return false;
  }
  // Paint is a one-time fitting: charging $60 for a glow the car
  // already has is a dead purchase, same class as the vest.
  if (item.id === 'paint' && car && car.glow) {
    g.toast('Neon underglow already fitted');
    return false;
  }
  if (!p.ammo) p.ammo = {};
  const price = shopPrice(g, base);
  if (p.cash < price) {
    g.toast('Not enough cash');
    return false;
  }
  p.cash -= price;
  switch (item.id) {
    case 'repair':
      car.hp = car.maxHp;
      car.dead = false;
      car.fuseT = 0;
      g.toast('Car fully repaired');
      break;
    case 'armorcar': {
      // Clamped to the 220 ceiling: a car at 200 gains 20, not 40.
      // This is the shop half of the composed armour system — it adds
      // to whatever the garage already fitted, and the garage half
      // (buyGarageItem) adds back the other way.
      const before = car.maxHp;
      car.maxHp = Math.min(car.maxHp + 40, CAR_MAX_HP_CEILING);
      car.hp = car.maxHp;
      g.toast(`Armored panels fitted (+${car.maxHp - before} max HP)`);
      break;
    }
    case 'paint':
      car.glow = true;
      g.toast('Neon underglow installed');
      break;
    case 'ammo_pistol':
      p.ammo.pistol = (p.ammo.pistol || 0) + 48;
      break;
    case 'ammo_rifle':
      p.ammo.rifle = (p.ammo.rifle || 0) + 40;
      break;
    case 'buy_smg':
      p.ammo.smg = (p.ammo.smg || 0) + 90;
      if (!p.owned.includes('smg')) p.owned.push('smg');
      p.weapon = 'smg';
      setMag(p, 'smg', 30);
      break;
    case 'buy_shotgun':
      p.ammo.shotgun = (p.ammo.shotgun || 0) + 18;
      if (!p.owned.includes('shotgun')) p.owned.push('shotgun');
      p.weapon = 'shotgun';
      setMag(p, 'shotgun', 6);
      break;
    case 'buy_rifle':
      p.ammo.rifle = (p.ammo.rifle || 0) + 80;
      if (!p.owned.includes('rifle')) p.owned.push('rifle');
      p.weapon = 'rifle';
      setMag(p, 'rifle', 20);
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
      p.cash += price;
      return false;
  }
  g.audio.cash();
  g.toast(`Bought: ${item.label} ($${price})`);
  return true;
}

const GARAGE_LINES = ['engine', 'armor', 'nitro'];

export function buyGarageItem(g, index) {
  if (index < 0 || index > 8) return false;
  const line = GARAGE_LINES[Math.floor(index / 3)];
  const tier = (index % 3) + 1;

  // Garage armour must COMPOSE with shop armour instead of overwriting
  // it. The purchase underneath (buyUpgrade in story.js) still sets
  // maxHp from the tier alone — 125 / 150 / 175 — which would shrink a
  // shop-armoured 220-HP car back down after charging for the privilege.
  // So this wrapper owns the armour arithmetic:
  //   - At the 220 ceiling the car already beats every garage tier
  //     value, so refuse BEFORE any cash moves, and say so.
  //   - Otherwise let the purchase run, then re-apply the tier as an
  //     ADD: +25 max HP on top of whatever the car had, capped at 220.
  //     A stock car still lands exactly on 125 / 150 / 175, a
  //     shop-armoured car at 180 lands on 205, and a car at 200 lands
  //     on the 220 ceiling. The current HP rises by the same gain.
  // The refusal only fires for the next tier in sequence; any other
  // tier is left to buyUpgrade so it can toast its own specific reason
  // (already fitted, buy in order, not enough cash).
  let armorGuard = null;
  if (line === 'armor') {
    const target = garageTargetCar(g);
    if (target && !target.dead && target.ownedBy === 'player') {
      const fitted = (target.upgrades || { armor: 0 }).armor || 0;
      if (tier === fitted + 1) {
        if (target.maxHp >= CAR_MAX_HP_CEILING) {
          const tierValue = 100 * (1 + 0.25 * tier);
          g.toast(`Armor already maxed — this car is at ${CAR_MAX_HP_CEILING} HP, above the tier ${tier} value of ${tierValue}`);
          return false;
        }
        armorGuard = { car: target, oldMax: target.maxHp || 100 };
      }
    }
  }

  const ok = buyUpgrade(g, line, tier);
  if (ok && armorGuard) {
    const fixed = Math.min(armorGuard.oldMax + GARAGE_ARMOR_HP_PER_TIER, CAR_MAX_HP_CEILING);
    const gain = fixed - armorGuard.car.maxHp;
    armorGuard.car.maxHp = fixed;
    if (gain > 0) armorGuard.car.hp = clamp(armorGuard.car.hp + gain, 0, fixed);
  }
  if (ok) {
    g.audio.cash();
    g.toast(`Garage: ${line} tier ${tier} fitted`);
  }
  // No generic failure toast: buyUpgrade already toasts the specific
  // reason on every reachable failure, and a second toast would
  // double-notify.
  return ok;
}

// Full repair from the garage screen (key 0). The Dex SHOP also sells
// repair, but E at Dex opens the garage whenever the player's own car
// is parked there — so the shop's repair was unreachable in ordinary
// play (the car had to sit in a 150–200px band between the garage
// trigger at 150px and the serviceCar radius at 200px). Same price rule
// as the shop: 80 + 40 per fitted upgrade tier, then the rank discount.
// The car is the one the garage opened for (g.garageId), so a
// stranger's car is never serviced.
export function repairGarageCar(g) {
  const car = (g.cars || []).find((c) => c.id === g.garageId)
    || ownedCarNearDex(g);
  if (!car) {
    g.toast('Park an owned car by the garage first');
    return false;
  }
  // The garage id is session-only and set from an owned car, but the
  // lookup itself never re-checked ownership: a stale id must not
  // service a stranger's car.
  if (car.ownedBy !== 'player') {
    g.toast('That car is not yours');
    return false;
  }
  const maxHp = car.maxHp || 100;
  if (car.hp >= maxHp && !car.dead) {
    g.toast('Already at full health');
    return false;
  }
  const up = car.upgrades || { engine: 0, armor: 0, nitro: 0 };
  const base = 80 + 40 * ((up.engine || 0) + (up.armor || 0) + (up.nitro || 0));
  const price = shopPrice(g, base);
  if (g.player.cash < price) {
    g.toast('Not enough cash');
    return false;
  }
  g.player.cash -= price;
  car.hp = maxHp;
  car.dead = false;
  car.fuseT = 0;
  g.audio.cash();
  g.toast(`Car fully repaired ($${price})`);
  return true;
}

export function applySave(g, save) {
  // Defensive load: the store's validators are the first gate, but
  // applySave never trusts its argument — a wrong-typed value (string
  // cash, NaN coordinates, unknown car type, oversized chapter) must
  // degrade to a sane default, never to broken arithmetic or a skipped
  // finale. An unknown version (or no save at all) is refused outright,
  // even though readSave already rejects those — defence in depth.
  if (!save || (save.v !== 4 && save.v !== 3)) return;
  // Number validation is the shared Dice.num (finite + default +
  // clamp) — the local copy was identical to store.js's, and one helper
  // is enough. Behaviour unchanged.
  const p = g.player;
  p.cash = Dice.num(save.cash, 250, 0, 999999);
  p.hp = Dice.num(save.hp, 100, 0, 100);
  p.armor = Dice.num(save.armor, 0, 0, 100);
  const WEAPONS = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];
  p.weapon = WEAPONS.includes(save.weapon) ? save.weapon : 'pistol';
  const liveAmmo = { ...(p.ammo || {}) };
  p.ammo = { pistol: 0, smg: 0, shotgun: 0, rifle: 0 };
  for (const w of WEAPONS) {
    if (w === 'fists') continue;
    const have = save.ammo && typeof save.ammo[w] === 'number' ? save.ammo[w] : liveAmmo[w];
    p.ammo[w] = Dice.num(have, w === 'pistol' ? 96 : 0, 0, 999);
  }
  // Per-weapon magazines: a save without mags (v3, or a hand-built
  // test save) falls back to a full pistol mag and empty rest; a legacy
  // single `mag` maps onto the pistol.
  const liveMags = { ...(p.mags || {}) };
  p.mags = { pistol: 12, smg: 0, shotgun: 0, rifle: 0 };
  for (const w of WEAPONS) {
    if (w === 'fists') continue;
    const have = save.mags && typeof save.mags[w] === 'number'
      ? save.mags[w]
      : (typeof liveMags[w] === 'number' ? liveMags[w]
        : (w === 'pistol' && typeof save.mag === 'number' ? save.mag : undefined));
    p.mags[w] = Dice.num(have, w === 'pistol' ? 12 : 0, 0, 999);
  }
  if (!p.owned.includes(p.weapon)) p.owned.push(p.weapon);
  p.outfit = ['street', 'neon', 'suit'].includes(save.outfit) ? save.outfit : 'street';
  p.x = Dice.num(save.x, 1500, 0, 3200);
  p.y = Dice.num(save.y, 1120, 0, 2400);
  g.clock = save.clock !== undefined ? Dice.num(save.clock, g.clock, 0, 24) : g.clock;
  const cleanStats = {};
  for (const k of ['stolen', 'kills', 'chapters', 'jobs', 'topWanted', 'deaths']) {
    cleanStats[k] = Dice.num(save.stats && save.stats[k], 0, 0, 999999);
  }
  cleanStats.playtime = Dice.num(save.stats && save.stats.playtime, 0, 0, 99999999);
  g.stats = { ...g.stats, ...cleanStats };
  const isV3 = save.v === 3;
  // v3 saves carry mission ids (m1..m3); v4 carries chapter ids
  // (c1..c8). Only real chapter ids survive; anything else is dropped,
  // so an oversized index can never satisfy the finale without playing it.
  const done = (save.chaptersDone || save.missionsDone || []).slice();
  g.chaptersDone = done
    .map((id) => (isV3 && /^m[1-9]$/.test(id) ? `c${id.slice(1)}` : id))
    .filter((id) => /^c[1-8]$/.test(id))
    .filter((id, i, arr) => arr.indexOf(id) === i);
  // Respect, standing, crew and garage are new in v4; a v3 save
  // migrates to clean defaults and never bricks.
  if (save.respect && typeof save.respect.points === 'number') {
    g.respect.points = Dice.num(save.respect.points, 0, 0, 99999);
  } else {
    g.respect.points = 0;
  }
  g.respect.rank = respectRank(g);
  g.standing = {};
  for (const d of DISTRICTS) g.standing[d.id] = 0;
  if (save.standing && typeof save.standing === 'object') {
    for (const k of Object.keys(save.standing)) {
      if (Object.prototype.hasOwnProperty.call(g.standing, k)) {
        g.standing[k] = Dice.num(save.standing[k], 0, 0, 100);
      }
    }
  }
  g.crew = {
    driver: Boolean(save.crew && save.crew.driver),
    lookout: Boolean(save.crew && save.crew.lookout),
    driverCd: 0,
    lookoutCd: 0,
    active: null,
    pingT: 0,
    driverUsedEp: false,
  };
  // Garage: only known car ids, only tier values 0..3 per line. Car ids
  // are numeric, so a key like "__proto__" is dropped outright instead
  // of being stored.
  g.garage = {};
  if (save.garage && typeof save.garage === 'object') {
    for (const k of Object.keys(save.garage)) {
      if (!/^\d+$/.test(k)) continue;
      const v = save.garage[k];
      if (!v || typeof v !== 'object') continue;
      g.garage[k] = {
        engine: Dice.num(v.engine, 0, 0, 3),
        armor: Dice.num(v.armor, 0, 0, 3),
        nitro: Dice.num(v.nitro, 0, 0, 3),
      };
    }
  }
  g.chapter = Math.floor(Dice.num(save.chapterIndex !== undefined ? save.chapterIndex : (save.missionIndex !== undefined ? save.missionIndex : 0), 0, -1, 8));
  // A chapter index of -1 is never a legitimate saved state (createGame
  // starts at 0; failChapter only passes through -1 synchronously): a
  // hand-edited -1 used to strand the player in chapterless free roam
  // with no objective. Map it to the next uncompleted chapter instead.
  if (g.chapter < 0) g.chapter = Math.min(g.chaptersDone.length, 8);
  // A terminal index without the finale is the same stranded state:
  // chapter index 8 with no c8 in chaptersDone used to free-roam with
  // no objective. Resume the next uncompleted chapter.
  if (g.chapter >= 8 && !g.chaptersDone.includes('c8')) {
    g.chapter = Math.min(g.chaptersDone.length, 8);
  }
  g.stage = 0;
  g.chapterData = {};
  g.results = null;
  g.finaleRank = null;
  g.wanted.heat = 0;
  g.wanted.level = 0;
  g.cops = [];
  g.enemies = [];
  g.heli = null;
  g.job = null;
  if (save.inCar && save.carType && CAR_TYPES.includes(save.carType)) {
    const car = makeCar(g, save.carType, p.x + 60, p.y, 0, 'player');
    car.ownedBy = 'player';
    const ups = save.carUpgrades || g.garage[car.id] || { engine: 0, armor: 0, nitro: 0 };
    car.upgrades = {
      engine: Dice.num(ups.engine, 0, 0, 3),
      armor: Dice.num(ups.armor, 0, 0, 3),
      nitro: Dice.num(ups.nitro, 0, 0, 3),
    };
    // Garage armour tiers rebuild max HP from the tier value. Note the
    // save carries no separate shop-armour figure, so a car that was
    // shop-armoured past its garage tier restores at the tier value
    // here; the in-session compose rule in buyGarageItem / buyShopItem
    // is what keeps the two systems from fighting while playing.
    car.maxHp = Math.min(100 * (1 + 0.25 * (car.upgrades.armor || 0)), CAR_MAX_HP_CEILING);
    car.hp = car.maxHp;
    g.cars.push(car);
    p.carId = car.id;
    g.garage[car.id] = { ...car.upgrades };
  }
  g.camera.x = p.x;
  g.camera.y = p.y;
  g.hasSave = true;
  if (g.chapter >= 0 && g.chapter < 8) {
    startChapter(g, g.chapter);
  } else {
    g.chapterTitle = 'Vice Bay — free roam';
  }
}

export function loadSaveIfAny(g) {
  const save = readSave();
  if (!save) return false;
  applySave(g, save);
  return true;
}
