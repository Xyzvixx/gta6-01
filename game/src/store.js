// Vice Bay v2 — persistence: one versioned save slot plus player
// settings, both kept in localStorage. A save read back off disk is
// untrusted input (localStorage can be hand-edited in seconds), so
// nothing is trusted here: every field is re-checked against its
// allow-list, type and range before the game ever sees it, and anything
// that cannot be repaired falls back to a fresh-start default. A
// tampered save costs progress, never a broken game. Old v3 saves still
// load — the fields v4 added are filled with their starting values,
// so no save is ever bricked by the upgrade.

import { SAVE_KEY, SETTINGS_KEY } from './tune.js';
import { intNum, num } from './dice.js';

// --- Allow-lists and hard limits. ---
const WEAPONS = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];
const OUTFITS = ['street', 'neon', 'suit'];
const CAR_TYPES = ['marlin', 'comet', 'vano', 'cabrio', 'hauler', 'interceptor', 'moto', 'pickup', 'limo'];
const DISTRICTS = ['marina', 'heights', 'downtown', 'docks', 'strip', 'beach'];
const CHAPTER_IDS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
const UPGRADE_LINES = ['engine', 'armor', 'nitro'];
const COUNTER_KEYS = ['stolen', 'kills', 'chapters', 'jobs', 'topWanted', 'deaths'];

const MAX_CASH = 999999;
const MAX_AMMO = 999;
const MAX_COUNTER = 999999;
const MAX_PLAYTIME = 99999999;
const MAX_TIER = 3;
const MAX_GARAGE_CARS = 24;
const MAX_CAR_ID = 999999;
const MAX_WANTED = 5;
const MAX_RESPECT = 99999;
const MAX_RANK = 4;
const MAP_W = 3200;
const MAP_H = 2400;

const DEFAULT_SETTINGS = { music: true, traffic: 'high', freezeTime: false };

// True only for a plain JSON object: arrays, null and primitives fail.
// Saves are JSON, so a genuine nested value is always a plain object;
// anything else is tampering or corruption, not data.
function isRecord(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Thin wrappers over the shared dice validators (finite + fallback +
// clamp) so the call sites below read as intent, not plumbing.
function whole(v, fallback, lo, hi) {
  return intNum(v, fallback, lo, hi);
}
function real(v, fallback, lo, hi) {
  return num(v, fallback, lo, hi);
}

// Per-weapon reserve ammo, fists excluded (it needs none). Every slot is
// an integer in range; a missing or junk slot keeps the default.
function cleanAmmo(src, base) {
  const out = { ...base };
  if (!isRecord(src)) return out;
  for (const w of WEAPONS) {
    if (w === 'fists') continue;
    out[w] = whole(src[w], base[w], 0, MAX_AMMO);
  }
  return out;
}

// Per-weapon loaded magazines: same shape and bounds as reserve ammo.
function cleanMags(src, base) {
  const out = { ...base };
  if (!isRecord(src)) return out;
  for (const w of WEAPONS) {
    if (w === 'fists') continue;
    out[w] = whole(src[w], base[w], 0, MAX_AMMO);
  }
  return out;
}

// Lifetime counters. Each one is bounded on its own, and two
// cross-checks tie the numbers to the rest of the save instead of
// trusting them standalone: topWanted can never exceed the highest
// wanted level the game produces, and chapters completed can never
// exceed the chapters the save actually lists as done.
function cleanStats(src, base, doneCount) {
  const out = { ...base };
  if (!isRecord(src)) return out;
  for (const k of COUNTER_KEYS) {
    out[k] = whole(src[k], base[k] || 0, 0, MAX_COUNTER);
  }
  out.topWanted = Math.min(out.topWanted, MAX_WANTED);
  out.chapters = Math.min(out.chapters, doneCount);
  out.playtime = real(src.playtime, base.playtime || 0, 0, MAX_PLAYTIME);
  return out;
}

// District standing: only the six known districts survive, each 0..100.
// An unknown district key is dropped, not stored.
function cleanStanding(src, base) {
  const out = { ...base };
  if (!isRecord(src)) return out;
  for (const id of DISTRICTS) {
    if (src[id] !== undefined) out[id] = real(src[id], base[id] || 0, 0, 100);
  }
  return out;
}

// One car's three upgrade lines. Each line is an integer tier 0..3; an
// unknown line (or a non-object value) is dropped outright, so a
// hand-edited save cannot smuggle in a tier-99 engine or a stray key
// that later code might read as a stat.
function cleanUpgrades(src, base) {
  const out = { ...base };
  if (!isRecord(src)) return out;
  for (const line of UPGRADE_LINES) {
    out[line] = whole(src[line], base[line] || 0, 0, MAX_TIER);
  }
  return out;
}

// The whole garage, entry by entry. Car ids are numeric, so a key like
// "__proto__" is dropped instead of stored, and an id outside the
// plausible range is dropped too. Each stored car is validated through
// cleanUpgrades, so every tier inside the garage is a real 0..3 value,
// and the garage as a whole is capped — a save claiming hundreds of
// cars is trimmed to the newest plausible set instead of being trusted.
function cleanGarage(src) {
  const out = {};
  if (!isRecord(src)) return out;
  for (const k of Object.keys(src)) {
    if (Object.keys(out).length >= MAX_GARAGE_CARS) break;
    if (!/^\d+$/.test(k)) continue;
    const id = Number(k);
    if (!Number.isInteger(id) || id < 1 || id > MAX_CAR_ID) continue;
    const v = src[k];
    if (!isRecord(v)) continue;
    out[k] = cleanUpgrades(v, { engine: 0, armor: 0, nitro: 0 });
  }
  return out;
}

// Completed chapters: only the eight known ids, in first-seen order,
// duplicates removed, at most eight entries. Anything else — a "c9", a
// legacy "m4", a number — is dropped, so a forged list can never claim
// a finale the player never played.
function cleanChapterList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const id of list) {
    if (typeof id !== 'string' || !CHAPTER_IDS.includes(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= CHAPTER_IDS.length) break;
  }
  return out;
}

// Repair a chapter index that contradicts the completed list: -1 means
// "no chapter yet", so it resumes at the next uncompleted chapter, and
// an index of 8 without c8 done is the same stranded state — resume at
// the next uncompleted chapter instead of free-roaming with no
// objective. A consistent index passes through untouched.
function repairChapterIndex(idx, done) {
  const clamped = whole(idx, -1, -1, CHAPTER_IDS.length);
  const next = Math.min(done.length, CHAPTER_IDS.length);
  if (clamped < 0) return next;
  if (clamped >= CHAPTER_IDS.length && !done.includes('c8')) return next;
  return clamped;
}

function blankV4() {
  return {
    v: 4,
    cash: 250,
    hp: 100,
    armor: 0,
    weapon: 'pistol',
    ammo: { pistol: 96, smg: 0, shotgun: 0, rifle: 0 },
    mags: { pistol: 12, smg: 0, shotgun: 0, rifle: 0 },
    outfit: 'street',
    x: 1500,
    y: 1120,
    clock: 17.4,
    chapterIndex: -1,
    chaptersDone: [],
    respect: { points: 0, rank: 0 },
    standing: { marina: 0, heights: 0, downtown: 0, docks: 0, strip: 0, beach: 0 },
    crew: { driver: false, lookout: false },
    garage: {},
    stats: { stolen: 0, kills: 0, chapters: 0, jobs: 0, topWanted: 0, playtime: 0, deaths: 0 },
    inCar: false,
    carType: null,
    carUpgrades: { engine: 0, armor: 0, nitro: 0 },
    savedAt: 0,
  };
}

// Serialize the live game state into a v4 save object and store it.
// The garage is deep-copied so later tuning cannot mutate the stored
// snapshot, and a storage failure reports false instead of throwing.
export function writeSave(g) {
  const p = g.player;
  const car = p && p.carId != null ? (g.cars || []).find((c) => c.id === p.carId) : null;
  const data = {
    v: 4,
    cash: p ? p.cash : 250,
    hp: p ? p.hp : 100,
    armor: p ? p.armor : 0,
    weapon: p ? p.weapon : 'pistol',
    ammo: p ? { ...p.ammo } : { pistol: 96, smg: 0, shotgun: 0, rifle: 0 },
    mags: p ? { ...(p.mags || { pistol: 12, smg: 0, shotgun: 0, rifle: 0 }) } : { pistol: 12, smg: 0, shotgun: 0, rifle: 0 },
    outfit: p ? p.outfit : 'street',
    x: p ? p.x : 1500,
    y: p ? p.y : 1120,
    clock: g.clock,
    chapterIndex: g.chapter,
    chaptersDone: [...(g.chaptersDone || [])],
    respect: { ...(g.respect || { points: 0, rank: 0 }) },
    standing: { ...(g.standing || {}) },
    crew: { driver: !!(g.crew && g.crew.driver), lookout: !!(g.crew && g.crew.lookout) },
    garage: JSON.parse(JSON.stringify(g.garage || {})),
    stats: { ...(g.stats || {}) },
    inCar: !!car,
    carType: car ? car.type : null,
    carUpgrades: car ? { ...car.upgrades } : { engine: 0, armor: 0, nitro: 0 },
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

// Read and validate a save. v4 is normalized, v3 is migrated; anything
// else — corrupt JSON, an unknown version, a non-object — returns null
// instead of handing the game a half-valid state.
export function readSave() {
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!isRecord(data)) return null;
  if (data.v === 4) return normalizeV4(data);
  if (data.v === 3) return migrateV3(data);
  return null;
}

// Full v4 validation. The completed-chapter list is cleaned first
// because two later fields depend on it: the stats cross-check and the
// chapter-index repair both read it. A timestamp from the future is
// clamped back to now — a clock-skewed or forged savedAt must not
// outrank a real one.
function normalizeV4(data) {
  const base = blankV4();
  const out = { ...base, v: 4 };
  out.cash = whole(data.cash, base.cash, 0, MAX_CASH);
  out.hp = real(data.hp, base.hp, 0, 100);
  out.armor = real(data.armor, base.armor, 0, 100);
  out.weapon = WEAPONS.includes(data.weapon) ? data.weapon : base.weapon;
  out.ammo = cleanAmmo(data.ammo, base.ammo);
  out.mags = cleanMags(data.mags, base.mags);
  out.outfit = OUTFITS.includes(data.outfit) ? data.outfit : base.outfit;
  out.x = real(data.x, base.x, 0, MAP_W);
  out.y = real(data.y, base.y, 0, MAP_H);
  out.clock = real(data.clock, base.clock, 0, 24);
  out.chaptersDone = cleanChapterList(data.chaptersDone);
  out.chapterIndex = repairChapterIndex(data.chapterIndex, out.chaptersDone);
  out.respect = {
    points: whole(data.respect && data.respect.points, base.respect.points, 0, MAX_RESPECT),
    rank: whole(data.respect && data.respect.rank, base.respect.rank, 0, MAX_RANK),
  };
  out.standing = cleanStanding(data.standing, base.standing);
  out.crew = { driver: !!(data.crew && data.crew.driver), lookout: !!(data.crew && data.crew.lookout) };
  out.garage = cleanGarage(data.garage);
  out.stats = cleanStats(data.stats, base.stats, out.chaptersDone.length);
  out.inCar = !!data.inCar;
  out.carType = CAR_TYPES.includes(data.carType) ? data.carType : null;
  out.carUpgrades = cleanUpgrades(data.carUpgrades, base.carUpgrades);
  out.savedAt = Math.min(real(data.savedAt, 0, 0, Number.MAX_SAFE_INTEGER), Date.now());
  return out;
}

// v3 had no respect/standing/crew/garage, no magazines, and mission ids
// (m1..m9) instead of chapter ids — those start at their v4 defaults,
// and the mission ids are translated to chapter ids where they map.
// The same chapter-list, stats and index repairs as v4 apply, so a
// migrated save is exactly as trustworthy as a native one.
function migrateV3(data) {
  const base = blankV4();
  const doneRaw = Array.isArray(data.chaptersDone) ? data.chaptersDone
    : (Array.isArray(data.missionsDone) ? data.missionsDone : []);
  const translated = doneRaw.map((id) => (
    typeof id === 'string' && /^m[1-9]$/.test(id) ? `c${id.slice(1)}` : id
  ));
  const done = cleanChapterList(translated);
  const idx = data.missionIndex !== undefined ? data.missionIndex
    : (data.chapterIndex !== undefined ? data.chapterIndex : -1);
  const out = {
    ...base,
    v: 4,
    respect: { points: 0, rank: 0 },
    standing: { ...base.standing },
    crew: { driver: false, lookout: false },
    garage: {},
  };
  out.cash = whole(data.cash, base.cash, 0, MAX_CASH);
  out.hp = real(data.hp, base.hp, 0, 100);
  out.armor = real(data.armor, base.armor, 0, 100);
  out.weapon = WEAPONS.includes(data.weapon) ? data.weapon : base.weapon;
  out.ammo = cleanAmmo(data.ammo, base.ammo);
  out.outfit = OUTFITS.includes(data.outfit) ? data.outfit : base.outfit;
  out.x = real(data.x, base.x, 0, MAP_W);
  out.y = real(data.y, base.y, 0, MAP_H);
  out.clock = real(data.clock, base.clock, 0, 24);
  out.chaptersDone = done;
  out.chapterIndex = repairChapterIndex(idx, done);
  out.stats = cleanStats(data.stats, base.stats, done.length);
  out.inCar = !!data.inCar;
  out.carType = CAR_TYPES.includes(data.carType) ? data.carType : null;
  out.carUpgrades = cleanUpgrades(data.carUpgrades, base.carUpgrades);
  out.savedAt = Math.min(real(data.savedAt, 0, 0, Number.MAX_SAFE_INTEGER), Date.now());
  return out;
}

export function hasSave() {
  return readSave() !== null;
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    // Storage unavailable — nothing to clear.
  }
}

// Allow-listed settings normalizer: each field is checked against the
// type/range/enum its consumer expects, unknown keys are dropped, and
// an invalid value falls back to the default. A settings blob that was
// hand-edited (or written by an older build) can never smuggle a wrong
// type into live settings. Used on both read and write.
function normalizeSettings(data) {
  const s = { ...DEFAULT_SETTINGS };
  if (!isRecord(data)) return s;
  if (typeof data.music === 'boolean') s.music = data.music;
  if (data.traffic === 'high' || data.traffic === 'low') s.traffic = data.traffic;
  if (typeof data.freezeTime === 'boolean') s.freezeTime = data.freezeTime;
  return s;
}

export function writeSettings(s) {
  const merged = normalizeSettings(s);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    return true;
  } catch (e) {
    return false;
  }
}

export function readSettings() {
  let raw = null;
  try {
    raw = localStorage.getItem(SETTINGS_KEY);
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const data = JSON.parse(raw);
    if (!isRecord(data)) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(data);
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}
