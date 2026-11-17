// Deterministic screenshot scenes behind ?shot=…. Each one builds the real
// game from the seed, then drives it into a staged situation with the real
// rules — never a mock-up — and parks the camera on the player so the frame
// is centred. The same seed always gives the same frame.
import { STEP } from './config.js';
import { makeCar } from './vehicles.js';
import { makeEnemy } from './combat.js';
import { startJob, startStory } from './missions.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stepGame } from './world.js';

function idleInput() {
  return {
    axis: () => ({ x: 0, y: 0, run: false, up: false, down: false, left: false, right: false }),
    takeEdges: () => 0,
    mouse: () => ({ x: 0, y: 0, down: false }),
  };
}

function settle(g, seconds) {
  const input = idleInput();
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) stepGame(g, input, STEP);
}

function parkCar(g, type, x, y, angle) {
  const car = makeCar(g, type, x, y, angle, 'player');
  car.speed = 0;
  g.cars.push(car);
  g.player.carId = car.id;
  g.player.x = x;
  g.player.y = y;
  g.camera.x = x;
  g.camera.y = y;
  return car;
}

function stageCity(g) {
  // Daytime downtown drive: Rico in a Comet GT, traffic and peds around.
  g.clock = 10.5;
  g.weather.rain = 0;
  g.weather.target = 0;
  g.weather.timer = 90;
  // Park one block south of the Bay Arms corner so the car never covers
  // the shop sign.
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
  g.camera.x = g.player.x;
  g.camera.y = g.player.y;
  g.messages = [];
  return { screen: SCREEN_PLAY };
}

function stageCombat(g) {
  // On foot at the dock warehouse, three Tiburones ahead, pistol out.
  g.clock = 15.0;
  g.weather.rain = 0;
  g.weather.target = 0;
  startStory(g, 1);
  g.stageIndex = 1;
  g.missionData = { kills: 0, killBase: g.stats.kills };
  g.player.x = 420;
  g.player.y = 2000;
  g.player.angle = Math.PI / 2;
  g.player.weapon = 'pistol';
  g.player.mag = 12;
  g.enemies = [];
  // The crew stands in the open on Anchor St itself (never inside a block,
  // where the buildings would shove the fighters out of frame).
  const spots = [[350, 2000], [500, 2030], [580, 1980]];
  for (let i = 0; i < 3; i += 1) {
    g.enemies.push(makeEnemy(g, spots[i][0], spots[i][1]));
  }
  g.camera.x = 450;
  g.camera.y = 2000;
  g.aimAngle = Math.PI / 2;
  settle(g, 0.4);
  g.camera.x = 450;
  g.camera.y = 2000;
  g.messages = [];
  return { screen: SCREEN_PLAY };
}

function stageChase(g) {
  // Three stars, two patrol cars on Rico's tail, downtown.
  g.clock = 13.0;
  g.weather.rain = 0;
  g.weather.target = 0;
  parkCar(g, 'comet', 1500, 1300, -Math.PI / 2);
  const car = g.cars.find((c) => c.id === g.player.carId);
  car.speed = 300;
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
  g.messages = [];
  return { screen: SCREEN_PLAY };
}

function stageNight(g) {
  // Neon night in the rain: wet roads, lit windows, underglow.
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
  g.camera.x = g.player.x;
  g.camera.y = g.player.y;
  g.messages = [];
  return { screen: SCREEN_PLAY };
}

function stageStart(g) {
  g.clock = 9.5;
  g.weather.rain = 0;
  g.weather.target = 0;
  g.camera.x = 1500;
  g.camera.y = 950;
  settle(g, 2);
  g.camera.x = 1500;
  g.camera.y = 950;
  return { screen: SCREEN_TITLE, best: 0 };
}

export function stageShot(name, g) {
  const key = (name || 'start').toLowerCase();
  if (key === 'city' || key === 'play' || key === 'driving') return stageCity(g);
  if (key === 'combat') return stageCombat(g);
  if (key === 'chase') return stageChase(g);
  if (key === 'night' || key === 'end') return stageNight(g);
  return stageStart(g);
}
