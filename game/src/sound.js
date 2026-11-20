// Vice Bay v2 — WebAudio synth. Everything is synthesized live: engine
// hum, a two-tone siren, rain noise, three radio stations, and every
// sound effect. No audio files, no network. Safe to call before any user
// gesture — the context is created lazily on unlock() and every method
// no-ops until then.

const STATIONS = [
  { name: 'Vice FM — Synthwave', root: 55, steps: [0, 0, 7, 10, 12, 10, 7, 5], wave: 'sawtooth', bpm: 112 },
  { name: 'Neon Nights — Chill', root: 65.41, steps: [0, 3, 7, 3, 10, 7, 5, 3], wave: 'triangle', bpm: 84 },
  { name: 'Tiburon Radio — Cumbia', root: 49, steps: [0, 4, 7, 12, 7, 4, 2, 4], wave: 'square', bpm: 96 },
];

const SEMITONE_RATIO = 2 ** (1 / 12);
const MASTER_VOLUME = 0.5;

// One audio service for the whole page. createGame used to build a fresh
// sound instance per game, and each used instance allocates its own
// AudioContext on first playback with no close path — repeated New Game
// cycles could exhaust the browser's context budget. The service holds
// no game state (station/mute persist like settings; engine/siren/rain
// levels are set per tick by the live game), and main.js re-applies
// `setMusicOn` from settings on every game creation.
let sharedSound = null;

export function createSound() {
  if (sharedSound) return sharedSound;
  sharedSound = makeSound();
  return sharedSound;
}

function makeSound() {
  let ctx = null;
  let master = null;
  let muted = false;
  let musicEnabled = true;
  let stationIdx = 0;
  let musicTimer = null;
  let musicStep = 0;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenPhase = 0;
  let rainSrc = null;
  let rainGain = null;
  let rainLevel = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOLUME;
      master.connect(ctx.destination);
      return true;
    } catch (e) {
      return false;
    }
  }

  function makeNoise(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // One short oscillator note with an exponential decay envelope.
  function tone(freq, dur, type, vol, slideTo) {
    if (!ensure()) return;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      gain.gain.setValueAtTime(vol || 0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (e) { /* audio is best-effort */ }
  }

  // One burst of filtered noise with a decay envelope.
  function noiseBurst(dur, vol, cutoff) {
    if (!ensure()) return;
    try {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = makeNoise(dur + 0.05);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff || 1200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol || 0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(t);
      src.stop(t + dur + 0.05);
    } catch (e) { /* audio is best-effort */ }
  }

  function toneLater(freq, dur, type, vol, delayMs) {
    setTimeout(() => tone(freq, dur, type, vol), delayMs);
  }

  // --- Radio: a tiny step sequencer with lookahead, one note per 8th. ---
  function musicTick() {
    if (!ctx || !musicEnabled || muted) return;
    const st = STATIONS[stationIdx];
    const stepDur = 60 / st.bpm / 2;
    const semi = st.steps[musicStep % st.steps.length];
    const freq = st.root * (SEMITONE_RATIO ** semi);
    tone(freq, stepDur * 0.9, st.wave, 0.07);
    if (musicStep % 4 === 0) tone(freq / 2, stepDur * 1.8, 'sine', 0.1);
    musicStep += 1;
  }

  function startMusic() {
    stopMusic();
    if (!ensure() || !musicEnabled) return;
    const st = STATIONS[stationIdx];
    musicTimer = setInterval(musicTick, (60 / st.bpm / 2) * 1000);
  }

  function stopMusic() {
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  function startEngineLoop() {
    engineOsc = ctx.createOscillator();
    engineGain = ctx.createGain();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    engineOsc.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
  }

  function startSirenLoop() {
    sirenOsc = ctx.createOscillator();
    sirenGain = ctx.createGain();
    sirenOsc.type = 'sine';
    sirenOsc.frequency.value = 700;
    sirenGain.gain.value = 0.045;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();
  }

  function startRainLoop() {
    rainSrc = ctx.createBufferSource();
    rainSrc.buffer = makeNoise(2);
    rainSrc.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.4;
    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rainSrc.connect(filter);
    filter.connect(rainGain);
    rainGain.connect(master);
    rainSrc.start();
  }

  function stopRainLoop() {
    const old = rainSrc;
    rainSrc = null;
    rainGain = null;
    setTimeout(() => { try { old.stop(); } catch (e) {} }, 600);
  }

  return {
    // Create/resume the context after a user gesture.
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (musicEnabled) startMusic();
      if (rainLevel > 0) this.setRain(rainLevel);
    },

    setMuted(m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
      if (muted) stopMusic();
      else if (ctx && musicEnabled) startMusic();
    },
    isMuted() { return muted; },

    setMusicOn(on) {
      musicEnabled = !!on;
      if (!ctx) return;
      if (musicEnabled) startMusic();
      else stopMusic();
    },
    musicOn() { return musicEnabled; },

    nextStation() {
      stationIdx = (stationIdx + 1) % STATIONS.length;
      musicStep = 0;
      if (ctx && musicEnabled && !muted) startMusic();
      return this.stationName();
    },
    stationName() { return STATIONS[stationIdx].name; },

    // Engine hum: pitch + loudness follow throttle; silent when parked.
    setEngine(frac, driving) {
      if (!ensure()) return;
      try {
        if (!engineOsc) startEngineLoop();
        const clamped = Math.min(Math.max(frac, 0), 1);
        const t = ctx.currentTime;
        const target = driving ? 0.05 + 0.09 * clamped : 0;
        engineGain.gain.setTargetAtTime(target, t, 0.08);
        engineOsc.frequency.setTargetAtTime(52 + 90 * clamped, t, 0.08);
      } catch (e) { /* audio is best-effort */ }
    },

    // Two-tone police siren; `t` is game time, used to alternate the tone.
    setSiren(on, t) {
      if (!ensure()) return;
      try {
        if (on && !sirenOsc) startSirenLoop();
        if (!on && sirenOsc) {
          sirenOsc.stop();
          sirenOsc = null;
          sirenGain = null;
          return;
        }
        if (sirenOsc) {
          const phase = Math.floor((t || 0) * 2) % 2;
          if (phase !== sirenPhase) {
            sirenPhase = phase;
            sirenOsc.frequency.setTargetAtTime(phase === 0 ? 700 : 950, ctx.currentTime, 0.05);
          }
        }
      } catch (e) { /* audio is best-effort */ }
    },

    // Looping filtered noise; level 0 silences it.
    setRain(level) {
      rainLevel = Math.min(Math.max(level || 0, 0), 1);
      if (!ensure()) return;
      try {
        if (rainLevel > 0 && !rainSrc) startRainLoop();
        if (rainGain) rainGain.gain.setTargetAtTime(rainLevel * 0.12, ctx.currentTime, 0.4);
        if (rainLevel <= 0 && rainSrc) stopRainLoop();
      } catch (e) { /* audio is best-effort */ }
    },

    shot() { noiseBurst(0.12, 0.35, 2600); tone(180, 0.08, 'square', 0.12, 60); },
    crash() { noiseBurst(0.35, 0.5, 500); tone(70, 0.3, 'sine', 0.25, 35); },
    pickup() { tone(660, 0.09, 'sine', 0.2); toneLater(990, 0.12, 'sine', 0.2, 80); },
    cash() {
      tone(880, 0.08, 'sine', 0.2);
      toneLater(1174, 0.1, 'sine', 0.2, 70);
      toneLater(1568, 0.14, 'sine', 0.2, 140);
    },
    fail() { tone(320, 0.25, 'sawtooth', 0.18, 110); },
    blip() { tone(520, 0.06, 'sine', 0.15); },
  };
}
