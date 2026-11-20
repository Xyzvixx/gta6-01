// Combat: guns, bullets, gang enemies, pickups, and the weapon wheel.
// Rico can shoot on foot or as a drive-by from the car. Enemies are
// fair opponents: they close in, hold a firing distance, shoot with
// spread, and flash their muzzle before each shot so the player can
// read them.
import { GUN_DEFS } from './content.js';
import { clamp } from './dice.js';
import { segmentHitsRect } from './cops.js';
import { hurtHero } from './hero.js';
import { buildingsNear } from './town.js';
import { hurtCar } from './traffic.js';

// The wheel shows all five slots in this order, with weapons Rico has
// not unlocked yet greyed out. A locked slot can be looked at but
// never picked.
const WHEEL_ORDER = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];

// Short reason a weapon is locked, shown under its greyed-out wheel
// slot. Kept terse so the text fits under a 44px slot without
// colliding with its neighbours.
export function wheelLockReason(id) {
  if (id === 'smg') return 'Ch. 2 · $350';
  if (id === 'shotgun') return '$300 Bay Arms';
  if (id === 'rifle') return 'Hustler · $650';
  return '';
}

let nextEnemyId = 1;

const WORLD_W = 3200;
const WORLD_H = 2400;

// Shove a round body out of any building rect it overlaps, using the
// same centre-based rects as the hero, pedestrian, car and cop
// versions. Enemies without this step walked straight through walls.
function pushOutOfWalls(g, body, radius) {
  const city = g.city;
  if (!city || !city.buildings) return false;
  let collided = false;
  for (const b of buildingsNear(city, body.x, body.y, radius)) {
    const left = b.x - b.w / 2;
    const right = b.x + b.w / 2;
    const top = b.y - b.h / 2;
    const bottom = b.y + b.h / 2;
    const nearX = Math.max(left, Math.min(body.x, right));
    const nearY = Math.max(top, Math.min(body.y, bottom));
    const offX = body.x - nearX;
    const offY = body.y - nearY;
    const dist2 = offX * offX + offY * offY;
    if (dist2 < radius * radius) {
      collided = true;
      if (dist2 > 0.01) {
        const dist = Math.sqrt(dist2);
        body.x = nearX + (offX / dist) * radius;
        body.y = nearY + (offY / dist) * radius;
      } else {
        body.y = top - radius;
      }
    }
  }
  return collided;
}

function confineToWorld(body, margin) {
  body.x = Math.max(margin, Math.min(body.x, WORLD_W - margin));
  body.y = Math.max(margin, Math.min(body.y, WORLD_H - margin));
}

// One magazine per weapon. A single shared magazine once let the
// player load the pistol, switch to the rifle, fire a dozen free
// rifle rounds, switch back and repeat — rifle, SMG and shotgun ammo
// was never debited. `p.mags` holds the chambered rounds per weapon;
// the reserve lives in `p.ammo` as before.
export function magOf(p, weapon) {
  if (!p) return 0;
  if (p.mags && typeof p.mags[weapon] === 'number') return p.mags[weapon];
  // Legacy shape: a single `p.mag` from old saves or debug paths.
  // The pistol keeps it; every other weapon starts empty.
  if (weapon === 'pistol' && typeof p.mag === 'number') return p.mag;
  return 0;
}

function setMag(p, weapon, v) {
  if (!p.mags) p.mags = {};
  p.mags[weapon] = v;
}

export { setMag };

// Does the segment (x1,y1)-(x2,y2) cross a building? The grid is
// sampled along the whole segment, not just around its midpoint:
// a midpoint-only query missed walls near either end of a long
// segment, so enemies sniped through buildings in exactly the cover
// situation line of sight was meant to enable. Bullet substeps are
// at most 10px, so each one costs one extra query at most.
function bulletHitsWall(g, x1, y1, x2, y2) {
  const city = g.city;
  if (!city || !city.buildings) return false;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(len / 128));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const mx = x1 + (x2 - x1) * t;
    const my = y1 + (y2 - y1) * t;
    for (const b of buildingsNear(city, mx, my, 80)) {
      if (segmentHitsRect(x1, y1, x2, y2, b)) return true;
    }
  }
  return false;
}

function randIn(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

// The weapons Rico owns, in wheel order.
function ownedList(g) {
  const owned = g.player.owned && g.player.owned.length > 0
    ? g.player.owned
    : ['fists', 'pistol'];
  return WHEEL_ORDER.filter((w) => owned.includes(w));
}

export function makeEnemy(g, x, y) {
  const e = {
    id: nextEnemyId,
    x, y,
    hp: 70,
    angle: 0,
    shootT: randIn(g.rng, 0.5, 1.4),
    moveT: 0,
    flash: 0,
  };
  nextEnemyId += 1;
  return e;
}

// Fire `weapon` from a point along an angle. Returns false for fists
// (melee is a separate call) and for unknown weapons. `dmgOverride`
// (enemy fire) sets the bullet damage directly instead of the caller
// reaching into the bullet array afterwards.
export function fireWeapon(g, fromX, fromY, angle, weapon, owner, dmgOverride) {
  const def = GUN_DEFS[weapon];
  if (!def || def.speed === 0) return false;
  const shots = def.pellets || 1;
  for (let i = 0; i < shots; i += 1) {
    const a = angle + randIn(g.rng, -def.spread, def.spread);
    g.bullets.push({
      // Each pellet spawns on its own flight line and remembers its
      // muzzle: the wall sweep has to start at the shooter, not 22px
      // out, or a wall within arm's reach is never tested and the
      // round spawns straight past it.
      x: fromX + Math.cos(a) * 22,
      y: fromY + Math.sin(a) * 22,
      ox: fromX,
      oy: fromY,
      vx: Math.cos(a) * def.speed,
      vy: Math.sin(a) * def.speed,
      life: def.range / def.speed,
      dmg: dmgOverride !== undefined ? dmgOverride : def.dmg,
      owner,
    });
  }
  g.burst(fromX + Math.cos(angle) * 26, fromY + Math.sin(angle) * 26, 3, '#ffd76a', 160);
  g.audio.shot();
  return true;
}

// A fist swing hits only what is in front of Rico: a roughly 140
// degree cone in the aim direction, within arm's reach. Enemies are
// told from pedestrians by list membership, not by duck-typing `hp`.
export function meleeSwing(g, fromX, fromY, angle) {
  let hitAny = false;
  const targets = [...g.enemies, ...g.peds.filter((pd) => pd.state !== 'down')];
  for (const t of targets) {
    const d = Math.hypot(t.x - fromX, t.y - fromY);
    if (d >= 48) continue;
    let diff = Math.atan2(t.y - fromY, t.x - fromX) - angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > (70 * Math.PI) / 180) continue;
    // No punching through walls: a target behind a building within
    // arm's reach is not hittable.
    if (bulletHitsWall(g, fromX, fromY, t.x, t.y)) continue;
    if (g.enemies.includes(t)) {
      t.hp -= 16;
      if (t.hp <= 0) {
        g.enemies = g.enemies.filter((e) => e !== t);
        g.stats.kills += 1;
        // A mission target is a sanctioned hit — Mara or Dex sent
        // Rico, so the kill itself draws no heat. The noise and any
        // bystander hit still do. Killing a non-target in the open
        // is murder and brings the full +30: without this split,
        // the kill missions maxed the player's wanted level just for
        // doing what the mission asked, and the chapter restarted
        // on a bust.
        if (!t.chapterTarget) g.addHeat(30, 'kill');
      }
    } else {
      t.state = 'down';
      t.downT = 0;
      g.addHeat(16, 'hitPed');
    }
    hitAny = true;
  }
  g.audio.blip();
  return hitAny;
}

export function stepFight(g, dt, shooting, aimAngle) {
  const p = g.player;
  p.fireT = Math.max(0, (p.fireT || 0) - dt);

  // The player fires.
  if (shooting && p.fireT <= 0 && p.hp > 0) {
    const def = GUN_DEFS[p.weapon];
    const inCar = p.carId !== null;
    const ride = inCar ? g.cars.find((c) => c.id === p.carId) : null;
    const ox = ride ? ride.x : p.x;
    const oy = ride ? ride.y : p.y;
    if (p.weapon === 'fists') {
      meleeSwing(g, ox, oy, aimAngle);
      p.fireT = def.rate;
    } else if (magOf(p, p.weapon) > 0) {
      fireWeapon(g, ox, oy, aimAngle, p.weapon, 'player');
      setMag(p, p.weapon, magOf(p, p.weapon) - 1);
      p.fireT = def.rate;
      // Gunfire draws eyes, one shot at a time.
      g.addHeat(1, 'shoot');
      g.scarePeds(ox, oy, 320);
    } else {
      p.fireT = 0.3;
      // Throttle the empty-magazine toast: holding the trigger
      // re-armed fireT every 0.3s and re-toasted several times a
      // second. Once per 2s is enough for the player to get the
      // message.
      if (g.time - (p.lastEmptyToast || 0) > 2) {
        g.toast('Magazine empty — press R to reload');
        p.lastEmptyToast = g.time;
      }
    }
  }

  // Bullets fly and hit things. Each round moves in substeps of at
  // most 10px with a hit test after every one: a full `v*dt` step
  // let rifle rounds tunnel straight through a 32px hit zone at low
  // frame rates. Hits are tested before the life decrement, so a
  // round at max range still connects on its last segment. Walls
  // stop bullets — shots used to pass through buildings, and
  // enemies sniped Rico through them.
  for (const b of g.bullets) {
    const dist = Math.hypot(b.vx, b.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / 10));
    const sdt = dt / steps;
    for (let s = 0; s < steps && b.life > 0; s += 1) {
      // The first substep sweeps from the muzzle, not the spawn
      // point: a wall within 22px of the shooter is tested too.
      const px = s === 0 && b.ox !== undefined ? b.ox : b.x;
      const py = s === 0 && b.oy !== undefined ? b.oy : b.y;
      b.x += b.vx * sdt;
      b.y += b.vy * sdt;
      if (bulletHitsWall(g, px, py, b.x, b.y)) {
        b.life = 0;
        g.burst(b.x, b.y, 3, '#c8c8c8', 90);
        break;
      }
      if (b.owner === 'player') {
        for (const e of g.enemies) {
          if (Math.hypot(e.x - b.x, e.y - b.y) < 16) {
            e.hp -= b.dmg;
            b.life = 0;
            g.burst(b.x, b.y, 5, '#c23b3b', 120);
            if (e.hp <= 0) {
              g.enemies = g.enemies.filter((x) => x !== e);
              g.stats.kills += 1;
              // Sanctioned hit (see meleeSwing): a mission target
              // draws no kill heat; the gunfire that killed them
              // still did (+1 per bullet), and bystanders still do.
              if (!e.chapterTarget) g.addHeat(14, 'kill');
              g.burst(e.x, e.y, 12, '#c23b3b', 180);
              g.dropPickup(e.x, e.y);
            }
            break;
          }
        }
        if (b.life <= 0) break;
        for (const pd of g.peds) {
          if (pd.state !== 'down' && Math.hypot(pd.x - b.x, pd.y - b.y) < 14) {
            pd.state = 'down';
            pd.downT = 0;
            b.life = 0;
            // +12, not +22: two accidental strays plus gunfire used
            // to auto-escalate a mission fight to level 4. Spraying
            // a crowd still brings the cops — just not all at once.
            g.addHeat(12, 'shootSeen');
            break;
          }
        }
        if (b.life <= 0) break;
        for (const car of g.cars) {
          if (car.dead) continue;
          if (car.id === p.carId) continue;
          if (Math.hypot(car.x - b.x, car.y - b.y) < 30) {
            // Shot cars go through the real damage path, so they can
            // catch fire and explode instead of silently dying.
            hurtCar(g, car, b.dmg * 0.6, 'player');
            b.life = 0;
            g.burst(b.x, b.y, 4, '#ffb03a', 120);
            break;
          }
        }
      } else {
        // An enemy bullet: it hits Rico, or the car he is sitting in.
        const target = p.carId !== null ? g.cars.find((c) => c.id === p.carId) : p;
        const radius = p.carId !== null ? 30 : 14;
        if (target && Math.hypot(target.x - b.x, target.y - b.y) < radius) {
          b.life = 0;
          if (p.carId !== null) {
            // Shot cars go through the real damage path: if this
            // kills the car, its fuse blows in stepVehicles and
            // traffic.js throws Rico clear of the wreck.
            hurtCar(g, target, b.dmg * 0.5, 'enemy');
          } else {
            hurtHero(g, b.dmg);
          }
        }
        if (b.life <= 0) break;
        // Enemy rounds also hit other cars, like player rounds do.
        // Pedestrians stay immune to enemy fire by design: the heat
        // model is player-attributable, and a gang bullet dropping
        // a pedestrian must not charge Rico.
        for (const car of g.cars) {
          if (car.dead) continue;
          if (car.id === p.carId) continue;
          if (Math.hypot(car.x - b.x, car.y - b.y) < 30) {
            hurtCar(g, car, b.dmg * 0.5, 'enemy');
            b.life = 0;
            g.burst(b.x, b.y, 4, '#ffb03a', 120);
            break;
          }
        }
      }
      if (b.life <= 0) break;
      b.life -= sdt;
    }
  }
  g.bullets = g.bullets.filter((b) => b.life > 0);

  // Enemies: close in, hold a firing distance, shoot with inaccuracy.
  for (const e of g.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    e.shootT -= dt;
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    const want = Math.atan2(p.y - e.y, p.x - e.x);
    e.angle = want;
    const losBlocked = bulletHitsWall(g, e.x, e.y, p.x, p.y);
    // Transient record for this tick's strafe-block check (filled
    // when line of sight is blocked, read after pushOutOfWalls).
    let strafeCheck = null;
    if (losBlocked) {
      // No line of sight: reposition to regain it instead of standing
      // still. A dead zone behind cover used to freeze an enemy in
      // place — it never moved and never fired, so any building
      // neutralised every enemy at once. Move toward the player and
      // strafe sideways at the same time: the strafe gives the
      // wall-slide a tangential component, so a head-on wall no
      // longer pins the enemy in place.
      // The strafe direction is persistent per enemy (seeded from
      // the id, so different enemies round opposite corners) and
      // flips only when the strafe is actually blocked, measured
      // below. A timer-based flip used to ping-pong a close-range
      // enemy — left two seconds, right two seconds, net zero —
      // and it never rounded the corner. A persistent strafe rounds
      // it; the block check reverses it out of a dead end.
      if (e.strafeDir === undefined) e.strafeDir = (e.id || 0) % 2 === 0 ? 1 : -1;
      const perp = want + Math.PI / 2;
      const bx = e.x;
      const by = e.y;
      // The toward push is gentler than the open-field approach
      // (60, not 95): a full-strength push into the wall pins the
      // enemy to a corner — the wall cancels the normal component
      // and the leftover drags the strafe below the block
      // threshold, so the enemy flipped just before rounding the
      // corner. A gentler push lets the strafe dominate and slide
      // the enemy around the cover.
      e.x += (Math.cos(want) * 60 + Math.cos(perp) * e.strafeDir * 55) * dt;
      e.y += (Math.sin(want) * 60 + Math.sin(perp) * e.strafeDir * 55) * dt;
      strafeCheck = { bx, by, perp, dir: e.strafeDir };
    } else if (d > 220) {
      e.x += Math.cos(want) * 95 * dt;
      e.y += Math.sin(want) * 95 * dt;
    } else if (d < 120) {
      e.x -= Math.cos(want) * 40 * dt;
      e.y -= Math.sin(want) * 40 * dt;
    }
    // Enemies collide with buildings like everyone else.
    pushOutOfWalls(g, e, 13);
    confineToWorld(e, 20);
    // Strafe-block check: measure how far the enemy actually moved
    // sideways (along the strafe axis) this tick. The toward push
    // is perpendicular to that axis, so it cannot inflate the
    // measurement. If the enemy moved less than a quarter of the
    // expected sideways distance, a wall is blocking the strafe:
    // flip after 0.3s of continuous blocking — a single-frame graze
    // must not reverse it. This is the only flip; there is no timer,
    // so a free strafe keeps going until it rounds the corner.
    if (strafeCheck) {
      const latMoved = (e.x - strafeCheck.bx) * Math.cos(strafeCheck.perp)
        + (e.y - strafeCheck.by) * Math.sin(strafeCheck.perp);
      const expected = strafeCheck.dir * 55 * dt;
      if (Math.abs(latMoved) < Math.abs(expected) * 0.25) {
        e.strafeBlockedT = (e.strafeBlockedT || 0) + dt;
        if (e.strafeBlockedT > 0.3) {
          e.strafeDir = -e.strafeDir;
          e.strafeBlockedT = 0;
        }
      } else {
        e.strafeBlockedT = 0;
      }
    }
    // Enemies only shoot when they can actually see Rico: firing on
    // distance alone let them snipe through buildings. One spread
    // source (def.spread in fireWeapon) — no extra spread here.
    // Enemy bullets are weaker than the player's (damage 7, passed
    // straight into fireWeapon).
    if (e.shootT <= 0 && d < 420 && p.hp > 0 && !losBlocked) {
      e.shootT = randIn(g.rng, 0.9, 1.7);
      e.flash = 0.08;
      fireWeapon(g, e.x, e.y, want, 'pistol', 'enemy', 7);
    }
  }
  // Enemies do not stack: two on the same ray from the player both
  // stop at the same distance and end up on the exact same spot —
  // one shared muzzle flash, and a bullet can only kill the front
  // one. A cheap O(n^2) separation pass (n is at most a handful).
  for (let i = 0; i < g.enemies.length; i += 1) {
    for (let j = i + 1; j < g.enemies.length; j += 1) {
      const a = g.enemies[i];
      const b = g.enemies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dd = Math.hypot(dx, dy);
      if (dd < 26) {
        const push = (26 - dd) / 2;
        // Coincident enemies have no direction to push along (dd 0
        // divides by zero), so they never separated. Fall back to a
        // deterministic axis chosen by id parity.
        const nx = dd > 0.01 ? dx / dd : (a.id % 2 === 0 ? 1 : -1);
        const ny = dd > 0.01 ? dy / dd : 0;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }

  // Pickups lying on the street.
  for (const pk of g.pickups) {
    // A dead player collects nothing: if Rico dies to an enemy
    // bullet mid-step, the same tick's pickup loop used to set hp
    // 0 to 40. Respawn resets hp to 100 anyway, so this is
    // defensive only — but a corpse looting health packs is wrong.
    if (p.hp <= 0) break;
    if (Math.hypot(pk.x - p.x, pk.y - p.y) < 26) {
      pk.taken = true;
      if (pk.kind === 'health') {
        p.hp = clamp(p.hp + 40, 0, 100);
        g.toast('Picked up a health pack (+40 HP)');
      } else if (pk.kind === 'armor') {
        p.armor = clamp(p.armor + 50, 0, 100);
        g.toast('Picked up armor (+50)');
      } else if (pk.kind === 'ammo') {
        // Guard p.ammo: reloadWeapon guards this exact field, so it
        // can be absent on a save or debug path that omits it — an
        // unguarded write here would throw mid-tick.
        if (!p.ammo) p.ammo = {};
        p.ammo.pistol = (p.ammo.pistol || 0) + 48;
        g.toast('Picked up pistol ammo (+48)');
      } else if (pk.kind === 'cash') {
        p.cash += 60;
        g.audio.cash();
        g.toast('Found $60');
      }
      g.audio.pickup();
    }
  }
  g.pickups = g.pickups.filter((pk) => !pk.taken);
}

export function reloadWeapon(g) {
  const p = g.player;
  const def = GUN_DEFS[p.weapon];
  if (!def || def.mag === Infinity) return;
  const need = def.mag - magOf(p, p.weapon);
  if (need <= 0) return;
  const have = (p.ammo && p.ammo[p.weapon]) || 0;
  const take = Math.min(need, have);
  if (take <= 0) {
    g.toast(`No ${def.label} ammo — visit Bay Arms`);
    return;
  }
  p.ammo[p.weapon] = have - take;
  setMag(p, p.weapon, magOf(p, p.weapon) + take);
  g.audio.blip();
}

// Cycle to the next (index +1) or previous (index -1) owned weapon.
export function switchWeapon(g, index) {
  const p = g.player;
  const list = ownedList(g);
  const cur = list.indexOf(p.weapon);
  const next = list[(cur + index + list.length) % list.length];
  if (!next) return;
  p.weapon = next;
  // The new weapon keeps its own magazine (per-weapon mags): the old
  // shared-magazine clamp laundered rounds between guns.
  const def = GUN_DEFS[p.weapon];
  if (def.mag !== Infinity && magOf(p, p.weapon) === 0) reloadWeapon(g);
  // The fire timer belongs to the new weapon: the old shared fireT
  // let a rifle-to-shotgun swap fire almost immediately (bypassing
  // the shotgun's longer cooldown) and a shotgun-to-rifle swap lock
  // the player out for the old weapon's cooldown. Switching costs
  // the new weapon's own fire interval.
  p.fireT = def.rate || 0;
}

export function openWheel(g) {
  if (!g.wheel) g.wheel = { open: false, slot: 0 };
  g.wheel.open = true;
  const cur = WHEEL_ORDER.indexOf(g.player.weapon);
  g.wheel.slot = cur >= 0 ? cur : 0;
}

// Release closes the wheel and switches to the picked slot. A locked
// slot can never be the picked one (pickWheel refuses it), but the
// ownership check here is the backstop.
export function closeWheel(g) {
  if (!g.wheel || !g.wheel.open) return;
  g.wheel.open = false;
  const picked = WHEEL_ORDER[g.wheel.slot];
  const owned = g.player.owned || [];
  if (picked && picked !== g.player.weapon && owned.includes(picked)) {
    g.player.weapon = picked;
    const def = GUN_DEFS[picked];
    if (def.mag !== Infinity && magOf(g.player, picked) === 0) reloadWeapon(g);
    // Same fire-timer rule as switchWeapon: the timer belongs to the
    // new weapon, so a wheel pick cannot bypass its cooldown or
    // inherit the old weapon's.
    g.player.fireT = def.rate || 0;
  }
}

// Pick a wheel slot (0-based into the full 5-slot wheel order). Locked
// (unowned) slots are refused — the wheel shows them greyed out, it
// never switches to them. Applies on release.
export function pickWheel(g, index) {
  if (!g.wheel || !g.wheel.open) return;
  if (index >= 0 && index < WHEEL_ORDER.length
    && (g.player.owned || []).includes(WHEEL_ORDER[index])) {
    g.wheel.slot = index;
  }
}
