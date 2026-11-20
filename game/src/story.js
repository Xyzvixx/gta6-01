// Vice Bay — story and progression, rewritten in-session (v2 rebuild).
//
// One module owns every progression layer, and the layers are kept
// deliberately different in what they DO, not just in what they are
// called (design section 8):
//
//   * RESPECT is a gate. It unlocks content — ranks, shop stock, the
//     garage discount — but it never changes the world itself. Earning
//     respect opens doors; it does not repaint the streets.
//   * STANDING is the world. A district's standing decides which side
//     jobs exist there, and crossing a standing milestone makes the
//     street talk (respect follows, it does not lead). Standing is
//     earned where Rico stands, and it is spent nowhere else.
//   * CREW is a decision. Each ability has a cooldown and the crew
//     holds exactly ONE active ability at a time: firing the lookout
//     while the driver is working is refused, not queued. The choice
//     of when to spend the crew is the gameplay.
//   * The GARAGE is the competing sink: the same cash that could buy
//     standing-friendly work or save for the next chapter goes into
//     the car instead. The layers compete for one wallet.
//
// Chapters are transactional: validate, apply once, clean up owned
// entities, persist — so a bust, a death and a completion can never
// fire on the same tick. Completion persists SYNCHRONOUSLY (see
// persistNow): a chapter reward must survive the player closing the
// tab a second later, not wait for the next autosave window.
import { DISTRICTS, GARAGE_DEFS, JOB_DEFS, RESPECT_RANKS, STORY, STORY_LINES } from './content.js';
import { clamp } from './dice.js';
import { makeEnemy } from './fight.js';
import { releaseCopCars } from './cops.js';
import { makeCar, snapCarToRoad } from './traffic.js';
import { heroCar } from './hero.js';
import { writeSave } from './store.js';

// Garage price table used only when the content table cannot resolve a
// number. Same contract prices as the shop definitions.
const GARAGE_FALLBACK = {
  engine: [300, 700, 1400],
  armor: [250, 600, 1200],
  nitro: [200, 500, 1000],
};

// Standing a district job needs before it can start. The numbers live
// in the job definitions (JOB_DEFS.<kind>.standing); these literals are
// the fallback when a definition is missing its standing field.
const JOB_STANDING_FALLBACK = { taxi: 25, race: 50, food: 75 };

// Standing bar at which a district's street starts talking.
const STANDING_MILESTONES = [50, 75];
// Respect paid when a district first crosses a milestone.
const MILESTONE_RESPECT = 50;
// Standing earned in the district where a stage is completed.
const STAGE_STANDING = 8;
// Standing earned in the district where a side job is completed.
const JOB_STANDING = 5;

// Side-job waypoints. All of them sit inside the world, on or near roads.
const TAXI_PICKUPS = [
  { x: 1100, y: 600, label: 'Fare pickup' },
  { x: 1900, y: 1650, label: 'Fare pickup' },
  { x: 700, y: 2000, label: 'Fare pickup' },
  { x: 2300, y: 950, label: 'Fare pickup' },
];
const TAXI_DROPS = [
  { x: 2700, y: 950, label: 'Fare drop-off' },
  { x: 1500, y: 250, label: 'Fare drop-off' },
  { x: 300, y: 1300, label: 'Fare drop-off' },
  { x: 2700, y: 2000, label: 'Fare drop-off' },
];
const RACE_POINTS = [
  { x: 1500, y: 1300, label: 'Checkpoint 1' },
  { x: 2300, y: 600, label: 'Checkpoint 2' },
  { x: 1100, y: 2000, label: 'Finish' },
];
const FOOD_STOPS = [
  { x: 1100, y: 250, label: 'Food stop 1' },
  { x: 2300, y: 2000, label: 'Food stop 2' },
  { x: 2700, y: 1650, label: 'Food stop 3' },
];

// Squared distance — the callers only ever compare against a squared
// radius, so the square root is skipped on purpose.
function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

// District id / name at a world point, or null outside every district.
function districtIdAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d.id;
  }
  return null;
}

function districtNameAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d.name;
  }
  return 'Vice Bay';
}

// District name by id (used for toasts about a district Rico is not
// standing in — the finale surge fires for all six at once).
function districtName(id) {
  const d = DISTRICTS.find((x) => x.id === id);
  return d ? d.name : 'Vice Bay';
}

// Standing a job kind needs in its district. Read from the job
// definition first so content and gate can never drift apart.
function jobStandingNeeded(kind) {
  const def = JOB_DEFS ? JOB_DEFS[kind] : null;
  if (def && typeof def.standing === 'number') return def.standing;
  return JOB_STANDING_FALLBACK[kind];
}

function say(g, line) {
  if (line) g.toast(line);
}

// --- Immediate persistence -----------------------------------------------
// Chapter completion used to set saveSoon and trust the engine's
// deferred autosave (up to a second later, or up to 60s if the flag was
// already consumed). Closing the page in that window lost the chapter.
// So a completed chapter is written to storage RIGHT HERE, synchronously,
// before the next chapter starts. writeSave returns false (never throws)
// when storage is unavailable; on failure the deferred flag stays set so
// the engine retries, and the player is warned once per session — the
// same warning discipline as the engine's autosave block.
function persistNow(g) {
  let ok = false;
  try {
    ok = writeSave(g);
  } catch (e) {
    ok = false;
  }
  if (ok) {
    g.saveSoon = false;
    g.saveWarned = false;
    return true;
  }
  g.saveSoon = true;
  if (!g.saveWarned && typeof g.toast === 'function') {
    g.saveWarned = true;
    g.toast('Autosave failed — storage unavailable');
  }
  return false;
}

// --- Crew clock ------------------------------------------------------------
// The crew's timers live here and are ticked here, once per play tick
// from updateChapters. Nothing else in the game decays driverCd,
// lookoutCd, the active ability's remaining time, or the lookout ping —
// without this tick the driver could only ever be used once per session
// (a 60s cooldown that never counted down) and a fired ability would
// stay "active" forever. The tick is what makes cooldowns real decisions
// instead of one-shot buttons.
function tickCrew(g, dt) {
  const crew = g.crew;
  if (!crew) return;
  if (crew.driverCd > 0) crew.driverCd = Math.max(0, crew.driverCd - dt);
  if (crew.lookoutCd > 0) crew.lookoutCd = Math.max(0, crew.lookoutCd - dt);
  if (crew.pingT > 0) crew.pingT = Math.max(0, crew.pingT - dt);
  if (crew.active && typeof crew.active.t === 'number') {
    crew.active.t -= dt;
    if (crew.active.t <= 0) crew.active = null;
  }
}

// Is a crew ability currently running? The crew holds one active ability
// at a time; a live one blocks the other from firing.
function crewBusy(crew) {
  return !!(crew && crew.active && (crew.active.t === undefined || crew.active.t > 0));
}

// --- Chapter HUD -----------------------------------------------------------
export function currentChapter(g) {
  if (g.chapter === undefined || g.chapter < 0 || g.chapter >= STORY.length) return null;
  return STORY[g.chapter];
}

export function currentStage(g) {
  const ch = currentChapter(g);
  if (!ch) return null;
  return ch.stages[g.stage] || null;
}

export function chapterText(g) {
  const stage = currentStage(g);
  if (stage) {
    if (stage.kind === 'kill') {
      const done = g.chapterData.kills || 0;
      // The fallback is `count || 3`, matching the completion check:
      // a count-less kill stage still needs 3 kills, so the HUD must
      // show (0/3), never (0/0).
      const count = stage.count || 3;
      return stage.text.replace(/\(\d+\/\d+\)/, `(${done}/${count})`);
    }
    if (stage.kind === 'escape') {
      // Countdown uses count OR duration: the c5 survival stage is
      // duration-only, so a bare `stage.count` gate showed no timer.
      const need = stage.count || stage.duration || 0;
      if (!need) return stage.text;
      const held = g.chapterData.holdT || 0;
      const left = Math.max(0, Math.ceil(need - held));
      return left > 0 ? `${stage.text} (${left}s)` : stage.text;
    }
    if (stage.kind === 'chase') {
      const held = g.chapterData.chaseT || 0;
      // Same `count || duration` as the completion check: the stages
      // are duration-authored, so `count || 12` would show them done
      // 8s early.
      const need = stage.count || stage.duration || 12;
      return `${stage.text} (${Math.min(need, Math.floor(held))}/${need}s)`;
    }
    if (stage.kind === 'tail') {
      const held = g.chapterData.tailT || 0;
      const need = stage.count || stage.duration || 20;
      return `${stage.text} (${Math.min(need, Math.floor(held))}/${need}s)`;
    }
    return stage.text;
  }
  if (g.job) return jobText(g);
  if (g.chapter >= STORY.length) {
    return 'Free roam — take a taxi, race, or food job. Press E near a shop.';
  }
  return '';
}

export function jobText(g) {
  const j = g.job;
  if (!j) return '';
  if (j.kind === 'taxi') {
    return j.phase === 'pickup' ? 'Taxi: pick up the fare' : 'Taxi: drop off the fare';
  }
  if (j.kind === 'race') {
    return `Race: checkpoint ${j.cp + 1}/3 — ${Math.ceil(j.timeLeft)}s left`;
  }
  if (j.kind === 'food') {
    return `Food run: delivery ${j.stop + 1}/3`;
  }
  return '';
}

// Where the HUD arrow / minimap route should point, if anywhere.
export function activeWaypoint(g) {
  const stage = currentStage(g);
  if (stage) {
    // Chase/tail stages point at the LIVE car, not its spawn point:
    // pointing at the spawn would lead the arrow to an empty street
    // while the target drives away. Fall through to stage.target if
    // the car is gone.
    if (stage.kind === 'chase' && g.chapterData.chaseCarId) {
      const car = g.cars.find((c) => c.id === g.chapterData.chaseCarId);
      if (car) return { x: car.x, y: car.y };
    }
    if (stage.kind === 'tail' && g.chapterData.tailCarId) {
      const car = g.cars.find((c) => c.id === g.chapterData.tailCarId);
      if (car) return { x: car.x, y: car.y };
    }
    if (stage.target) return stage.target;
  }
  if (g.job) {
    if (g.job.kind === 'taxi') return g.job.phase === 'pickup' ? g.job.pickup : g.job.dropoff;
    if (g.job.kind === 'race') return g.job.points[g.job.cp];
    if (g.job.kind === 'food') return g.job.stops[g.job.stop];
  }
  return null;
}

// --- Chapter lifecycle -----------------------------------------------------
export function startChapter(g, index) {
  const ch = STORY[index];
  if (!ch) return;
  g.chapter = index;
  g.stage = 0;
  g.chapterData = {};
  g.enemies = [];
  // A fresh chapter starts with no leftover stage cars and no stale
  // finale panel: clearStageTarget stops an invincible mission-target
  // car leaking across chapters, and a replayed c8 after the finale
  // must recompute its results instead of reusing the old object.
  clearStageTarget(g);
  g.results = null;
  g.chapterTitle = ch.title;
  say(g, STORY_LINES[`${ch.id}_start`]);
  // Chapters that open under heat: the pursuit IS the mission.
  if (ch.id === 'c3') {
    g.wanted.heat = 55;
    g.wanted.calmT = 8;
  } else if (ch.id === 'c5') {
    g.wanted.heat = 70;
    g.wanted.calmT = 8;
  } else if (ch.id === 'c8') {
    g.wanted.heat = 85;
    g.wanted.calmT = 8;
  }
  setupStage(g, ch.stages[0]);
  // The finale clock starts when c8 starts, so the finale rank can be
  // scored on real elapsed time. A fail/retry restarts the chapter and
  // therefore restarts the clock.
  if (ch.id === 'c8' && typeof g.time === 'number') {
    g.chapterData.finaleStartT = g.time;
  }
}

// Prepare whatever a stage needs: enemies for a kill stage, a moving
// target car for chase/tail stages.
function setupStage(g, stage) {
  if (!stage) return;
  // Every stage starts its timers at zero — including the escape hold
  // timer, which would otherwise start a second escape stage in one
  // chapter pre-charged.
  g.chapterData.holdT = 0;
  if (stage.kind === 'kill') {
    g.chapterData.kills = 0;
    g.chapterData.killBase = g.stats.kills;
    const sp = stage.spawn || { x: 420, y: 1850 };
    for (let i = 0; i < (stage.count || 3); i += 1) {
      // Chapter targets are tagged: only THEIR deaths count toward the
      // objective. A global kill delta would let unrelated kills (a
      // random ped, a cop in a chase) satisfy the stage.
      const e = makeEnemy(
        g,
        sp.x + (i - 1) * 46 + Math.floor(g.rng() * 20) - 10,
        sp.y + (i % 2) * 40 - 20,
      );
      e.chapterTarget = true;
      g.enemies.push(e);
    }
    g.toast('Tiburones crew — take them all down!');
  } else if (stage.kind === 'chase') {
    spawnStageCar(g, stage, 'comet', 'chase');
  } else if (stage.kind === 'tail') {
    spawnStageCar(g, stage, 'vano', 'tail');
    g.toast('Tail the courier — get too close and they will spot you.');
  }
}

// Spawn the moving target car for a chase or tail stage, parked exactly
// on its authored spawn and then eased onto the nearest road. makeCar's
// traffic placement overwrites the spawn with a random road position,
// so the spawn is restored FIRST and the snap only sets road/line/lane
// from the current position — it never teleports the car.
function spawnStageCar(g, stage, type, mode) {
  const sp = stage.spawn || { x: g.player.x + (mode === 'chase' ? 200 : 260), y: g.player.y };
  const car = makeCar(g, type, sp.x, sp.y, 0, 'traffic');
  car.x = sp.x;
  car.y = sp.y;
  car.angle = 0;
  snapCarToRoad(g, car);
  car.missionTarget = true; // armoured: cannot be destroyed mid-stage
  if (mode === 'chase') {
    car.chaseTarget = true;
    g.chapterData.chaseCarId = car.id;
    g.chapterData.chaseT = 0;
  } else {
    car.tailTarget = true;
    g.chapterData.tailCarId = car.id;
    g.chapterData.tailT = 0;
  }
  g.cars.push(car);
  return car;
}

// A chase/tail target car is armoured and preserved by maintainTraffic,
// so it must be removed explicitly when its stage ends — otherwise
// indestructible target cars accumulate across every fail/retry and
// every stage advance. A car Rico is currently driving is never pulled
// out from under him: its flags are cleared and it becomes ordinary
// traffic instead.
function clearStageTarget(g) {
  if (g.chapterData) {
    g.chapterData.chaseCarId = null;
    g.chapterData.tailCarId = null;
  }
  g.cars = g.cars.filter((c) => {
    if (!c.chaseTarget && !c.tailTarget) return true;
    // String comparison, like buyUpgrade: ids are numbers today, but a
    // type drift must never delete the car Rico is driving.
    if (String(c.id) === String(g.player.carId)) {
      c.chaseTarget = false;
      c.tailTarget = false;
      c.missionTarget = false;
      return true;
    }
    return false;
  });
}

// Move to the next stage, or finish the chapter. Standing in the
// district where the stage was completed goes up — the street notices
// work done on its own corners.
function advanceStage(g) {
  const ch = currentChapter(g);
  if (!ch) return;
  const here = districtIdAt(g.player.x, g.player.y);
  if (here) addStanding(g, here, STAGE_STANDING);
  clearStageTarget(g);
  g.stage += 1;
  if (g.stage >= ch.stages.length) {
    completeChapter(g, ch);
    return;
  }
  const next = ch.stages[g.stage];
  const mid = STORY_LINES[`${ch.id}_mid`];
  if (mid && g.stage === 1) say(g, mid);
  setupStage(g, next);
}

// --- Chapter completion ----------------------------------------------------
export function completeChapter(g, ch) {
  // Transactional + idempotent: a chapter pays out exactly once. The
  // _settled guard covers repeat observations within one tick; the
  // chaptersDone check covers REPLAYING a finished chapter — startChapter
  // resets the scratch state, so _settled alone is not enough, and
  // without this a player could farm $300 by replaying chapter 1 forever.
  if (!ch || g.chapter < 0 || STORY[g.chapter] !== ch) return;
  if (!g.chapterData) g.chapterData = {};
  if (g.chapterData._settled) return;
  g.chapterData._settled = true;
  const firstTime = !g.chaptersDone.includes(ch.id);
  if (firstTime) g.chaptersDone.push(ch.id);
  if (firstTime) {
    g.player.cash += ch.reward;
    g.stats.chapters += 1;
    g.audio.cash();
    g.toast(`${ch.title} complete! +$${ch.reward}`);
    addRespect(g, ch.respect || 0);
    // Chapter-specific rewards, first completion only.
    if (ch.id === 'c2') {
      g.player.ammo.smg += 90;
      if (!g.player.owned.includes('smg')) g.player.owned.push('smg');
      g.toast('Mara gave you a VB-9 SMG');
    }
    if (ch.id === 'c4') {
      g.crew.driver = true;
      g.toast('Crew: the getaway driver joined you (press G in a car)');
    }
    if (ch.id === 'c7') {
      g.crew.lookout = true;
      g.toast('Crew: the lookout joined you (press H to sweep for police)');
    }
    if (ch.id === 'c8') {
      // Freeze the finale clock before the next chapter wipes the
      // scratch state: the rank below and the engine's later live
      // recompute both read g.finaleSecs.
      stashFinaleTime(g);
      g.finaleRank = finaleRank(g);
      // The results panel's $3,000 / +800 respect are the chapter
      // reward already paid above (ch.reward / ch.respect) — this block
      // must NOT pay them again. It only adds the finale's standing
      // surge and the rank; the engine's results block only displays
      // them. The Bay notices: every district's standing surges on the
      // finale, so the results bars visibly celebrate instead of ending
      // flat.
      for (const d of DISTRICTS) addStanding(g, d.id, 15);
      g.toast(`${g.finaleRank}-RANK — The Last Job is done. Vice Bay is yours, Rico.`);
    }
  } else {
    g.toast(`${ch.title} complete! (reward already claimed)`);
  }
  // The finale rank is recomputed on EVERY c8 completion, not just the
  // first: a replay with more deaths must show the rank actually earned,
  // and the engine's results block reads it live. The standing surge
  // above stays first-time-only.
  if (ch.id === 'c8') {
    stashFinaleTime(g);
    g.finaleRank = finaleRank(g);
  }
  say(g, STORY_LINES[`${ch.id}_done`]);
  clearStageTarget(g);
  g.enemies = [];
  // Hand off to the next chapter before clearing the scratch state.
  const nextIndex = g.chapter + 1;
  if (nextIndex < STORY.length) {
    startChapter(g, nextIndex);
  } else {
    g.chapter = nextIndex;
    g.stage = 0;
    g.chapterData = {};
    g.chapterTitle = '';
  }
  // Persist NOW, after the handoff, so the saved chapter index is the
  // chapter Rico is actually about to play — the same index the old
  // deferred autosave would eventually have written, but without the
  // window in which closing the page lost the completion. (Fix a.)
  persistNow(g);
}

// Copy the finale's elapsed seconds out of the per-chapter scratch state
// and onto the game object, where it survives the next chapter's reset.
function stashFinaleTime(g) {
  if (typeof g.finaleSecs === 'number') return;
  const started = g.chapterData && g.chapterData.finaleStartT;
  if (typeof started === 'number' && typeof g.time === 'number') {
    g.finaleSecs = Math.max(0, g.time - started);
  }
}

// Finale grade, scored from the actual run — never a fixed letter.
// Points start at 100 and the run spends them:
//   deaths ......... -12 each (capped at -60): dying is the messiest
//                     thing a finale run can do.
//   wanted ......... -5 per wanted star above 2 (capped at -20): going
//                     loud enough to pull the whole Bay down on Rico.
//   finale time .... +10 for a fast, clean finale (<= 4 min), -10 past
//                     7 min, -20 past 10 min; unknown when the clock was
//                     never started (e.g. a reloaded save), so it scores 0.
//   side work ...... +5 when the run's kills + jobs show Rico worked the
//                     city on the way up (40+ weighted actions).
// Thresholds: 90+ S, 75+ A, 55+ B, anything less C. A flawless run earns
// S; a run that dies twice but stays quiet still earns A; a run that
// dies four times and drags the whole Bay into a siege earns C.
export function finaleRank(g) {
  const stats = g.stats || {};
  const deaths = stats.deaths || 0;
  const topWanted = stats.topWanted || 0;
  const kills = stats.kills || 0;
  const jobs = stats.jobs || 0;
  let points = 100;
  points -= Math.min(60, 12 * deaths);
  points -= Math.min(20, 5 * Math.max(0, topWanted - 2));
  const secs = typeof g.finaleSecs === 'number' ? g.finaleSecs : finaleSeconds(g);
  if (typeof secs === 'number') {
    if (secs <= 240) points += 10;
    else if (secs > 600) points -= 20;
    else if (secs > 420) points -= 10;
  }
  if (kills + jobs * 4 >= 40) points += 5;
  points = clamp(points, 0, 110);
  if (points >= 90) return 'S';
  if (points >= 75) return 'A';
  if (points >= 55) return 'B';
  return 'C';
}

// Finale seconds from the live chapter scratch state, when c8 is still
// the active chapter. After the handoff the stashed g.finaleSecs is used
// instead (see stashFinaleTime).
function finaleSeconds(g) {
  const started = g.chapterData && g.chapterData.finaleStartT;
  if (typeof started === 'number' && typeof g.time === 'number') {
    return Math.max(0, g.time - started);
  }
  return null;
}

// A bust / death fails the active chapter but never ends the run: the
// story restarts at the same chapter's first stage, heat cleared by the
// engine's wasted/busted handling.
export function failChapter(g, reason) {
  if (g.chapter >= 0 && g.chapter < STORY.length) {
    g.toast(`Chapter failed (${reason}) — try again`);
    if (g.job) g.toast('Side job cancelled — the chapter failed');
    g.enemies = [];
    g.job = null;
    clearStageTarget(g);
    const idx = g.chapter;
    g.chapter = -1;
    startChapter(g, idx);
  } else {
    g.job = null;
  }
}

// --- Chapter tick ----------------------------------------------------------
export function updateChapters(g, dt, pressedE) {
  tickCrew(g, dt);
  const stage = currentStage(g);
  if (stage) {
    if (stage.kind === 'reach' || stage.kind === 'escape') {
      // Returns true only when the stage already ran the job update
      // itself (holding at the target while the survival clock runs);
      // every other path falls through to the shared updateJob below.
      if (tickReachStage(g, dt, pressedE, stage)) return;
    } else if (stage.kind === 'kill') {
      tickKillStage(g, stage);
    } else if (stage.kind === 'chase') {
      tickChaseStage(g, dt, stage);
    } else if (stage.kind === 'tail') {
      tickTailStage(g, dt, stage);
    }
  }
  updateJob(g, dt, pressedE);
}

// Reach / escape stages. Survival time comes from `count` or `duration`
// (the STORY authors `duration`); 0 means "just reach the target".
// Returns true when the caller must NOT run updateJob again.
function tickReachStage(g, dt, pressedE, stage) {
  const p = g.player;
  const t = stage.target;
  const r = stage.radius || 70;
  const surviveFor = stage.count || stage.duration || 0;
  if (stage.kind === 'escape' && !t && surviveFor > 0) {
    // Pure survival stage (no target, e.g. c5 "Survive 90 seconds"):
    // hold out for the duration, then the heat clears and the stage
    // advances. Without this branch the stage could never complete.
    g.chapterData.holdT = (g.chapterData.holdT || 0) + dt;
    if ((g.chapterData.holdT || 0) >= surviveFor) {
      clearHeat(g);
      advanceStage(g);
    }
    return false;
  }
  if (t && distSq(p.x, p.y, t.x, t.y) < r * r) {
    if (stage.kind === 'escape' && surviveFor > 0) {
      // Survival stages: hold out for `surviveFor` seconds first.
      g.chapterData.holdT = (g.chapterData.holdT || 0) + dt;
      if (g.chapterData.holdT < surviveFor) {
        updateJob(g, dt, pressedE);
        return true;
      }
    }
    if (stage.pressE) {
      if (pressedE) {
        // No say() here: advanceStage says the mid-chapter line when it
        // reaches stage 1, and saying it here too doubled the toast.
        advanceStage(g);
      }
    } else {
      if (stage.kind === 'escape') clearHeat(g);
      advanceStage(g);
    }
  } else if (stage.kind === 'escape' && surviveFor > 0) {
    // Outside the target the survival clock DRAINS (like the chase
    // timer): holding the clock out here would let a target-plus-
    // duration escape complete without the player ever standing at
    // the target. Pure-survival stages (no target) are handled by the
    // branch above and are unaffected.
    g.chapterData.holdT = Math.max(0, (g.chapterData.holdT || 0) - dt);
  }
  return false;
}

// Clear all wanted heat AND release the pursuit cars back to traffic
// before emptying the cop list: the level-0 sweep iterates g.cops, so
// clearing the list first would orphan the patrol cars as frozen
// role-'police' traffic.
function clearHeat(g) {
  g.wanted.heat = 0;
  g.wanted.level = 0;
  releaseCopCars(g);
  g.cops = [];
}

// Kill stages. Only chapter-target deaths count: targets still alive
// are subtracted from the stage total, so unrelated kills elsewhere in
// the city never satisfy the objective.
function tickKillStage(g, stage) {
  const total = stage.count || 3;
  const alive = g.enemies.filter((e) => e.chapterTarget).length;
  const done = total - alive;
  g.chapterData.kills = done;
  if (done >= total) advanceStage(g);
}

// Chase stages. The timer fills while Rico stays near the target and
// drains while he falls behind — and driving the target car himself is
// not chasing it, so that drains the timer too.
function tickChaseStage(g, dt, stage) {
  const p = g.player;
  const car = g.cars.find((c) => c.id === g.chapterData.chaseCarId);
  if (!car || car.dead) {
    failChapter(g, 'lost the target');
    return;
  }
  const r = stage.radius || 150;
  const d = Math.hypot(p.x - car.x, p.y - car.y);
  if (p.carId === car.id) {
    g.chapterData.chaseT = Math.max(0, (g.chapterData.chaseT || 0) - dt);
  } else if (d < r) {
    g.chapterData.chaseT = (g.chapterData.chaseT || 0) + dt;
  } else {
    g.chapterData.chaseT = Math.max(0, (g.chapterData.chaseT || 0) - dt);
  }
  if ((g.chapterData.chaseT || 0) >= (stage.count || stage.duration || 12)) advanceStage(g);
}

// Tail stages. Tailing a parked courier — or one Rico is driving — is
// not tailing: the timer only fills while the courier moves under its
// own power and Rico holds the 100–320px band. Crowding the courier
// spots Rico: no instant fail, but the heat climbs while he crowds them.
function tickTailStage(g, dt, stage) {
  const p = g.player;
  const car = g.cars.find((c) => c.id === g.chapterData.tailCarId);
  if (!car || car.dead) {
    failChapter(g, 'lost the courier');
    return;
  }
  const d = Math.hypot(p.x - car.x, p.y - car.y);
  const courierMoving = p.carId !== car.id && Math.abs(car.speed || 0) > 5;
  if (d < 100) {
    g.addHeat(6 * dt, 'spotted');
    g.chapterData.tailT = Math.max(0, (g.chapterData.tailT || 0) - dt * 2);
  } else if (courierMoving && d <= 320) {
    g.chapterData.tailT = (g.chapterData.tailT || 0) + dt;
  } else if (d > 320) {
    g.chapterData.tailT = Math.max(0, (g.chapterData.tailT || 0) - dt * 0.5);
  }
  if ((g.chapterData.tailT || 0) >= (stage.count || stage.duration || 20)) advanceStage(g);
}

// --- Side jobs -------------------------------------------------------------
// Jobs the player can actually start right now, in the district they are
// standing in. Used by the J key (pick among unlocked only, never roll a
// locked job) and by the taxi auto-start (never offer a locked job).
// Empty outside every district.
export function availableJobs(g) {
  const here = districtIdAt(g.player.x, g.player.y);
  if (!here) return [];
  const standing = districtStanding(g, here);
  return Object.keys(JOB_STANDING_FALLBACK).filter((kind) => standing >= jobStandingNeeded(kind));
}

export function startJob(g, kind) {
  if (g.job) return false;
  const need = jobStandingNeeded(kind);
  if (need === undefined) return false;
  // Jobs unlock per district: build standing where the work is first.
  // The gate FAILS CLOSED: outside every district (or below the bar)
  // the job does not start.
  const here = districtIdAt(g.player.x, g.player.y);
  if (!here) {
    g.toast('Get into a district first — jobs only start on the streets');
    return false;
  }
  if (districtStanding(g, here) < need) {
    g.toast(`Build standing in ${districtNameAt(g.player.x, g.player.y)} first (${need} needed)`);
    return false;
  }
  const taxiDef = JOB_DEFS.taxi || {};
  const raceDef = JOB_DEFS.race || {};
  const foodDef = JOB_DEFS.food || {};
  if (kind === 'taxi') {
    const i = Math.floor(g.rng() * TAXI_PICKUPS.length);
    const payMin = taxiDef.payMin !== undefined ? taxiDef.payMin : 80;
    const payMax = taxiDef.payMax !== undefined ? taxiDef.payMax : 160;
    g.job = {
      kind, phase: 'pickup',
      pickup: TAXI_PICKUPS[i], dropoff: TAXI_DROPS[i],
      pay: payMin + Math.floor(g.rng() * (payMax - payMin + 1)),
    };
    g.toast('Taxi job: pick up the fare (yellow marker)');
  } else if (kind === 'race') {
    g.job = {
      kind, cp: 0, points: RACE_POINTS,
      timeLeft: raceDef.timeLimit !== undefined ? raceDef.timeLimit : 75,
      pay: raceDef.pay !== undefined ? raceDef.pay : 250,
    };
    g.toast('Street race! Hit all 3 checkpoints before time runs out.');
  } else if (kind === 'food') {
    g.job = {
      kind, stop: 0, stops: FOOD_STOPS,
      pay: foodDef.pay !== undefined ? foodDef.pay : 120,
    };
    g.toast('Food run: 3 deliveries, follow the markers.');
  }
  return true;
}

function finishJob(g, ok, why) {
  const j = g.job;
  g.job = null;
  // Settlement guard: the job is nulled BEFORE paying, and a settled
  // job can never pay twice even if finishJob is reached again.
  if (j && j.settled) return;
  if (j) j.settled = true;
  if (ok && j) {
    g.player.cash += j.pay;
    g.stats.jobs = (g.stats.jobs || 0) + 1;
    g.audio.cash();
    g.toast(`Job done! +$${j.pay}`);
    addRespect(g, 40);
    const here = districtIdAt(g.player.x, g.player.y);
    if (here) addStanding(g, here, JOB_STANDING);
    g.saveSoon = true;
  } else if (why) {
    g.toast(why);
  }
}

export function updateJob(g, dt, pressedE) {
  void pressedE;
  const j = g.job;
  if (!j) return;
  const p = g.player;
  if (j.kind === 'taxi') {
    const target = j.phase === 'pickup' ? j.pickup : j.dropoff;
    if (distSq(p.x, p.y, target.x, target.y) < 55 * 55) {
      if (j.phase === 'pickup') {
        j.phase = 'dropoff';
        g.toast('Fare aboard — drive to the drop-off');
      } else {
        finishJob(g, true);
      }
    }
  } else if (j.kind === 'race') {
    j.timeLeft -= dt;
    if (j.timeLeft <= 0) {
      finishJob(g, false, 'Race failed — out of time');
      return;
    }
    const cp = j.points[j.cp];
    if (distSq(p.x, p.y, cp.x, cp.y) < 70 * 70) {
      j.cp += 1;
      g.audio.pickup();
      if (j.cp >= j.points.length) finishJob(g, true);
      else g.toast(`Checkpoint ${j.cp}/3!`);
    }
  } else if (j.kind === 'food') {
    const stop = j.stops[j.stop];
    if (distSq(p.x, p.y, stop.x, stop.y) < 60 * 60) {
      j.stop += 1;
      g.audio.pickup();
      if (j.stop >= j.stops.length) finishJob(g, true);
      else g.toast(`Delivery ${j.stop}/3 done`);
    }
  }
}

// --- Respect: the gate -----------------------------------------------------
// Respect opens doors and nothing else. A higher rank unlocks shop
// stock and the garage discount, but it never changes prices on the
// street, never calms the police, and never creates a job. That is
// standing's work, and the two are never allowed to collapse into one
// "how liked is Rico" meter.
export function respectRank(g) {
  const points = (g.respect && g.respect.points) || 0;
  let rank = 0;
  for (let i = 0; i < RESPECT_RANKS.length; i += 1) {
    if (points >= RESPECT_RANKS[i].points) rank = i;
  }
  if (g.respect) g.respect.rank = rank;
  return rank;
}

export function addRespect(g, n) {
  if (!g.respect) g.respect = { points: 0, rank: 0 };
  const before = respectRank(g);
  g.respect.points += n;
  const after = respectRank(g);
  if (after > before) {
    const rank = RESPECT_RANKS[after];
    g.toast(`Respect up: ${rank.name} — ${rank.unlock}`);
  }
}

// --- District standing: the world ------------------------------------------
// Standing changes the world Rico walks through: it decides which side
// jobs exist in a district (see availableJobs / startJob), and crossing
// a milestone makes the street itself respond. It is earned district by
// district, where Rico actually works — a high standing in the Marina
// buys nothing on the Strip.
export function districtStanding(g, id) {
  if (!g.standing) return 0;
  return clamp(g.standing[id] || 0, 0, 100);
}

export function addStanding(g, id, n) {
  if (!g.standing) g.standing = {};
  if (!g.standingMilestones) g.standingMilestones = {};
  const before = districtStanding(g, id);
  const after = clamp(before + n, 0, 100);
  g.standing[id] = after;
  // First time a district crosses a milestone, the street talks: a
  // one-off respect bonus, named for the district actually surging —
  // not the one Rico happens to stand in, since the finale surge fires
  // for all six districts at once.
  for (const mark of STANDING_MILESTONES) {
    const key = `${id}_${mark}`;
    if (before < mark && after >= mark && !g.standingMilestones[key]) {
      g.standingMilestones[key] = true;
      g.toast(`${districtName(id)} standing ${mark} — the street talks (+${MILESTONE_RESPECT} respect)`);
      addRespect(g, MILESTONE_RESPECT);
    }
  }
}

// --- Crew: the decision ----------------------------------------------------
// Crew abilities are decisions, not passives. Each one has a cooldown,
// and the crew holds exactly ONE active ability at a time — firing the
// lookout while the driver is working is refused, so Rico has to choose
// which problem the crew solves right now. The timers are real because
// tickCrew decays them every play tick; a cooldown that never counted
// down would make each ability a one-shot button.
// Driver (G, in a car): +15% top speed for 20s, plus one roadside repair
// to 60 HP per wanted episode (driverUsedEp, reset when the heat clears).
// Lookout (H): 30s of extended police vision on the minimap; the
// roadblock warning itself is passive once recruited.
export function crewAvailable(g) {
  if (!g.crew) return { driver: false, lookout: false };
  return { driver: !!g.crew.driver, lookout: !!g.crew.lookout };
}

// Fire a crew ability (keys G / H). THE single entry point for crew
// abilities — main.js delegates here, so there is exactly one
// cooldown/repair/active-state model. `g.crew.active` is always the
// object form `{ kind, t }`; there is no string form and no second
// repair flag.
export function useCrewAbility(g, kind) {
  const crew = g.crew;
  if (!crew) return false;
  if (crewBusy(crew)) {
    g.toast(`Crew is busy — ${crew.active.kind} still running (${Math.ceil(crew.active.t)}s)`);
    return false;
  }
  if (kind === 'driver') {
    if (!crew.driver) {
      g.toast('Recruit the driver in chapter 4 first');
      return false;
    }
    if ((crew.driverCd || 0) > 0) {
      g.toast(`Driver resting — ${Math.ceil(crew.driverCd)}s`);
      return false;
    }
    const car = heroCar(g);
    if (!car) {
      g.toast('Get in a car first — the driver only helps behind the wheel');
      return false;
    }
    crew.active = { kind: 'driver', t: 20 };
    crew.driverCd = 60;
    if (!crew.driverUsedEp && car.hp < 60) {
      car.hp = 60;
      crew.driverUsedEp = true;
      g.toast('Driver: patched the car to 60 HP — getaway mode, +15% top speed');
    } else {
      g.toast('Driver: getaway mode — +15% top speed for 20s');
    }
    g.audio.blip();
    return true;
  }
  if (kind === 'lookout') {
    if (!crew.lookout) {
      g.toast('Recruit the lookout in chapter 7 first');
      return false;
    }
    if ((crew.lookoutCd || 0) > 0) {
      g.toast(`Lookout resting — ${Math.ceil(crew.lookoutCd)}s`);
      return false;
    }
    crew.active = { kind: 'lookout', t: 30 };
    crew.lookoutCd = 60;
    crew.pingT = 30;
    g.toast('Lookout: every cop marked — roadblock warning live');
    g.audio.blip();
    return true;
  }
  return false;
}

// --- Garage: the competing sink --------------------------------------------
// The garage spends the same cash the other layers would otherwise save:
// every dollar in an engine tier is a dollar not banked for the next
// chapter. Upgrades are bought in order, never twice, and the cash check
// happens before anything moves.
export function garagePrice(line, tier) {
  if (tier < 1 || tier > 3) return 0;
  const def = GARAGE_DEFS ? GARAGE_DEFS[line] : undefined;
  if (Array.isArray(def) && typeof def[tier - 1] === 'number') return def[tier - 1];
  if (def && Array.isArray(def.prices) && typeof def.prices[tier - 1] === 'number') {
    return def.prices[tier - 1];
  }
  if (def && Array.isArray(def.tiers) && def.tiers[tier - 1] && typeof def.tiers[tier - 1].price === 'number') {
    return def.tiers[tier - 1].price;
  }
  const fallback = GARAGE_FALLBACK[line];
  return fallback ? fallback[tier - 1] : 0;
}

// 20% off shop prices once the player is a Kingpin (respect rank 3+).
// This is respect acting as a gate on price — the one place respect is
// allowed to touch money — not standing, which never discounts anything.
export function garageDiscount(g) {
  return respectRank(g) >= 3 ? 0.2 : 0;
}

// Buy one upgrade tier for an owned car. The car is the one the garage
// screen is open for (g.garageId, set to the car's real id when the
// garage opens) — and ONLY that car. If the garage id names a car that
// is gone, dead, or not owned, the purchase fails instead of silently
// sticking the upgrade onto a different nearby car. With no garage id
// (debug path), the car Rico sits in, else the nearest owned car.
export function buyUpgrade(g, line, tier) {
  if (!GARAGE_FALLBACK[line]) return false;
  if (tier < 1 || tier > 3) return false;
  let car = null;
  if (g.garageId !== null && g.garageId !== undefined) {
    car = g.cars.find((c) => String(c.id) === String(g.garageId)) || null;
    if (!car || car.dead || car.ownedBy !== 'player') {
      g.toast('That car is gone — park an owned car by Dex first');
      return false;
    }
  } else {
    car = heroCar(g);
    if (!car) {
      for (const c of g.cars) {
        if (c.ownedBy === 'player' && !c.dead
          && Math.hypot(c.x - g.player.x, c.y - g.player.y) < 200) {
          car = c;
          break;
        }
      }
    }
    if (!car || car.dead) {
      g.toast('No owned car here to upgrade');
      return false;
    }
    if (car.ownedBy !== 'player') {
      g.toast('Only cars you own can be upgraded');
      return false;
    }
  }
  if (!car.upgrades) car.upgrades = { engine: 0, armor: 0, nitro: 0 };
  const current = car.upgrades[line] || 0;
  if (tier !== current + 1) {
    g.toast(tier <= current ? 'That tier is already fitted' : 'Buy the tiers in order');
    return false;
  }
  const price = Math.round(garagePrice(line, tier) * (1 - garageDiscount(g)));
  if (g.player.cash < price) {
    g.toast('Not enough cash for that upgrade');
    return false;
  }
  g.player.cash -= price;
  car.upgrades[line] = tier;
  if (line === 'armor') {
    // Armor raises max HP; the new plating comes fitted, not damaged.
    const oldMax = car.maxHp;
    car.maxHp = Math.round(100 * (1 + 0.25 * tier));
    car.hp = Math.min(car.maxHp, car.hp + (car.maxHp - oldMax));
  }
  if (!g.garage) g.garage = {};
  g.garage[car.id] = { ...car.upgrades };
  g.audio.cash();
  g.toast(`Fitted ${line} tier ${tier} — $${price}`);
  g.saveSoon = true;
  return true;
}
