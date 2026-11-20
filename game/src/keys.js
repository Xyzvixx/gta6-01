// Vice Bay v2 — keyboard and mouse input, with one-shot edge flags.
//
// A "tap" is an edge that fires once on keydown; a "hold" is read
// from _held. Q does double duty — a tap under 0.25s quick-saves,
// a longer hold opens the weapon wheel — but that split lives in
// main.js, which sees the real key events, so a fast tap can never
// fall between two frames. This module only reports holds and
// one-shot action edges. Tab is deliberately NOT a game key: it
// must keep moving browser focus.

import { KEYS } from './tune.js';

export const EDGE_ENTER = 1;
export const EDGE_RELOAD = 2;
export const EDGE_PAUSE = 4;
export const EDGE_MUTE = 8;
export const EDGE_RADIO = 16;
export const EDGE_CONFIRM = 64;
export const EDGE_CREW = 256;

// Codes that must never scroll the page or move focus while
// playing. Tab is NOT here: swallowing it would block keyboard
// navigation out of the canvas, an accessibility violation.
const SWALLOW = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
]);

// The click queue is capped so mousedown spam while paused or in a
// shop can never pile up into delayed shots or wheel picks later.
const MAX_CLICKS = 8;

// Which edge flag(s) each keydown raises. Confirm (Enter) and Space
// raise both ENTER and CONFIRM; E raises ENTER only — it is the
// in-world interact key (board/leave a car, open a shop, hand in a
// mission), while CONFIRM is the UI confirm used on the title,
// dead and paused screens.
const EDGE_BY_CODE = new Map([
  [KEYS.confirm, EDGE_ENTER | EDGE_CONFIRM],
  ['Space', EDGE_ENTER | EDGE_CONFIRM],
  [KEYS.enterCar, EDGE_ENTER],
  [KEYS.interact, EDGE_ENTER],
  [KEYS.reload, EDGE_RELOAD],
  [KEYS.pause, EDGE_PAUSE],
  [KEYS.mute, EDGE_MUTE],
  [KEYS.radio, EDGE_RADIO],
  [KEYS.crewDriver, EDGE_CREW],
  [KEYS.crewLookout, EDGE_CREW],
]);

export function createKeys(canvas) {
  // _held maps a code to the performance.now() timestamp it went down.
  const _held = new Map();
  let pendingEdges = 0;
  const clicks = [];
  const mouseState = { x: 0, y: 0, down: false };

  // Mouse position in CSS pixels, matching the painter's coordinate
  // space: toWorld() expects CSS px (its origin/scale are CSS-based)
  // and the wheel math uses clientWidth/clientHeight. Scaling by
  // canvas.width / rect.width (backing pixels times DPR) used to
  // mis-aim shooting on every HiDPI display; at DPR 1 nothing
  // changes.
  function canvasPos(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function onDown(ev) {
    if (SWALLOW.has(ev.code)) ev.preventDefault();
    if (ev.repeat) return;
    _held.set(ev.code, performance.now());
    const edge = EDGE_BY_CODE.get(ev.code);
    if (edge !== undefined) pendingEdges |= edge;
  }

  function onUp(ev) {
    // Keyup only releases the hold state. The Q tap-vs-hold split
    // is decided by main.js from the real key events (a tap landing
    // between two frames must still save); nothing here fires
    // save/wheel edges, so that split has exactly one owner and no
    // double handling.
    _held.delete(ev.code);
  }

  function onMouseMove(ev) {
    const pos = canvasPos(ev);
    mouseState.x = pos.x;
    mouseState.y = pos.y;
  }

  function onMouseDown(ev) {
    const pos = canvasPos(ev);
    mouseState.x = pos.x;
    mouseState.y = pos.y;
    mouseState.down = true;
    if (clicks.length >= MAX_CLICKS) clicks.shift();
    clicks.push({ x: pos.x, y: pos.y, button: ev.button });
  }

  function onMouseUp() {
    mouseState.down = false;
  }

  function onBlur() {
    _held.clear();
    mouseState.down = false;
    clicks.length = 0;
  }

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);

  // Seconds a code has been held (0 when it is not held).
  function heldSeconds(code) {
    const started = _held.get(code);
    return started === undefined ? 0 : (performance.now() - started) / 1000;
  }

  function axis() {
    const anyHeld = (codes) => codes.some((code) => _held.has(code));
    const x = (anyHeld(KEYS.right) ? 1 : 0) - (anyHeld(KEYS.left) ? 1 : 0);
    const y = (anyHeld(KEYS.down) ? 1 : 0) - (anyHeld(KEYS.up) ? 1 : 0);
    return { x, y };
  }

  // Drain the queued edge flags (call once per tick).
  function takeEdges() {
    const edges = pendingEdges;
    pendingEdges = 0;
    return edges;
  }

  // Drain queued mouse clicks (call once per tick).
  function takeClick() {
    return clicks.shift() || null;
  }

  function mouse() {
    return mouseState;
  }

  return {
    // Movement axis from WASD/arrows, each component in -1..1.
    axis,
    takeEdges,
    takeClick,
    mouse,
    heldSeconds,
    _held,
  };
}
