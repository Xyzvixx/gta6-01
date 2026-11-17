// HUD and minimap, drawn on the main canvas after the world: wanted stars,
// clock and street, cash, health/armor, weapon, the mission banner, toasts,
// speed and the round minimap with its route line.
import { COLOURS, FONT, VIEW } from './config.js';
import { GUN_DEFS, OUTFIT_COLORS } from './data.js';
import { activeWaypoint, currentStory, missionText } from './missions.js';
import { districtAt, roadNameAt } from './city.js';

function bar(ctx, x, y, w, h, frac, color, bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
}

function text(ctx, s, x, y, size, color, align = 'left', weight = '600') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

function clockText(g) {
  const h = Math.floor(g.clock) % 24;
  const m = Math.floor((g.clock % 1) * 60);
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function drawMinimap(ctx, g) {
  const R = 92;
  const cx = VIEW.w - R - 18;
  const cy = VIEW.h - R - 18;
  const scale = (R * 2) / 3200;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#1d2b1a';
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  // Water on the east edge.
  ctx.fillStyle = '#14486b';
  ctx.fillRect(cx - R + 2980 * scale, cy - R, R * 2, R * 2);
  // Roads.
  ctx.strokeStyle = '#5a5e63';
  ctx.lineWidth = 3;
  for (const a of g.cityAvenues) {
    ctx.beginPath();
    ctx.moveTo(cx - R + a.x * scale, cy - R);
    ctx.lineTo(cx - R + a.x * scale, cy + R);
    ctx.stroke();
  }
  for (const s of g.cityStreets) {
    ctx.beginPath();
    ctx.moveTo(cx - R, cy - R + s.y * scale);
    ctx.lineTo(cx + R, cy - R + s.y * scale);
    ctx.stroke();
  }
  // Route line to the waypoint.
  const wp = activeWaypoint(g);
  const p = g.player;
  if (wp) {
    ctx.strokeStyle = COLOURS.gold;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - R + p.x * scale, cy - R + p.y * scale);
    ctx.lineTo(cx - R + wp.x * scale, cy - R + wp.y * scale);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLOURS.gold;
    ctx.save();
    ctx.translate(cx - R + wp.x * scale, cy - R + wp.y * scale);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }
  // Cops.
  ctx.fillStyle = '#4f8ef7';
  for (const c of g.cops) {
    ctx.beginPath();
    ctx.arc(cx - R + c.x * scale, cy - R + c.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Enemies.
  ctx.fillStyle = '#e5534b';
  for (const e of g.enemies) {
    ctx.beginPath();
    ctx.arc(cx - R + e.x * scale, cy - R + e.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Player arrow.
  ctx.save();
  ctx.translate(cx - R + p.x * scale, cy - R + p.y * scale);
  ctx.rotate(p.angle);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-6, -5);
  ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.restore();
  // Ring + N.
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  text(ctx, 'N', cx, cy - R + 14, 12, '#fff', 'center', '700');
}

export function drawHud(ctx, g) {
  const p = g.player;
  const level = g.wanted.level;

  // Wanted stars, top-left.
  let stars = '';
  for (let i = 0; i < 5; i += 1) stars += i < level ? '★' : '☆';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  text(ctx, stars, 16, 36, 26, level > 0 ? '#ffb03a' : 'rgba(255,255,255,0.55)');
  text(ctx, `${clockText(g)}  ·  ${districtAt(p.x, p.y)}`, 16, 62, 15, '#e8ecf0');
  text(ctx, roadNameAt(p.x, p.y), 16, 82, 14, COLOURS.dim);
  ctx.restore();

  // Cash, top-right.
  text(ctx, `$${p.cash}`, VIEW.w - 16, 40, 30, COLOURS.gold, 'right', '800');
  const story = currentStory(g);
  if (story) text(ctx, story.title, VIEW.w - 16, 64, 14, '#fff', 'right');

  // Mission banner, top-centre.
  const obj = missionText(g);
  if (obj) {
    ctx.font = `600 16px ${FONT}`;
    const w = Math.min(620, ctx.measureText(obj).width + 28);
    ctx.fillStyle = 'rgba(10,12,18,0.72)';
    ctx.fillRect((VIEW.w - w) / 2, 12, w, 34);
    ctx.strokeStyle = 'rgba(242,201,76,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect((VIEW.w - w) / 2 + 0.5, 12.5, w, 34);
    text(ctx, obj, VIEW.w / 2, 35, 16, '#fff', 'center');
    const wp = activeWaypoint(g);
    if (wp) {
      const d = Math.round(Math.hypot(wp.x - p.x, wp.y - p.y));
      text(ctx, `${d}m`, VIEW.w / 2, 62, 13, COLOURS.gold, 'center');
    }
  }

  // Health / armor / weapon, bottom-left.
  bar(ctx, 16, VIEW.h - 66, 210, 16, p.hp / 100, '#58b368', 'rgba(0,0,0,0.6)');
  text(ctx, `HP ${Math.ceil(p.hp)}`, 20, VIEW.h - 53, 12, '#fff');
  if (p.armor > 0) {
    bar(ctx, 16, VIEW.h - 44, 210, 10, p.armor / 100, '#7fb3e8', 'rgba(0,0,0,0.6)');
    text(ctx, `ARMOR ${Math.ceil(p.armor)}`, 20, VIEW.h - 35, 10, '#dfe9f5');
  }
  const def = GUN_DEFS[p.weapon];
  const ammoText = def.mag === Infinity ? '∞' : `${p.mag}/${p.ammo[p.weapon] || 0}`;
  text(ctx, `${def.label}  ${ammoText}`, 16, VIEW.h - 14, 16, '#fff');
  text(ctx, `Outfit: ${p.outfit}`, 240, VIEW.h - 14, 12, COLOURS.dim);

  // Speed, above the minimap.
  const car = g.cars.find((c) => c.id === p.carId);
  if (car) {
    const kmh = Math.round(Math.abs(car.speed) * 0.32);
    text(ctx, `${kmh} km/h`, VIEW.w - 110, VIEW.h - 200, 20, '#fff', 'center', '800');
    const tier = car.hp < 35 ? 'CRITICAL' : car.hp < 65 ? 'DAMAGED' : '';
    if (tier) text(ctx, `CAR ${tier}`, VIEW.w - 110, VIEW.h - 178, 12, '#ff7a5c', 'center', '700');
  }

  drawMinimap(ctx, g);

  // Toasts, bottom-centre.
  ctx.textAlign = 'center';
  let ty = VIEW.h - 120;
  for (let i = g.messages.length - 1; i >= 0; i -= 1) {
    const m = g.messages[i];
    const age = g.time - m.t;
    if (age > 5) continue;
    const alpha = age > 4 ? 5 - age : 1;
    ctx.globalAlpha = alpha;
    ctx.font = `600 15px ${FONT}`;
    const w = ctx.measureText(m.text).width + 24;
    ctx.fillStyle = 'rgba(10,12,18,0.78)';
    ctx.fillRect((VIEW.w - w) / 2, ty - 20, w, 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(m.text, VIEW.w / 2, ty);
    ctx.globalAlpha = 1;
    ty -= 34;
  }

  // Early-game controls hint.
  if (g.time < 25 && g.screen === 'play') {
    text(ctx, 'WASD move/drive · E enter car · Click shoot · R reload · Q save · Esc pause · M mute', VIEW.w / 2, VIEW.h - 96, 13, 'rgba(255,255,255,0.75)', 'center');
  }
}

export function drawPanel(ctx, title, lines, prompt, accent = COLOURS.gold) {
  const w = 640;
  const h = 150 + lines.length * 30;
  const x = (VIEW.w - w) / 2;
  const y = (VIEW.h - h) / 2;
  ctx.fillStyle = 'rgba(8,10,16,0.88)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  text(ctx, title, VIEW.w / 2, y + 58, 40, '#fff', 'center', '800');
  lines.forEach((line, i) => {
    text(ctx, line, VIEW.w / 2, y + 104 + i * 30, 17, '#d5dae0', 'center');
  });
  if (prompt) text(ctx, prompt, VIEW.w / 2, y + h - 26, 16, accent, 'center');
}
