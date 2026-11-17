// Boot + the one loop: fixed 1/60 s steps, screens, settings, shop keys and
// the debug hooks the Playwright tests use. Shot mode (?shot=…&seed=…) stages
// a deterministic scene instead of running the loop.
import { STEP } from './config.js';
import { createGame, stepGame, buyShopItem, respawnPlayer, applySave } from './world.js';
import { createInput, EDGE_CONFIRM, EDGE_ENTER, EDGE_MUTE, EDGE_PAUSE, EDGE_RADIO, EDGE_RELOAD, EDGE_SAVE } from './input.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_DEAD, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_SETTINGS, SCREEN_SHOP, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';
import { hasSave, readSave, readSettings, writeSave, writeSettings } from './save.js';
import { startJob, startStory } from './missions.js';
import { makeCar } from './vehicles.js';

const MAX_FRAME = 0.25;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const game = createGame(seed);
const renderer = createRenderer(canvas);
const input = createInput(canvas);
window.__game = game;
window.__seed = seed;

// Settings from the last visit.
const savedSettings = readSettings();
if (savedSettings) {
  game.settings = { ...game.settings, ...savedSettings };
  game.audio.setMusicOn(game.settings.music !== false);
}
game.hasSave = hasSave();

function announce(message) {
  status.textContent = message;
}

// UI-only keys (digits, J, T, N) that the step function never sees.
const uiKeys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyJ', 'KeyT', 'KeyN'].includes(e.code)) uiKeys.add(e.code);
});
function takeUiKeys() {
  const keys = [...uiKeys];
  uiKeys.clear();
  return keys;
}

function idleInput() {
  return {
    axis: () => ({ x: 0, y: 0, run: false, up: false, down: false, left: false, right: false }),
    mouse: () => ({ x: 0, y: 0, down: false }),
  };
}

function startNewGame() {
  const fresh = createGame(seed);
  // Swap the live state in place so window.__game keeps pointing at it.
  for (const k of Object.keys(game)) delete game[k];
  Object.assign(game, fresh);
  game.screen = SCREEN_PLAY;
  game.hasSave = hasSave();
  game.audio.unlock();
  announce('Playing. Follow the gold marker — Mara is waiting.');
}

function continueGame() {
  const save = readSave();
  if (!save) {
    startNewGame();
    return;
  }
  const fresh = createGame(seed);
  for (const k of Object.keys(game)) delete game[k];
  Object.assign(game, fresh);
  applySave(game, save);
  game.screen = SCREEN_PLAY;
  game.audio.unlock();
  announce('Continuing. Follow the gold marker.');
}

function runShot(name) {
  const scene = stageShot(name, game);
  game.screen = scene.screen;
  let painted = 0;
  function paint() {
    renderer.draw(game, game.screen);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  let accumulator = 0;
  let last = performance.now();
  let frames = 0;
  let fpsTime = 0;
  let fps = 60;
  let pendingEdges = 0; // edge presses wait here until a fixed step runs,
  // so a press landing in a short frame is never dropped.
  window.__fps = 60;

  function updateAim() {
    const m = input.mouse();
    const rect = canvas.getBoundingClientRect();
    const sx = m.x;
    const sy = m.y;
    const w = renderer.toWorld(game, sx, sy);
    const focus = game.player.carId !== null
      ? game.cars.find((c) => c.id === game.player.carId) || game.player
      : game.player;
    game.aimAngle = Math.atan2(w.y - focus.y, w.x - focus.x);
  }

  function handleScreenKeys(edges, keys) {
    const screen = game.screen;
    if (screen === SCREEN_TITLE) {
      if (edges & EDGE_CONFIRM) {
        if (game.hasSave) continueGame();
        else startNewGame();
      } else if (keys.includes('KeyN')) {
        startNewGame();
      }
      return;
    }
    if (screen === SCREEN_DEAD || screen === SCREEN_BUSTED) {
      if (edges & EDGE_CONFIRM) respawnPlayer(game);
      return;
    }
    if (screen === SCREEN_PAUSED) {
      if (edges & (EDGE_PAUSE | EDGE_CONFIRM)) game.screen = SCREEN_PLAY;
      else if (keys.includes('KeyT')) game.screen = SCREEN_SETTINGS;
      return;
    }
    if (screen === SCREEN_SETTINGS) {
      if (edges & EDGE_PAUSE) game.screen = SCREEN_PAUSED;
      else if (keys.includes('Digit1')) {
        game.settings.music = !game.settings.music;
        game.audio.setMusicOn(game.settings.music);
        writeSettings(game.settings);
      } else if (keys.includes('Digit2')) {
        game.settings.traffic = game.settings.traffic === 'high' ? 'low' : 'high';
        writeSettings(game.settings);
      } else if (keys.includes('Digit3')) {
        game.settings.freezeTime = !game.settings.freezeTime;
        writeSettings(game.settings);
      }
      return;
    }
    if (screen === SCREEN_SHOP) {
      if (edges & EDGE_PAUSE) {
        game.screen = SCREEN_PLAY;
        game.shopId = null;
      } else {
        const buyKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
        keys.forEach((k) => {
          const idx = buyKeys.indexOf(k);
          if (idx >= 0) buyShopItem(game, idx);
        });
      }
      return;
    }
    // SCREEN_PLAY global keys.
    if (edges & EDGE_PAUSE) {
      game.screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (edges & EDGE_MUTE) {
      game.audio.setMuted(!game.audio.isMuted());
      game.toast(game.audio.isMuted() ? 'Muted' : 'Sound on');
    } else if (edges & EDGE_RADIO) {
      game.toast(`Radio: ${game.audio.nextStation()}`);
    } else if (edges & EDGE_SAVE) {
      writeSave(game);
      game.toast('Game saved');
    } else if (keys.includes('KeyT')) {
      game.screen = SCREEN_SETTINGS;
    } else if (keys.includes('KeyJ')) {
      if (!game.job) {
        const order = ['taxi', 'race', 'food'];
        const next = order[Math.floor(game.rng() * order.length)];
        startJob(game, next);
      } else {
        game.toast('Finish the current job first');
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    frames += 1;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      fps = Math.round((frames / fpsTime) * 10) / 10;
      window.__fps = fps;
      frames = 0;
      fpsTime = 0;
    }

    const freshEdges = input.takeEdges();
    pendingEdges |= freshEdges;
    const keys = takeUiKeys();
    updateAim();
    handleScreenKeys(freshEdges, keys);
    if (game.screen !== SCREEN_PLAY) pendingEdges = 0;

    if (game.screen === SCREEN_PLAY) {
      accumulator += dt;
      let first = true;
      while (accumulator >= STEP) {
        stepGame(game, input, STEP, first ? pendingEdges : 0);
        accumulator -= STEP;
        first = false;
      }
      if (!first) pendingEdges = 0; // a step consumed the pending edges
    } else if (game.screen === SCREEN_TITLE) {
      // Attract mode: the city lives behind the title.
      accumulator += dt;
      while (accumulator >= STEP) {
        stepGame(game, idleInput(), STEP, 0);
        accumulator -= STEP;
      }
      game.screen = SCREEN_TITLE; // stepping never changes the title screen
    } else {
      accumulator = 0;
    }
    renderer.draw(game, game.screen);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.screen === SCREEN_PLAY) {
      game.screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });
  canvas.addEventListener('pointerdown', () => game.audio.unlock());
  window.addEventListener('keydown', () => game.audio.unlock(), { once: true });

  announce('Vice Bay. Press Enter to start.');
  requestAnimationFrame(frame);
}

// --- Debug hooks for the Playwright tests (and nothing else). -------------
window.__debug = {
  state() {
    const p = game.player;
    return {
      screen: game.screen,
      cash: p.cash, hp: p.hp, armor: p.armor,
      weapon: p.weapon, mag: p.mag, ammo: { ...p.ammo },
      outfit: p.outfit, x: Math.round(p.x), y: Math.round(p.y),
      inCar: p.carId !== null,
      carType: p.carId !== null ? (game.cars.find((c) => c.id === p.carId) || {}).type || null : null,
      carHp: p.carId !== null ? (game.cars.find((c) => c.id === p.carId) || {}).hp : null,
      wanted: game.wanted.level, heat: Math.round(game.wanted.heat),
      missionIndex: game.missionIndex, stageIndex: game.stageIndex,
      missionsDone: game.missionsDone.slice(),
      job: game.job ? { kind: game.job.kind, phase: game.job.phase || null } : null,
      enemies: game.enemies.length, cops: game.cops.length,
      cars: game.cars.length, peds: game.peds.length,
      rain: Math.round(game.weather.rain * 100) / 100,
      clock: Math.round(game.clock * 10) / 10,
      stats: { ...game.stats },
      fps: window.__fps || 0,
    };
  },
  tp(x, y) {
    const p = game.player;
    const car = game.cars.find((c) => c.id === p.carId);
    if (car) {
      car.x = x;
      car.y = y;
      car.speed = 0;
    }
    p.x = x;
    p.y = y;
    game.camera.x = x;
    game.camera.y = y;
  },
  setWanted(n) {
    game.wanted.heat = n <= 0 ? 0 : (n - 1) * 20 + 12;
    game.wanted.calmT = 999;
  },
  clearWanted() {
    game.wanted.heat = 0;
    game.wanted.level = 0;
    game.cops = [];
  },
  give(kind) {
    const p = game.player;
    if (kind === 'smg') {
      p.ammo.smg += 90;
      if (!p.owned.includes('smg')) p.owned.push('smg');
      p.weapon = 'smg';
      p.mag = 30;
    } else if (kind === 'shotgun') {
      p.ammo.shotgun += 18;
      if (!p.owned.includes('shotgun')) p.owned.push('shotgun');
      p.weapon = 'shotgun';
      p.mag = 6;
    } else if (kind === 'armor') {
      p.armor = 100;
    } else if (kind === 'cash500') {
      p.cash += 500;
    } else if (kind === 'heal') {
      p.hp = 100;
    }
  },
  startMission(i) {
    startStory(game, i);
  },
  startJob(kind) {
    startJob(game, kind);
  },
  cancelJob() {
    game.job = null;
  },
  setClock(h) {
    game.clock = h;
  },
  setRain(v) {
    game.weather.rain = v;
    game.weather.target = v;
    game.weather.timer = 999;
  },
  inCar(type) {
    const car = makeCar(game, type || 'comet', game.player.x + 40, game.player.y, 0, 'player');
    game.cars.push(car);
    game.player.carId = car.id;
  },
  damageCar(hp) {
    const car = game.cars.find((c) => c.id === game.player.carId);
    if (car) car.hp = hp;
  },
  setCash(n) {
    game.player.cash = n;
  },
  save() {
    return writeSave(game);
  },
  load() {
    const s = readSave();
    if (!s) return false;
    applySave(game, s);
    return true;
  },
  hasSave() {
    return hasSave();
  },
};

if (shot) runShot(shot);
else runGame();
