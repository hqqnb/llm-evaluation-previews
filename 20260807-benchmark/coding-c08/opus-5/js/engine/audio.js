// ============================================================================
// engine/audio.js — the game's entire soundtrack, synthesized at runtime.
//
// 100% procedural Web Audio: no audio files, no network, no libraries. Every
// one-shot is rendered once into an AudioBuffer with an OfflineAudioContext
// (layered noise bursts, pitch-swept sines, resonant filters, metallic partial
// banks) and then played as a BufferSource with random pitch/gain variation, so
// the per-shot cost stays at "one small node chain" while still sounding alive.
//
// Graph: source → [lowshelf body] → [occlusion lowpass] → voiceGain → [panner]
//                                                       ↘ send → convolver ↴
//        bus(sfx|ui|music) → master → compressor → destination  ←───────────┘
//
// Nothing here touches `window`, `AudioContext` or `OfflineAudioContext` at
// import time, so `import()` works in Node and the context is only created from
// init(), i.e. from a real user gesture (autoplay policy).
// ============================================================================

import { CFG, SURFACE } from '../core/constants.js';
import { clamp, clamp01, rand, pick } from '../core/util.js';

/** Floor for exponentialRampToValueAtTime — a target of 0 is illegal there. */
const A0 = 0.0001;
/** Listener distance (m) where gunfire starts blending into its distant render. */
const FAR_START = 22;
/** Metres over which the near→far crossfade completes. */
const FAR_BLEND = 20;
/** Simultaneous one-shot voice cap (loops are budgeted separately). */
const MAX_VOICES = 28;

/** Per-name minimum spacing (seconds) for spammy sounds. */
const RATE = {
  step_sand: 0.055, step_concrete: 0.055, step_metal: 0.055, step_wood: 0.055,
  step_dirt: 0.055, step_tile: 0.055, ladder: 0.09, jump: 0.08,
  impact_concrete: 0.02, impact_metal: 0.02, impact_wood: 0.02, impact_dirt: 0.02,
  impact_glass: 0.03, ricochet: 0.035, whizz: 0.05, penetrate: 0.03,
  hit_flesh: 0.02, hit_kevlar: 0.02, hit_helmet: 0.02, hitmarker: 0.02,
  reload_shell: 0.03, nade_bounce: 0.05, ui_hover: 0.03,
};

/** Build a sound definition with sane defaults. */
function def(dur, build, o) {
  return {
    kind: 'oneshot', bus: 'sfx', dur, build, gain: 1, rev: 0.18,
    jit: 0.03, gjit: 0.08, range: 110, ...(o || {}),
  };
}

/** SURFACE.* → footstep sound name (used by player/bot movement code). */
export const STEP_FOR = {
  [SURFACE.SAND]: 'step_sand', [SURFACE.CONCRETE]: 'step_concrete',
  [SURFACE.METAL]: 'step_metal', [SURFACE.WOOD]: 'step_wood',
  [SURFACE.DIRT]: 'step_dirt', [SURFACE.TILE]: 'step_tile',
  [SURFACE.FABRIC]: 'step_dirt', [SURFACE.GLASS]: 'step_tile',
  [SURFACE.WATER]: 'step_dirt',
};
/** SURFACE.* → bullet impact sound name. */
export const IMPACT_FOR = {
  [SURFACE.SAND]: 'impact_dirt', [SURFACE.CONCRETE]: 'impact_concrete',
  [SURFACE.METAL]: 'impact_metal', [SURFACE.WOOD]: 'impact_wood',
  [SURFACE.DIRT]: 'impact_dirt', [SURFACE.TILE]: 'impact_concrete',
  [SURFACE.FABRIC]: 'impact_dirt', [SURFACE.GLASS]: 'impact_glass',
  [SURFACE.WATER]: 'impact_dirt',
};

/** Names rendered during init(); everything else is rendered lazily/idly. */
const EAGER = [
  'shoot_pistol', 'shoot_smg', 'shoot_ak', 'shoot_m4', 'shoot_rifle', 'shoot_awp',
  'dryfire', 'reload_mag_out', 'reload_mag_in', 'reload_bolt', 'deploy', 'holster',
  'step_sand', 'step_concrete', 'step_metal', 'step_wood', 'step_dirt', 'step_tile',
  'land_soft', 'land_hard', 'jump', 'hit_flesh', 'hit_kevlar', 'hit_helmet',
  'impact_concrete', 'impact_metal', 'impact_wood', 'impact_dirt', 'whizz',
  'ricochet', 'hitmarker', 'ui_click', 'ui_hover', 'ui_back', 'buy', 'pickup',
];

export class AudioEngine {
  /**
   * @param {object} [cfg] game settings (see CFG in core/constants.js).
   * No AudioContext is created here — see init().
   */
  constructor(cfg) {
    this.cfg = { ...CFG, ...(cfg || {}) };
    this.ctx = null;
    this.buses = null;
    this.master = null;
    this._ready = false;
    this._initing = null;
    this._buffers = new Map();      // name → AudioBuffer
    this._pending = new Map();      // name → Promise<AudioBuffer>
    this._noise = new Map();        // ctx → {white, pink}
    this.voices = [];               // live one-shots
    this.loops = new Set();         // live loop handles
    this._last = new Map();         // name → last start time (rate limiting)
    this._occ = null;               // occlusion test fn
    this._initMs = 0;
    this.listener = { pos: { x: 0, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };
    this.vol = {
      master: this.cfg.masterVolume ?? 0.8, sfx: this.cfg.sfxVolume ?? 1,
      music: this.cfg.musicVolume ?? 0.5, ui: this.cfg.uiVolume ?? 0.9,
    };
    this.panning = this.cfg.quality === 'low' ? 'equalpower' : 'HRTF';
    this.defs = this._buildDefs();
  }

  /** True once init() has finished and playback is possible. */
  get ready() { return this._ready; }
  /** Cost of init() in milliseconds (diagnostics). */
  get initMs() { return this._initMs; }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  /**
   * Create the AudioContext and the mix graph, then render the hot one-shots.
   * MUST be called from a user gesture (click/keydown). Safe to call twice and
   * safe to call in Node — it simply resolves to false when Web Audio is absent.
   * @returns {Promise<boolean>}
   */
  async init() {
    if (this._ready) return true;
    if (this._initing) return this._initing;
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    const Ctor = g.AudioContext || g.webkitAudioContext || null;
    if (typeof window === 'undefined' || !Ctor) return false;
    this._initing = (async () => {
      const t0 = this._now();
      try {
        const ctx = new Ctor({ latencyHint: 'interactive' });
        this.ctx = ctx;
        // master → compressor → destination. The compressor is what keeps a
        // full-auto Negev plus two explosions from clipping the output.
        const master = ctx.createGain();
        master.gain.value = this.vol.master;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -11;
        comp.knee.value = 14;
        comp.ratio.value = 6;
        comp.attack.value = 0.004;
        comp.release.value = 0.19;
        master.connect(comp);
        comp.connect(ctx.destination);
        this.master = master;
        this.comp = comp;
        // three buses so UI stays audible when the world gets loud
        this.buses = {
          sfx: ctx.createGain(), ui: ctx.createGain(), music: ctx.createGain(),
        };
        this.buses.sfx.gain.value = this.vol.sfx;
        this.buses.ui.gain.value = this.vol.ui;
        this.buses.music.gain.value = this.vol.music;
        for (const k of ['sfx', 'ui', 'music']) this.buses[k].connect(master);
        // shared reverb send (procedural courtyard impulse response)
        const conv = ctx.createConvolver();
        conv.normalize = true;
        conv.buffer = this._makeIR(ctx, 1.1);
        const send = ctx.createGain(); send.gain.value = 1;
        const ret = ctx.createGain(); ret.gain.value = 0.62;
        const revLo = ctx.createBiquadFilter();
        revLo.type = 'highpass'; revLo.frequency.value = 130;
        send.connect(conv); conv.connect(revLo); revLo.connect(ret);
        ret.connect(this.buses.sfx);
        this.revSend = send; this.conv = conv; this.revReturn = ret;

        if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* gesture */ } }
        this._applyListener();
        // Render the latency-critical one-shots now; everything else is either
        // rendered on first use or picked up by the idle prefetch below.
        await Promise.all(EAGER.map((n) => this._ensure(n).catch(() => null)));
        this._ready = true;
        this._initMs = Math.round(this._now() - t0);
        this._prefetch();
        return true;
      } catch (e) {
        console.warn('[audio] init failed', e);
        this._ready = false;
        return false;
      }
    })();
    return this._initing;
  }

  _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /** Render every remaining sound in the background, a few per idle slice. */
  _prefetch() {
    const rest = Object.keys(this.defs).filter(
      (n) => this.defs[n].kind !== 'live' && !this._buffers.has(n) && !this._pending.has(n));
    let i = 0;
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    const idle = g.requestIdleCallback ? (fn) => g.requestIdleCallback(fn, { timeout: 400 })
      : (fn) => setTimeout(fn, 30);
    const step = () => {
      if (!this._ready || i >= rest.length) return;
      const batch = rest.slice(i, i + 3); i += 3;
      Promise.all(batch.map((n) => this._ensure(n).catch(() => null))).then(() => idle(step));
    };
    idle(step);
  }

  /**
   * Procedural impulse response: a short, bright outdoor-courtyard tail.
   * Decaying noise, differentiated (removes rumble → bright), plus a handful of
   * sparse early reflections so it reads as walls rather than as a hall.
   */
  _makeIR(ctx, dur = 1.1) {
    const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * dur));
    const buf = ctx.createBuffer(2, len, sr);
    const rise = Math.max(1, Math.floor(sr * 0.006));
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0, prev = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, 2.5) * (i < rise ? i / rise : 1);
        lp += ((Math.random() * 2 - 1) * env - lp) * 0.66;
        d[i] = (lp - prev) * 1.6; prev = lp;
      }

      const refs = [0.009, 0.017, 0.026, 0.037, 0.051, 0.069, 0.088];
      for (let k = 0; k < refs.length; k++) {
        const idx = Math.floor(refs[k] * sr) + (ch ? 11 : 0);
        if (idx < len) d[idx] += (0.5 - k * 0.06) * (Math.random() < 0.5 ? -1 : 1);
      }
    }
    return buf;
  }

  // -------------------------------------------------------------------------
  // Mix / listener / lifecycle  (all safe before init)
  // -------------------------------------------------------------------------
  /** @param {{master?:number,sfx?:number,music?:number,ui?:number}} v 0..1 */
  setVolumes(v) {
    if (!v) return;
    for (const k of ['master', 'sfx', 'music', 'ui']) {
      if (typeof v[k] === 'number') this.vol[k] = clamp01(v[k]);
    }
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.02);
    this.buses.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.02);
    this.buses.ui.gain.setTargetAtTime(this.vol.ui, t, 0.02);
    this.buses.music.gain.setTargetAtTime(this.vol.music, t, 0.02);
  }

  /**
   * Position/orient the listener. Call once per frame from the camera.
   * @param {{x:number,y:number,z:number}} pos
   * @param {{x:number,y:number,z:number}} [forward]
   * @param {{x:number,y:number,z:number}} [up]
   */
  setListener(pos, forward, up) {
    if (pos) { this.listener.pos.x = pos.x; this.listener.pos.y = pos.y; this.listener.pos.z = pos.z; }
    if (forward) { this.listener.fwd.x = forward.x; this.listener.fwd.y = forward.y; this.listener.fwd.z = forward.z; }
    if (up) { this.listener.up.x = up.x; this.listener.up.y = up.y; this.listener.up.z = up.z; }
    if (this.ctx) this._applyListener();
  }

  _applyListener() {
    const l = this.ctx.listener, p = this.listener.pos, f = this.listener.fwd, u = this.listener.up;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.01);
      l.positionY.setTargetAtTime(p.y, t, 0.01);
      l.positionZ.setTargetAtTime(p.z, t, 0.01);
      l.forwardX.setTargetAtTime(f.x, t, 0.01);
      l.forwardY.setTargetAtTime(f.y, t, 0.01);
      l.forwardZ.setTargetAtTime(f.z, t, 0.01);
      l.upX.setTargetAtTime(u.x, t, 0.01);
      l.upY.setTargetAtTime(u.y, t, 0.01);
      l.upZ.setTargetAtTime(u.z, t, 0.01);
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  /**
   * Install an occlusion probe. `fn(sourcePos) → 0..1` where 1 means fully
   * blocked; positional voices then get a lowpass + level cut so a footstep
   * behind a wall reads as muffled instead of as a clean slap.
   * @param {null|((pos:{x:number,y:number,z:number})=>number)} fn
   */
  setOcclusionTest(fn) { this._occ = typeof fn === 'function' ? fn : null; }

  /** Pause the whole graph (tab hidden / pause menu). */
  async suspend() {
    if (!this.ctx || this.ctx.state === 'suspended') return;
    try { await this.ctx.suspend(); } catch (e) { /* ignore */ }
  }

  /** Resume after suspend(); also used to un-stick a context after a gesture. */
  async resume() {
    if (!this.ctx || this.ctx.state === 'running') return;
    try { await this.ctx.resume(); } catch (e) { /* ignore */ }
  }

  /** Kill every voice and every loop (round reset / map change). */
  stopAll() {
    for (const v of this.voices.slice()) { try { v.stop(0); } catch (e) { /* ignore */ } }
    this.voices.length = 0;
    for (const l of Array.from(this.loops)) { try { l.stop(0); } catch (e) { /* ignore */ } }
    this.loops.clear();
    this._last.clear();
  }

  /** @returns {boolean} is `name` a sound this engine can synthesize? */
  hasSound(name) { return typeof name === 'string' && Object.prototype.hasOwnProperty.call(this.defs, name); }

  /** @returns {string[]} every registered name (including distance variants). */
  listSounds() { return Object.keys(this.defs).sort(); }

  /** Diagnostics: how many buffers are rendered, how many voices are live. */
  stats() {
    return {
      ready: this._ready, initMs: this._initMs, sounds: Object.keys(this.defs).length,
      rendered: this._buffers.size, voices: this.voices.length, loops: this.loops.size,
      panning: this.panning,
    };
  }

  _dist(p) {
    const l = this.listener.pos;
    return Math.sqrt((p.x - l.x) ** 2 + (p.y - l.y) ** 2 + (p.z - l.z) ** 2);
  }

  // -------------------------------------------------------------------------
  // play() — one-shots
  // -------------------------------------------------------------------------
  /**
   * Fire a one-shot.
   * @param {string} name  a name from listSounds() / api.SOUNDS
   * @param {{pos?:{x:number,y:number,z:number}, vol?:number, pitch?:number,
   *          delay?:number, bus?:'sfx'|'ui'|'music', dist?:number, rev?:number,
   *          force?:boolean}} [opts]
   *        `pos` makes it positional; omit it for UI / local-player sounds.
   * @returns {null|{stop:(when?:number)=>void, setVol:(v:number)=>void, source:AudioBufferSourceNode|null}}
   */
  play(name, opts = {}) {
    if (!this._ready || !this.ctx) return null;          // no-op before init()
    const def = this.defs[name];
    if (!def) return null;
    if (def.kind === 'live' || def.kind === 'loop') return this.loop(name, opts);
    const now = this.ctx.currentTime;
    const min = RATE[name] || 0;
    if (min > 0 && !opts.force) {
      const last = this._last.get(name);
      if (last !== undefined && now - last < min) return null;
    }
    if (min > 0) this._last.set(name, now);
    const pos = opts.pos || null;
    const dist = typeof opts.dist === 'number' ? opts.dist : (pos ? this._dist(pos) : 0);
    if (pos && dist > def.range) return null;            // out of earshot
    const vol = clamp(opts.vol == null ? 1 : opts.vol, 0, 4) * def.gain * rand(1 - def.gjit, 1);
    // Gunfire crossfades into its "distant" render as the listener backs off.
    const far = def.far && dist > FAR_START ? clamp01((dist - FAR_START) / FAR_BLEND) : 0;
    const nearG = Math.cos(far * Math.PI * 0.5), farG = Math.sin(far * Math.PI * 0.5);
    const parts = [];
    if (nearG > 0.03) parts.push(this._voice(name, def, opts, pos, dist, vol * nearG, false));
    if (farG > 0.03) parts.push(this._voice(def.far, this.defs[def.far], opts, pos, dist, vol * farG * 1.2, true));
    if (!parts.length) return null;
    return {
      get source() { return parts[0].source; },
      stop(when) { for (const p of parts) p.stop(when); },
      setVol(v) { for (const p of parts) p.setVol(v); },
    };
  }

  /** One layer of a play() call: waits for the buffer if it is not rendered yet. */
  _voice(name, def, opts, pos, dist, vol, isFar) {
    const self = this;
    const st = { src: null, g: null, voice: null, dead: false, vol };
    const h = {
      get source() { return st.src; },
      stop(when) {
        st.dead = true;
        if (st.voice) self._kill(st.voice, when || 0);
      },
      setVol(v) {
        st.vol = clamp(v, 0, 4);
        if (st.g && self.ctx) st.g.gain.setTargetAtTime(st.vol, self.ctx.currentTime, 0.02);
      },
    };
    if (this._buffers.has(name)) this._start(name, def, opts, pos, dist, st, isFar);
    else {
      this._ensure(name)
        .then(() => { if (!st.dead && this._ready) this._start(name, def, opts, pos, dist, st, isFar); })
        .catch(() => { /* unrenderable — stay silent rather than throw */ });
    }
    return h;
  }

  /** Build the node chain for one rendered buffer and start it. */
  _start(name, def, opts, pos, dist, st, isFar) {
    const ctx = this.ctx, buf = this._buffers.get(name);
    if (!ctx || !buf) return;
    this._limit();
    const t = ctx.currentTime + Math.max(0, opts.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const j = def.jit || 0;
    src.playbackRate.value = clamp((opts.pitch || 1) * (j ? rand(1 - j, 1 + j) : 1), 0.25, 4);
    let node = src;
    // Very close sources get extra body — the "in the room with you" weight.
    if (pos && dist < 7) {
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'lowshelf';
      shelf.frequency.value = 185;
      shelf.gain.value = 5.5 * (1 - dist / 7);
      node.connect(shelf); node = shelf;
    }
    // Occlusion: muffle + duck anything the probe says is behind geometry.
    let occ = 0;
    if (pos && this._occ) { try { occ = clamp01(this._occ(pos)); } catch (e) { occ = 0; } }
    if (occ > 0.02) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380 + 19000 * Math.pow(1 - occ, 3.2);
      lp.Q.value = 0.5;
      const hs = ctx.createBiquadFilter();
      hs.type = 'highshelf'; hs.frequency.value = 1100; hs.gain.value = -16 * occ;
      node.connect(lp); lp.connect(hs); node = hs;
    }

    const g = ctx.createGain();
    g.gain.value = st.vol * (1 - 0.6 * occ);
    node.connect(g);
    // shared reverb send (distant gunfire leans on it hard)
    const rev = clamp01((opts.rev != null ? opts.rev : def.rev) * (isFar ? 2.3 : 1) * (1 - 0.55 * occ));
    if (rev > 0.01 && this.revSend) {
      const s = ctx.createGain();
      s.gain.value = rev;
      g.connect(s); s.connect(this.revSend);
    }
    let out = g;
    if (pos) {
      const p = ctx.createPanner();
      // HRTF is worth it until the mix gets busy, then fall back to equalpower.
      p.panningModel = this.voices.length > 14 ? 'equalpower' : this.panning;
      p.distanceModel = 'inverse';
      p.refDistance = 3;
      p.rolloffFactor = 1.1;
      p.maxDistance = 90;
      if (p.positionX) {
        p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); out = p;
    }
    const bus = this.buses[opts.bus || def.bus] || this.buses.sfx;
    out.connect(bus);
    src.start(t);
    st.src = src; st.g = g;
    const v = { name, g, src, vol: st.vol, t, out };
    st.voice = v;
    this.voices.push(v);
    src.onended = () => {
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
      try { src.disconnect(); g.disconnect(); if (out !== g) out.disconnect(); } catch (e) { /* ignore */ }
    };
  }

  /** Fade + stop a single voice. */
  _kill(v, when = 0) {
    if (!this.ctx || v.killed) return;
    v.killed = true;
    const t = this.ctx.currentTime + Math.max(0, when);
    try {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(A0, t, 0.012);
      v.src.stop(t + 0.07);
    } catch (e) {
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
    }
  }

  /** Voice cap: when full, drop the quietest voice, oldest breaking the tie. */
  _limit() {
    if (this.voices.length < MAX_VOICES) return;
    const now = this.ctx.currentTime;
    let victim = null, worst = Infinity;
    for (const v of this.voices) {
      if (v.killed) continue;
      const score = v.vol * 8 - (now - v.t);       // quiet and old ⇒ lowest
      if (score < worst) { worst = score; victim = v; }
    }
    if (victim) this._kill(victim, 0);
  }

  // -------------------------------------------------------------------------
  // loop() — sustained sounds
  // -------------------------------------------------------------------------
  /**
   * Start a sustained sound. Works for the synthesized loops (fire_loop,
   * smoke_hiss, defuse_loop, tinnitus, ambient_wind, ambient_room) and, for
   * one-shots, as a repeating pulse chain (bomb_beep / bomb_beep_fast).
   * @param {string} name
   * @param {{pos?:object, vol?:number, bus?:string, rate?:number, interval?:number,
   *          fadeIn?:number, fadeOut?:number, rev?:number, delay?:number}} [opts]
   * @returns {null|{stop:(when?:number)=>void, setPos:(p:object)=>void,
   *                 setVol:(v:number)=>void, setRate:(r:number)=>void}}
   */
  loop(name, opts = {}) {
    if (!this._ready || !this.ctx) return null;
    const def = this.defs[name];
    if (!def) return null;
    const ctx = this.ctx;
    const pos = opts.pos ? { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z } : null;
    let vol = clamp(opts.vol == null ? 1 : opts.vol, 0, 4) * def.gain;
    let rate = opts.rate || 1;
    let dead = false, timer = null, src = null, gen = null;
    const g = ctx.createGain();
    g.gain.value = A0;
    g.gain.setTargetAtTime(vol, ctx.currentTime, Math.max(0.004, (opts.fadeIn == null ? 0.12 : opts.fadeIn) / 3));
    const rev = clamp01(opts.rev != null ? opts.rev : def.rev);
    let send = null;
    if (rev > 0.01 && this.revSend) {
      send = ctx.createGain(); send.gain.value = rev;
      g.connect(send); send.connect(this.revSend);
    }
    let panner = null, out = g;
    if (pos) {
      panner = ctx.createPanner();
      panner.panningModel = this.panning;
      panner.distanceModel = 'inverse';
      panner.refDistance = 3;
      panner.rolloffFactor = 1.1;
      panner.maxDistance = 90;
      this._panTo(panner, pos, 0);
      g.connect(panner); out = panner;
    }

    out.connect(this.buses[opts.bus || def.bus] || this.buses.sfx);

    if (def.kind === 'live') {
      // Fully live graph (oscillator based): whirrs, hums, tinnitus, wind.
      gen = def.live(ctx, g, opts) || null;
    } else if (def.kind === 'loop') {
      // Seamless rendered noise bed played with loop = true.
      const startBuf = () => {
        const buf = this._buffers.get(name);
        if (!buf || dead) return;
        src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.loopStart = 0;
        src.loopEnd = buf.duration;
        src.playbackRate.value = rate;
        src.connect(g);
        src.start(ctx.currentTime + Math.max(0, opts.delay || 0), rand(0, buf.duration));
      };
      if (this._buffers.has(name)) startBuf();
      else this._ensure(name).then(startBuf).catch(() => { /* silent */ });
    } else {
      // Repeating one-shot (bomb beeps): schedule ~0.4 s ahead on a JS timer so
      // the tempo stays sample-accurate even when the main thread stutters.
      const base = Math.max(0.05, opts.interval || def.interval || 1);
      let next = ctx.currentTime + Math.max(0, opts.delay || 0);
      const sched = () => {
        if (dead) return;
        const buf = this._buffers.get(name);
        if (!buf) { next = ctx.currentTime + 0.06; this._ensure(name).catch(() => {}); return; }
        const horizon = ctx.currentTime + 0.4;
        let guard = 0;
        while (next < horizon && guard++ < 32) {
          const at = Math.max(next, ctx.currentTime + 0.002);
          const s = ctx.createBufferSource();
          s.buffer = buf;
          s.playbackRate.value = def.jit ? rand(1 - def.jit, 1 + def.jit) : 1;
          s.connect(g);
          s.start(at);
          next += base / Math.max(0.05, rate);
        }
      };
      sched();
      timer = setInterval(sched, 90);
    }

    const self = this;
    const h = {
      stop(when = 0) {
        if (dead) return;
        dead = true;
        const fade = opts.fadeOut == null ? 0.16 : opts.fadeOut;
        const t = ctx.currentTime + Math.max(0, when);
        try {
          g.gain.cancelScheduledValues(t);
          g.gain.setTargetAtTime(A0, t, Math.max(0.004, fade / 3));
        } catch (e) { /* ignore */ }
        if (timer) { clearInterval(timer); timer = null; }
        const done = () => {
          try { if (src) src.stop(); } catch (e) { /* ignore */ }
          try { gen && gen.stop && gen.stop(); } catch (e) { /* ignore */ }
          try { g.disconnect(); send && send.disconnect(); panner && panner.disconnect(); } catch (e) { /* ignore */ }
          self.loops.delete(h);
        };
        setTimeout(done, (Math.max(0, when) + fade + 0.12) * 1000);
      },
      setPos(p) {
        if (!p || !panner) return;
        pos.x = p.x; pos.y = p.y; pos.z = p.z;
        self._panTo(panner, pos, 0.03);
      },
      setVol(v) {
        vol = clamp(v, 0, 4) * def.gain;
        if (!dead) g.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
      },
      setRate(r) {
        rate = clamp(r || 1, 0.05, 6);
        if (src) src.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.05);
        if (gen && gen.setRate) gen.setRate(rate);
      },
      get name() { return name; },
    };
    this.loops.add(h);
    return h;
  }

  /** Write a position into a PannerNode, ramped when `smooth` > 0. */
  _panTo(p, pos, smooth) {
    if (p.positionX) {
      const t = this.ctx.currentTime;
      if (smooth > 0) {
        p.positionX.setTargetAtTime(pos.x, t, smooth);
        p.positionY.setTargetAtTime(pos.y, t, smooth);
        p.positionZ.setTargetAtTime(pos.z, t, smooth);
      } else { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    } else p.setPosition(pos.x, pos.y, pos.z);
  }

  // -------------------------------------------------------------------------
  // Offline rendering: every one-shot becomes an AudioBuffer exactly once
  // -------------------------------------------------------------------------
  /** @returns {Promise<AudioBuffer>} render `name` if needed, then cache it. */
  _ensure(name) {
    if (this._buffers.has(name)) return Promise.resolve(this._buffers.get(name));
    if (this._pending.has(name)) return this._pending.get(name);
    const def = this.defs[name];
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    const OAC = g.OfflineAudioContext || g.webkitOfflineAudioContext || null;
    if (!def || def.kind === 'live' || !this.ctx || !OAC) {
      return Promise.reject(new Error(`[audio] cannot render ${name}`));
    }
    const sr = this.ctx.sampleRate;
    const p = (async () => {
      const oc = new OAC(def.ch || 1, Math.max(256, Math.ceil((def.dur + 0.05) * sr)), sr);
      const out = oc.createGain();
      out.gain.value = 1;
      out.connect(oc.destination);
      def.build(oc, out);
      const buf = await new Promise((res, rej) => {
        oc.oncomplete = (e) => res(e.renderedBuffer);
        const pr = oc.startRendering();
        if (pr && pr.then) pr.then(res, rej);
      });
      this._buffers.set(name, buf);
      this._pending.delete(name);
      return buf;
    })();
    this._pending.set(name, p);
    p.catch(() => this._pending.delete(name));
    return p;
  }

  /** Cached noise beds (one per context) — every noise layer reads from these. */
  _noiseBuf(ctx, kind) {
    let e = this._noise.get(ctx);
    if (!e) { e = {}; this._noise.set(ctx, e); }
    if (e[kind]) return e[kind];
    const sr = ctx.sampleRate, len = Math.floor(sr * 2);
    const b = ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    if (kind === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.0555; b1 = 0.985 * b1 + w * 0.075; b2 = 0.95 * b2 + w * 0.153;
        d[i] = clamp((b0 + b1 + b2 + w * 0.32) * 1.5, -1, 1);
      }
    } else for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    e[kind] = b;
    return b;
  }

  _noiseSrc(ctx, kind) {
    const s = ctx.createBufferSource();
    s.buffer = this._noiseBuf(ctx, kind || 'white');
    s.loop = true;
    return s;
  }

  // -------------------------------------------------------------------------
  // Synthesis primitives — everything above is built out of these five.
  // -------------------------------------------------------------------------
  /** Filtered noise burst with an exponential filter sweep and A/D envelope. */
  _burst(ctx, out, o) {
    const t = o.t || 0, dur = Math.max(0.004, o.dur);
    const src = this._noiseSrc(ctx, o.noise);
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q == null ? 1 : o.q;
    const f0 = Math.max(20, o.f0);
    f.frequency.setValueAtTime(f0, t);
    if (o.f1 && Math.abs(o.f1 - f0) > 1) {
      f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur * (o.fsweep || 1));
    }
    src.connect(f);
    let node = f;
    if (o.hp) {
      const h = ctx.createBiquadFilter();
      h.type = 'highpass'; h.frequency.value = o.hp; h.Q.value = 0.7;
      node.connect(h); node = h;
    }
    if (o.lp) {
      const l = ctx.createBiquadFilter();
      l.type = 'lowpass'; l.frequency.value = o.lp; l.Q.value = 0.6;
      node.connect(l); node = l;
    }
    const g = ctx.createGain();
    const pk = Math.max(A0 * 2, o.gain == null ? 0.4 : o.gain);
    const a = Math.max(0.0002, Math.min(o.attack == null ? 0.0015 : o.attack, dur * 0.5));
    g.gain.setValueAtTime(A0, t);
    g.gain.exponentialRampToValueAtTime(pk, t + a);
    if (o.hold) g.gain.setValueAtTime(pk, t + Math.min(dur * 0.9, a + o.hold));
    g.gain.exponentialRampToValueAtTime(A0, t + dur);
    node.connect(g);
    g.connect(out);
    src.start(t, rand(0, 1.6));
    src.stop(t + dur + 0.01);
    return g;
  }

  /** Pitch-swept oscillator with an A/D envelope — the "thump" of every gun. */
  _thump(ctx, out, o) {
    const t = o.t || 0, dur = Math.max(0.008, o.dur);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    const f0 = Math.max(10, o.f0);
    osc.frequency.setValueAtTime(f0, t);
    const f1 = Math.max(8, o.f1 == null ? f0 * 0.4 : o.f1);
    if (Math.abs(f1 - f0) > 0.5) {
      osc.frequency.exponentialRampToValueAtTime(f1, t + dur * (o.fsweep || 0.85));
    }
    const g = ctx.createGain();
    const pk = Math.max(A0 * 2, o.gain == null ? 0.5 : o.gain);
    const a = Math.max(0.0003, Math.min(o.attack == null ? 0.002 : o.attack, dur * 0.4));
    g.gain.setValueAtTime(A0, t);
    g.gain.exponentialRampToValueAtTime(pk, t + a);
    if (o.hold) g.gain.setValueAtTime(pk, t + Math.min(dur * 0.9, a + o.hold));
    g.gain.exponentialRampToValueAtTime(A0, t + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.01);
    return g;
  }

  /** 1–3 ms transient: the crack that makes a gunshot read as a gunshot. */
  _click(ctx, out, o) {
    return this._burst(ctx, out, {
      t: o.t || 0, dur: o.dur || 0.0025, type: 'highpass',
      f0: o.f || 3000, q: 0.6, gain: o.gain == null ? 0.7 : o.gain, attack: 0.0004,
    });
  }

  /** Modal resonance: decaying tone + short band-limited excitation noise. */
  _reso(ctx, out, o) {
    const dur = o.dur || 0.12, gain = o.gain == null ? 0.2 : o.gain;
    this._thump(ctx, out, {
      t: o.t, f0: o.f, f1: o.f * (o.bend || 0.985), dur,
      gain, type: o.type || 'sine', attack: 0.0008,
    });
    if (o.ex !== false) {
      this._burst(ctx, out, {
        t: o.t, dur: Math.min(dur, 0.022), type: 'bandpass', f0: o.f,
        q: o.q == null ? 6 : o.q, gain: gain * 0.65, attack: 0.0006,
      });
    }
  }

  /** Inharmonic partial bank = metal. Slides, clanks, helmet pings, casings. */
  _metal(ctx, out, o) {
    const t = o.t || 0, dur = o.dur || 0.2, gain = o.gain == null ? 0.15 : o.gain;
    const fs = o.freqs || [2600, 3900, 5300];
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i] * rand(0.994, 1.006);
      this._thump(ctx, out, {
        t: t + (o.spread ? rand(0, o.spread) : 0), f0: f, f1: f * 0.996,
        dur: Math.max(0.02, dur * (1 - i * 0.15) * rand(0.82, 1.18)),
        gain: gain * (1 - i * 0.17), type: 'sine', attack: 0.0006,
      });
    }
    if (o.click !== false) {
      this._click(ctx, out, { t, f: Math.min(9000, fs[0] * 1.25), gain: gain * 1.7, dur: 0.002 });
    }
  }

  /** Oscillator voice (optionally a detuned stack) with an optional filter sweep. */
  _tone(ctx, out, o) {
    const t = o.t || 0, dur = Math.max(0.01, o.dur || 0.15);
    const n = o.voices || 1;
    const g = ctx.createGain();
    const pk = Math.max(A0 * 2, o.gain == null ? 0.25 : o.gain);
    const a = Math.max(0.0004, Math.min(o.attack == null ? 0.005 : o.attack, dur * 0.5));
    g.gain.setValueAtTime(A0, t);
    g.gain.exponentialRampToValueAtTime(pk, t + a);
    if (o.hold) g.gain.setValueAtTime(pk, t + Math.min(dur * 0.92, a + o.hold));
    g.gain.exponentialRampToValueAtTime(A0, t + dur);
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(Math.max(8, o.f), t);
      if (o.f2 && Math.abs(o.f2 - o.f) > 0.5) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(8, o.f2), t + dur * (o.fsweep || 1));
      }
      if (n > 1) osc.detune.value = (i - (n - 1) / 2) * (o.detune || 9);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
    if (o.lp) {
      const l = ctx.createBiquadFilter();
      l.type = 'lowpass';
      l.frequency.setValueAtTime(o.lp, t);
      if (o.lp2) l.frequency.exponentialRampToValueAtTime(Math.max(40, o.lp2), t + dur);
      l.Q.value = o.lq == null ? 0.8 : o.lq;
      g.connect(l); l.connect(out);
    } else g.connect(out);
    return g;
  }

  /** Detuned chord stack (+ optional sub) used by the musical stings. */
  _chord(ctx, out, o) {
    const t = o.t || 0, dur = o.dur || 1.2, gain = o.gain == null ? 0.11 : o.gain;
    const notes = o.freqs || [220];
    for (let i = 0; i < notes.length; i++) {
      let dest = out;
      if (o.width) {                       // spread the voices across the stereo field
        const sp = ctx.createStereoPanner();
        sp.pan.value = clamp((i / Math.max(1, notes.length - 1) - 0.5) * 2 * o.width, -1, 1);
        sp.connect(out);
        dest = sp;
      }
      this._tone(ctx, dest, {
        t: t + (o.strum ? i * o.strum : 0), f: notes[i], dur: dur * rand(0.93, 1),
        gain, type: o.type || 'sawtooth', voices: o.voices || 3, detune: o.detune || 10,
        attack: o.attack == null ? 0.02 : o.attack,
        hold: o.hold == null ? dur * 0.42 : o.hold,
        lp: o.lp || 2400, lp2: o.lp2, lq: o.lq,
      });
    }
    if (o.sub) {
      this._tone(ctx, out, {
        t, f: o.sub, dur: dur * 0.92, gain: gain * 1.6, type: 'triangle',
        attack: 0.012, hold: dur * 0.4,
      });
    }
  }

  /** Scatter of small pops = falling debris / glass tinkle / fire crackle. */
  _debris(ctx, out, o) {
    const t = o.t || 0, n = o.count || 24, span = o.span || 1;
    const gain = o.gain == null ? 0.1 : o.gain;
    for (let i = 0; i < n; i++) {
      const p = Math.pow(Math.random(), o.bias || 1.6);   // dense at the start
      const f = rand(o.f0 || 700, o.f1 || 5200);
      this._burst(ctx, out, {
        t: t + p * span, dur: rand(0.008, o.pop || 0.05), type: 'bandpass',
        f0: f, f1: f * 0.55, q: rand(2, 7), attack: 0.0006,
        gain: gain * rand(0.3, 1) * (1 - p * (o.fade == null ? 0.75 : o.fade)),
      });
    }
  }

  /** Descending resonant chirp: springs, slides returning, ricochet whistle. */
  _spring(ctx, out, o) {
    const dur = o.dur || 0.09, gain = o.gain == null ? 0.08 : o.gain;
    this._tone(ctx, out, { t: o.t, f: o.f0 || 1500, f2: o.f1 || 520, dur, gain, type: o.type || 'triangle', attack: 0.001 });
    this._burst(ctx, out, { t: o.t, dur, type: 'bandpass', f0: o.f0 || 1500, f1: o.f1 || 520, q: 5, gain: gain * 0.7, attack: 0.001 });
  }

  /** Swelling band-passed pink noise: cloth, swishes, gear movement. */
  _cloth(ctx, out, o) {
    const dur = o.dur || 0.16;
    return this._burst(ctx, out, {
      t: o.t, dur, type: 'bandpass', f0: o.f0 || 420, f1: o.f1 || 1500, q: o.q == null ? 0.8 : o.q,
      gain: o.gain == null ? 0.16 : o.gain, attack: dur * (o.swell == null ? 0.35 : o.swell), noise: 'pink',
    });
  }

  /**
   * Formant-filtered buzz + noise. This is how the death "groan" is made — a
   * glottal-ish sawtooth and pink noise pushed through three vowel formants,
   * so there is no sample or recording anywhere in the pipeline.
   */
  _formants(ctx, out, o) {
    const t = o.t || 0, dur = o.dur || 0.5;
    const src = this._noiseSrc(ctx, 'pink');
    const buzz = ctx.createOscillator();
    buzz.type = 'sawtooth';
    buzz.frequency.setValueAtTime(o.p0 || 145, t);
    buzz.frequency.exponentialRampToValueAtTime(Math.max(35, o.p1 || 92), t + dur);
    const mix = ctx.createGain();
    const bg = ctx.createGain(); bg.gain.value = o.buzz == null ? 0.5 : o.buzz;
    const ng = ctx.createGain(); ng.gain.value = o.noise == null ? 0.5 : o.noise;
    buzz.connect(bg); bg.connect(mix);
    src.connect(ng); ng.connect(mix);
    const env = ctx.createGain();
    const pk = Math.max(A0 * 2, o.gain == null ? 0.4 : o.gain);
    env.gain.setValueAtTime(A0, t);
    env.gain.exponentialRampToValueAtTime(pk, t + Math.min(0.06, dur * 0.25));
    env.gain.exponentialRampToValueAtTime(A0, t + dur);
    const F = o.f || [520, 1080, 2500], Q = o.q || [7, 9, 11], amp = [1, 0.5, 0.22];
    for (let i = 0; i < F.length; i++) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(F[i], t);
      f.frequency.exponentialRampToValueAtTime(F[i] * (o.fdrop || 0.8), t + dur);
      f.Q.value = Q[i];
      const a = ctx.createGain();
      a.gain.value = amp[i];
      mix.connect(f); f.connect(a); a.connect(env);
    }
    env.connect(out);
    src.start(t, rand(0, 1.6));
    src.stop(t + dur + 0.02);
    buzz.start(t);
    buzz.stop(t + dur + 0.02);
  }

  /**
   * The gunfire builder — four stacked layers, one parameter set per weapon:
   *  (1) 1–3 ms transient click, (2) body = filtered noise burst + a fast
   *  pitch-swept low sine thump, (3) tail = short filtered noise decay (the
   *  convolver send is added at play time), (4) a tiny metallic action click.
   */
  _gunShot(ctx, out, p) {
    const t = p.t || 0;
    this._click(ctx, out, { t, dur: p.clickDur || 0.0025, f: p.clickF || 3200, gain: p.click == null ? 0.8 : p.click });
    this._burst(ctx, out, {
      t, dur: p.bodyDur, type: 'bandpass', f0: p.bodyF0, f1: p.bodyF1 || p.bodyF0 * 0.42,
      q: p.bodyQ == null ? 0.9 : p.bodyQ, gain: p.bodyGain, attack: 0.0015,
    });
    if (p.wide) {                                   // broadband shove (shotguns)
      this._burst(ctx, out, {
        t: t + 0.001, dur: p.bodyDur * 1.3, type: 'lowpass', f0: 4200, f1: 700,
        q: 0.4, gain: p.wide, attack: 0.001,
      });
    }
    if (p.crack) {
      this._burst(ctx, out, {
        t, dur: p.crackDur || 0.04, type: 'highpass', f0: p.crackF || 2800,
        q: 0.6, gain: p.crack, attack: 0.001,
      });
    }
    this._thump(ctx, out, {
      t, f0: p.thumpF0, f1: p.thumpF1, dur: p.thumpDur, gain: p.thumpGain, attack: 0.0012,
    });
    this._burst(ctx, out, {
      t: t + (p.tailT == null ? 0.012 : p.tailT), dur: p.tailDur, type: 'lowpass',
      f0: p.tailF0 || 1800, f1: p.tailF1 || 280, q: 0.5, gain: p.tailGain,
      attack: 0.004, noise: 'pink',
    });
    if (p.resoF) {
      this._reso(ctx, out, {
        t, f: p.resoF, q: p.resoQ || 9, dur: p.resoDur || 0.09, gain: p.resoGain || 0.12,
      });
    }
    if (p.mech !== 0) {
      this._metal(ctx, out, {
        t: t + (p.mechT == null ? 0.022 : p.mechT), freqs: p.mechF || [2600, 3900, 5200],
        dur: p.mechDur || 0.035, gain: p.mech == null ? 0.05 : p.mech, spread: 0.006,
      });
    }
  }

  /**
   * Wrap a gunshot def into its "heard from across the map" render: heavily
   * lowpassed, transient softened, plus slap-back reflections and a rolling
   * rumble tail. play() crossfades to this past FAR_START metres.
   */
  _farDef(base, o) {
    const lp = o.lp || 900;
    return def(base.dur + (o.tail || 1), (ctx, out) => {
      const pre = ctx.createGain();
      pre.gain.value = o.pre == null ? 1.2 : o.pre;
      const f1 = ctx.createBiquadFilter();
      f1.type = 'lowpass'; f1.frequency.value = lp; f1.Q.value = 0.5;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass'; f2.frequency.value = lp * 1.5; f2.Q.value = 0.3;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 72; hp.Q.value = 0.6;
      base.build(ctx, pre);
      pre.connect(f1); f1.connect(f2); f2.connect(hp); hp.connect(out);
      for (const [dt, gv] of (o.taps || [[0.085, 0.42], [0.168, 0.26], [0.295, 0.14]])) {
        const dl = ctx.createDelay(1);
        dl.delayTime.value = dt;
        const dg = ctx.createGain();
        dg.gain.value = gv;
        const dk = ctx.createBiquadFilter();
        dk.type = 'lowpass'; dk.frequency.value = lp * 0.66;
        hp.connect(dl); dl.connect(dk); dk.connect(dg); dg.connect(out);
      }
      this._burst(ctx, out, {
        t: 0.02, dur: o.tail || 1, type: 'lowpass', f0: 520, f1: 90, q: 0.4,
        gain: o.rumble || 0.15, attack: 0.05, noise: 'pink',
      });
      this._burst(ctx, out, {
        t: 0, dur: 0.06, type: 'bandpass', f0: lp * 1.7, q: 1.2,
        gain: o.crack || 0.06, attack: 0.002,
      });
    }, { rev: 0.95, gain: base.gain * (o.gain || 0.9), jit: 0.04, gjit: 0.1, range: 170 });
  }

  /** Assemble the whole synth table (pure data + closures — no ctx touched). */
  _buildDefs() {
    const d = Object.assign({}, this._defsGuns(), this._defsHandling(), this._defsMove(),
      this._defsFlesh(), this._defsImpacts(), this._defsNades(), this._defsObjective(),
      this._defsUI(), this._defsLoops());
    const far = {
      shoot_pistol: { lp: 780, tail: 0.85, gain: 0.85 },
      shoot_pistol_big: { lp: 620, tail: 1.35, rumble: 0.22 },
      shoot_silenced: { lp: 520, tail: 0.45, gain: 0.5, rumble: 0.05, taps: [[0.07, 0.2]] },
      shoot_smg: { lp: 900, tail: 0.8, gain: 0.85 },
      shoot_rifle: { lp: 820, tail: 1.05 },
      shoot_ak: { lp: 700, tail: 1.2, rumble: 0.2 },
      shoot_m4: { lp: 950, tail: 1.0 },
      shoot_awp: { lp: 560, tail: 1.9, rumble: 0.26, gain: 1 },
      shoot_scout: { lp: 1000, tail: 1.1 },
      shoot_shotgun: { lp: 640, tail: 1.3, rumble: 0.22 },
      shoot_auto: { lp: 760, tail: 1.1 },
    };
    for (const n of Object.keys(far)) {
      const fn = `${n}_far`;
      d[fn] = this._farDef(d[n], far[n]);
      d[n].far = fn;
    }
    return d;
  }

  // -------------------------------------------------------------------------
  // Gunfire — same four-layer recipe, one distinct parameter set per archetype
  // -------------------------------------------------------------------------
  _defsGuns() {
    const g = (dur, p, o, extra) => def(dur, (ctx, out) => {
      this._gunShot(ctx, out, p);
      if (extra) extra(ctx, out);
    }, { rev: 0.5, jit: 0.035, gjit: 0.1, range: 150, ...o });
    return {
      // dry 9 mm snap
      shoot_pistol: g(0.19, {
        click: 0.85, clickF: 3600, bodyF0: 1600, bodyF1: 620, bodyDur: 0.05, bodyGain: 0.55,
        bodyQ: 0.85, crack: 0.3, crackF: 3000, crackDur: 0.035, thumpF0: 175, thumpF1: 62,
        thumpDur: 0.07, thumpGain: 0.38, tailDur: 0.12, tailF0: 1600, tailF1: 260,
        tailGain: 0.12, mechF: [2700, 3950, 5300], mech: 0.045,
      }, { gain: 0.82 }),
      // Deagle: huge low boom
      shoot_pistol_big: g(0.4, {
        click: 1, clickF: 2600, bodyF0: 940, bodyF1: 330, bodyDur: 0.09, bodyGain: 0.85,
        bodyQ: 0.7, crack: 0.38, crackF: 2400, crackDur: 0.05, thumpF0: 120, thumpF1: 36,
        thumpDur: 0.2, thumpGain: 0.95, tailDur: 0.3, tailF0: 1300, tailF1: 150, tailGain: 0.24,
        resoF: 300, resoQ: 5, resoGain: 0.1, resoDur: 0.13, mechF: [1900, 2900, 4100],
        mech: 0.07, mechT: 0.05,
      }, { gain: 1, rev: 0.62 }),
      // suppressed: soft thud + the spring letting go
      shoot_silenced: g(0.18, {
        click: 0.16, clickF: 1600, bodyF0: 700, bodyF1: 250, bodyDur: 0.055, bodyGain: 0.36,
        bodyQ: 1.1, crack: 0, thumpF0: 150, thumpF1: 70, thumpDur: 0.05, thumpGain: 0.2,
        tailDur: 0.07, tailF0: 900, tailF1: 200, tailGain: 0.05, mechF: [2200, 3300, 4200],
        mech: 0.09, mechT: 0.012,
      }, { gain: 0.6, rev: 0.16, range: 70 },
      (ctx, out) => this._spring(ctx, out, { t: 0.03, f0: 1400, f1: 470, dur: 0.07, gain: 0.05 })),
      // SMG: fast bright crackle
      shoot_smg: g(0.15, {
        click: 0.8, clickF: 4000, bodyF0: 1950, bodyF1: 820, bodyDur: 0.035, bodyGain: 0.5,
        bodyQ: 0.9, crack: 0.44, crackF: 3400, crackDur: 0.028, thumpF0: 195, thumpF1: 80,
        thumpDur: 0.05, thumpGain: 0.3, tailDur: 0.09, tailF0: 1900, tailF1: 300,
        tailGain: 0.1, mechF: [3400, 5200, 6600], mech: 0.06, mechT: 0.018,
      }, { gain: 0.8 }),
      // generic rifle (Galil/Famas/AUG/SG)
      shoot_rifle: g(0.24, {
        click: 0.9, clickF: 3400, bodyF0: 1400, bodyF1: 520, bodyDur: 0.06, bodyGain: 0.66,
        bodyQ: 0.8, crack: 0.45, crackF: 2900, crackDur: 0.04, thumpF0: 145, thumpF1: 50,
        thumpDur: 0.1, thumpGain: 0.58, tailDur: 0.18, tailF0: 1700, tailF1: 240,
        tailGain: 0.16, resoF: 520, resoQ: 7, resoGain: 0.1, mechF: [2800, 4200, 5500], mech: 0.05,
      }, { gain: 0.92 }),

      // AK: deeper, woody resonance
      shoot_ak: g(0.3, {
        click: 0.92, clickF: 3000, bodyF0: 1150, bodyF1: 420, bodyDur: 0.07, bodyGain: 0.74,
        bodyQ: 0.75, crack: 0.4, crackF: 2500, crackDur: 0.045, thumpF0: 126, thumpF1: 42,
        thumpDur: 0.13, thumpGain: 0.72, tailDur: 0.24, tailF0: 1450, tailF1: 200,
        tailGain: 0.2, resoF: 470, resoQ: 8, resoGain: 0.18, resoDur: 0.1,
        mechF: [2200, 3100, 4300], mech: 0.055,
      }, { gain: 0.98, rev: 0.55 }),
      // M4: tighter, higher crack
      shoot_m4: g(0.21, {
        click: 0.95, clickF: 4400, bodyF0: 1800, bodyF1: 700, bodyDur: 0.048, bodyGain: 0.62,
        bodyQ: 1, crack: 0.62, crackF: 3700, crackDur: 0.032, thumpF0: 168, thumpF1: 60,
        thumpDur: 0.08, thumpGain: 0.46, tailDur: 0.15, tailF0: 2200, tailF1: 320,
        tailGain: 0.13, resoF: 900, resoQ: 10, resoGain: 0.07, mechF: [3100, 4500, 5900], mech: 0.05,
      }, { gain: 0.92 }),
      // AWP: enormous slow boom, long tail
      shoot_awp: g(0.85, {
        click: 1, clickF: 2400, clickDur: 0.003, bodyF0: 820, bodyF1: 250, bodyDur: 0.14,
        bodyGain: 0.92, bodyQ: 0.6, crack: 0.36, crackF: 2100, crackDur: 0.06, thumpF0: 98,
        thumpF1: 28, thumpDur: 0.32, thumpGain: 1, tailDur: 0.75, tailF0: 1100, tailF1: 110,
        tailGain: 0.3, resoF: 290, resoQ: 5, resoGain: 0.12, resoDur: 0.19,
        mechF: [1800, 2700, 3800], mech: 0.06, mechT: 0.06,
      }, { gain: 1.05, rev: 0.95, range: 200 }),
      // Scout: sharp mid crack
      shoot_scout: g(0.29, {
        click: 0.95, clickF: 4600, bodyF0: 2050, bodyF1: 760, bodyDur: 0.055, bodyGain: 0.62,
        bodyQ: 1.1, crack: 0.58, crackF: 3900, crackDur: 0.04, thumpF0: 152, thumpF1: 54,
        thumpDur: 0.09, thumpGain: 0.42, tailDur: 0.22, tailF0: 2000, tailF1: 250,
        tailGain: 0.15, mechF: [3000, 4600, 6200], mech: 0.06, mechT: 0.05,
      }, { gain: 0.95, rev: 0.7 }),
      // shotguns: broadband blast
      shoot_shotgun: g(0.44, {
        click: 0.85, clickF: 2800, bodyF0: 1200, bodyF1: 420, bodyDur: 0.12, bodyGain: 0.8,
        bodyQ: 0.45, wide: 0.5, crack: 0.3, crackF: 2600, crackDur: 0.07, thumpF0: 112,
        thumpF1: 34, thumpDur: 0.17, thumpGain: 0.75, tailDur: 0.35, tailF0: 1400, tailF1: 130,
        tailGain: 0.26, mechF: [1700, 2500, 3400], mech: 0.05, mechT: 0.03,
      }, { gain: 1, rev: 0.7 }),
      // Negev: heavier rattle
      shoot_auto: g(0.28, {
        click: 0.9, clickF: 3200, bodyF0: 1260, bodyF1: 500, bodyDur: 0.062, bodyGain: 0.72,
        bodyQ: 0.8, crack: 0.36, crackF: 2700, crackDur: 0.04, thumpF0: 136, thumpF1: 46,
        thumpDur: 0.11, thumpGain: 0.62, tailDur: 0.2, tailF0: 1500, tailF1: 210,
        tailGain: 0.18, resoF: 380, resoQ: 6, resoGain: 0.12, mechF: [2400, 3300, 4600],
        mech: 0.09, mechT: 0.026, mechDur: 0.05,
      }, { gain: 0.95 },
      (ctx, out) => this._metal(ctx, out, {
        t: 0.04, freqs: [1500, 2100, 2900], dur: 0.06, gain: 0.05, spread: 0.022, click: false,
      })),

      // empty chamber: pure mechanism, no powder
      dryfire: def(0.13, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 2100, gain: 0.35, dur: 0.003 });
        this._metal(ctx, out, { t: 0, freqs: [2400, 3600, 5100], dur: 0.05, gain: 0.3 });
        this._spring(ctx, out, { t: 0.012, f0: 1200, f1: 600, dur: 0.05, gain: 0.05 });
      }, { gain: 0.8, rev: 0.12, range: 30 }),
      // knife: air first, then contact
      knife_swing: def(0.26, (ctx, out) => {
        this._cloth(ctx, out, { t: 0, dur: 0.14, f0: 380, f1: 2400, gain: 0.24, q: 0.7, swell: 0.5 });
        this._cloth(ctx, out, { t: 0.1, dur: 0.13, f0: 2300, f1: 600, gain: 0.14, swell: 0.15 });
      }, { gain: 0.7, rev: 0.2, range: 40 }),
      knife_hit: def(0.26, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 5200, gain: 0.4, dur: 0.002 });
        this._burst(ctx, out, { t: 0, dur: 0.05, type: 'bandpass', f0: 1800, f1: 600, q: 1.4, gain: 0.4 });
        this._thump(ctx, out, { t: 0, f0: 220, f1: 90, dur: 0.09, gain: 0.3 });
        this._burst(ctx, out, { t: 0.01, dur: 0.13, type: 'lowpass', f0: 900, f1: 200, q: 0.5, gain: 0.12, noise: 'pink' });
        this._metal(ctx, out, { t: 0.004, freqs: [4200, 6100], dur: 0.05, gain: 0.04, click: false });
      }, { gain: 0.9, rev: 0.3, range: 45 }),
      knife_stab: def(0.38, (ctx, out) => {
        this._thump(ctx, out, { t: 0, f0: 150, f1: 60, dur: 0.14, gain: 0.5 });
        this._burst(ctx, out, { t: 0, dur: 0.09, type: 'lowpass', f0: 760, f1: 200, q: 0.6, gain: 0.45 });
        this._debris(ctx, out, { t: 0.004, count: 8, span: 0.09, f0: 900, f1: 2600, gain: 0.09, pop: 0.02, bias: 1 });
        this._metal(ctx, out, { t: 0.02, freqs: [3800, 5200], dur: 0.09, gain: 0.05, click: false });
      }, { gain: 0.95, rev: 0.3, range: 45 }),
    };
  }

  // -------------------------------------------------------------------------
  // Weapon handling — plastic, metal, springs and cloth
  // -------------------------------------------------------------------------
  _defsHandling() {
    /** Plastic-on-metal tap: a resonant knock plus a bright edge. */
    const tap = (ctx, out, t, f, gain, dur) => {
      this._reso(ctx, out, { t, f, q: 6, dur: dur || 0.05, gain });
      this._click(ctx, out, { t, f: f * 3.2, gain: gain * 0.5, dur: 0.002 });
    };
    return {
      // mag out: plastic clatter, three taps, then the mag leaving the well
      reload_mag_out: def(0.3, (ctx, out) => {
        tap(ctx, out, 0, 1250, 0.28);
        tap(ctx, out, 0.045, 820, 0.2);
        this._metal(ctx, out, { t: 0.06, freqs: [2600, 3500, 4700], dur: 0.06, gain: 0.06, spread: 0.03 });
        this._cloth(ctx, out, { t: 0.09, dur: 0.13, f0: 500, f1: 1400, gain: 0.1 });
        tap(ctx, out, 0.16, 1500, 0.14, 0.04);
      }, { gain: 0.75, rev: 0.25, range: 35 }),

      // mag in: guided, then a firm seating thunk
      reload_mag_in: def(0.3, (ctx, out) => {
        this._cloth(ctx, out, { t: 0, dur: 0.1, f0: 600, f1: 1300, gain: 0.09 });
        tap(ctx, out, 0.06, 700, 0.3, 0.06);
        this._thump(ctx, out, { t: 0.06, f0: 180, f1: 90, dur: 0.07, gain: 0.22 });
        tap(ctx, out, 0.15, 1900, 0.22, 0.035);
        this._metal(ctx, out, { t: 0.155, freqs: [3200, 4600, 6000], dur: 0.05, gain: 0.07 });
      }, { gain: 0.75, rev: 0.25, range: 35 }),
      // bolt: metallic slide up, spring back, clack home
      reload_bolt: def(0.34, (ctx, out) => {
        this._burst(ctx, out, { t: 0, dur: 0.1, type: 'bandpass', f0: 900, f1: 3000, q: 1.6, gain: 0.2, attack: 0.02 });
        this._metal(ctx, out, { t: 0.005, freqs: [2900, 4200, 5600], dur: 0.07, gain: 0.12, spread: 0.02 });
        this._spring(ctx, out, { t: 0.1, f0: 1800, f1: 520, dur: 0.11, gain: 0.09 });
        this._metal(ctx, out, { t: 0.2, freqs: [2100, 3300, 4800], dur: 0.09, gain: 0.22 });
        this._thump(ctx, out, { t: 0.2, f0: 220, f1: 95, dur: 0.07, gain: 0.18 });
      }, { gain: 0.8, rev: 0.28, range: 35 }),
      // single shell pushed into the tube
      reload_shell: def(0.18, (ctx, out) => {
        this._burst(ctx, out, { t: 0, dur: 0.06, type: 'bandpass', f0: 2400, f1: 1200, q: 2.2, gain: 0.16, attack: 0.012 });
        tap(ctx, out, 0.045, 980, 0.22, 0.05);
        this._metal(ctx, out, { t: 0.05, freqs: [3600, 5200], dur: 0.04, gain: 0.05, click: false });
      }, { gain: 0.7, rev: 0.22, range: 30 }),
      // classic two-stage pump
      reload_pump: def(0.42, (ctx, out) => {
        this._metal(ctx, out, { t: 0, freqs: [1900, 2800, 3900], dur: 0.08, gain: 0.26 });
        this._burst(ctx, out, { t: 0.01, dur: 0.09, type: 'bandpass', f0: 1100, f1: 2600, q: 1.4, gain: 0.16, attack: 0.03 });
        this._thump(ctx, out, { t: 0, f0: 200, f1: 90, dur: 0.08, gain: 0.2 });
        this._metal(ctx, out, { t: 0.18, freqs: [1600, 2400, 3400], dur: 0.1, gain: 0.3 });
        this._thump(ctx, out, { t: 0.18, f0: 170, f1: 70, dur: 0.11, gain: 0.28 });
        this._spring(ctx, out, { t: 0.2, f0: 1300, f1: 480, dur: 0.09, gain: 0.06 });
      }, { gain: 0.85, rev: 0.3, range: 40 }),
      // raise / lower: cloth plus a little hardware
      deploy: def(0.3, (ctx, out) => {
        this._cloth(ctx, out, { t: 0, dur: 0.18, f0: 320, f1: 1500, gain: 0.16, swell: 0.45 });
        this._metal(ctx, out, { t: 0.11, freqs: [3000, 4400, 5900], dur: 0.07, gain: 0.09 });
        tap(ctx, out, 0.13, 1200, 0.12, 0.045);
      }, { gain: 0.7, rev: 0.2, range: 25 }),
      holster: def(0.28, (ctx, out) => {
        this._cloth(ctx, out, { t: 0, dur: 0.16, f0: 1400, f1: 380, gain: 0.14, swell: 0.2 });
        this._metal(ctx, out, { t: 0.02, freqs: [2400, 3300, 4200], dur: 0.06, gain: 0.07 });
        this._thump(ctx, out, { t: 0.12, f0: 180, f1: 90, dur: 0.06, gain: 0.1 });
      }, { gain: 0.65, rev: 0.2, range: 25 }),
      // scope: short mechanical clicks, up then down
      zoom_in: def(0.1, (ctx, out) => {
        this._metal(ctx, out, { t: 0, freqs: [3400, 4900], dur: 0.035, gain: 0.16 });
        this._reso(ctx, out, { t: 0.006, f: 1500, q: 8, dur: 0.04, gain: 0.1 });
      }, { bus: 'ui', gain: 0.55, rev: 0.05 }),
      zoom_out: def(0.1, (ctx, out) => {
        this._metal(ctx, out, { t: 0, freqs: [2600, 3700], dur: 0.035, gain: 0.16 });
        this._reso(ctx, out, { t: 0.006, f: 1000, q: 8, dur: 0.04, gain: 0.1 });
      }, { bus: 'ui', gain: 0.55, rev: 0.05 }),
    };
  }

  // -------------------------------------------------------------------------
  // Movement — one footstep builder, six surface personalities
  // -------------------------------------------------------------------------
  _defsMove() {
    const step = (s) => def(0.22, (ctx, out) => {
      if (s.thump) this._thump(ctx, out, { t: 0, f0: s.thump[0], f1: s.thump[1], dur: s.thump[2], gain: s.thump[3] });
      this._burst(ctx, out, {
        t: 0, dur: s.dur, type: s.type, f0: s.f0, f1: s.f1, q: s.q, gain: s.gain,
        attack: s.attack || 0.0015, noise: s.noise,
      });
      if (s.reso) this._reso(ctx, out, { t: 0.002, f: s.reso[0], q: s.reso[1], dur: s.reso[2], gain: s.reso[3] });
      if (s.metal) this._metal(ctx, out, { t: 0, freqs: s.metal[0], dur: s.metal[1], gain: s.metal[2], click: false });
      if (s.click) this._click(ctx, out, { t: 0, f: s.click[0], gain: s.click[1], dur: 0.0022 });
    }, { gain: 0.6, rev: 0.22, jit: 0.13, gjit: 0.3, range: 45 });
    return {
      step_sand: step({ type: 'bandpass', f0: 1900, f1: 850, q: 0.7, dur: 0.1, gain: 0.3, attack: 0.005, noise: 'pink', thump: [95, 60, 0.05, 0.07] }),
      step_concrete: step({ type: 'bandpass', f0: 950, f1: 420, q: 1.2, dur: 0.055, gain: 0.36, thump: [125, 70, 0.05, 0.12], reso: [1650, 5, 0.045, 0.07], click: [3000, 0.14] }),
      step_metal: step({ type: 'bandpass', f0: 1500, f1: 900, q: 1, dur: 0.05, gain: 0.24, thump: [150, 90, 0.05, 0.08], metal: [[1420, 2150, 3300, 4700], 0.34, 0.14], click: [5000, 0.2] }),
      step_wood: step({ type: 'lowpass', f0: 1300, f1: 500, q: 0.6, dur: 0.045, gain: 0.3, thump: [180, 120, 0.05, 0.1], reso: [300, 12, 0.11, 0.26], click: [2400, 0.1] }),
      step_dirt: step({ type: 'lowpass', f0: 760, f1: 280, q: 0.5, dur: 0.1, gain: 0.32, attack: 0.007, noise: 'pink', thump: [100, 64, 0.06, 0.1] }),
      step_tile: step({ type: 'highpass', f0: 2800, q: 0.7, dur: 0.035, gain: 0.3, thump: [150, 95, 0.04, 0.08], reso: [5200, 9, 0.05, 0.12], click: [6000, 0.24] }),
      land_soft: def(0.26, (ctx, out) => {
        this._thump(ctx, out, { t: 0, f0: 130, f1: 70, dur: 0.1, gain: 0.3 });
        this._burst(ctx, out, { t: 0, dur: 0.12, type: 'lowpass', f0: 800, f1: 250, q: 0.5, gain: 0.22, noise: 'pink' });
        this._cloth(ctx, out, { t: 0.01, dur: 0.14, f0: 420, f1: 1100, gain: 0.09 });
      }, { gain: 0.75, rev: 0.25, jit: 0.08, range: 45 }),
      land_hard: def(0.45, (ctx, out) => {
        this._thump(ctx, out, { t: 0, f0: 145, f1: 42, dur: 0.22, gain: 0.8 });
        this._burst(ctx, out, { t: 0, dur: 0.14, type: 'lowpass', f0: 1500, f1: 200, q: 0.5, gain: 0.5 });
        this._click(ctx, out, { t: 0, f: 2600, gain: 0.25, dur: 0.0025 });
        this._reso(ctx, out, { t: 0.03, f: 240, q: 10, dur: 0.2, gain: 0.12 });     // knee flex
        this._spring(ctx, out, { t: 0.05, f0: 320, f1: 180, dur: 0.18, gain: 0.06 });
        this._cloth(ctx, out, { t: 0.02, dur: 0.2, f0: 380, f1: 1200, gain: 0.13 });
        this._debris(ctx, out, { t: 0.03, count: 5, span: 0.12, f0: 1200, f1: 3400, gain: 0.05 });
      }, { gain: 0.95, rev: 0.35, jit: 0.06, range: 60 }),
      jump: def(0.3, (ctx, out) => {
        this._cloth(ctx, out, { t: 0, dur: 0.16, f0: 350, f1: 1300, gain: 0.14, swell: 0.4 });
        this._metal(ctx, out, { t: 0.02, freqs: [2600, 3800, 5200], dur: 0.05, gain: 0.05, spread: 0.03, click: false });
        this._formants(ctx, out, { t: 0, dur: 0.14, gain: 0.07, p0: 210, p1: 160, buzz: 0.25, noise: 0.75, f: [640, 1250, 2600] });
      }, { gain: 0.6, rev: 0.2, jit: 0.1, range: 30 }),
      ladder: def(0.3, (ctx, out) => {
        this._metal(ctx, out, { t: 0, freqs: [1750, 2600, 3900, 5400], dur: 0.2, gain: 0.18 });
        this._burst(ctx, out, { t: 0.005, dur: 0.05, type: 'bandpass', f0: 2200, f1: 1100, q: 1.6, gain: 0.12 });
        this._thump(ctx, out, { t: 0, f0: 190, f1: 110, dur: 0.05, gain: 0.08 });
      }, { gain: 0.6, rev: 0.3, jit: 0.14, gjit: 0.25, range: 40 }),
    };
  }

  // -------------------------------------------------------------------------
  // Bodies — wet slaps, kevlar thwacks, helmet pings, formant "groans"
  // -------------------------------------------------------------------------
  _defsFlesh() {
    return {
      hit_flesh: def(0.24, (ctx, out) => {
        this._thump(ctx, out, { t: 0, f0: 95, f1: 48, dur: 0.1, gain: 0.4 });
        this._burst(ctx, out, { t: 0, dur: 0.09, type: 'lowpass', f0: 520, f1: 170, q: 0.7, gain: 0.55 });
        // the "squish": a mid band dropping in pitch
        this._burst(ctx, out, { t: 0.004, dur: 0.06, type: 'bandpass', f0: 1250, f1: 420, q: 3, gain: 0.22 });
        this._burst(ctx, out, { t: 0.02, dur: 0.14, type: 'lowpass', f0: 380, f1: 130, q: 0.5, gain: 0.08, noise: 'pink' });
      }, { gain: 0.9, rev: 0.2, jit: 0.09, range: 55 }),
      hit_kevlar: def(0.2, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 4200, gain: 0.45, dur: 0.002 });
        this._burst(ctx, out, { t: 0, dur: 0.05, type: 'bandpass', f0: 2200, f1: 900, q: 2, gain: 0.5 });
        this._reso(ctx, out, { t: 0, f: 620, q: 7, dur: 0.07, gain: 0.2 });
        this._thump(ctx, out, { t: 0, f0: 160, f1: 80, dur: 0.07, gain: 0.25 });
      }, { gain: 0.9, rev: 0.22, jit: 0.09, range: 55 }),
      hit_helmet: def(0.55, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 6000, gain: 0.5, dur: 0.002 });
        this._metal(ctx, out, { t: 0, freqs: [2650, 3980, 5350, 7150], dur: 0.45, gain: 0.3, spread: 0.003 });
        this._burst(ctx, out, { t: 0, dur: 0.04, type: 'bandpass', f0: 3200, f1: 1600, q: 2.5, gain: 0.3 });
        this._thump(ctx, out, { t: 0, f0: 210, f1: 110, dur: 0.06, gain: 0.16 });
      }, { gain: 0.95, rev: 0.3, jit: 0.07, range: 60 }),
      // headshot: wet crunch under a bright ping — the sound everyone wants
      headshot: def(0.6, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 5200, gain: 0.55, dur: 0.0022 });
        this._burst(ctx, out, { t: 0, dur: 0.11, type: 'bandpass', f0: 720, f1: 260, q: 1.3, gain: 0.6 });
        this._debris(ctx, out, { t: 0.002, count: 10, span: 0.07, f0: 900, f1: 3200, gain: 0.11, pop: 0.02, bias: 1 });
        this._thump(ctx, out, { t: 0, f0: 120, f1: 46, dur: 0.13, gain: 0.5 });
        this._metal(ctx, out, { t: 0.004, freqs: [4450, 6250], dur: 0.4, gain: 0.2, click: false });
      }, { gain: 1, rev: 0.3, jit: 0.06, range: 65 }),
      // death: filtered-noise/formant groan, no recordings anywhere
      death: def(0.85, (ctx, out) => {
        this._formants(ctx, out, { t: 0, dur: 0.55, gain: 0.4, p0: 150, p1: 88, buzz: 0.55, noise: 0.45, f: [500, 1040, 2450], fdrop: 0.76 });
        this._thump(ctx, out, { t: 0, f0: 115, f1: 70, dur: 0.2, gain: 0.12 });
        // the body going down
        this._thump(ctx, out, { t: 0.42, f0: 120, f1: 45, dur: 0.18, gain: 0.35 });
        this._burst(ctx, out, { t: 0.42, dur: 0.16, type: 'lowpass', f0: 900, f1: 200, q: 0.5, gain: 0.22, noise: 'pink' });
        this._cloth(ctx, out, { t: 0.4, dur: 0.22, f0: 380, f1: 1000, gain: 0.1 });
      }, { gain: 0.85, rev: 0.35, jit: 0.07, gjit: 0.12, range: 55 }),
      death_headshot: def(0.8, (ctx, out) => {
        this._burst(ctx, out, { t: 0, dur: 0.1, type: 'bandpass', f0: 800, f1: 240, q: 1.2, gain: 0.5 });
        this._debris(ctx, out, { t: 0, count: 9, span: 0.06, f0: 1100, f1: 3600, gain: 0.1, pop: 0.02, bias: 1 });
        this._formants(ctx, out, { t: 0.005, dur: 0.11, gain: 0.3, p0: 170, p1: 120, buzz: 0.6, noise: 0.4 });
        this._thump(ctx, out, { t: 0.28, f0: 125, f1: 44, dur: 0.2, gain: 0.4 });
        this._burst(ctx, out, { t: 0.28, dur: 0.18, type: 'lowpass', f0: 850, f1: 180, q: 0.5, gain: 0.24, noise: 'pink' });
        this._cloth(ctx, out, { t: 0.26, dur: 0.24, f0: 360, f1: 950, gain: 0.11 });
      }, { gain: 0.9, rev: 0.35, jit: 0.07, range: 55 }),
    };
  }

  // -------------------------------------------------------------------------
  // Bullet impacts, ricochets, near misses
  // -------------------------------------------------------------------------
  _defsImpacts() {
    return {
      impact_concrete: def(0.3, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 4600, gain: 0.5, dur: 0.002 });
        this._burst(ctx, out, { t: 0, dur: 0.06, type: 'bandpass', f0: 1700, f1: 620, q: 1, gain: 0.45 });
        this._thump(ctx, out, { t: 0, f0: 200, f1: 80, dur: 0.06, gain: 0.2 });
        this._burst(ctx, out, { t: 0.01, dur: 0.14, type: 'lowpass', f0: 900, f1: 240, q: 0.5, gain: 0.13, noise: 'pink' });
        this._debris(ctx, out, { t: 0.02, count: 7, span: 0.2, f0: 1400, f1: 4200, gain: 0.06 });
      }, { gain: 0.8, rev: 0.4, jit: 0.12, gjit: 0.25, range: 70 }),
      impact_metal: def(0.42, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 7000, gain: 0.5, dur: 0.002 });
        this._metal(ctx, out, { t: 0, freqs: [3250, 4700, 6400, 8200], dur: 0.3, gain: 0.3, spread: 0.002 });
        this._burst(ctx, out, { t: 0, dur: 0.05, type: 'highpass', f0: 3400, q: 0.8, gain: 0.35 });
        this._reso(ctx, out, { t: 0, f: 780, q: 9, dur: 0.12, gain: 0.12 });
      }, { gain: 0.8, rev: 0.45, jit: 0.14, gjit: 0.25, range: 75 }),
      impact_wood: def(0.3, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 3200, gain: 0.35, dur: 0.002 });
        this._reso(ctx, out, { t: 0, f: 420, q: 10, dur: 0.13, gain: 0.34 });
        this._reso(ctx, out, { t: 0, f: 1150, q: 8, dur: 0.07, gain: 0.14 });
        this._burst(ctx, out, { t: 0, dur: 0.05, type: 'highpass', f0: 2600, q: 0.7, gain: 0.16 });
        this._debris(ctx, out, { t: 0.01, count: 5, span: 0.12, f0: 1800, f1: 5000, gain: 0.05 });
      }, { gain: 0.8, rev: 0.35, jit: 0.13, gjit: 0.25, range: 65 }),
      impact_dirt: def(0.28, (ctx, out) => {
        this._burst(ctx, out, { t: 0, dur: 0.1, type: 'lowpass', f0: 620, f1: 190, q: 0.5, gain: 0.45, noise: 'pink' });
        this._thump(ctx, out, { t: 0, f0: 130, f1: 60, dur: 0.08, gain: 0.22 });
        this._debris(ctx, out, { t: 0.02, count: 6, span: 0.16, f0: 700, f1: 2200, gain: 0.05 });
      }, { gain: 0.75, rev: 0.25, jit: 0.14, gjit: 0.25, range: 55 }),
      impact_glass: def(0.55, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 8000, gain: 0.45, dur: 0.0018 });
        this._burst(ctx, out, { t: 0, dur: 0.05, type: 'highpass', f0: 4200, q: 0.8, gain: 0.4 });
        for (let i = 0; i < 7; i++) {                     // shards ringing out
          const f = rand(3200, 9000);
          this._thump(ctx, out, { t: rand(0, 0.05), f0: f, f1: f * 0.99, dur: rand(0.05, 0.22), gain: rand(0.05, 0.14), type: 'sine' });
        }
        this._debris(ctx, out, { t: 0.03, count: 16, span: 0.42, f0: 2600, f1: 8000, gain: 0.07, pop: 0.03, bias: 1.2 });
      }, { gain: 0.85, rev: 0.4, jit: 0.1, gjit: 0.2, range: 70 }),
      // descending whistle away from the surface
      ricochet: def(0.5, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 6000, gain: 0.3, dur: 0.002 });
        this._tone(ctx, out, { t: 0.002, f: rand(3600, 4600), f2: rand(700, 1000), dur: 0.34, gain: 0.16, type: 'sine', attack: 0.003 });
        this._burst(ctx, out, { t: 0.002, dur: 0.3, type: 'bandpass', f0: 4000, f1: 900, q: 7, gain: 0.1, attack: 0.004 });
        this._metal(ctx, out, { t: 0, freqs: [4200, 6100], dur: 0.1, gain: 0.1, click: false });
      }, { gain: 0.7, rev: 0.55, jit: 0.16, gjit: 0.3, range: 80 }),
      // bullet passing the listener: doppler-ish zip
      whizz: def(0.22, (ctx, out) => {
        this._burst(ctx, out, { t: 0, dur: 0.13, type: 'bandpass', f0: 900, f1: 2600, q: 4, gain: 0.28, attack: 0.03, fsweep: 0.45 });
        this._burst(ctx, out, { t: 0.06, dur: 0.1, type: 'bandpass', f0: 2400, f1: 700, q: 5, gain: 0.2, attack: 0.01 });
        this._tone(ctx, out, { t: 0.02, f: 2200, f2: 780, dur: 0.11, gain: 0.07, type: 'sine' });
      }, { gain: 0.7, rev: 0.15, jit: 0.18, gjit: 0.3, range: 30 }),
      penetrate: def(0.24, (ctx, out) => {
        this._burst(ctx, out, { t: 0, dur: 0.09, type: 'lowpass', f0: 420, f1: 150, q: 0.6, gain: 0.4, noise: 'pink' });
        this._thump(ctx, out, { t: 0, f0: 150, f1: 65, dur: 0.07, gain: 0.2 });
        this._debris(ctx, out, { t: 0.004, count: 5, span: 0.06, f0: 500, f1: 1600, gain: 0.06, pop: 0.02, bias: 1 });
      }, { gain: 0.6, rev: 0.2, jit: 0.14, gjit: 0.25, range: 45 }),
    };
  }

  // -------------------------------------------------------------------------
  // Grenades — pins, throws, bounces, detonations
  // -------------------------------------------------------------------------
  _defsNades() {
    return {
      nade_pin: def(0.22, (ctx, out) => {
        this._metal(ctx, out, { t: 0, freqs: [5300, 6900, 8400], dur: 0.16, gain: 0.22 });
        this._reso(ctx, out, { t: 0, f: 2100, q: 9, dur: 0.05, gain: 0.1 });
      }, { gain: 0.6, rev: 0.3, jit: 0.06, range: 25 }),
      nade_throw: def(0.3, (ctx, out) => {
        this._cloth(ctx, out, { t: 0, dur: 0.22, f0: 300, f1: 1600, gain: 0.2, swell: 0.55, q: 0.7 });
        this._metal(ctx, out, { t: 0.04, freqs: [2800, 4100], dur: 0.05, gain: 0.04, click: false });
      }, { gain: 0.6, rev: 0.25, jit: 0.1, range: 30 }),
      // metal body on stone — pitch is scaled by the caller per material
      nade_bounce: def(0.3, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 4200, gain: 0.3, dur: 0.002 });
        this._metal(ctx, out, { t: 0, freqs: [1950, 2850, 4150], dur: 0.19, gain: 0.24, spread: 0.004 });
        this._thump(ctx, out, { t: 0, f0: 260, f1: 120, dur: 0.05, gain: 0.14 });
        this._burst(ctx, out, { t: 0, dur: 0.04, type: 'bandpass', f0: 2400, f1: 1100, q: 2, gain: 0.12 });
      }, { gain: 0.75, rev: 0.4, jit: 0.16, gjit: 0.25, range: 60 }),
      // HE: deep body, debris crackle, long tail
      explode_he: def(2.3, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 3400, gain: 0.9, dur: 0.003 });
        this._thump(ctx, out, { t: 0, f0: 92, f1: 26, dur: 0.55, gain: 1, attack: 0.004 });
        this._thump(ctx, out, { t: 0, f0: 190, f1: 60, dur: 0.22, gain: 0.6 });
        this._burst(ctx, out, { t: 0, dur: 0.5, type: 'lowpass', f0: 3400, f1: 150, q: 0.5, gain: 0.9, attack: 0.003 });
        this._burst(ctx, out, { t: 0, dur: 0.1, type: 'highpass', f0: 2600, q: 0.7, gain: 0.45 });
        this._reso(ctx, out, { t: 0.01, f: 130, q: 4, dur: 0.7, gain: 0.3 });
        this._debris(ctx, out, { t: 0.05, count: 40, span: 1.3, f0: 700, f1: 5200, gain: 0.12, bias: 1.8 });
        this._burst(ctx, out, { t: 0.04, dur: 1.7, type: 'lowpass', f0: 700, f1: 90, q: 0.4, gain: 0.3, attack: 0.05, noise: 'pink' });
      }, { gain: 1.1, rev: 0.9, jit: 0.05, gjit: 0.08, range: 200 }),
      // flashbang: brightest transient in the game, then a white slam
      explode_flash: def(1.4, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 6500, gain: 1, dur: 0.004 });
        this._burst(ctx, out, { t: 0, dur: 0.2, type: 'highpass', f0: 1400, q: 0.6, gain: 1, attack: 0.0008 });
        this._burst(ctx, out, { t: 0, dur: 0.09, type: 'bandpass', f0: 4200, f1: 2200, q: 0.8, gain: 0.8 });
        this._thump(ctx, out, { t: 0, f0: 220, f1: 70, dur: 0.18, gain: 0.5 });
        this._burst(ctx, out, { t: 0.02, dur: 0.85, type: 'lowpass', f0: 2600, f1: 260, q: 0.4, gain: 0.32, attack: 0.02 });
        this._metal(ctx, out, { t: 0.005, freqs: [4700, 6800], dur: 0.2, gain: 0.12, click: false });
      }, { gain: 1.05, rev: 0.8, jit: 0.05, range: 180 }),
      // the classic tinnitus tone, ~4 s of 4.5 kHz
      flash_ring: def(4.3, (ctx, out) => {
        this._tone(ctx, out, { t: 0, f: 4500, dur: 4.2, gain: 0.34, type: 'sine', attack: 0.004, hold: 0.35 });
        this._tone(ctx, out, { t: 0, f: 4512, dur: 4, gain: 0.16, type: 'sine', attack: 0.006, hold: 0.3 });
        this._tone(ctx, out, { t: 0, f: 9000, dur: 1.6, gain: 0.05, type: 'sine', attack: 0.004 });
      }, { bus: 'ui', gain: 0.9, rev: 0, jit: 0.01, gjit: 0 }),

      smoke_pop: def(1.3, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 2600, gain: 0.5, dur: 0.0025 });
        this._thump(ctx, out, { t: 0, f0: 320, f1: 90, dur: 0.09, gain: 0.55 });
        this._burst(ctx, out, { t: 0, dur: 0.07, type: 'bandpass', f0: 1400, f1: 500, q: 1.2, gain: 0.35 });
        // the canister venting: hiss rising as pressure escapes
        this._burst(ctx, out, { t: 0.05, dur: 1.1, type: 'bandpass', f0: 320, f1: 2500, q: 0.8, gain: 0.3, attack: 0.28 });
      }, { gain: 0.85, rev: 0.5, jit: 0.08, range: 90 }),
      molly_ignite: def(1, (ctx, out) => {
        this._burst(ctx, out, { t: 0, dur: 0.06, type: 'bandpass', f0: 1800, f1: 700, q: 1.5, gain: 0.35 });
        // whoosh: broad noise swelling as the fuel catches
        this._burst(ctx, out, { t: 0, dur: 0.75, type: 'bandpass', f0: 200, f1: 1800, q: 0.6, gain: 0.5, attack: 0.22, noise: 'pink' });
        this._thump(ctx, out, { t: 0, f0: 130, f1: 55, dur: 0.3, gain: 0.28 });
        this._debris(ctx, out, { t: 0.06, count: 20, span: 0.85, f0: 1200, f1: 5200, gain: 0.07, pop: 0.03, bias: 1.1, fade: 0.4 });
      }, { gain: 0.9, rev: 0.55, jit: 0.07, range: 90 }),
    };
  }

  // -------------------------------------------------------------------------
  // Objective — planting, beeping, defusing, detonating
  // -------------------------------------------------------------------------
  _defsObjective() {
    /** Small servo whirr used by the C4 keypad and the defuse kit. */
    const servo = (ctx, out, t, dur, f, gain) => {
      this._tone(ctx, out, { t, f, f2: f * 1.15, dur, gain, type: 'sawtooth', attack: 0.01, hold: dur * 0.6, lp: 900, lq: 3 });
      this._burst(ctx, out, { t, dur, type: 'bandpass', f0: 1700, f1: 1200, q: 3, gain: gain * 0.5, attack: 0.02 });
    };
    return {
      // three descending keypad beeps plus the arming servo
      bomb_plant_start: def(0.8, (ctx, out) => {
        const fs = [1400, 1150, 900];
        for (let i = 0; i < 3; i++) {
          this._tone(ctx, out, { t: i * 0.12, f: fs[i], dur: 0.07, gain: 0.22, type: 'square', attack: 0.002, hold: 0.03, lp: 4200 });
          this._click(ctx, out, { t: i * 0.12, f: 3800, gain: 0.1, dur: 0.0018 });
        }
        servo(ctx, out, 0.36, 0.34, 120, 0.14);
        this._metal(ctx, out, { t: 0.68, freqs: [1800, 2600], dur: 0.06, gain: 0.06, click: false });
      }, { gain: 0.9, rev: 0.35, jit: 0.02, range: 55 }),
      // locked in: a single heavy chunk
      bomb_plant_done: def(0.6, (ctx, out) => {
        this._metal(ctx, out, { t: 0, freqs: [1500, 2200, 3100], dur: 0.12, gain: 0.3 });
        this._thump(ctx, out, { t: 0, f0: 150, f1: 55, dur: 0.16, gain: 0.5 });
        this._reso(ctx, out, { t: 0.01, f: 320, q: 8, dur: 0.18, gain: 0.16 });
        this._tone(ctx, out, { t: 0.14, f: 520, dur: 0.22, gain: 0.2, type: 'square', attack: 0.004, hold: 0.1, lp: 2600 });
      }, { gain: 0.95, rev: 0.4, jit: 0.02, range: 60 }),
      // the countdown blip — short, 2 kHz, with a metallic partial on top
      bomb_beep: def(0.16, (ctx, out) => {
        this._tone(ctx, out, { t: 0, f: 2000, dur: 0.07, gain: 0.3, type: 'square', attack: 0.0015, hold: 0.03, lp: 5200 });
        this._metal(ctx, out, { t: 0, freqs: [5200], dur: 0.06, gain: 0.05, click: false });
        this._click(ctx, out, { t: 0, f: 4200, gain: 0.08, dur: 0.0015 });
      }, { gain: 0.8, rev: 0.3, jit: 0.01, gjit: 0.04, range: 70, interval: 1 }),
      bomb_beep_fast: def(0.13, (ctx, out) => {
        this._tone(ctx, out, { t: 0, f: 2400, dur: 0.05, gain: 0.34, type: 'square', attack: 0.001, hold: 0.02, lp: 6200 });
        this._metal(ctx, out, { t: 0, freqs: [6400], dur: 0.05, gain: 0.06, click: false });
        this._click(ctx, out, { t: 0, f: 5200, gain: 0.1, dur: 0.0015 });
      }, { gain: 0.85, rev: 0.3, jit: 0.01, gjit: 0.04, range: 70, interval: 0.35 }),

      bomb_pickup: def(0.45, (ctx, out) => {
        this._cloth(ctx, out, { t: 0, dur: 0.16, f0: 380, f1: 1200, gain: 0.12 });
        this._metal(ctx, out, { t: 0.03, freqs: [2200, 3100, 4300], dur: 0.07, gain: 0.07, spread: 0.03, click: false });
        this._tone(ctx, out, { t: 0.12, f: 700, f2: 1050, dur: 0.16, gain: 0.16, type: 'square', attack: 0.004, lp: 3200 });
      }, { gain: 0.8, rev: 0.25, jit: 0.03, range: 40 }),
      // defuse finished: rising two-tone confirmation and the servo stopping
      defuse_done: def(0.7, (ctx, out) => {
        this._tone(ctx, out, { t: 0, f: 880, dur: 0.14, gain: 0.24, type: 'square', attack: 0.003, hold: 0.06, lp: 4200 });
        this._tone(ctx, out, { t: 0.13, f: 1320, dur: 0.3, gain: 0.26, type: 'square', attack: 0.003, hold: 0.12, lp: 5200 });
        this._metal(ctx, out, { t: 0, freqs: [3200, 4600], dur: 0.06, gain: 0.06, click: false });
        this._burst(ctx, out, { t: 0.42, dur: 0.14, type: 'bandpass', f0: 1400, f1: 500, q: 3, gain: 0.08, attack: 0.01 });
      }, { gain: 0.9, rev: 0.35, jit: 0.02, range: 60 }),
      // the detonation: ~4 s, sub sweep, slam, debris, long rumble
      bomb_explode: def(4.2, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 4200, gain: 1, dur: 0.004 });
        this._thump(ctx, out, { t: 0, f0: 70, f1: 17, dur: 1.7, gain: 1.1, attack: 0.006, fsweep: 0.6 });
        this._thump(ctx, out, { t: 0, f0: 165, f1: 42, dur: 0.5, gain: 0.8 });
        this._burst(ctx, out, { t: 0, dur: 1, type: 'lowpass', f0: 4200, f1: 120, q: 0.5, gain: 1, attack: 0.004 });
        this._burst(ctx, out, { t: 0, dur: 0.14, type: 'highpass', f0: 3000, q: 0.7, gain: 0.55 });
        this._reso(ctx, out, { t: 0.01, f: 92, q: 3, dur: 1.5, gain: 0.4 });
        this._debris(ctx, out, { t: 0.05, count: 70, span: 2.6, f0: 500, f1: 5600, gain: 0.13, bias: 1.9 });
        this._burst(ctx, out, { t: 0.05, dur: 3.4, type: 'lowpass', f0: 800, f1: 70, q: 0.4, gain: 0.36, attack: 0.08, noise: 'pink' });
        this._burst(ctx, out, { t: 0.9, dur: 2.4, type: 'bandpass', f0: 260, f1: 90, q: 0.6, gain: 0.14, attack: 0.4, noise: 'pink' });
      }, { gain: 1.15, rev: 0.95, jit: 0.03, gjit: 0.05, range: 400 }),
      c4_drop: def(0.4, (ctx, out) => {
        this._reso(ctx, out, { t: 0, f: 900, q: 7, dur: 0.09, gain: 0.28 });
        this._thump(ctx, out, { t: 0, f0: 170, f1: 70, dur: 0.1, gain: 0.3 });
        this._reso(ctx, out, { t: 0.075, f: 1250, q: 6, dur: 0.07, gain: 0.16 });
        this._metal(ctx, out, { t: 0.09, freqs: [2400, 3400, 4600], dur: 0.08, gain: 0.06, spread: 0.03, click: false });
      }, { gain: 0.85, rev: 0.4, jit: 0.08, range: 50 }),
    };
  }

  // -------------------------------------------------------------------------
  // Match flow + UI — the only place with actual musical material
  // -------------------------------------------------------------------------
  _defsUI() {
    const blip = (f, f2, dur, gain, type) => (ctx, out) => {
      this._tone(ctx, out, { t: 0, f, f2, dur, gain, type: type || 'square', attack: 0.002, hold: dur * 0.25, lp: 6000 });
      this._click(ctx, out, { t: 0, f: 5000, gain: gain * 0.35, dur: 0.0015 });
    };
    return {
      // tense stinger: minor stack, filter opening, noise hit
      round_start: def(1.35, (ctx, out) => {
        this._chord(ctx, out, {
          t: 0, freqs: [146.8, 174.6, 220], sub: 73.4, dur: 1.25, gain: 0.1,
          type: 'sawtooth', attack: 0.06, hold: 0.5, lp: 420, lp2: 3200, lq: 2, width: 0.7,
        });
        this._burst(ctx, out, { t: 0, dur: 0.4, type: 'bandpass', f0: 2600, f1: 700, q: 0.8, gain: 0.16, attack: 0.004 });
        this._thump(ctx, out, { t: 0, f0: 140, f1: 45, dur: 0.3, gain: 0.4 });
        this._tone(ctx, out, { t: 0.9, f: 1760, dur: 0.4, gain: 0.09, type: 'triangle', attack: 0.006 });
      }, { bus: 'music', gain: 0.9, rev: 0.4, jit: 0, gjit: 0, ch: 2 }),

      round_freeze: def(1, (ctx, out) => {
        this._chord(ctx, out, {
          t: 0, freqs: [110, 164.8], sub: 55, dur: 0.9, gain: 0.09, type: 'triangle',
          attack: 0.12, hold: 0.3, lp: 900, lq: 1.2, width: 0.5, voices: 2,
        });
        this._burst(ctx, out, { t: 0, dur: 0.7, type: 'lowpass', f0: 1400, f1: 300, q: 0.5, gain: 0.1, attack: 0.25, noise: 'pink' });
      }, { bus: 'music', gain: 0.8, rev: 0.35, jit: 0, gjit: 0, ch: 2 }),
      // urgent tick pattern for the last ten seconds
      ten_seconds: def(0.8, (ctx, out) => {
        for (let i = 0; i < 4; i++) {
          this._tone(ctx, out, { t: i * 0.16, f: 2000 + i * 130, dur: 0.055, gain: 0.14 + i * 0.03, type: 'square', attack: 0.0015, hold: 0.015, lp: 6400 });
          this._click(ctx, out, { t: i * 0.16, f: 6000, gain: 0.08, dur: 0.0015 });
        }
        this._thump(ctx, out, { t: 0, f0: 160, f1: 70, dur: 0.5, gain: 0.16 });
      }, { bus: 'ui', gain: 0.8, rev: 0.15, jit: 0, gjit: 0 }),
      // CT: bright, heroic, major, resolving upward
      ct_win: def(1.65, (ctx, out) => {
        this._chord(ctx, out, {
          t: 0, freqs: [220, 277.2, 329.6], sub: 110, dur: 0.78, gain: 0.1, type: 'sawtooth',
          attack: 0.014, hold: 0.34, lp: 1500, lp2: 5200, lq: 1.4, width: 0.75, detune: 11,
        });
        this._chord(ctx, out, {
          t: 0.72, freqs: [329.6, 440, 554.4], sub: 164.8, dur: 0.88, gain: 0.1, type: 'sawtooth',
          attack: 0.012, hold: 0.4, lp: 2200, lp2: 6200, lq: 1.2, width: 0.8, detune: 13,
        });
        this._burst(ctx, out, { t: 0, dur: 0.5, type: 'highpass', f0: 3600, q: 0.6, gain: 0.1, attack: 0.004 });
        this._thump(ctx, out, { t: 0, f0: 130, f1: 60, dur: 0.3, gain: 0.3 });
        this._tone(ctx, out, { t: 0.72, f: 880, dur: 0.8, gain: 0.06, type: 'triangle', attack: 0.01 });
      }, { bus: 'music', gain: 1, rev: 0.45, jit: 0, gjit: 0, ch: 2 }),
      // T: dark, minor, sinking
      t_win: def(1.65, (ctx, out) => {
        this._chord(ctx, out, {
          t: 0, freqs: [146.8, 174.6, 220], sub: 73.4, dur: 0.8, gain: 0.11, type: 'sawtooth',
          attack: 0.03, hold: 0.34, lp: 700, lp2: 2100, lq: 2.2, width: 0.7, detune: 14,
        });
        this._chord(ctx, out, {
          t: 0.74, freqs: [116.5, 146.8, 174.6], sub: 58.3, dur: 0.9, gain: 0.12, type: 'square',
          attack: 0.04, hold: 0.4, lp: 560, lp2: 1500, lq: 2.6, width: 0.75, detune: 16,
        });
        this._thump(ctx, out, { t: 0, f0: 110, f1: 38, dur: 0.45, gain: 0.42 });
        this._burst(ctx, out, { t: 0.74, dur: 0.7, type: 'lowpass', f0: 900, f1: 180, q: 0.5, gain: 0.12, attack: 0.1, noise: 'pink' });
      }, { bus: 'music', gain: 1, rev: 0.5, jit: 0, gjit: 0, ch: 2 }),

      // match won: I → IV → V, brass-ish saw stack, 3 s
      match_win: def(3.2, (ctx, out) => {
        const prog = [[0, [220, 277.2, 329.6], 110], [1, [293.7, 370, 440], 146.8], [2, [329.6, 415.3, 493.9, 659.3], 164.8]];
        for (const [t, freqs, sub] of prog) {
          this._chord(ctx, out, {
            t, freqs, sub, dur: t === 2 ? 1.15 : 1.05, gain: 0.095, type: 'sawtooth',
            attack: 0.02, hold: 0.5, lp: 1600, lp2: 6000, lq: 1.3, width: 0.8, detune: 12,
          });
          this._thump(ctx, out, { t, f0: 140, f1: 55, dur: 0.32, gain: 0.28 });
        }
        this._burst(ctx, out, { t: 0, dur: 0.6, type: 'highpass', f0: 4200, q: 0.6, gain: 0.1, attack: 0.005 });
        this._burst(ctx, out, { t: 1.85, dur: 1.2, type: 'highpass', f0: 5200, q: 0.5, gain: 0.09, attack: 0.02 });
      }, { bus: 'music', gain: 1, rev: 0.5, jit: 0, gjit: 0, ch: 2 }),
      // match lost: descending minor, no resolution
      match_lose: def(3.2, (ctx, out) => {
        const prog = [[0, [174.6, 220, 261.6], 87.3], [1.05, [146.8, 174.6, 220], 73.4], [2.1, [110, 130.8, 164.8], 55]];
        for (const [t, freqs, sub] of prog) {
          this._chord(ctx, out, {
            t, freqs, sub, dur: t > 2 ? 1.1 : 1.05, gain: 0.1, type: 'sawtooth',
            attack: 0.06, hold: 0.45, lp: 800, lp2: 1300, lq: 2, width: 0.7, detune: 15,
          });
        }
        this._thump(ctx, out, { t: 0, f0: 100, f1: 34, dur: 0.6, gain: 0.32 });
        this._burst(ctx, out, { t: 2.1, dur: 1.1, type: 'lowpass', f0: 700, f1: 130, q: 0.5, gain: 0.13, attack: 0.3, noise: 'pink' });
      }, { bus: 'music', gain: 0.95, rev: 0.55, jit: 0, gjit: 0, ch: 2 }),
      buy: def(0.3, (ctx, out) => {
        this._tone(ctx, out, { t: 0, f: 1200, dur: 0.06, gain: 0.16, type: 'square', attack: 0.002, lp: 6000 });
        this._tone(ctx, out, { t: 0.06, f: 1600, dur: 0.16, gain: 0.18, type: 'square', attack: 0.002, hold: 0.05, lp: 7000 });
        this._click(ctx, out, { t: 0, f: 5200, gain: 0.12, dur: 0.0015 });
      }, { bus: 'ui', gain: 0.7, rev: 0.08, jit: 0, gjit: 0 }),
      buy_fail: def(0.26, (ctx, out) => {
        this._tone(ctx, out, { t: 0, f: 165, dur: 0.18, gain: 0.2, type: 'square', attack: 0.003, hold: 0.1, lp: 1400 });
        this._tone(ctx, out, { t: 0, f: 82.5, dur: 0.2, gain: 0.12, type: 'square', attack: 0.003, hold: 0.1, lp: 900 });
        this._burst(ctx, out, { t: 0, dur: 0.16, type: 'bandpass', f0: 400, f1: 260, q: 4, gain: 0.06, attack: 0.004 });
      }, { bus: 'ui', gain: 0.7, rev: 0.05, jit: 0, gjit: 0 }),
      pickup: def(0.3, (ctx, out) => {
        this._cloth(ctx, out, { t: 0, dur: 0.1, f0: 500, f1: 1400, gain: 0.08 });
        this._tone(ctx, out, { t: 0.02, f: 900, f2: 1500, dur: 0.14, gain: 0.16, type: 'square', attack: 0.003, lp: 5200 });
        this._metal(ctx, out, { t: 0.02, freqs: [3200, 4600], dur: 0.05, gain: 0.05, click: false });
      }, { gain: 0.7, rev: 0.2, jit: 0.04, range: 35 }),
      ui_click: def(0.09, blip(2400, 2100, 0.04, 0.16), { bus: 'ui', gain: 0.6, rev: 0.03, jit: 0, gjit: 0 }),
      ui_hover: def(0.05, blip(3600, 3600, 0.018, 0.06), { bus: 'ui', gain: 0.4, rev: 0, jit: 0, gjit: 0 }),
      ui_back: def(0.14, blip(1200, 700, 0.09, 0.14), { bus: 'ui', gain: 0.55, rev: 0.03, jit: 0, gjit: 0 }),
      hitmarker: def(0.07, (ctx, out) => {
        this._click(ctx, out, { t: 0, f: 5600, gain: 0.35, dur: 0.0022 });
        this._tone(ctx, out, { t: 0, f: 3200, dur: 0.03, gain: 0.2, type: 'sine', attack: 0.0008 });
      }, { bus: 'ui', gain: 0.7, rev: 0, jit: 0.02, gjit: 0.05 }),

      killsound: def(0.4, (ctx, out) => {
        this._tone(ctx, out, { t: 0, f: 1568, dur: 0.09, gain: 0.2, type: 'square', attack: 0.001, hold: 0.03, lp: 7000 });
        this._tone(ctx, out, { t: 0.075, f: 2093, dur: 0.28, gain: 0.22, type: 'square', attack: 0.001, hold: 0.06, lp: 8000 });
        this._metal(ctx, out, { t: 0.075, freqs: [4186, 6270], dur: 0.26, gain: 0.09, click: false });
        this._click(ctx, out, { t: 0, f: 6200, gain: 0.15, dur: 0.0015 });
      }, { bus: 'ui', gain: 0.75, rev: 0.1, jit: 0, gjit: 0 }),
      radio_beep: def(0.24, (ctx, out) => {
        // squelch then two band-limited beeps, as if through a cheap speaker
        this._burst(ctx, out, { t: 0, dur: 0.03, type: 'bandpass', f0: 2400, f1: 1600, q: 3, gain: 0.1 });
        this._tone(ctx, out, { t: 0.025, f: 1800, dur: 0.055, gain: 0.14, type: 'square', attack: 0.002, lp: 3000, lq: 3 });
        this._tone(ctx, out, { t: 0.1, f: 2400, dur: 0.075, gain: 0.14, type: 'square', attack: 0.002, lp: 3400, lq: 3 });
        this._burst(ctx, out, { t: 0.18, dur: 0.04, type: 'bandpass', f0: 2000, f1: 1400, q: 3, gain: 0.06 });
      }, { bus: 'ui', gain: 0.7, rev: 0.05, jit: 0.01, gjit: 0.05 }),
    };
  }

  // -------------------------------------------------------------------------
  // Sustained sounds: two rendered noise beds + four fully live graphs
  // -------------------------------------------------------------------------
  _defsLoops() {
    return {
      // Burning molotov: constant crackle bed. Rendered once and looped; the
      // envelope is flat at both ends so the wrap point is inaudible.
      fire_loop: def(3, (ctx, out) => {
        const src = this._noiseSrc(ctx, 'pink');
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 820; bp.Q.value = 0.7;
        const g = ctx.createGain(); g.gain.value = 0.3;
        src.connect(bp); bp.connect(g); g.connect(out);
        src.start(0, rand(0, 1.5)); src.stop(3.02);
        // wobbling body so it does not sound like static
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.7; lfo.type = 'sine';
        const lg = ctx.createGain(); lg.gain.value = 240;
        lfo.connect(lg); lg.connect(bp.frequency); lfo.start(0); lfo.stop(3.02);
        this._debris(ctx, out, { t: 0.02, count: 150, span: 2.9, f0: 900, f1: 6000, gain: 0.06, pop: 0.03, bias: 1, fade: 0 });
      }, { kind: 'loop', gain: 0.55, rev: 0.3, range: 45 }),
      // Smoke grenade venting: narrow hiss with a slow wander.
      smoke_hiss: def(2.5, (ctx, out) => {
        const src = this._noiseSrc(ctx, 'white');
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.9;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 500;
        const g = ctx.createGain(); g.gain.value = 0.34;
        src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
        src.start(0, rand(0, 1.5)); src.stop(2.52);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.4; lfo.type = 'sine';
        const lg = ctx.createGain(); lg.gain.value = 420;
        lfo.connect(lg); lg.connect(bp.frequency); lfo.start(0); lfo.stop(2.52);
      }, { kind: 'loop', gain: 0.4, rev: 0.35, range: 40 }),

      // --- fully live graphs (no buffer): cheap and endlessly variable ------
      defuse_loop: {
        kind: 'live', bus: 'sfx', dur: 0, gain: 0.5, rev: 0.25, jit: 0, gjit: 0, range: 35,
        live: (ctx, out) => {
          const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 86;
          const sq = ctx.createOscillator(); sq.type = 'square'; sq.frequency.value = 43;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = 720; bp.Q.value = 1.6;
          const am = ctx.createGain(); am.gain.value = 0.45;
          const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 32;
          const lg = ctx.createGain(); lg.gain.value = 0.3;
          lfo.connect(lg); lg.connect(am.gain);
          const noise = this._noiseSrc(ctx, 'white');
          const nbp = ctx.createBiquadFilter();
          nbp.type = 'bandpass'; nbp.frequency.value = 2600; nbp.Q.value = 1.2;
          const ng = ctx.createGain(); ng.gain.value = 0.06;
          const g = ctx.createGain(); g.gain.value = 0.32;
          saw.connect(bp); sq.connect(bp); bp.connect(am); am.connect(g);
          noise.connect(nbp); nbp.connect(ng); ng.connect(g);
          g.connect(out);
          const t = ctx.currentTime;
          saw.start(t); sq.start(t); lfo.start(t); noise.start(t, rand(0, 1.5));
          return {
            setRate(r) {
              const now = ctx.currentTime;
              saw.frequency.setTargetAtTime(86 * r, now, 0.05);
              sq.frequency.setTargetAtTime(43 * r, now, 0.05);
              lfo.frequency.setTargetAtTime(32 * r, now, 0.05);
            },
            stop() { for (const n of [saw, sq, lfo, noise]) { try { n.stop(); } catch (e) { /* ignore */ } } },
          };
        },
      },
      // sustained flash deafness (flash_ring is the one-shot version)
      tinnitus: {
        kind: 'live', bus: 'ui', dur: 0, gain: 0.85, rev: 0, jit: 0, gjit: 0, range: 999,
        live: (ctx, out) => {
          const specs = [[4500, 0.26], [4508, 0.13], [9010, 0.035]];
          const oscs = specs.map(([f, a]) => {
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
            const g = ctx.createGain(); g.gain.value = a;
            o.connect(g); g.connect(out); o.start(ctx.currentTime);
            return o;
          });
          return {
            setRate(r) {
              for (let i = 0; i < oscs.length; i++) oscs[i].frequency.setTargetAtTime(specs[i][0] * r, ctx.currentTime, 0.1);
            },
            stop() { for (const o of oscs) { try { o.stop(); } catch (e) { /* ignore */ } } },
          };
        },
      },

      // desert map bed: slow filtered-noise swells plus a faint whistle
      ambient_wind: {
        kind: 'live', bus: 'sfx', dur: 0, gain: 0.5, rev: 0.2, jit: 0, gjit: 0, range: 999,
        live: (ctx, out) => {
          const n = this._noiseSrc(ctx, 'pink');
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass'; lp.frequency.value = 430; lp.Q.value = 0.9;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 2.4;
          const g = ctx.createGain(); g.gain.value = 0.5;
          const wg = ctx.createGain(); wg.gain.value = 0.11;
          n.connect(lp); lp.connect(g);
          n.connect(bp); bp.connect(wg); wg.connect(g);
          g.connect(out);
          const mk = (freq, depth, target) => {
            const o = ctx.createOscillator();
            o.type = 'sine'; o.frequency.value = freq;
            const a = ctx.createGain(); a.gain.value = depth;
            o.connect(a); a.connect(target); o.start(ctx.currentTime);
            return o;
          };
          const l1 = mk(0.07, 260, lp.frequency);
          const l2 = mk(0.045, 0.3, g.gain);
          const l3 = mk(0.11, 430, bp.frequency);
          n.start(ctx.currentTime, rand(0, 1.5));
          return {
            setRate(r) { l1.frequency.setTargetAtTime(0.07 * r, ctx.currentTime, 0.2); },
            stop() { for (const x of [n, l1, l2, l3]) { try { x.stop(); } catch (e) { /* ignore */ } } },
          };
        },
      },
      // interior bed: mains-ish hum plus a low rumble floor
      ambient_room: {
        kind: 'live', bus: 'sfx', dur: 0, gain: 0.45, rev: 0.12, jit: 0, gjit: 0, range: 999,
        live: (ctx, out) => {
          const g = ctx.createGain(); g.gain.value = 0.5;
          const oscs = [];
          for (const [f, a] of [[50, 0.17], [100, 0.07], [150, 0.03], [233, 0.014]]) {
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
            const og = ctx.createGain(); og.gain.value = a;
            o.connect(og); og.connect(g); o.start(ctx.currentTime);
            oscs.push(o);
          }
          const n = this._noiseSrc(ctx, 'pink');
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass'; lp.frequency.value = 270; lp.Q.value = 0.7;
          const ng = ctx.createGain(); ng.gain.value = 0.15;
          n.connect(lp); lp.connect(ng); ng.connect(g);
          g.connect(out);
          const l = ctx.createOscillator(); l.type = 'sine'; l.frequency.value = 0.06;
          const lg = ctx.createGain(); lg.gain.value = 0.1;
          l.connect(lg); lg.connect(g.gain);
          l.start(ctx.currentTime);
          n.start(ctx.currentTime, rand(0, 1.5));
          return {
            setRate(r) { for (let i = 0; i < oscs.length; i++) oscs[i].detune.setTargetAtTime((r - 1) * 1200, ctx.currentTime, 0.2); },
            stop() { for (const x of [...oscs, n, l]) { try { x.stop(); } catch (e) { /* ignore */ } } },
          };
        },
      },
    };
  }

// __APPEND__
}

export default AudioEngine;




