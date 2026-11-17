// Combat: guns, bullets, gang enemies and pickups. Shooting works on foot
// and as a drive-by from the car. Enemies are simple but fair: they walk
// toward the player, shoot with spread, and telegraph with a muzzle flash.
import { GUN_DEFS } from './data.js';
import { clamp, range } from './random.js';
import { hurtPlayer } from './player.js';

let nextEnemyId = 1;

export function makeEnemy(g, x, y) {
  const e = {
    id: nextEnemyId, x, y, hp: 70, angle: 0,
    shootT: range(g.rng, 0.5, 1.4), moveT: 0, flash: 0,
  };
  nextEnemyId += 1;
  return e;
}

export function fireWeapon(g, fromX, fromY, angle, weapon, owner) {
  const def = GUN_DEFS[weapon];
  if (!def || def.speed === 0) return false; // fists handled by melee
  const shots = def.pellets || 1;
  for (let i = 0; i < shots; i += 1) {
    const a = angle + range(g.rng, -def.spread, def.spread);
    g.bullets.push({
      x: fromX + Math.cos(angle) * 22, y: fromY + Math.sin(angle) * 22,
      vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed,
      life: def.range / def.speed, dmg: def.dmg, owner,
    });
  }
  g.burst(fromX + Math.cos(angle) * 26, fromY + Math.sin(angle) * 26, 3, '#ffd76a', 160);
  g.audio.shot();
  return true;
}

export function meleeSwing(g, fromX, fromY, angle) {
  const p = g.player;
  let hitAny = false;
  const targets = [...g.enemies, ...g.peds.filter((pd) => pd.state !== 'down')];
  for (const t of targets) {
    const d = Math.hypot(t.x - fromX, t.y - fromY);
    if (d < 46) {
      if (t.hp !== undefined) {
        t.hp -= 16;
        if (t.hp <= 0) {
          g.enemies = g.enemies.filter((e) => e !== t);
          g.stats.kills += 1;
          g.addHeat(30, 'kill');
        }
      } else {
        t.state = 'down';
        t.downT = 0;
        g.addHeat(16, 'hitPed');
      }
      hitAny = true;
    }
  }
  g.audio.blip();
  return hitAny;
}

export function stepCombat(g, dt, shooting, aimAngle) {
  const p = g.player;
  p.fireT = Math.max(0, (p.fireT || 0) - dt);

  if (shooting && p.fireT <= 0 && p.hp > 0) {
    const def = GUN_DEFS[p.weapon];
    const inCar = p.carId !== null;
    const ox = inCar ? (g.cars.find((c) => c.id === p.carId) || p).x : p.x;
    const oy = inCar ? (g.cars.find((c) => c.id === p.carId) || p).y : p.y;
    if (p.weapon === 'fists') {
      meleeSwing(g, ox, oy, aimAngle);
      p.fireT = def.rate;
    } else if (p.mag > 0) {
      fireWeapon(g, ox, oy, aimAngle, p.weapon, 'player');
      p.mag -= 1;
      p.fireT = def.rate;
      if (g.wanted.level >= 1 || g.enemies.length > 0) g.addHeat(1, 'shoot');
      else g.addHeat(1, 'shoot'); // gunfire draws eyes, one shot at a time
      // Scare the street.
      g.scarePeds(g, ox, oy, 320);
    } else {
      p.fireT = 0.3;
      g.toast('Magazine empty — press R to reload');
    }
  }

  // Bullets fly and hit things.
  for (const b of g.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0) continue;
    if (b.owner === 'player') {
      for (const e of g.enemies) {
        if (Math.hypot(e.x - b.x, e.y - b.y) < 16) {
          e.hp -= b.dmg;
          b.life = 0;
          g.burst(b.x, b.y, 5, '#c23b3b', 120);
          if (e.hp <= 0) {
            g.enemies = g.enemies.filter((x) => x !== e);
            g.stats.kills += 1;
            g.addHeat(14, 'kill');
            g.burst(e.x, e.y, 12, '#c23b3b', 180);
            g.dropPickup(e.x, e.y);
          }
          break;
        }
      }
      if (b.life <= 0) continue;
      for (const pd of g.peds) {
        if (pd.state !== 'down' && Math.hypot(pd.x - b.x, pd.y - b.y) < 14) {
          pd.state = 'down';
          pd.downT = 0;
          b.life = 0;
          g.addHeat(22, 'shootSeen');
          break;
        }
      }
      if (b.life <= 0) continue;
      for (const car of g.cars) {
        if (car.dead) continue;
        const inPlayerCar = car.id === p.carId;
        if (inPlayerCar) continue;
        if (Math.hypot(car.x - b.x, car.y - b.y) < 30) {
          car.hp -= b.dmg * 0.6;
          b.life = 0;
          g.burst(b.x, b.y, 4, '#ffb03a', 120);
          if (car.hp <= 0) {
            car.hp = 0;
            car.dead = true;
            g.burst(car.x, car.y, 24, '#ff9a3d', 260);
          }
          break;
        }
      }
    } else {
      const target = p.carId !== null ? g.cars.find((c) => c.id === p.carId) : p;
      const radius = p.carId !== null ? 30 : 14;
      if (target && Math.hypot(target.x - b.x, target.y - b.y) < radius) {
        b.life = 0;
        if (p.carId !== null) {
          target.hp -= b.dmg * 0.5;
          if (target.hp <= 0) {
            target.hp = 0;
            target.dead = true;
            g.burst(target.x, target.y, 24, '#ff9a3d', 260);
            p.carId = null;
            p.x = target.x + 50;
            p.y = target.y + 40;
          }
        } else {
          hurtPlayer(g, b.dmg);
        }
      }
    }
  }
  g.bullets = g.bullets.filter((b) => b.life > 0);

  // Enemies: close in, shoot with inaccuracy.
  for (const e of g.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    e.shootT -= dt;
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    const want = Math.atan2(p.y - e.y, p.x - e.x);
    e.angle = want;
    if (d > 220) {
      e.x += Math.cos(want) * 95 * dt;
      e.y += Math.sin(want) * 95 * dt;
    } else if (d < 120) {
      e.x -= Math.cos(want) * 40 * dt;
      e.y -= Math.sin(want) * 40 * dt;
    }
    if (e.shootT <= 0 && d < 420 && p.hp > 0) {
      e.shootT = range(g.rng, 0.9, 1.7);
      e.flash = 0.08;
      const spread = range(g.rng, -0.14, 0.14);
      fireWeapon(g, e.x, e.y, want + spread, 'pistol', 'enemy');
      // Enemy bullets are weaker than the player's.
      const b = g.bullets[g.bullets.length - 1];
      if (b) b.dmg = 7;
    }
  }

  // Pickups.
  for (const pk of g.pickups) {
    if (Math.hypot(pk.x - p.x, pk.y - p.y) < 26) {
      pk.taken = true;
      if (pk.kind === 'health') {
        p.hp = clamp(p.hp + 40, 0, 100);
        g.toast('Picked up a health pack (+40 HP)');
      } else if (pk.kind === 'armor') {
        p.armor = clamp(p.armor + 50, 0, 100);
        g.toast('Picked up armor (+50)');
      } else if (pk.kind === 'ammo') {
        p.ammo.pistol += 48;
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
  const need = def.mag - p.mag;
  if (need <= 0) return;
  const have = p.ammo[p.weapon] || 0;
  const take = Math.min(need, have);
  if (take <= 0) {
    g.toast(`No ${def.label} ammo — visit Bay Arms`);
    return;
  }
  p.ammo[p.weapon] = have - take;
  p.mag += take;
  g.audio.blip();
}

export function switchWeapon(g, index) {
  const p = g.player;
  const list = p.owned && p.owned.length > 0 ? p.owned : ['fists', 'pistol'];
  const cur = list.indexOf(p.weapon);
  p.weapon = list[(cur + index + list.length) % list.length];
  const def = GUN_DEFS[p.weapon];
  if (def.mag !== Infinity && (p.mag === undefined || p.mag === null)) p.mag = 0;
  if (p.weapon !== 'fists' && p.mag === 0) reloadWeapon(g);
}
