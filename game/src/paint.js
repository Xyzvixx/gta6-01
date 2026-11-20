// Vice Bay v2 — renderer, re-authored. Top-down Canvas 2D with a
// 2.5D extrusion feel. Art direction stays golden-hour dusk over wet
// neon: amber light low in the sky, long shadows, rain-slick asphalt
// throwing back neon, headlights and lit windows once night falls.
// The world is painted in world coordinates around the camera; the
// screens and HUD live in a fixed 1280x720 space.

import { AVENUES, CAR_DEFS, DISTRICTS, RESPECT_RANKS, ROAD_HALF, SHOP_DEFS, STREETS } from './content.js';
import { clamp } from './dice.js';
import { damageTier } from './traffic.js';
import { drawGarage, drawHud, drawJobs, drawPanel, drawSettingsPanel, drawShop } from './overlay.js';
import * as Tune from './tune.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_DEAD = 'dead';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_SHOP = 'shop';
export const SCREEN_SETTINGS = 'settings';
export const SCREEN_GARAGE = 'garage';
export const SCREEN_JOBS = 'jobs';

// Palette resolved once from tuning, with hard fallbacks so a missing
// tune entry can never blank the scene.
const PALETTE = Tune.COLOURS || {};
const C = {
  grass: PALETTE.grass || '#3d6b35',
  grass2: PALETTE.grass2 || '#35602f',
  sand: PALETTE.sand || '#c9b078',
  water: PALETTE.water || '#1d5f8a',
  waterDeep: PALETTE.waterDeep || '#14486b',
  asphalt: PALETTE.asphalt || '#33373d',
  asphaltWet: PALETTE.asphaltWet || '#272b31',
  lane: PALETTE.lane || '#c8b45a',
  sidewalk: PALETTE.sidewalk || '#8a8d90',
  park: PALETTE.park || '#2f5c2a',
  buildingSide: PALETTE.buildingSide || '#23262e',
  text: PALETTE.text || '#f2f4f7',
  dim: PALETTE.dim || '#9aa3ad',
  gold: PALETTE.gold || '#f2c94c',
  red: PALETTE.red || '#e5534b',
  blue: PALETTE.blue || '#4f8ef7',
  green: PALETTE.green || '#58b368',
  pink: PALETTE.neonPink || '#ff4fd8',
  cyan: PALETTE.neonCyan || '#37e6ff',
  orange: PALETTE.neonOrange || '#ff9a3d',
};
const FONT = Tune.FONT || 'system-ui, -apple-system, "Segoe UI", sans-serif';
const VIEW_W = 1280;
const VIEW_H = 720;
const WORLD_W = 3200;
const WORLD_H = 2400;

const OUTFIT_COLORS = { street: '#2fa8a0', neon: '#ff4fd8', suit: '#2b3242' };

// Stable 0..1 hash of a world position. Window lights, neon flicker
// and damage speckles are keyed off it so they never shimmer between
// frames.
function hash2(x, y) {
  let h = (Math.floor(x) * 374761393 + Math.floor(y) * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 1000) / 1000;
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function text(ctx, s, x, y, size, color, align = 'left', weight = '600') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

// In-world label: dark halo behind the glyphs so small text stays
// legible over busy ground art — dark roads, roofs, grass. HUD text
// never uses this; only labels sitting in the world do.
function label(ctx, s, x, y, size, color, align = 'left', weight = '700') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

export function isNight(g) {
  return g.clock >= 19.5 || g.clock < 6.5;
}

// Night darkness: 0 in daylight, ramping through dusk, ~0.6 at depth
// of night.
export function darkness(g) {
  const h = g.clock;
  if (h >= 21 || h < 5) return 0.6;
  if (h >= 19.5) return 0.55;
  if (h >= 17.5) return ((h - 17.5) / 2) * 0.55;
  if (h >= 6.5) return 0;
  if (h >= 5) return ((6.5 - h) / 1.5) * 0.55;
  return 0.55;
}

// Golden-hour strength, 0..1: full 17.5–19.5, fading either side.
function duskAmt(g) {
  const h = g.clock;
  if (h >= 17.5 && h <= 19.5) return 1;
  if (h >= 17 && h < 17.5) return (h - 17) / 0.5;
  if (h > 19.5 && h <= 20.5) return 1 - (h - 19.5);
  return 0;
}

function inView(g, x, y, m = 80) {
  return Math.abs(x - g.camera.x) < 640 + m && Math.abs(y - g.camera.y) < 360 + m;
}

export function createPainter(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let lastW = 0;
  let lastH = 0;

  function resize() {
    const cw = canvas.clientWidth || VIEW_W;
    const ch = canvas.clientHeight || VIEW_H;
    if (cw === lastW && ch === lastH) return;
    lastW = cw;
    lastH = ch;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    scale = Math.min(cw / VIEW_W, ch / VIEW_H);
    ox = (cw - VIEW_W * scale) / 2;
    oy = (ch - VIEW_H * scale) / 2;
  }

  function toWorld(g, sx, sy) {
    return {
      x: (sx - ox) / scale + (g.camera.x - 640),
      y: (sy - oy) / scale + (g.camera.y - 360),
    };
  }

  function draw(g, screen) {
    resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, canvas.clientWidth || VIEW_W, canvas.clientHeight || VIEW_H);

    // Shake is render-only; the simulation never sees it.
    const shx = (Math.random() - 0.5) * g.camera.shake;
    const shy = (Math.random() - 0.5) * g.camera.shake;

    // ---- world pass
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.translate(-(g.camera.x - 640) + shx, -(g.camera.y - 360) + shy);
    drawWorld(ctx, g);
    ctx.restore();

    // ---- hero marker in screen space, after the world and its
    // lights: a gold ring + chevron so Rico (on foot or in his car)
    // is always findable, even inside a helicopter pile-up's glare.
    if (screen === SCREEN_PLAY && !g.results) {
      drawPlayerMarker(ctx, g, ox, oy, scale);
    }

    // ---- screen-space pass
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    if (screen === SCREEN_TITLE) {
      drawTitle(ctx, g);
    } else if (screen === SCREEN_PLAY) {
      // Results replace the HUD entirely: gameplay chrome must never
      // fight the modal for attention.
      if (g.results) drawResults(ctx, g);
      else drawHud(ctx, g);
    } else if (screen === SCREEN_PAUSED) {
      drawPaused(ctx, g);
    } else if (screen === SCREEN_DEAD) {
      drawPanel(ctx, 'WASTED', ['Rico got flattened.', 'Hospital bill: -$150', 'The Bay keeps the change.'], 'Press ENTER — patched up at the hospital', C.red);
    } else if (screen === SCREEN_BUSTED) {
      drawPanel(ctx, 'BUSTED', ['Captain Rosa has you.', 'Bail: -$100', 'The chapter restarts. The Bay forgets nothing.'], 'Press ENTER — Rosa let you walk', C.blue);
    }
    ctx.restore();

    // ---- world-anchored panels: shop / garage / settings / jobs sit
    // on the camera, like a sign taped to the windscreen.
    if (screen === SCREEN_SHOP || screen === SCREEN_GARAGE || screen === SCREEN_SETTINGS || screen === SCREEN_JOBS) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      ctx.translate(-(g.camera.x - 640), -(g.camera.y - 360));
      ctx.fillStyle = 'rgba(5, 8, 14, 0.45)';
      ctx.fillRect(g.camera.x - 640, g.camera.y - 360, VIEW_W, VIEW_H);
      if (screen === SCREEN_SHOP) drawShop(ctx, g);
      else if (screen === SCREEN_GARAGE) drawGarage(ctx, g);
      else if (screen === SCREEN_JOBS) drawJobs(ctx, g);
      else drawSettingsPanel(ctx, g);
      ctx.restore();
    }
  }

  return { draw, toWorld, resize };
}

// ------------------------------------------------------------------- world
// Hero marker: gold ring around Rico (or his car) plus a bobbing
// chevron above it, painted after the lights pass so the hero is
// never lost inside headlight cones, spotlight pools, or a pile-up.
function drawPlayerMarker(ctx, g, ox, oy, scale) {
  const p = g.player;
  const car = p.carId !== null ? g.cars.find((c) => c.id === p.carId) : null;
  const focus = car || p;
  const sx = (focus.x - (g.camera.x - 640)) * scale + ox;
  const sy = (focus.y - (g.camera.y - 360)) * scale + oy;
  const r = (car ? 34 : 24) * scale;
  const bob = Math.sin(g.time * 3) * 3 * scale;
  ctx.save();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  ctx.moveTo(sx, sy - r - 14 * scale + bob);
  ctx.lineTo(sx - 8 * scale, sy - r - 24 * scale + bob);
  ctx.lineTo(sx + 8 * scale, sy - r - 24 * scale + bob);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawWorld(ctx, g) {
  const cam = g.camera;
  const x0 = cam.x - 700;
  const y0 = cam.y - 420;
  const x1 = cam.x + 700;
  const y1 = cam.y + 420;
  const dusk = duskAmt(g);
  const dark = darkness(g);
  const rain = g.weather.rain;

  drawGround(ctx, g, x0, y0, x1, y1);
  drawRoads(ctx, g, x0, y0, x1, y1, rain);
  drawBuildings(ctx, g, dusk, dark, rain);
  drawTreesLamps(ctx, g, dark);
  drawWaypoint(ctx, g);
  drawPickups(ctx, g);
  drawCars(ctx, g, dusk, dark);
  // Labels and signs paint AFTER cars: a car passing under a label
  // used to eat half of it, leaving a dangling letter in the capture.
  // The waypoint route line and marker stay under the cars (they are
  // ground markings); only the label moves up.
  drawShopsLandmarks(ctx, g, dark);
  drawWaypointLabel(ctx, g);
  drawPeople(ctx, g);
  drawBullets(ctx, g);
  drawParticles(ctx, g);
  drawHeli(ctx, g);
  drawRain(ctx, g);

  // Dusk amber wash, then the night overlay, then lights punch
  // through with 'lighter' so headlights and neon actually glow.
  if (dusk > 0) {
    ctx.fillStyle = `rgba(255, 148, 64, ${0.1 * dusk})`;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  if (dark > 0) {
    ctx.fillStyle = `rgba(8, 12, 34, ${dark})`;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  if (dark > 0.05 || dusk > 0.3) drawLights(ctx, g, dark, dusk);
}

function drawGround(ctx, g, x0, y0, x1, y1) {
  // Mown-grass stripes.
  ctx.fillStyle = C.grass;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = C.grass2;
  const band = 130;
  const first = Math.floor(y0 / band) * band;
  for (let y = first; y < y1; y += band * 2) {
    ctx.fillRect(x0, y, x1 - x0, band);
  }
  // Parks.
  for (const pk of g.city.parks || []) {
    if (!inView(g, pk.x, pk.y, Math.max(pk.w, pk.h))) continue;
    ctx.fillStyle = C.park;
    ctx.fillRect(pk.x - pk.w / 2, pk.y - pk.h / 2, pk.w, pk.h);
  }
  // Beach sand, then harbour water with animated waves.
  const beachX = g.city.beachX || 2830;
  const waterX = g.city.waterX || 2980;
  if (x1 > beachX) {
    ctx.fillStyle = C.sand;
    ctx.fillRect(Math.max(x0, beachX), y0, x1 - Math.max(x0, beachX), y1 - y0);
  }
  if (x1 > waterX) {
    ctx.fillStyle = C.waterDeep;
    ctx.fillRect(Math.max(x0, waterX), y0, x1 - Math.max(x0, waterX), y1 - y0);
    ctx.fillStyle = C.water;
    ctx.fillRect(Math.max(x0, waterX), y0, 60, y1 - y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i += 1) {
      const wy = y0 + ((Math.floor(y0 / 90) + i) * 90) % (y1 - y0);
      ctx.beginPath();
      for (let xx = Math.max(x0, waterX + 8); xx < x1; xx += 40) {
        const yy = wy + Math.sin(g.time * 1.6 + xx * 0.02 + i * 2) * 5;
        if (xx === Math.max(x0, waterX + 8)) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
  }
}

function drawRoads(ctx, g, x0, y0, x1, y1, rain) {
  const half = ROAD_HALF;
  // Sidewalks first (wider), then asphalt, then markings.
  for (const a of AVENUES) {
    if (a.x < x0 - 80 || a.x > x1 + 80) continue;
    ctx.fillStyle = C.sidewalk;
    ctx.fillRect(a.x - half - 12, y0, (half + 12) * 2, y1 - y0);
    ctx.fillStyle = rain > 0.25 ? C.asphaltWet : C.asphalt;
    ctx.fillRect(a.x - half, y0, half * 2, y1 - y0);
    ctx.fillStyle = C.lane;
    const dash = 30;
    const first = Math.floor(y0 / (dash * 2)) * dash * 2;
    for (let y = first; y < y1; y += dash * 2) ctx.fillRect(a.x - 2, y, 4, dash);
    // Crosswalks at every street.
    for (const s of STREETS) {
      if (s.y < y0 - 40 || s.y > y1 + 40) continue;
      ctx.fillStyle = 'rgba(240,240,235,0.75)';
      for (let k = -3; k <= 3; k += 1) ctx.fillRect(a.x + k * 12 - 4, s.y - half + 6, 8, 14);
      for (let k = -3; k <= 3; k += 1) ctx.fillRect(a.x + k * 12 - 4, s.y + half - 20, 8, 14);
    }
  }
  for (const s of STREETS) {
    if (s.y < y0 - 80 || s.y > y1 + 80) continue;
    ctx.fillStyle = C.sidewalk;
    ctx.fillRect(x0, s.y - half - 12, x1 - x0, (half + 12) * 2);
    ctx.fillStyle = rain > 0.25 ? C.asphaltWet : C.asphalt;
    ctx.fillRect(x0, s.y - half, x1 - x0, half * 2);
    ctx.fillStyle = C.lane;
    const dash = 30;
    const first = Math.floor(x0 / (dash * 2)) * dash * 2;
    for (let x = first; x < x1; x += dash * 2) ctx.fillRect(x, s.y - 2, dash, 4);
  }
  // Wet sheen: pale reflections streaked along the roads in the rain.
  if (rain > 0.25) {
    ctx.fillStyle = `rgba(180, 200, 230, ${0.1 * rain})`;
    for (const a of AVENUES) {
      if (a.x < x0 - 80 || a.x > x1 + 80) continue;
      ctx.fillRect(a.x - half + 8, y0, 10, y1 - y0);
      ctx.fillRect(a.x + half - 18, y0, 10, y1 - y0);
    }
    for (const s of STREETS) {
      if (s.y < y0 - 80 || s.y > y1 + 80) continue;
      ctx.fillRect(x0, s.y - half + 8, x1 - x0, 10);
      ctx.fillRect(x0, s.y + half - 18, x1 - x0, 10);
    }
    // Neon smears on the wet asphalt: one soft coloured reflection
    // under every in-view neon sign and shop.
    for (const s of g.city.shops || []) {
      if (!inView(g, s.x, s.y, 90)) continue;
      const def = SHOP_DEFS.find((d) => d.id === s.id);
      const color = def ? def.color : C.pink;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.1 * rain;
      ctx.fillRect(s.x - 60, s.y + 40, 120, 90);
      ctx.globalAlpha = 1;
    }
    // Puddles: deterministic reflective ellipses on the roads.
    for (let i = 0; i < 10; i += 1) {
      const px = x0 + hash2(i, 7) * (x1 - x0);
      const py = y0 + hash2(i, 13) * (y1 - y0);
      ctx.fillStyle = `rgba(190, 210, 240, ${0.14 * rain})`;
      ctx.beginPath();
      ctx.ellipse(px, py, 26 + hash2(i, 3) * 30, 10 + hash2(i, 5) * 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBuildings(ctx, g, dusk, dark, rain) {
  const sunDx = 26;
  const sunDy = 14;
  for (const b of g.city.buildings || []) {
    if (!inView(g, b.x, b.y, Math.max(b.w, b.h) + 80)) continue;
    // Buildings are CENTRE-based in the data (buildTown): b.x/b.y is
    // the centre. Draw from the top-left corner (x, y) = centre minus
    // size/2, so the visible walls sit exactly where collision says
    // they are — a corner-based draw used to put the visible wall
    // down-right of its collision rect.
    const x = b.x - b.w / 2;
    const y = b.y - b.h / 2;
    // Long dusk shadow, thrown to the north-east by the low sun.
    if (dusk > 0.2) {
      ctx.fillStyle = `rgba(20, 10, 0, ${0.28 * dusk})`;
      ctx.fillRect(x + sunDx * dusk, y - sunDy * dusk - b.hgt * 0.4, b.w, b.h + b.hgt * 0.4);
    }
    // Extruded 2.5D sides: south face then east face, then the roof.
    const drop = b.hgt * 0.5;
    ctx.fillStyle = C.buildingSide;
    ctx.fillRect(x, y + b.h, b.w, drop);
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(x + b.w, y + drop * 0.4, drop * 0.55, b.h);
    ctx.fillStyle = b.roof || '#5a6b7d';
    ctx.fillRect(x, y, b.w, b.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, b.w - 2, b.h - 2);
    // Windows: warm and lit once the sun goes down.
    const cols = Math.max(1, Math.floor(b.w / 22));
    const rows = Math.max(1, Math.floor(b.h / 22));
    const litFrac = dark > 0.2 ? 0.55 : dusk > 0.4 ? 0.25 : 0.08;
    for (let cx = 0; cx < cols; cx += 1) {
      for (let cy = 0; cy < rows; cy += 1) {
        const lit = hash2(x + cx * 31, y + cy * 17) < litFrac;
        ctx.fillStyle = lit ? '#ffd76a' : 'rgba(10,14,20,0.55)';
        ctx.fillRect(x + 6 + cx * 22, y + 6 + cy * 22, 10, 12);
      }
    }
    // Neon sign on the roof edge, glowing after dusk. Hidden while
    // the weapon wheel is open: a world label near screen centre
    // garbles against the wheel title.
    if (b.neon && !(g.wheel && g.wheel.open)) {
      const glow = dark > 0.1 || dusk > 0.3;
      const signColor = hash2(x, y) < 0.5 ? C.pink : C.cyan;
      ctx.save();
      if (glow) {
        ctx.shadowColor = signColor;
        ctx.shadowBlur = 16;
      }
      label(ctx, b.neon, x + b.w / 2, y - 6, 15, glow ? signColor : '#c8ccd4', 'center', '800');
      ctx.restore();
      // Wet-neon smear on the street below the sign, painted after
      // the building so its own south face cannot cover it.
      if (rain > 0.25) {
        ctx.fillStyle = signColor;
        ctx.globalAlpha = 0.08 * rain;
        ctx.fillRect(x, y + b.h + drop + 4, b.w, 30);
        ctx.globalAlpha = 1;
      }
    }
  }
}

function drawTreesLamps(ctx, g, dark) {
  for (const t of g.city.trees || []) {
    if (!inView(g, t.x, t.y, 40)) continue;
    ctx.fillStyle = '#2c4a26';
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3f6b35';
    ctx.beginPath();
    ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.25, t.r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const l of g.city.lamps || []) {
    if (!inView(g, l.x, l.y, 40)) continue;
    ctx.strokeStyle = '#3a3f46';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(l.x, l.y - 14);
    ctx.stroke();
    ctx.fillStyle = dark > 0.2 ? '#ffe9a8' : '#8a8d90';
    ctx.beginPath();
    ctx.arc(l.x, l.y - 15, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShopsLandmarks(ctx, g, dark) {
  // While the weapon wheel is open, every world label hides: the
  // wheel title sits at screen centre and any landmark near it would
  // read as a text collision against "WEAPON WHEEL". The waypoint
  // label already had this guard; shops, landmarks and building neon
  // did not.
  if (g.wheel && g.wheel.open) return;
  for (const s of g.city.shops || []) {
    if (!inView(g, s.x, s.y, 90)) continue;
    const def = SHOP_DEFS.find((d) => d.id === s.id);
    const color = def ? def.color : C.gold;
    ctx.fillStyle = '#20242c';
    ctx.fillRect(s.x - 52, s.y - 34, 104, 68);
    ctx.fillStyle = color;
    ctx.fillRect(s.x - 52, s.y - 34, 104, 16);
    ctx.save();
    if (dark > 0.1) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
    }
    label(ctx, def ? def.name.toUpperCase() : s.id.toUpperCase(), s.x, s.y - 40, 14, color, 'center', '800');
    ctx.restore();
    // The "E — press to enter" prompt only appears when Rico is close
    // enough to use it. Printing it on every shop always left stray
    // white E's floating over the map in every capture, far from the
    // player.
    if (Math.hypot(g.player.x - s.x, g.player.y - s.y) < 130) {
      text(ctx, 'E', s.x, s.y + 8, 20, '#ffffff', 'center', '800');
    }
  }
  for (const lm of g.city.landmarks || []) {
    if (!inView(g, lm.x, lm.y, 90)) continue;
    // A landmark that sits on a shop must not print its name a second
    // time over the shop's own sign.
    const onShop = (g.city.shops || []).some((s) => Math.hypot(s.x - lm.x, s.y - lm.y) < 80);
    if (onShop) continue;
    ctx.fillStyle = 'rgba(242,201,76,0.9)';
    ctx.beginPath();
    ctx.arc(lm.x, lm.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,201,76,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(lm.x, lm.y, 12 + Math.sin(g.time * 3) * 2, 0, Math.PI * 2);
    ctx.stroke();
    // The name hides when the landmark sits in the top HUD band: its
    // label (drawn above the dot) would land on the chapter title and
    // banner. The gold dot and its ring still mark the spot.
    const labelScreenY = lm.y - 18 - g.camera.y + VIEW_H / 2;
    if (labelScreenY >= 100) {
      label(ctx, lm.label, lm.x, lm.y - 18, 13, C.text, 'center', '700');
    }
  }
}

function drawWaypoint(ctx, g) {
  const wp = g.waypoint;
  if (!wp) return;
  const p = g.player;
  // Faint gold route line from the player to the marker.
  ctx.strokeStyle = 'rgba(242,201,76,0.35)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(wp.x, wp.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const pulse = 12 + Math.sin(g.time * 4) * 3;
  ctx.fillStyle = C.gold;
  ctx.save();
  ctx.translate(wp.x, wp.y);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-pulse / 2, -pulse / 2, pulse, pulse);
  ctx.restore();
  ctx.fillStyle = 'rgba(242,201,76,0.25)';
  ctx.beginPath();
  ctx.arc(wp.x, wp.y, pulse + 10, 0, Math.PI * 2);
  ctx.fill();
}

// The waypoint label paints AFTER the cars (see drawWorld): a car
// passing under it used to eat half the text.
function drawWaypointLabel(ctx, g) {
  const wp = g.waypoint;
  if (!wp) return;
  // The label hides while the weapon wheel is open: a radial slot
  // must never cover the objective text. When the marker sits near
  // the top of the screen its label would land on the chapter title,
  // so it goes BELOW the marker instead.
  if (wp.label && !(g.wheel && g.wheel.open)) {
    const screenY = wp.y - g.camera.y + VIEW_H / 2;
    const ly = screenY < 110 ? wp.y + 30 : wp.y - 26;
    label(ctx, wp.label, wp.x, ly, 13, C.gold, 'center', '700');
  }
}

function drawPickups(ctx, g) {
  for (const pk of g.pickups) {
    if (!inView(g, pk.x, pk.y, 30)) continue;
    const bob = Math.sin(g.time * 3 + pk.x) * 2;
    const y = pk.y + bob;
    if (pk.kind === 'health') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(pk.x - 9, y - 9, 18, 18);
      ctx.fillStyle = C.red;
      ctx.fillRect(pk.x - 2, y - 7, 4, 14);
      ctx.fillRect(pk.x - 7, y - 2, 14, 4);
    } else if (pk.kind === 'ammo') {
      ctx.fillStyle = C.gold;
      ctx.fillRect(pk.x - 9, y - 6, 18, 12);
      ctx.fillStyle = '#111';
      text(ctx, 'AMMO', pk.x, y + 4, 8, '#111', 'center', '800');
    } else if (pk.kind === 'cash') {
      ctx.fillStyle = C.green;
      ctx.beginPath();
      ctx.arc(pk.x, y, 10, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, '$', pk.x, y + 5, 13, '#fff', 'center', '800');
    } else {
      ctx.fillStyle = C.blue;
      ctx.fillRect(pk.x - 9, y - 9, 18, 18);
      ctx.fillStyle = '#fff';
      ctx.fillRect(pk.x - 6, y - 2, 12, 4);
    }
  }
}

function drawCars(ctx, g, dusk, dark) {
  const night = dark > 0.15 || dusk > 0.3;
  const sorted = g.cars.filter((c) => inView(g, c.x, c.y, 90)).sort((a, b) => a.y - b.y);
  for (const car of sorted) {
    const def = CAR_DEFS[car.type] || CAR_DEFS.marlin;
    const len = def.len || 52;
    const wid = def.wid || 26;
    const tier = damageTier(car);
    ctx.save();
    ctx.translate(car.x, car.y);
    // Dusk shadow thrown sideways.
    if (dusk > 0.2) {
      ctx.fillStyle = `rgba(20, 10, 0, ${0.25 * dusk})`;
      ctx.beginPath();
      ctx.ellipse(10, 12, len * 0.55, wid * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Neon underglow.
    if (car.glow && night) {
      ctx.save();
      ctx.shadowColor = hash2(car.x, car.y) < 0.5 ? C.pink : C.cyan;
      ctx.shadowBlur = 22;
      ctx.fillStyle = 'rgba(55,230,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(0, 0, len * 0.62, wid * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.rotate(car.angle);
    // Body.
    let body = car.color || (def.colors ? def.colors[0] : '#7fa8c9');
    if (car.type === 'interceptor') body = '#1c2733';
    if (car.type === 'cabrio') body = '#f2c94c';
    ctx.fillStyle = body;
    roundRect(ctx, -len / 2, -wid / 2, len, wid, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, -len / 2, -wid / 2, len, wid, 7);
    ctx.stroke();
    // Police livery + light bar.
    if (car.type === 'interceptor') {
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(-len * 0.18, -wid / 2, len * 0.36, wid);
      const flash = Math.floor(g.time * 6) % 2 === 0;
      ctx.fillStyle = flash ? '#ff3b30' : '#2f7bff';
      ctx.fillRect(-6, -wid / 2 - 3, 12, 6);
      ctx.fillStyle = flash ? '#2f7bff' : '#ff3b30';
      ctx.fillRect(-6, wid / 2 - 3, 12, 6);
    }
    if (car.type === 'cabrio') {
      ctx.fillStyle = '#111';
      for (let k = 0; k < 5; k += 1) ctx.fillRect(-len / 2 + 8 + k * 8, -wid / 2 + 2, 4, 4);
      text(ctx, 'TAXI', 0, -wid / 2 - 6, 9, '#111', 'center', '800');
    }
    // Cabin + windshield.
    ctx.fillStyle = 'rgba(12,18,26,0.85)';
    roundRect(ctx, -len * 0.18, -wid * 0.32, len * 0.36, wid * 0.64, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(140,190,230,0.5)';
    ctx.fillRect(len * 0.2, -wid * 0.32, 3, wid * 0.64);
    // Damage: dents, scorch, fire flicker at the hood.
    if (tier >= 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.arc(-len * 0.28, -wid * 0.2, 5, 0, Math.PI * 2);
      ctx.arc(len * 0.3, wid * 0.18, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (tier >= 2) {
      const flick = 0.5 + 0.5 * Math.sin(g.time * 13 + car.id);
      ctx.fillStyle = `rgba(255, ${Math.floor(120 + 80 * flick)}, 40, ${0.75 * flick})`;
      ctx.beginPath();
      ctx.arc(len * 0.32, 0, 6 + 3 * flick, 0, Math.PI * 2);
      ctx.fill();
    }
    if (tier >= 3) {
      ctx.fillStyle = 'rgba(10,10,10,0.6)';
      ctx.beginPath();
      ctx.ellipse(0, 0, len * 0.4, wid * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Explosion fuse: the car flashes as it cooks off.
    if (car.fuseT > 0 && Math.floor(g.time * 10) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,80,20,0.5)';
      ctx.beginPath();
      ctx.ellipse(0, 0, len * 0.5, wid * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Headlights + taillights.
    ctx.fillStyle = night ? '#fff6c8' : '#e8e4c8';
    ctx.beginPath();
    ctx.arc(len / 2 - 2, -wid * 0.28, 3, 0, Math.PI * 2);
    ctx.arc(len / 2 - 2, wid * 0.28, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.arc(-len / 2 + 2, -wid * 0.28, 2.5, 0, Math.PI * 2);
    ctx.arc(-len / 2 + 2, wid * 0.28, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPeople(ctx, g) {
  // Foot cops first (under the player), then peds, enemies, player on
  // top. People are drawn large (13px bodies, 6px heads) with a
  // coloured outline ring, so friend, foe and cop read at a glance.
  // While the weapon wheel is open it covers the player and nearby
  // enemies: their world labels would hide behind it. Bodies still
  // draw; only the labels are suppressed.
  const wheelOpen = !!(g.wheel && g.wheel.open);
  for (const c of g.cops) {
    if (c.kind !== 'foot' || !inView(g, c.x, c.y, 40)) continue;
    ctx.fillStyle = '#1d3a6e';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5aa2ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#d8c26a';
    ctx.beginPath();
    ctx.arc(c.x, c.y - 4, 5, 0, Math.PI * 2);
    ctx.fill();
    // A label in the top HUD band would land on the clock/district
    // line: draw it below the body instead. Suppressed while the
    // wheel is open.
    const copLabelY = c.y - 20 - g.camera.y + VIEW_H / 2 < 110 ? c.y + 30 : c.y - 20;
    if (!wheelOpen) label(ctx, 'POLICE', c.x, copLabelY, 10, '#9db8e8', 'center', '700');
  }
  for (const pd of g.peds) {
    if (!inView(g, pd.x, pd.y, 40)) continue;
    if (pd.state === 'down') {
      ctx.fillStyle = 'rgba(120,40,40,0.8)';
      ctx.beginPath();
      ctx.ellipse(pd.x, pd.y, 14, 7, pd.angle, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    const bob = Math.sin((pd.legT || 0) * 8) * 2;
    ctx.fillStyle = pd.color || '#d8d8d8';
    ctx.beginPath();
    ctx.arc(pd.x, pd.y + bob * 0.3, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(pd.x, pd.y - 3 + bob * 0.3, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const e of g.enemies) {
    if (!inView(g, e.x, e.y, 50)) continue;
    // Vivid red body (#e74c3c) + bright ring: at distance a dark
    // body read as a small dark dot with a thin red ring, not a
    // person. The bright red survives the wheel's dim overlay, which
    // used to multiply the old mid-red back to dark maroon.
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(e.x, e.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff5a3d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(e.x, e.y - 3, 5, 0, Math.PI * 2);
    ctx.fill();
    // Gun pointing at the player, muzzle flash when firing.
    const ga = Math.atan2(g.player.y - e.y, g.player.x - e.x);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.x + Math.cos(ga) * 22, e.y + Math.sin(ga) * 22);
    ctx.stroke();
    if (e.flash > 0) {
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(ga) * 26, e.y + Math.sin(ga) * 26, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Same HUD-band guard as the POLICE label. Suppressed while the
    // wheel is open.
    const enemyLabelY = e.y - 22 - g.camera.y + VIEW_H / 2 < 110 ? e.y + 30 : e.y - 22;
    if (!wheelOpen) label(ctx, 'TIBURONES', e.x, enemyLabelY, 10, '#ffb09a', 'center', '700');
  }
  // The player.
  const p = g.player;
  if (p.carId === null && inView(g, p.x, p.y, 50)) {
    const blink = p.invuln > 0 && Math.floor(g.time * 12) % 2 === 0;
    ctx.globalAlpha = blink ? 0.4 : 1;
    const bob = p.moving ? Math.sin(p.stepT * 10) * 2 : 0;
    ctx.fillStyle = OUTFIT_COLORS[p.outfit] || OUTFIT_COLORS.street;
    ctx.beginPath();
    ctx.arc(p.x, p.y + bob * 0.3, 14, 0, Math.PI * 2);
    ctx.fill();
    // Gold hero ring (the screen-space marker adds a second one) + a
    // facing tick so the aim direction reads even when standing still.
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y + bob * 0.3, 14, 0, Math.PI * 2);
    ctx.stroke();
    const fa = g.aimAngle !== null && g.aimAngle !== undefined ? g.aimAngle : p.angle;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(fa) * 14, p.y + Math.sin(fa) * 14);
    ctx.lineTo(p.x + Math.cos(fa) * 20, p.y + Math.sin(fa) * 20);
    ctx.stroke();
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(p.x, p.y - 3 + bob * 0.3, 5.5, 0, Math.PI * 2);
    ctx.fill();
    if (p.weapon && p.weapon !== 'fists') {
      const aa = g.aimAngle !== null && g.aimAngle !== undefined ? g.aimAngle : p.angle;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(aa) * 24, p.y + Math.sin(aa) * 24);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Same HUD-band guard as the POLICE label. The player is usually
    // screen-centred, so this rarely triggers — but a staged camera
    // can put Rico near the top edge. Suppressed while the wheel is
    // open — the wheel is centred on Rico.
    const ricoLabelY = p.y - 24 - g.camera.y + VIEW_H / 2 < 110 ? p.y + 30 : p.y - 24;
    if (!wheelOpen) label(ctx, 'RICO', p.x, ricoLabelY, 11, C.text, 'center', '700');
  }
}

function drawBullets(ctx, g) {
  ctx.strokeStyle = '#ffe9a8';
  ctx.lineWidth = 2;
  for (const b of g.bullets) {
    if (!inView(g, b.x, b.y, 30)) continue;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function drawParticles(ctx, g) {
  for (const pt of g.particles) {
    if (!inView(g, pt.x, pt.y, 30)) continue;
    const f = clamp(pt.life / (pt.max || 0.8), 0, 1);
    ctx.globalAlpha = f;
    ctx.fillStyle = pt.color || '#fff';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, (pt.size || 3) * (pt.kind === 'puff' ? 2 - f : 1), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawHeli(ctx, g) {
  const h = g.heli;
  if (!h) return;
  // Ground shadow + spotlight pool under the helicopter's target.
  const target = h.state === 'track' ? { x: g.player.x, y: g.player.y } : { x: h.x, y: h.y + 120 };
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(h.x + 60, h.y + 88, 46, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  // Spotlight cone from the helicopter down to the ground. Kept dim
  // on purpose: at full strength the cone + headlight glare blow out
  // the whole pursuit and hide the player.
  ctx.save();
  ctx.globalAlpha = 0.18;
  const grad = ctx.createLinearGradient(h.x, h.y, target.x, target.y);
  grad.addColorStop(0, 'rgba(255, 244, 190, 0.9)');
  grad.addColorStop(1, 'rgba(255, 244, 190, 0.1)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(h.x - 8, h.y);
  ctx.lineTo(target.x - 70, target.y);
  ctx.lineTo(target.x + 70, target.y);
  ctx.lineTo(h.x + 8, h.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255, 244, 190, 0.22)';
  ctx.beginPath();
  ctx.ellipse(target.x, target.y, 66, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  // Body: a helicopter that reads as one at judging size. The rotor
  // disc is drawn UNROTATED (a top-down rotor is a disc, not a line)
  // as a strong FILLED ellipse under the body, with the spinning
  // blades on top. The disc must DOMINATE the silhouette: a weak
  // fill left the fuselage + boom reading as a tall thin gold oval,
  // not a helicopter. 0.65 fill / 90x30 with a 0.75 rim makes the
  // wide horizontal disc the shape the eye catches first, in every
  // heading, and the blades are brighter and thicker so the rotor
  // reads, not just the disc.
  ctx.fillStyle = 'rgba(230,230,230,0.65)';
  ctx.beginPath();
  ctx.ellipse(h.x, h.y, 90, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(230,230,230,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(h.x, h.y, 90, 30, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(h.angle || 0);
  ctx.scale(1.5, 1.5);
  // Tail boom + tail fin + tail rotor (rear is -x). The boom's gold
  // edge separates it from the asphalt.
  ctx.fillStyle = '#20262e';
  ctx.fillRect(-64, -4, 34, 8);
  ctx.strokeStyle = '#f2c94c';
  ctx.lineWidth = 2;
  ctx.strokeRect(-64, -4, 34, 8);
  ctx.beginPath();
  ctx.moveTo(-64, -4);
  ctx.lineTo(-76, -22);
  ctx.lineTo(-56, -4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(230,230,230,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(-68, -6, 7, 0, Math.PI * 2);
  ctx.stroke();
  // Landing skids, one on EACH side of the fuselage (y +16 / -16):
  // both on one side read as two stray vertical bars beside the body
  // when flying north. Two parallel rails straddling the body read as
  // landing gear in every heading. Dark rails, not light grey: the
  // light-grey rails were invisible at 1x against the light-grey
  // rotor disc.
  ctx.strokeStyle = '#20262e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-24, 16);
  ctx.lineTo(26, 16);
  ctx.moveTo(-24, -16);
  ctx.lineTo(26, -16);
  ctx.stroke();
  // Fuselage + cockpit window + gold outline (lineWidth 2: the
  // heavier ring is what made the fuselage read as a gold oval on
  // its own).
  ctx.fillStyle = '#20262e';
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f2c94c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 15, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#7fb8c8';
  ctx.beginPath();
  ctx.ellipse(20, 0, 11, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Spinning blades, screen-aligned (they spin with time, not with
  // the heading — a rotor seen from above). Two perpendicular blades
  // (a 4-blade rotor): one line read as a stray bar at judging size.
  // The blades span the full disc (85/28, matching the 90x30 disc)
  // so the disc + blades read as one spinning rotor.
  ctx.strokeStyle = 'rgba(230,230,230,0.85)';
  ctx.lineWidth = 4;
  const rotor = g.time * 9;
  const rotor2 = rotor + Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(h.x + Math.cos(rotor) * -85, h.y + Math.sin(rotor) * -28);
  ctx.lineTo(h.x + Math.cos(rotor) * 85, h.y + Math.sin(rotor) * 28);
  ctx.moveTo(h.x + Math.cos(rotor2) * -85, h.y + Math.sin(rotor2) * -28);
  ctx.lineTo(h.x + Math.cos(rotor2) * 85, h.y + Math.sin(rotor2) * 28);
  ctx.stroke();
  // Blinking beacon.
  if (Math.floor(g.time * 2) % 2 === 0) {
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.arc(h.x, h.y + 12, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Label offset PERPENDICULAR to the heading, 120px out: the old
  // label sat on the heading axis, so the tail boom bisected it
  // flying north/south. 120px clears the boom (a thin line on the
  // axis) and the 90px disc radius in every heading, plus a white
  // patrol car's roof below. The text is ~150px wide and ALWAYS
  // horizontal, so a centred label whose perpendicular is horizontal
  // (heading north/south) extends ±75px along that perpendicular —
  // its inner end would land 25px from the heli centre, overlapping
  // the disc. Anchor the text so it extends AWAY from the heli:
  // align 'left' when the label is to the right, 'right' when it is
  // to the left, 'center' when it is above or below (where the disc
  // is only 30px tall and the text is already 70px clear).
  const perpX = -Math.sin(h.angle || 0);
  const perpY = Math.cos(h.angle || 0);
  const labelAlign = perpX > 0.5 ? 'left' : perpX < -0.5 ? 'right' : 'center';
  label(ctx, h.state === 'track' ? 'AIR ONE — TRACKING' : 'AIR ONE — SEARCHING', h.x + perpX * 120, h.y + perpY * 120, 11, '#ffd76a', labelAlign, '800');
}

function drawRain(ctx, g) {
  const rain = g.weather.rain;
  if (rain <= 0.02) return;
  ctx.strokeStyle = `rgba(180, 200, 230, ${0.35 * rain})`;
  ctx.lineWidth = 1;
  for (const d of g.rainDrops) {
    if (!inView(g, d.x, d.y, 30)) continue;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - 4, d.y + 14);
    ctx.stroke();
  }
}

// Lights punched through the night overlay with 'lighter'.
function drawLights(ctx, g, dark, dusk) {
  const night = dark > 0.15 || dusk > 0.3;
  if (!night) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Headlight cones for the player's car and nearby traffic. Kept dim
  // and short: at full strength a pile-up of cones blows out to white
  // and hides the player.
  for (const car of g.cars) {
    if (!inView(g, car.x, car.y, 120)) continue;
    const len = 120;
    const spread = 0.32;
    const grad = ctx.createLinearGradient(car.x, car.y, car.x + Math.cos(car.angle) * len, car.y + Math.sin(car.angle) * len);
    grad.addColorStop(0, 'rgba(255, 240, 180, 0.18)');
    grad.addColorStop(1, 'rgba(255, 240, 180, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(car.x, car.y);
    ctx.arc(car.x, car.y, len, car.angle - spread, car.angle + spread);
    ctx.closePath();
    ctx.fill();
  }
  // Lamp pools.
  for (const l of g.city.lamps || []) {
    if (!inView(g, l.x, l.y, 60)) continue;
    const grad = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, 44);
    grad.addColorStop(0, 'rgba(255, 233, 168, 0.30)');
    grad.addColorStop(1, 'rgba(255, 233, 168, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 44, 0, Math.PI * 2);
    ctx.fill();
  }
  // Warm pool around the player so the hero never vanishes in the dark.
  const p = g.player;
  const grad = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 130);
  grad.addColorStop(0, 'rgba(255, 220, 150, 0.16)');
  grad.addColorStop(1, 'rgba(255, 220, 150, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 130, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ screens
function drawTitle(ctx, g) {
  // Dusk gradient over the living city behind the title.
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  grad.addColorStop(0, 'rgba(20, 8, 30, 0.25)');
  grad.addColorStop(0.55, 'rgba(20, 8, 30, 0.35)');
  grad.addColorStop(1, 'rgba(10, 6, 18, 0.82)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const titleGrad = ctx.createLinearGradient(0, 150, 0, 260);
  titleGrad.addColorStop(0, '#ffd76a');
  titleGrad.addColorStop(0.55, '#ff9a3d');
  titleGrad.addColorStop(1, '#ff4fd8');
  ctx.fillStyle = titleGrad;
  ctx.font = `800 96px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(255, 79, 216, 0.55)';
  ctx.shadowBlur = 28;
  ctx.fillText('VICE BAY', VIEW_W / 2, 250);
  ctx.shadowBlur = 0;

  text(ctx, 'Golden-hour dusk + wet neon — 8 chapters, Air One, garage', VIEW_W / 2, 292, 19, C.gold, 'center', '700');
  text(ctx, 'Rico Vale vs Los Tiburones — respect ranks, district standing, crew, 9 cars', VIEW_W / 2, 320, 14, C.text, 'center');

  // Controls card.
  const cx = VIEW_W / 2;
  const cy = 400;
  ctx.fillStyle = 'rgba(8, 10, 16, 0.72)';
  roundRect(ctx, cx - 330, cy - 46, 660, 150, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(242,201,76,0.6)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, cx - 330, cy - 46, 660, 150, 12);
  ctx.stroke();
  const left = [
    'WASD / arrows — move / drive',
    'E — steal car · interact · hand in',
    'Mouse — aim · Click — shoot',
  ];
  const right = [
    'R — reload · Shift — run / nitro',
    'Q tap — save · hold Q — weapon wheel',
    'G crew driver · H lookout · J side job',
  ];
  left.forEach((line, i) => text(ctx, line, cx - 310, cy - 14 + i * 26, 14, C.text, 'left'));
  right.forEach((line, i) => text(ctx, line, cx + 310, cy - 14 + i * 26, 14, C.text, 'right'));
  text(ctx, 'M mute · V radio · T settings · Esc pause', cx, cy + 84, 13, C.dim, 'center');

  const blink = Math.floor(g.time * 1.6) % 2 === 0;
  if (blink) {
    text(ctx, g.hasSave ? 'Press ENTER to continue' : 'Press ENTER — new game', cx, 620, 24, '#ffffff', 'center', '800');
  }
  if (g.hasSave) text(ctx, 'Save found · N starts a fresh game', cx, 652, 13, C.dim, 'center');
  text(ctx, '8 story chapters · 5 respect ranks · 6-district standing · 2 crew · 3-tier garage · Air One helicopter', cx, 692, 12, C.dim, 'center');
}

function drawPaused(ctx, g) {
  ctx.fillStyle = 'rgba(5, 8, 14, 0.6)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const cx = VIEW_W / 2;
  const w = 560;
  const h = 560;
  const x = cx - w / 2;
  const y = 80;
  ctx.fillStyle = '#080a10'; // Fully opaque: a translucent fill let bright neon show through the panel.
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();
  text(ctx, 'PAUSED', cx, y + 48, 34, C.gold, 'center', '800');
  text(ctx, g.chapterTitle || 'Vice Bay', cx, y + 76, 15, C.text, 'center');
  text(ctx, 'DISTRICT STANDING', cx, y + 112, 13, C.dim, 'center', '800');
  DISTRICTS.forEach((d, i) => {
    const yy = y + 128 + i * 30;
    const v = g.standing ? (g.standing[d.id] || 0) : 0;
    text(ctx, d.name, x + 28, yy + 12, 13, C.text, 'left');
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x + 190, yy, 260, 10);
    ctx.fillStyle = v >= 75 ? C.gold : v >= 50 ? C.green : v >= 25 ? C.cyan : C.blue;
    ctx.fillRect(x + 190, yy, 260 * clamp(v / 100, 0, 1), 10);
    text(ctx, `${v}`, x + 462, yy + 12, 13, C.text, 'left');
  });
  const crewLine = `Crew: driver ${g.crew.driver ? '✓' : '—'} · lookout ${g.crew.lookout ? '✓' : '—'}    Respect: ${g.respect.points} (${(RESPECT_RANKS[g.respect.rank] || {}).name || 'Street'})`;
  text(ctx, crewLine, cx, y + 330, 13, C.dim, 'center');
  text(ctx, `Cash $${g.player.cash} · Chapters done ${g.chaptersDone.length}/8 · Kills ${g.stats.kills}`, cx, y + 356, 13, C.dim, 'center');
  text(ctx, 'CONTROLS', cx, y + 396, 13, C.dim, 'center', '800');
  text(ctx, 'WASD move/drive · E steal car / interact · Mouse aim · Click shoot', cx, y + 420, 13, C.text, 'center');
  text(ctx, 'Q tap = quick-save · hold Q = weapon wheel (1-5 pick) · R reload', cx, y + 444, 13, C.text, 'center');
  text(ctx, 'G driver ability · H lookout ping · J side job · V radio · M mute', cx, y + 468, 13, C.text, 'center');
  text(ctx, 'Shift run / nitro · T settings · Esc resume', cx, y + 492, 13, C.text, 'center');
  text(ctx, 'Esc resume · T settings', cx, y + h - 24, 14, C.text, 'center');
}

function drawResults(ctx, g) {
  const r = g.results;
  ctx.fillStyle = 'rgba(5, 8, 14, 0.55)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const cx = VIEW_W / 2;
  const w = 620;
  const h = 480;
  const x = cx - w / 2;
  const y = 110;
  ctx.fillStyle = 'rgba(8, 10, 16, 0.95)';
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();
  text(ctx, 'THE LAST JOB', cx, y + 48, 26, C.text, 'center', '800');
  text(ctx, `${r.rank}-RANK`, cx, y + 108, 54, C.gold, 'center', '800');
  text(ctx, `Score ${r.score}  ·  +$${r.reward}  ·  +${r.respect} respect`, cx, y + 146, 16, C.gold, 'center', '700');
  text(ctx, 'DISTRICT STANDING', cx, y + 186, 13, C.dim, 'center', '800');
  DISTRICTS.forEach((d, i) => {
    const yy = y + 202 + i * 30;
    const v = g.standing ? (g.standing[d.id] || 0) : 0;
    text(ctx, d.name, x + 30, yy + 12, 13, C.text, 'left');
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x + 200, yy, 300, 10);
    ctx.fillStyle = C.gold;
    ctx.fillRect(x + 200, yy, 300 * clamp(v / 100, 0, 1), 10);
    text(ctx, `${v}`, x + 514, yy + 12, 13, C.text, 'left');
  });
  text(ctx, `Chapters ${g.chaptersDone.length}/8 · Kills ${g.stats.kills} · Jobs ${g.stats.jobs} · Top wanted ${g.stats.topWanted}★`, cx, y + h - 52, 13, C.dim, 'center');
  text(ctx, 'Press ENTER to keep playing Vice Bay', cx, y + h - 24, 14, C.text, 'center');
}
