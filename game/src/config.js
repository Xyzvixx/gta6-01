// Vice Bay — tuning numbers, colours and keys. One place, no logic.
// The playfield is a fixed 1280x720 logical view; the world itself is much
// bigger (see WORLD) and the camera follows the player around it.
export const VIEW = { w: 1280, h: 720 };
export const WORLD = { w: 3200, h: 2400 };
export const STEP = 1 / 60;

export const SAVE_KEY = 'vicebay.save.v3';
export const SETTINGS_KEY = 'vicebay.settings.v3';

export const COLOURS = {
  backdrop: '#0b0e14',
  grass: '#3d6b35',
  grass2: '#35602f',
  sand: '#c9b078',
  water: '#1d5f8a',
  waterDeep: '#14486b',
  asphalt: '#33373d',
  asphaltWet: '#272b31',
  lane: '#c8b45a',
  sidewalk: '#8a8d90',
  curb: '#6d7073',
  park: '#2f5c2a',
  buildingSide: '#23262e',
  text: '#f2f4f7',
  dim: '#9aa3ad',
  gold: '#f2c94c',
  red: '#e5534b',
  blue: '#4f8ef7',
  green: '#58b368',
  neonPink: '#ff4fd8',
  neonCyan: '#37e6ff',
  neonOrange: '#ff9a3d',
};

export const WALK = { speed: 175, run: 265, radius: 13 };
export const CAR_PHYSICS = {
  accel: 430,
  brake: 620,
  reverseMax: 150,
  drag: 0.55,
  gripDry: 1,
  gripWet: 0.88,
  turnRate: 2.55,
};

export const WANTED = {
  steal: 26,
  hitPed: 16,
  shootSeen: 22,
  killSeen: 30,
  crashCop: 18,
  decayPerSec: 3.2,
  maxHeat: 100,
};

export const WEATHER = {
  dryMin: 55,
  dryMax: 130,
  rainMin: 28,
  rainMax: 55,
  fadeSec: 9,
};

// Clock: one in-game hour per 100 real seconds unless frozen.
export const CLOCK = { startHour: 9.5, secondsPerHour: 100, nightFrom: 19.5, nightTo: 6.5 };

export const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  enterCar: 'KeyE',
  run: 'ShiftLeft',
  reload: 'KeyR',
  pause: 'Escape',
  mute: 'KeyM',
  radio: 'KeyV',
  save: 'KeyQ',
  interact: 'KeyE',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
