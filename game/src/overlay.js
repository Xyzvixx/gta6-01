// Vice Bay v2 — HUD, minimap, panels, and the shop / garage / settings
// screens. Every draw call here runs inside a transform the caller has
// already set up: drawHud / drawMinimap / drawPanel assume a 1280x720
// screen transform, while drawShop / drawGarage / drawSettingsPanel
// assume a world transform and centre their panel on the camera, so the
// panel lands in the middle of the screen wherever the player stands.

import { AVENUES, CAR_DEFS, DISTRICTS, GUN_DEFS, JOB_DEFS, RESPECT_RANKS, ROAD_HALF, SHOP_DEFS, STREETS, WEAPON_ORDER } from './content.js';
import { clamp } from './dice.js';
import { chapterText, garageDiscount, garagePrice, respectRank } from './story.js';
import { damageTier } from './traffic.js';
import { magOf, wheelLockReason } from './fight.js';
import * as Tune from './tune.js';

const PALETTE = Tune.COLOURS || {};
const C = {
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

// --- tiny drawing primitives -------------------------------------------

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

function bar(ctx, x, y, w, h, frac, color, bg = 'rgba(0,0,0,0.55)') {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  const f = clamp(frac, 0, 1);
  if (f > 0) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * f, h);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function fmtClock(hour) {
  const whole = Math.floor(hour);
  const h = whole % 24;
  const m = Math.floor((hour - whole) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// --- map lookups ---------------------------------------------------------

export function districtAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d;
  }
  return null;
}

export function districtNameAt(x, y) {
  const d = districtAt(x, y);
  return d ? d.name : 'Vice Bay';
}

function nearestNamed(list, coord, getCoord) {
  let best = null;
  let bestDist = Infinity;
  for (const item of list) {
    const d = Math.abs(coord - getCoord(item));
    if (d < bestDist) { bestDist = d; best = item; }
  }
  return { best, bestDist };
}

function streetNameAt(x, y) {
  const avenue = nearestNamed(AVENUES, x, (a) => a.x);
  const street = nearestNamed(STREETS, y, (s) => s.y);
  const nearRoad = ROAD_HALF + 30;
  if (avenue.bestDist < nearRoad && street.bestDist < nearRoad) {
    return `${avenue.best.name} & ${street.best.name}`;
  }
  return avenue.bestDist < street.bestDist ? avenue.best.name : street.best.name;
}

// The price a player actually pays: the shop's list price, less the
// Kingpin (rank 3+) 20% discount, less a standing discount in the
// district the player is standing in (up to 20% off, floor 0.8x).
// engine.js imports this so the till and the price tag can never disagree.
export function shopPrice(g, base) {
  let factor = 1;
  try {
    factor -= garageDiscount(g) || 0;
  } catch {
    factor = 1;
  }
  const d = districtAt(g.player.x, g.player.y);
  const standing = d && g.standing ? (g.standing[d.id] || 0) : 0;
  factor *= Math.max(0.8, 1 - standing / 500);
  return Math.max(1, Math.round(base * factor));
}

function playerCar(g) {
  if (g.player.carId === null) return null;
  return g.cars.find((c) => c.id === g.player.carId) || null;
}

function ownedCarNear(g) {
  const p = g.player;
  const current = playerCar(g);
  if (current && current.ownedBy === 'player') return current;
  let best = null;
  let bestD = Infinity;
  for (const c of g.cars) {
    if (c.ownedBy !== 'player' || c.dead) continue;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    // Nearest wins; on a tie the most recently acquired car wins, so
    // the panel shows the same car the garage services (engine.js
    // ownedCarNearDex uses the same rule).
    if (d < bestD - 1 || (Math.abs(d - bestD) <= 1 && (!best || c.id > best.id))) { bestD = d; best = c; }
  }
  return bestD < 220 ? best : current;
}

// ---------------------------------------------------------------- minimap
// Local zoom, not world scale: 1800 world units across the 184px disc
// (900 units of radius), so roads read as roads and the waypoint is a
// real target instead of a 2px smear. A target outside the disc gets a
// gold edge arrow pointing at it.
export function drawMinimap(ctx, g) {
  const R = 92;
  const cx = VIEW_W - 112;
  const cy = VIEW_H - 112;
  const scale = (R * 2) / 1800;
  const p = g.player;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(10, 16, 24, 0.92)';
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  const mx = (x) => cx + (x - p.x) * scale;
  const my = (y) => cy + (y - p.y) * scale;

  // Water on the east edge, with its beach strip in front of it.
  const waterX = (g.city && g.city.waterX) || 2980;
  const beachX = (g.city && g.city.beachX) || 2830;
  ctx.fillStyle = '#1d5f8a';
  ctx.fillRect(mx(waterX), cy - R, R * 2, R * 2);
  ctx.fillStyle = '#8a7a52';
  ctx.fillRect(mx(beachX), cy - R, (waterX - beachX) * scale, R * 2);

  // Roads.
  ctx.strokeStyle = 'rgba(200, 205, 215, 0.55)';
  ctx.lineWidth = 2.5;
  for (const a of AVENUES) {
    ctx.beginPath();
    ctx.moveTo(mx(a.x), cy - R);
    ctx.lineTo(mx(a.x), cy + R);
    ctx.stroke();
  }
  for (const s of STREETS) {
    ctx.beginPath();
    ctx.moveTo(cx - R, my(s.y));
    ctx.lineTo(cx + R, my(s.y));
    ctx.stroke();
  }

  // Waypoint: a pulsing diamond when on the disc, a gold edge arrow
  // pointing at it when it is further away.
  if (g.waypoint) {
    const wx = mx(g.waypoint.x);
    const wy = my(g.waypoint.y);
    const dx = wx - cx;
    const dy = wy - cy;
    const dist = Math.hypot(dx, dy);
    const pulse = 1 + 0.25 * Math.sin(g.time * 5);
    if (dist <= R - 10) {
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(wx, wy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.moveTo(wx, wy - 8 * pulse);
      ctx.lineTo(wx + 7 * pulse, wy);
      ctx.lineTo(wx, wy + 8 * pulse);
      ctx.lineTo(wx - 7 * pulse, wy);
      ctx.closePath();
      ctx.fill();
    } else {
      const ang = Math.atan2(dy, dx);
      const ex = cx + Math.cos(ang) * (R - 12);
      const ey = cy + Math.sin(ang) * (R - 12);
      ctx.fillStyle = C.gold;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, -6);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Roadblock warning (a lookout ping flashes it gold).
  if (g.roadblock) {
    const flashing = g.crew && g.crew.pingT > 0 && Math.floor(g.time * 4) % 2 === 0;
    ctx.fillStyle = flashing ? C.gold : C.red;
    ctx.beginPath();
    ctx.arc(mx(g.roadblock.x), my(g.roadblock.y), 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pickups.
  for (const pk of g.pickups) {
    ctx.fillStyle = pk.kind === 'health' ? '#ffffff' : pk.kind === 'cash' ? C.green : C.cyan;
    ctx.fillRect(mx(pk.x) - 2, my(pk.y) - 2, 4, 4);
  }

  // Enemies.
  for (const e of g.enemies) {
    ctx.fillStyle = '#ff7a3d';
    ctx.beginPath();
    ctx.arc(mx(e.x), my(e.y), 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cops: the lookout crew member marks every cop on the map; without
  // them only nearby cops show up.
  const lookout = g.crew && g.crew.lookout;
  for (const c of g.cops) {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (!lookout && d > 700) continue;
    ctx.fillStyle = c.kind === 'car' ? '#5aa2ff' : '#ff5a5a';
    ctx.beginPath();
    ctx.arc(mx(c.x), my(c.y), c.kind === 'car' ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (lookout && g.crew.pingT > 0) {
    ctx.strokeStyle = `rgba(242, 201, 76, ${0.4 + 0.4 * Math.sin(g.time * 6)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Helicopter: a magenta rotor cross, impossible to miss.
  if (g.heli) {
    const hx = mx(g.heli.x);
    const hy = my(g.heli.y);
    ctx.strokeStyle = '#ff4fd8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(hx - 7, hy);
    ctx.lineTo(hx + 7, hy);
    ctx.moveTo(hx, hy - 7);
    ctx.lineTo(hx, hy + 7);
    ctx.stroke();
    ctx.fillStyle = '#ff4fd8';
    ctx.beginPath();
    ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player arrow, always centred.
  ctx.fillStyle = '#ffffff';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.angle);
  ctx.beginPath();
  ctx.moveTo(9, 0);
  ctx.lineTo(-6, -6);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  text(ctx, 'N', cx + R - 8, cy - R + 16, 12, C.dim, 'center', '700');
}

// Kill-counter flash: the objective banner flashes gold for a beat on
// every kill, so (0/3) → (1/3) reads as progress, not a static label.
let lastKills = 0;
let killFlashUntil = 0;

function killFlash(g) {
  if (g.stats.kills < lastKills) lastKills = g.stats.kills;
  if (g.stats.kills > lastKills) {
    lastKills = g.stats.kills;
    killFlashUntil = g.time + 0.6;
  }
  return g.time < killFlashUntil;
}

// --------------------------------------------------------------------- HUD
export function drawHud(ctx, g) {
  const p = g.player;

  // Top-left: wanted stars, clock + district, street.
  const level = g.wanted.level;
  for (let i = 0; i < 5; i += 1) {
    text(ctx, i < level ? '★' : '☆', 22 + i * 26, 36, 24, i < level ? C.gold : 'rgba(255,255,255,0.35)', 'left', '700');
  }
  text(ctx, `${fmtClock(g.clock)}  ·  ${districtNameAt(p.x, p.y)}`, 22, 62, 15, C.text);
  text(ctx, streetNameAt(p.x, p.y), 22, 82, 13, C.dim);
  if (g.weather.rain > 0.25) text(ctx, '☂ rain — wet roads', 22, 102, 13, C.cyan);

  // Top-right: cash + respect rank + progress bar to the next rank.
  const rank = respectRank(g);
  const rankDef = RESPECT_RANKS[rank] || RESPECT_RANKS[0];
  const nextDef = RESPECT_RANKS[rank + 1] || null;
  text(ctx, `$${p.cash}`, VIEW_W - 22, 36, 26, C.gold, 'right', '800');
  text(ctx, `${rankDef.name}  ·  ${g.respect.points} respect`, VIEW_W - 22, 60, 13, C.text, 'right');
  if (nextDef) {
    const span = nextDef.points - rankDef.points;
    const done = span > 0 ? (g.respect.points - rankDef.points) / span : 1;
    bar(ctx, VIEW_W - 202, 68, 180, 5, done, C.gold);
    text(ctx, `next: ${nextDef.name} (${nextDef.points})`, VIEW_W - 22, 88, 11, C.dim, 'right');
  } else {
    bar(ctx, VIEW_W - 202, 68, 180, 5, 1, C.gold);
    text(ctx, 'LEGEND — max rank', VIEW_W - 22, 88, 11, C.gold, 'right');
  }

  // Top-centre: chapter title + mission banner + distance. A kill
  // objective flashes gold on every kill (see killFlash above).
  if (g.chapterTitle) text(ctx, g.chapterTitle, VIEW_W / 2, 34, 16, C.gold, 'center', '800');
  let banner = '';
  try {
    banner = chapterText(g) || '';
  } catch {
    banner = '';
  }
  if (banner) {
    const flashing = killFlash(g);
    text(ctx, banner, VIEW_W / 2, 58, flashing ? 17 : 15, flashing ? C.gold : C.text, 'center', flashing ? '800' : '600');
    if (g.waypoint) {
      const d = Math.round(Math.hypot(g.waypoint.x - p.x, g.waypoint.y - p.y));
      text(ctx, `${d}m → ${g.waypoint.label || 'target'}`, VIEW_W / 2, 78, 13, C.gold, 'center');
    }
  }

  // Bottom-left: health / armor, weapon + ammo, outfit, radio.
  bar(ctx, 22, VIEW_H - 58, 190, 12, p.hp / 100, p.hp > 30 ? C.green : C.red);
  text(ctx, `HP ${Math.ceil(p.hp)}`, 218, VIEW_H - 47, 13, C.text);
  bar(ctx, 22, VIEW_H - 40, 190, 8, p.armor / 100, C.blue);
  text(ctx, `ARMOR ${Math.ceil(p.armor)}`, 218, VIEW_H - 32, 13, C.dim);
  const gun = GUN_DEFS[p.weapon] || GUN_DEFS.pistol;
  const reserve = p.ammo[p.weapon];
  const ammoText = gun.mag === Infinity ? '—' : `${magOf(p, p.weapon)} / ${reserve === undefined ? '—' : reserve}`;
  text(ctx, `${gun.label}  ·  ${ammoText}`, 22, VIEW_H - 78, 15, C.text);
  text(ctx, `Outfit: ${p.outfit}`, 22, VIEW_H - 96, 12, C.dim);
  if (g.audio) {
    try {
      // No ♪ glyph: its left bearing was clipped by the viewport edge.
      // Hidden at 4-5 stars: the heli frame is the busiest in the game
      // and the radio is the one non-essential line.
      if (g.wanted.level < 4) text(ctx, `Radio: ${g.audio.stationName()}  (V to change)`, 24, VIEW_H - 114, 12, C.dim);
    } catch {
      // audio not ready yet; skip the station line
    }
  }

  // Bottom-right, LEFT of the minimap: speed + car damage when driving.
  // The cluster's right edge is x=1000; the minimap's left edge is
  // 1076, so nothing can touch the ring or run off the right edge. The
  // stack is laid out with clear gaps: ENG -72, bar -64..-57, speed -36,
  // CAR text -16 — nothing overlaps.
  const car = playerCar(g);
  if (car) {
    const tier = damageTier(car);
    const tierName = ['OK', 'Dented', 'Smoking', 'Burning'][tier] || 'OK';
    const kmh = Math.round(Math.abs(car.speed) * 0.36);
    text(ctx, `${kmh} km/h`, 1000, VIEW_H - 36, 20, C.text, 'right', '800');
    bar(ctx, 880, VIEW_H - 64, 120, 7, car.hp / (car.maxHp || 100), tier >= 2 ? C.red : C.green);
    text(ctx, `CAR ${Math.ceil(car.hp)} · ${tierName}`, 1000, VIEW_H - 16, 12, tier >= 2 ? C.red : C.dim, 'right');
    if (car.upgrades && (car.upgrades.engine || car.upgrades.armor || car.upgrades.nitro)) {
      text(ctx, `ENG ${car.upgrades.engine} · ARM ${car.upgrades.armor} · NIT ${car.upgrades.nitro}`, 1000, VIEW_H - 72, 12, C.gold, 'right');
    }
  }

  // Crew status chips.
  let chipY = 118;
  if (g.crew && g.crew.driver) {
    const cd = Math.ceil(g.crew.driverCd || 0);
    const active = g.crew.active && g.crew.active.kind === 'driver';
    text(ctx, active ? '◈ DRIVER: getaway live' : cd > 0 ? `◈ DRIVER (G) — ${cd}s` : '◈ DRIVER (G) — ready', 22, chipY, 13, active ? C.gold : C.dim);
    chipY += 20;
  }
  if (g.crew && g.crew.lookout) {
    const cd = Math.ceil(g.crew.lookoutCd || 0);
    const active = g.crew.active && g.crew.active.kind === 'lookout';
    text(ctx, active ? '◈ LOOKOUT: eyes on the Bay' : cd > 0 ? `◈ LOOKOUT (H) — ${cd}s` : '◈ LOOKOUT (H) — ready', 22, chipY, 13, active ? C.gold : C.dim);
    chipY += 20;
  }

  // Toasts, newest last, fading out after a few seconds.
  let toastY = 108;
  for (const m of g.messages.slice(-4)) {
    const age = g.time - m.t;
    if (age > 5) continue;
    ctx.globalAlpha = age > 4 ? Math.max(0, 5 - age) : 1;
    const w = ctx.measureText(m.text).width + 24;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(VIEW_W / 2 - w / 2 - 12, toastY - 16, w + 24, 24);
    text(ctx, m.text, VIEW_W / 2, toastY, 13, C.text, 'center');
    ctx.globalAlpha = 1;
    toastY += 28;
  }

  // First-60-seconds contextual prompt bar: the core verbs (E, V, Q)
  // are taught in context, not buried in a menu. Near a car on foot
  // the bar says to steal it; in a car it teaches driving; under heat
  // it teaches escape; otherwise the control strip shows.
  if (g.time < 60) {
    // The hint is centred at the bottom, and the car-status cluster
    // (CAR + speed) sits at the bottom right from x≈880 — so every hint
    // that can show while Rico is IN a car is kept short enough to end
    // well left of it.
    let hint = 'WASD move · E steal car / interact · Mouse aim · Click shoot · Q tap = save, hold = weapon wheel · J side job · G/H crew';
    if (g.wanted.level > 0) {
      hint = 'WANTED — break line of sight or reach the gold marker · Q tap = save';
    } else if (p.carId !== null) {
      // No '· V radio' here: the radio line already sits in the
      // bottom-left HUD, and the shorter hint stays clear of the
      // car-status cluster.
      hint = 'WASD drive · Shift nitro · E leave car · Q tap = save, hold = wheel';
    } else {
      const nearCar = g.cars.some((c) => !c.dead && Math.hypot(c.x - p.x, c.y - p.y) < 90);
      if (nearCar) hint = 'Press E to steal the car · WASD move · Mouse aim · Click shoot · Q tap = save';
    }
    text(ctx, hint, VIEW_W / 2, VIEW_H - 14, 13, C.dim, 'center');
  }

  drawMinimap(ctx, g);

  // Weapon wheel (radial, hold Q).
  if (g.wheel && g.wheel.open) drawWheel(ctx, g);
}

function drawWheel(ctx, g) {
  const p = g.player;
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  // All five slots, in wheel order — locked weapons show greyed out
  // with their unlock condition instead of vanishing silently.
  const slots = WEAPON_ORDER.filter((w) => GUN_DEFS[w]);
  if (slots.length === 0) return;
  // Dim the world behind the wheel — but only to 0.35, not 0.55: the
  // heavier dim multiplied the enemies' red body back to dark maroon,
  // so the Tiburones read as dots while the wheel was open. At 0.35
  // the brightened body survives as visible red.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  text(ctx, 'WEAPON WHEEL — release to pick', cx, cy - 185, 16, C.gold, 'center', '800');
  const R = 118;
  slots.forEach((w, i) => {
    const a = -Math.PI / 2 + (i / slots.length) * Math.PI * 2;
    const x = cx + Math.cos(a) * R;
    const y = cy + Math.sin(a) * R;
    const owned = p.owned.includes(w);
    const selected = g.wheel.slot === i;
    ctx.fillStyle = !owned ? 'rgba(20,26,36,0.55)'
      : selected ? 'rgba(242,201,76,0.9)' : 'rgba(20,26,36,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = !owned ? 'rgba(255,255,255,0.15)'
      : selected ? C.gold : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const def = GUN_DEFS[w];
    const labelColor = !owned ? C.dim : selected ? '#111' : C.text;
    text(ctx, def.label, x, y - 6, 12, labelColor, 'center', '700');
    if (owned) {
      const reserve = p.ammo[w];
      // Every owned slot shows its own mag / reserve, not just the
      // current weapon: the old reserve-only display hid the other
      // weapons' mags, so the wheel and the HUD disagreed about the
      // pistol.
      text(ctx, def.mag === Infinity ? '—' : `${magOf(p, w)} / ${reserve}`, x, y + 12, 11, selected ? '#111' : C.dim, 'center');
    } else {
      text(ctx, 'LOCKED', x, y + 12, 11, C.dim, 'center', '700');
      text(ctx, wheelLockReason(w), x, y + 26, 9, C.dim, 'center');
    }
    text(ctx, `${i + 1}`, x + 34, y - 34, 11, !owned ? C.dim : selected ? C.gold : C.dim, 'center');
  });
  text(ctx, '1-5 pick · mouse aims the slot', cx, cy + 185, 12, C.dim, 'center');
}

// ------------------------------------------------------------------- panel
export function drawPanel(ctx, title, lines, prompt, accent = C.gold) {
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  const w = 560;
  const h = 120 + lines.length * 26 + (prompt ? 44 : 0);
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.fillStyle = 'rgba(8, 10, 16, 0.92)';
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();
  text(ctx, title, cx, y + 58, 44, accent, 'center', '800');
  lines.forEach((line, i) => {
    text(ctx, line, cx, y + 100 + i * 26, 15, C.text, 'center');
  });
  if (prompt) text(ctx, prompt, cx, y + h - 22, 14, C.dim, 'center');
}

// Shared frame for the world-space shop / jobs / garage / settings
// panels: fully opaque fill, coloured border, centred on the camera.
function worldPanel(ctx, g, w, h, borderColor) {
  const cx = g.camera.x;
  const cy = g.camera.y;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.fillStyle = '#080a10'; // Fully opaque: a translucent fill let bright neon show through the panel.
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();
  return { cx, cy, x, y };
}

// -------------------------------------------------------------------- shop
// Drawn in world space, centred on the camera (the caller sets the world
// transform first).
export function drawShop(ctx, g) {
  const shop = SHOP_DEFS.find((d) => d.id === g.shopId);
  if (!shop) return;
  const w = 560;
  const rowH = 46;
  const h = 150 + shop.goods.length * rowH + 52;
  const { cx, x, y } = worldPanel(ctx, g, w, h, shop.color || C.gold);
  text(ctx, shop.name, cx, y + 46, 26, shop.color || C.gold, 'center', '800');
  text(ctx, shop.blurb || '', cx, y + 72, 14, C.dim, 'center');
  text(ctx, `Cash: $${g.player.cash}`, cx, y + 98, 16, C.gold, 'center', '700');
  shop.goods.forEach((item, i) => {
    const price = shopPrice(g, item.price);
    const yy = y + 122 + i * rowH;
    const discounted = price < item.price;
    text(ctx, `${i + 1}. ${item.label}`, x + 24, yy + 16, 15, C.text, 'left', '700');
    text(ctx, item.desc || '', x + 24, yy + 34, 12, C.dim, 'left');
    text(ctx, `$${price}${discounted ? ` (was $${item.price})` : ''}`, x + w - 24, yy + 16, 15, discounted ? C.green : C.gold, 'right', '700');
  });
  const rank = respectRank(g);
  if (rank >= 3) text(ctx, 'Kingpin discount 20% applied', cx, y + h - 40, 13, C.green, 'center');
  text(ctx, `Press 1-${shop.goods.length} to buy · Esc to leave`, cx, y + h - 18, 14, C.dim, 'center');
}

// -------------------------------------------------------------------- jobs
// The side-job picker: J opens this when more than one job is unlocked
// in the district, instead of rolling one at random. The list is frozen
// at open time in g.jobPicker so the panel and the key handler agree on
// the order. One job unlocked: J starts it directly, no panel. Drawn in
// world space, centred on the camera.
export function drawJobs(ctx, g) {
  const list = g.jobPicker || [];
  const w = 560;
  const rowH = 52;
  const h = 150 + list.length * rowH + 52;
  const { cx, x, y } = worldPanel(ctx, g, w, h, C.gold);
  text(ctx, 'SIDE JOBS — VICE BAY', cx, y + 46, 26, C.gold, 'center', '800');
  text(ctx, 'Pick your work — the Bay pays for what you finish', cx, y + 72, 14, C.dim, 'center');
  text(ctx, `Cash: $${g.player.cash}`, cx, y + 98, 16, C.gold, 'center', '700');
  list.forEach((kind, i) => {
    const def = JOB_DEFS[kind] || {};
    const yy = y + 122 + i * rowH;
    const pay = def.pay ? `$${def.pay}` : `$${def.payMin || 0}–$${def.payMax || 0}`;
    const detail = kind === 'race' ? `${def.timeLimit || 75}s limit` : kind === 'food' ? `${def.stops || 3} stops` : 'pick up & drop off';
    text(ctx, `${i + 1}. ${def.label || kind}`, x + 24, yy + 16, 15, C.text, 'left', '700');
    text(ctx, detail, x + 24, yy + 36, 12, C.dim, 'left');
    // The standing number is the UNLOCK threshold for this job, not a
    // reward: the old "standing 75+" read as "+75 standing earned"
    // (finishJob pays cash only, zero standing). Say "needs" so the
    // player reads it as a requirement.
    text(ctx, `${pay} · needs standing ${def.standing || 0}`, x + w - 24, yy + 16, 15, C.gold, 'right', '700');
  });
  text(ctx, `Press 1-${list.length} to start · Esc to leave`, cx, y + h - 18, 14, C.dim, 'center');
}

// ------------------------------------------------------------------ garage
// Drawn in world space, centred on the camera. 3 lines x 3 tiers, prices
// from story.garagePrice, owned tiers marked, next tier highlighted.
export function drawGarage(ctx, g) {
  const car = ownedCarNear(g);
  const w = 640;
  const h = 400;
  const { cx, x, y } = worldPanel(ctx, g, w, h, C.orange);

  const carLabel = car ? (CAR_DEFS[car.type] ? CAR_DEFS[car.type].label : car.type) : 'No car';
  // Repair price mirrors the Dex shop's rule (80 + 40 per fitted tier,
  // rank discount): the garage is the reachable way to buy a repair,
  // since E at Dex opens this screen whenever the car is parked here.
  const up = car ? (car.upgrades || {}) : {};
  const fittedTiers = (up.engine || 0) + (up.armor || 0) + (up.nitro || 0);
  const repairPrice = car ? shopPrice(g, 80 + 40 * fittedTiers) : 80;
  text(ctx, 'DEX GARAGE — UPGRADES', cx, y + 44, 26, C.orange, 'center', '800');
  // At full HP the repair is not offered: the action already refuses
  // ("Already at full health"), but the panel used to advertise
  // "Repair $120 (key 0)" for nothing. A dead car is never "FULL" —
  // repair revives it.
  const fullHp = car && car.hp >= (car.maxHp || 100) && !car.dead;
  text(ctx, car ? `${carLabel}  ·  HP ${Math.ceil(car.hp)}/${car.maxHp || 100}  ·  ${fullHp ? 'Repair — FULL' : `Repair $${repairPrice} (key 0)`}` : 'Park an owned car by the garage first', cx, y + 70, 14, C.text, 'center');
  text(ctx, `Cash: $${g.player.cash}`, cx, y + 94, 16, C.gold, 'center', '700');

  const lines = [
    { id: 'engine', label: 'ENGINE', desc: '+8% top speed / tier' },
    { id: 'armor', label: 'ARMOR', desc: '+25% max HP / tier' },
    { id: 'nitro', label: 'NITRO', desc: 'Burst boost / tier' },
  ];
  const owned = car && g.garage ? (g.garage[car.id] || { engine: 0, armor: 0, nitro: 0 }) : { engine: 0, armor: 0, nitro: 0 };
  const fallbackPrices = [300, 700, 1400];
  lines.forEach((line, li) => {
    const yy = y + 128 + li * 78;
    text(ctx, line.label, x + 24, yy + 10, 16, C.text, 'left', '800');
    text(ctx, line.desc, x + 24, yy + 30, 12, C.dim, 'left');
    for (let tier = 1; tier <= 3; tier += 1) {
      const idx = li * 3 + (tier - 1);
      const cellX = x + 220 + (tier - 1) * 132;
      const cellW = 122;
      const cellH = 56;
      const have = owned[line.id] || 0;
      const isOwned = tier <= have;
      const isNext = tier === have + 1;
      let price = fallbackPrices[tier - 1];
      try {
        price = garagePrice(line.id, tier);
      } catch {
        price = fallbackPrices[tier - 1];
      }
      ctx.fillStyle = isOwned ? 'rgba(242,201,76,0.25)' : isNext ? 'rgba(88,179,104,0.18)' : 'rgba(255,255,255,0.06)';
      roundRect(ctx, cellX, yy - 6, cellW, cellH, 8);
      ctx.fill();
      ctx.strokeStyle = isOwned ? C.gold : isNext ? C.green : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = isNext ? 2 : 1;
      roundRect(ctx, cellX, yy - 6, cellW, cellH, 8);
      ctx.stroke();
      text(ctx, `TIER ${tier}`, cellX + cellW / 2, yy + 14, 12, isOwned ? C.gold : C.text, 'center', '700');
      text(ctx, isOwned ? 'OWNED ✓' : `$${price}`, cellX + cellW / 2, yy + 34, 14, isOwned ? C.gold : C.text, 'center', '700');
      text(ctx, `${idx + 1}`, cellX + 10, yy + 14, 11, C.dim, 'left');
    }
  });
  text(ctx, 'One line at a time — engine, armor or nitro. Upgrades die with the car.', cx, y + h - 44, 13, C.dim, 'center');
  // When the repair is FULL, key 0 does nothing — the footer must not
  // advertise it. Same dynamic-footer rule as the shop.
  text(ctx, fullHp ? 'Press 1-9 to buy · Esc to leave' : 'Press 0 to repair · 1-9 to buy · Esc to leave', cx, y + h - 20, 14, C.dim, 'center');
}

// --------------------------------------------------------------- settings
// Drawn in world space, centred on the camera.
export function drawSettingsPanel(ctx, g) {
  const w = 520;
  const h = 330;
  const { cx, x, y } = worldPanel(ctx, g, w, h, C.cyan);
  text(ctx, 'SETTINGS', cx, y + 46, 26, C.cyan, 'center', '800');
  const rows = [
    `1. Music: ${g.settings.music ? 'ON' : 'OFF'}`,
    `2. Traffic: ${g.settings.traffic}`,
    `3. Freeze time: ${g.settings.freezeTime ? 'ON' : 'OFF'}`,
  ];
  rows.forEach((row, i) => {
    text(ctx, row, cx, y + 96 + i * 30, 16, C.text, 'center');
  });
  text(ctx, 'WASD move · E interact / steal · Shift run', cx, y + 206, 13, C.dim, 'center');
  text(ctx, 'Mouse aim · Click shoot · R reload · M mute · V radio', cx, y + 228, 13, C.dim, 'center');
  text(ctx, 'Q tap = quick-save · hold Q = weapon wheel', cx, y + 250, 13, C.dim, 'center');
  text(ctx, 'G driver ability · H lookout ping · J side job', cx, y + 272, 13, C.dim, 'center');
  text(ctx, 'Press 1-3 to toggle · Esc to go back', cx, y + h - 18, 14, C.dim, 'center');
}
