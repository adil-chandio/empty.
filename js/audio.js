/**
 * ========================================================================
   TABAHI — Next Level Audio Engine (Web Audio API)
   Easy English: All sound is made with code (no MP3 files needed).
   We create: sub-bass thumps, glass shatters, metal groans, risers,
   eargasm shimmer (10-14 kHz air band), vocal textures, heartbeat,
   reverse swells, spatial panning, and ambient drone.
   ======================================================================== */

const AudioCtx = window.AudioContext || window.webkitAudioContext;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.limiter = null;

    // Buses (mix channels)
    this.sfxBus = null;      // impacts, shatters, groans
    this.musicBus = null;    // pads, heartbeat, vocals
    this.ambientBus = null;  // drone bed

    this.initialized = false;
    this.drones = [];        // ambient drone oscillators
    this.heartbeatTimer = null;

    // Easy English: last time we played each sound (to avoid spam)
    this.lastImpact = 0;
  }

  async init() {
    if (this.initialized) return;
    this.ctx = new AudioCtx();

    // Master bus -> compressor/limiter -> destination
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(this.ctx.destination);

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.limiter.connect(this.master);

    // SFX bus
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.limiter);

    // Music bus
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.limiter);

    // Ambient bus
    this.ambientBus = this.ctx.createGain();
    this.ambientBus.gain.value = 0.3;
    this.ambientBus.connect(this.limiter);

    this.initialized = true;
  }

  // Call this after user clicks (browsers block audio until first click)
  ensureStarted() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  getTime() { return this.ctx ? this.ctx.currentTime : 0; }

  // Pick which bus to send sound to
  _bus(name) {
    if (name === 'music') return this.musicBus;
    if (name === 'ambient') return this.ambientBus;
    return this.sfxBus;
  }

  /* ========================================================================
     SOUND PRIMITIVES
     ======================================================================== */

  // Deep sub-bass thump (impact body / heartbeat low end)
  playThump({ time = null, freq = 45, duration = 0.35, gain = 1.0, bus = 'sfx', detune = 0 } = {}) {
    this.ensureStarted();
    const t = time || this.getTime();

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    g.connect(this._bus(bus));

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (detune) osc.detune.setValueAtTime(detune, t);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + duration + 0.15);
    return t + duration;
  }

  // Broadband noise burst (glass shatter, debris impact)
  playNoiseBurst({ time = null, duration = 0.15, gain = 0.6, bus = 'sfx', hp = 800, lp = 6000 } = {}) {
    this.ensureStarted();
    const t = time || this.getTime();

    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    const b1 = this.ctx.createBiquadFilter(); b1.type = 'highpass'; b1.frequency.value = hp;
    const b2 = this.ctx.createBiquadFilter(); b2.type = 'lowpass'; b2.frequency.value = lp;

    noise.connect(b1).connect(b2).connect(g).connect(this._bus(bus));
    noise.start(t);
    noise.stop(t + duration + 0.1);
    return t + duration;
  }

  // Riser / swell (builds anticipation before a drop)
  playRiser({ time = null, f0 = 120, f1 = 2200, duration = 2.0, gain = 0.35, bus = 'sfx' } = {}) {
    this.ensureStarted();
    const t = time || this.getTime();

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, f0 * 1.01), t + duration);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + duration * 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(400, t);
    filt.frequency.exponentialRampToValueAtTime(4500, t + duration);

    osc.connect(filt).connect(g).connect(this._bus(bus));
    osc.start(t);
    osc.stop(t + duration + 0.2);
    return t + duration;
  }

  // Glass shatter (noise burst + detuned metallic ticks)
  playGlassShatter({ time = null, gain = 0.5, bus = 'sfx' } = {}) {
    this.ensureStarted();
    const t = time || this.getTime();
    this.playNoiseBurst({ time: t, duration: 0.5, gain: gain * 0.7, bus, hp: 2500, lp: 9000 });

    // Detuned metallic ticks (granular feel)
    for (let i = 0; i < 8; i++) {
      const tick = this.ctx.createOscillator();
      tick.type = 'square';
      const f = 1600 + Math.random() * 4000;
      tick.frequency.setValueAtTime(f, t);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain * 0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + Math.random() * 0.15);
      const p = this.ctx.createBiquadFilter(); p.type = 'highpass'; p.frequency.value = 3000;
      tick.connect(p).connect(g).connect(this._bus(bus));
      tick.start(t);
      tick.stop(t + 0.35);
    }
  }

  // Metal groan / creak (slow low-frequency sweep)
  playMetalGroan({ time = null, duration = 2.0, gain = 0.5, bus = 'sfx' } = {}) {
    this.ensureStarted();
    const t = time || this.getTime();

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.linearRampToValueAtTime(180, t + duration);

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(180, t);
    filt.frequency.linearRampToValueAtTime(900, t + duration);
    filt.Q.value = 2.5;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.linearRampToValueAtTime(gain * 0.35, t + duration);

    osc.connect(filt).connect(g).connect(this._bus(bus));
    osc.start(t);
    osc.stop(t + duration + 0.3);
  }

  // Eargasm shimmer (10-14 kHz air band with chorus detune = physical pleasure)
  playShimmer({ time = null, duration = 1.4, gain = 0.28, bus = 'sfx' } = {}) {
    this.ensureStarted();
    const t = time || this.getTime();

    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(12000, t);

    // Chorus detune via LFO on detune
    const mod = this.ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(7, t);
    mod.connect(carrier.detune);
    mod.gain = this.ctx.createGain(); mod.gain.value = 14;
    mod.connect(carrier.detune);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 9000;

    carrier.connect(filt).connect(g).connect(this._bus(bus));
    carrier.start(t); carrier.stop(t + duration + 0.3);
    mod.start(t); mod.stop(t + duration + 0.3);
  }

  // Synth stab (impact accent)
  playStab({ time = null, freq = 110, duration = 0.4, gain = 0.55, bus = 'sfx' } = {}) {
    this.ensureStarted();
    const t = time || this.getTime();

    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + duration);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1000, t);
    filt.frequency.exponentialRampToValueAtTime(250, t + duration);

    osc.connect(filt).connect(g).connect(this._bus(bus));
    osc.start(t);
    osc.stop(t + duration + 0.15);
  }

  // Sub-drop (massive low-end impact)
  playSubDrop({ time = null, f0 = 60, f1 = 22, duration = 0.9, gain = 1.0, bus = 'sfx' } = {}) {
    this.ensureStarted();
    const t = time || this.getTime();

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + duration);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(g).connect(this._bus(bus));
    osc.start(t);
    osc.stop(t + duration + 0.3);
  }

  // Reverse swell (rising then cutting = anticipation)
  playReverseSwell({ time = null, duration = 1.6, gain = 0.4, bus = 'sfx' } = {}) {
    this.ensureStarted();
    const t = time || this.getTime();

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(350, t);
    osc.frequency.linearRampToValueAtTime(1200, t + duration);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(gain, t + duration);

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(500, t);
    filt.frequency.linearRampToValueAtTime(3200, t + duration);

    osc.connect(filt).connect(g).connect(this._bus(bus));
    osc.start(t);
    osc.stop(t + duration + 0.3);
  }

  // Non-lexical vocal "ahh" (human texture, triggers mirror neurons)
  playVocal({ time = null, f = 220, duration = 1.2, gain = 0.28, bus = 'music' } = {}) {
    this.ensureStarted();
    const t = time || this.getTime();

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.linearRampToValueAtTime(f * 1.04, t + duration);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.12);
    g.gain.linearRampToValueAtTime(gain * 0.45, t + duration);

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 1.6;

    osc.connect(filt).connect(g).connect(this._bus(bus));
    osc.start(t);
    osc.stop(t + duration + 0.4);
  }

  // Ambient drone (evolving low bed, starts quietly)
  startAmbientDrone() {
    this.ensureStarted();
    const t = this.getTime();
    const freqs = [55, 82.4, 110, 146.8]; // low chord
    freqs.forEach((f) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const mix = this.ctx.createGain(); mix.gain.value = 0.09;
      osc.connect(mix);
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 260; filt.Q.value = 0.7;
      mix.connect(filt);
      const g = this.ctx.createGain(); g.gain.value = 0.22;
      filt.connect(g).connect(this.ambientBus);
      osc.start(t);
      this.drones.push({ osc, g, t });
    });
  }

  stopAmbientDrone() {
    const t = this.getTime();
    this.drones.forEach((d) => {
      try { d.g.gain.linearRampToValueAtTime(0, t + 2.5); d.osc.stop(t + 2.5); } catch (e) {}
    });
    this.drones = [];
  }

  // Heartbeat kick (60 BPM, subtle, keeps tension)
  startHeartbeat(bpm = 60) {
    this.ensureStarted();
    const beatSec = 60 / bpm;
    const play = () => {
      this.playThump({ freq: 55, duration: 0.16, gain: 0.34, bus: 'music' });
      this.playNoiseBurst({ duration: 0.04, gain: 0.09, bus: 'music', hp: 3000, lp: 7000 });
    };
    play();
    this.heartbeatTimer = setInterval(play, beatSec * 1000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  // Spatial panner for debris / camera-relative SFX
  makePanner(x = 0, y = 0, z = 2) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.maxDistance = 60;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    return p;
  }

  setMaster(v) { if (this.master) this.master.gain.value = v; }
}

export const audio = new AudioEngine();
