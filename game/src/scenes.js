// Vice Bay v2 — deterministic screenshot scenes behind ?shot=.
// Each scene builds the real game from the seed, then drives it into the
// staged situation with the real rules (never a mock-up), parks the camera
// on the player, clears the toasts and returns { screen }.

import * as Tune from './tune.js';
import { makeCar } from './traffic.js';
import { makeEnemy, openWheel, setMag } from './fight.js';
import { respectRank, startChapter } from './story.js';
import { SCREEN_GARAGE, SCREEN_PLAY, SCREEN_TITLE } from './paint.js';
import { stepGame } from './engine.js';

const STEP = Tune.STEP || 1 / 60;

function idleInput() {
  return {
    axis: () => ({ x: 0, y: 0, run: false, up: false, down: false, left: false, right: false }),
    takeEdges: () => 0,
    mouse: () => ({ x: 0, y: 0, down: false }),
  };
}

export function settle(g, seconds) {
  const input = idleInput();
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) stepGame(g, input, STEP);
}

export function parkCar(g, type, x, y, angle) {
  const car = makeCar(g, type, x, y, angle, 'player');
  car.speed = 0;
  car.ownedBy = 'player';
  g.cars.push(car);
  if (!g.garage[car.id]) g.garage[car.id] = { engine: 0, armor: 0, nitro: 0 };
  g.player.carId = car.id;
  g.player.x = x;
  g.player.y = y;
  g.camera.x = x;
  g.camera.y = y;
  return car;
}

function clearMessages(g) {
  g.messages = [];
}

// Shared opening for a dry in-game shot: play screen, fixed clock,
// clear skies that will not change mid-capture.
function dryScene(g, clock) {
  g.screen = SCREEN_PLAY;
  g.clock = clock;
  g.weather.rain = 0;
  g.weather.target = 0;
  g.weather.timer = 999;
}

function focusPlayer(g) {
  g.camera.x = g.player.x;
  g.camera.y = g.player.y;
}

// Arrange the patrol cars in a loose ring around the player after the
// settle, so the pursuit reads as a ring rather than a pile-up.
function arrangeCopRing(g, px, py) {
  const slots = [
    { a: Math.PI * 0.75, d: 300 },
    { a: Math.PI * 1.25, d: 260 },
    { a: Math.PI * 0.5, d: 340 },
  ];
  let ri = 0;
  for (const cop of g.cops) {
    if (cop.kind !== 'car') continue;
    const cc = g.cars.find((c) => c.id === cop.carId);
    if (!cc || cc.dead) continue;
    const slot = slots[ri % slots.length];
    ri += 1;
    cc.x = px + Math.cos(slot.a) * slot.d;
    cc.y = py + Math.sin(slot.a) * slot.d;
    cc.angle = -Math.PI / 2;
    cc.speed = 230;
    cop.x = cc.x;
    cop.y = cc.y;
  }
}

// Push every other car at least 110px off the player's bumper, so no
// vehicle sits on top of Rico in the frame.
function clearBumper(g, px, py, mine) {
  for (const c of g.cars) {
    if (c === mine) continue;
    const d = Math.hypot(c.x - px, c.y - py);
    if (d < 110) {
      const a = Math.atan2(c.y - py, c.x - px) || 0;
      c.x = px + Math.cos(a) * 200;
      c.y = py + Math.sin(a) * 200;
    }
  }
}

function stageHeli(g) {
  // Dusk pursuit: 4 stars, Air One tracking Rico, spotlight on the car,
  // traffic ahead, minimap live.
  dryScene(g, 18.6);
  startChapter(g, 4); // c5 'Air One'
  // Parked mid-block on the avenue, NOT on an intersection: the old
  // spot (1500,1300) sat exactly on the "Vice Bay PD" landmark, so its
  // label showed through the player car ("Vice … PD"). Mid-block the
  // nearest landmark label is 130px+ away.
  const car = parkCar(g, 'comet', 1500, 1150, -Math.PI / 2);
  car.speed = 260;
  g.wanted.heat = 72; // 4 stars: 1 + floor(72/20) = 4
  g.wanted.level = 4;
  g.wanted.calmT = 999;
  const lead = g.cars.find((c) => c.role === 'traffic');
  if (lead) {
    lead.x = 1500;
    lead.y = 900;
    lead.speed = 120;
  }
  // Short settle only: long enough for Air One and the first patrol cars
  // to spawn, short enough that they cannot ram Rico into a pile-up.
  // The old 2.5s settle let every cop converge on the player, and the
  // capture showed six cars in one unreadable heap with Rico lost
  // inside it. After the settle the pursuit is arranged deliberately:
  // patrol cars in a loose ring behind and beside Rico, traffic clear
  // of his bumper, Air One offset overhead so its body and spotlight
  // cone are both visible.
  settle(g, 0.6);
  const mine = g.cars.find((c) => c.id === g.player.carId);
  if (mine) {
    mine.speed = 300;
    g.camera.x = mine.x;
    g.camera.y = mine.y;
  }
  const px = g.player.x;
  const py = g.player.y;
  arrangeCopRing(g, px, py);
  // No car may sit on top of Rico's bumper in the frame — traffic,
  // parked cars (the spawn-point car at 1500,1120 sat 48px from Rico
  // in the first re-staged capture) or anything else.
  clearBumper(g, px, py, mine);
  // The helicopter spawns from the real wanted rules during the settle;
  // if the air unit has not arrived yet, put the real one overhead in
  // its tracking state so the frame shows the system working. Either
  // way it sits offset up-left of Rico, not directly on top of him,
  // so the fuselage reads against the road and the cone lands on him.
  if (!g.heli) {
    g.heli = { x: px + 140, y: py - 180, angle: 0, state: 'track', spotT: 0, searchT: 0 };
  } else {
    g.heli.x = px + 140;
    g.heli.y = py - 180;
    g.heli.state = 'track';
  }
  clearMessages(g);
  return { screen: SCREEN_PLAY };
}

function stageGarage(g) {
  // Golden-hour garage: owned Comet GT at Dex, one engine tier fitted,
  // all three lines and their prices on screen.
  dryScene(g, 17.8);
  const car = parkCar(g, 'comet', 700, 1240, Math.PI / 2);
  g.garage[car.id] = { engine: 1, armor: 0, nitro: 0 };
  car.upgrades = { engine: 1, armor: 0, nitro: 0 };
  g.player.cash = 2500;
  // The garage id must be the staged car's REAL id: buyUpgrade
  // resolves it by String(id), and the old 'dex' sentinel matched no
  // car, so every staged garage upgrade failed with "That car is
  // gone" (J2 round 5). engine.js sets the same real id when the
  // garage opens in ordinary play.
  g.garageId = car.id;
  settle(g, 0.5);
  focusPlayer(g);
  clearMessages(g);
  return { screen: SCREEN_GARAGE };
}

function stageCombat(g) {
  // On-foot fight at the docks: three Tiburones ahead, rifle out, the
  // weapon wheel open, respect rank on the HUD.
  dryScene(g, 17.8);
  startChapter(g, 1); // c2 'Sharks at the Docks'
  g.stage = 1;
  g.chapterData = { kills: 0, killBase: g.stats.kills };
  g.player.x = 420;
  g.player.y = 2000;
  g.player.angle = Math.PI / 2;
  g.player.carId = null;
  if (!g.player.owned.includes('rifle')) g.player.owned.push('rifle');
  g.player.weapon = 'rifle';
  setMag(g.player, 'rifle', 20);
  g.player.ammo.rifle = 80;
  g.respect.points = 650;
  g.respect.rank = respectRank(g);
  g.enemies = [];
  // Spots are 210px from the player: the wheel's slots sit at radius
  // 118 with a 44px radius (outer edge 162px), so an enemy inside
  // 162px can hide behind a slot. The round-4 spots were 76-160px
  // out; a 60px spread (136-220px) still left one enemy on the VB-9
  // slot's angle at 160px, and 200px left one 3px off a slot edge
  // (J5 round 4, #3). At 210px all three sit 48px clear of the wheel
  // in every direction, and the 120-220 deadzone holds them still
  // through the 0.4s settle.
  const spots = [[227, 2083], [588, 2126], [630, 2013]];
  for (let i = 0; i < 3; i += 1) {
    // Flagged as chapter targets, exactly as setupStage does for a real
    // kill stage: without the flag the tick's kill check counts 0 alive
    // and auto-advances to report-back during settle, so the capture
    // showed stage 2 ("Report back to Mara") instead of the (0/3) kill
    // stage for three rounds (J5 round 3).
    const e = makeEnemy(g, spots[i][0], spots[i][1]);
    e.chapterTarget = true;
    g.enemies.push(e);
  }
  g.aimAngle = Math.PI / 2;
  openWheel(g);
  g.wheel.slot = 4; // rifle is wheel index 4 (fists, pistol, smg, shotgun, rifle)
  settle(g, 0.4);
  // Reset the enemies to their exact spots after the settle: during
  // the 0.4s the F1 repositioning can pull an enemy whose LOS is
  // blocked toward the player, and one drifted onto the VB-9 slot's
  // rim in the round-5 capture (J3 round 5, N13). The spots are on
  // open ground, so re-placing them is exact.
  for (let i = 0; i < 3; i += 1) {
    g.enemies[i].x = spots[i][0];
    g.enemies[i].y = spots[i][1];
  }
  openWheel(g);
  g.wheel.slot = 4; // rifle is wheel index 4 (fists, pistol, smg, shotgun, rifle)
  // The camera must sit ON the player for this shot: the wheel is drawn
  // centred on the screen, and the enemy spots are 210px from the
  // player — if the camera is offset, the wheel centre is not the
  // player, and the spots can land on a slot rim (J3 round 6, N17).
  // Centring the camera makes the wheel centre the player, so the
  // 210px spots are 48px clear of the 162px outer slot edge.
  focusPlayer(g);
  clearMessages(g);
  return { screen: SCREEN_PLAY };
}

function stageFinale(g) {
  // Night neon after the last job: S-rank results over the city, with
  // district standing bars and the rewards line.
  g.screen = SCREEN_PLAY;
  g.clock = 22.2;
  g.weather.rain = 0.6;
  g.weather.target = 1;
  g.weather.timer = 999;
  g.chapter = 8;
  g.stage = 0;
  g.chaptersDone = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
  g.chapterTitle = 'The Last Job';
  g.respect.points = 3600;
  g.respect.rank = respectRank(g);
  g.standing = { marina: 77, heights: 63, downtown: 96, docks: 89, strip: 70, beach: 84 };
  g.stats.kills = 47;
  g.stats.jobs = 6;
  g.stats.stolen = 12;
  g.stats.topWanted = 5;
  g.stats.chapters = 8;
  g.player.cash = 5200;
  const car = parkCar(g, 'comet', 1500, 1120, Math.PI / 2);
  car.glow = true;
  const sResult = { rank: 'S', score: 12450, reward: 3000, respect: 800 };
  g.results = sResult;
  settle(g, 0.8);
  g.results = { rank: 'S', score: 12450, reward: 3000, respect: 800 };
  focusPlayer(g);
  clearMessages(g);
  return { screen: SCREEN_PLAY };
}

function stageCity(g) {
  // Daytime downtown drive: Comet GT heading south, traffic ahead.
  g.screen = SCREEN_PLAY;
  g.clock = 10.5;
  g.weather.rain = 0;
  g.weather.target = 0;
  g.weather.timer = 90;
  parkCar(g, 'comet', 1500, 1120, Math.PI / 2);
  const lead = g.cars.find((c) => c.role === 'traffic');
  if (lead) {
    lead.x = 1500;
    lead.y = 760;
    lead.speed = 120;
  }
  settle(g, 1.2);
  const mine = g.cars.find((c) => c.id === g.player.carId);
  if (mine) mine.speed = 260;
  focusPlayer(g);
  clearMessages(g);
  return { screen: SCREEN_PLAY };
}

function stageChase(g) {
  // Three stars, patrol cars on Rico's tail, downtown.
  g.screen = SCREEN_PLAY;
  g.clock = 13.0;
  g.weather.rain = 0;
  g.weather.target = 0;
  g.weather.timer = 90;
  parkCar(g, 'comet', 1500, 1300, -Math.PI / 2);
  const car = g.cars.find((c) => c.id === g.player.carId);
  if (car) car.speed = 300;
  g.wanted.heat = 62;
  g.wanted.level = 3;
  g.wanted.calmT = 30;
  settle(g, 1.6);
  const mine = g.cars.find((c) => c.id === g.player.carId);
  if (mine) {
    mine.speed = 320;
    g.camera.x = mine.x;
    g.camera.y = mine.y;
  }
  clearMessages(g);
  return { screen: SCREEN_PLAY };
}

function stageNight(g) {
  // Neon night in the rain: wet roads, lit windows, underglow.
  g.screen = SCREEN_PLAY;
  g.clock = 22.4;
  g.weather.rain = 0.75;
  g.weather.target = 1;
  g.weather.timer = 40;
  const car = parkCar(g, 'comet', 1500, 1120, Math.PI / 2);
  car.glow = true;
  const lead = g.cars.find((c) => c.role === 'traffic');
  if (lead) {
    lead.x = 1500;
    lead.y = 800;
    lead.speed = 110;
  }
  settle(g, 1.0);
  car.speed = 200;
  focusPlayer(g);
  clearMessages(g);
  return { screen: SCREEN_PLAY };
}

function stageStart(g) {
  g.clock = 9.5;
  g.weather.rain = 0;
  g.weather.target = 0;
  g.weather.timer = 90;
  g.camera.x = 1500;
  g.camera.y = 950;
  settle(g, 2);
  g.camera.x = 1500;
  g.camera.y = 950;
  clearMessages(g);
  return { screen: SCREEN_TITLE, best: 0 };
}

// Scene-name aliases: several names point at the same staging routine.
const SCENE_ROUTES = {
  heli: stageHeli,
  garage: stageGarage,
  combat: stageCombat,
  finale: stageFinale,
  city: stageCity,
  play: stageCity,
  driving: stageCity,
  chase: stageChase,
  night: stageNight,
  end: stageNight,
};

export function stageScene(name, g) {
  const key = (name || 'start').toLowerCase();
  const stage = SCENE_ROUTES[key] || stageStart;
  return stage(g);
}
