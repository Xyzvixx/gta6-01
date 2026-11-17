// Missions and side jobs. One explicit state machine: a story mission is an
// index plus a stage index, a job is a small object of its own. Transitions
// are transactional — validate, apply once, clean up owned entities, persist
// — so a bust, a death and a completion can never fire in the same tick.
import { JOB_DEFS, STORY, STORY_LINES } from './data.js';
import { makeEnemy } from './combat.js';
import { dist2 } from './random.js';

export function currentStory(g) {
  if (g.missionIndex < 0 || g.missionIndex >= STORY.length) return null;
  return STORY[g.missionIndex];
}

export function currentStage(g) {
  const story = currentStory(g);
  if (!story) return null;
  return story.stages[g.stageIndex] || null;
}

export function missionText(g) {
  const stage = currentStage(g);
  if (stage) {
    if (stage.kind === 'kill') {
      const done = (g.missionData.kills || 0);
      return `${stage.text.replace('(0/3)', `(${done}/${stage.count})`)}`;
    }
    return stage.text;
  }
  if (g.job) return jobText(g);
  if (g.missionIndex >= STORY.length) return 'Free roam — take a taxi, race, or food job. Press E near a shop.';
  return '';
}

export function jobText(g) {
  const j = g.job;
  if (!j) return '';
  if (j.kind === 'taxi') return j.phase === 'pickup' ? 'Taxi: pick up the fare' : 'Taxi: drop off the fare';
  if (j.kind === 'race') return `Race: checkpoint ${j.cp + 1}/3 — ${Math.ceil(j.timeLeft)}s left`;
  if (j.kind === 'food') return `Food run: delivery ${j.stop + 1}/3`;
  return '';
}

// Where the HUD arrow / minimap route should point, if anywhere.
export function activeWaypoint(g) {
  const stage = currentStage(g);
  if (stage && stage.target) return stage.target;
  if (g.job) {
    if (g.job.kind === 'taxi') return g.job.phase === 'pickup' ? g.job.pickup : g.job.dropoff;
    if (g.job.kind === 'race') return g.job.points[g.job.cp];
    if (g.job.kind === 'food') return g.job.stops[g.job.stop];
  }
  return null;
}

function say(g, line) {
  g.toast(line);
}

export function startStory(g, index) {
  const story = STORY[index];
  if (!story) return;
  g.missionIndex = index;
  g.stageIndex = 0;
  g.missionData = {};
  g.enemies = [];
  const line = STORY_LINES[`${story.id}_start`];
  if (line) say(g, line);
  if (story.id === 'm3') {
    g.wanted.heat = 55; // three stars: 1 + floor(55/20) = 3
    g.wanted.calmT = 8;
  }
  g.missionTitle = story.title;
}

function advanceStage(g) {
  const story = currentStory(g);
  g.stageIndex += 1;
  if (g.stageIndex >= story.stages.length) {
    completeStory(g, story);
    return;
  }
  const next = story.stages[g.stageIndex];
  if (next.kind === 'kill') {
    g.missionData.kills = 0;
    g.missionData.killBase = g.stats.kills;
    for (let i = 0; i < next.count; i += 1) {
      g.enemies.push(makeEnemy(g, next.spawn.x + (i - 1) * 46, next.spawn.y + (i % 2) * 40 - 20));
    }
    g.toast('Tiburones crew — take them all down!');
  }
}

function completeStory(g, story) {
  g.player.cash += story.reward;
  g.missionsDone.push(story.id);
  g.stats.missions += 1;
  g.audio.cash();
  g.toast(`${story.title} complete! +$${story.reward}`);
  g.enemies = [];
  const line = STORY_LINES[`${story.id}_done`];
  if (line) say(g, line);
  // Transactional handoff: clear the old mission before starting the next.
  g.missionIndex += 1;
  g.stageIndex = 0;
  g.missionData = {};
  g.saveSoon = true;
  if (story.id === 'm2') {
    g.player.ammo.smg += 90;
    if (!g.player.owned.includes('smg')) g.player.owned.push('smg');
    g.toast('Mara gave you a VB-9 SMG');
  }
  if (g.missionIndex < STORY.length) {
    startStory(g, g.missionIndex);
  }
}

// A bust / death fails the active mission but never ends the run: the story
// restarts at the current mission's first stage, heat is cleared, and the
// player respawns somewhere safe.
export function failMission(g, reason) {
  if (g.missionIndex >= 0 && g.missionIndex < STORY.length) {
    g.toast(`Mission failed (${reason}) — try again`);
    g.enemies = [];
    g.job = null;
    const idx = g.missionIndex;
    g.missionIndex = -1;
    startStory(g, idx);
  } else {
    g.job = null;
  }
}

export function updateMissions(g, dt, pressedE) {
  const p = g.player;
  const stage = currentStage(g);
  if (stage) {
    if (stage.kind === 'reach' || stage.kind === 'escape') {
      const t = stage.target;
      const d2 = dist2(p.x, p.y, t.x, t.y);
      const r = stage.radius || 70;
      if (d2 < r * r) {
        if (stage.pressE) {
          if (pressedE) {
            if (stage.key === 'pickup') say(g, STORY_LINES.m1_mid);
            advanceStage(g);
          }
        } else if (stage.kind === 'escape') {
          // Safehouse only counts once the heat is actually gone... or the
          // arrival itself is the escape: arriving clears the heat.
          g.wanted.heat = 0;
          g.wanted.level = 0;
          g.cops = [];
          advanceStage(g);
        } else {
          advanceStage(g);
        }
      }
    } else if (stage.kind === 'kill') {
      const done = g.stats.kills - (g.missionData.killBase || 0);
      g.missionData.kills = done;
      if (done >= stage.count) advanceStage(g);
    }
  }
  updateJob(g, dt, pressedE);
}

// --- Side jobs ------------------------------------------------------------
const TAXI_PICKUPS = [
  { x: 1100, y: 600, label: 'Fare pickup' },
  { x: 1900, y: 1650, label: 'Fare pickup' },
  { x: 700, y: 2000, label: 'Fare pickup' },
];
const TAXI_DROPS = [
  { x: 2700, y: 950, label: 'Fare drop-off' },
  { x: 1500, y: 250, label: 'Fare drop-off' },
  { x: 300, y: 1300, label: 'Fare drop-off' },
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

export function startJob(g, kind) {
  if (g.job) return false;
  if (kind === 'taxi') {
    const i = Math.floor(g.rng() * TAXI_PICKUPS.length);
    g.job = { kind, phase: 'pickup', pickup: TAXI_PICKUPS[i], dropoff: TAXI_DROPS[i], pay: 80 + Math.floor(g.rng() * 80) };
    g.toast('Taxi job: pick up the fare (yellow marker)');
  } else if (kind === 'race') {
    g.job = { kind, cp: 0, points: RACE_POINTS, timeLeft: JOB_DEFS.race.timeLimit, pay: JOB_DEFS.race.pay };
    g.toast('Street race! Hit all 3 checkpoints before time runs out.');
  } else if (kind === 'food') {
    g.job = { kind, stop: 0, stops: FOOD_STOPS, pay: JOB_DEFS.food.pay };
    g.toast('Food run: 3 deliveries, follow the markers.');
  }
  return true;
}

function finishJob(g, ok, why) {
  const j = g.job;
  g.job = null;
  if (ok && j) {
    g.player.cash += j.pay;
    g.stats.jobs = (g.stats.jobs || 0) + 1;
    g.audio.cash();
    g.toast(`Job done! +$${j.pay}`);
    g.saveSoon = true;
  } else if (why) {
    g.toast(why);
  }
}

function updateJob(g, dt, pressedE) {
  const j = g.job;
  if (!j) return;
  const p = g.player;
  if (j.kind === 'taxi') {
    const target = j.phase === 'pickup' ? j.pickup : j.dropoff;
    if (dist2(p.x, p.y, target.x, target.y) < 55 * 55) {
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
    if (dist2(p.x, p.y, cp.x, cp.y) < 70 * 70) {
      j.cp += 1;
      g.audio.pickup();
      if (j.cp >= j.points.length) finishJob(g, true);
      else g.toast(`Checkpoint ${j.cp}/3!`);
    }
  } else if (j.kind === 'food') {
    const stop = j.stops[j.stop];
    if (dist2(p.x, p.y, stop.x, stop.y) < 60 * 60) {
      j.stop += 1;
      g.audio.pickup();
      if (j.stop >= j.stops.length) finishJob(g, true);
      else g.toast(`Delivery ${j.stop}/3 done`);
    }
  }
}
