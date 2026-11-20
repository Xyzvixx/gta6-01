// Vice Bay v2 — deterministic randomness and tiny numeric utilities.
//
// One rule governs this module: the simulation never touches
// Math.random. A single seeded stream lives on the game state, so a
// replay with the same seed plays out identically. Cosmetic screen
// shake is allowed to use Math.random, because it never feeds the
// simulation back.

// Mulberry32, written from the algorithm's description: advance the
// state by a fixed odd increment, scramble it with an integer
// multiply plus xor-shifts, then scale the unsigned result into
// the half-open interval [0, 1).
export function makeRng(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) | 0;
    let scrambled = Math.imul(state ^ (state >>> 15), 1 | state);
    scrambled = (scrambled + Math.imul(scrambled ^ (scrambled >>> 7), 61 | scrambled)) ^ scrambled;
    return ((scrambled ^ (scrambled >>> 14)) >>> 0) / 4294967296;
  };
}

// Fold a string into a stable unsigned 32-bit seed using the
// FNV-1a pattern: xor in each code unit, then multiply by the
// FNV prime.
export function seedFromString(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

// The one and only clamp in the codebase. Every other module
// imports this instead of keeping a private copy.
export function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

// Sanitize a number coming from untrusted input (a save file, for
// example). Non-numbers, NaN and infinities fall back to `fallback`,
// then the result is clamped into [low, high].
export function num(value, fallback, low, high) {
  const clean = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return clamp(clean, low, high);
}

export function intNum(value, fallback, low, high) {
  return Math.floor(num(value, fallback, low, high));
}

export function lerp(from, to, fraction) {
  return from + (to - from) * fraction;
}

// Squared distance between two points. Range checks use this so
// they can skip the square root entirely.
export function dist2(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

// Smallest signed rotation from `from` towards `to`, in (-PI, PI].
export function turnDelta(from, to) {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta <= -Math.PI) delta += twoPi;
  return delta;
}

// Uniform float in [low, high).
export function range(rng, low, high) {
  return low + rng() * (high - low);
}

// Uniform integer in [low, high], both ends inclusive.
export function intRange(rng, low, high) {
  return low + Math.floor(rng() * (high - low + 1));
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

// True with probability `p`, where p is in [0, 1].
export function chance(rng, p) {
  return rng() < p;
}
