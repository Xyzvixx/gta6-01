// Drawing only: the city, its people and cars, the weather and the night,
// then the screens. The renderer never changes game state; it reads the
// world and the camera and paints pixels.
import { AVENUES, CAR_DEFS, GUN_DEFS, OUTFIT_COLORS, ROAD_HALF, SHOP_DEFS, STREETS } from './data.js';
import { COLOURS, FONT, VIEW, WORLD } from './config.js';
import { clamp } from './random.js';
import { drawHud, drawPanel } from './hud.js';
import { damageTier } from './vehicles.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_DEAD = 'dead';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_SHOP = 'shop';
export const SCREEN_SETTINGS = 'settings';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function isNight(g) {
  return g.clock >= 19.5 || g.clock < 6.5;
}

export function darkness(g) {
  if (isNight(g)) return 0.42;
  if (g.clock >= 17.5) return 0.2;
  if (g.clock < 7.5) return 0.16;
  return 0;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0, dpr: 1 };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view.dpr = dpr;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    view.scale = Math.min(canvas.width / VIEW.w, canvas.height / VIEW.h);
    view.x = (canvas.width - VIEW.w * view.scale) / 2;
    view.y = (canvas.height - VIEW.h * view.scale) / 2;
  }
  resize();
  window.addEventListener('resize', resize);

  // Logical (1280x720) point -> device pixels, for mouse aim.
  function toWorld(g, sx, sy) {
    const lx = (sx * view.dpr - view.x) / view.scale;
    const ly = (sy * view.dpr - view.y) / view.scale;
    return { x: lx + g.camera.x - VIEW.w / 2, y: ly + g.camera.y - VIEW.h / 2 };
  }

  function inView(g, x, y, margin) {
    return (
      x > g.camera.x - VIEW.w / 2 - margin && x < g.camera.x + VIEW.w / 2 + margin &&
      y > g.camera.y - VIEW.h / 2 - margin && y < g.camera.y + VIEW.h / 2 + margin
    );
  }

  function drawGround(g) {
    const cam = g.camera;
    const x0 = cam.x - VIEW.w / 2;
    const y0 = cam.y - VIEW.h / 2;
    ctx.fillStyle = COLOURS.grass;
    ctx.fillRect(x0, y0, VIEW.w, VIEW.h);
    // Mow stripes for a little texture.
    ctx.fillStyle = COLOURS.grass2;
    for (let y = Math.floor(y0 / 120) * 120; y < y0 + VIEW.h; y += 240) {
      ctx.fillRect(x0, y, VIEW.w, 120);
    }
    // Parks.
    for (const pk of g.city.parks) {
      if (!inView(g, pk.x, pk.y, 200)) continue;
      ctx.fillStyle = COLOURS.park;
      ctx.fillRect(pk.x - pk.w / 2, pk.y - pk.h / 2, pk.w, pk.h);
    }
    // Beach + water (east edge).
    ctx.fillStyle = COLOURS.sand;
    ctx.fillRect(g.city.beachX, y0, g.city.waterX - g.city.beachX, VIEW.h);
    ctx.fillStyle = COLOURS.water;
    ctx.fillRect(g.city.waterX, y0, VIEW.w, VIEW.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i += 1) {
      const wy = y0 + ((g.time * 24 + i * 173) % (VIEW.h + 60)) - 30;
      ctx.beginPath();
      for (let x = g.city.waterX; x < x0 + VIEW.w; x += 26) {
        const yy = wy + Math.sin(x * 0.02 + g.time * 1.4 + i) * 5;
        if (x === g.city.waterX) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  }

  function drawRoads(g) {
    const cam = g.camera;
    const x0 = cam.x - VIEW.w / 2;
    const y0 = cam.y - VIEW.h / 2;
    const wet = g.weather.rain > 0.3;
    ctx.fillStyle = wet ? COLOURS.asphaltWet : COLOURS.asphalt;
    for (const av of AVENUES) {
      ctx.fillRect(av.x - ROAD_HALF, y0, ROAD_HALF * 2, VIEW.h);
    }
    for (const st of STREETS) {
      ctx.fillRect(x0, st.y - ROAD_HALF, VIEW.w, ROAD_HALF * 2);
    }
    // Sidewalks.
    ctx.fillStyle = COLOURS.sidewalk;
    for (const av of AVENUES) {
      ctx.fillRect(av.x - ROAD_HALF - 12, y0, 12, VIEW.h);
      ctx.fillRect(av.x + ROAD_HALF, y0, 12, VIEW.h);
    }
    for (const st of STREETS) {
      ctx.fillRect(x0, st.y - ROAD_HALF - 12, VIEW.w, 12);
      ctx.fillRect(x0, st.y + ROAD_HALF, VIEW.w, 12);
    }
    // Centre dashes.
    ctx.fillStyle = COLOURS.lane;
    ctx.setLineDash([26, 30]);
    ctx.lineWidth = 3;
    for (const av of AVENUES) {
      ctx.beginPath();
      ctx.moveTo(av.x, y0);
      ctx.lineTo(av.x, y0 + VIEW.h);
      ctx.stroke();
    }
    for (const st of STREETS) {
      ctx.beginPath();
      ctx.moveTo(x0, st.y);
      ctx.lineTo(x0 + VIEW.w, st.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Crosswalks at every intersection.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const av of AVENUES) {
      for (const st of STREETS) {
        for (let i = -2; i <= 2; i += 1) {
          ctx.fillRect(av.x + i * 14 - 4, st.y - ROAD_HALF - 4, 8, 12);
          ctx.fillRect(av.x + i * 14 - 4, st.y + ROAD_HALF - 8, 8, 12);
        }
      }
    }
    // Wet-road sheen.
    if (wet) {
      ctx.fillStyle = `rgba(150,180,220,${0.05 + g.weather.rain * 0.06})`;
      for (const av of AVENUES) ctx.fillRect(av.x - ROAD_HALF, y0, ROAD_HALF * 2, VIEW.h);
      for (const st of STREETS) ctx.fillRect(x0, st.y - ROAD_HALF, VIEW.w, ROAD_HALF * 2);
    }
  }

  function drawBuildings(g) {
    const night = isNight(g);
    for (const b of g.city.buildings) {
      if (!inView(g, b.x + b.w / 2, b.y + b.h / 2, 160)) continue;
      const h = b.hgt;
      const ox = h * 0.45;
      const oy = h * 0.6;
      // Drop shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(b.x + ox * 0.4, b.y + oy * 0.4, b.w, b.h);
      // Extruded sides (the 2.5D trick).
      ctx.fillStyle = '#1a1d24';
      ctx.beginPath();
      ctx.moveTo(b.x + b.w, b.y);
      ctx.lineTo(b.x + b.w + ox, b.y - oy);
      ctx.lineTo(b.x + b.w + ox, b.y + b.h - oy);
      ctx.lineTo(b.x + b.w, b.y + b.h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#262a33';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.h);
      ctx.lineTo(b.x + ox, b.y + b.h - oy);
      ctx.lineTo(b.x + b.w + ox, b.y + b.h - oy);
      ctx.lineTo(b.x + b.w, b.y + b.h);
      ctx.closePath();
      ctx.fill();
      // Roof.
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      // Roof plant / AC boxes.
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(b.x + b.w * 0.2, b.y + b.h * 0.25, b.w * 0.22, b.h * 0.22);
      ctx.fillRect(b.x + b.w * 0.62, b.y + b.h * 0.55, b.w * 0.18, b.h * 0.18);
      // Lit windows at night on the south face.
      if (night) {
        ctx.fillStyle = '#ffd76a';
        const cols = Math.max(1, Math.floor(b.w / 26));
        for (let i = 0; i < cols; i += 1) {
          if ((i * 7 + Math.floor(b.x)) % 3 === 0) {
            ctx.fillRect(b.x + 8 + i * 24, b.y + b.h - 8, 10, 6);
          }
        }
      }
      // Neon sign.
      if (b.neon) {
        const colors = ['#ff4fd8', '#37e6ff', '#ff9a3d'];
        const col = colors[Math.floor(b.x + b.y) % colors.length];
        ctx.font = `800 ${Math.min(20, b.h * 0.28)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        ctx.fillText(b.neon, b.x + b.w / 2, b.y + b.h / 2 + 6);
        ctx.shadowBlur = 0;
      }
    }
  }

  function drawTreesLamps(g) {
    for (const t of g.city.trees) {
      if (!inView(g, t.x, t.y, 40)) continue;
      ctx.fillStyle = '#2a4a24';
      ctx.beginPath();
      ctx.arc(t.x + 3, t.y + 4, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3f7a33';
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const l of g.city.lamps) {
      if (!inView(g, l.x, l.y, 30)) continue;
      ctx.fillStyle = '#3a3f46';
      ctx.fillRect(l.x - 2, l.y - 2, 4, 4);
      if (isNight(g)) {
        ctx.fillStyle = 'rgba(255,214,106,0.85)';
        ctx.beginPath();
        ctx.arc(l.x, l.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,214,106,0.10)';
        ctx.beginPath();
        ctx.arc(l.x, l.y, 26, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawShops(g) {
    for (const s of g.city.shops) {
      const def = SHOP_DEFS.find((d) => d.id === s.id);
      if (!def || !inView(g, s.x, s.y, 60)) continue;
      ctx.fillStyle = def.color;
      ctx.fillRect(s.x - 46, s.y - 30, 92, 60);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(s.x - 46, s.y - 30, 92, 12);
      ctx.font = `800 13px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(def.name, s.x, s.y + 4);
      ctx.font = `400 10px ${FONT}`;
      ctx.fillText('E — shop', s.x, s.y + 20);
      if (isNight(g)) {
        ctx.shadowColor = def.color;
        ctx.shadowBlur = 16;
        ctx.fillStyle = def.color;
        ctx.fillRect(s.x - 46, s.y - 30, 92, 4);
        ctx.shadowBlur = 0;
      }
    }
    for (const lm of g.city.landmarks) {
      if (!inView(g, lm.x, lm.y, 40)) continue;
      if (lm.kind === 'warehouse' || lm.kind === 'cafe' || lm.kind === 'house') {
        ctx.fillStyle = lm.kind === 'warehouse' ? '#6b5a4a' : lm.kind === 'cafe' ? '#c98a4a' : '#4a6b8a';
        ctx.fillRect(lm.x - 52, lm.y - 34, 104, 68);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.strokeRect(lm.x - 52, lm.y - 34, 104, 68);
      }
    }
  }

  function drawCar(g, car) {
    const def = CAR_DEFS[car.type];
    const night = isNight(g);
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, -def.len / 2 + 4, -def.wid / 2 + 5, def.len, def.wid, 8);
    ctx.fill();
    // Neon underglow.
    if (car.glow && night) {
      ctx.shadowColor = '#37e6ff';
      ctx.shadowBlur = 18;
    }
    // Body.
    ctx.fillStyle = car.type === 'interceptor' ? '#e8e8e8' : car.color;
    roundRect(ctx, -def.len / 2, -def.wid / 2, def.len, def.wid, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (car.type === 'interceptor') {
      ctx.fillStyle = '#1c2733';
      roundRect(ctx, -def.len / 2, -def.wid / 2, def.len * 0.42, def.wid, 8);
      ctx.fill();
      // Light bar, flashing.
      const flash = Math.floor(g.time * 6) % 2 === 0;
      ctx.fillStyle = flash ? '#ff2e2e' : '#2e6bff';
      ctx.fillRect(-6, -def.wid / 2 + 2, 12, 5);
      ctx.fillStyle = flash ? '#2e6bff' : '#ff2e2e';
      ctx.fillRect(-6, def.wid / 2 - 7, 12, 5);
    }
    if (car.type === 'cabrio') {
      ctx.fillStyle = '#1c2733';
      ctx.font = '800 9px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('TAXI', 0, 3);
    }
    // Cabin + windshield.
    ctx.fillStyle = 'rgba(20,28,38,0.85)';
    roundRect(ctx, -def.len * 0.18, -def.wid / 2 + 4, def.len * 0.32, def.wid - 8, 5);
    ctx.fill();
    // Headlights at night.
    if (night) {
      ctx.fillStyle = 'rgba(255,240,170,0.9)';
      ctx.fillRect(def.len / 2 - 2, -def.wid / 2 + 3, 4, 5);
      ctx.fillRect(def.len / 2 - 2, def.wid / 2 - 8, 4, 5);
      ctx.fillStyle = 'rgba(255,240,170,0.10)';
      ctx.beginPath();
      ctx.moveTo(def.len / 2, -def.wid / 2 + 4);
      ctx.lineTo(def.len / 2 + 90, -def.wid / 2 - 26);
      ctx.lineTo(def.len / 2 + 90, def.wid / 2 + 26);
      ctx.lineTo(def.len / 2, def.wid / 2 - 4);
      ctx.closePath();
      ctx.fill();
    }
    // Damage: dents and scorch marks.
    const tier = damageTier(car);
    if (tier >= 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.arc(-def.len * 0.28, -def.wid * 0.2, 7, 0, Math.PI * 2);
      ctx.arc(def.len * 0.22, def.wid * 0.24, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (tier >= 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,122,46,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, -6);
      ctx.lineTo(6, 6);
      ctx.moveTo(6, -6);
      ctx.lineTo(-6, 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPerson(g, x, y, angle, color, opts = {}) {
    ctx.save();
    ctx.translate(x, y);
    if (opts.down) ctx.rotate(Math.PI / 2);
    else ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(2, 3, 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    if (!opts.down) {
      // Head + shoulders read as a walker from above.
      ctx.fillStyle = '#e8b98a';
      ctx.beginPath();
      ctx.arc(2, 0, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(8, -3, 7, 6);
      if (opts.gun) {
        ctx.fillStyle = '#222';
        ctx.fillRect(10, -1, 12, 3);
      }
      if (opts.flash > 0) {
        ctx.fillStyle = '#ffd76a';
        ctx.beginPath();
        ctx.arc(24, 0, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawWaypoint(g) {
    const wp = g.waypoint;
    if (!wp) return;
    const bounce = Math.sin(g.time * 4) * 5;
    ctx.save();
    ctx.translate(wp.x, wp.y + bounce - 10);
    ctx.fillStyle = 'rgba(242,201,76,0.25)';
    ctx.beginPath();
    ctx.arc(0, 10 - bounce, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLOURS.gold;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(12, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(-12, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '800 11px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText('!', 0, 4);
    ctx.restore();
  }

  function drawRain(g) {
    const rain = g.weather.rain;
    if (rain <= 0.02) return;
    ctx.strokeStyle = `rgba(180,200,230,${0.25 + rain * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of g.rainDrops) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 4, d.y + 14);
    }
    ctx.stroke();
  }

  function drawParticles(g) {
    for (const pt of g.particles) {
      const a = Math.max(0, pt.life / pt.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (0.6 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const b of g.bullets) {
      ctx.strokeStyle = '#ffd76a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  function drawWorld(g) {
    drawGround(g);
    drawRoads(g);
    drawBuildings(g);
    drawTreesLamps(g);
    drawShops(g);
    drawWaypoint(g);
    for (const car of g.cars) {
      if (car.dead) continue;
      if (inView(g, car.x, car.y, 80)) drawCar(g, car);
    }
    for (const pd of g.peds) {
      if (inView(g, pd.x, pd.y, 30)) {
        drawPerson(g, pd.x, pd.y, pd.angle, pd.color, { down: pd.state === 'down' });
      }
    }
    for (const e of g.enemies) {
      if (inView(g, e.x, e.y, 30)) drawPerson(g, e.x, e.y, e.angle, '#8a2f2f', { gun: true, flash: e.flash });
    }
    for (const pk of g.pickups) {
      if (!inView(g, pk.x, pk.y, 30)) continue;
      ctx.fillStyle = pk.kind === 'health' ? '#58b368' : pk.kind === 'armor' ? '#7fb3e8' : pk.kind === 'cash' ? COLOURS.gold : '#e8e8e8';
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    for (const c of g.cops) {
      if (c.kind === 'foot' && inView(g, c.x, c.y, 30)) {
        drawPerson(g, c.x, c.y, c.angle, '#1c2733', {});
        ctx.fillStyle = '#4f8ef7';
        ctx.beginPath();
        ctx.arc(c.x, c.y - 12, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const p = g.player;
    if (p.carId === null && p.hp > 0) {
      const aim = g.aimAngle !== null && g.aimAngle !== undefined ? g.aimAngle : p.angle;
      drawPerson(g, p.x, p.y, p.angle, OUTFIT_COLORS[p.outfit] || '#2fa8a0', { gun: p.weapon !== 'fists' });
      // Aim tick.
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(aim) * 14, p.y + Math.sin(aim) * 14);
      ctx.lineTo(p.x + Math.cos(aim) * 24, p.y + Math.sin(aim) * 24);
      ctx.stroke();
    }
    drawParticles(g);
    drawRain(g);
    // Night overlay.
    const dark = darkness(g);
    if (dark > 0) {
      ctx.fillStyle = `rgba(10,14,48,${dark})`;
      const cam = g.camera;
      ctx.fillRect(cam.x - VIEW.w / 2, cam.y - VIEW.h / 2, VIEW.w, VIEW.h);
    }
  }

  function drawTitle(g) {
    drawWorld(g);
    ctx.fillStyle = 'rgba(5,7,12,0.55)';
    ctx.fillRect(g.camera.x - VIEW.w / 2, g.camera.y - VIEW.h / 2, VIEW.w, VIEW.h);
    ctx.save();
    ctx.translate(g.camera.x, g.camera.y);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '800 84px ' + FONT;
    ctx.shadowColor = '#ff4fd8';
    ctx.shadowBlur = 30;
    ctx.fillText('VICE BAY', 0, -40);
    ctx.shadowBlur = 0;
    ctx.font = '600 26px ' + FONT;
    ctx.fillStyle = COLOURS.gold;
    ctx.fillText('A Vice Bay story — Rico Vale', 0, 6);
    ctx.font = '400 18px ' + FONT;
    ctx.fillStyle = '#d5dae0';
    ctx.fillText('An open-world crime game. Original city, characters and story.', 0, 44);
    ctx.fillText('WASD move / drive · E enter & steal cars · Mouse aim, click shoot', 0, 76);
    ctx.fillText('R reload · Q quick-save · M mute · V radio · Esc pause', 0, 104);
    ctx.font = '700 22px ' + FONT;
    ctx.fillStyle = '#fff';
    const blink = Math.floor(g.time * 1.6) % 2 === 0;
    if (blink) ctx.fillText(g.hasSave ? 'Press ENTER — New Game / Continue' : 'Press ENTER — New Game', 0, 160);
    ctx.font = '400 14px ' + FONT;
    ctx.fillStyle = COLOURS.dim;
    ctx.fillText('100% original fiction — not affiliated with Rockstar Games.', 0, 200);
    ctx.restore();
  }

  function drawShop(g) {
    drawWorld(g);
    const shop = SHOP_DEFS.find((d) => d.id === g.shopId);
    if (!shop) return;
    ctx.save();
    ctx.translate(g.camera.x, g.camera.y);
    const w = 560;
    const h = 150 + shop.goods.length * 44;
    const x = -w / 2;
    const y = -h / 2;
    ctx.fillStyle = 'rgba(8,10,16,0.92)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = shop.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = '800 30px ' + FONT;
    ctx.fillText(shop.name, x + 24, y + 48);
    ctx.font = '400 15px ' + FONT;
    ctx.fillStyle = COLOURS.dim;
    ctx.fillText(shop.blurb, x + 24, y + 72);
    ctx.fillStyle = COLOURS.gold;
    ctx.font = '700 18px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText(`$${g.player.cash}`, x + w - 24, y + 48);
    shop.goods.forEach((item, i) => {
      const iy = y + 96 + i * 44;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.font = '600 16px ' + FONT;
      ctx.fillText(`${i + 1}. ${item.label}`, x + 24, iy);
      ctx.fillStyle = COLOURS.dim;
      ctx.font = '400 13px ' + FONT;
      ctx.fillText(item.desc, x + 24, iy + 17);
      ctx.fillStyle = g.player.cash >= item.price ? COLOURS.gold : '#777';
      ctx.font = '700 16px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillText(`$${item.price}`, x + w - 24, iy);
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOURS.dim;
    ctx.font = '400 14px ' + FONT;
    ctx.fillText('Press 1-4 to buy · Esc to leave', 0, y + h - 16);
    ctx.restore();
  }

  function drawSettings(g) {
    drawWorld(g);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    const s = g.settings;
    drawPanel(ctx, 'Settings', [
      `Music: ${s.music ? 'ON' : 'OFF'} — press 1 to toggle`,
      `Traffic: ${s.traffic.toUpperCase()} — press 2 to toggle`,
      `Freeze day/night: ${s.freezeTime ? 'ON' : 'OFF'} — press 3 to toggle`,
      `Radio station: ${g.audio.stationName()} — press V in game`,
      `Mute (M): ${g.audio.isMuted() ? 'MUTED' : 'sound on'}`,
    ], 'Esc to resume');
  }

  function draw(g, screen) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLOURS.backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const shakeX = g.camera.shake > 0 ? (Math.random() * 2 - 1) * g.camera.shake : 0;
    const shakeY = g.camera.shake > 0 ? (Math.random() * 2 - 1) * g.camera.shake : 0;
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x - (g.camera.x - VIEW.w / 2) * view.scale + shakeX * view.scale, view.y - (g.camera.y - VIEW.h / 2) * view.scale + shakeY * view.scale);
    if (screen === SCREEN_TITLE) {
      drawTitle(g);
      return;
    }
    drawWorld(g);
    if (screen === SCREEN_PLAY || screen === SCREEN_SHOP || screen === SCREEN_SETTINGS) {
      // HUD in screen space.
      ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
      drawHud(ctx, g);
      ctx.setTransform(view.scale, 0, 0, view.scale, view.x - (g.camera.x - VIEW.w / 2) * view.scale, view.y - (g.camera.y - VIEW.h / 2) * view.scale);
      if (screen === SCREEN_SHOP) drawShop(g);
      else if (screen === SCREEN_SETTINGS) drawSettings(g);
      return;
    }
    if (screen === SCREEN_PAUSED) {
      ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
      drawPanel(ctx, 'Paused', [
        'Progress autosaves on mission completion.',
        'Q — quick-save   ·   T — settings screen',
        'M — mute   ·   V — change radio station',
      ], 'Esc to resume');
      return;
    }
    if (screen === SCREEN_DEAD) {
      ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
      drawPanel(ctx, 'WASTED', ['Rico got taken down. The Bay keeps moving.', 'You lose $150. Mission restarts at its first stage.'], 'Press ENTER to get back up', COLOURS.red);
      return;
    }
    if (screen === SCREEN_BUSTED) {
      ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
      drawPanel(ctx, 'BUSTED', ['Captain Rosa has you. For now.', 'You lose $100. Mission restarts at its first stage.'], 'Press ENTER to walk free', COLOURS.blue);
      return;
    }
  }

  return { draw, toWorld, resize };
}
