// All sound is synthesized with WebAudio — no audio files. The engine hums
// with speed, the siren wails while wanted, and a tiny step sequencer plays
// three "radio stations". Everything is created lazily on the first user
// gesture so autoplay rules never block the game.
export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let rainSrc = null;
  let rainGain = null;
  let muted = false;
  let musicOn = true;
  let station = 0;
  let seqTimer = null;
  let step = 0;
  let nextTime = 0;

  const STATIONS = [
    { name: 'BAY FM — synthwave', bpm: 96, bass: [55, 0, 65.4, 0, 49, 0, 58.3, 0], lead: [220, 0, 261.6, 329.6, 0, 293.7, 0, 220] },
    { name: 'NEON 88 — electro', bpm: 122, bass: [41.2, 41.2, 0, 49, 0, 55, 0, 49], lead: [0, 440, 0, 523.3, 493.9, 0, 440, 0] },
    { name: 'PALM — chill', bpm: 76, bass: [65.4, 0, 0, 82.4, 0, 0, 98, 0], lead: [329.6, 0, 392, 0, 440, 0, 392, 0] },
  ];

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.16;
      musicGain.connect(master);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.9;
      sfxGain.connect(master);
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineGain);
      engineGain.connect(sfxGain);
      engineOsc.start();
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(sfxGain);
      sirenOsc.start();
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, dur, type, vol, when = 0) {
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(sfxGain);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, vol, lowpass) {
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    src.start();
  }

  function scheduleStep() {
    if (!ctx || !musicOn || muted) return;
    const st = STATIONS[station];
    const stepDur = 60 / st.bpm / 2;
    while (nextTime < ctx.currentTime + 0.15) {
      const i = step % 8;
      const bass = st.bass[i];
      if (bass) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = bass;
        g.gain.setValueAtTime(0.5, nextTime);
        g.gain.exponentialRampToValueAtTime(0.001, nextTime + stepDur * 0.9);
        o.connect(g);
        g.connect(musicGain);
        o.start(nextTime);
        o.stop(nextTime + stepDur);
      }
      const lead = st.lead[i];
      if (lead) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'square';
        o.frequency.value = lead;
        g.gain.setValueAtTime(0.08, nextTime);
        g.gain.exponentialRampToValueAtTime(0.001, nextTime + stepDur * 0.8);
        o.connect(g);
        g.connect(musicGain);
        o.start(nextTime);
        o.stop(nextTime + stepDur);
      }
      if (i % 2 === 0) {
        const len = Math.floor(ctx.sampleRate * 0.03);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let k = 0; k < len; k += 1) d[k] = (Math.random() * 2 - 1) * (1 - k / len);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = 0.12;
        src.connect(g);
        g.connect(musicGain);
        src.start(nextTime);
      }
      step += 1;
      nextTime += stepDur;
    }
  }

  return {
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (!seqTimer) {
        nextTime = ctx.currentTime + 0.05;
        seqTimer = setInterval(scheduleStep, 90);
      }
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
    },
    isMuted() {
      return muted;
    },
    setMusicOn(on) {
      musicOn = on;
    },
    musicOn() {
      return musicOn;
    },
    nextStation() {
      station = (station + 1) % STATIONS.length;
      return STATIONS[station].name;
    },
    stationName() {
      return STATIONS[station].name;
    },
    setEngine(speedFrac, driving) {
      if (!ctx) return;
      engineGain.gain.setTargetAtTime(driving ? 0.05 + speedFrac * 0.06 : 0.0, ctx.currentTime, 0.1);
      engineOsc.frequency.setTargetAtTime(52 + speedFrac * 130, ctx.currentTime, 0.08);
    },
    setSiren(on, t) {
      if (!ctx) return;
      sirenGain.gain.setTargetAtTime(on ? 0.045 : 0, ctx.currentTime, 0.2);
      if (on) sirenOsc.frequency.setTargetAtTime(660 + Math.sin(t * 2.4) * 220, ctx.currentTime, 0.05);
    },
    setRain(level) {
      if (!ctx) return;
      if (!rainSrc) {
        const len = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
        rainSrc = ctx.createBufferSource();
        rainSrc.buffer = buf;
        rainSrc.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1800;
        rainGain = ctx.createGain();
        rainGain.gain.value = 0;
        rainSrc.connect(f);
        f.connect(rainGain);
        rainGain.connect(sfxGain);
        rainSrc.start();
      }
      rainGain.gain.setTargetAtTime(level * 0.06, ctx.currentTime, 0.5);
    },
    shot() {
      if (!ensure()) return;
      noiseBurst(0.09, 0.5, 3200);
      tone(180, 0.07, 'square', 0.22);
    },
    crash() {
      if (!ensure()) return;
      noiseBurst(0.22, 0.55, 700);
      tone(70, 0.2, 'sine', 0.4);
    },
    pickup() {
      if (!ensure()) return;
      tone(660, 0.09, 'sine', 0.25);
      tone(990, 0.12, 'sine', 0.25, 0.08);
    },
    cash() {
      if (!ensure()) return;
      tone(880, 0.1, 'triangle', 0.25);
      tone(1174, 0.14, 'triangle', 0.25, 0.09);
    },
    fail() {
      if (!ensure()) return;
      tone(220, 0.25, 'sawtooth', 0.2);
      tone(165, 0.35, 'sawtooth', 0.2, 0.18);
    },
    blip() {
      if (!ensure()) return;
      tone(520, 0.06, 'sine', 0.2);
    },
  };
}
