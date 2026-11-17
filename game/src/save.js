// Versioned save / load in localStorage. A save from another version (or a
// corrupt one) is ignored safely and the game starts fresh instead of
// crashing. Only plain, resumable state is stored — never entity pools.
import { SAVE_KEY, SETTINGS_KEY } from './config.js';

export function writeSave(g) {
  try {
    const p = g.player;
    const data = {
      v: 3,
      cash: p.cash,
      hp: p.hp,
      armor: p.armor,
      weapon: p.weapon,
      ammo: p.ammo,
      outfit: p.outfit,
      x: p.x,
      y: p.y,
      clock: g.clock,
      missionIndex: g.missionIndex,
      missionsDone: g.missionsDone.slice(),
      stats: { ...g.stats },
      inCar: p.carId !== null,
      carType: p.carId !== null ? (g.cars.find((c) => c.id === p.carId) || {}).type || null : null,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 3 || typeof data.cash !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

export function hasSave() {
  return readSave() !== null;
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}

export function writeSettings(s) {
  try {
    window.localStorage.setItem(SETTTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function readSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    return s;
  } catch {
    return null;
  }
}
