// Keyboard + mouse. Held keys are read every step; one-shot presses (enter
// car, reload, pause, ...) are queued as edge flags and consumed once, so a
// press between two frames is never lost or counted twice.
import { KEYS } from './config.js';

export const EDGE_ENTER = 1;
export const EDGE_RELOAD = 2;
export const EDGE_PAUSE = 4;
export const EDGE_MUTE = 8;
export const EDGE_RADIO = 16;
export const EDGE_SAVE = 32;
export const EDGE_CONFIRM = 64;

const KEY_SET = (list) => new Set(list);

export function createInput(canvas) {
  const held = new Set();
  let edges = 0;
  let mouseX = 0;
  let mouseY = 0;
  let mouseDown = false;
  let mouseClicked = false;

  function codeOf(e) {
    return e.code;
  }

  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) {
      held.add(codeOf(e));
      return;
    }
    held.add(codeOf(e));
    if (e.code === KEYS.enterCar) edges |= EDGE_ENTER;
    else if (e.code === KEYS.reload) edges |= EDGE_RELOAD;
    else if (e.code === KEYS.pause) edges |= EDGE_PAUSE;
    else if (e.code === KEYS.mute) edges |= EDGE_MUTE;
    else if (e.code === KEYS.radio) edges |= EDGE_RADIO;
    else if (e.code === KEYS.save) edges |= EDGE_SAVE;
    else if (e.code === 'Enter' || e.code === 'Space') edges |= EDGE_CONFIRM;
  });
  window.addEventListener('keyup', (e) => held.delete(codeOf(e)));
  window.addEventListener('blur', () => {
    held.clear();
    mouseDown = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left;
    mouseY = e.clientY - r.top;
  });
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left;
    mouseY = e.clientY - r.top;
    mouseDown = true;
    mouseClicked = true;
    edges |= EDGE_CONFIRM;
  });
  window.addEventListener('pointerup', () => {
    mouseDown = false;
  });

  const upSet = KEY_SET(KEYS.up);
  const downSet = KEY_SET(KEYS.down);
  const leftSet = KEY_SET(KEYS.left);
  const rightSet = KEY_SET(KEYS.right);
  const runSet = new Set([KEYS.run, 'ShiftRight']);

  function any(set) {
    for (const k of set) if (held.has(k)) return true;
    return false;
  }

  return {
    axis() {
      return {
        x: (any(rightSet) ? 1 : 0) - (any(leftSet) ? 1 : 0),
        y: (any(downSet) ? 1 : 0) - (any(upSet) ? 1 : 0),
        run: any(runSet),
        up: any(upSet),
        down: any(downSet),
        left: any(leftSet),
        right: any(rightSet),
      };
    },
    takeEdges() {
      const t = edges;
      edges = 0;
      return t;
    },
    takeClick() {
      const c = mouseClicked;
      mouseClicked = false;
      return c;
    },
    mouse() {
      return { x: mouseX, y: mouseY, down: mouseDown };
    },
    // Test helper: pretend keys are held.
    _held: held,
  };
}
