// ============================================================================
// 程序化合成音频引擎（WebAudio，无外部素材）
// ============================================================================

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.volume = 0.8;
    this.started = false;
    this.ambient = null;
  }

  ensure() {
    if (!this.started) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        // 白噪声缓冲
        const len = this.ctx.sampleRate * 2;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.started = true;
      } catch (e) { /* 无音频环境 */ }
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  noise(dur, vol, filterType, freq, freqEnd, q = 1) {
    if (!this.ctx) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  tone(type, freq, freqEnd, dur, vol, delay = 0) {
    if (!this.ctx) return;
    const t = this.now() + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------------- 武器 ----------------
  gunshot(kind, dist = 1) {
    const att = 1 / (1 + dist * 0.045);
    const t = this.now();
    if (kind === "ak") {
      this.noise(0.11, 0.85 * att, "lowpass", 2400, 300, 0.8);
      this.noise(0.05, 0.5 * att, "bandpass", 4200, 1800, 0.7);
      this.tone("square", 180, 60, 0.09, 0.28 * att);
      this._crack(t, att);
    } else if (kind === "m4") {
      this.noise(0.1, 0.75 * att, "lowpass", 2100, 250, 0.8);
      this.noise(0.045, 0.45 * att, "bandpass", 3800, 1600, 0.7);
      this.tone("square", 150, 50, 0.08, 0.24 * att);
      this._crack(t, att);
    } else if (kind === "awp") {
      this.noise(0.34, 1.1 * att, "lowpass", 1500, 120, 0.9);
      this.noise(0.14, 0.7 * att, "bandpass", 900, 200, 0.8);
      this.tone("sine", 92, 30, 0.32, 0.7 * att);
      this._crack(t, att * 1.2);
    } else if (kind === "smg") {
      this.noise(0.07, 0.5 * att, "lowpass", 2600, 500, 0.8);
      this.noise(0.04, 0.3 * att, "bandpass", 5000, 2000, 0.7);
      this.tone("square", 210, 80, 0.05, 0.16 * att);
      this._crack(t, att * 0.8);
    } else if (kind === "shotgun") {
      this.noise(0.28, 1.0 * att, "lowpass", 1100, 90, 0.85);
      this.tone("sine", 70, 28, 0.22, 0.55 * att);
      this._crack(t, att);
    } else if (kind === "glock") {
      this.noise(0.09, 0.55 * att, "lowpass", 2800, 400, 0.8);
      this.noise(0.04, 0.35 * att, "bandpass", 5200, 2200, 0.7);
      this.tone("square", 240, 90, 0.06, 0.18 * att);
      this._crack(t, att * 0.85);
    }
  }

  _crack(t, att) {
    this.noise(0.012, 0.6 * att, "highpass", 3500, 9000, 0.6);
  }

  dryFire() { this.tone("square", 900, 700, 0.04, 0.15); }

  reload(kind, step = 0) {
    if (step === 0) {
      this.noise(0.05, 0.35, "bandpass", 1600, 900, 1.2);
      this.tone("square", 420, 300, 0.04, 0.12);
    } else {
      this.noise(0.06, 0.4, "bandpass", 2200, 1200, 1.2);
      this.tone("square", 520, 360, 0.05, 0.14, 0.02);
      if (kind === "sniper") this.noise(0.08, 0.35, "bandpass", 900, 500, 1.5);
    }
  }

  draw(kind) {
    this.noise(0.07, 0.3, "bandpass", 1800, 1000, 1.2);
    this.tone("square", 350, 260, 0.05, 0.1);
  }

  zoom() { this.noise(0.05, 0.2, "bandpass", 2400, 1400, 1); }
  bolt() { this.noise(0.06, 0.4, "bandpass", 1500, 800, 1.3); }

  // ---------------- 脚步 ----------------
  step(surface = "concrete", sprint = false) {
    const f = surface === "metal" ? 1900 : surface === "wood" ? 1200 : surface === "sand" ? 500 : 800;
    this.noise(0.055, sprint ? 0.3 : 0.22, "lowpass", f, f * 0.35, 1.1);
    this.tone("sine", surface === "metal" ? 130 : 90, 55, 0.05, sprint ? 0.16 : 0.1);
  }

  land() { this.noise(0.09, 0.35, "lowpass", 600, 200, 1); }

  // ---------------- 投掷物 ----------------
  nadeBounce() { this.tone("square", 700, 380, 0.05, 0.22); this.noise(0.04, 0.18, "bandpass", 1800, 900, 1); }
  nadeThrow() { this.noise(0.1, 0.12, "bandpass", 900, 500, 1); }
  explosion(dist = 1) {
    const att = 1 / (1 + dist * 0.12);
    this.noise(0.7, 1.15 * att, "lowpass", 900, 55, 0.7);
    this.tone("sine", 68, 24, 0.6, 0.9 * att);
    this.noise(0.2, 0.5 * att, "highpass", 800, 3000, 0.5);
  }
  flashbang(dist = 1) {
    const att = 1 / (1 + dist * 0.1);
    this.tone("sine", 2600, 2600, 2.6, 0.5 * att);
    this.tone("sine", 2800, 2900, 1.8, 0.3 * att);
  }
  smokePop() { this.noise(0.5, 0.55, "lowpass", 700, 120, 0.8); this.tone("sine", 120, 40, 0.5, 0.3); }
  molotov() {
    this.noise(0.35, 0.6, "lowpass", 2200, 400, 0.8);
    this.noise(0.9, 0.35, "lowpass", 1400, 500, 0.7);
  }
  fireLoop() { this.noise(2.4, 0.18, "lowpass", 800, 200, 0.8); }

  // ---------------- 命中 ----------------
  hit(headshot = false) {
    if (headshot) {
      this.tone("square", 1200, 500, 0.09, 0.4);
      this.noise(0.07, 0.3, "bandpass", 2000, 800, 1);
    } else {
      this.noise(0.06, 0.3, "bandpass", 1200, 500, 1.2);
      this.tone("sine", 300, 140, 0.06, 0.18);
    }
  }
  headshotKill() {
    this.tone("square", 900, 300, 0.16, 0.5);
    this.tone("sine", 1600, 500, 0.2, 0.35);
  }
  kill() { this.tone("square", 520, 180, 0.18, 0.4); }
  death() { this.tone("sine", 220, 60, 0.5, 0.5); this.noise(0.4, 0.3, "lowpass", 900, 150, 0.8); }
  hurt() { this.tone("sawtooth", 180, 90, 0.09, 0.22); }
  armorHit() { this.tone("square", 950, 620, 0.05, 0.22); }
  wallHit() { this.noise(0.05, 0.2, "bandpass", 1400, 700, 1); }
  glassHit() {
    this.noise(0.16, 0.45, "highpass", 2500, 6000, 1);
    this.tone("sine", 1800, 900, 0.12, 0.2);
  }

  // ---------------- 炸弹 ----------------
  bombPlant() {
    for (let i = 0; i < 4; i++) {
      this.tone("square", 880, 880, 0.07, 0.25, i * 0.28);
      this.tone("square", 660, 660, 0.07, 0.2, i * 0.28 + 0.07);
    }
  }
  bombDefuse() {
    this.tone("square", 740, 740, 0.08, 0.25);
    this.tone("square", 990, 990, 0.08, 0.25, 0.12);
  }
  bombBeep(stage) {
    // stage 0: 慢速, 1: 中速, 2: 急促
    const f = stage === 2 ? 1400 : stage === 1 ? 1100 : 880;
    this.tone("square", f, f, 0.07, 0.3);
  }
  roundStart() {
    this.tone("square", 440, 440, 0.1, 0.25);
    this.tone("square", 660, 660, 0.12, 0.25, 0.12);
  }
  roundWin(win) {
    if (win) {
      this.tone("square", 523, 523, 0.14, 0.3);
      this.tone("square", 659, 659, 0.14, 0.3, 0.15);
      this.tone("square", 784, 784, 0.24, 0.3, 0.3);
    } else {
      this.tone("sawtooth", 330, 330, 0.16, 0.26);
      this.tone("sawtooth", 262, 262, 0.24, 0.26, 0.17);
    }
  }
  matchEnd(win) {
    for (let i = 0; i < 3; i++) {
      this.tone("square", win ? 523 : 262, win ? 523 : 262, 0.22, 0.3, i * 0.24);
      this.tone("square", win ? 392 : 196, win ? 392 : 196, 0.22, 0.25, i * 0.24 + 0.12);
    }
  }
  tenSecond() {
    this.tone("square", 1000, 1000, 0.1, 0.3);
    this.tone("square", 1000, 1000, 0.1, 0.3, 0.16);
  }
  buy() { this.tone("square", 880, 880, 0.05, 0.18); this.tone("square", 1175, 1175, 0.06, 0.18, 0.06); }
  cantBuy() { this.tone("sawtooth", 220, 180, 0.16, 0.3); }
  click() { this.tone("square", 700, 500, 0.04, 0.12); }
  alert() { this.tone("square", 620, 620, 0.09, 0.24); this.tone("square", 620, 620, 0.09, 0.24, 0.13); }
  pickup() { this.tone("square", 500, 750, 0.08, 0.2); }
  drop() { this.tone("square", 300, 180, 0.07, 0.2); }
  bodyHit() { this.noise(0.08, 0.35, "lowpass", 700, 250, 1); }

  // ---------------- 环境 ----------------
  startAmbient(kind = "wind") {
    if (!this.ctx) return;
    this.stopAmbient();
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = kind === "wind" ? 240 : 160;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.055, t + 2);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    this.ambient = { src, g };
  }
  stopAmbient() {
    if (this.ambient) {
      try { this.ambient.src.stop(); } catch (e) {}
      this.ambient = null;
    }
  }
}

export const AudioSys = new AudioEngine();
