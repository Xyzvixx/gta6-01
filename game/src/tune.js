// Vice Bay v2 — tuning constants, palette and key bindings.
// Constants only; there is no logic in this file.
//
// Look: golden-hour dusk over wet asphalt. Amber sky, neon signs
// reflected in damp roads, magenta and cyan against long dusk
// shadows.

export const VIEW = { w: 1280, h: 720 };
export const WORLD = { w: 3200, h: 2400 };
export const STEP = 1 / 60;

export const SAVE_KEY = 'vicebay.save.v4';
export const SETTINGS_KEY = 'vicebay.settings.v4';

// One shared palette: every renderer reads its colours from here,
// so the whole game keeps the same dusk look.
export const PALETTE = {
  backdrop: '#14101c',
  skyDusk: '#e8863a',
  skyDuskDeep: '#7a3b5e',
  skyNight: '#0d0a1a',
  grass: '#3a6b34',
  grassDry: '#6b7a3a',
  sand: '#c9a86f',
  water: '#1d5f8a',
  waterDeep: '#123f63',
  waterGlow: '#37e6ff',
  asphalt: '#33373d',
  asphaltWet: '#23262e',
  laneLine: '#c8b45a',
  sidewalk: '#8a8d90',
  curb: '#6d7073',
  park: '#2c5c2a',
  buildingSide: '#23262e',
  buildingRoof: '#3a3f4a',
  text: '#f2f4f7',
  dim: '#9aa3ad',
  gold: '#f2c94c',
  amber: '#ff9a3d',
  red: '#e5534b',
  blue: '#4f8ef7',
  green: '#58b368',
  neonPink: '#ff4fd8',
  neonCyan: '#37e6ff',
  neonOrange: '#ff9a3d',
  neonLime: '#b8ff4f',
  shadow: 'rgba(20, 10, 30, 0.35)',
};

// On-foot movement.
export const WALK = { speed: 175, run: 268, radius: 13 };

// Driving: brisk arcade steering, firm brakes, and a little grip
// lost on wet roads.
export const CAR_PHYSICS = {
  accel: 430,
  brake: 640,
  reverseMax: 150,
  drag: 0.55,
  gripDry: 1,
  gripWet: 0.86,
  turnRate: 2.55,
  nitroBoost: 190,
  nitroSeconds: 2.5,
};

// Wanted heat runs 0-100; the wanted level is derived from heat
// (see cops.js).
export const WANTED = {
  steal: 26,
  hitPed: 16,
  shootSeen: 22,
  killSeen: 30,
  crashCop: 18,
  decayPerSec: 3.2,
  calmHold: 6,
  maxHeat: 100,
};

// Rain: dry spells outlast storms, and rain fades in over seconds.
export const WEATHER = {
  dryMin: 55,
  dryMax: 130,
  rainMin: 28,
  rainMax: 55,
  fadeSec: 9,
};

// In-game clock: one game hour per 100 real seconds, unless the
// clock is frozen in settings.
export const CLOCK = { startHour: 17.4, secondsPerHour: 100, nightFrom: 19.5, nightTo: 6.5 };

// Helicopter pursuit (state machine in cops.js).
export const HELI = {
  spotRadius: 260,
  loseRadius: 500,
  loseSeconds: 4,
  trackLag: 0.55,
  cruiseSpeed: 260,
  searchOrbit: 180,
};

// Traffic and crowd caps — the FPS stress case is sized to these.
export const BUDGET = { trafficCars: 24, peds: 40, parkedCars: 26, particles: 400 };

// Key bindings. Q does double duty: a quick tap quick-saves, while
// holding it past WHEEL_HOLD_SECONDS opens the weapon wheel.
// Tab is deliberately NOT a game key — it must keep moving browser
// focus out of the canvas. G calls the crew driver, H the lookout.
export const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  enterCar: 'KeyE',
  interact: 'KeyE',
  run: 'ShiftLeft',
  reload: 'KeyR',
  pause: 'Escape',
  mute: 'KeyM',
  radio: 'KeyV',
  save: 'KeyQ',
  wheel: 'KeyQ',
  crewDriver: 'KeyG',
  crewLookout: 'KeyH',
  job: 'KeyJ',
  settings: 'KeyT',
  newGame: 'KeyN',
  confirm: 'Enter',
};

// Hold Q longer than this and the wheel opens instead of saving.
export const WHEEL_HOLD_SECONDS = 0.25;

// Cash handed to a fresh game.
export const START_CASH = 250;

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
